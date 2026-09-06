-- Relevo — favoritos (RF-15), registro de contactos (RF-13) y calificaciones (RF-12).

-- ---------------------------------------------------------------------------
-- Favoritos: lista privada de cada usuario.
-- ---------------------------------------------------------------------------

create table public.favorites (
  user_id    uuid   not null references public.users(id) on delete cascade,
  listing_id bigint not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, listing_id)
);

create index favorites_listing_id_idx on public.favorites (listing_id);

alter table public.favorites enable row level security;

-- Nadie ve los favoritos de nadie más. Un usuario suspendido sí puede usarlos:
-- es una lista privada, sin impacto en otros ni en moderación.
create policy favorites_select_own on public.favorites
  for select to authenticated using (user_id = (select auth.uid()));

create policy favorites_insert_own on public.favorites
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy favorites_delete_own on public.favorites
  for delete to authenticated using (user_id = (select auth.uid()));

-- POR QUÉ ESTE REVOKE (aplica a TODA tabla nueva de este proyecto):
-- Supabase define un pg_default_acl que concede automáticamente TODOS los
-- privilegios sobre cada tabla nueva de `public` a anon y authenticated. Los
-- `grant` de abajo son ADITIVOS: suman permisos, nunca retiran los que ese
-- default ya otorgó. Sin este revoke previo, authenticated conserva acceso a
-- todas las columnas y cualquier `grant select (col1, col2)` cuidadosamente
-- acotado no protege absolutamente nada.
-- Sin update: no hay nada que editar en un favorito.
revoke all on public.favorites from anon, authenticated;
grant select, insert, delete on public.favorites to authenticated;

-- ---------------------------------------------------------------------------
-- Contactos: log append-only, una fila por tap en "Contactar por WhatsApp".
-- Es la fuente de candidatos del flujo "¿A quién le vendiste?" (CLAUDE.md §5).
-- ---------------------------------------------------------------------------

create table public.listing_contacts (
  id         bigint generated always as identity primary key,
  user_id    uuid   not null references public.users(id) on delete cascade,
  listing_id bigint not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index listing_contacts_user_id_idx    on public.listing_contacts (user_id);
create index listing_contacts_listing_id_idx on public.listing_contacts (listing_id);

alter table public.listing_contacts enable row level security;

create policy listing_contacts_select on public.listing_contacts
  for select to authenticated
  using (
    user_id = (select auth.uid())               -- mis propios contactos
    or exists (select 1 from public.listings l  -- o soy el vendedor: veo quién me contactó
               where l.id = listing_id and l.user_id = (select auth.uid()))
  );

create policy listing_contacts_insert_own on public.listing_contacts
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_active_user()));

-- POR QUÉ ESTE REVOKE (aplica a TODA tabla nueva de este proyecto):
-- Supabase define un pg_default_acl que concede automáticamente TODOS los
-- privilegios sobre cada tabla nueva de `public` a anon y authenticated. Los
-- `grant` de abajo son ADITIVOS: suman permisos, nunca retiran los que ese
-- default ya otorgó. Sin este revoke previo, authenticated conserva acceso a
-- todas las columnas y cualquier `grant select (col1, col2)` cuidadosamente
-- acotado no protege absolutamente nada.
-- Sin update ni delete: es un registro de eventos, no se edita.
revoke all on public.listing_contacts from anon, authenticated;
grant select, insert on public.listing_contacts to authenticated;

-- ---------------------------------------------------------------------------
-- Calificaciones
-- ---------------------------------------------------------------------------

create table public.ratings (
  id           bigint generated always as identity primary key,
  from_user_id uuid   not null references public.users(id) on delete cascade,
  to_user_id   uuid   not null references public.users(id) on delete cascade,
  listing_id   bigint not null references public.listings(id) on delete cascade,
  estrellas    smallint not null check (estrellas between 1 and 5),
  comentario   text,
  created_at   timestamptz not null default now(),
  check (from_user_id <> to_user_id),
  unique (from_user_id, to_user_id, listing_id)
);

create index ratings_from_user_id_idx on public.ratings (from_user_id);
create index ratings_to_user_id_idx   on public.ratings (to_user_id);
create index ratings_listing_id_idx   on public.ratings (listing_id);

-- Solo se puede calificar a alguien con quien de verdad hubo contacto por esa
-- publicación. SECURITY DEFINER porque debe ver filas de listing_contacts que
-- RLS le escondería al invocador.
create function private.can_rate(p_to_user uuid, p_listing_id bigint)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (                     -- soy el vendedor y esa persona me contactó
    select 1
    from public.listings l
    join public.listing_contacts c on c.listing_id = l.id
    where l.id = p_listing_id
      and l.user_id = (select auth.uid())
      and c.user_id = p_to_user
  ) or exists (                       -- o yo contacté y esa persona es el vendedor
    select 1
    from public.listings l
    join public.listing_contacts c on c.listing_id = l.id
    where l.id = p_listing_id
      and l.user_id = p_to_user
      and c.user_id = (select auth.uid())
  );
$$;

-- Se invoca desde una policy. `authenticated` recibe EXECUTE como workaround del
-- SIGSEGV descrito en supabase/KNOWN_ISSUES.md: sin este grant, capturar en
-- plpgsql el rechazo de una escritura tumba el backend. Es seguro: solo devuelve
-- un booleano sobre una relación en la que el llamante participa.
revoke execute on function private.can_rate(uuid, bigint) from public, anon;
grant  execute on function private.can_rate(uuid, bigint) to authenticated;

-- Mantiene users.rating_promedio del calificado. SECURITY DEFINER porque
-- actualiza la fila de OTRO usuario, en una columna sin grant de update.
create function private.recalc_rating_promedio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := coalesce(new.to_user_id, old.to_user_id);
begin
  update public.users u
     set rating_promedio = coalesce(
           (select round(avg(r.estrellas), 2) from public.ratings r where r.to_user_id = v_user),
           0)
   where u.id = v_user;
  return null;
end;
$$;

revoke execute on function private.recalc_rating_promedio() from public, anon, authenticated;

create trigger ratings_recalc_promedio
  after insert or update or delete on public.ratings
  for each row execute function private.recalc_rating_promedio();

alter table public.ratings enable row level security;

-- Las reseñas son públicas: la pantalla "Perfil público" las muestra.
create policy ratings_select on public.ratings
  for select to authenticated using (true);

create policy ratings_insert_own on public.ratings
  for insert to authenticated
  with check (from_user_id = (select auth.uid())
              and (select private.is_active_user())
              and (select private.can_rate(to_user_id, listing_id)));

create policy ratings_update_own on public.ratings
  for update to authenticated
  using      (from_user_id = (select auth.uid()) and (select private.is_active_user()))
  with check (from_user_id = (select auth.uid())
              and (select private.can_rate(to_user_id, listing_id)));

-- POR QUÉ ESTE REVOKE (aplica a TODA tabla nueva de este proyecto):
-- Supabase define un pg_default_acl que concede automáticamente TODOS los
-- privilegios sobre cada tabla nueva de `public` a anon y authenticated. Los
-- `grant` de abajo son ADITIVOS: suman permisos, nunca retiran los que ese
-- default ya otorgó. Sin este revoke previo, authenticated conserva acceso a
-- todas las columnas y cualquier `grant select (col1, col2)` cuidadosamente
-- acotado no protege absolutamente nada.
-- Aquí es lo que hace efectiva la inmutabilidad de to_user_id / listing_id.
revoke all on public.ratings from anon, authenticated;

grant select, insert on public.ratings to authenticated;

-- Solo estrellas y comentario son editables: sin esto, el autor podría hacer
-- `update ratings set to_user_id = <cualquiera>` y colgarle una reseña a alguien
-- con quien nunca tuvo trato, saltándose can_rate(). Una policy no puede comparar
-- la fila nueva contra la vieja, así que la inmutabilidad se expresa con grants.
-- Sin delete (ni grant ni policy): una calificación se corrige, no se borra.
grant update (estrellas, comentario) on public.ratings to authenticated;
