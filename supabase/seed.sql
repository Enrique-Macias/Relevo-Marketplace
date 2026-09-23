-- Relevo — datos de referencia.
-- Las 12 categorías de CLAUDE.md §3 y el campus piloto de product-spec §02.
--
-- Idempotente a propósito: además del `db reset` local (que siempre arranca en
-- limpio), este seed se empuja al proyecto remoto con
-- `supabase db push --linked --include-seed`, donde sí puede correr dos veces.
-- Sin `on conflict do nothing` reventaría contra los unique de cada catálogo.

insert into public.categories (nombre) values
  ('Libros'),
  ('Electrónica'),
  ('Muebles'),
  ('Ropa'),
  ('Deportes'),
  ('Apuntes'),
  ('Hogar'),
  ('Papelería'),
  ('Instrumentos'),
  ('Arte y manualidades'),
  ('Boletos y eventos'),
  ('Otros')
on conflict (nombre) do nothing;

insert into public.universidades (nombre) values ('Tec de Monterrey')
on conflict (nombre) do nothing;

insert into public.campus (universidad_id, nombre, ciudad)
select id, 'Monterrey', 'Monterrey, N.L.' from public.universidades where nombre = 'Tec de Monterrey'
on conflict (universidad_id, nombre) do nothing;

-- Dominios de correo con los que se puede REGISTRAR una cuenta (Auth Hook
-- "Before User Created", migración 20260923000465). Sin al menos uno, el hook
-- rechaza TODO registro, porque falla cerrado. Además los probes de scripts/
-- crean sus usuarios `@tec.mx` por el admin API.
--
-- OJO: este seed también viaja a remoto con `db push --include-seed`, así que
-- correr ese comando da de alta `tec.mx` en producción. En remoto los dominios
-- reales se dan de alta en Studio (runbook de CLAUDE.md §8).
insert into public.universidad_dominios (dominio, universidad_id)
select 'tec.mx', id from public.universidades where nombre = 'Tec de Monterrey'
on conflict (dominio) do nothing;
