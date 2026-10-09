-- Relevo — RF-17 Ola 5: catálogo institucional en el panel de admin.
-- Plan: docs/rf17-ola5-plan.md (v3.1). Fecha según D17: el día real
-- (2026-10-08) no es menor que la última migración, así que lleva la fecha
-- real y el siguiente consecutivo.
--
-- Qué hace, en orden:
--   1. `universidad_dominios.activo` (borrado lógico de dominios, D12). Nace
--      `not null default true`: los dominios existentes quedan activos en la
--      misma transacción, sin ventana en que el registro se cierre.
--   2. El Auth Hook y `private.handle_new_user()` filtran `and d.activo` en
--      sus DOS copias (amarradas por T28 (a3)). Cada una se copia LITERAL de
--      su versión vigente (20260929000474:226-257 y 20260924000466:48-65) con
--      ese único cambio. `create or replace`: conservan OID, el trigger
--      `on_auth_user_created` y sus grants, que además se reescriben abajo con
--      los MISMOS valores. La rama `correo_bloqueado` del hook se conserva.
--      `supabase_auth_admin` ya puede leer `activo`: su grant es de TABLA
--      (20260923000465:53), no por columnas. Medido.
--   3. `admin_acciones_accion_check` pasa de 9 a 16 acciones.
--   4. Checks de forma (nombres normalizados, 2-100) con expresión
--      AUTOCONTENIDA, e índices únicos sin distinguir mayúsculas. Medido: un
--      CHECK que llamara a una función de `private` le daría 42501 a
--      `service_role` (no tiene USAGE sobre `private`), así que no se usa.
--   5. `private.proveedores_correo_publico()`: la lista de proveedores de
--      correo público que `agregar_dominio` rechaza. Vive SOLO aquí (sin
--      CHECK de tabla, decisión del usuario): se cambia con un `create or
--      replace` en una migración nueva. `rlvo.com.mx` NO está aquí: es una
--      regla del runbook, no de la base.
--   6. `private.normaliza_texto()`, solo para las RPC.
--   7. Las 8 RPC de `admin`: `catalogo` y 7 escrituras auditadas.
--
-- Ninguna RPC borra universidades ni campus, ni cambia el `universidad_id`
-- de un campus o de un dominio (medido: la base no impide mover un campus sin
-- referencias ni un dominio; el candado es que ninguna RPC lo ofrece).
-- Sin `pg_advisory_xact_lock` (decisión del usuario): las carreras las
-- deciden `on conflict`, CAS y los índices únicos. Sin bloques EXCEPTION
-- (supabase/KNOWN_ISSUES.md).

-- ===========================================================================
-- 1. Borrado lógico de dominios
-- ===========================================================================

alter table public.universidad_dominios
  add column activo boolean not null default true;

-- ===========================================================================
-- 2. El hook y el trigger de alta filtran `activo`
-- ===========================================================================
-- Copias literales de la versión vigente; el único cambio es `and d.activo`.

-- Hook (copia literal de 20260929000474:226-257 + and d.activo).
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
        and d.activo
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

-- Trigger de alta (copia literal de 20260924000466:48-65 + and d.activo).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, correo, universidad_id)
  values (
    new.id,
    new.email,
    (select d.universidad_id
       from public.universidad_dominios d
      where d.dominio = split_part(lower(btrim(new.email)), '@', -1)
        and d.activo)
  );
  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

-- ===========================================================================
-- 3. Auditoría: 16 acciones
-- ===========================================================================
-- Las 7 nuevas llevan el nombre de su RPC. Los tipos de objetivo y las claves
-- (`claves_auditoria_ok`, D20) ya cubren universidad, campus y dominio desde
-- 20260930000477, así que no cambian.

alter table private.admin_acciones
  drop constraint admin_acciones_accion_check;

alter table private.admin_acciones
  add constraint admin_acciones_accion_check
  check (accion in ('suspender_usuario', 'reactivar_usuario', 'activar_admin',
                    'desactivar_admin', 'resolver_reporte', 'bloquear_listing',
                    'aprobar_listing', 'restablecer_mfa', 'factores_mfa_borrados',
                    'crear_universidad', 'editar_universidad', 'crear_campus',
                    'editar_campus', 'agregar_dominio', 'desactivar_dominio',
                    'reactivar_dominio'));

-- ===========================================================================
-- 4. Forma de los nombres, en la base (aplica también a Studio)
-- ===========================================================================
-- Normalizado = sin espacios al borde y sin espacios repetidos (cualquier
-- espacio en blanco, NBSP y tabulador incluidos, cuenta como espacio), de 2
-- a 100 caracteres. Producción cumplía antes de esta migración (medido: 0
-- nombres sucios, 0 duplicados sin distinguir mayúsculas).

alter table public.universidades
  add constraint universidades_nombre_normalizado
  check (nombre = btrim(regexp_replace(nombre, '\s+', ' ', 'g'))
         and char_length(nombre) between 2 and 100);

alter table public.campus
  add constraint campus_nombre_normalizado
  check (nombre = btrim(regexp_replace(nombre, '\s+', ' ', 'g'))
         and char_length(nombre) between 2 and 100),
  add constraint campus_ciudad_normalizada
  check (ciudad = btrim(regexp_replace(ciudad, '\s+', ' ', 'g'))
         and char_length(ciudad) between 2 and 100);

-- Los `unique` existentes (sensibles a mayúsculas) se quedan; estos los
-- endurecen. Una universidad o un campus que solo cambian en mayúsculas son
-- el mismo.
create unique index universidades_nombre_lower_key
  on public.universidades (lower(nombre));

create unique index campus_universidad_nombre_lower_key
  on public.campus (universidad_id, lower(nombre));

-- ===========================================================================
-- 5. Proveedores de correo público
-- ===========================================================================
-- Buzones públicos genéricos: nunca identifican a una universidad. Que un
-- admin agregue uno abriría el registro a cualquiera. Solo la consulta
-- `admin.agregar_dominio`; cambiar la lista es un `create or replace` en una
-- migración nueva.

create function private.proveedores_correo_publico()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'gmail.com', 'googlemail.com',
    'hotmail.com', 'hotmail.com.mx', 'hotmail.es',
    'outlook.com', 'outlook.es', 'outlook.com.mx',
    'live.com', 'live.com.mx', 'msn.com',
    'yahoo.com', 'yahoo.com.mx', 'yahoo.es',
    'icloud.com', 'me.com', 'mac.com',
    'protonmail.com', 'proton.me',
    'aol.com', 'gmx.com'
  ]::text[]
$$;

revoke execute on function private.proveedores_correo_publico() from public, anon, authenticated;

-- ===========================================================================
-- 6. Normalización de texto, solo para las RPC
-- ===========================================================================
-- La misma expresión de los checks de (4). Solo la llaman RPC definer.

create function private.normaliza_texto(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(p, '\s+', ' ', 'g'))
$$;

revoke execute on function private.normaliza_texto(text) from public, anon, authenticated;

-- ===========================================================================
-- 7. RPC del catálogo
-- ===========================================================================
-- Plantilla de siempre: definer, `search_path = ''`, primera línea
-- `exigir_admin()`, motivo 3-500 en las escrituras y auditoría en la misma
-- transacción. No aplican `no_sobre_si_mismo` ni `objetivo_es_admin`: no hay
-- personas en juego.

-- 7.1 Lectura -----------------------------------------------------------------
-- Universidades con sus campus y dominios, y conteos. Sin admins ni correos.

create function admin.catalogo()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.exigir_admin();

  return jsonb_build_object('universidades', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', u.id,
             'nombre', u.nombre,
             'usuarios', (select count(*) from public.users x where x.universidad_id = u.id),
             'campus', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'id', c.id,
                        'nombre', c.nombre,
                        'ciudad', c.ciudad,
                        'latitud', c.latitud,
                        'longitud', c.longitud,
                        'usuarios', (select count(*) from public.users x where x.campus_id = c.id),
                        'publicaciones', (select count(*) from public.listings l where l.campus_id = c.id))
                      order by c.nombre)
                 from public.campus c where c.universidad_id = u.id), '[]'::jsonb),
             'dominios', coalesce((
               select jsonb_agg(jsonb_build_object(
                        'dominio', d.dominio,
                        'activo', d.activo,
                        'created_at', d.created_at)
                      order by d.dominio)
                 from public.universidad_dominios d where d.universidad_id = u.id), '[]'::jsonb))
           order by u.nombre)
      from public.universidades u), '[]'::jsonb));
end;
$$;

revoke execute on function admin.catalogo() from public, anon;
grant  execute on function admin.catalogo() to authenticated;

-- 7.2 Universidades -----------------------------------------------------------

create function admin.crear_universidad(p_nombre text, p_motivo text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := btrim(p_motivo);
  v_nombre text := private.normaliza_texto(p_nombre);
  v_id     bigint;
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  if v_nombre is null or char_length(v_nombre) not between 2 and 100 then
    raise exception 'nombre_invalido' using errcode = '22023';
  end if;

  -- Cualquier choque de unicidad (exacto o sin distinguir mayúsculas) da 0
  -- filas, sin 23505 crudo.
  insert into public.universidades (nombre) values (v_nombre)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'nombre_duplicado' using errcode = '23505';
  end if;

  perform private.auditar(
    'crear_universidad', 'universidad', v_id::text,
    null, jsonb_build_object('nombre', v_nombre), v_motivo);

  return v_id;
end;
$$;

revoke execute on function admin.crear_universidad(text, text) from public, anon;
grant  execute on function admin.crear_universidad(text, text) to authenticated;

create function admin.editar_universidad(p_id bigint, p_nombre text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := btrim(p_motivo);
  v_nombre text := private.normaliza_texto(p_nombre);
  v_antes  text;
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  if v_nombre is null or char_length(v_nombre) not between 2 and 100 then
    raise exception 'nombre_invalido' using errcode = '22023';
  end if;

  select u.nombre into v_antes
    from public.universidades u where u.id = p_id
     for update;
  if not found then
    raise exception 'universidad_no_existe' using errcode = 'P0002';
  end if;

  if v_antes = v_nombre then
    raise exception 'sin_cambios' using errcode = '55000';
  end if;

  -- Excluye la propia fila: 'tec' → 'TEC' es un cambio válido. Una carrera
  -- que gane entre esta lectura y el UPDATE sale como 23505 crudo del índice
  -- (documentado; sin advisory lock por decisión del usuario).
  if exists (select 1 from public.universidades u
              where lower(u.nombre) = lower(v_nombre) and u.id <> p_id) then
    raise exception 'nombre_duplicado' using errcode = '23505';
  end if;

  update public.universidades set nombre = v_nombre where id = p_id;

  perform private.auditar(
    'editar_universidad', 'universidad', p_id::text,
    jsonb_build_object('nombre', v_antes), jsonb_build_object('nombre', v_nombre),
    v_motivo);
end;
$$;

revoke execute on function admin.editar_universidad(bigint, text, text) from public, anon;
grant  execute on function admin.editar_universidad(bigint, text, text) to authenticated;

-- 7.3 Campus ------------------------------------------------------------------
-- `editar_campus` NO recibe `universidad_id`: un campus nunca se mueve de
-- universidad. Las coordenadas van las dos o ninguna, en rango; en la
-- edición es reemplazo completo (null/null las borra).

create function admin.crear_campus(
  p_universidad_id bigint, p_nombre text, p_ciudad text,
  p_latitud double precision, p_longitud double precision, p_motivo text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := btrim(p_motivo);
  v_nombre text := private.normaliza_texto(p_nombre);
  v_ciudad text := private.normaliza_texto(p_ciudad);
  v_id     bigint;
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  if v_nombre is null or char_length(v_nombre) not between 2 and 100 then
    raise exception 'nombre_invalido' using errcode = '22023';
  end if;

  if v_ciudad is null or char_length(v_ciudad) not between 2 and 100 then
    raise exception 'ciudad_invalida' using errcode = '22023';
  end if;

  -- `not (… between …)` también es verdadero con NaN: NaN es mayor que todo.
  if (p_latitud is null) <> (p_longitud is null)
     or (p_latitud is not null
         and (not (p_latitud between -90 and 90)
              or not (p_longitud between -180 and 180))) then
    raise exception 'coordenadas_invalidas' using errcode = '22023';
  end if;

  if not exists (select 1 from public.universidades u where u.id = p_universidad_id) then
    raise exception 'universidad_no_existe' using errcode = 'P0002';
  end if;

  insert into public.campus (universidad_id, nombre, ciudad, latitud, longitud)
  values (p_universidad_id, v_nombre, v_ciudad, p_latitud, p_longitud)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    raise exception 'nombre_duplicado' using errcode = '23505';
  end if;

  perform private.auditar(
    'crear_campus', 'campus', v_id::text,
    null,
    jsonb_build_object('nombre', v_nombre, 'ciudad', v_ciudad,
                       'latitud', p_latitud, 'longitud', p_longitud,
                       'universidad_id', p_universidad_id),
    v_motivo);

  return v_id;
end;
$$;

revoke execute on function admin.crear_campus(bigint, text, text, double precision, double precision, text) from public, anon;
grant  execute on function admin.crear_campus(bigint, text, text, double precision, double precision, text) to authenticated;

create function admin.editar_campus(
  p_id bigint, p_nombre text, p_ciudad text,
  p_latitud double precision, p_longitud double precision, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo  text := btrim(p_motivo);
  v_nombre  text := private.normaliza_texto(p_nombre);
  v_ciudad  text := private.normaliza_texto(p_ciudad);
  v_c       public.campus;
  v_antes   jsonb := '{}'::jsonb;
  v_despues jsonb := '{}'::jsonb;
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  if v_nombre is null or char_length(v_nombre) not between 2 and 100 then
    raise exception 'nombre_invalido' using errcode = '22023';
  end if;

  if v_ciudad is null or char_length(v_ciudad) not between 2 and 100 then
    raise exception 'ciudad_invalida' using errcode = '22023';
  end if;

  if (p_latitud is null) <> (p_longitud is null)
     or (p_latitud is not null
         and (not (p_latitud between -90 and 90)
              or not (p_longitud between -180 and 180))) then
    raise exception 'coordenadas_invalidas' using errcode = '22023';
  end if;

  select * into v_c from public.campus c where c.id = p_id for update;
  if not found then
    raise exception 'campus_no_existe' using errcode = 'P0002';
  end if;

  -- Solo las claves que cambian van a la auditoría.
  if v_c.nombre <> v_nombre then
    v_antes := v_antes || jsonb_build_object('nombre', v_c.nombre);
    v_despues := v_despues || jsonb_build_object('nombre', v_nombre);
  end if;
  if v_c.ciudad <> v_ciudad then
    v_antes := v_antes || jsonb_build_object('ciudad', v_c.ciudad);
    v_despues := v_despues || jsonb_build_object('ciudad', v_ciudad);
  end if;
  if v_c.latitud is distinct from p_latitud then
    v_antes := v_antes || jsonb_build_object('latitud', v_c.latitud);
    v_despues := v_despues || jsonb_build_object('latitud', p_latitud);
  end if;
  if v_c.longitud is distinct from p_longitud then
    v_antes := v_antes || jsonb_build_object('longitud', v_c.longitud);
    v_despues := v_despues || jsonb_build_object('longitud', p_longitud);
  end if;

  if v_despues = '{}'::jsonb then
    raise exception 'sin_cambios' using errcode = '55000';
  end if;

  if exists (select 1 from public.campus c
              where c.universidad_id = v_c.universidad_id
                and lower(c.nombre) = lower(v_nombre)
                and c.id <> p_id) then
    raise exception 'nombre_duplicado' using errcode = '23505';
  end if;

  update public.campus
     set nombre = v_nombre, ciudad = v_ciudad,
         latitud = p_latitud, longitud = p_longitud
   where id = p_id;

  perform private.auditar('editar_campus', 'campus', p_id::text,
                          v_antes, v_despues, v_motivo);
end;
$$;

revoke execute on function admin.editar_campus(bigint, text, text, double precision, double precision, text) from public, anon;
grant  execute on function admin.editar_campus(bigint, text, text, double precision, double precision, text) to authenticated;

-- 7.4 Dominios ----------------------------------------------------------------
-- Un dominio no cambia de universidad ni de texto: se agrega, se desactiva o
-- se reactiva. Agregar NUNCA reactiva en silencio. Agregar o reactivar exige
-- que la universidad tenga campus: sin campus, quien se registre se quedaría
-- atascado en "Completar perfil" (CampusBottomSheet.tsx:151-154).

create function admin.agregar_dominio(p_universidad_id bigint, p_dominio text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo  text := btrim(p_motivo);
  v_dominio text := lower(btrim(coalesce(p_dominio, '')));
  v_uni     bigint;
  v_activo  boolean;
  v_nuevo   text;
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  -- Un '@' inicial se tolera ("@uanl.edu.mx"); cualquier otro no.
  if left(v_dominio, 1) = '@' then
    v_dominio := substr(v_dominio, 2);
  end if;

  if char_length(v_dominio) > 253
     or v_dominio !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then
    raise exception 'dominio_invalido' using errcode = '22023';
  end if;

  if v_dominio = any (private.proveedores_correo_publico()) then
    raise exception 'dominio_no_permitido' using errcode = '22023';
  end if;

  if not exists (select 1 from public.universidades u where u.id = p_universidad_id) then
    raise exception 'universidad_no_existe' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.campus c where c.universidad_id = p_universidad_id) then
    raise exception 'universidad_sin_campus' using errcode = '55000';
  end if;

  select d.universidad_id, d.activo into v_uni, v_activo
    from public.universidad_dominios d where d.dominio = v_dominio;
  if found then
    if v_uni <> p_universidad_id then
      raise exception 'dominio_de_otra_universidad' using errcode = '55000';
    elsif v_activo then
      raise exception 'dominio_existe_activo' using errcode = '55000';
    else
      raise exception 'dominio_existe_inactivo' using errcode = '55000';
    end if;
  end if;

  -- Si otra sesión lo insertó entre la lectura y aquí: 0 filas, mismo
  -- mensaje que un activo existente, sin 23505 crudo.
  insert into public.universidad_dominios (dominio, universidad_id)
  values (v_dominio, p_universidad_id)
  on conflict do nothing
  returning dominio into v_nuevo;

  if v_nuevo is null then
    raise exception 'dominio_existe_activo' using errcode = '55000';
  end if;

  perform private.auditar(
    'agregar_dominio', 'dominio', v_dominio,
    null,
    jsonb_build_object('dominio', v_dominio, 'universidad_id', p_universidad_id,
                       'activo', true),
    v_motivo);
end;
$$;

revoke execute on function admin.agregar_dominio(bigint, text, text) from public, anon;
grant  execute on function admin.agregar_dominio(bigint, text, text) to authenticated;

create function admin.desactivar_dominio(p_dominio text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo  text := btrim(p_motivo);
  v_dominio text := lower(btrim(coalesce(p_dominio, '')));
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  if not exists (select 1 from public.universidad_dominios d where d.dominio = v_dominio) then
    raise exception 'dominio_no_existe' using errcode = 'P0002';
  end if;

  -- Desactivar no toca a nadie ya registrado: la universidad se fija en el
  -- alta. Se permite aunque sea el último dominio activo (el panel avisa).
  update public.universidad_dominios
     set activo = false
   where dominio = v_dominio and activo;
  if not found then
    raise exception 'dominio_ya_inactivo' using errcode = '55000';
  end if;

  perform private.auditar(
    'desactivar_dominio', 'dominio', v_dominio,
    jsonb_build_object('activo', true), jsonb_build_object('activo', false),
    v_motivo);
end;
$$;

revoke execute on function admin.desactivar_dominio(text, text) from public, anon;
grant  execute on function admin.desactivar_dominio(text, text) to authenticated;

create function admin.reactivar_dominio(p_dominio text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo  text := btrim(p_motivo);
  v_dominio text := lower(btrim(coalesce(p_dominio, '')));
  v_uni     bigint;
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  select d.universidad_id into v_uni
    from public.universidad_dominios d where d.dominio = v_dominio;
  if not found then
    raise exception 'dominio_no_existe' using errcode = 'P0002';
  end if;

  if not exists (select 1 from public.campus c where c.universidad_id = v_uni) then
    raise exception 'universidad_sin_campus' using errcode = '55000';
  end if;

  update public.universidad_dominios
     set activo = true
   where dominio = v_dominio and not activo;
  if not found then
    raise exception 'dominio_ya_activo' using errcode = '55000';
  end if;

  perform private.auditar(
    'reactivar_dominio', 'dominio', v_dominio,
    jsonb_build_object('activo', false), jsonb_build_object('activo', true),
    v_motivo);
end;
$$;

revoke execute on function admin.reactivar_dominio(text, text) from public, anon;
grant  execute on function admin.reactivar_dominio(text, text) to authenticated;
