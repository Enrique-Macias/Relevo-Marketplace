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
