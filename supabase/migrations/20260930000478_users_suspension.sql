-- Relevo — RF-17, Ola 1: suspender y reactivar desde el panel, con motivo y
-- auditoría.
--
-- Plan: `docs/rf17-plan-admin.md` §7 (D15) y el plan de la Ola 1. Depende de
-- 20260930000477 (`private.exigir_admin()`, `private.auditar()`).
--
-- COLUMNAS NUEVAS EN `users`: `suspendido_at` y `suspension_motivo`. Nadie del
-- lado del cliente las lee ni las escribe: `users` tiene SELECT y UPDATE por
-- LISTA DE COLUMNAS (`20260924000466:158-165`; medido en local y en remoto el
-- 2026-09-29: 0 filas en `table_privileges` para authenticated), así que una
-- columna nueva nace sin ningún privilegio. T12 lo vigila con
-- `has_column_privilege` (SELECT, INSERT y UPDATE). El propio usuario leerá su
-- motivo con una RPC de la tarea siguiente (el aviso de suspensión en la app),
-- no aquí.
--
-- EFECTO EN STUDIO (D15), y es a propósito: desde esta migración, suspender a
-- mano exige escribir también `suspendido_at` y `suspension_motivo` (de 3 a
-- 500 caracteres tras btrim), o el UPDATE falla con 23514. Reactivar a mano
-- exige dejar las dos en NULL. Medido en remoto antes de escribir esto: 7
-- usuarios, todos `activo`, así que ninguna fila existente viola el check.
--
-- QUÉ PASA AL SUSPENDER, sin código nuevo: el trigger
-- `users_pause_listings_on_suspend` (20260917000457) pasa a `pausada` las
-- `activa` del usuario, en la misma transacción. Las `pendiente`, `bloqueada`,
-- `vendida` y `pausada` no se tocan. Sobre `listings` solo dispara además
-- `listings_set_updated_at`; ningún aviso ni push (medido en `pg_trigger`).
--
-- REACTIVAR NO DESPAUSA (decisión de 20260917000457): la base no distingue
-- "pausada por suspensión" de "pausada por el vendedor", y despausar todo
-- reactivaría lo que el vendedor pausó a propósito. Las reactiva él desde
-- "Mis publicaciones", que exige al menos una foto.

alter table public.users
  add column suspendido_at     timestamptz,
  add column suspension_motivo text;

-- Coherencia en los DOS sentidos: suspendido ⇔ las dos columnas puestas, y
-- activo ⇔ las dos en NULL. (Más estricto que la forma del plan,
-- `(estado = 'suspendido') = (… and …)`, que dejaba pasar un `activo` con
-- solo una de las dos columnas puesta.)
alter table public.users
  add constraint users_suspension_coherente
  check ((estado = 'suspendido'
          and suspendido_at is not null and suspension_motivo is not null)
      or (estado = 'activo'
          and suspendido_at is null and suspension_motivo is null));

-- La misma regla que las RPCs y que `admin_acciones_motivo_valido`, escrita
-- literal (sin función) a propósito.
alter table public.users
  add constraint users_suspension_motivo_valido
  check (suspension_motivo is null
         or char_length(btrim(suspension_motivo)) between 3 and 500);

-- ---------------------------------------------------------------------------
-- admin.buscar_usuarios: por correo o nombre, con el correo visible (D8)
-- ---------------------------------------------------------------------------
--
-- D8: el admin lee `users.correo`, excepción a RNF-05 solo para admins (esta
-- función es definer y `exigir_admin()` es su primera línea). El texto se
-- escapa antes del `ilike`: `%` y `_` del usuario son literales, no comodines
-- (gotcha de CLAUDE.md §9, el comodín de búsqueda). Sin texto, las más
-- recientes. Tope de 100 filas aunque se pidan más.

create function admin.buscar_usuarios(p_q text, p_limit int default 20)
returns table (
  id                 uuid,
  nombre             text,
  correo             text,
  universidad        text,
  campus             text,
  estado             public.user_status,
  suspendido_at      timestamptz,
  suspension_motivo  text,
  created_at         timestamptz,
  publicaciones      int,
  reportes_en_contra int,
  es_admin           boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q     text := nullif(btrim(coalesce(p_q, '')), '');
  v_patron text;
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
begin
  perform private.exigir_admin();

  if v_q is not null then
    v_patron := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select u.id, u.nombre, u.correo, un.nombre, c.nombre, u.estado,
         u.suspendido_at, u.suspension_motivo, u.created_at,
         (select count(*)::int from public.listings l where l.user_id = u.id),
         (select count(*)::int from public.reports r where r.reported_user_id = u.id),
         exists (select 1 from private.admins a where a.user_id = u.id)
    from public.users u
    left join public.universidades un on un.id = u.universidad_id
    left join public.campus c on c.id = u.campus_id
   where v_patron is null
      or u.correo ilike v_patron
      or u.nombre ilike v_patron
   order by u.created_at desc, u.id
   limit v_limit;
end;
$$;

revoke execute on function admin.buscar_usuarios(text, int) from public, anon;
grant  execute on function admin.buscar_usuarios(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- admin.detalle_usuario
-- ---------------------------------------------------------------------------
--
-- Además de la ficha, tres conteos que el panel usa para AVISAR, no para
-- decidir:
--   · `publicaciones_activas`: si el usuario está suspendido y es > 0, algo
--     las activó después de la suspensión (la deuda `dueno_no_activo` de la
--     Ola 4: una `pendiente` que se aprueba con el dueño suspendido).
--   · `publicaciones_pendientes`: antes de suspender, "podrían activarse".
--   · `activas_sin_foto`: las que, pausadas por la suspensión, el vendedor no
--     podrá reactivar sin subir una foto (`listings_enforce_activation_has_photos`).
-- Y su auditoría: las últimas 20 acciones sobre este usuario.

create function admin.detalle_usuario(p_user_id uuid)
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
           'id', u.id,
           'nombre', u.nombre,
           'correo', u.correo,
           'universidad', un.nombre,
           'campus', c.nombre,
           'estado', u.estado,
           'suspendido_at', u.suspendido_at,
           'suspension_motivo', u.suspension_motivo,
           'created_at', u.created_at,
           'es_admin', exists (select 1 from private.admins a where a.user_id = u.id),
           'publicaciones_activas',
             (select count(*) from public.listings l
               where l.user_id = u.id and l.estado = 'activa'),
           'publicaciones_pendientes',
             (select count(*) from public.listings l
               where l.user_id = u.id and l.estado = 'pendiente'),
           'activas_sin_foto',
             (select count(*) from public.listings l
               where l.user_id = u.id and l.estado = 'activa'
                 and not exists (select 1 from public.listing_photos p
                                  where p.listing_id = l.id)),
           'reportes_en_contra',
             (select count(*) from public.reports r where r.reported_user_id = u.id),
           'auditoria',
             coalesce((select jsonb_agg(x order by x.created_at desc, x.id desc)
                         from (select aa.id, aa.accion, aa.admin_correo, aa.motivo,
                                      aa.antes, aa.despues, aa.created_at
                                 from private.admin_acciones aa
                                where aa.objetivo_tipo = 'usuario'
                                  and aa.objetivo_id = u.id::text
                                order by aa.created_at desc, aa.id desc
                                limit 20) x), '[]'::jsonb))
    into v
    from public.users u
    left join public.universidades un on un.id = u.universidad_id
    left join public.campus c on c.id = u.campus_id
   where u.id = p_user_id;

  if v is null then
    raise exception 'usuario_no_existe' using errcode = 'P0002';
  end if;
  return v;
end;
$$;

revoke execute on function admin.detalle_usuario(uuid) from public, anon;
grant  execute on function admin.detalle_usuario(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- admin.suspender_usuario / admin.reactivar_usuario
-- ---------------------------------------------------------------------------
--
-- Guardas, EN ESTE ORDEN, cada una con su SQLSTATE y su mensaje (el panel y
-- T35 los distinguen por el mensaje, `admin/src/lib/rechazos.ts`):
--
--   G1  exigir_admin()                 42501 no_admin / mfa_requerido / totp_vencido
--   G2  motivo de 3 a 500 tras btrim   22023 motivo_invalido
--   G3  no sobre sí mismo              42501 no_sobre_si_mismo
--   G4  el objetivo no es admin        42501 objetivo_es_admin   (SOLO suspender)
--   G5  el objetivo existe             P0002 usuario_no_existe
--   G6  CAS sobre `estado`             55000 estado_inesperado
--
-- G4 NO está en `reactivar_usuario`, a propósito: un admin que quedó
-- suspendido por otra vía (Studio) tiene que poder ser reactivado por otro
-- admin. G3 sí: nadie se levanta su propia suspensión. Suspender NO revoca a
-- un admin (`is_admin()` no mira `users.estado`); revocar es borrar su fila de
-- `private.admins`.
--
-- G6 es compare-and-set y LANZA si afecta 0 filas (la lección de
-- `listings_update_own`: un UPDATE que no escribe nada no puede verse como
-- éxito).

create function admin.suspender_usuario(p_user_id uuid, p_motivo text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo   text := btrim(p_motivo);
  v_ts       timestamptz := now();
  v_ids      bigint[];
  v_pausadas int;
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'no_sobre_si_mismo' using errcode = '42501';
  end if;

  if exists (select 1 from private.admins a where a.user_id = p_user_id) then
    raise exception 'objetivo_es_admin' using errcode = '42501';
  end if;

  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'usuario_no_existe' using errcode = 'P0002';
  end if;

  -- Las `activa` ANTES de suspender: el conteo que se devuelve y se audita es
  -- el de ESTA acción (las que pasaron de activa a pausada), no el total de
  -- pausadas del usuario. Límite honesto: una publicación que otra
  -- transacción promueva a `activa` entre este select y el UPDATE la pausa el
  -- trigger igual, pero no entra en el conteo (error por defecto, nunca
  -- inflado).
  select coalesce(array_agg(l.id), '{}') into v_ids
    from public.listings l
   where l.user_id = p_user_id and l.estado = 'activa';

  update public.users
     set estado = 'suspendido', suspendido_at = v_ts, suspension_motivo = v_motivo
   where id = p_user_id and estado = 'activo';
  if not found then
    raise exception 'estado_inesperado' using errcode = '55000';
  end if;

  select count(*) into v_pausadas
    from public.listings l
   where l.id = any (v_ids) and l.estado = 'pausada';

  perform private.auditar(
    'suspender_usuario', 'usuario', p_user_id::text,
    jsonb_build_object('estado', 'activo'),
    jsonb_build_object('estado', 'suspendido',
                       'suspendido_at', v_ts,
                       'publicaciones_pausadas', v_pausadas),
    v_motivo);

  return v_pausadas;
end;
$$;

revoke execute on function admin.suspender_usuario(uuid, text) from public, anon;
grant  execute on function admin.suspender_usuario(uuid, text) to authenticated;

create function admin.reactivar_usuario(p_user_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo text := btrim(p_motivo);
  v_antes  timestamptz;
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'no_sobre_si_mismo' using errcode = '42501';
  end if;

  -- (Sin G4: ver arriba.)

  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'usuario_no_existe' using errcode = 'P0002';
  end if;

  select u.suspendido_at into v_antes
    from public.users u
   where u.id = p_user_id and u.estado = 'suspendido'
   for update;

  update public.users
     set estado = 'activo', suspendido_at = null, suspension_motivo = null
   where id = p_user_id and estado = 'suspendido';
  if not found then
    raise exception 'estado_inesperado' using errcode = '55000';
  end if;

  -- NO despausa: ver la cabecera.
  perform private.auditar(
    'reactivar_usuario', 'usuario', p_user_id::text,
    jsonb_build_object('estado', 'suspendido', 'suspendido_at', v_antes),
    jsonb_build_object('estado', 'activo'),
    v_motivo);
end;
$$;

revoke execute on function admin.reactivar_usuario(uuid, text) from public, anon;
grant  execute on function admin.reactivar_usuario(uuid, text) to authenticated;
