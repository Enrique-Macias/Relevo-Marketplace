-- Relevo — datos de referencia.
-- Las 12 categorías de CLAUDE.md §3 y el campus piloto de product-spec §02.

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
  ('Otros');

insert into public.universidades (nombre) values ('Tec de Monterrey');

insert into public.campus (universidad_id, nombre, ciudad)
select id, 'Monterrey', 'Monterrey, N.L.' from public.universidades where nombre = 'Tec de Monterrey';
