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
-- rechaza TODO registro, porque falla cerrado. (Los `probe-*.mjs` que crean
-- usuarios por el admin API NO dependen de esta fila: medido, ese camino no pasa
-- por el hook.)
--
-- OJO: este seed también viaja a remoto con `db push --include-seed`. Hoy es
-- inofensivo (`tec.mx` ya está dado de alta en producción y hay `on conflict do
-- nothing`), pero en remoto los dominios se dan de alta en Studio, no con este
-- archivo (CLAUDE.md §8, "Hecho", cómo dar de alta otra universidad).
insert into public.universidad_dominios (dominio, universidad_id)
select 'tec.mx', id from public.universidades where nombre = 'Tec de Monterrey'
on conflict (dominio) do nothing;
