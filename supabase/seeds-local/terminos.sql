-- Versiones de PRUEBA de los Términos de uso y el Aviso de privacidad (PL-016,
-- migración 20261026000490), para usar la app contra el stack local.
--
-- SOLO LOCAL. Fuera de `[db.seed] sql_paths` (config.toml) por el mismo motivo
-- que `multiuniversidad.sql`: `seed.sql` viaja a remoto con
-- `db push --include-seed`, y una versión legal falsa no puede llegar a
-- STAGING ni a PROD. Allá las versiones reales las carga el usuario con un
-- `insert` (runbook de PL-001), con la URL fija y el sha256 del texto
-- archivado en `docs/legal/versiones/`.
--
-- El hash es del texto 'local-prueba', no de un documento real: no se puede
-- comprobar contra nada, y no hace falta.
--
-- Se corre a mano, después de `supabase db reset`:
--   docker exec -i supabase_db_relevo-marketplace psql -v ON_ERROR_STOP=1 \
--     -U postgres -d postgres < supabase/seeds-local/terminos.sql
--
-- Los `probe-*.mjs` NO dependen de este archivo: `scripts/_terminos-prueba.mjs`
-- inserta exactamente estas dos filas si faltan. La suite de RLS tampoco: siembra
-- las suyas (`rls-fixture`) dentro de su transacción.
--
-- Idempotente (`on conflict do nothing`): la tabla no admite editar una
-- versión, así que no hay `do update`.
insert into public.documentos_legales (tipo, version, vigente_desde, url, contenido_sha256)
values ('terminos', 'local-prueba', '2026-01-01T00:00:00Z',
        'https://www.rlvo.com.mx/terminos', sha256('local-prueba')),
       ('aviso_privacidad', 'local-prueba', '2026-01-01T00:00:00Z',
        'https://www.rlvo.com.mx/privacidad', sha256('local-prueba'))
on conflict do nothing;
