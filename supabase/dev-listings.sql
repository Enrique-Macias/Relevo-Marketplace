-- Relevo — publicaciones de prueba para desarrollo. NO es seed.
--
-- POR QUÉ NO VA EN seed.sql: ese archivo es de datos de REFERENCIA (las 12
-- categorías, la universidad y el campus piloto) y se empuja al proyecto remoto
-- con `db push --include-seed`. Esto son datos falsos: si acabaran ahí, el
-- catálogo de producción arrancaría con publicaciones inventadas.
--
-- Existe porque el grupo Publicar todavía no está construido, así que no hay
-- forma de crear una publicación desde la app para probar Explorar.
--
-- Cómo correrlo (local):
--     psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" \
--       -v uid="'<tu-uuid-de-auth.users>'" -f supabase/dev-listings.sql
--
-- El uuid es el de TU usuario en `auth.users` — así unas publicaciones salen a
-- tu nombre y puedes ver el estado "Detalle (vista vendedor)" sin inventar
-- sesiones. Corre como `postgres`/`service_role`: `authenticated` no puede
-- insertar en nombre de otro (policy listings_insert_own), que es justamente lo
-- que la suite de RLS verifica en T3.
--
-- Idempotente: borra sus propias filas antes de reinsertar.

\set ON_ERROR_STOP on

begin;

-- Dos vendedores ficticios además del usuario real. `auth.users` primero: el
-- trigger on_auth_user_created crea el perfil en public.users.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('d0000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dev-jorge@tec.mx', '', now(), now(), now()),
  ('d0000002-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dev-ana@tec.mx', '', now(), now(), now())
on conflict (id) do nothing;

update public.users set nombre = 'Jorge Muñoz', carrera = 'Ingeniería Industrial',
       universidad_id = 1, campus_id = 1
 where id = 'd0000001-0000-0000-0000-000000000001';
update public.users set nombre = 'Ana Torres', carrera = 'Diseño Industrial',
       universidad_id = 1, campus_id = 1
 where id = 'd0000002-0000-0000-0000-000000000002';

delete from public.listings where titulo like '[dev] %';

insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, descripcion, precio, condicion, estado, created_at)
values
  ('d0000001-0000-0000-0000-000000000001', 1, 1, 1, '[dev] Cálculo de Larson, 9a edición',
   'Sin subrayados ni marcas, pasta en buen estado. Entrega en el campus.',
   280, 'como_nuevo', 'activa', now() - interval '2 hours'),
  ('d0000002-0000-0000-0000-000000000002', 2, 1, 1, '[dev] Monitor Dell 24" IPS',
   'Panel IPS Full HD. Incluye cable HDMI y de poder.',
   3200, 'buen_estado', 'activa', now() - interval '5 hours'),
  ('d0000001-0000-0000-0000-000000000001', 3, 1, 1, '[dev] Escritorio plegable',
   'Ideal para dorm o cuarto de renta. Poco uso.',
   650, 'buen_estado', 'activa', now() - interval '1 day'),
  ('d0000002-0000-0000-0000-000000000002', 4, 1, 1, '[dev] Sudadera Tec talla M',
   'Nueva sin etiquetas, compré talla equivocada.',
   180, 'nuevo', 'activa', now() - interval '30 hours'),
  ('d0000001-0000-0000-0000-000000000001', 1, 1, 1, '[dev] Física para ciencias, Serway',
   'Pasta un poco maltratada pero todas las hojas completas.',
   150, 'usado', 'activa', now() - interval '6 hours'),
  ('d0000002-0000-0000-0000-000000000002', 6, 1, 1, '[dev] Apuntes completos de Cálculo I',
   'Apuntes a mano, completos, con ejercicios resueltos.',
   120, 'buen_estado', 'activa', now() - interval '10 hours'),
  ('d0000001-0000-0000-0000-000000000001', 9, 1, 1, '[dev] Guitarra acústica Yamaha',
   'Cuerdas nuevas, viene con funda.',
   1800, 'buen_estado', 'activa', now() - interval '60 hours'),
  ('d0000002-0000-0000-0000-000000000002', 11, 1, 1, '[dev] Boleto concierto Auditorio',
   'Boleto general, no puedo ir por examen. Entrega digital.',
   900, 'nuevo', 'activa', now() - interval '3 hours'),
  -- Propias: para el estado "Detalle (vista vendedor)".
  (:uid, 2, 1, 1, '[dev] Audífonos Sony WH-CH520',
   'Poco uso, batería dura todo el día. Incluyen cable original.',
   750, 'como_nuevo', 'activa', now() - interval '2 hours'),
  (:uid, 3, 1, 1, '[dev] Silla gamer usada',
   'Cómoda para estudiar, algunos signos de uso pero estructura sólida.',
   1100, 'usado', 'activa', now() - interval '36 hours'),
  -- Una vendida: alimenta el "{n} ventas" de la tarjeta del vendedor.
  ('d0000001-0000-0000-0000-000000000001', 5, 1, 1, '[dev] Balón de fútbol #5',
   'Usado en un semestre de liga interna.',
   220, 'usado', 'vendida', now() - interval '5 days');

commit;

\echo 'Publicaciones de prueba listas. Para limpiarlas:'
\echo "  delete from public.listings where titulo like '[dev] %';"
