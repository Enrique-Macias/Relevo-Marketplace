-- Relevo — fase 2C: coordenadas de `campus`, para "Detectar campus más
-- cercano" (`selector-campus.tsx`). Nullable a propósito: un campus sin
-- coordenadas simplemente no participa en la detección de cercanía
-- (`src/lib/ubicacion.ts`, `campusMasCercano()` los filtra), no es un estado
-- inválido. Las coordenadas de producción se capturan a mano en Studio
-- (CLAUDE.md §8) — esta migración solo abre el campo.
alter table public.campus
  add column latitud  double precision,
  add column longitud double precision;

-- Tres checks: rango de cada coordenada, y que las dos vengan juntas o
-- ninguna. Sin el tercero, una fila con solo `latitud` sería indistinguible
-- de un dato a medio capturar, y `campusMasCercano()` tendría que decidir qué
-- hacer con eso — mejor que la base lo haga irrepresentable.
alter table public.campus
  add constraint campus_latitud_check
    check (latitud is null or (latitud >= -90 and latitud <= 90)),
  add constraint campus_longitud_check
    check (longitud is null or (longitud >= -180 and longitud <= 180)),
  add constraint campus_coordenadas_completas_check
    check ((latitud is null) = (longitud is null));

-- Sin `revoke`/`grant`: `campus` tiene `grant select` a nivel de TABLA para
-- `authenticated` (20260906000437:96), y en Postgres eso cubre columnas que
-- se agreguen después — mismo caso que `listings.busqueda` (CLAUDE.md §3).
-- El `revoke all` de esa misma migración ya bloquea INSERT/UPDATE/DELETE, así
-- que las columnas nuevas nacen no-escribibles sin hacer nada aquí. Verificado
-- con el diff de `scripts/grants-users-listings.sql` adaptado a `campus`:
-- 0 filas de diferencia antes/después de este archivo.
