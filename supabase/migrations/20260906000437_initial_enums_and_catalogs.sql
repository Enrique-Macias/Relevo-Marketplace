-- Relevo — esquema base: tipos enum y catálogos de referencia.
-- Modelo de datos: CLAUDE.md §3.

-- Esquema para funciones internas SECURITY DEFINER. No se expone a PostgREST.
--
-- `authenticated` recibe USAGE aquí, y EXECUTE sobre las dos funciones que se
-- invocan desde policies, como WORKAROUND OBLIGATORIO de un bug de PostgreSQL
-- 17.6: si el rol que invoca no puede ejecutar la función que su policy
-- referencia, y el error resultante se captura en un bloque plpgsql con
-- EXCEPTION, el backend muere con SIGSEGV. Es reproducible al 100%.
-- No es un requisito funcional —una escritura legítima funciona con el esquema
-- cerrado— pero sí es la diferencia entre una base estable y una que se cae.
-- Lee supabase/KNOWN_ISSUES.md antes de "endurecer" esto.
create schema if not exists private;
revoke all   on schema private from public, anon;
grant  usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------

create type public.user_status as enum ('activo', 'suspendido');

create type public.listing_status as enum ('activa', 'pausada', 'vendida');

-- Valores tomados de la pantalla "Publicar" de design/relevo-app.html:
-- Nuevo · Como nuevo · Buen estado · Usado
create type public.listing_condition as enum ('nuevo', 'como_nuevo', 'buen_estado', 'usado');

-- Motivos de la pantalla "Reportar publicación" (RF-14).
create type public.report_reason as enum (
  'spam_publicidad',
  'sospecha_fraude',
  'contenido_inapropiado',
  'no_es_estudiante',
  'otro'
);

create type public.report_status as enum ('pendiente', 'resuelto', 'descartado');

-- ---------------------------------------------------------------------------
-- Catálogos
-- ---------------------------------------------------------------------------

create table public.universidades (
  id     bigint generated always as identity primary key,
  nombre text not null unique
);

create table public.campus (
  id             bigint generated always as identity primary key,
  universidad_id bigint not null references public.universidades(id) on delete cascade,
  nombre         text not null,
  ciudad         text not null,
  unique (universidad_id, nombre)
);

create index campus_universidad_id_idx on public.campus (universidad_id);

create table public.categories (
  id     bigint generated always as identity primary key,
  nombre text not null unique
);

-- ---------------------------------------------------------------------------
-- RLS: datos de referencia, solo lectura para usuarios autenticados.
-- El alta se hace desde Supabase Studio con service_role, que ignora RLS.
-- ---------------------------------------------------------------------------

alter table public.universidades enable row level security;
alter table public.campus        enable row level security;
alter table public.categories    enable row level security;

create policy universidades_select on public.universidades
  for select to authenticated using (true);

create policy campus_select on public.campus
  for select to authenticated using (true);

create policy categories_select on public.categories
  for select to authenticated using (true);

-- POR QUÉ ESTE REVOKE (aplica a TODA tabla nueva de este proyecto):
-- Supabase define un pg_default_acl que concede automáticamente TODOS los
-- privilegios sobre cada tabla nueva de `public` a anon y authenticated. Los
-- `grant` de abajo son ADITIVOS: suman permisos, nunca retiran los que ese
-- default ya otorgó. Sin este revoke previo, authenticated conserva acceso a
-- todas las columnas y cualquier `grant select (col1, col2)` cuidadosamente
-- acotado no protege absolutamente nada.
-- Si agregas una tabla más adelante: revoca primero, otorga después.
revoke all on public.universidades from anon, authenticated;
revoke all on public.campus        from anon, authenticated;
revoke all on public.categories    from anon, authenticated;

grant select on public.universidades to authenticated;
grant select on public.campus        to authenticated;
grant select on public.categories    to authenticated;
