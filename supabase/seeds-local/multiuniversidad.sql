-- Datos de prueba de la fase 2B (navegar el catálogo de otras universidades).
--
-- SOLO LOCAL. Este archivo está FUERA de `[db.seed] sql_paths` (config.toml) a
-- propósito: `seed.sql` viaja a remoto con `db push --include-seed`, y esto
-- siembra usuarios y publicaciones falsas que no deben llegar a producción.
--
-- Se corre a mano, después de `supabase db reset` (que ya aplicó seed.sql):
--   docker exec -i supabase_db_relevo-marketplace psql -v ON_ERROR_STOP=1 \
--     -U postgres -d postgres < supabase/seeds-local/multiuniversidad.sql
--
-- OJO con el orden: `supabase/tests/rls.sql` asume la base recién reseteada
-- (T0 cuenta TODOS los perfiles: "los 3 perfiles"), así que con este seed
-- aplicado la suite cae en esa aserción sin que haya ninguna regresión.
-- Medido. La suite se corre ANTES de sembrar esto, o tras otro `db reset`.
--
-- Idempotente: UUIDs fijos, `on conflict do nothing`, y las publicaciones solo
-- se insertan si su dueño todavía no tiene ninguna.
--
-- Qué deja, para ejercitar los tres alcances:
--  - Tec de Monterrey: campus "Monterrey" (6 publicaciones) y un campus nuevo
--    "Campus Vacío" (0) — el estado vacío de un campus de TU universidad.
--  - "Universidad Autónoma de Prueba del Noreste" (nombre largo a propósito,
--    para ver el truncado en la tarjeta), con "Campus Norte" (4 publicaciones,
--    una con título largo) y "Campus Sur" (0).
--  - Dos cuentas con contraseña `prueba-1234`, una por universidad:
--      tec-2b@tec.mx          → Tec, campus Monterrey
--      noreste-2b@prueba.edu.mx → Noreste, Campus Norte
--    La universidad la asigna el trigger de alta desde el dominio (fase 2A),
--    por eso `prueba.edu.mx` se da de alta en `universidad_dominios` ANTES de
--    crear la cuenta.
--
-- Las publicaciones nacen `activa` porque se insertan como `postgres` (la
-- policy de insert solo alcanza a `authenticated`) y sin fotos: la tarjeta
-- pinta el ícono de categoría de fallback.

begin;

insert into public.universidades (nombre)
values ('Universidad Autónoma de Prueba del Noreste')
on conflict (nombre) do nothing;

insert into public.campus (universidad_id, nombre, ciudad)
select u.id, c.nombre, c.ciudad
from public.universidades u
cross join (values ('Campus Norte', 'Apodaca, N.L.'), ('Campus Sur', 'Santiago, N.L.')) as c(nombre, ciudad)
where u.nombre = 'Universidad Autónoma de Prueba del Noreste'
on conflict (universidad_id, nombre) do nothing;

insert into public.campus (universidad_id, nombre, ciudad)
select id, 'Campus Vacío', 'Guadalupe, N.L.' from public.universidades where nombre = 'Tec de Monterrey'
on conflict (universidad_id, nombre) do nothing;

insert into public.universidad_dominios (dominio, universidad_id)
select 'prueba.edu.mx', id from public.universidades where nombre = 'Universidad Autónoma de Prueba del Noreste'
on conflict (dominio) do nothing;

-- Cuentas. Las columnas de token van en '' y no NULL: GoTrue revienta al leer
-- una fila con NULL ahí.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values
  ('00000000-0000-0000-0000-000000000000', '2b000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'tec-2b@tec.mx', crypt('prueba-1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '2b000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'noreste-2b@prueba.edu.mx', crypt('prueba-1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.id in ('2b000000-0000-4000-8000-000000000001', '2b000000-0000-4000-8000-000000000002')
on conflict (provider_id, provider) do nothing;

-- El perfil: nombre y campus (lo que haría "Completar perfil"). La universidad
-- ya la puso el trigger; si no la puso, el campus viola la FK compuesta y el
-- seed aborta — que es justo la señal de que el dominio no quedó dado de alta.
update public.users u
set nombre = v.nombre,
    carrera = v.carrera,
    campus_id = (select c.id from public.campus c where c.universidad_id = u.universidad_id and c.nombre = v.campus)
from (values
  ('2b000000-0000-4000-8000-000000000001'::uuid, 'Ana Tec', 'Ingeniería Industrial', 'Monterrey'),
  ('2b000000-0000-4000-8000-000000000002'::uuid, 'Beto Noreste', 'Arquitectura', 'Campus Norte')
) as v(id, nombre, carrera, campus)
where u.id = v.id;

-- Publicaciones. Una por fila de `values`, con un escalonado de created_at para
-- que el orden "recientes" mezcle las dos universidades en "Todas".
insert into public.listings (user_id, universidad_id, campus_id, categoria_id, titulo, descripcion, precio, condicion, estado, created_at)
select u.id, u.universidad_id, u.campus_id,
       (select id from public.categories where nombre = v.categoria),
       v.titulo, v.descripcion, v.precio, v.condicion::public.listing_condition, 'activa',
       now() - (v.horas || ' hours')::interval
from (values
  ('2b000000-0000-4000-8000-000000000001'::uuid, 'Libros',      'Cálculo de Larson, 9a edición',        'Poco subrayado.',            280, 'como_nuevo',  1),
  ('2b000000-0000-4000-8000-000000000002'::uuid, 'Muebles',     'Restirador plegable con lámpara de brazo articulado y banco alto', 'Lo uso poco.', 1500, 'buen_estado', 2),
  ('2b000000-0000-4000-8000-000000000001'::uuid, 'Electrónica', 'Calculadora TI-84 Plus',               'Con pilas.',                 900, 'buen_estado', 3),
  ('2b000000-0000-4000-8000-000000000002'::uuid, 'Arte y manualidades', 'Set de escalímetros',          null,                         150, 'usado',       4),
  ('2b000000-0000-4000-8000-000000000001'::uuid, 'Deportes',    'Raqueta de pádel',                     null,                         650, 'usado',       5),
  ('2b000000-0000-4000-8000-000000000002'::uuid, 'Libros',      'Neufert, arte de proyectar',           'Edición 16.',                700, 'buen_estado', 6),
  ('2b000000-0000-4000-8000-000000000001'::uuid, 'Ropa',        'Sudadera del Tec talla M',             null,                         250, 'nuevo',       7),
  ('2b000000-0000-4000-8000-000000000002'::uuid, 'Papelería',   'Maqueta base de cartón pluma',         null,                           0, 'nuevo',       8),
  ('2b000000-0000-4000-8000-000000000001'::uuid, 'Hogar',       'Minisplit portátil',                   null,                        2200, 'buen_estado', 9),
  ('2b000000-0000-4000-8000-000000000001'::uuid, 'Apuntes',     'Apuntes de Física I',                  null,                          80, 'usado',       10)
) as v(user_id, categoria, titulo, descripcion, precio, condicion, horas)
join public.users u on u.id = v.user_id
where not exists (select 1 from public.listings l where l.user_id = v.user_id);

commit;
