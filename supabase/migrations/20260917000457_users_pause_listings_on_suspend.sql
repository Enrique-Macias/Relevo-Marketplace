-- ===========================================================================
-- Suspender una cuenta pausa TODAS sus publicaciones activas (RF-17).
--
-- POR QUÉ EXISTE: desde `20260911000449`, `seller_whatsapp()` deja fuera del
-- contacto a las cuentas suspendidas en las dos direcciones — pero
-- `listings_select` no mira el estado del DUEÑO (solo esconde las `pausada` a
-- quien no es su dueño), así que el catálogo seguía mostrando publicaciones que
-- nadie podía contactar: el comprador tocaba "Contactar por WhatsApp" y recibía
-- "Esta cuenta no está disponible para contacto" sin haber podido saberlo
-- antes. Era el callejón que `docs/product-spec.md` y
-- `.claude/rules/cuenta-perfil.md` dejaron anotado como pendiente de producto.
--
-- TABLA DE DECISIÓN (explícita, mismo criterio que el resto de las reglas de
-- suspensión en CLAUDE.md §3 — nada de esto es implícito):
--
--   · El pausado es AUTOMÁTICO y en la misma transacción que la suspensión, no
--     una revisión manual posterior.
--   · Se dispara sin importar CÓMO se escriba `estado`: hoy es edición de celda
--     en Studio, mañana puede ser la plataforma de admin de RF-17. Por eso vive
--     en la tabla y no en un camino de escritura concreto.
--   · Al REACTIVAR (suspendido → activo) las publicaciones NO se despausan
--     solas: el vendedor las reactiva a mano desde "Mis publicaciones", que ya
--     exige al menos una foto (`listings_enforce_activation_has_photos`). Cero
--     código de cliente nuevo para esto, y el `when` de abajo es lo que lo hace
--     cumplir.
--   · NO se distingue en la UI "pausada por suspensión" de "pausada por el
--     usuario": es el mismo estado `pausada`, sin diferenciar. Ese distingo
--     exigiría frame nuevo (§0 regla 4) y casi seguro una columna, y no hace
--     falta para cerrar esto.
--   · NO se le notifica al vendedor: no existe un `notification_type` para eso
--     ni una fila en el diseño, así que sería inventar copy — frame primero.
--
-- POR QUÉ SÍ UN TRIGGER, cuando el precedente más parecido lo descartó: para
-- "vendida es terminal" (`20260913000454`) se decidió DELIBERADAMENTE no usar
-- uno, porque un trigger alcanza también a `service_role` y eso habría cerrado
-- Studio, que es la única vía para arreglar una venta marcada por error. Aquí
-- esa misma propiedad juega al revés y es justo la que se necesita: `estado` no
-- está en el `grant update` de `authenticated` (`20260906000438:110`), así que
-- la ÚNICA vía por la que hoy alguien se suspende ES `service_role`/Studio. Un
-- mecanismo que no lo alcanzara no se dispararía nunca.
--
-- Tampoco puede ser una policy: `listings_select` tendría que mirar el estado
-- del dueño (un join por fila en el camino caliente del feed) y, sobre todo, la
-- publicación seguiría `activa` en la base — "Mis publicaciones" le seguiría
-- mintiendo al vendedor sobre en qué estado está su catálogo.
-- ===========================================================================

-- SECURITY DEFINER, y la decisión no es por simetría con las otras diez. El
-- criterio del repo está escrito textual en `20260906000439:31` —"updated_at: no
-- lee ni escribe otras filas, así que corre como invoker"—: `set_updated_at()`
-- es la única función de `private` que NO es definer, y lo es por eso. Esta
-- escribe otras filas, y de otra tabla.
--
-- Dicho sin adornos: HOY `invoker` alcanzaría, porque el único rol que puede
-- escribir `estado` es `service_role`/`postgres` y los dos tienen `bypassrls`.
-- Lo que compra `definer` es que la regla no dependa de eso. MEDIDO en local,
-- no deducido: con un rol de moderación con `grant update` sobre las dos tablas
-- pero SIN `bypassrls` —el escenario de RF-17 con plataforma propia—,
--
--     invoker  ->  filas afectadas = 0, la publicación sigue `activa`, SIN ERROR
--     definer  ->  filas afectadas = 1, la publicación queda `pausada`
--
-- O sea que el invoker no falla ruidosamente: `listings_update_own` filtra por
-- `user_id = auth.uid()` y el UPDATE se va en silencio, exactamente la familia
-- de fallos que CLAUDE.md §9 cataloga (`remove()` que devuelve `200 []`,
-- `ON CONFLICT DO NOTHING → INSERT 0 0`, el `using` de UPDATE que filtra en vez
-- de lanzar). En este repo, lo que no lanza es lo que hay que mirar dos veces.
--
-- Va en `private` y con EXECUTE revocado porque solo la dispara un trigger: no
-- la invoca ninguna policy, así que no necesita el grant que sí tienen
-- is_active_user(), can_rate() y listing_id_from_object_name().
create function private.pause_listings_on_suspend()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- ACOTADO A `activa`, y las dos mitades del where importan:
  --   · `user_id = new.id` — el radio es esta cuenta, no el catálogo entero.
  --   · `estado = 'activa'` — una `pausada` no se vuelve a tocar (ni se le mueve
  --     el `updated_at`, que `listings_set_updated_at` reescribiría en todo
  --     update) y una `vendida` es TERMINAL (`20260913000454`): pasarla a
  --     `pausada` aquí la resucitaría por la puerta de atrás, saltándose la
  --     policy que lo impide (este código corre elevado).
  update public.listings
     set estado = 'pausada'
   where user_id = new.id
     and estado = 'activa';

  return null;  -- AFTER trigger: el valor de retorno se ignora.
end;
$$;

revoke execute on function private.pause_listings_on_suspend()
  from public, anon, authenticated;

-- EL `when` ES LOAD-BEARING, no una optimización — misma lección que el de
-- `listings_enforce_activation_has_photos` (§3) y que T5. Sus dos mitades son
-- candados distintos y cada una tiene su propia aserción en T23:
--
--   · `old.estado is distinct from new.estado` — sin esto, el trigger se
--     dispararía en CADA guardado de "Editar perfil" (nombre, teléfono,
--     universidad, avatar) de una cuenta ya suspendida, que es una ruta que un
--     suspendido SÍ conserva abierta. Lo vigila T23 (e).
--   · `new.estado = 'suspendido'` — sin esto, reactivar la cuenta volvería a
--     pausar, que es lo contrario de la decisión de arriba. Lo vigila T23 (f).
--
-- Y sin el `when` ENTERO el radio es mucho peor que "se ejecuta de más": la
-- función correría en todo update de `users` sin mirar el estado de nadie, así
-- que editar el nombre de cualquier usuario activo pausaría su catálogo.
create trigger users_pause_listings_on_suspend
  after update on public.users
  for each row
  when (old.estado is distinct from new.estado and new.estado = 'suspendido')
  execute function private.pause_listings_on_suspend();

-- SOLO CUBRE UPDATE, exactamente como el trigger de fotos de `20260909000447` y
-- por el mismo motivo: un `after update` no ve los inserts. MEDIDO, en sus dos
-- mitades, porque no pesan igual:
--   · insertar directo una fila de `users` con `estado = 'suspendido'` no lo
--     dispara — pero ese insert por sí solo es inofensivo: la fila es nueva, así
--     que todavía no puede tener publicaciones (`listings.user_id` es FK a
--     `users`; medido, 0).
--   · la mitad que sí tiene consecuencia es que nada vuelve a mirar DESPUÉS: una
--     publicación creada `activa` para una cuenta ya suspendida se queda
--     `activa` (medido; es justo la fixture con la que T23 hace observable (e)).
-- Solo alcanzable por service_role/Studio, porque `listings_insert_own` ya exige
-- `is_active_user()` — o sea que es un vector de calidad de dato de la
-- moderación, no de seguridad. Deuda consciente, mismo trato que su gemela: no se
-- cierra aquí. **Revisar cuando:** exista la plataforma de admin de RF-17, que es
-- donde alguien podría dar de alta publicaciones fuera del flujo de la app.
-- **Fix:** el mismo `when` sobre un `before insert` de `listings`, o un `check`
-- que niegue `estado = 'activa'` si el dueño no está activo.

-- SIN BACKFILL, a propósito. Medido contra remoto antes de escribir esto: las 6
-- cuentas existentes están las 6 en `activo`, así que un
-- `update ... where user_id in (select id from public.users where estado =
-- 'suspendido')` sería código muerto el día que se aplica. Si alguna vez hiciera
-- falta reconciliar, es ese mismo one-liner a mano desde Studio.
--
-- CONSECUENCIA DE SEGUNDO ORDEN que no se ve en el diff, y que sí conviene
-- saber: en remoto hay 26 publicaciones `activa` SIN una sola foto (filas
-- viejas, anteriores a que existiera la subida). Hoy nadie las valida, porque
-- `listings_enforce_activation_has_photos` solo mira la TRANSICIÓN hacia
-- `activa`. En cuanto una de ellas se pause por suspensión, su dueño no podrá
-- reactivarla sin subirle una foto primero. Es exactamente el estado que el
-- modelo atómico existe para imponer y tiene salida dentro de la app ("Editar
-- publicación"), así que no es deuda: es el efecto buscado, documentado para que
-- nadie lo lea como un bug.
