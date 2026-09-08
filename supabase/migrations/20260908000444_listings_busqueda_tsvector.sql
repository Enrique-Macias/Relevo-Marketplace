-- Relevo — búsqueda de texto por tsvector (RF-10, RNF-01).
--
-- POR QUÉ UNA COLUMNA Y NO EL ÍNDICE DE EXPRESIÓN QUE YA EXISTÍA:
-- listings_busqueda_idx (migración 20260906000439) indexa la expresión
-- to_tsvector('spanish', titulo || ' ' || coalesce(descripcion,'')). El planner
-- solo usa un índice de expresión cuando la consulta REPITE esa expresión, y
-- PostgREST no sabe generarla: `titulo=fts(spanish).x` produce
-- to_tsvector('spanish', titulo), que no machea. Resultado: el índice se pagaba
-- en cada escritura y no lo usaba nadie, y toda búsqueda era seq scan con ilike.
-- Materializando la misma expresión en una columna, PostgREST sí puede
-- filtrarla (`busqueda=wfts(spanish).…`) y el índice por fin sirve.
--
-- DE PASO ARREGLA LOS ACENTOS: el diccionario snowball español reduce
-- 'Cálculo' y 'calculo' al mismo lexema 'calcul'. Con ilike, buscar "calculo"
-- devolvía 0 resultados sobre "Cálculo de Larson" — un bug de producto, porque
-- así es como se teclea en un teléfono. No hace falta la extensión `unaccent`.
--
-- NOTA DE ESCALA (no es acción de hoy): el `alter table` reescribe la tabla y
-- el `create index` toma un lock de escritura. Con las decenas de filas de hoy
-- es instantáneo; con volumen real habría que partirlo en `add column` +
-- `create index concurrently` fuera de transacción.

alter table public.listings
  add column busqueda tsvector
  generated always as (
    to_tsvector('spanish', titulo || ' ' || coalesce(descripcion, ''))
  ) stored;

-- El viejo queda inservible por lo explicado arriba: se reemplaza conservando
-- el nombre, que sigue describiendo bien lo que hace.
drop index public.listings_busqueda_idx;

create index listings_busqueda_idx on public.listings using gin (busqueda);

-- SIN GRANT NUEVO, Y NO ES UN OLVIDO: a diferencia de `update`, que en esta
-- tabla sí está acotado por columna, `select` se otorgó a nivel tabla
-- (migración 20260906000439), y en Postgres un grant de tabla cubre las
-- columnas que se agreguen después. Filtrar por una columna exige privilegio
-- de SELECT sobre ella, así que ese grant heredado es justo lo que hace que la
-- búsqueda funcione. La suite de RLS lo vigila (T13): si alguien "endurece" ese
-- grant a una lista explícita de columnas, la búsqueda se rompe con 42501 y la
-- prueba lo caza en vez de que aparezca como "no encuentra nada" en la app.
--
-- Tampoco hace falta excluirla de escritura: Postgres rechaza por sí mismo
-- cualquier insert/update sobre una columna generada, sin importar los grants.
