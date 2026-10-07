-- =============================================================================
-- RF-17, Ola 4: una publicación no pasa a `activa` si su dueño no está activo.
--
-- EL HUECO QUE CIERRA. `pause_listings_on_suspend` (20260917000457) pausa las
-- `activa` de una cuenta en el acto de suspenderla, pero nada volvía a mirar
-- después: una `pendiente` de un dueño suspendido se podía activar por el
-- camino de usuario de `moderar-contenido` (`moderarListing()` escribe con
-- privilegios elevados y no lee `users.estado`, index.ts:438-455) y por Studio.
-- Se aceptó hasta esta ola con la regla A1b de `docs/admin-runbook.md`.
--
-- LANZA, NO REESCRIBE (D9 de docs/rf17-plan-admin.md). Un trigger que dejara
-- la fila en `pendiente` en silencio haría que el llamante creyera que activó
-- algo. `moderar-contenido` traduce el rechazo a `pendiente` (se despliega
-- ANTES que esta migración: tolera que el trigger todavía no exista), y
-- `admin.aprobar_listing` (…481) lo adelanta con un precheck.
--
-- 55000 (object_not_in_prerequisite_state), igual que los prechecks del panel:
-- no es un problema de permisos, es un estado del dueño. `moderar-contenido` lo
-- detecta por el MENSAJE, así que el código no le cambia nada.
-- =============================================================================

-- El MISMO predicado que `private.is_active_user()` (20260906000438:58-61),
-- aplicado al dueño de la fila en vez de a `auth.uid()`: `is_active_user()` no
-- acepta parámetro, así que no se puede reusar (mismo motivo que el `and
-- u.estado = 'activo'` inline de `seller_whatsapp`, 20260911000449).
--
-- FAIL-CLOSED: `not exists (… estado = 'activo')` lanza también si el dueño no
-- existe. La forma `select estado into v … if v <> 'activo'` dejaría pasar ese
-- caso (v es NULL y `NULL <> 'activo'` no es verdadero) y el error llegaría
-- después como 23503 de la FK, lejos de su causa. T35b (e) lo vigila.
-- (`users.estado` es NOT NULL, 20260906000438:15, así que el NULL del estado
-- en sí no es alcanzable.)
--
-- SECURITY DEFINER porque lee `public.users` de OTRA persona: como invoker
-- funcionaría hoy (users_select es `using (true)` y `estado` está en el grant
-- de columna), pero la regla no debe depender de eso. EXECUTE revocado: solo la
-- dispara un trigger (Postgres verifica EXECUTE al crearlo, no al dispararlo).
create function private.exige_dueno_activo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.users u
     where u.id = new.user_id and u.estado = 'activo'
  ) then
    raise exception 'dueno_no_activo' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke execute on function private.exige_dueno_activo()
  from public, anon, authenticated;

-- DOS triggers y no uno con `insert or update`: el `WHEN` de un trigger
-- declarado sobre los dos eventos no puede referenciar `old` (mismo motivo que
-- 20260912000453).
--
-- El `old.estado is distinct from new.estado` del de UPDATE es LOAD-BEARING,
-- la misma lección que `listings_enforce_activation_has_photos`
-- (20260909000447): sin él, `increment_listing_view()` y cualquier UPDATE que
-- no cambie el estado de una `activa` legacy de un suspendido revientan. T35b
-- (c) lo vigila.
--
-- ORDEN DE DISPARO (alfabético por nombre en el mismo evento): en UPDATE corre
-- primero `listings_enforce_activation_has_photos`, después este, después
-- `listings_limpia_veredicto_en_pantalla` y `listings_set_updated_at`. Con un
-- dueño suspendido y sin fotos gana el mensaje de fotos. T35b (d) lo fija.
create trigger listings_exige_dueno_activo_ins
  before insert on public.listings
  for each row
  when (new.estado = 'activa')
  execute function private.exige_dueno_activo();

create trigger listings_exige_dueno_activo_upd
  before update of estado on public.listings
  for each row
  when (old.estado is distinct from new.estado and new.estado = 'activa')
  execute function private.exige_dueno_activo();

-- SIN BACKFILL. Medido en remoto el 2026-10-07: 0 publicaciones `pendiente` o
-- `activa` de dueños suspendidos (0 suspendidos). Una `activa` legacy de un
-- suspendido, si existiera, NO se toca: el trigger solo mira transiciones e
-- inserts, igual que el de fotos.
