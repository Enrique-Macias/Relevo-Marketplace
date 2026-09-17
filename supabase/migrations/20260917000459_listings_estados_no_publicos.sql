-- Relevo — `pendiente` y `bloqueada` no son públicos ni los puede levantar su
-- dueño. Tres cambios que van juntos porque son la MISMA regla en los tres
-- motores que gobiernan una publicación: quién la LEE (policy de select), quién
-- la ESCRIBE (policy de update) y qué la cuenta (una RPC que esquiva la RLS).
-- Separarlos en tres migraciones dejaría ventanas en las que la regla existe a
-- medias, y la de la RPC ni siquiera se notaría.
--
-- Depende de 20260917000458, que agrega los dos valores al enum. Ver ahí por qué
-- no cabe en este archivo.
--
-- ===========================================================================
-- (1) LECTURA — listings_select
-- ===========================================================================
-- La policy vieja excluía EXACTAMENTE UN valor (`estado <> 'pausada'`), o sea
-- que todo valor nuevo del enum nace público. Medido antes de tocar nada, con
-- una publicación de cada estado y un autenticado que NO es el dueño:
--
--   activa 1 | pausada 0 | vendida 1 | pendiente 1 | bloqueada 1
--
-- Una publicación bloqueada por moderación se servía igual que una activa. El
-- feed no la habría mostrado —filtra estado='activa' desde el cliente— pero eso
-- es filtrado de presentación, no autorización: /detalle/[id] por deep link, la
-- búsqueda y cualquier GET a PostgREST la devolvían.
--
-- `not in` y no una cadena de `<>`: la lista es la definición de "no público" y
-- se lee de un golpe. Es seguro aquí porque `estado` es NOT NULL — la trampa de
-- `not in` es el NULL del lado derecho, y esta lista es literal. (Hermano del
-- caso de 20260914000455, donde `<>` contra un subselect NULL rompía una rama
-- entera en silencio; aquí el riesgo no existe, pero el reflejo es el mismo.)
--
-- DROP + CREATE y no `alter policy … using (…)`, por el criterio que ya
-- documentan 20260913000454:51 y 20260914000455:73: el `alter` mostraría en el
-- diff solo la mitad que cambió y dejaría la otra mitad invisible.
--
-- El DUEÑO sí las sigue viendo, igual que con `pausada`. Es deliberado: si no,
-- "Mis publicaciones" le mentiría sobre su propio catálogo — el mismo argumento
-- por el que suspender PAUSA las publicaciones en vez de esconderlas
-- (20260917000457). Que la UI todavía no distinga "pausada por mí" de
-- "bloqueada por moderación" es un frame pendiente (CLAUDE.md §0 regla 4), no
-- un hueco de esta migración.

drop policy if exists listings_select on public.listings;

create policy listings_select on public.listings
  for select to authenticated
  using (estado not in ('pausada', 'pendiente', 'bloqueada')
         or user_id = (select auth.uid()));

-- Las fotos se cierran SOLAS con esto, y está medido por las dos vías, no
-- deducido por analogía:
--   · public.listing_photos (policy listing_photos_select, 20260906000439:139):
--     por SQL, las filas visibles para un ajeno pasaron de 1 a 0.
--   · storage.objects (policy listing_photos_objects_select, 20260908000446:100):
--     por HTTP contra el servicio de Storage, con
--     GET /object/authenticated/listing-photos/<ruta>, un ajeno pasó de
--     HTTP 200 a HTTP 400 en `pendiente` y `bloqueada`, sin tocar esa policy.
-- Las dos cuelgan de un `exists` sobre public.listings, y las expresiones de
-- policy se evalúan como el rol invocante, así que heredan lo de arriba. El
-- `l.estado <> 'pausada'` que ambas llevan inline sigue siendo redundante — y
-- sigue sin ser el candado, exactamente como ya advierte 20260908000446:95.

-- ===========================================================================
-- (2) ESCRITURA — listings_update_own
-- ===========================================================================
-- Sin esto, el dueño se auto-aprueba. Medido con la policy vieja, dueño activo
-- pidiendo `set estado = 'activa'` sobre una fila de cada estado:
--
--   activa->pausada 1 | pausada->activa 1 | vendida->activa 0
--   pendiente->activa 1  <-- se salta la revisión entera
--   bloqueada->activa 1  <-- deshace la moderación
--
-- Con la lista de abajo, las tres últimas quedan en 0 y las dos primeras siguen
-- en 1 (pausar y reactivar son el flujo normal y NO se tocan).
--
-- Las filas de la matriz llevan foto sembrada a propósito. Sin ella, el intento
-- de reactivar muere en `listings_enforce_activation_has_photos` con una
-- excepción del trigger y la medición no probaría lo que dice — es la misma
-- trampa que documentan T20 (d) y T23 (f).
--
-- Va en el `using` y NO en el `with check`, por el motivo de 20260913000454: el
-- `using` se evalúa contra la fila VIEJA, así que prohíbe tocar una fila que YA
-- está en uno de esos estados, sin prohibir la transición HACIA ellos — que es
-- justo lo que tiene que poder hacer la moderación. En el `with check`
-- bloquearía el marcado mismo, que es lo contrario.
--
-- `not in ('vendida', 'pendiente', 'bloqueada')` en vez de tres `<>` encadenados:
-- los tres son "estados en los que el dueño ya no manda", y como lista se ve que
-- son un grupo. `vendida` entra aquí sin cambiar de significado — es exactamente
-- la condición que ya tenía, reescrita.
--
-- EL RECHAZO NO LANZA, igual que antes: el `using` filtra y el update afecta 0
-- filas sin error. `cambiarEstadoListing` y `actualizarListing` ya piden
-- {count:'exact'} y lanzan ListingNoEditableError, así que esto no las cambia —
-- pero AHORA ese 0 tiene CUATRO causas (vendida, pendiente, bloqueada, o el
-- usuario suspendido) en vez de dos, y el copy neutro que ya usan sigue siendo
-- el correcto. Si algún día se quiere distinguirlas, el dato tiene que salir de
-- una lectura aparte, no de este 0.

drop policy if exists listings_update_own on public.listings;

create policy listings_update_own on public.listings
  for update to authenticated
  using      (user_id = (select auth.uid())
              and (select private.is_active_user())
              and estado not in ('vendida', 'pendiente', 'bloqueada'))
  with check (user_id = (select auth.uid()));

-- ===========================================================================
-- (3) VISTAS — public.increment_listing_view
-- ===========================================================================
-- Esta NO se arregla sola con (1), y es la única de las cuatro que no. Es
-- SECURITY DEFINER sobre una tabla sin `force row level security`, así que
-- bypasea RLS: su `estado <> 'pausada'` es un candado propio, no un reflejo del
-- de la policy. Medido — con listings_select YA corregida, un ajeno llamó la RPC
-- sobre una publicación `bloqueada` y `vistas_count` subió de 1 a 2.
--
-- `create or replace` y no `drop` + `create`: conserva el OID y, sobre todo, los
-- grants. Un `drop` se llevaría el `revoke execute … from public, anon` y el
-- `grant execute … to authenticated` de 20260906000442:20-21, y habría que
-- reponerlos — el mismo motivo por el que `can_rate()` se rehízo con replace en
-- 20260912000453.
--
-- Se restata el cuerpo COMPLETO, incluidos `security definer` y
-- `set search_path = ''`: `create or replace` no hereda lo que no se repite.

create or replace function public.increment_listing_view(p_listing_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.listings
     set vistas_count = vistas_count + 1
   where id = p_listing_id
     and estado not in ('pausada', 'pendiente', 'bloqueada')
     and user_id is distinct from (select auth.uid());   -- el dueño no infla sus vistas
$$;

-- ===========================================================================
-- LO QUE ESTA MIGRACIÓN NO CIERRA, a propósito y medido
-- ===========================================================================
-- `listings_insert_own` NO restringe `estado`: su with_check es solo
-- `user_id = auth.uid() and is_active_user()`, y el INSERT de `listings` está
-- concedido a nivel TABLA, así que cubre la columna. Medido, un autenticado
-- cualquiera crea su propia fila directamente en los CINCO estados —incluidos
-- `vendida` y `bloqueada`— y si omite la columna cae en el default 'activa'.
-- O sea que el camino "publicar sin pasar por revisión" sigue abierto por el
-- INSERT aunque el UPDATE ya esté cerrado.
--
-- No se cierra aquí porque NO es un cambio de una línea: forzar
-- `estado = 'pendiente'` en el with_check choca de frente con el alta atómica
-- (src/lib/publicar.ts:307 crea en 'pausada' y :366 la pasa a 'activa' cuando
-- las fotos subieron), y con (2) de este archivo esa segunda mitad dejaría de
-- ser del cliente. Es rediseño de flujo, no endurecimiento. Ver el diagnóstico
-- completo antes de tocarlo.
