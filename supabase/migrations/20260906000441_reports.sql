-- Relevo — reportes hacia moderación (RF-14, RF-17).

create table public.reports (
  id               bigint generated always as identity primary key,
  reporter_id      uuid   not null references public.users(id) on delete cascade,
  listing_id       bigint references public.listings(id) on delete set null,
  reported_user_id uuid   references public.users(id) on delete set null,
  motivo           public.report_reason not null,
  comentario       text,
  -- Snapshots: el reporte debe seguir siendo revisable aunque su objetivo
  -- desaparezca (por eso los FK son `set null`, no `cascade`).
  listing_titulo       text,
  reported_user_correo text,
  estado           public.report_status not null default 'pendiente',
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  -- Al crearse apunta a exactamente un objetivo (se exige en la policy de
  -- insert); puede quedar en cero si el objetivo se borra. Nunca a los dos.
  -- Con un `= 1` estricto aquí, anular listing_id abortaría el DELETE de la
  -- publicación y las publicaciones reportadas serían imborrables.
  check (num_nonnulls(listing_id, reported_user_id) <= 1),
  check (reported_user_id is null or reported_user_id <> reporter_id)
);

create index reports_reporter_id_idx      on public.reports (reporter_id);
create index reports_listing_id_idx       on public.reports (listing_id);
create index reports_reported_user_id_idx on public.reports (reported_user_id);
create index reports_estado_idx           on public.reports (estado);

-- Un reporte por objetivo por persona.
create unique index reports_unico_por_listing on public.reports (reporter_id, listing_id)
  where listing_id is not null;
create unique index reports_unico_por_usuario on public.reports (reporter_id, reported_user_id)
  where reported_user_id is not null;

-- Captura los snapshots al crear el reporte.
-- SECURITY DEFINER obligatorio: `correo` está deliberadamente fuera del grant de
-- select sobre users (RNF-05), así que como invoker esto fallaría con
-- "permission denied for column correo" en cada reporte a un usuario.
create function private.capture_report_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.listing_id is not null then
    select l.titulo into new.listing_titulo
      from public.listings l where l.id = new.listing_id;
  end if;

  if new.reported_user_id is not null then
    select u.correo into new.reported_user_correo
      from public.users u where u.id = new.reported_user_id;
  end if;

  return new;
end;
$$;

-- No impide que el trigger dispare: Postgres verifica EXECUTE al crear el
-- trigger, no al ejecutarlo. Solo evita que se invoque directamente como RPC.
revoke execute on function private.capture_report_snapshot() from public, anon, authenticated;

create trigger reports_capture_snapshot
  before insert on public.reports
  for each row execute function private.capture_report_snapshot();

alter table public.reports enable row level security;

create policy reports_select_own on public.reports
  for select to authenticated
  using (reporter_id = (select auth.uid()));

create policy reports_insert_own on public.reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid())
              and (select private.is_active_user())
              and num_nonnulls(listing_id, reported_user_id) = 1);

-- POR QUÉ ESTE REVOKE (aplica a TODA tabla nueva de este proyecto):
-- Supabase define un pg_default_acl que concede automáticamente TODOS los
-- privilegios sobre cada tabla nueva de `public` a anon y authenticated. Los
-- `grant` de abajo son ADITIVOS: suman permisos, nunca retiran los que ese
-- default ya otorgó. Sin este revoke previo, authenticated conserva acceso a
-- todas las columnas y cualquier `grant select (col1, col2)` cuidadosamente
-- acotado no protege absolutamente nada.
-- Aquí es lo que impide que el reportante lea reported_user_correo.
revoke all on public.reports from anon, authenticated;

-- reported_user_correo queda fuera del grant: si fuera legible, cualquiera
-- podría reportar a quien sea y leer su correo institucional desde su propia
-- fila, reintroduciendo la fuga que RNF-05 prohíbe. Solo service_role lo ve.
grant select (id, reporter_id, listing_id, reported_user_id, motivo, comentario,
              listing_titulo, estado, created_at, resolved_at)
  on public.reports to authenticated;

grant insert on public.reports to authenticated;

-- Sin update ni delete para clientes: mover un reporte a resuelto/descartado es
-- trabajo de moderación desde Studio con service_role (RF-17).
