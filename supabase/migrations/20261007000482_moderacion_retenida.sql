-- Relevo — RF-17, Ola 4: el registro mínimo de moderación sobrevive al borrado
-- de una publicación BLOQUEADA, 12 meses.
--
-- POR QUÉ. Con D5 = (a) (20261007000481) el dueño de una `bloqueada` puede
-- eliminarla, y el cascade se llevaba sus `listing_moderacion` (20260918000461)
-- —la evidencia— junto con las fotos. LEGAL_FACTS §11/§21 y PRIVACY_SPEC
-- ("Publicación eliminada") prometen otra cosa: "puede conservarse un registro
-- mínimo de moderación SIN FOTOGRAFÍAS durante 12 meses cuando exista una
-- infracción", con proveedor, categorías, confianza, veredicto y decisión
-- final; §28.4 dice que sobrevive también a la eliminación de la cuenta.
--
-- DECISIONES (del usuario, al planear la Ola 4):
--   · INFRACCIÓN = `estado = 'bloqueada'` al borrarse. Una `pendiente` borrada
--     no tiene decisión final y no se retiene.
--   · Se conserva `user_id` también tras eliminar la cuenta. Alcance honesto:
--     una cuenta nueva tiene otro uuid, así que esto NO detecta reincidencia
--     tras borrar la cuenta (eso solo lo hace `correos_bloqueados`, y solo si
--     estaba suspendida); sirve para disputas, cruzándolo con
--     `admin_acciones.objetivo_id`. Pendiente de reflejarse en
--     ACCOUNT_DELETION.md / PRIVACY_SPEC.md (no se editan sin aprobación).
--   · Purga con pg_cron, diaria.
--   · Consumidor: `admin.detalle_usuario` (clave `bloqueadas`) y Studio.
--
-- QUÉ NO SE COPIA: el `detalle` entero no. Lleva rutas de Storage
-- (`fotos[].storage_path`), las palabras de la lista que machearon
-- (`lista_tecleada`, `lista_ocr`: contenido del usuario) y el texto de los
-- errores de OpenAI. `private.minimo_moderacion()` es una LISTA BLANCA.

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
--
-- En `private`, como `admin_acciones`: no es dato del producto, es registro de
-- moderación. `listing_id` y `user_id` SIN FK, a propósito: la fila existe
-- justo para sobrevivir al borrado de los dos.
--
-- RLS habilitado y CERO policies y CERO grants, igual que `listing_moderacion`:
-- el `revoke all` ES el control de acceso (authenticated tiene USAGE sobre
-- `private`, 20260906000437:16). La lee Studio y, por definer,
-- `admin.detalle_usuario`.

create table private.moderacion_retenida (
  id               bigint generated always as identity primary key,
  listing_id       bigint      not null,
  user_id          uuid        not null,
  evaluaciones     jsonb       not null default '[]'::jsonb,
  admin_accion_ids bigint[]    not null default '{}',
  borrada_at       timestamptz not null default now(),
  retener_hasta    timestamptz not null default now() + interval '12 months'
);

alter table private.moderacion_retenida enable row level security;
revoke all on private.moderacion_retenida from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. La lista blanca
-- ---------------------------------------------------------------------------
--
-- De un `listing_moderacion.detalle` (moderar-contenido/index.ts, `const
-- detalle`) conserva SOLO:
--   · `eje_que_manda` y `ejes` (el nivel por eje: limpio/revisar/bloquear);
--   · `gpt.veredicto` (el grado por categoría del modelo) o, si falló,
--     `gpt.motivo` (`error_http`/`refusal`), NUNCA `gpt.detalle` (texto libre);
--   · por foto: `estado`, `safe_search` (likelihood por categoría) y de
--     Rekognition solo `name`/`confidence`/`taxonomy_level` (o su `estado` si
--     no se evaluó). NUNCA `storage_path` ni `motivo` (que puede traer la ruta);
--   · de las listas, solo CUÁNTAS coincidencias hubo, no las palabras.
-- Las claves que no existan en filas viejas salen como ausentes, no como error.
-- IMMUTABLE y sin EXECUTE para nadie: solo la llama el trigger, como definer.

create function private.minimo_moderacion(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'eje_que_manda', p->'eje_que_manda',
    'ejes', p->'ejes',
    'gpt', case
             when jsonb_typeof(p->'gpt'->'veredicto') = 'object'
               then jsonb_build_object('veredicto', p->'gpt'->'veredicto')
             when jsonb_typeof(p->'gpt'->'motivo') = 'string'
               then jsonb_build_object('motivo', p->'gpt'->'motivo')
           end,
    'coincidencias_lista_tecleada',
      case when jsonb_typeof(p->'lista_tecleada') = 'array'
           then jsonb_array_length(p->'lista_tecleada') end,
    'coincidencias_lista_ocr',
      case when jsonb_typeof(p->'lista_ocr') = 'array'
           then jsonb_array_length(p->'lista_ocr') end,
    'fotos',
      case when jsonb_typeof(p->'fotos') = 'array' then (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'estado', f->'estado',
                 'safe_search', f->'safe_search',
                 'rekognition', case
                   when jsonb_typeof(f->'rekognition') = 'array' then (
                     select coalesce(jsonb_agg(jsonb_build_object(
                              'name', e->'name',
                              'confidence', e->'confidence',
                              'taxonomy_level', e->'taxonomy_level')), '[]'::jsonb)
                       from jsonb_array_elements(f->'rekognition') e)
                   when jsonb_typeof(f->'rekognition') = 'object'
                     then jsonb_build_object('estado', f->'rekognition'->'estado')
                 end)))
          from jsonb_array_elements(p->'fotos') f)
      end
  ))
$$;

revoke execute on function private.minimo_moderacion(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. El trigger
-- ---------------------------------------------------------------------------
--
-- BEFORE DELETE: las filas de `listing_moderacion` todavía existen (su FK
-- cascadea DESPUÉS de borrar la fila de `listings`). MEDIDO en local
-- (2026-10-07, begin … rollback) en los dos caminos: el borrado directo de la
-- publicación y el cascade de eliminar la cuenta (`auth.users` → `users` →
-- `listings`). En los dos el trigger ve la evaluación; en el cascade la fila del
-- dueño ya no es visible, pero `old.user_id` sí está, y es lo que se guarda.
--
-- Cubre también el borrado de `eliminar-publicacion` (su DELETE es de la fila,
-- con el JWT del usuario) y el de Studio.
--
-- `admin_accion_ids`: las acciones del panel sobre esa publicación (bloquear,
-- aprobar), por id: el motivo vive una sola vez, en `admin_acciones`.
--
-- SECURITY DEFINER: escribe en una tabla sin grants y lee `listing_moderacion`
-- (sin grants) y `admin_acciones`. EXECUTE revocado: solo la dispara el trigger.

create function private.retiene_moderacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.moderacion_retenida (listing_id, user_id, evaluaciones, admin_accion_ids)
  values (
    old.id,
    old.user_id,
    coalesce((select jsonb_agg(jsonb_build_object(
                       'created_at', m.created_at,
                       'veredicto', m.veredicto,
                       'estado_resultante', m.estado_resultante,
                       'detalle', private.minimo_moderacion(m.detalle))
                     order by m.id)
                from public.listing_moderacion m
               where m.listing_id = old.id), '[]'::jsonb),
    coalesce((select array_agg(aa.id order by aa.id)
                from private.admin_acciones aa
               where aa.objetivo_tipo = 'listing' and aa.objetivo_id = old.id::text),
             '{}'::bigint[])
  );
  return old;
end;
$$;

revoke execute on function private.retiene_moderacion() from public, anon, authenticated;

create trigger listings_retiene_moderacion
  before delete on public.listings
  for each row
  when (old.estado = 'bloqueada')
  execute function private.retiene_moderacion();

-- ---------------------------------------------------------------------------
-- 4. La purga (pg_cron)
-- ---------------------------------------------------------------------------
--
-- pg_cron 1.6.4 estaba disponible y SIN instalar en local y en remoto (medido
-- en `pg_available_extensions` el 2026-10-07): esto lo instala. Es la primera
-- tarea programada del proyecto. Diaria a las 04:17 UTC; `cron.schedule` con
-- nombre es idempotente (reemplaza el job si ya existe).

create extension if not exists pg_cron;

select cron.schedule(
  'purga-moderacion-retenida',
  '17 4 * * *',
  $$delete from private.moderacion_retenida where retener_hasta < now()$$
);

-- ---------------------------------------------------------------------------
-- 5. admin.detalle_usuario: suma `bloqueadas`
-- ---------------------------------------------------------------------------
--
-- `create or replace`: conserva OID, el revoke y el grant de 20260930000478.
-- `bloqueadas` = sus publicaciones `bloqueada` actuales (SIN ventana: listings
-- no guarda cuándo se bloqueó) + las bloqueadas que eliminó y siguen retenidas
-- (los últimos 12 meses). Por eso el frame dice "Bloqueadas" y no "(12 meses)"
-- (decisión del usuario). Las eliminadas ANTES de esta migración no se
-- retuvieron: el dato empieza el día del push.
--
-- Todo lo demás es idéntico a 20260930000478.

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
