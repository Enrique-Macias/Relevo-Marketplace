-- Relevo — publicaciones y sus fotos (RF-05 a RF-11).

create table public.listings (
  id             bigint generated always as identity primary key,
  user_id        uuid   not null references public.users(id) on delete cascade,
  categoria_id   bigint not null references public.categories(id),
  universidad_id bigint not null references public.universidades(id),
  campus_id      bigint not null references public.campus(id),
  titulo         text   not null check (length(trim(titulo)) > 0),
  descripcion    text,
  precio         numeric(10,2) not null check (precio >= 0),
  condicion      public.listing_condition not null,
  estado         public.listing_status not null default 'activa',
  vistas_count   bigint not null default 0 check (vistas_count >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index listings_user_id_idx        on public.listings (user_id);
create index listings_categoria_id_idx   on public.listings (categoria_id);
create index listings_universidad_id_idx on public.listings (universidad_id);
create index listings_campus_id_idx      on public.listings (campus_id);

-- Feed paginado por campus, más reciente primero (RF-09, RNF-01 <2s en 4G).
create index listings_feed_idx on public.listings (campus_id, estado, created_at desc);

-- Búsqueda por texto en título y descripción (RF-10).
create index listings_busqueda_idx on public.listings
  using gin (to_tsvector('spanish', titulo || ' ' || coalesce(descripcion, '')));

-- updated_at: no lee ni escribe otras filas, así que corre como invoker.
-- El search_path se fija igual, para que nadie pueda hacer shadowing de now().
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger listings_set_updated_at
  before update on public.listings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS de listings
-- ---------------------------------------------------------------------------

alter table public.listings enable row level security;

-- Se ven las publicaciones de todos salvo las pausadas, que solo ve su dueño.
-- Las vendidas siguen visibles: RF-07 pide conservar el historial. El feed
-- filtra estado = 'activa' desde el cliente.
create policy listings_select on public.listings
  for select to authenticated
  using (estado <> 'pausada' or user_id = (select auth.uid()));

create policy listings_insert_own on public.listings
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_active_user()));

-- is_active_user() va en el using: lo que se decide es qué filas puede tocar el
-- usuario, no cómo queda la fila después.
create policy listings_update_own on public.listings
  for update to authenticated
  using      (user_id = (select auth.uid()) and (select private.is_active_user()))
  with check (user_id = (select auth.uid()));

create policy listings_delete_own on public.listings
  for delete to authenticated
  using (user_id = (select auth.uid()) and (select private.is_active_user()));

-- POR QUÉ ESTE REVOKE (aplica a TODA tabla nueva de este proyecto):
-- Supabase define un pg_default_acl que concede automáticamente TODOS los
-- privilegios sobre cada tabla nueva de `public` a anon y authenticated. Los
-- `grant` de abajo son ADITIVOS: suman permisos, nunca retiran los que ese
-- default ya otorgó. Sin este revoke previo, authenticated conserva acceso a
-- todas las columnas y cualquier `grant select (col1, col2)` cuidadosamente
-- acotado no protege absolutamente nada.
-- Aquí es lo que impide que el dueño escriba `vistas_count` a mano.
revoke all on public.listings from anon, authenticated;

grant select, insert, delete on public.listings to authenticated;

-- vistas_count queda fuera: solo lo toca increment_listing_view(), que excluye
-- al dueño. Sin este grant de columna, el dueño podría inflarlo con un update
-- directo y la RPC no serviría de nada. user_id fuera: no se transfiere una
-- publicación. created_at/updated_at los mantiene el trigger.
grant update (categoria_id, universidad_id, campus_id, titulo, descripcion,
              precio, condicion, estado)
  on public.listings to authenticated;

-- ---------------------------------------------------------------------------
-- Fotos
-- ---------------------------------------------------------------------------

create table public.listing_photos (
  id          bigint generated always as identity primary key,
  listing_id  bigint not null references public.listings(id) on delete cascade,
  storage_url text   not null,
  orden       smallint not null default 0 check (orden between 0 and 4),
  created_at  timestamptz not null default now(),
  unique (listing_id, orden)
);

create index listing_photos_listing_id_idx on public.listing_photos (listing_id);

-- Tope de 5 fotos por publicación. SECURITY DEFINER para que RLS no le esconda
-- filas al contar: con un count parcial dejaría pasar la sexta foto.
create function private.enforce_photo_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.listing_photos where listing_id = new.listing_id) >= 5 then
    raise exception 'Una publicación no puede tener más de 5 fotos';
  end if;
  return new;
end;
$$;

revoke execute on function private.enforce_photo_limit() from public, anon, authenticated;

create trigger listing_photos_enforce_limit
  before insert on public.listing_photos
  for each row execute function private.enforce_photo_limit();

alter table public.listing_photos enable row level security;

create policy listing_photos_select on public.listing_photos
  for select to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id
                   and (l.estado <> 'pausada' or l.user_id = (select auth.uid()))));

-- Una policy por acción de escritura, no `for all`: `for all` incluiría SELECT y
-- dejaría dos policies permisivas de lectura sobre la misma tabla, que Postgres
-- tendría que evaluar en cada fila leída. La lectura ya la cubre la de arriba.
create policy listing_photos_insert_own on public.listing_photos
  for insert to authenticated
  with check (exists (select 1 from public.listings l
                      where l.id = listing_id and l.user_id = (select auth.uid()))
              and (select private.is_active_user()));

create policy listing_photos_update_own on public.listing_photos
  for update to authenticated
  using      (exists (select 1 from public.listings l
                      where l.id = listing_id and l.user_id = (select auth.uid()))
              and (select private.is_active_user()))
  with check (exists (select 1 from public.listings l
                      where l.id = listing_id and l.user_id = (select auth.uid()))
              and (select private.is_active_user()));

create policy listing_photos_delete_own on public.listing_photos
  for delete to authenticated
  using (exists (select 1 from public.listings l
                 where l.id = listing_id and l.user_id = (select auth.uid()))
         and (select private.is_active_user()));

-- POR QUÉ ESTE REVOKE (aplica a TODA tabla nueva de este proyecto):
-- Supabase define un pg_default_acl que concede automáticamente TODOS los
-- privilegios sobre cada tabla nueva de `public` a anon y authenticated. Los
-- `grant` de abajo son ADITIVOS: suman permisos, nunca retiran los que ese
-- default ya otorgó. Sin este revoke previo, authenticated conserva acceso a
-- todas las columnas y cualquier `grant select (col1, col2)` cuidadosamente
-- acotado no protege absolutamente nada.
revoke all on public.listing_photos from anon, authenticated;

grant select, insert, delete on public.listing_photos to authenticated;
grant update (storage_url, orden) on public.listing_photos to authenticated;
