-- Relevo — no se puede reportar la publicación propia. RF-14.
--
-- Qué lo motivó: al construir la hoja "Reportar publicación" (el último frame
-- del grupo Confianza) apareció que la base no impide que el dueño de un
-- listing lo reporte como PUBLICACIÓN. El autorreporte de USUARIO sí estaba
-- cerrado desde el principio, con un check de tabla
-- (20260906000441:22, `reported_user_id is null or reported_user_id <> reporter_id`),
-- pero su hermano de listings nunca existió — probablemente porque `reports`
-- nació antes de que hubiera una UI que reportara publicaciones.
--
-- Hoy no es alcanzable desde la app (el ícono de bandera de Detalle solo se
-- pinta cuando `isOwner` es false, src/app/(explorar)/detalle/[id].tsx:366-376),
-- pero la ruta `/reportar/[id]` sí lo es por deep link, y el Data API todavía
-- más directo. Va en la policy y no en un `if` del cliente por CLAUDE.md §0
-- regla 7: si la regla se puede expresar como policy, va en la base. El guard
-- equivalente del cliente existe, pero es solo para no hacerle llenar un
-- formulario condenado a alguien — no es el candado.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ UN `not exists` Y NO UN CHECK DE TABLA, que es lo que hizo su hermano
-- ---------------------------------------------------------------------------
-- El check de `reported_user_id` puede vivir en la tabla porque compara dos
-- columnas de la MISMA fila. Aquí el dueño está en otra tabla (`listings`), y un
-- check con subconsulta no es legal en Postgres. Tampoco sirve un trigger: la
-- regla es de autorización (quién puede insertar qué), que es justo lo que una
-- policy expresa, y un trigger además alcanzaría a `service_role`, cerrándole la
-- puerta a Studio — donde vive la moderación de RF-17. Es el mismo razonamiento
-- que 20260913000454 para `vendida`.
--
-- Tampoco se usa un helper en `private`: es un predicado plano sobre una tabla,
-- sin nada que bypasear, y meter una función SECURITY DEFINER dentro de una
-- policy es la condición (1) del SIGSEGV de supabase/KNOWN_ISSUES.md.
--
-- ---------------------------------------------------------------------------
-- EL SUBSELECT SE EVALÚA BAJO LA RLS DEL INVOCANTE, Y AUN ASÍ ES CORRECTO
-- ---------------------------------------------------------------------------
-- Las expresiones de una policy corren como el rol invocante, así que ese
-- `select` sobre `public.listings` viene filtrado por `listings_select`. No
-- produce ningún falso negativo, y conviene ver por qué antes de "endurecerlo"
-- con un SECURITY DEFINER:
--
--   · Si el listing es MÍO, `listings_select` siempre me lo muestra —activo o
--     pausado, esa es justo su excepción para el dueño— así que el `exists` da
--     true y el insert se rechaza. Que es lo que se busca.
--   · Si el listing es de OTRA persona, la fila podría estar invisible para mí
--     (pausada), pero el `exists` daría false igual: su condición exige
--     `l.user_id = reporter_id`, y yo no soy el dueño. La invisibilidad no
--     cambia el resultado, solo lo alcanza por otro camino.
--
-- O sea que el único caso en el que el `exists` puede ser verdadero es también
-- el único en el que la fila está garantizadamente visible.
--
-- ---------------------------------------------------------------------------
-- POR QUÉ `not exists` Y NO EL `<>` CONTRA EL SUBSELECT, QUE ES MÁS CORTO
-- ---------------------------------------------------------------------------
-- La reescritura que primero da ganas de hacer es
--
--     and reporter_id <> (select l.user_id from public.listings l
--                         where l.id = listing_id)
--
-- y está MAL, aunque se lea igual: esta tabla también acepta reportes de USUARIO,
-- donde `listing_id` va en NULL. Ahí el subselect no devuelve fila, el escalar es
-- NULL, `reporter_id <> NULL` es NULL — y un `with check` que evalúa a NULL
-- RECHAZA. O sea que esa versión cierra el autorreporte de publicación y de paso
-- rompe, en silencio, el reporte de usuario entero. Con `not exists`, el caso
-- `listing_id is null` no machea ninguna fila y la cláusula da true, que es lo
-- correcto. Lo vigila T21(c), y esa aserción existe justamente porque esta
-- variante pasaba las otras dos.
--
-- ---------------------------------------------------------------------------
-- DROP + CREATE, el precedente de 20260913000454
-- ---------------------------------------------------------------------------
-- Mismo criterio que aquella migración documenta: `alter policy … with check (…)`
-- también funcionaría, pero deja al lector con la mitad de la policy y la otra
-- mitad cuatro migraciones atrás. Drop+create la restituye completa.
--
-- Las otras TRES cláusulas se transcriben IDÉNTICAS a 20260906000441:77-79,
-- incluida la forma envuelta `(select auth.uid())` / `(select private.…())`,
-- que es la de todo el repo (11 migraciones) y la optimización conocida de
-- Supabase: el select se evalúa como initplan una vez, no por fila. El cambio
-- semántico de esta migración es UNA sola cláusula, la última.

drop policy if exists reports_insert_own on public.reports;

create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid())
              and (select private.is_active_user())
              and num_nonnulls(listing_id, reported_user_id) = 1
              and not exists (select 1 from public.listings l
                              where l.id = listing_id
                                and l.user_id = reporter_id));
