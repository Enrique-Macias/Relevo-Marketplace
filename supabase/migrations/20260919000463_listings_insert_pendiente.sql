-- Relevo — toda publicación de cliente NACE en `pendiente` (RF-18, Ola 3).
--
-- Es la mitad de base del rework de `src/lib/publicar.ts`, y las dos mitades
-- VAN EN EL MISMO CAMBIO. Por separado, cualquiera de las dos rompe publicar:
--
--   · Esta sola: `publicar.ts:307` sigue creando en 'pausada' → 42501, y el alta
--     muere en el insert.
--   · El cliente solo: nada obliga a pasar por revisión, que es justo el hueco
--     que 20260917000459 dejó abierto a propósito y documentó en su bloque final
--     ("LO QUE ESTA MIGRACIÓN NO CIERRA").
--
-- Y hay una regresión más sutil esperando, ya armada desde 20260917000459: esa
-- migración metió `pendiente`/`bloqueada` en el `not in` del `using` de
-- `listings_update_own`, así que en el instante en que la fila nazca `pendiente`
-- el `cambiarEstadoListing(id, 'activa')` de `publicar.ts:366` afecta 0 filas
-- SIN LANZAR → ListingNoEditableError → el usuario ve "no pudimos guardar los
-- cambios, puede ser tu conexión" con un "Reintentar" que no va a funcionar
-- nunca. Por eso ese paso se BORRA del cliente en el mismo cambio y lo reemplaza
-- la llamada a la Edge Function `moderar-contenido`.
--
-- ===========================================================================
-- QUÉ CIERRA, MEDIDO ANTES DE TOCAR NADA (20260917000459:139-155)
-- ===========================================================================
-- El `with check` viejo era solo `user_id = auth.uid() and is_active_user()`, y
-- el INSERT de `listings` está concedido A NIVEL TABLA (20260906000439:86), así
-- que cubre la columna `estado`. Un autenticado cualquiera creaba su propia fila
-- directamente en los CINCO valores del enum —incluidos `activa`, `vendida` y
-- `bloqueada`— y si omitía la columna caía en el default 'activa'. O sea que el
-- camino "publicar sin pasar por revisión" seguía abierto por el INSERT aunque
-- el UPDATE ya estuviera cerrado.
--
-- Con esto, la transición `pendiente → activa` pasa a ser EXCLUSIVA de código
-- elevado: la Edge Function con `supabaseAdmin`. El cliente no puede ni crearla
-- activa (este with_check) ni promoverla después (el using de ...459).
--
-- ===========================================================================
-- EL DEFAULT DE LA COLUMNA **NO** SE VOLTEA, y es decisión, no olvido
-- ===========================================================================
-- Sigue siendo `'activa'`. El with_check solo ata a `authenticated`, y las
-- fixtures que siembran estados arbitrarios corren todas por fuera de RLS:
-- `supabase/tests/rls.sql` como `postgres`, y los cuatro `scripts/probe-*.mjs`
-- con la secret key (ver el comentario de probe-storage.mjs:143-144). Voltearlo
-- obligaría a reescribir esos bloques sin comprar nada — es la misma deuda
-- hermana que `publicar-fotos.md` ya documenta para el insert directo con
-- `estado='activa'` y 0 fotos.
--
-- CONSECUENCIA QUE SÍ HAY QUE SABER: como el default no cambia, un INSERT de
-- cliente que OMITA `estado` ahora es RECHAZADO (cae en 'activa'). Es correcto
-- —`crearListing()` siempre lo manda explícito desde 20260906000439— pero es el
-- caso sigiloso, y por eso T25 (c) lo prueba por separado de T25 (b).
--
-- ===========================================================================
-- EL RECHAZO SÍ LANZA, al revés que los dos precedentes que más se le parecen
-- ===========================================================================
-- `listings_update_own` y `listing_sales_update_seller` filtran en silencio
-- porque su condición vive en un `using` de UPDATE. Aquí es un `with check` de
-- INSERT, que ABORTA con 42501 (mismo caso que `reports_insert_own`,
-- 20260914000455). Por eso `crearListing()` no necesita `{count:'exact'}` ni un
-- error propio: le llega la excepción y `publicarListing` la propaga tal cual,
-- que es lo correcto — ahí todavía no se tocó Storage y no hay nada que limpiar.
--
-- DROP + CREATE y no `alter policy`, por el criterio de 20260913000454:51 y
-- 20260914000455:73: el `alter` mostraría en el diff solo la mitad que cambió y
-- dejaría la otra mitad invisible. Las dos cláusulas viejas se transcriben
-- idénticas, incluida la forma envuelta `(select auth.uid())` — que no es un
-- cambio de estilo introducido aquí, ya era la del original (es la optimización
-- de initplan de Supabase).

drop policy if exists listings_insert_own on public.listings;

create policy listings_insert_own on public.listings
  for insert to authenticated
  with check (user_id = (select auth.uid())
              and (select private.is_active_user())
              and estado = 'pendiente');
