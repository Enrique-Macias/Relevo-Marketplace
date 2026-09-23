-- Relevo — el registro solo admite correos de dominios institucionales dados de
-- alta por un admin (fase 1: el candado del servidor).
--
-- EL CANDADO ES EL AUTH HOOK "Before User Created", implementado como función
-- de Postgres. GoTrue la invoca antes de insertar en `auth.users`, así que un
-- correo rechazado no deja fila ni dispara el correo del OTP. No es una policy
-- ni un trigger sobre `auth.users`, porque el que decide si se crea el usuario
-- es GoTrue y no la base. Un trigger que abortara el insert se vería en el
-- cliente como un 500 genérico, sin mensaje reconocible.
--
-- EL HOOK SE ACTIVA FUERA DE ESTA MIGRACIÓN: en local con
-- `[auth.hook.before_user_created]` de config.toml y en remoto desde el
-- Dashboard (Authentication → Hooks). Aplicar esta migración NO bloquea ningún
-- registro por sí sola, y ese es el orden del runbook (CLAUDE.md §8): primero
-- la tabla, después los dominios reales y al final el hook. El hook falla
-- CERRADO: con la tabla vacía rechaza TODO.

create table public.universidad_dominios (
  -- Guardado ya normalizado, y el check lo garantiza: el hook compara por
  -- IGUALDAD EXACTA contra el dominio que extrae (minúsculas, sin espacios),
  -- así que un 'Tec.mx ' dado de alta a mano en Studio no machearía nunca.
  -- Sin '@': lo que se guarda es el dominio, no un correo.
  dominio         text primary key
                    check (dominio = lower(btrim(dominio))
                           and dominio <> ''
                           and position('@' in dominio) = 0),
  -- Un dominio pertenece a UNA universidad (la PK lo garantiza); una
  -- universidad puede tener varios. `on delete cascade`, el mismo criterio que
  -- `campus_universidad_id_fkey`: un dominio sin universidad no significa nada.
  universidad_id  bigint not null
                    references public.universidades(id) on delete cascade,
  created_at      timestamptz not null default now()
);

create index universidad_dominios_universidad_id_idx
  on public.universidad_dominios (universidad_id);

-- RLS habilitado aunque el cliente no tenga un solo grant: T12 exige RLS en
-- TODA tabla de public, y es defensa real si algún día se cuela un grant.
alter table public.universidad_dominios enable row level security;

-- pg_default_acl (CLAUDE.md §9): Supabase concede por default sobre cada tabla
-- nueva de public a anon/authenticated. El cliente no lee esta lista (la
-- pantalla de Verificación corre SIN sesión y anon no tiene un solo grant en el
-- proyecto), así que el revoke va solo, sin ningún grant detrás para esos roles.
revoke all on public.universidad_dominios from anon, authenticated;

-- El único lector es GoTrue, que ejecuta el hook como `supabase_auth_admin`.
-- Ese rol NO tiene bypassrls (medido: `rolbypassrls = f`), así que además del
-- grant necesita una policy. Sin ella la tabla se le ve VACÍA, y como el hook
-- falla cerrado, eso rechaza todos los registros sin ningún error que lo
-- delate.
grant select on public.universidad_dominios to supabase_auth_admin;

create policy universidad_dominios_select_auth_admin
  on public.universidad_dominios
  for select to supabase_auth_admin
  using (true);

-- La función del hook.
--
-- Va en `public` y no en `private`, al revés que el resto de funciones
-- internas del repo, porque `supabase_auth_admin` tiene USAGE sobre `public` y
-- no sobre `private` (medido), y el selector del Dashboard y la doc asumen
-- `public`. No queda expuesta por PostgREST: sin EXECUTE para
-- anon/authenticated, la API no se la ofrece a nadie (T27 lo vigila).
--
-- `sql`, no `plpgsql`, y SIN `SECURITY DEFINER`: corre como
-- `supabase_auth_admin` con su grant y su policy, y no necesita nada más. No
-- lleva bloque EXCEPTION (supabase/KNOWN_ISSUES.md).
--
-- La regla: el dominio es lo que sigue al ÚLTIMO '@' (`split_part(..., -1)`),
-- en minúsculas y sin espacios, y tiene que machear EXACTO contra la tabla. Sin
-- sufijos: `estudiante.tec.mx` no hereda de `tec.mx`, y `eviltec.mx` o
-- `tec.mx.evil.com` tampoco machean. SOLO un match explícito permite; todo lo
-- demás rechaza, incluido un email NULL (alta por teléfono o anónima).
--
-- 'dominio_no_participante' es un CÓDIGO, no copy. El texto visible lo pone el
-- cliente (`src/lib/registro.ts`), que es lo único que compara contra este
-- string, y `scripts/probe-registro.mjs` los amarra.
create function public.hook_before_user_created(event jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
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

revoke execute on function public.hook_before_user_created(jsonb)
  from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb)
  to supabase_auth_admin;
