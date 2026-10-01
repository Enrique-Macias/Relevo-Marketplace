-- Relevo — RF-17, Ola 2: reportes desde el panel de administración.
--
-- Plan: docs/rf17-plan-admin.md (§4 la plantilla de toda RPC, §13 los
-- reportes cuyo objetivo ya no existe) y las decisiones D-B1…D-B5 de la Ola 2.
-- Lo que agrega:
--
--   1. `admin_acciones_accion_check` admite `resolver_reporte` y
--      `bloquear_listing` (antes solo las 3 acciones de la Ola 1).
--   2. `reports.resolved_at` la escribe UN trigger (D-B1), no la RPC: así
--      también la sella una resolución hecha desde Studio. Sin la cláusula
--      `reporter_id is not null` del aviso: un reporte de una cuenta eliminada
--      también se resuelve.
--   3. `admin.listar_reportes`, `admin.resolver_reporte`, `admin.detalle_listing`
--      y `admin.bloquear_listing`.
--   4. La policy de Storage del admin sobre `listing-photos` (D19). La del
--      DUEÑO sobre una `bloqueada` es de la Ola 4 (D5), no de aquí.
--
-- Toda función de `admin.*` sigue la plantilla de 20260930000477: definer,
-- `set search_path = ''`, `perform private.exigir_admin()` como primera línea,
-- `revoke … from public, anon` + `grant execute … to authenticated`. T12 lo
-- vigila con una invariante genérica sobre el schema, no con una lista.

-- ---------------------------------------------------------------------------
-- 1. Acciones auditables
-- ---------------------------------------------------------------------------
--
-- Drop + add en la misma migración: no hay ventana sin check. Las 3 acciones
-- de la Ola 1 se conservan tal cual (medido con pg_get_constraintdef antes de
-- escribir esto).

alter table private.admin_acciones
  drop constraint admin_acciones_accion_check;

alter table private.admin_acciones
  add constraint admin_acciones_accion_check
  check (accion in ('suspender_usuario', 'reactivar_usuario', 'activar_admin',
                    'resolver_reporte', 'bloquear_listing'));

-- ---------------------------------------------------------------------------
-- 2. reports.resolved_at (D-B1)
-- ---------------------------------------------------------------------------
--
-- Sale de `pendiente` → se sella con now(). Vuelve a `pendiente` (solo Studio:
-- la RPC no lo permite) → vuelve a NULL. Entre `resuelto` y `descartado`
-- conserva la fecha de la primera resolución.
--
-- INVOKER: solo reescribe NEW, no lee ni escribe otras filas (el criterio de
-- 20260906000439:31). Revocada a todos: Postgres verifica EXECUTE al CREAR el
-- trigger, no al dispararlo, así que nadie más la necesita.
--
-- NO copia la cláusula `new.reporter_id is not null` del WHEN de
-- `reports_notify_resolved` (20260930000476): esa cláusula existe para no
-- insertar un aviso sin destinatario; la fecha de resolución no tiene
-- destinatario y se escribe siempre.
--
-- Orden de disparo (mismo evento BEFORE UPDATE, alfabético por nombre):
-- `reports_anonimiza` (OF reported_user_id) y luego `reports_sella_resolved_at`
-- (OF estado). Columnas distintas: no interactúan. El AFTER
-- `reports_notify_resolved` corre después y no lee `resolved_at`.

create function private.sella_resolved_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.estado = 'pendiente' then
    new.resolved_at := null;
  elsif old.estado = 'pendiente' then
    new.resolved_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function private.sella_resolved_at() from public, anon, authenticated;

create trigger reports_sella_resolved_at
  before update of estado on public.reports
  for each row
  when (old.estado is distinct from new.estado)
  execute function private.sella_resolved_at();

-- ---------------------------------------------------------------------------
-- 3a. admin.listar_reportes
-- ---------------------------------------------------------------------------
--
-- SOLO left joins y ningún filtro por "objetivo existente": un reporte nunca
-- se esconde (§13). `objetivo_tipo` usa la misma clasificación que
-- `notify_report_resolved` (20260911000451:160-163), extendida a los 4 casos.
--
-- `p_estado` es TEXT y no `report_status`: con el enum, un valor ajeno falla
-- con 22P02 al convertirse, antes de entrar aquí, y el panel no lo podría
-- distinguir. NULL = todos (intencional). La validación es null-safe: con
-- `not in (...)` a secas, NULL daría NULL y no lanzaría, pero aquí NULL es un
-- valor válido, así que se pregunta antes.
--
-- `reportes_mismo_objetivo` cuenta por `listing_id` o por `reported_user_id`,
-- en cualquier estado, y es NULL para los objetivos eliminados: agrupar por
-- `listing_titulo` juntaría publicaciones distintas con el mismo título.
--
-- Cursor por `id` (bigint identity ALWAYS, medido): orden `id desc`, la
-- página siguiente pide `id < p_cursor`. Tope de 100 filas aunque se pidan
-- más; `max_rows` de PostgREST no reemplaza este tope.

create function admin.listar_reportes(
  p_estado text default 'pendiente',
  p_cursor bigint default null,
  p_limit int default 50
)
returns table (
  id                      bigint,
  motivo                  public.report_reason,
  comentario              text,
  estado                  public.report_status,
  created_at              timestamptz,
  resolved_at             timestamptz,
  reporter_id             uuid,
  reporter_nombre         text,
  objetivo_tipo           text,
  listing_id              bigint,
  listing_titulo          text,
  listing_estado          public.listing_status,
  reported_user_id        uuid,
  reported_user_nombre    text,
  reported_user_correo    text,
  reported_user_estado    public.user_status,
  reportes_mismo_objetivo int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  perform private.exigir_admin();

  if p_estado is not null
     and p_estado not in ('pendiente', 'resuelto', 'descartado') then
    raise exception 'estado_invalido' using errcode = '22023';
  end if;

  return query
  select r.id, r.motivo, r.comentario, r.estado, r.created_at, r.resolved_at,
         r.reporter_id, rep.nombre,
         case
           when r.listing_id is not null       then 'publicacion'
           when r.reported_user_id is not null then 'usuario'
           when r.listing_titulo is not null   then 'publicacion_eliminada'
           else 'cuenta_eliminada'
         end,
         r.listing_id, coalesce(l.titulo, r.listing_titulo), l.estado,
         r.reported_user_id, ru.nombre, ru.correo, ru.estado,
         case
           when r.listing_id is not null then
             (select count(*)::int from public.reports r2 where r2.listing_id = r.listing_id)
           when r.reported_user_id is not null then
             (select count(*)::int from public.reports r2 where r2.reported_user_id = r.reported_user_id)
         end
    from public.reports r
    left join public.users rep on rep.id = r.reporter_id
    left join public.listings l on l.id = r.listing_id
    left join public.users ru on ru.id = r.reported_user_id
   where (p_estado is null or r.estado = p_estado::public.report_status)
     and (p_cursor is null or r.id < p_cursor)
   order by r.id desc
   limit v_limit;
end;
$$;

revoke execute on function admin.listar_reportes(text, bigint, int) from public, anon;
grant  execute on function admin.listar_reportes(text, bigint, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. admin.resolver_reporte
-- ---------------------------------------------------------------------------
--
-- Guardas, EN ESTE ORDEN, cada una con su SQLSTATE y su mensaje:
--
--   G1  exigir_admin()                     42501 no_admin / mfa_requerido / totp_vencido
--   G2  motivo de 3 a 500 tras btrim       22023 motivo_invalido
--   G2b p_estado ∈ {resuelto, descartado}  22023 estado_invalido   (null-safe: NULL lanza)
--   G5  el reporte existe                  P0002 reporte_no_existe
--   G3  el admin no es parte del reporte   42501 no_sobre_si_mismo (reportante o reportado)
--   G6  CAS desde `pendiente`              55000 estado_inesperado
--
-- G3 va DESPUÉS de G5 (al revés que en 20260930000478): aquí el parámetro es
-- el id del reporte, y saber si el admin es parte de él exige leer la fila.
--
-- La RPC NO escribe `resolved_at`: la sella el trigger de arriba (una sola
-- fuente) y aquí solo se lee con `returning` para auditarla. Resolver dispara
-- también el aviso al reportante (`reports_notify_resolved`), salvo que su
-- cuenta ya no exista.

create function admin.resolver_reporte(p_id bigint, p_estado text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo   text := btrim(p_motivo);
  v_reporte  public.reports%rowtype;
  v_resuelto timestamptz;
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  if p_estado is null or p_estado not in ('resuelto', 'descartado') then
    raise exception 'estado_invalido' using errcode = '22023';
  end if;

  select * into v_reporte from public.reports r where r.id = p_id;
  if not found then
    raise exception 'reporte_no_existe' using errcode = 'P0002';
  end if;

  if v_reporte.reporter_id = (select auth.uid())
     or v_reporte.reported_user_id = (select auth.uid()) then
    raise exception 'no_sobre_si_mismo' using errcode = '42501';
  end if;

  update public.reports
     set estado = p_estado::public.report_status
   where id = p_id and estado = 'pendiente'
  returning resolved_at into v_resuelto;
  if not found then
    raise exception 'estado_inesperado' using errcode = '55000';
  end if;

  perform private.auditar(
    'resolver_reporte', 'reporte', p_id::text,
    jsonb_build_object('estado', 'pendiente'),
    jsonb_build_object('estado', p_estado, 'resolved_at', v_resuelto),
    v_motivo);
end;
$$;

revoke execute on function admin.resolver_reporte(bigint, text, text) from public, anon;
grant  execute on function admin.resolver_reporte(bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3c. admin.detalle_listing (lectura, adelantada de la Ola 4 por D19)
-- ---------------------------------------------------------------------------
--
-- La publicación en CUALQUIER estado (el admin no pasa por `listings_select`),
-- su dueño, las rutas de sus fotos (el panel las descarga con
-- `storage.download()`, que autoriza la policy de la sección 4), el historial
-- COMPLETO de `listing_moderacion` (una fila por evaluación), sus reportes y su
-- auditoría. No escribe nada: no audita.

create function admin.detalle_listing(p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  perform private.exigir_admin();

  select jsonb_build_object(
           'id', l.id,
           'titulo', l.titulo,
           'descripcion', l.descripcion,
           'precio', l.precio,
           'condicion', l.condicion,
           'estado', l.estado,
           'categoria', cat.nombre,
           'universidad', un.nombre,
           'campus', c.nombre,
           'vistas_count', l.vistas_count,
           'created_at', l.created_at,
           'updated_at', l.updated_at,
           'dueno', jsonb_build_object(
             'id', u.id,
             'nombre', u.nombre,
             'estado', u.estado,
             'es_admin', exists (select 1 from private.admins a where a.user_id = u.id),
             'reportes_en_contra',
               (select count(*) from public.reports r where r.reported_user_id = u.id)),
           'fotos',
             coalesce((select jsonb_agg(p.storage_path order by p.orden)
                         from public.listing_photos p where p.listing_id = l.id), '[]'::jsonb),
           'moderacion',
             coalesce((select jsonb_agg(jsonb_build_object(
                                'id', m.id, 'created_at', m.created_at,
                                'veredicto', m.veredicto,
                                'estado_resultante', m.estado_resultante,
                                'detalle', m.detalle)
                              order by m.created_at desc, m.id desc)
                         from public.listing_moderacion m where m.listing_id = l.id), '[]'::jsonb),
           'reportes',
             coalesce((select jsonb_agg(jsonb_build_object(
                                'id', r.id, 'motivo', r.motivo, 'estado', r.estado,
                                'created_at', r.created_at, 'resolved_at', r.resolved_at,
                                'reporter_nombre', rep.nombre,
                                'reporter_eliminado', r.reporter_id is null)
                              order by r.id desc)
                         from public.reports r
                         left join public.users rep on rep.id = r.reporter_id
                        where r.listing_id = l.id), '[]'::jsonb),
           'auditoria',
             coalesce((select jsonb_agg(x order by x.created_at desc, x.id desc)
                         from (select aa.id, aa.accion, aa.admin_correo, aa.motivo,
                                      aa.antes, aa.despues, aa.created_at
                                 from private.admin_acciones aa
                                where aa.objetivo_tipo = 'listing'
                                  and aa.objetivo_id = l.id::text
                                order by aa.created_at desc, aa.id desc
                                limit 20) x), '[]'::jsonb))
    into v
    from public.listings l
    join public.users u on u.id = l.user_id
    left join public.categories cat on cat.id = l.categoria_id
    left join public.universidades un on un.id = l.universidad_id
    left join public.campus c on c.id = l.campus_id
   where l.id = p_id;

  if v is null then
    raise exception 'listing_no_existe' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

revoke execute on function admin.detalle_listing(bigint) from public, anon;
grant  execute on function admin.detalle_listing(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 3d. admin.bloquear_listing (adelantada de la Ola 4 por D19; D6, D10)
-- ---------------------------------------------------------------------------
--
-- Desde `pendiente`, `activa`, `pausada` o `vendida`; nunca desde `bloqueada`
-- (D10: sin "desbloquear" en la fase 1, así que bloquear dos veces es un
-- error, no un no-op). Solo mueve `estado`: no toca `listing_sales` (una
-- vendida conserva su venta) ni las fotos (D5 es de la Ola 4).
--
-- Guardas, EN ESTE ORDEN:
--
--   G1  exigir_admin()                   42501 no_admin / mfa_requerido / totp_vencido
--   G2  motivo de 3 a 500 tras btrim     22023 motivo_invalido
--   G5  la publicación existe            P0002 listing_no_existe
--   G3  el dueño no es el admin          42501 no_sobre_si_mismo
--   G4  el dueño no es otro admin        42501 objetivo_es_admin
--   G6  estado de origen permitido + CAS 55000 estado_inesperado
--
-- G3/G4 hoy no se alcanzan desde el producto (una cuenta `@rlvo.com.mx` nace
-- sin universidad y no puede publicar), pero nada en la base impide darle fila
-- en `private.admins` a un estudiante; medido en B0 que el caso se construye.
--
-- Efecto que no se ve aquí: `listings_notify_moderacion` (20260928000473)
-- avisa al dueño desde los 4 orígenes — "no fue aprobada" desde `pendiente`,
-- "Retiramos tu publicación" desde los otros tres.
--
-- Deuda aceptada (decisión del usuario, Ola 2): bloquear una `vendida` deja al
-- COMPRADOR sin camino en la UI para calificar, porque el embed de la
-- publicación pasa por `listings_select`; la base todavía aceptaría la reseña
-- (`can_rate()` es definer y no mira `estado`). Disparador y detalle en
-- CLAUDE.md.

create function admin.bloquear_listing(p_id bigint, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := btrim(p_motivo);
  v_duenio uuid;
  v_antes  public.listing_status;
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  select l.user_id, l.estado into v_duenio, v_antes
    from public.listings l where l.id = p_id;
  if not found then
    raise exception 'listing_no_existe' using errcode = 'P0002';
  end if;

  if v_duenio = (select auth.uid()) then
    raise exception 'no_sobre_si_mismo' using errcode = '42501';
  end if;

  if exists (select 1 from private.admins a where a.user_id = v_duenio) then
    raise exception 'objetivo_es_admin' using errcode = '42501';
  end if;

  if v_antes not in ('pendiente', 'activa', 'pausada', 'vendida') then
    raise exception 'estado_inesperado' using errcode = '55000';
  end if;

  -- CAS contra el estado leído: si otra transacción lo movió entre el select
  -- y aquí, afecta 0 filas y lanza en vez de bloquear sobre un estado que el
  -- admin no vio.
  update public.listings
     set estado = 'bloqueada'
   where id = p_id and estado = v_antes;
  if not found then
    raise exception 'estado_inesperado' using errcode = '55000';
  end if;

  perform private.auditar(
    'bloquear_listing', 'listing', p_id::text,
    jsonb_build_object('estado', v_antes),
    jsonb_build_object('estado', 'bloqueada'),
    v_motivo);
end;
$$;

revoke execute on function admin.bloquear_listing(bigint, text) from public, anon;
grant  execute on function admin.bloquear_listing(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Storage: el admin lee las fotos de cualquier publicación (D19)
-- ---------------------------------------------------------------------------
--
-- Permisiva y separada de `listing_photos_objects_select` (20260908000446):
-- el admin no pasa por `listings_select`, así que no lleva `exists` sobre
-- `listings`. Postgres hace OR entre policies permisivas: para cualquier otro
-- usuario esta da false y la de siempre decide.
--
-- WORKAROUND DEL SIGSEGV (supabase/KNOWN_ISSUES.md): la policy invoca
-- `private.is_admin()`, que es `language sql stable security definer set
-- search_path = ''` con EXECUTE para authenticated (20260930000477:95-112) y
-- USAGE sobre `private` (20260906000437:16). T12 lo vigila con la lista fija
-- (rls.sql:2390-2398) y con la invariante de `pg_depend` (D-B3). El
-- `(select …)` evalúa `is_admin()` una vez por consulta, no por fila.
--
-- Efecto sobre el BORRADO (CLAUDE.md §9, `remove()`): un admin ahora VE todos
-- los objetos del bucket, pero no tiene policy de DELETE, así que su
-- `remove()` sigue sin borrar nada. Al dueño no le cambia nada.

create policy listing_photos_objects_select_admin on storage.objects
  for select to authenticated
  using (
    bucket_id = 'listing-photos'
    and (select private.is_admin())
  );
