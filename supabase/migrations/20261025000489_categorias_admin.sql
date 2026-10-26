-- Relevo — DESIGN-1 fase 4: categoría `Alimentos` y CRUD de categorías en el
-- panel de admin. Plan: docs/design-1-fase4-plan.md (D1-D4).
--
-- Qué hace, en orden:
--   1. `categories` gana `orden` (único, diferible), `icono` (lista CERRADA
--      de las llaves que la app sabe pintar) y `activa`. Backfill: `orden` =
--      id e `icono` = el slug de los 12 nombres del seed (medido en remoto el
--      2026-10-25: ids 1-12 con esos nombres exactos).
--   2. Forma del nombre (normalizado, 2-50) e índice único sin distinguir
--      mayúsculas. Expresión AUTOCONTENIDA, como en 20261008000484:146-160.
--   3. `Alimentos`, justo antes de "Otros", SOLO si "Otros" existe (remoto).
--      En un `db reset` la tabla está vacía aquí y la siembra `seed.sql`.
--   4. Candado de inactiva (D1): no se elige una categoría desactivada al
--      crear una publicación, al CAMBIARLE la categoría ni al agregar un
--      interés. Lo que ya estaba en ella se conserva.
--   5. Auditoría: `objetivo_tipo` suma 'categoria', sus claves en
--      `claves_auditoria_ok` y 5 acciones nuevas (16 → 21).
--   6. Las 6 RPC de `admin` (lectura + 5 escrituras).
--
-- Grants: ninguno nuevo. `categories` tiene `grant select` de TABLA
-- (20260906000437:97), que cubre las columnas nuevas (mismo caso que
-- `campus.latitud`, 20260925000467). Sin bloques EXCEPTION
-- (supabase/KNOWN_ISSUES.md) y sin advisory lock: las escrituras que tocan
-- `orden` toman FOR UPDATE de todas las filas (son ~13).

-- ===========================================================================
-- 1. Columnas nuevas
-- ===========================================================================

alter table public.categories
  add column orden  integer,
  add column icono  text,
  add column activa boolean not null default true;

update public.categories set
  orden = id,
  icono = case nombre
            when 'Libros'              then 'libros'
            when 'Electrónica'         then 'electronica'
            when 'Muebles'             then 'muebles'
            when 'Ropa'                then 'ropa'
            when 'Deportes'            then 'deportes'
            when 'Apuntes'             then 'apuntes'
            when 'Hogar'               then 'hogar'
            when 'Papelería'           then 'papeleria'
            when 'Instrumentos'        then 'instrumentos'
            when 'Arte y manualidades' then 'arte-y-manualidades'
            when 'Boletos y eventos'   then 'boletos-y-eventos'
            else 'otros'
          end;

alter table public.categories
  alter column orden set not null,
  alter column icono set not null,
  -- Diferible: reordenar intercambia posiciones dentro de una transacción.
  add constraint categories_orden_key unique (orden) deferrable initially deferred,
  add constraint categories_orden_positivo check (orden > 0),
  -- Las llaves de `PATHS` en src/components/icons/categories.tsx. Un ícono
  -- nuevo exige código y una versión de la app (D2), y una migración aquí.
  add constraint categories_icono_check
  check (icono in ('libros', 'electronica', 'muebles', 'ropa', 'deportes',
                   'apuntes', 'hogar', 'papeleria', 'instrumentos',
                   'arte-y-manualidades', 'boletos-y-eventos', 'alimentos',
                   'otros'));

-- ===========================================================================
-- 2. Forma del nombre
-- ===========================================================================

alter table public.categories
  add constraint categories_nombre_normalizado
  check (nombre = btrim(regexp_replace(nombre, '\s+', ' ', 'g'))
         and char_length(nombre) between 2 and 50);

create unique index categories_nombre_lower_key
  on public.categories (lower(nombre));

-- ===========================================================================
-- 3. Alimentos, antes de "Otros"
-- ===========================================================================

update public.categories set orden = orden + 1 where nombre = 'Otros';

insert into public.categories (nombre, orden, icono)
select 'Alimentos', c.orden - 1, 'alimentos'
  from public.categories c
 where c.nombre = 'Otros'
on conflict (nombre) do nothing;

-- ===========================================================================
-- 4. No se elige una categoría inactiva
-- ===========================================================================
-- Para todos los roles, también Studio (como `dueno_no_activo`, …480): una
-- categoría desactivada es un hecho del catálogo, no un permiso. Dos triggers
-- por tabla de publicaciones porque el WHEN de INSERT no puede mirar `old`.

create function private.exige_categoria_activa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.categories c
                  where c.id = new.categoria_id and c.activa) then
    raise exception 'categoria_inactiva' using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke execute on function private.exige_categoria_activa() from public, anon, authenticated;

create trigger listings_exige_categoria_activa_ins
  before insert on public.listings
  for each row execute function private.exige_categoria_activa();

create trigger listings_exige_categoria_activa_upd
  before update of categoria_id on public.listings
  for each row
  when (old.categoria_id is distinct from new.categoria_id)
  execute function private.exige_categoria_activa();

create trigger user_intereses_exige_categoria_activa
  before insert on public.user_intereses
  for each row execute function private.exige_categoria_activa();

-- ===========================================================================
-- 5. Auditoría
-- ===========================================================================

alter table private.admin_acciones
  drop constraint admin_acciones_objetivo_tipo_check;

alter table private.admin_acciones
  add constraint admin_acciones_objetivo_tipo_check
  check (objetivo_tipo in ('reporte', 'listing', 'usuario', 'universidad',
                           'campus', 'dominio', 'admin', 'categoria'));

alter table private.admin_acciones
  drop constraint admin_acciones_accion_check;

alter table private.admin_acciones
  add constraint admin_acciones_accion_check
  check (accion in ('suspender_usuario', 'reactivar_usuario', 'activar_admin',
                    'desactivar_admin', 'resolver_reporte', 'bloquear_listing',
                    'aprobar_listing', 'restablecer_mfa', 'factores_mfa_borrados',
                    'crear_universidad', 'editar_universidad', 'crear_campus',
                    'editar_campus', 'agregar_dominio', 'desactivar_dominio',
                    'reactivar_dominio', 'crear_categoria', 'editar_categoria',
                    'desactivar_categoria', 'reactivar_categoria',
                    'reordenar_categorias'));

-- Copia literal de 20261008000483:67-86 más la rama 'categoria'. Misma firma:
-- el CHECK que la usa sigue apuntando a ella, y solo SE AGREGA un tipo.
create or replace function private.claves_auditoria_ok(p_tipo text, p jsonb)
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
                       when 'admin'       then array['activado_at', 'factores_borrados', 'factores_totp']
                       when 'categoria'   then array['nombre', 'icono', 'orden', 'activa']
                       else array[]::text[]
                     end)));
$$;

revoke execute on function private.claves_auditoria_ok(text, jsonb) from public, anon, authenticated;

-- ===========================================================================
-- 6. RPC de categorías
-- ===========================================================================
-- Plantilla de 20261008000484 §7: definer, `search_path = ''`, primera línea
-- `exigir_admin()`, motivo 3-500 y auditoría en la misma transacción.

-- 6.1 Lectura -----------------------------------------------------------------

create function admin.categorias()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.exigir_admin();

  return jsonb_build_object('categorias', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', c.id,
             'nombre', c.nombre,
             'icono', c.icono,
             'orden', c.orden,
             'activa', c.activa,
             'publicaciones', (select count(*) from public.listings l where l.categoria_id = c.id),
             'intereses', (select count(*) from public.user_intereses i where i.categoria_id = c.id))
           order by c.orden)
      from public.categories c), '[]'::jsonb));
end;
$$;

revoke execute on function admin.categorias() from public, anon;
grant  execute on function admin.categorias() to authenticated;

-- 6.2 Crear y editar --------------------------------------------------------
-- Una categoría nueva entra al final; si la última es "Otros" (ícono
-- `otros`), entra justo antes de ella.

create function admin.crear_categoria(p_nombre text, p_icono text, p_motivo text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := btrim(p_motivo);
  v_nombre text := private.normaliza_texto(p_nombre);
  v_ultima public.categories;
  v_orden  integer;
  v_id     bigint;
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  if v_nombre is null or char_length(v_nombre) not between 2 and 50 then
    raise exception 'nombre_invalido' using errcode = '22023';
  end if;

  if p_icono is null or p_icono not in ('libros', 'electronica', 'muebles', 'ropa',
       'deportes', 'apuntes', 'hogar', 'papeleria', 'instrumentos',
       'arte-y-manualidades', 'boletos-y-eventos', 'alimentos', 'otros') then
    raise exception 'icono_invalido' using errcode = '22023';
  end if;

  -- Serializa con cualquier otra escritura de `orden`.
  perform 1 from public.categories for update;

  if exists (select 1 from public.categories c where lower(c.nombre) = lower(v_nombre)) then
    raise exception 'nombre_duplicado' using errcode = '23505';
  end if;

  select * into v_ultima from public.categories c order by c.orden desc limit 1;

  if not found then
    v_orden := 1;
  elsif v_ultima.icono = 'otros' then
    v_orden := v_ultima.orden;
    update public.categories set orden = orden + 1 where id = v_ultima.id;
  else
    v_orden := v_ultima.orden + 1;
  end if;

  -- Sin `on conflict`: no admite el unique diferible de `orden` como
  -- árbitro. El nombre ya se comprobó con todas las filas bloqueadas; solo
  -- una alta concurrente desde Studio podría dar un 23505 crudo.
  insert into public.categories (nombre, icono, orden)
  values (v_nombre, p_icono, v_orden)
  returning id into v_id;

  perform private.auditar(
    'crear_categoria', 'categoria', v_id::text,
    null,
    jsonb_build_object('nombre', v_nombre, 'icono', p_icono, 'orden', v_orden,
                       'activa', true),
    v_motivo);

  return v_id;
end;
$$;

revoke execute on function admin.crear_categoria(text, text, text) from public, anon;
grant  execute on function admin.crear_categoria(text, text, text) to authenticated;

create function admin.editar_categoria(p_id bigint, p_nombre text, p_icono text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo  text := btrim(p_motivo);
  v_nombre  text := private.normaliza_texto(p_nombre);
  v_c       public.categories;
  v_antes   jsonb := '{}'::jsonb;
  v_despues jsonb := '{}'::jsonb;
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  if v_nombre is null or char_length(v_nombre) not between 2 and 50 then
    raise exception 'nombre_invalido' using errcode = '22023';
  end if;

  if p_icono is null or p_icono not in ('libros', 'electronica', 'muebles', 'ropa',
       'deportes', 'apuntes', 'hogar', 'papeleria', 'instrumentos',
       'arte-y-manualidades', 'boletos-y-eventos', 'alimentos', 'otros') then
    raise exception 'icono_invalido' using errcode = '22023';
  end if;

  select * into v_c from public.categories c where c.id = p_id for update;
  if not found then
    raise exception 'categoria_no_existe' using errcode = 'P0002';
  end if;

  if v_c.nombre <> v_nombre then
    v_antes := v_antes || jsonb_build_object('nombre', v_c.nombre);
    v_despues := v_despues || jsonb_build_object('nombre', v_nombre);
  end if;
  if v_c.icono <> p_icono then
    v_antes := v_antes || jsonb_build_object('icono', v_c.icono);
    v_despues := v_despues || jsonb_build_object('icono', p_icono);
  end if;

  if v_despues = '{}'::jsonb then
    raise exception 'sin_cambios' using errcode = '55000';
  end if;

  -- Excluye la propia fila: 'ropa' → 'Ropa' es un cambio válido.
  if exists (select 1 from public.categories c
              where lower(c.nombre) = lower(v_nombre) and c.id <> p_id) then
    raise exception 'nombre_duplicado' using errcode = '23505';
  end if;

  update public.categories set nombre = v_nombre, icono = p_icono where id = p_id;

  perform private.auditar('editar_categoria', 'categoria', p_id::text,
                          v_antes, v_despues, v_motivo);
end;
$$;

revoke execute on function admin.editar_categoria(bigint, text, text, text) from public, anon;
grant  execute on function admin.editar_categoria(bigint, text, text, text) to authenticated;

-- 6.3 Desactivar y reactivar (D1: no hay borrado) ----------------------------
-- Desactivar no toca publicaciones ni intereses: conservan su categoría.

create function admin.desactivar_categoria(p_id bigint, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := btrim(p_motivo);
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  if not exists (select 1 from public.categories c where c.id = p_id) then
    raise exception 'categoria_no_existe' using errcode = 'P0002';
  end if;

  update public.categories set activa = false where id = p_id and activa;
  if not found then
    raise exception 'categoria_ya_inactiva' using errcode = '55000';
  end if;

  perform private.auditar(
    'desactivar_categoria', 'categoria', p_id::text,
    jsonb_build_object('activa', true), jsonb_build_object('activa', false),
    v_motivo);
end;
$$;

revoke execute on function admin.desactivar_categoria(bigint, text) from public, anon;
grant  execute on function admin.desactivar_categoria(bigint, text) to authenticated;

create function admin.reactivar_categoria(p_id bigint, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := btrim(p_motivo);
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  if not exists (select 1 from public.categories c where c.id = p_id) then
    raise exception 'categoria_no_existe' using errcode = 'P0002';
  end if;

  update public.categories set activa = true where id = p_id and not activa;
  if not found then
    raise exception 'categoria_ya_activa' using errcode = '55000';
  end if;

  perform private.auditar(
    'reactivar_categoria', 'categoria', p_id::text,
    jsonb_build_object('activa', false), jsonb_build_object('activa', true),
    v_motivo);
end;
$$;

revoke execute on function admin.reactivar_categoria(bigint, text) from public, anon;
grant  execute on function admin.reactivar_categoria(bigint, text) to authenticated;

-- 6.4 Reordenar (D3) ----------------------------------------------------------
-- Recibe el orden COMPLETO: todas las ids, una vez cada una. Si el conjunto
-- no es exactamente el actual (otra persona creó una mientras tanto),
-- `orden_desactualizado`. Una fila de auditoría por categoría que se movió
-- (las claves no admiten arreglos, D20).

create function admin.reordenar_categorias(p_ids bigint[], p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo  text := btrim(p_motivo);
  v_n       integer := coalesce(cardinality(p_ids), 0);
  r         record;
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  perform 1 from public.categories for update;

  -- Mismo conjunto, sin repetidos ni nulos.
  if v_n = 0
     or v_n <> (select count(*) from public.categories)
     or v_n <> (select count(distinct x) from unnest(p_ids) x where x is not null)
     or exists (select 1 from unnest(p_ids) x
                 where not exists (select 1 from public.categories c where c.id = x)) then
    raise exception 'orden_desactualizado' using errcode = '55000';
  end if;

  -- Se compara el ORDEN, no los números: con huecos (una alta desde Studio,
  -- p. ej.) el mismo orden reasignado a 1..n no es un cambio que auditar.
  if p_ids = (select array_agg(c.id order by c.orden) from public.categories c) then
    raise exception 'sin_cambios' using errcode = '55000';
  end if;

  -- El orden queda en 1..n. Se audita cada categoría cuyo número cambió.
  for r in
    select c.id, c.orden as antes, n.pos::integer as despues
      from unnest(p_ids) with ordinality as n(id, pos)
      join public.categories c on c.id = n.id
     where c.orden <> n.pos
     order by n.pos
  loop
    update public.categories set orden = r.despues where id = r.id;
    perform private.auditar(
      'reordenar_categorias', 'categoria', r.id::text,
      jsonb_build_object('orden', r.antes), jsonb_build_object('orden', r.despues),
      v_motivo);
  end loop;
end;
$$;

revoke execute on function admin.reordenar_categorias(bigint[], text) from public, anon;
grant  execute on function admin.reordenar_categorias(bigint[], text) to authenticated;
