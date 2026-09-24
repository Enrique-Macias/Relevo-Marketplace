-- Relevo — búsqueda por PREFIJO en el último término (RF-10).
--
-- Hasta aquí el cliente mandaba `.textSearch('busqueda', q, {type:'websearch'})`,
-- y `websearch_to_tsquery` no admite prefijos: teclear "calc" no encontraba
-- "Cálculo" y "calcul" sí. Esta función arma la tsquery con `:*` en el ÚLTIMO
-- término y deja todo lo demás como estaba: los términos anteriores siguen
-- pasando por `websearch_to_tsquery`, la columna `busqueda` y su índice no se
-- tocan, y los filtros/alcance/orden/cursor los sigue encadenando el cliente
-- sobre el resultado (`.rpc('buscar_listings').select(...)`).
--
-- SECURITY INVOKER, Y NO ES UN DETALLE: la función devuelve filas de
-- `listings`, así que como definer saltaría `listings_select` y le entregaría
-- a cualquiera las publicaciones pausadas/pendientes/bloqueadas ajenas que
-- coincidan con el texto. Invoker = la RLS del que llama aplica igual que en
-- un `from('listings')`. Lo vigila T30 (h) con su control negativo.
--
-- SIN `set search_path`, Y TAMPOCO ES UN DESCUIDO: es la excepción al estilo
-- del repo, y la razón es el inlining. Postgres solo inlinea una función SQL
-- que devuelve un set si no tiene cláusulas SET (entre otras condiciones:
-- `language sql`, no definer, no volatile, un solo SELECT). Inlineada, el
-- planner ve `busqueda @@ <tsquery>` junto a los filtros del cliente como una
-- sola consulta; sin inlinear sería un Function Scan opaco que materializa
-- TODAS las coincidencias antes de filtrar por campus u ordenar. A cambio,
-- todo va calificado por esquema (`public.`, `pg_catalog.`). T30 (i) vigila
-- `proconfig is null`.
--
-- EL GIN NO SE USA COMO `authenticated`, NI AQUÍ NI EN LA BÚSQUEDA DE ANTES:
-- el `@@` (ts_match_vq) no es LEAKPROOF, así que Postgres está obligado a
-- evaluarlo DESPUÉS de la qual de `listings_select` y el plan es Seq Scan.
-- Medido con 80 000 filas como authenticated: 8.4 ms la búsqueda de antes y
-- 8.2 ms esta función, las dos Seq Scan; como `postgres` (bypassrls) las dos
-- usan Bitmap Index Scan (1.1 / 1.2 ms). `postgres` no es
-- superusuario y no puede declarar nada leakproof. Deuda con disparador en
-- `.claude/rules/explorar.md`; gotcha general en CLAUDE.md §9.
--
-- NUNCA LANZA, POR CONSTRUCCIÓN: el texto del usuario nunca se concatena a
-- sintaxis de tsquery. Todo lo crudo pasa por `websearch_to_tsquery` o
-- `to_tsvector`, que no lanzan con ninguna entrada; `to_tsquery` solo recibe
-- un LEXEMA ya normalizado que pasó `^[[:alnum:]]+$`, más el sufijo `:*`.
-- T30 (j) lo fuzzea.
--
-- Reglas del último término (`tail` = lo que sigue al último espacio):
--  · Se busca como antes (websearch completo, sin prefijo) si hay comillas,
--    si el tail es una negación (`-x`) o un `or`, si el head termina en `or`
--    o `-`, o si el tail da más de un lexema (`wi-fi`): son sintaxis de
--    websearch que el prefijo no debe reinterpretar.
--  · Un lexema alfanumérico de 3+ letras va con prefijo. Menos de 3 letras,
--    como palabra completa: con 2 letras el prefijo casa con demasiado
--    (medido sobre el catálogo real: 10 de 110 prefijos de 2 letras casan con
--    más del 10 % de las publicaciones; de 3 letras, 1 de 196).
--  · Una stopword de 3+ letras (`con`, `este`, `como`) es también el inicio de
--    palabras reales (consola, estetoscopio, cómoda), así que va como prefijo
--    SIN stemming (config simple, sin acentos: los lexemas guardados no los
--    tienen). Si ni así da un lexema usable (stopword corta, emoji,
--    puntuación), el término cuenta como ausente: la tsquery es solo la del
--    head, y si esa es vacía no casa con nada — nunca el catálogo entero.
--  · Límite conocido (deuda en explorar.md): si lo tecleado rebasa la raíz
--    que guardó el stemmer (`universi` → 'universi' contra 'univers'), el
--    prefijo no casa hasta completar la palabra.

create function public.buscar_listings(q text)
returns setof public.listings
language sql
stable
security invoker
as $$
  select l.*
  from public.listings l
  where l.busqueda @@ (
    with entrada as (
      select pg_catalog.btrim(coalesce(q, '')) as q
    ),
    partes as (
      select e.q,
             pg_catalog.substring(e.q, '(\S+)$') as tail,
             pg_catalog.regexp_replace(e.q, '\S+$', '') as head
      from entrada e
    ),
    lexemas as materialized (
      select p.q, p.tail, p.head,
             (select pg_catalog.array_agg(t.lexeme order by t.positions[1])
                from pg_catalog.unnest(pg_catalog.to_tsvector('pg_catalog.spanish', coalesce(p.tail, ''))) t)
               as lexs,
             (select pg_catalog.array_agg(t.lexeme)
                from pg_catalog.unnest(pg_catalog.to_tsvector('pg_catalog.simple',
                       pg_catalog.translate(pg_catalog.lower(coalesce(p.tail, '')), 'áéíóú', 'aeiou'))) t)
               as lexs_simple
      from partes p
    )
    select case
      when x.q ~ '"'
        or x.tail is null
        or x.tail ~ '^-'
        or pg_catalog.lower(x.tail) = 'or'
        or x.head ~* '(^|\s)(or|-)\s*$'
        or coalesce(pg_catalog.array_length(x.lexs, 1), 0) > 1
        then pg_catalog.websearch_to_tsquery('pg_catalog.spanish', x.q)
      when coalesce(pg_catalog.array_length(x.lexs, 1), 0) = 1 then
        case when x.lexs[1] ~ '^[[:alnum:]]+$' and pg_catalog.length(x.lexs[1]) >= 3
          then pg_catalog.websearch_to_tsquery('pg_catalog.spanish', x.head)
               && pg_catalog.to_tsquery('pg_catalog.simple', x.lexs[1] || ':*')
          else pg_catalog.websearch_to_tsquery('pg_catalog.spanish', x.q)
        end
      -- El tail no dio lexemas en spanish: stopword o basura.
      when coalesce(pg_catalog.array_length(x.lexs_simple, 1), 0) = 1
        and x.lexs_simple[1] ~ '^[[:alnum:]]+$'
        and pg_catalog.length(x.lexs_simple[1]) >= 3
        then pg_catalog.websearch_to_tsquery('pg_catalog.spanish', x.head)
             && pg_catalog.to_tsquery('pg_catalog.simple', x.lexs_simple[1] || ':*')
      else pg_catalog.websearch_to_tsquery('pg_catalog.spanish', x.head)
    end
    from lexemas x
  )
$$;

-- `revoke all` primero, como todo grant del proyecto: `pg_default_acl` le da
-- EXECUTE a `public` (y con él a anon) sobre cada función nueva, y un grant
-- es aditivo (CLAUDE.md §9). Anon no gana nada: el proyecto no le concede ni
-- un privilegio, y el catálogo no se ve sin sesión.
revoke all on function public.buscar_listings(text) from public, anon, authenticated;
grant execute on function public.buscar_listings(text) to authenticated;
