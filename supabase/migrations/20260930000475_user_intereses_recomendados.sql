-- Relevo — intereses del usuario y "Recomendados para ti".
--
-- Dos piezas:
--  1. `public.user_intereses`: las categorías que el usuario ELIGE (paso
--     opcional del onboarding y "Editar perfil"). Una fila por categoría, no
--     un arreglo en `users`: se editan con insert/delete sobre la propia fila,
--     con RLS por fila y sin grants de columna que mantener.
--  2. `public.recomendar_listings(...)`: el ranking del estado "recomendados"
--     de Búsqueda. Un puntaje por CATEGORÍA, en SQL, sin ML (RNF-09).
--
-- El resto se enumera en CLAUDE.md §3 ("Intereses y recomendados") y lo prueba
-- T34 de supabase/tests/rls.sql.

-- ---------------------------------------------------------------------------
-- user_intereses
-- ---------------------------------------------------------------------------

-- `user_id` en cascade: "Eliminar cuenta" (20260929000474) borra `auth.users`,
-- eso borra `public.users` (cascade desde 20260906000438) y eso borra sus
-- intereses. No hace falta ningún trigger de anonimización: un interés no
-- menciona a nadie más. T33 (h) barre toda columna uuid de `public`, así que
-- una FK equivocada aquí también la cazaría.
--
-- `categoria_id` en cascade: un interés en una categoría que ya no existe no
-- significa nada. Borrar una categoría es cosa de Studio.
--
-- SIN índice sobre `categoria_id`, a propósito: la única consulta que lee esta
-- tabla (la función de abajo, y el cliente) filtra por `user_id`, que ya cubre
-- la PK compuesta como columna líder. El único que lo aprovecharía es el
-- cascade al borrar una categoría, un evento raro sobre una tabla chica. Se
-- agrega cuando aparezca una consulta que lo use.
create table public.user_intereses (
  user_id      uuid   not null references public.users(id) on delete cascade,
  categoria_id bigint not null references public.categories(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, categoria_id)
);

alter table public.user_intereses enable row level security;

-- Cada quien ve y edita SOLO las suyas. Sin `is_active_user()`: es una
-- preferencia privada que no toca a nadie más, el mismo criterio que
-- `favorites` (un suspendido también puede usarlos).
create policy user_intereses_select_own on public.user_intereses
  for select to authenticated using (user_id = (select auth.uid()));

create policy user_intereses_insert_own on public.user_intereses
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy user_intereses_delete_own on public.user_intereses
  for delete to authenticated using (user_id = (select auth.uid()));

-- POR QUÉ ESTE REVOKE (aplica a TODA tabla nueva de este proyecto):
-- Supabase define un pg_default_acl que concede automáticamente TODOS los
-- privilegios sobre cada tabla nueva de `public` a anon y authenticated. Los
-- `grant` de abajo son ADITIVOS: suman permisos, nunca retiran los que ese
-- default ya otorgó. Sin este revoke previo, anon conservaría acceso y
-- authenticated tendría UPDATE.
-- Sin update: no hay nada que editar en la fila; cambiar de interés es
-- borrar una y crear otra.
revoke all on public.user_intereses from anon, authenticated;
grant select, insert, delete on public.user_intereses to authenticated;

-- ---------------------------------------------------------------------------
-- recomendar_listings
-- ---------------------------------------------------------------------------
--
-- DOS PASOS, NO `setof listings`: el orden es por un puntaje que NO es columna
-- de `listings`, así que el patrón de `buscar_listings` (el cliente encadena
-- orden y cursor encima) no sirve — PostgREST no puede ordenar ni hacer keyset
-- por algo que no ve. Esta función ordena y pagina en SQL y devuelve solo
-- (id, puntaje, created_at); el cliente trae las tarjetas con sus embeds en
-- una segunda consulta `from('listings').in('id', ids)` y respeta este orden.
--
-- PUNTAJE, por categoría: 4·interés + 2·contacto + 1·favorito, con cada señal
-- en 0/1 (el `union` de abajo deduplica). Potencias de 2 sobre señales
-- binarias = orden LEXICOGRÁFICO: un interés explícito solo (4) le gana a
-- contacto + favorito juntos (3), y un contacto (2) a un favorito (1). No se
-- cuentan repeticiones a propósito: si se contaran, diez favoritos le ganarían
-- a una categoría elegida a mano. Se explica en una frase: primero lo que
-- elegiste, luego lo que contactaste, luego lo que guardaste.
--
-- VENTANA de 90 días para las implícitas (≈ un periodo escolar): lo que
-- contactaste o guardaste el semestre pasado deja de empujar. Los intereses
-- explícitos no caducan: se quitan a mano.
--
-- COLD START: sin señales todo puntaje es 0 y el orden se reduce a
-- `created_at desc, id desc` — recencia dentro del alcance.
--
-- ORDEN TOTAL Y ESTABLE ENTRE PÁGINAS: `(puntaje, created_at, id)` desc, con
-- `id` único como último desempate, y el cursor es la última fila completa
-- (keyset con comparación de fila). Sin el `id`, dos publicaciones con el
-- mismo puntaje y `created_at` se saltarían o repetirían al paginar.
--
-- SECURITY INVOKER, Y NO ES UN DETALLE: como definer saltaría
-- `listings_select` y devolvería los ids de publicaciones pausadas,
-- pendientes o bloqueadas ajenas; y leería favoritos/contactos/intereses sin
-- RLS. Invoker hereda un matiz, documentado: la categoría de una señal sale
-- de un join con `listings`, así que el favorito o contacto de una
-- publicación ajena que HOY está pausada/pendiente/bloqueada no cuenta.
--
-- SIN `set search_path`, igual que `buscar_listings` y por la misma razón: una
-- cláusula SET impide que Postgres inlinee la función. Inlineada, los
-- parámetros se sustituyen como constantes y el `p_campus_id is null or ...`
-- se resuelve al planear, así que el alcance "un campus" puede caminar sobre
-- `listings_feed_idx`. Todo va calificado por esquema. T34 (j) vigila
-- `proconfig is null`.
--
-- Las propias se excluyen aquí (`user_id <> auth.uid()`), no en el cliente:
-- es una regla del ranking, y así T34 (g) la prueba.
create function public.recomendar_listings(
  p_campus_id         bigint      default null,
  p_universidad_id    bigint      default null,
  p_cursor_puntaje    integer     default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id         bigint      default null,
  p_limit             integer     default 20
)
returns table (id bigint, puntaje integer, created_at timestamptz)
language sql
stable
security invoker
as $$
  with senales as (
    select i.categoria_id, 4 as peso
      from public.user_intereses i
     where i.user_id = (select auth.uid())
    union
    select l.categoria_id, 2
      from public.listing_contacts c
      join public.listings l on l.id = c.listing_id
     where c.user_id = (select auth.uid())
       and c.created_at > pg_catalog.now() - interval '90 days'
    union
    select l.categoria_id, 1
      from public.favorites f
      join public.listings l on l.id = f.listing_id
     where f.user_id = (select auth.uid())
       and f.created_at > pg_catalog.now() - interval '90 days'
  ),
  pesos as (
    select s.categoria_id, sum(s.peso)::integer as puntaje
      from senales s
     group by s.categoria_id
  ),
  candidatas as (
    select l.id, coalesce(p.puntaje, 0) as puntaje, l.created_at
      from public.listings l
      left join pesos p on p.categoria_id = l.categoria_id
     where l.estado = 'activa'
       and l.user_id <> (select auth.uid())
       and (p_campus_id is null or l.campus_id = p_campus_id)
       and (p_universidad_id is null or l.universidad_id = p_universidad_id)
  )
  select c.id, c.puntaje, c.created_at
    from candidatas c
   where p_cursor_id is null
      or (c.puntaje, c.created_at, c.id) < (p_cursor_puntaje, p_cursor_created_at, p_cursor_id)
   order by c.puntaje desc, c.created_at desc, c.id desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- `revoke all` primero, como todo grant del proyecto: `pg_default_acl` le da
-- EXECUTE a `public` (y con él a anon) sobre cada función nueva.
revoke all on function public.recomendar_listings(bigint, bigint, integer, timestamptz, bigint, integer)
  from public, anon, authenticated;
grant execute on function public.recomendar_listings(bigint, bigint, integer, timestamptz, bigint, integer)
  to authenticated;
