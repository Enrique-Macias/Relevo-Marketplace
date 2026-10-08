-- Relevo — RF-17, Ola 4: la cola de moderación y aprobar desde el panel, y la
-- visibilidad de las fotos de una `bloqueada` para su dueño (D5).
--
-- Plan: docs/rf17-plan-admin.md (§4 la plantilla de toda RPC, §6 Storage, D5)
-- y el plan de la Ola 4 (E1, E2, V3). Lo que agrega:
--
--   1. `admin_acciones_accion_check` admite `aprobar_listing` (7 acciones).
--   2. `admin.cola_moderacion`: las `pendiente`, separadas en evaluadas (con al
--      menos una fila en `listing_moderacion`) y sin evaluar (altas que se
--      quedaron a media subida y nunca pidieron moderación).
--   3. `admin.aprobar_listing`: `pendiente → activa`, con motivo obligatorio,
--      tomando el reclamo de moderación en la misma transacción (E2).
--   4. Las policies del DUEÑO sobre las fotos de una `bloqueada` (D5 = (a)):
--      dejan de verlas y de escribirlas, en la tabla `listing_photos` y en el
--      bucket. El borrado físico lo hace la Edge Function `eliminar-publicacion`
--      con service_role; la app la usa para TODO borrado, y tiene que estar
--      desplegada y en los dispositivos ANTES del push de esta migración: si
--      no, un borrado desde la app vieja deja los objetos huérfanos en silencio
--      (`remove()` responde `200 []` sobre lo que la RLS esconde, CLAUDE.md §9).
--
-- Toda función de `admin.*` sigue la plantilla de 20260930000477: definer,
-- `set search_path = ''`, `perform private.exigir_admin()` como primera línea,
-- `revoke … from public, anon` + `grant execute … to authenticated`.

-- ---------------------------------------------------------------------------
-- 1. Acciones auditables
-- ---------------------------------------------------------------------------
-- Drop + add en la misma migración: no hay ventana sin check. Las 6 de antes se
-- conservan tal cual (20260930000479:38-40).

alter table private.admin_acciones
  drop constraint admin_acciones_accion_check;

alter table private.admin_acciones
  add constraint admin_acciones_accion_check
  check (accion in ('suspender_usuario', 'reactivar_usuario', 'activar_admin',
                    'desactivar_admin', 'resolver_reporte', 'bloquear_listing',
                    'aprobar_listing'));

-- ---------------------------------------------------------------------------
-- 2. admin.cola_moderacion
-- ---------------------------------------------------------------------------
--
-- "La cola" es literalmente `estado = 'pendiente'` (CLAUDE.md §3); esto no
-- agrega estado nuevo. `p_solo_evaluadas` parte esa cola en dos conjuntos
-- DISJUNTOS (los dos chips del frame): true = con al menos una evaluación;
-- false = sin ninguna. Cierra la deuda "la cola mezcla lo marcado por
-- moderación con lo abandonado a media subida" (moderacion.md §9).
--
-- Orden `id asc` (la más antigua primero: es una cola), cursor `id > p_cursor`,
-- tope de 100 aunque se pidan más (la plantilla de §4).
--
-- `fotos` son las RUTAS de Storage en su orden: el panel las baja con su
-- policy de admin (`listing_photos_objects_select_admin`), como en el detalle.

create function admin.cola_moderacion(
  p_solo_evaluadas boolean default true,
  p_cursor bigint default null,
  p_limit int default 50
)
returns table (
  id                    bigint,
  titulo                text,
  precio                numeric,
  categoria             text,
  created_at            timestamptz,
  dueno_id              uuid,
  dueno_nombre          text,
  dueno_estado          public.user_status,
  fotos                 text[],
  evaluaciones          int,
  ultimo_veredicto      text,
  ultimo_detalle        jsonb,
  ultima_evaluacion_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  perform private.exigir_admin();

  return query
  select l.id, l.titulo, l.precio, c.nombre, l.created_at,
         l.user_id, u.nombre, u.estado,
         coalesce((select array_agg(p.storage_path order by p.orden)
                     from public.listing_photos p where p.listing_id = l.id),
                  '{}'::text[]),
         (select count(*)::int from public.listing_moderacion m where m.listing_id = l.id),
         ult.veredicto, ult.detalle, ult.created_at
    from public.listings l
    join public.users u on u.id = l.user_id
    left join public.categories c on c.id = l.categoria_id
    left join lateral (
      select m.veredicto, m.detalle, m.created_at
        from public.listing_moderacion m
       where m.listing_id = l.id
       order by m.id desc
       limit 1
    ) ult on true
   where l.estado = 'pendiente'
     and (ult.created_at is not null) = coalesce(p_solo_evaluadas, true)
     and (p_cursor is null or l.id > p_cursor)
   order by l.id asc
   limit v_limit;
end;
$$;

revoke execute on function admin.cola_moderacion(boolean, bigint, int) from public, anon;
grant  execute on function admin.cola_moderacion(boolean, bigint, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. admin.aprobar_listing
-- ---------------------------------------------------------------------------
--
-- Guardas, EN ESTE ORDEN, cada una con su SQLSTATE y su mensaje:
--
--   G1  exigir_admin()                     42501 no_admin / mfa_requerido / totp_vencido
--   G2  motivo de 3 a 500 tras btrim       22023 motivo_invalido
--   G3  la publicación existe              P0002 listing_no_existe
--   G4  no es del propio admin             42501 no_sobre_si_mismo
--   G5  su dueño no es otro admin          42501 objetivo_es_admin
--   G6  está en `pendiente`                55000 estado_inesperado
--   G7  su dueño está activo               55000 dueno_no_activo
--   G8  tiene al menos una foto            55000 sin_fotos
--   G9  no hay una evaluación en curso     55000 moderacion_en_curso
--   G10 CAS desde `pendiente`              55000 estado_inesperado
--
-- G6 adelanta lo que el CAS ya garantiza para que una publicación que ya no
-- está en revisión diga eso, y no "sin fotos" o "dueño suspendido".
--
-- G7 y G8 son PRECHECKS, no el candado: el candado son los triggers
-- `listings_exige_dueno_activo_upd` (20261007000480) y
-- `listings_enforce_activation_has_photos` (20260909000447), que dispararían
-- igual en el CAS. Van antes para devolver un mensaje con nombre, SIN bloque
-- EXCEPTION que capture el error del trigger (la cautela de
-- supabase/KNOWN_ISSUES.md). 55000 y no 42501: no son permisos, y en
-- `admin/src/lib/rechazos.ts` un 42501 con `no_admin` cierra la sesión.
-- G7 usa el MISMO predicado fail-closed que el trigger.
--
-- G9 (E2): el admin TOMA el reclamo de `listing_moderacion_reclamos` en esta
-- misma transacción, en vez de solo mirarlo:
--   · un `FOR UPDATE` no bloquea una fila que todavía no existe, y un
--     `not exists` dentro del UPDATE no ve, en READ COMMITTED, un reclamo que
--     se confirme después de su snapshot;
--   · con el insert, la PK serializa contra el `upsert … ignoreDuplicates` de
--     `reclamar()` (moderar-contenido/index.ts): el que llega segundo espera
--     el commit del primero y ve su fila. Si aprobó el admin, la función
--     responde `reclamo_tomado` sin evaluar; si la función reclamó primero, el
--     admin recibe `moderacion_en_curso`.
--   · un reclamo vencido (worker muerto) se libera antes, con el MISMO TTL que
--     la función: 180 s, ESCRITO DOS VECES (aquí y `TTL_RECLAMO_MS` en
--     `index.ts`). Cambiar uno sin el otro no da error; lo caza el tripwire de
--     `scripts/probe-admin.mjs`, que los compara.
--   · un reclamo COMPLETADO no bloquea: la evaluación del alta ya pasó.
-- Cualquier `raise` posterior revierte el insert del reclamo.
--
-- `veredicto_en_pantalla` no se toca: mientras la fila está en `pendiente`, la
-- limpieza de 20260928000473 la mantiene en false, así que el trigger
-- `listings_notify_moderacion` le avisa al dueño "ya está publicada".
--
-- No escribe en `listing_moderacion`, igual que `bloquear_listing`: ese
-- historial es de evaluaciones automáticas; la acción del admin vive en
-- `admin_acciones` (con su motivo, una sola vez).

create function admin.aprobar_listing(p_id bigint, p_motivo text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := btrim(p_motivo);
  v_duenio uuid;
  v_antes  public.listing_status;
  v_tomado bigint;
  v_completada timestamptz;
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  select l.user_id, l.estado into v_duenio, v_antes
    from public.listings l where l.id = p_id;
  if not found then
    raise exception 'listing_no_existe' using errcode = 'P0002';
  end if;

  if v_duenio = (select auth.uid()) then
    raise exception 'no_sobre_si_mismo' using errcode = '42501';
  end if;

  if exists (select 1 from private.admins a where a.user_id = v_duenio) then
    raise exception 'objetivo_es_admin' using errcode = '42501';
  end if;

  if v_antes <> 'pendiente' then
    raise exception 'estado_inesperado' using errcode = '55000';
  end if;

  if not exists (select 1 from public.users u
                  where u.id = v_duenio and u.estado = 'activo') then
    raise exception 'dueno_no_activo' using errcode = '55000';
  end if;

  if not exists (select 1 from public.listing_photos p where p.listing_id = p_id) then
    raise exception 'sin_fotos' using errcode = '55000';
  end if;

  -- G9. El TTL: 180 s, el mismo que `TTL_RECLAMO_MS` de moderar-contenido.
  delete from public.listing_moderacion_reclamos r
   where r.listing_id = p_id
     and r.completada_at is null
     and r.reclamada_at < now() - interval '180 seconds';

  insert into public.listing_moderacion_reclamos (listing_id, completada_at)
  values (p_id, now())
  on conflict (listing_id) do nothing
  returning listing_id into v_tomado;

  if v_tomado is null then
    select r.completada_at into v_completada
      from public.listing_moderacion_reclamos r where r.listing_id = p_id;
    if v_completada is null then
      raise exception 'moderacion_en_curso' using errcode = '55000';
    end if;
  end if;

  update public.listings
     set estado = 'activa'
   where id = p_id and estado = 'pendiente';
  if not found then
    raise exception 'estado_inesperado' using errcode = '55000';
  end if;

  perform private.auditar(
    'aprobar_listing', 'listing', p_id::text,
    jsonb_build_object('estado', 'pendiente'),
    jsonb_build_object('estado', 'activa'),
    v_motivo);

  return 'activa';
end;
$$;

revoke execute on function admin.aprobar_listing(bigint, text) from public, anon;
grant  execute on function admin.aprobar_listing(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Fotos de una `bloqueada`: el dueño deja de verlas y de escribirlas (D5)
-- ---------------------------------------------------------------------------
--
-- MEDIDO en local (2026-10-07, como authenticated, en begin … rollback) antes
-- de escribir esto, con el dueño ACTIVO de una `bloqueada`:
--   · hoy el dueño ve, inserta, reordena y borra las filas de `listing_photos`
--     de su bloqueada (las policies de escritura no miran `estado`), y en el
--     bucket puede subir objetos nuevos a `{id}/`;
--   · con solo el SELECT nuevo, un DELETE/UPDATE con WHERE afecta 0 filas
--     (Postgres aplica también la policy de SELECT a las filas que filtra),
--     pero un INSERT sigue pasando, y un DELETE sin WHERE sobre la tabla
--     también. Por eso la condición va en LAS CUATRO policies de cada lado.
--
-- `l.estado <> 'bloqueada'` va DENTRO del `exists`, junto a la condición de
-- dueño. En la de SELECT es PORTANTE, a diferencia del `<> 'pausada'`
-- redundante que documenta 20260908000446: `listings_select` le muestra al
-- dueño todas las suyas, bloqueadas incluidas.
--
-- El admin sigue viendo los objetos por `listing_photos_objects_select_admin`
-- (20260930000479); la tabla no la lee directo (`admin.detalle_listing` es
-- definer). `moderar-contenido` y `eliminar-cuenta` usan service_role.
--
-- Drop + create de cada policy en la misma migración: no hay ventana.

-- 4a. storage.objects (bucket listing-photos)

drop policy listing_photos_objects_select on storage.objects;
create policy listing_photos_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'listing-photos'
    and exists (
      select 1 from public.listings l
      where l.id = private.listing_id_from_object_name(name)
        and l.estado <> 'bloqueada'
        and (l.estado <> 'pausada' or l.user_id = (select auth.uid()))
    )
  );

drop policy listing_photos_objects_insert_own on storage.objects;
create policy listing_photos_objects_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'listing-photos'
    and exists (
      select 1 from public.listings l
      where l.id = private.listing_id_from_object_name(name)
        and l.user_id = (select auth.uid())
        and l.estado <> 'bloqueada'
    )
    and (select private.is_active_user())
  );

drop policy listing_photos_objects_update_own on storage.objects;
create policy listing_photos_objects_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'listing-photos'
    and exists (
      select 1 from public.listings l
      where l.id = private.listing_id_from_object_name(name)
        and l.user_id = (select auth.uid())
        and l.estado <> 'bloqueada'
    )
    and (select private.is_active_user())
  )
  with check (
    bucket_id = 'listing-photos'
    and exists (
      select 1 from public.listings l
      where l.id = private.listing_id_from_object_name(name)
        and l.user_id = (select auth.uid())
        and l.estado <> 'bloqueada'
    )
    and (select private.is_active_user())
  );

drop policy listing_photos_objects_delete_own on storage.objects;
create policy listing_photos_objects_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'listing-photos'
    and exists (
      select 1 from public.listings l
      where l.id = private.listing_id_from_object_name(name)
        and l.user_id = (select auth.uid())
        and l.estado <> 'bloqueada'
    )
    and (select private.is_active_user())
  );

-- 4b. public.listing_photos (la tabla). Espejo de las de arriba: sin esto, la
-- app pediría objetos que dan 400 (plan §6).

drop policy listing_photos_select on public.listing_photos;
create policy listing_photos_select on public.listing_photos
  for select to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id
                   and l.estado <> 'bloqueada'
                   and (l.estado <> 'pausada' or l.user_id = (select auth.uid()))));

drop policy listing_photos_insert_own on public.listing_photos;
create policy listing_photos_insert_own on public.listing_photos
  for insert to authenticated
  with check (exists (select 1 from public.listings l
                      where l.id = listing_id and l.user_id = (select auth.uid())
                        and l.estado <> 'bloqueada')
              and (select private.is_active_user()));

drop policy listing_photos_update_own on public.listing_photos;
create policy listing_photos_update_own on public.listing_photos
  for update to authenticated
  using      (exists (select 1 from public.listings l
                      where l.id = listing_id and l.user_id = (select auth.uid())
                        and l.estado <> 'bloqueada')
              and (select private.is_active_user()))
  with check (exists (select 1 from public.listings l
                      where l.id = listing_id and l.user_id = (select auth.uid())
                        and l.estado <> 'bloqueada')
              and (select private.is_active_user()));

drop policy listing_photos_delete_own on public.listing_photos;
create policy listing_photos_delete_own on public.listing_photos
  for delete to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.user_id = (select auth.uid())
                   and l.estado <> 'bloqueada')
         and (select private.is_active_user()));
