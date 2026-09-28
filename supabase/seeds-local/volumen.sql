-- Seed de VOLUMEN para medir planes (`explain analyze`) con un catálogo grande.
--
-- SOLO LOCAL, fuera de `[db.seed] sql_paths` (config.toml), por el mismo
-- motivo que `multiuniversidad.sql`: `seed.sql` viaja a remoto con
-- `db push --include-seed`, y esto siembra 84 000 publicaciones falsas.
--
-- Existe porque la cifra de "80 000 filas" con la que se midió la búsqueda
-- (CLAUDE.md §3) nunca llegó al repo: cada medición sembraba a mano y no se
-- podía repetir. Nació con "Recomendados para ti" (20260930000475).
--
-- Cómo correrlo, después de `supabase db reset` (y DESPUÉS de la suite de RLS:
-- T0 cuenta todos los perfiles, así que con esto sembrado la suite cae ahí sin
-- que haya ninguna regresión):
--   docker exec -i supabase_db_relevo-marketplace psql -v ON_ERROR_STOP=1 \
--     -U postgres -d postgres < supabase/seeds-local/volumen.sql
-- Borrarlo: `supabase db reset`.
--
-- Idempotente: UUIDs fijos, `on conflict do nothing`, y las publicaciones solo
-- se insertan si todavía no hay ninguna "VOL ".
--
-- Qué deja (el reparto imita un catálogo multi-universidad):
--  - Tec de Monterrey: "Monterrey" (el de seed.sql) con 20 000 activas y
--    "VOL Campus 1..4" con 10 000 cada uno → 60 000 en la universidad.
--  - "VOL Universidad" (dominio `vol.mx`) con "VOL U Campus A/B", 10 000 cada
--    uno → 20 000.
--  - 80 000 activas en total, más 4 000 pausadas (5 %) para que la RLS tenga
--    algo que filtrar. Categorías y `created_at` (último año) repartidos.
--  - 60 vendedores (40 Tec, 20 VOL) sin contraseña.
--  - Una cuenta con contraseña `prueba-1234` y señales para el ranking:
--      vol-yo@tec.mx → Tec, Monterrey; intereses en 2 categorías, 30
--      favoritos y 20 contactos recientes repartidos en otras.

begin;

insert into public.universidades (nombre) values ('VOL Universidad')
on conflict (nombre) do nothing;
insert into public.universidad_dominios (dominio, universidad_id)
select 'vol.mx', id from public.universidades where nombre = 'VOL Universidad'
on conflict (dominio) do nothing;

insert into public.campus (universidad_id, nombre, ciudad)
select u.id, c.nombre, 'Ciudad VOL'
  from public.universidades u
  cross join lateral (
    select 'VOL Campus ' || g as nombre from generate_series(1, 4) g
     where u.nombre = 'Tec de Monterrey'
    union all
    select 'VOL U Campus ' || x from unnest(array['A', 'B']) x
     where u.nombre = 'VOL Universidad'
  ) c
 where u.nombre in ('Tec de Monterrey', 'VOL Universidad')
on conflict (universidad_id, nombre) do nothing;

-- Vendedores: 40 de tec.mx y 20 de vol.mx. El trigger de alta les asigna la
-- universidad desde el dominio (fase 2A), que es lo que exige la FK
-- publicación ↔ dueño.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000',
       ('0a000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       'authenticated', 'authenticated',
       'vol-v' || g || case when g <= 40 then '@tec.mx' else '@vol.mx' end,
       '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  from generate_series(1, 60) g
on conflict (id) do nothing;

update public.users u
   set nombre = 'Vendedor Vol',
       campus_id = (select min(c.id) from public.campus c where c.universidad_id = u.universidad_id)
 where u.id::text like '0a000000-0000-4000-8000-%';

-- La cuenta que recibe recomendaciones.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
values ('00000000-0000-0000-0000-000000000000', '0a000000-0000-4000-8000-00000000ffff',
        'authenticated', 'authenticated', 'vol-yo@tec.mx', crypt('prueba-1234', gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at, last_sign_in_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
  from auth.users u
 where u.id = '0a000000-0000-4000-8000-00000000ffff'
on conflict (provider_id, provider) do nothing;

update public.users
   set nombre = 'Yo Volumen',
       campus_id = (select c.id from public.campus c
                     join public.universidades un on un.id = c.universidad_id
                    where un.nombre = 'Tec de Monterrey' and c.nombre = 'Monterrey')
 where id = '0a000000-0000-4000-8000-00000000ffff';

-- Publicaciones. `n` reparte campus, vendedor, categoría y fecha de forma
-- determinista (sin random(): dos corridas dan el mismo catálogo y los planes
-- se pueden comparar).
with campus_vol as (
  select c.id as campus_id, c.universidad_id, row_number() over (order by c.id) - 1 as k,
         case when c.nombre = 'Monterrey' then 20000 else 10000 end as activas
    from public.campus c
    join public.universidades un on un.id = c.universidad_id
   where (un.nombre = 'Tec de Monterrey' and (c.nombre = 'Monterrey' or c.nombre like 'VOL Campus %'))
      or un.nombre = 'VOL Universidad'
),
cats as (
  select array_agg(id order by id) as ids from public.categories
),
filas as (
  select cv.campus_id, cv.universidad_id, g as n, g > cv.activas as pausada
    from campus_vol cv
    cross join lateral generate_series(1, cv.activas + cv.activas / 20) g
)
insert into public.listings (user_id, universidad_id, campus_id, categoria_id, titulo, descripcion,
                             precio, condicion, estado, created_at)
select case when f.universidad_id = (select id from public.universidades where nombre = 'VOL Universidad')
            then ('0a000000-0000-4000-8000-' || lpad((41 + f.n % 20)::text, 12, '0'))::uuid
            else ('0a000000-0000-4000-8000-' || lpad((1 + f.n % 40)::text, 12, '0'))::uuid end,
       f.universidad_id, f.campus_id,
       (select ids[1 + (f.n * 7 + f.campus_id) % array_length(ids, 1)] from cats),
       'VOL ' || f.campus_id || '-' || f.n, 'Publicación de volumen',
       (f.n % 2000), 'usado',
       case when f.pausada then 'pausada' else 'activa' end::public.listing_status,
       now() - ((f.n * 37 + f.campus_id * 11) % 525600) * interval '1 minute'
  from filas f
 where not exists (select 1 from public.listings where titulo like 'VOL %');

-- Señales de vol-yo: intereses en las categorías 1 y 2 (por orden de id), y
-- favoritos/contactos recientes sobre publicaciones de Monterrey de otras
-- categorías.
insert into public.user_intereses (user_id, categoria_id)
select '0a000000-0000-4000-8000-00000000ffff', id
  from public.categories order by id limit 2
on conflict do nothing;

insert into public.favorites (user_id, listing_id, created_at)
select '0a000000-0000-4000-8000-00000000ffff', l.id, now() - interval '3 days'
  from public.listings l
  join public.campus c on c.id = l.campus_id and c.nombre = 'Monterrey'
 where l.titulo like 'VOL %' and l.estado = 'activa'
   and l.categoria_id in (select id from public.categories order by id offset 2 limit 3)
 order by l.id limit 30
on conflict do nothing;

insert into public.listing_contacts (user_id, listing_id, created_at)
select '0a000000-0000-4000-8000-00000000ffff', l.id, now() - interval '5 days'
  from public.listings l
  join public.campus c on c.id = l.campus_id and c.nombre = 'Monterrey'
 where l.titulo like 'VOL %' and l.estado = 'activa'
   and l.categoria_id in (select id from public.categories order by id offset 5 limit 2)
   and not exists (select 1 from public.listing_contacts lc
                    where lc.user_id = '0a000000-0000-4000-8000-00000000ffff')
 order by l.id limit 20;

commit;

analyze public.listings;
analyze public.favorites;
analyze public.listing_contacts;
analyze public.user_intereses;

select (select count(*) from public.listings where titulo like 'VOL %' and estado = 'activa') as activas,
       (select count(*) from public.listings where titulo like 'VOL %' and estado = 'pausada') as pausadas,
       (select count(*) from public.user_intereses where user_id = '0a000000-0000-4000-8000-00000000ffff') as intereses,
       (select count(*) from public.favorites where user_id = '0a000000-0000-4000-8000-00000000ffff') as favoritos,
       (select count(*) from public.listing_contacts where user_id = '0a000000-0000-4000-8000-00000000ffff') as contactos;
