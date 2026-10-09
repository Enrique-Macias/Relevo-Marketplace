-- Relevo — RF-17 Ola 6: actividad diaria y métricas del panel de admin.
-- Plan: docs/rf17-ola6-plan.md (v1 FINAL, decisiones D-1..D-19). Fecha según
-- D17: el día real (2026-10-09) no es menor que la última migración, así que
-- lleva la fecha real y el siguiente consecutivo.
--
-- Qué hace, en orden:
--   1. `public.actividad_diaria`: como máximo una señal de uso por persona y
--      día (hora de México). Su única finalidad es la métrica agregada
--      "usuarios activos" de RNF-10 (D-6). El cliente solo puede insertar su
--      propio `user_id`; el día lo pone el servidor.
--   2. `private.actividad_parametros`: el inicio técnico real del registro
--      (`inicio`), fijado al aplicar esta migración. NO es la fecha de
--      lanzamiento comercial y normalmente no se modifica (plan §2.1.b).
--   3. `private.actividad_retenida_desde()`: la ÚNICA fuente del corte de 90
--      días. La usan la purga y las dos RPC: ningún otro literal 89/90.
--   4. La purga diaria con pg_cron (`purga-actividad-diaria`).
--   5. `admin.metricas` (una fila por día) y `admin.metricas_resumen` (totales
--      del rango y cobertura de los activos). Solo agregados.
--
-- Sin índices nuevos: medido en F4 con volumen sintético (todas las llamadas
-- por debajo de 0.3 s; los índices sobre `created_at` empeoran el rango de
-- 366 días y el de `actividad_diaria(dia)` solo ayuda si la purga no corre).
-- Sin bloques EXCEPTION (supabase/KNOWN_ISSUES.md).

-- ===========================================================================
-- 1. public.actividad_diaria
-- ===========================================================================
--
-- Una fila por (persona, día de México). La PK hace que la segunda señal del
-- mismo día sea un 23505, que el cliente trata como éxito.
--
-- El cliente hace `insert({ user_id })` PLANO, sin upsert, sin
-- `ignoreDuplicates` y sin `.select()` (medido, docs/rf17-ola6-plan.md,
-- anexo C): PostgREST siempre pone target en el ON CONFLICT, y un target
-- exige SELECT sobre sus columnas (42501). Dar ese SELECT obligaría además a
-- una policy de SELECT, y el usuario podría leer su propio historial de días.
--
-- `on delete cascade`: eliminar la cuenta borra en el acto toda su actividad.

create table public.actividad_diaria (
  user_id uuid not null references public.users(id) on delete cascade,
  dia     date not null default (now() at time zone 'America/Mexico_City')::date,
  primary key (user_id, dia)
);

-- pg_default_acl le da arwdDxtm a anon y authenticated sobre toda tabla nueva
-- de `public` (CLAUDE.md §9): el revoke va primero y el grant es el mínimo.
revoke all on public.actividad_diaria from public, anon, authenticated;
grant insert (user_id) on public.actividad_diaria to authenticated;

alter table public.actividad_diaria enable row level security;

-- Sin `is_active_user()` a propósito (D-5): un suspendido sigue pudiendo usar
-- la app para leer, y cuenta como activo. Sin policy de SELECT, UPDATE ni
-- DELETE: el cliente no lee, no corrige y no borra su actividad.
create policy actividad_diaria_insert_own on public.actividad_diaria
  for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ===========================================================================
-- 2. private.actividad_parametros: el inicio del registro
-- ===========================================================================
--
-- Un solo renglón, fijado aquí con el día de México en que se aplica esta
-- migración en cada entorno. Es lo que hace verdaderos los NULL de D-4 (antes
-- del inicio, "Sin datos"). No es `min(dia)`: ese valor lo mueven el cascade y
-- la purga. Guarda SOLO el inicio: los 90 días viven en la función de abajo,
-- porque cambiarlos cambia afirmaciones legales y debe pasar por una
-- migración, no por un UPDATE.
--
-- RLS habilitado y cero policies, igual que `moderacion_retenida`: el
-- `revoke all` es el control de acceso. Solo lo leen las RPC definer.

create table private.actividad_parametros (
  id     smallint primary key default 1 check (id = 1),
  inicio date not null
);

revoke all on private.actividad_parametros from public, anon, authenticated;
alter table private.actividad_parametros enable row level security;

insert into private.actividad_parametros (id, inicio)
values (1, (now() at time zone 'America/Mexico_City')::date);

-- ===========================================================================
-- 3. private.actividad_retenida_desde(): el corte de 90 días
-- ===========================================================================
--
-- Una fila se conserva mientras `dia >= hoy - 89`: los 90 días calendario de
-- México más recientes, hoy incluido. Una fila con `dia = hoy - 90` (hace
-- exactamente 90 días) ya es purgable, y las métricas la tratan como "Sin
-- datos" aunque la purga todavía no haya corrido.

create function private.actividad_retenida_desde()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Mexico_City')::date - 89
$$;

revoke execute on function private.actividad_retenida_desde() from public, anon, authenticated;

-- ===========================================================================
-- 4. La purga (pg_cron)
-- ===========================================================================
--
-- Mismo patrón que `purga-moderacion-retenida` (20261007000482): pg_cron ya
-- está instalado; `cron.schedule` con nombre es idempotente. Diaria a las
-- 06:23 UTC = 00:23 en México (sin horario de verano desde 2022), poco
-- después del cambio de día y sin coincidir con la purga de las 04:17. El
-- comando llama a la función: el corte tiene una sola fuente.
--
-- Las métricas no dependen de que este job corra: filtran con la misma
-- función. Si se atrasa o falla, el resultado no cambia; el riesgo es solo de
-- minimización, y se trata como incidente operativo.

select cron.schedule(
  'purga-actividad-diaria',
  '23 6 * * *',
  $$delete from public.actividad_diaria where dia < private.actividad_retenida_desde()$$
);

-- ===========================================================================
-- 5. admin.metricas y admin.metricas_resumen
-- ===========================================================================
--
-- Reglas comunes (D-1..D-19):
--   - Hora de México. El rango termina como mucho hoy (México) y dura como
--     mucho 366 días.
--   - Se excluye a toda cuenta con fila en `private.admins` (activada o no),
--     en las cuatro métricas. Los suspendidos SÍ cuentan (D-5).
--   - Altas (D-7): toda fila de `public.users`, por `users.universidad_id`.
--   - Publicaciones creadas (D-10): todas las existentes, en cualquier estado,
--     por `listings.universidad_id`.
--   - Contactos (D-8, D-9): `count(*)` de taps, por la universidad de la
--     PUBLICACIÓN.
--   - Usuarios activos: NULL ("Sin datos") antes del inicio del registro o
--     fuera de los 90 días retenidos; dentro, el conteo real, 0 incluido.
--   - Solo agregados: ninguna de las dos devuelve quién.
--   - Cuentas y publicaciones eliminadas desaparecen de la historia (cascade);
--     el snapshot que lo corregiría es posterior (D11).

-- Una fila por día del rango.
create function admin.metricas(p_desde date, p_hasta date, p_universidad_id bigint default null)
returns table(dia date, altas int, usuarios_activos int, publicaciones_creadas int, contactos int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoy       date := (now() at time zone 'America/Mexico_City')::date;
  v_cobertura date;
  v_ini       timestamptz;
  v_fin       timestamptz;
begin
  perform private.exigir_admin();

  if p_desde is null or p_hasta is null or p_desde > p_hasta or p_hasta > v_hoy then
    raise exception 'rango_invalido' using errcode = '22023';
  end if;
  if p_hasta - p_desde + 1 > 366 then
    raise exception 'rango_demasiado_largo' using errcode = '22023';
  end if;
  if p_universidad_id is not null
     and not exists (select 1 from public.universidades un where un.id = p_universidad_id) then
    raise exception 'universidad_no_existe' using errcode = 'P0002';
  end if;

  -- Primer día con dato de actividad: el más reciente entre el inicio del
  -- registro y el corte de retención.
  select greatest(p.inicio, private.actividad_retenida_desde())
    into v_cobertura
    from private.actividad_parametros p
   where p.id = 1;

  v_ini := p_desde::timestamp at time zone 'America/Mexico_City';
  v_fin := (p_hasta + 1)::timestamp at time zone 'America/Mexico_City';

  return query
  with dias as (
    select g::date as d
      from generate_series(p_desde::timestamp, p_hasta::timestamp, interval '1 day') g
  ),
  al as (
    select (u.created_at at time zone 'America/Mexico_City')::date as d, count(*)::int as n
      from public.users u
     where u.created_at >= v_ini and u.created_at < v_fin
       and (p_universidad_id is null or u.universidad_id = p_universidad_id)
       and not exists (select 1 from private.admins a where a.user_id = u.id)
     group by 1
  ),
  pu as (
    select (l.created_at at time zone 'America/Mexico_City')::date as d, count(*)::int as n
      from public.listings l
     where l.created_at >= v_ini and l.created_at < v_fin
       and (p_universidad_id is null or l.universidad_id = p_universidad_id)
       and not exists (select 1 from private.admins a where a.user_id = l.user_id)
     group by 1
  ),
  co as (
    select (c.created_at at time zone 'America/Mexico_City')::date as d, count(*)::int as n
      from public.listing_contacts c
      join public.listings l on l.id = c.listing_id
     where c.created_at >= v_ini and c.created_at < v_fin
       and (p_universidad_id is null or l.universidad_id = p_universidad_id)
       and not exists (select 1 from private.admins a where a.user_id = c.user_id)
     group by 1
  ),
  ac as (
    -- La PK garantiza una fila por persona y día: count(*) son personas.
    select x.dia as d, count(*)::int as n
      from public.actividad_diaria x
      join public.users u on u.id = x.user_id
     where x.dia between greatest(p_desde, v_cobertura) and p_hasta
       and (p_universidad_id is null or u.universidad_id = p_universidad_id)
       and not exists (select 1 from private.admins a where a.user_id = x.user_id)
     group by 1
  )
  select dias.d,
         coalesce(al.n, 0),
         case when dias.d < v_cobertura then null else coalesce(ac.n, 0) end,
         coalesce(pu.n, 0),
         coalesce(co.n, 0)
    from dias
    left join al on al.d = dias.d
    left join pu on pu.d = dias.d
    left join co on co.d = dias.d
    left join ac on ac.d = dias.d
   order by dias.d;
end;
$$;

revoke execute on function admin.metricas(date, date, bigint) from public, anon;
grant  execute on function admin.metricas(date, date, bigint) to authenticated;

-- Totales del rango y cobertura de los activos. Siempre una fila.
--   - altas, publicaciones_creadas y contactos: conteos directos del rango,
--     iguales a la suma de los diarios por construcción.
--   - usuarios_activos_distintos: PERSONAS DISTINTAS entre activos_desde y
--     activos_hasta. Nunca la suma de los activos diarios.
--   - activos_desde: el más reciente entre p_desde, el inicio del registro y
--     el corte de retención; NULL si eso cae después de p_hasta.
--   - activos_cobertura: 'completa' | 'parcial' | 'sin_datos'.
create function admin.metricas_resumen(p_desde date, p_hasta date, p_universidad_id bigint default null)
returns table(desde date, hasta date, altas int, publicaciones_creadas int, contactos int,
              usuarios_activos_distintos int, inicio_tracking date, retencion_dias int,
              activos_desde date, activos_hasta date, activos_cobertura text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hoy         date := (now() at time zone 'America/Mexico_City')::date;
  v_retenida    date := private.actividad_retenida_desde();
  v_inicio      date;
  v_desde_act   date;
  v_ini         timestamptz;
  v_fin         timestamptz;
begin
  perform private.exigir_admin();

  if p_desde is null or p_hasta is null or p_desde > p_hasta or p_hasta > v_hoy then
    raise exception 'rango_invalido' using errcode = '22023';
  end if;
  if p_hasta - p_desde + 1 > 366 then
    raise exception 'rango_demasiado_largo' using errcode = '22023';
  end if;
  if p_universidad_id is not null
     and not exists (select 1 from public.universidades un where un.id = p_universidad_id) then
    raise exception 'universidad_no_existe' using errcode = 'P0002';
  end if;

  select p.inicio into v_inicio from private.actividad_parametros p where p.id = 1;

  v_desde_act := greatest(p_desde, v_inicio, v_retenida);
  if v_desde_act > p_hasta then
    v_desde_act := null;
  end if;

  v_ini := p_desde::timestamp at time zone 'America/Mexico_City';
  v_fin := (p_hasta + 1)::timestamp at time zone 'America/Mexico_City';

  return query
  select p_desde,
         p_hasta,
         (select count(*)::int
            from public.users u
           where u.created_at >= v_ini and u.created_at < v_fin
             and (p_universidad_id is null or u.universidad_id = p_universidad_id)
             and not exists (select 1 from private.admins a where a.user_id = u.id)),
         (select count(*)::int
            from public.listings l
           where l.created_at >= v_ini and l.created_at < v_fin
             and (p_universidad_id is null or l.universidad_id = p_universidad_id)
             and not exists (select 1 from private.admins a where a.user_id = l.user_id)),
         (select count(*)::int
            from public.listing_contacts c
            join public.listings l on l.id = c.listing_id
           where c.created_at >= v_ini and c.created_at < v_fin
             and (p_universidad_id is null or l.universidad_id = p_universidad_id)
             and not exists (select 1 from private.admins a where a.user_id = c.user_id)),
         case when v_desde_act is null then null else
           (select count(distinct x.user_id)::int
              from public.actividad_diaria x
              join public.users u on u.id = x.user_id
             where x.dia between v_desde_act and p_hasta
               and (p_universidad_id is null or u.universidad_id = p_universidad_id)
               and not exists (select 1 from private.admins a where a.user_id = x.user_id))
         end,
         v_inicio,
         (v_hoy - v_retenida + 1)::int,
         v_desde_act,
         case when v_desde_act is null then null else p_hasta end,
         case when v_desde_act is null then 'sin_datos'
              when v_desde_act = p_desde then 'completa'
              else 'parcial' end;
end;
$$;

revoke execute on function admin.metricas_resumen(date, date, bigint) from public, anon;
grant  execute on function admin.metricas_resumen(date, date, bigint) to authenticated;
