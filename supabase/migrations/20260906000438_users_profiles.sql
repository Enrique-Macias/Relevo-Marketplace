-- Relevo — perfil público de usuario, ligado a auth.users.

create table public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  correo          text not null unique,
  -- nombre / universidad / campus / carrera son nullable a propósito: el trigger
  -- crea la fila al verificarse el correo, y estos campos se llenan después en
  -- "Completar perfil" / "Selector de universidad" (CLAUDE.md §5).
  nombre          text,
  foto_url        text,
  universidad_id  bigint references public.universidades(id),
  campus_id       bigint references public.campus(id),
  carrera         text,
  rating_promedio numeric(3,2) not null default 0 check (rating_promedio between 0 and 5),
  estado          public.user_status not null default 'activo',
  created_at      timestamptz not null default now()
);

create index users_universidad_id_idx on public.users (universidad_id);
create index users_campus_id_idx      on public.users (campus_id);

-- ---------------------------------------------------------------------------
-- Provisión automática del perfil al registrarse (RF-01).
-- SECURITY DEFINER: el cliente no tiene grant de insert sobre public.users.
-- ---------------------------------------------------------------------------

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, correo) values (new.id, new.email);
  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helper de suspensión. Un usuario suspendido conserva la lectura del catálogo,
-- sus favoritos y la edición de su propio perfil, pero no puede publicar,
-- editar/borrar publicaciones, contactar, calificar ni reportar (RF-17).
-- ---------------------------------------------------------------------------

create function private.is_active_user()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where id = (select auth.uid()) and estado = 'activo'
  );
$$;

-- Se invoca desde las policies. `authenticated` recibe EXECUTE como workaround
-- del SIGSEGV descrito en supabase/KNOWN_ISSUES.md: sin este grant, capturar en
-- plpgsql el rechazo de una escritura tumba el backend. Es seguro: solo devuelve
-- un booleano sobre el propio auth.uid() del llamante.
revoke execute on function private.is_active_user() from public, anon;
grant  execute on function private.is_active_user() to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.users enable row level security;

-- Directorio semi-público: hace falta ver a otros para "Perfil público", las
-- reseñas y la lista de "¿A quién le vendiste?".
create policy users_select on public.users
  for select to authenticated using (true);

create policy users_update_own on public.users
  for update to authenticated
  using      ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Sin policy de insert (solo entra por el trigger) ni de delete (borrar cuenta
-- no está en el MVP).

-- POR QUÉ ESTE REVOKE (aplica a TODA tabla nueva de este proyecto):
-- Supabase define un pg_default_acl que concede automáticamente TODOS los
-- privilegios sobre cada tabla nueva de `public` a anon y authenticated. Los
-- `grant` de abajo son ADITIVOS: suman permisos, nunca retiran los que ese
-- default ya otorgó. Sin este revoke previo, authenticated conserva acceso a
-- todas las columnas y cualquier `grant select (col1, col2)` cuidadosamente
-- acotado no protege absolutamente nada.
-- Aquí es literal: sin esta línea, `correo` queda legible por cualquiera y la
-- mitigación de RNF-05 de abajo es decorativa.
revoke all on public.users from anon, authenticated;

-- RNF-05: `correo` queda fuera del grant de select, así que nadie puede leerlo
-- por la Data API — RLS filtra filas, no columnas. El propio usuario ya tiene su
-- correo en la sesión de Auth.
grant select (id, nombre, foto_url, universidad_id, campus_id, carrera,
              rating_promedio, estado, created_at)
  on public.users to authenticated;

-- `rating_promedio` y `estado` quedan fuera del grant de update: los mantienen
-- los triggers y service_role, no el cliente.
grant update (nombre, foto_url, universidad_id, campus_id, carrera)
  on public.users to authenticated;
