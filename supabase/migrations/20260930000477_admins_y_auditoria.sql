-- Relevo — RF-17, Ola 1: identidad de admin, MFA exigido en la base y
-- auditoría append-only.
--
-- Plan: `docs/rf17-plan-admin.md` §2 y §4 (D3, D4, D16, D18, D20). Nada de esto
-- lo usa la app móvil: lo consume el panel `admin/` por el schema `admin`.
--
-- QUIÉN ES ADMIN: una fila en `private.admins` con `activado_at` puesto. No
-- `app_metadata` (viaja en el JWT: revocar no surtiría efecto hasta el `exp`).
-- Revocar a un admin es BORRAR su fila, y surte efecto en la request
-- siguiente. Suspenderlo en `public.users` NO lo revoca: `is_admin()` no mira
-- `users.estado` (decisión E de la Ola 1; un admin no usa el marketplace, D4).
--
-- MFA: `private.is_admin()` exige, las tres a la vez, (1) la fila activada,
-- (2) `aal = aal2` y (3) un `amr` con `method = 'totp'` de las últimas 12 h.
-- Medido en local contra GoTrue (Paso 0 de la Ola 1): un refresh de sesión
-- CONSERVA el timestamp del `totp` y re-verificar el TOTP lo RENUEVA, así que
-- la ventana de 12 h se reabre pidiendo el código otra vez (D16).
--
-- Todo grant va precedido de su `revoke` (CLAUDE.md §1, §9: `pg_default_acl`).
-- `private` no está en `[api] schemas`; `admin` se expone en `config.toml` en
-- esta misma tarea. OJO, MEDIDO: con `admin` en `[api] schemas` y el schema
-- todavía sin crear, PostgREST no carga el schema cache (3F000) y TODO el API
-- responde 503, no solo `admin`. En remoto, el Dashboard se toca DESPUÉS del
-- push de esta migración, nunca antes (runbook de la Ola 3).

-- ---------------------------------------------------------------------------
-- private.admins
-- ---------------------------------------------------------------------------

create table private.admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  nombre      text not null,
  created_at  timestamptz not null default now(),
  -- NULL cuando la crea `scripts/crear-admin.mjs` (no hay JWT de un admin).
  created_by  uuid,
  -- NULL hasta el paso `activar` del script: con esto en NULL, `is_admin()` es
  -- false aunque la cuenta ya tenga aal2 (la ventana entre crear la cuenta y
  -- que el dueño real confirme por otro canal que enroló su TOTP).
  activado_at timestamptz
);

-- `private` no recibe `pg_default_acl` de Supabase (medido en remoto), pero el
-- revoke va explícito igual: es la regla del repo, y la aserción de T12 lo
-- vigila. RLS habilitado sin policies: si algún día alguien concede un grant
-- sin pensarlo, sigue sin verse nada.
revoke all on private.admins from public, anon, authenticated;
alter table private.admins enable row level security;

-- ---------------------------------------------------------------------------
-- Lectura del `amr`: el timestamp del TOTP más reciente, o NULL
-- ---------------------------------------------------------------------------
--
-- La forma de D18 (`jsonb_typeof(...) = 'array'` en vez de `coalesce`): con
-- `"amr": null` (JSON null, que `coalesce` NO atrapa) `jsonb_array_elements`
-- lanza `cannot extract elements from a scalar`.
--
-- UNA DIFERENCIA con el texto de D18, deliberada: el cast de `timestamp` va
-- dentro de un CASE, no junto al regex en el mismo AND. Postgres no garantiza
-- el orden de evaluación de un AND en un WHERE, así que el regex no protege el
-- cast; CASE sí fija el orden (es la forma que documenta Postgres para eso).
-- El control de T35 (d3) —quitar el regex— sigue cayendo en el cast.
--
-- Una sola copia del parseo: `is_admin()` y `admin.sesion()` la llaman.

create function private.totp_timestamp()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select max(
    case when (e->>'timestamp') ~ '^[0-9]{1,12}$'
         then (e->>'timestamp')::bigint
    end)
  from jsonb_array_elements(
         case when jsonb_typeof(auth.jwt()->'amr') = 'array'
              then auth.jwt()->'amr' else '[]'::jsonb end) e
  where jsonb_typeof(e) = 'object'
    and e->>'method' = 'totp';
$$;

revoke execute on function private.totp_timestamp() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- private.is_admin()
-- ---------------------------------------------------------------------------
--
-- La invoca (desde la Ola 2) una policy de Storage, así que lleva el
-- workaround del SIGSEGV de `supabase/KNOWN_ISSUES.md`: `sql`, definer, y
-- EXECUTE para `authenticated`. Es seguro: solo responde sobre el propio
-- `auth.uid()` del llamante. El USAGE sobre `private` ya existe
-- (`20260906000437:16`).

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from private.admins a
            where a.user_id = (select auth.uid())
              and a.activado_at is not null)
     and coalesce(auth.jwt()->>'aal', '') = 'aal2'
     and coalesce(private.totp_timestamp()
                  > extract(epoch from now())::bigint - 12 * 3600, false);
$$;

revoke execute on function private.is_admin() from public, anon;
grant  execute on function private.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- private.exigir_admin(): la primera línea de toda RPC de `admin.*` que actúa
-- ---------------------------------------------------------------------------
--
-- Lanza 42501 con TRES mensajes distintos para que el panel sepa qué pedir
-- (`admin/src/lib/rechazos.ts`): `no_admin` cierra la sesión; `mfa_requerido`
-- y `totp_vencido` abren el modal de TOTP. Cualquier otro 42501 se muestra y
-- ya. El veredicto final lo da `is_admin()`, que es la única definición.
-- Solo la llaman RPCs definer (que corren como su dueño): revocada a todos.

create function private.exigir_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from private.admins a
     where a.user_id = (select auth.uid())
       and a.activado_at is not null
  ) then
    raise exception 'no_admin' using errcode = '42501';
  end if;

  if coalesce(auth.jwt()->>'aal', '') <> 'aal2' then
    raise exception 'mfa_requerido' using errcode = '42501';
  end if;

  if not private.is_admin() then
    raise exception 'totp_vencido' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function private.exigir_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- private.claves_auditoria_ok(): qué puede ir en `antes`/`despues` (D20)
-- ---------------------------------------------------------------------------
--
-- Lista POR TIPO de objetivo y sin valores anidados: con una lista global,
-- `nombre` quedaría permitido también para `usuario`, y un objeto anidado
-- colaría un dato personal como valor de una clave permitida. NUNCA correo,
-- nombre de persona, teléfono, título ni comentario. Un CHECK no puede llamar
-- `jsonb_object_keys` directo (set-returning), por eso es función IMMUTABLE.
-- Una clave o un tipo nuevos exigen migración.

create function private.claves_auditoria_ok(p_tipo text, p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null
      or (jsonb_typeof(p) = 'object'
          and not exists (
            select 1
              from jsonb_each(p) e
             where jsonb_typeof(e.value) in ('object', 'array')
                or e.key <> all (
                     case p_tipo
                       when 'usuario'     then array['estado', 'suspendido_at', 'publicaciones_pausadas']
                       when 'reporte'     then array['estado', 'resolved_at']
                       when 'listing'     then array['estado']
                       when 'universidad' then array['nombre']
                       when 'campus'      then array['nombre', 'ciudad', 'latitud', 'longitud', 'universidad_id']
                       when 'dominio'     then array['dominio', 'universidad_id', 'activo']
                       when 'admin'       then array['activado_at', 'factores_borrados']
                       else array[]::text[]
                     end)));
$$;

revoke execute on function private.claves_auditoria_ok(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- private.admin_acciones: auditoría append-only
-- ---------------------------------------------------------------------------
--
-- `admin_id` SIN FK a propósito: si la cuenta del admin se borra, la fila de
-- auditoría se conserva (T35 (k)). `objetivo_id` es `text` y queda con el uuid
-- de alguien que ya no existe si esa cuenta se elimina (D7): es una excepción
-- documentada al barrido de T33 (h), que solo mira columnas `uuid` de `public`.
--
-- El `motivo` es texto libre: el panel pide no escribir datos personales, pero
-- la base no lo puede hacer cumplir. OJO: el DETAIL de un rechazo de cualquier
-- CHECK de esta tabla imprime la fila completa, motivo incluido, y puede llegar
-- a logs. No se pega en chats ni en tickets (`admin/CLAUDE.md`).
--
-- Las filas de `scripts/crear-admin.mjs activar` no tienen JWT: llevan el
-- centinela `00000000-0000-0000-0000-000000000000` y
-- `admin_correo = 'script:crear-admin.mjs'`.

create table private.admin_acciones (
  id            bigint generated always as identity primary key,
  admin_id      uuid not null,
  admin_correo  text not null,
  accion        text not null
    constraint admin_acciones_accion_check
    check (accion in ('suspender_usuario', 'reactivar_usuario', 'activar_admin')),
  objetivo_tipo text not null
    constraint admin_acciones_objetivo_tipo_check
    check (objetivo_tipo in ('reporte', 'listing', 'usuario', 'universidad',
                             'campus', 'dominio', 'admin')),
  objetivo_id   text not null,
  antes         jsonb,
  despues       jsonb,
  motivo        text not null,
  created_at    timestamptz not null default now(),
  constraint admin_acciones_claves_ok
    check (private.claves_auditoria_ok(objetivo_tipo, antes)
       and private.claves_auditoria_ok(objetivo_tipo, despues)),
  -- La misma regla que `suspender_usuario`/`reactivar_usuario` y que
  -- `users_suspension_motivo_valido` (20260930000478): 3-500 tras btrim.
  constraint admin_acciones_motivo_valido
    check (char_length(btrim(motivo)) between 3 and 500)
);

revoke all on private.admin_acciones from public, anon, authenticated;
alter table private.admin_acciones enable row level security;

-- APPEND-ONLY. Alcance honesto: `postgres` puede hacer `drop trigger`; esto
-- frena errores y RPCs mal escritas, no a un superusuario malicioso. Un
-- `before truncate` aparte porque TRUNCATE no dispara triggers de fila.
create function private.admin_acciones_inmutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'admin_acciones_append_only' using errcode = '42501';
end;
$$;

revoke execute on function private.admin_acciones_inmutable() from public, anon, authenticated;

create trigger admin_acciones_sin_update_ni_delete
  before update or delete on private.admin_acciones
  for each row execute function private.admin_acciones_inmutable();

create trigger admin_acciones_sin_truncate
  before truncate on private.admin_acciones
  for each statement execute function private.admin_acciones_inmutable();

-- Única forma de escribir auditoría desde una RPC: el actor sale de
-- `auth.uid()` y su correo de `auth.users` (snapshot), nunca de un parámetro.
create function private.auditar(
  p_accion        text,
  p_objetivo_tipo text,
  p_objetivo_id   text,
  p_antes         jsonb,
  p_despues       jsonb,
  p_motivo        text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into private.admin_acciones
    (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id,
     antes, despues, motivo)
  select a.id, a.email, p_accion, p_objetivo_tipo, p_objetivo_id,
         p_antes, p_despues, btrim(p_motivo)
    from auth.users a
   where a.id = (select auth.uid())
  returning id into v_id;

  if v_id is null then
    raise exception 'auditoria_sin_actor' using errcode = '42501';
  end if;
  return v_id;
end;
$$;

revoke execute on function private.auditar(text, text, text, jsonb, jsonb, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Schema `admin` (D3): las RPCs del panel
-- ---------------------------------------------------------------------------
--
-- Toda función de aquí es `security definer`, `set search_path = ''`, con
-- `revoke … from public, anon` y `grant execute … to authenticated`, y la
-- primera línea de las que actúan es `perform private.exigir_admin();`. El
-- `revoke … from public` no sobra: Postgres le da EXECUTE a PUBLIC en toda
-- función nueva, independiente del ACL de Supabase. T12 lo vigila.

create schema admin;
revoke all on schema admin from public;
grant usage on schema admin to authenticated;

-- ---------------------------------------------------------------------------
-- admin.sesion(): gating de UX del panel. NO es candado.
-- ---------------------------------------------------------------------------
--
-- La única de `admin.*` que NO llama a `exigir_admin()`: tiene que responder
-- `es_admin = false` a quien no lo es, en vez de lanzar, para que el panel
-- decida qué pantalla pintar. No devuelve nada que no sepa ya el propio JWT,
-- salvo si la cuenta está activada como admin.

create function admin.sesion()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'es_admin',       private.is_admin(),
    'admin_activado', exists (select 1 from private.admins a
                               where a.user_id = (select auth.uid())
                                 and a.activado_at is not null),
    'aal',            auth.jwt()->>'aal',
    'totp_reciente',  coalesce(t.ts > extract(epoch from now())::bigint - 12 * 3600, false),
    'totp_expira_en', case when t.ts is not null
                           then to_timestamp(t.ts + 12 * 3600) end)
  from (select private.totp_timestamp() as ts) t;
$$;

revoke execute on function admin.sesion() from public, anon;
grant  execute on function admin.sesion() to authenticated;
