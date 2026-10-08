-- Relevo — RF-17, Ola 3b: restablecer la app autenticadora (TOTP) de OTRO
-- admin desde el panel.
--
-- Plan técnico v2 aprobado (ronda de diseño de la Ola 3b). Frames:
-- `design/admin-panel.html`, "Usuario — cuenta de admin (restablecer app
-- autenticadora)" y su modal.
--
-- REPARTO. Borrar un factor exige la secret key, así que eso lo hace la Edge
-- Function `admin-reset-mfa`; TODA la autorización y la auditoría viven aquí,
-- en dos RPC que la función llama con el JWT del ejecutor:
--
--   1. `admin.restablecer_mfa_iniciar`: guardas, lock del objetivo, y en UNA
--      transacción desactiva (`activado_at = null`) y escribe la fila de
--      inicio `restablecer_mfa`. Devuelve los ids de los TOTP a borrar. Antes
--      de tocar Auth el objetivo ya no tiene acceso: falla CERRADO.
--   2. (la función borra esos factores en Auth)
--   3. `admin.restablecer_mfa_completar`: verifica EN LA BASE que ya no queda
--      ningún TOTP viejo y escribe el cierre `factores_mfa_borrados`.
--
-- DEFINICIONES (las mismas en las dos RPC y en `crear-admin.mjs activar`):
--   · Intento R = una fila `restablecer_mfa` sobre el objetivo X.
--   · Inicio de R = `R.created_at` (el `now()` de la transacción de iniciar).
--   · TOTP viejos de R = `auth.mfa_factors` de X con `factor_type = 'totp'`
--     (verified o unverified) y `created_at <= R.created_at`. Se compara SIEMPRE
--     en SQL. WebAuthn/phone NUNCA se tocan; un TOTP posterior al inicio es el
--     factor NUEVO y legítimo y se conserva.
--   · Cierre de R = una fila `factores_mfa_borrados` de X con `id > R.id`.
--   · R pendiente = la última `restablecer_mfa` de X sin cierre.
--   · INVARIANTE: como mucho un intento pendiente por objetivo, y mientras
--     exista, `activado_at` es null (`activar` se niega con uno pendiente).
--
-- RECUPERACIÓN. S1 (pendiente con TOTP viejos) se REANUDA con el mismo R, sin
-- fila nueva. S2 (pendiente sin TOTP viejos: Auth terminó, faltó el cierre) se
-- CIERRA y la petición TERMINA (`cierre_recuperado`): nunca crea un R', aunque
-- exista un TOTP posterior a R. `p_intento_pendiente` (el id que el panel tenía
-- en pantalla) evita que un reintento concurrente, ya cerrado por otro admin,
-- se convierta en un reset nuevo: responde `ya_completado`.
--
-- Plantilla de toda función de `admin.*` (20260930000477): definer,
-- `set search_path = ''`, `perform private.exigir_admin()` primero,
-- `revoke … from public, anon` + `grant execute … to authenticated`.

-- ---------------------------------------------------------------------------
-- 1. Acciones auditables: 7 → 9
-- ---------------------------------------------------------------------------
-- Drop + add en la misma migración: no hay ventana sin check. Las 7 de antes se
-- conservan tal cual (20261007000481:35-38).

alter table private.admin_acciones
  drop constraint admin_acciones_accion_check;

alter table private.admin_acciones
  add constraint admin_acciones_accion_check
  check (accion in ('suspender_usuario', 'reactivar_usuario', 'activar_admin',
                    'desactivar_admin', 'resolver_reporte', 'bloquear_listing',
                    'aprobar_listing', 'restablecer_mfa', 'factores_mfa_borrados'));

-- ---------------------------------------------------------------------------
-- 2. Clave `factores_totp` para objetivo `admin`
-- ---------------------------------------------------------------------------
-- La fila de inicio guarda cuántos TOTP viejos había, para que el número del
-- cierre salga de la base y no de quien llama. `create or replace` con la
-- misma firma: el CHECK que la usa sigue apuntando a ella, y solo SE AGREGA una
-- clave, así que ninguna fila existente deja de cumplirlo. Todo lo demás es
-- idéntico a 20260930000477:163-186.

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
                       else array[]::text[]
                     end)));
$$;

revoke execute on function private.claves_auditoria_ok(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. El cierre, una sola copia
-- ---------------------------------------------------------------------------
-- Lo escriben `completar` y, al recuperar un S2, `iniciar`. Solo lo llaman
-- esas dos (definer): revocada a todos. El actor es quien cierra (puede no ser
-- quien inició); el número y el motivo salen de la fila de inicio.

create function private.cerrar_restablecer_mfa(p_accion_id bigint)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r private.admin_acciones;
  v_n int;
begin
  select * into v_r from private.admin_acciones
   where id = p_accion_id and accion = 'restablecer_mfa';
  v_n := coalesce((v_r.despues->>'factores_totp')::int, 0);
  perform private.auditar(
    'factores_mfa_borrados', 'admin', v_r.objetivo_id,
    null, jsonb_build_object('factores_borrados', v_n),
    v_r.motivo);
  return v_n;
end;
$$;

revoke execute on function private.cerrar_restablecer_mfa(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. admin.restablecer_mfa_iniciar
-- ---------------------------------------------------------------------------
--
-- Guardas, en orden: G1 exigir_admin; G2 motivo 3-500 (22023 motivo_invalido);
-- G3 no sobre sí mismo (42501 no_sobre_si_mismo); G4 el objetivo es admin, con
-- su fila BLOQUEADA (`for update`; P0002 objetivo_no_es_admin). Ese lock
-- serializa todo iniciar/completar del mismo objetivo, y también
-- `crear-admin.mjs activar`/`desactivar`, que actualizan la misma fila.
--
-- Respuesta: {estado, accion_id, factores (ids de TOTP viejos), desactivado}.
--   · `ya_completado`: `p_intento_pendiente` ya estaba cerrado. FIN.
--   · `reanudado`: S1, mismo intento, sin fila nueva.
--   · `cierre_recuperado`: S2, se cierra el intento y FIN.
--   · `nuevo`: no había pendiente; desactiva y escribe el inicio.
--   · 55000 estado_inesperado: desactivado, sin TOTP y sin pendiente.
-- El `motivo` de un reintento que reanuda o recupera NO se guarda: el intento
-- conserva el de su inicio (lo copia el cierre).

create function admin.restablecer_mfa_iniciar(
  p_user_id uuid, p_motivo text, p_intento_pendiente bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_motivo   text := btrim(p_motivo);
  v_activado timestamptz;
  v_r        private.admin_acciones;
  v_ids      uuid[];
  v_id       bigint;
begin
  perform private.exigir_admin();

  if v_motivo is null or char_length(v_motivo) not between 3 and 500 then
    raise exception 'motivo_invalido' using errcode = '22023';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'no_sobre_si_mismo' using errcode = '42501';
  end if;

  select a.activado_at into v_activado
    from private.admins a
   where a.user_id = p_user_id
     for update;
  if not found then
    raise exception 'objetivo_no_es_admin' using errcode = 'P0002';
  end if;

  -- El reintento de un intento concreto: si otra petición ya lo cerró,
  -- termina aquí. NUNCA cae al paso que crea un intento nuevo.
  if p_intento_pendiente is not null then
    select * into v_r from private.admin_acciones aa
     where aa.id = p_intento_pendiente
       and aa.accion = 'restablecer_mfa'
       and aa.objetivo_tipo = 'admin'
       and aa.objetivo_id = p_user_id::text;
    if not found then
      raise exception 'intento_no_existe' using errcode = 'P0002';
    end if;
    if exists (select 1 from private.admin_acciones c
                where c.accion = 'factores_mfa_borrados'
                  and c.objetivo_tipo = 'admin'
                  and c.objetivo_id = p_user_id::text
                  and c.id > v_r.id) then
      return jsonb_build_object('estado', 'ya_completado', 'accion_id', v_r.id,
                                'factores', '[]'::jsonb, 'desactivado', false);
    end if;
  end if;

  -- ¿Hay un intento pendiente? (la última `restablecer_mfa` de X sin cierre)
  select * into v_r from private.admin_acciones aa
   where aa.accion = 'restablecer_mfa'
     and aa.objetivo_tipo = 'admin'
     and aa.objetivo_id = p_user_id::text
   order by aa.id desc
   limit 1;
  if found and exists (select 1 from private.admin_acciones c
                        where c.accion = 'factores_mfa_borrados'
                          and c.objetivo_tipo = 'admin'
                          and c.objetivo_id = p_user_id::text
                          and c.id > v_r.id) then
    v_r := null;
  end if;

  if v_r.id is not null then
    select coalesce(array_agg(f.id order by f.created_at), '{}') into v_ids
      from auth.mfa_factors f
     where f.user_id = p_user_id
       and f.factor_type = 'totp'
       and f.created_at <= v_r.created_at;

    if cardinality(v_ids) > 0 then
      -- S1. Por la invariante ya está desactivado; se re-asegura igual.
      update private.admins set activado_at = null
       where user_id = p_user_id and activado_at is not null;
      return jsonb_build_object('estado', 'reanudado', 'accion_id', v_r.id,
                                'factores', to_jsonb(v_ids), 'desactivado', false);
    end if;

    -- S2. Auth ya terminó: se cierra ESTE intento y la petición termina.
    perform private.cerrar_restablecer_mfa(v_r.id);
    return jsonb_build_object('estado', 'cierre_recuperado', 'accion_id', v_r.id,
                              'factores', '[]'::jsonb, 'desactivado', false);
  end if;

  -- Sin intento pendiente: uno nuevo, salvo que no haya nada que restablecer.
  select coalesce(array_agg(f.id order by f.created_at), '{}') into v_ids
    from auth.mfa_factors f
   where f.user_id = p_user_id
     and f.factor_type = 'totp'
     and f.created_at <= now();

  if v_activado is null and cardinality(v_ids) = 0 then
    raise exception 'estado_inesperado' using errcode = '55000';
  end if;

  update private.admins set activado_at = null where user_id = p_user_id;

  -- `now()` es el de esta transacción, y es también el `created_at` (default)
  -- de la fila que escribe `auditar`: los ids de arriba son exactamente los
  -- TOTP viejos de este intento.
  v_id := private.auditar(
    'restablecer_mfa', 'admin', p_user_id::text,
    jsonb_build_object('activado_at', v_activado),
    jsonb_build_object('activado_at', null, 'factores_totp', cardinality(v_ids)),
    v_motivo);

  return jsonb_build_object('estado', 'nuevo', 'accion_id', v_id,
                            'factores', to_jsonb(v_ids),
                            'desactivado', v_activado is not null);
end;
$$;

revoke execute on function admin.restablecer_mfa_iniciar(uuid, text, bigint) from public, anon;
grant  execute on function admin.restablecer_mfa_iniciar(uuid, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. admin.restablecer_mfa_completar
-- ---------------------------------------------------------------------------
--
-- Cierra el intento SOLO si la base comprueba que no queda ningún TOTP viejo:
-- no acepta un número de fuera, así que no se puede falsear llamándola directo.
-- Idempotente (`ya_completado`). Puede cerrarlo cualquier admin, no solo quien
-- lo inició: el cierre afirma un hecho que verifica la base.

create function admin.restablecer_mfa_completar(p_accion_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r private.admin_acciones;
  v_n int;
begin
  perform private.exigir_admin();

  select * into v_r from private.admin_acciones aa
   where aa.id = p_accion_id and aa.accion = 'restablecer_mfa';
  if not found then
    raise exception 'intento_no_existe' using errcode = 'P0002';
  end if;

  perform 1 from private.admins a
   where a.user_id = v_r.objetivo_id::uuid
     for update;
  if not found then
    raise exception 'objetivo_no_es_admin' using errcode = 'P0002';
  end if;

  if exists (select 1 from private.admin_acciones c
              where c.accion = 'factores_mfa_borrados'
                and c.objetivo_tipo = 'admin'
                and c.objetivo_id = v_r.objetivo_id
                and c.id > v_r.id) then
    return jsonb_build_object('estado', 'ya_completado');
  end if;

  if exists (select 1 from auth.mfa_factors f
              where f.user_id = v_r.objetivo_id::uuid
                and f.factor_type = 'totp'
                and f.created_at <= v_r.created_at) then
    raise exception 'factores_pendientes' using errcode = '55000';
  end if;

  v_n := private.cerrar_restablecer_mfa(v_r.id);
  return jsonb_build_object('estado', 'completado', 'factores_borrados', v_n);
end;
$$;

revoke execute on function admin.restablecer_mfa_completar(bigint) from public, anon;
grant  execute on function admin.restablecer_mfa_completar(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. admin.detalle_usuario: el estado de una cuenta de admin
-- ---------------------------------------------------------------------------
--
-- `create or replace`: conserva OID, revoke y grant. Suma, SOLO si es admin
-- (null si no):
--   · `admin_activado`: `activado_at is not null`.
--   · `app_registrada`: existe un TOTP `verified` (un unverified no cuenta).
--   · `restablecimiento_pendiente`: el id del intento pendiente, o null. El
--     panel lo devuelve en `p_intento_pendiente` al reanudar.
-- Y la `auditoria` incluye también las filas `objetivo_tipo = 'admin'` de esa
-- cuenta (misma lista, mismo límite de 20). Del factor NO sale nada más: ni
-- ids, ni secreto, ni `friendly_name`. Todo lo demás es idéntico a
-- 20261007000482:200-260.

create or replace function admin.detalle_usuario(p_user_id uuid)
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
           'es_admin', ad.user_id is not null,
           'admin_activado', case when ad.user_id is not null
                                  then ad.activado_at is not null end,
           'app_registrada', case when ad.user_id is not null
                                  then exists (select 1 from auth.mfa_factors f
                                                where f.user_id = u.id
                                                  and f.factor_type = 'totp'
                                                  and f.status = 'verified') end,
           'restablecimiento_pendiente',
             case when ad.user_id is not null then
               (select r.id from private.admin_acciones r
                 where r.accion = 'restablecer_mfa'
                   and r.objetivo_tipo = 'admin'
                   and r.objetivo_id = u.id::text
                   and not exists (select 1 from private.admin_acciones c
                                    where c.accion = 'factores_mfa_borrados'
                                      and c.objetivo_tipo = 'admin'
                                      and c.objetivo_id = r.objetivo_id
                                      and c.id > r.id)
                 order by r.id desc
                 limit 1) end,
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
           'bloqueadas',
             (select count(*) from public.listings l
               where l.user_id = u.id and l.estado = 'bloqueada')
             + (select count(*) from private.moderacion_retenida r
                 where r.user_id = u.id and r.retener_hasta > now()),
           'reportes_en_contra',
             (select count(*) from public.reports r where r.reported_user_id = u.id),
           'auditoria',
             coalesce((select jsonb_agg(x order by x.created_at desc, x.id desc)
                         from (select aa.id, aa.accion, aa.admin_correo, aa.motivo,
                                      aa.antes, aa.despues, aa.created_at
                                 from private.admin_acciones aa
                                where aa.objetivo_tipo in ('usuario', 'admin')
                                  and aa.objetivo_id = u.id::text
                                order by aa.created_at desc, aa.id desc
                                limit 20) x), '[]'::jsonb))
    into v
    from public.users u
    left join public.universidades un on un.id = u.universidad_id
    left join public.campus c on c.id = u.campus_id
    left join private.admins ad on ad.user_id = u.id
   where u.id = p_user_id;

  if v is null then
    raise exception 'usuario_no_existe' using errcode = 'P0002';
  end if;
  return v;
end;
$$;
