-- Relevo — eliminar cuenta (Apple 5.1.1(v), Google Play).
--
-- El borrado lo hace la Edge Function `eliminar-cuenta` con
-- `auth.admin.deleteUser`, y el resto son cascadas desde `auth.users`. Esta
-- migración ajusta lo que esas cascadas harían MAL según las decisiones de
-- producto (CLAUDE.md §3, "Eliminar cuenta"):
--
--   1. Reseñas que el usuario ESCRIBIÓ: se conservan, sin autor ni comentario.
--      El promedio de quien las recibió no cambia.
--   2. Reseñas que RECIBIÓ: se borran con él (ratings.to_user_id sigue CASCADE).
--   3. Ventas donde fue comprador: se borra la fila de listing_sales (sigue CASCADE).
--   4. Sus publicaciones: se borran (Storage lo limpia la Edge Function).
--   5. Reportes hechos por él y en su contra: se conservan, sin su identidad.
--
-- Todo lo de anonimizar vive AQUÍ y no en el cliente ni en la función: una FK
-- `set null` más un trigger que limpia lo que el `set null` no alcanza. Así
-- aplica igual si la cuenta se borra desde Studio.
--
-- Medido en local antes de escribir esto (begin … rollback): las dos acciones
-- RI sobre la MISMA fila de ratings (autor y publicación anulados en un solo
-- delete) no dan "tuple already modified"; el recálculo de rating_promedio
-- sobre la fila de un usuario que se está borrando no truena; el unique de
-- ratings es NULLS DISTINCT, así que las filas anónimas nunca chocan.

-- ---------------------------------------------------------------------------
-- 1. ratings: autor y publicación pasan a NULL en vez de borrar la reseña.
-- ---------------------------------------------------------------------------

-- `listing_id` también, y no es solo por la cuenta: las reseñas que el usuario
-- escribió COMO VENDEDOR cuelgan de SUS publicaciones, que se borran. Con
-- CASCADE esas reseñas desaparecían y el promedio de sus compradores cambiaba.
--
-- Efecto sobre el borrado NORMAL de una publicación (decidido, no colateral):
-- hoy borrar una publicación vendida borraba las reseñas de las dos partes y
-- movía los dos promedios, o sea que un vendedor podía borrar una mala reseña
-- borrando la publicación. Desde aquí sobreviven. Costo: la reseña de una
-- publicación borrada ya no es editable por su autor, porque
-- `ratings_update_own` exige `can_rate(to_user_id, listing_id)` y con
-- `listing_id` NULL da false.
alter table public.ratings
  alter column from_user_id drop not null,
  alter column listing_id   drop not null;

alter table public.ratings
  drop constraint ratings_from_user_id_fkey,
  add constraint ratings_from_user_id_fkey
    foreign key (from_user_id) references public.users(id) on delete set null;

alter table public.ratings
  drop constraint ratings_listing_id_fkey,
  add constraint ratings_listing_id_fkey
    foreign key (listing_id) references public.listings(id) on delete set null;

-- El `set null` no puede tocar `comentario`: el texto lo escribió el autor y
-- puede identificarlo. Se borra en la misma transición.
--
-- INVOKER: solo reescribe NEW, no lee ni escribe otras filas (el criterio de
-- `set_updated_at()`, 20260906000439:31). `from_user_id` no está en el grant de
-- update del cliente (20260906000440, al final), así que esta transición solo
-- la produce el borrado de la cuenta o Studio.
create function private.anonimiza_rating()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.comentario := null;
  return new;
end;
$$;

create trigger ratings_anonimiza
  before update of from_user_id on public.ratings
  for each row
  when (old.from_user_id is not null and new.from_user_id is null)
  execute function private.anonimiza_rating();

-- ---------------------------------------------------------------------------
-- 2. reports: el reportante pasa a NULL; el snapshot del correo se borra.
-- ---------------------------------------------------------------------------

-- `reported_user_id` ya era `set null` (20260906000441). Los dos checks de la
-- tabla aceptan NULL: `num_nonnulls(...) <= 1` y `reported_user_id <>
-- reporter_id` (NULL no viola un check).
alter table public.reports
  alter column reporter_id drop not null;

alter table public.reports
  drop constraint reports_reporter_id_fkey,
  add constraint reports_reporter_id_fkey
    foreign key (reporter_id) references public.users(id) on delete set null;

-- `reported_user_correo` es el snapshot que toma `capture_report_snapshot()`
-- al crear el reporte. Existe para que el reporte siga siendo revisable si la
-- cuenta desaparece, pero la cuenta que desaparece por decisión propia no deja
-- su correo atrás. `listing_titulo` SÍ se conserva: es contenido, no identidad.
create function private.anonimiza_report()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.reported_user_correo := null;
  return new;
end;
$$;

create trigger reports_anonimiza
  before update of reported_user_id on public.reports
  for each row
  when (old.reported_user_id is not null and new.reported_user_id is null)
  execute function private.anonimiza_report();

-- ---------------------------------------------------------------------------
-- 3. Avisos de OTROS que llevan su nombre o el contenido de sus publicaciones.
-- ---------------------------------------------------------------------------

-- `notifications.titulo`/`cuerpo` se materializan al crearse. De los 7
-- productores (medido: los mismos en local y remoto), dos interpolan el NOMBRE
-- de otro usuario —`compra_calificable` (el vendedor) y `calificacion_recibida`
-- (el autor)— y otros dos el TÍTULO de la publicación —`precio_favorito` y
-- `favorito_vendido`—. Con `listing_id` en `set null` todos sobrevivirían en
-- inboxes ajenos. Se borran:
--
--   (a) todo aviso ajeno que apunte a una publicación suya;
--   (b) los `calificacion_recibida` que ÉL generó en publicaciones ajenas.
--
-- BEFORE DELETE porque después de las cascadas los `listing_id` ya son NULL y
-- no hay cómo encontrarlos. SECURITY DEFINER porque borra filas de otros.
--
-- (b) empareja por (destinatario, publicación, tipo): el aviso no guarda quién
-- lo causó. Si OTRA persona también calificó a ese mismo destinatario por esa
-- misma publicación (dos contactos calificando al vendedor antes de registrar
-- la venta), su aviso se borra también. Se prefiere eso a dejar un nombre: la
-- reseña de la otra persona sigue intacta en "Perfil público".
create function private.borra_avisos_de_cuenta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.notifications n
   where n.user_id <> old.id
     and (
       n.listing_id in (select l.id from public.listings l where l.user_id = old.id)
       or (n.tipo = 'calificacion_recibida'
           and exists (select 1 from public.ratings r
                        where r.from_user_id = old.id
                          and r.to_user_id = n.user_id
                          and r.listing_id = n.listing_id))
     );
  return old;
end;
$$;

revoke execute on function private.borra_avisos_de_cuenta() from public, anon, authenticated;

create trigger users_borra_avisos_de_cuenta
  before delete on public.users
  for each row execute function private.borra_avisos_de_cuenta();

-- ---------------------------------------------------------------------------
-- 4. Una cuenta SUSPENDIDA no puede borrarse y volver a registrarse limpia.
-- ---------------------------------------------------------------------------

-- Se guarda el sha256 del correo normalizado IGUAL que el Auth Hook normaliza
-- (`lower(btrim(...))`, 20260923000465) y el hook rechaza ese correo.
--
-- Alcance honesto: un hash sin sal de un correo es un SEUDÓNIMO, no un dato
-- anónimo — quien tenga acceso a la tabla puede probar correos candidatos. Por
-- eso no es legible por el cliente y va en el aviso de privacidad. Un alias o
-- un correo distinto del mismo usuario lo evaden. Desbloquear = borrar la fila
-- en Studio. Se guarda indefinidamente.
--
-- Va en `public` y no en `private` por el mismo motivo que
-- `universidad_dominios`: el hook corre como `supabase_auth_admin`, que no
-- tiene USAGE sobre `private`.
create table public.correos_bloqueados (
  correo_hash bytea primary key check (octet_length(correo_hash) = 32),
  created_at  timestamptz not null default now()
);

alter table public.correos_bloqueados enable row level security;

-- POR QUÉ ESTE REVOKE (aplica a TODA tabla nueva de este proyecto): el
-- pg_default_acl de Supabase concede todo a anon y authenticated sobre cada
-- tabla nueva de `public`. Aquí el revoke ES el control de acceso: el cliente
-- no tiene ni un privilegio.
revoke all on public.correos_bloqueados from anon, authenticated;
grant select on public.correos_bloqueados to supabase_auth_admin;

-- Portante, igual que la de `universidad_dominios`: `supabase_auth_admin` no
-- tiene bypassrls, así que sin esta policy la tabla se le vería vacía y el
-- bloqueo fallaría ABIERTO, en silencio.
create policy correos_bloqueados_select_auth_admin
  on public.correos_bloqueados
  for select to supabase_auth_admin
  using (true);

create function private.bloquea_correo_suspendido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.correos_bloqueados (correo_hash)
  values (sha256(convert_to(lower(btrim(old.correo)), 'UTF8')))
  on conflict do nothing;
  return old;
end;
$$;

revoke execute on function private.bloquea_correo_suspendido() from public, anon, authenticated;

create trigger users_bloquea_correo_suspendido
  before delete on public.users
  for each row
  when (old.estado = 'suspendido')
  execute function private.bloquea_correo_suspendido();

-- El hook: `create or replace` conserva OID y grants (EXECUTE solo para
-- supabase_auth_admin). El correo bloqueado se revisa ANTES que el dominio,
-- con su propio código, para que el cliente pueda decir la razón real.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.correos_bloqueados b
      where b.correo_hash = sha256(convert_to(lower(btrim(event -> 'user' ->> 'email')), 'UTF8'))
    )
    then jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'correo_bloqueado'
      )
    )
    when exists (
      select 1
      from public.universidad_dominios d
      where d.dominio = split_part(lower(btrim(event -> 'user' ->> 'email')), '@', -1)
    )
    then '{}'::jsonb
    else jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'dominio_no_participante'
      )
    )
  end
$$;
