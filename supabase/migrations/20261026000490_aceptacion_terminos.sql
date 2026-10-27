-- Relevo — aceptación explícita y versionada de los términos (PL-016).
--
-- Plan y decisiones (P1-P5, Q1-Q5, V1-V2) en docs/pl-016-plan.md. En corto:
--  · Cada versión de los Términos y del Aviso de privacidad es una fila
--    INMUTABLE de `documentos_legales`, con su URL fija y el sha256 de su
--    texto (V1). La migración crea el catálogo VACÍO (Q3): las versiones se
--    cargan aparte (seed.sql en local, un insert en STAGING/PROD).
--  · Aceptar es UNA acción (una casilla) que deja DOS registros: Términos
--    `aceptado` y Aviso `presentado` (P5). Presentar el Aviso NO es un
--    consentimiento a ningún tratamiento de datos.
--  · Sin aceptar la versión vigente, la base rechaza las acciones de P3:
--    publicar, editar, reactivar, marcar vendida o corregir el comprador,
--    subir fotos, foto de perfil, teléfono y carrera, reseñar y contactar por
--    WhatsApp. Se sigue pudiendo explorar, cambiar nombre y campus, guardar
--    favoritos, pausar una publicación, reportar, bloquear, eliminar sus
--    publicaciones y la cuenta (P2).
--  · Sin versión vigente nadie puede aceptar, así que las acciones de P3
--    quedan bloqueadas para todos: falla cerrado (Q3).
--
-- Piezas:
--  1. `public.documentos_legales` y su trigger de inmutabilidad.
--  2. `public.aceptaciones_legales`.
--  3. `private.version_vigente(text)` y `private.terminos_vigentes_aceptados()`.
--  4. `public.aceptar_terminos(text, text)` (definer, la invoca el cliente) y
--     `public.estado_terminos()` (invoker, solo lectura).
--  5. El helper en el `with check` de 9 policies.
--  6. Dos triggers BEFORE UPDATE: `listings` (solo deja pausar) y `users`
--     (foto, teléfono y carrera).
--  7. `seller_whatsapp`: quinta causa de null.
--
-- Lo prueba T42 de supabase/tests/rls.sql; por HTTP,
-- scripts/probe-terminos.mjs.

-- ---------------------------------------------------------------------------
-- 1. documentos_legales
-- ---------------------------------------------------------------------------

-- La vigente de cada tipo es la de `vigente_desde` más reciente que ya
-- empezó. El unique (tipo, vigente_desde) existe para que esa elección sea
-- determinista: con dos versiones del mismo tipo a la misma hora, el
-- `order by … limit 1` elegiría una al azar.
--
-- `contenido_sha256` es el sha256 del texto CANÓNICO de la versión (el que se
-- archiva en docs/legal/versiones/), no del HTML servido: la página puede
-- cambiar de plantilla sin que cambie el documento (V1).
create table public.documentos_legales (
  tipo             text not null,
  version          text not null,
  vigente_desde    timestamptz not null,
  url              text not null,
  contenido_sha256 bytea not null,
  created_at       timestamptz not null default now(),
  primary key (tipo, version),
  constraint documentos_legales_tipo_check
    check (tipo in ('terminos', 'aviso_privacidad')),
  constraint documentos_legales_version_check
    check (version ~ '^[a-z0-9][a-z0-9.-]{0,39}$'),
  constraint documentos_legales_url_check
    check (url ~ '^https://[^[:space:]]+$'),
  constraint documentos_legales_sha256_check
    check (octet_length(contenido_sha256) = 32),
  constraint documentos_legales_tipo_vigente_desde_key
    unique (tipo, vigente_desde)
);

alter table public.documentos_legales enable row level security;

-- El catálogo es público para cualquier sesión: no tiene datos de nadie.
create policy documentos_legales_select on public.documentos_legales
  for select to authenticated using (true);

-- POR QUÉ ESTE REVOKE: pg_default_acl concede TODO sobre cada tabla nueva de
-- `public` a anon y authenticated (CLAUDE.md §9). Solo lectura, y solo con
-- sesión: anon no tiene ni un grant en el proyecto. Las altas se hacen con
-- service_role/Studio, como el resto de los catálogos.
revoke all on public.documentos_legales from anon, authenticated;
grant select on public.documentos_legales to authenticated;

-- Una versión ya publicada no se edita, para NINGÚN rol (también Studio y
-- service_role): cambiar su URL o su hash rompería la prueba de qué texto
-- aceptó cada quien. Una corrección es una versión nueva. Borrar sí se puede,
-- pero solo una versión que nadie aceptó: la FK de `aceptaciones_legales`
-- (sin cascade) lo impide en cuanto existe una aceptación.
create function private.documento_legal_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'documento_legal_inmutable' using errcode = '55000';
end;
$$;

revoke all on function private.documento_legal_inmutable() from public, anon, authenticated;

create trigger documentos_legales_inmutable
  before update on public.documentos_legales
  for each row execute function private.documento_legal_inmutable();

create trigger documentos_legales_sin_truncate
  before truncate on public.documentos_legales
  for each statement execute function private.documento_legal_inmutable();

-- ---------------------------------------------------------------------------
-- 2. aceptaciones_legales
-- ---------------------------------------------------------------------------

-- Una fila por (usuario, documento, versión). `accion` está atada al tipo:
-- los Términos se ACEPTAN y el Aviso se PRESENTA (P5, condición 1 de la
-- aprobación). `aceptado_at` la pone el servidor: el cliente no escribe en
-- esta tabla.
--
-- `user_id` en cascade: la evidencia se borra con la cuenta (P4; el abogado
-- lo valida en PL-009). La FK al documento NO es cascade: es lo que impide
-- borrar una versión aceptada.
create table public.aceptaciones_legales (
  user_id     uuid not null references public.users(id) on delete cascade,
  tipo        text not null,
  version     text not null,
  accion      text not null,
  aceptado_at timestamptz not null default now(),
  primary key (user_id, tipo, version),
  constraint aceptaciones_legales_documento_fkey
    foreign key (tipo, version) references public.documentos_legales (tipo, version),
  constraint aceptaciones_legales_accion_check
    check ((tipo = 'terminos' and accion = 'aceptado')
        or (tipo = 'aviso_privacidad' and accion = 'presentado'))
);

alter table public.aceptaciones_legales enable row level security;

create policy aceptaciones_legales_select_own on public.aceptaciones_legales
  for select to authenticated using (user_id = (select auth.uid()));

-- Solo lectura de las propias. Escribir es SOLO por `aceptar_terminos()`.
revoke all on public.aceptaciones_legales from anon, authenticated;
grant select on public.aceptaciones_legales to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------

-- La regla de "vigente" vive UNA vez. EXECUTE para authenticated porque la
-- usa `estado_terminos()`, que es invoker; no revela nada que el catálogo no
-- muestre ya.
create function private.version_vigente(p_tipo text)
returns text
language sql
stable
set search_path = ''
as $$
  select d.version
    from public.documentos_legales d
   where d.tipo = p_tipo
     and d.vigente_desde <= now()
   order by d.vigente_desde desc
   limit 1;
$$;

revoke all on function private.version_vigente(text) from public, anon;
grant execute on function private.version_vigente(text) to authenticated;

-- ¿`auth.uid()` aceptó la versión VIGENTE de los dos documentos? False si
-- falta una vigente (Q3, falla cerrado), si no hay sesión, o si lo que aceptó
-- es una versión anterior (Q1).
--
-- INVOKER: solo lee las aceptaciones PROPIAS, que la RLS de quien llama ya le
-- muestra (`aceptaciones_legales_select_own`), y el catálogo, que es legible.
-- Medido con T42: definer e invoker dan lo mismo, así que no se eleva nada. Si
-- algún día esa policy desaparece, falla CERRADO (nadie cuenta como aceptado).
-- EXECUTE para authenticated porque la invocan policies (el SIGSEGV de
-- KNOWN_ISSUES.md). Sin parámetros: siempre respecto a `auth.uid()`, así que
-- no sirve para preguntar por terceros. `sql stable`, sin bloque `exception`.
create function private.terminos_vigentes_aceptados()
returns boolean
language sql
stable
set search_path = ''
as $$
  select count(*) = 2
    from (values ('terminos'), ('aviso_privacidad')) t(tipo)
    join public.aceptaciones_legales a
      on a.tipo = t.tipo
     and a.version = private.version_vigente(t.tipo)
     and a.user_id = (select auth.uid());
$$;

revoke all on function private.terminos_vigentes_aceptados() from public, anon;
grant execute on function private.terminos_vigentes_aceptados() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. RPC del cliente
-- ---------------------------------------------------------------------------

-- La QUINTA definer de `public` (CLAUDE.md §3). Definer porque escribe en una
-- tabla que el cliente no puede escribir. Quién acepta sale de `auth.uid()` y
-- la hora de `now()`: el cliente solo dice QUÉ versiones vio, y si no son las
-- vigentes (vio una vieja, o mandó una inventada) se rechaza con
-- `22023 version_no_vigente`: la app vuelve a leer el estado y se las enseña.
--
-- Idempotente: aceptar dos veces la misma versión no cambia `aceptado_at`
-- (`on conflict do nothing`), así que un reintento tras un fallo de red es
-- inofensivo.
create function public.aceptar_terminos(p_version_terminos text, p_version_aviso text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'no_autenticado' using errcode = '42501';
  end if;
  if p_version_terminos is distinct from private.version_vigente('terminos')
     or p_version_aviso is distinct from private.version_vigente('aviso_privacidad') then
    raise exception 'version_no_vigente' using errcode = '22023';
  end if;

  insert into public.aceptaciones_legales (user_id, tipo, version, accion)
  values (v_uid, 'terminos', p_version_terminos, 'aceptado'),
         (v_uid, 'aviso_privacidad', p_version_aviso, 'presentado')
  on conflict (user_id, tipo, version) do nothing;
end;
$$;

revoke all on function public.aceptar_terminos(text, text) from public, anon;
grant execute on function public.aceptar_terminos(text, text) to authenticated;

-- Lo que la app necesita en UNA llamada: la versión vigente de cada documento,
-- desde cuándo rige (la pantalla dice "versión del …"), su URL, si la sesión ya
-- la aceptó y si aceptó ALGUNA versión de ese tipo (sin ninguna, la cuenta es
-- previa a PL-016 y ve la variante "Acepta los términos de RLVO"). INVOKER: lee el catálogo y las
-- aceptaciones PROPIAS con la RLS de quien llama, así que no puede devolver
-- nada ajeno. Sin versión vigente, ese tipo no aparece (la app lo trata como
-- "no se puede aceptar todavía").
create function public.estado_terminos()
returns table (tipo text, version text, vigente_desde timestamptz, url text,
                aceptado boolean, acepto_alguna boolean)
language sql
stable
set search_path = ''
as $$
  select d.tipo,
         d.version,
         d.vigente_desde,
         d.url,
         exists (
           select 1
             from public.aceptaciones_legales a
            where a.user_id = (select auth.uid())
              and a.tipo = d.tipo
              and a.version = d.version
         ),
         exists (
           select 1
             from public.aceptaciones_legales a
            where a.user_id = (select auth.uid())
              and a.tipo = d.tipo
         )
    from public.documentos_legales d
   where d.version = private.version_vigente(d.tipo);
$$;

revoke all on function public.estado_terminos() from public, anon;
grant execute on function public.estado_terminos() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Policies: el helper en el `with check` (P3)
-- ---------------------------------------------------------------------------
--
-- `alter policy` conserva el nombre y el resto de la policy; cada expresión es
-- la viva (pg_policies, medido en local el 2026-10-27) más el helper al final.
-- `listings_update_own` NO cambia: allí el candado es el trigger del bloque 6,
-- porque pausar sí se permite (P2) y una policy no distingue qué columnas
-- cambiaron.

alter policy listings_insert_own on public.listings
  with check ((user_id = (select auth.uid()))
              and (select private.is_active_user())
              and (estado = 'pendiente'::public.listing_status)
              and (select private.terminos_vigentes_aceptados()));

alter policy listing_photos_insert_own on public.listing_photos
  with check ((exists (select 1
                         from public.listings l
                        where l.id = listing_photos.listing_id
                          and l.user_id = (select auth.uid())
                          and l.estado <> 'bloqueada'::public.listing_status))
              and (select private.is_active_user())
              and (select private.terminos_vigentes_aceptados()));

alter policy listing_photos_objects_insert_own on storage.objects
  with check ((bucket_id = 'listing-photos'::text)
              and (exists (select 1
                             from public.listings l
                            where l.id = private.listing_id_from_object_name(objects.name)
                              and l.user_id = (select auth.uid())
                              and l.estado <> 'bloqueada'::public.listing_status))
              and (select private.is_active_user())
              and (select private.terminos_vigentes_aceptados()));

alter policy avatars_objects_insert_own on storage.objects
  with check ((bucket_id = 'avatars'::text)
              and ((storage.foldername(name))[1] = ((select auth.uid()))::text)
              and (select private.terminos_vigentes_aceptados()));

alter policy ratings_insert_own on public.ratings
  with check ((from_user_id = (select auth.uid()))
              and (select private.is_active_user())
              and (select private.can_rate(ratings.to_user_id, ratings.listing_id))
              and (select private.terminos_vigentes_aceptados()));

alter policy ratings_update_own on public.ratings
  with check ((from_user_id = (select auth.uid()))
              and (select private.can_rate(ratings.to_user_id, ratings.listing_id))
              and (select private.terminos_vigentes_aceptados()));

alter policy listing_contacts_insert_own on public.listing_contacts
  with check ((user_id = (select auth.uid()))
              and (select private.is_active_user())
              and (not private.listing_con_bloqueo(listing_id))
              and (select private.terminos_vigentes_aceptados()));

alter policy listing_sales_insert_seller on public.listing_sales
  with check ((exists (select 1
                         from public.listings l
                        where l.id = listing_sales.listing_id
                          and l.user_id = (select auth.uid())))
              and (comprador_id <> (select auth.uid()))
              and (select private.is_active_user())
              and (exists (select 1
                             from public.listing_contacts c
                            where c.listing_id = listing_sales.listing_id
                              and c.user_id = listing_sales.comprador_id))
              and (select private.terminos_vigentes_aceptados()));

alter policy listing_sales_update_seller on public.listing_sales
  with check ((exists (select 1
                         from public.listings l
                        where l.id = listing_sales.listing_id
                          and l.user_id = (select auth.uid())))
              and (comprador_id <> (select auth.uid()))
              and (exists (select 1
                             from public.listing_contacts c
                            where c.listing_id = listing_sales.listing_id
                              and c.user_id = listing_sales.comprador_id))
              and (select private.terminos_vigentes_aceptados()));

-- ---------------------------------------------------------------------------
-- 6. Triggers: lo que una policy no puede distinguir
-- ---------------------------------------------------------------------------
--
-- Los dos actúan SOLO cuando quien escribe es el dueño de la fila
-- (`auth.uid()`). Así no frenan a service_role ni a Studio (sin `auth.uid()`),
-- ni al panel (el admin no es el dueño: las RPC de `admin.*` lo impiden), ni
-- a `increment_listing_view` (excluye al dueño) ni a la pausa por suspensión
-- (la dispara el admin). Rechazan con `42501 terminos_no_aceptados`, que la
-- app reconoce para abrir "Términos actualizados" (Q1).

-- listings: sin aceptación, el dueño solo puede PAUSAR (`activa → pausada`
-- sin tocar nada más, P2). Reactivar, editar y marcar vendida se rechazan.
-- "Nada más" se compara sobre la fila entera menos las columnas que otros
-- triggers BEFORE reescriben (`updated_at`, `veredicto_en_pantalla`) y la
-- generada (`busqueda`), que en un BEFORE no trae el valor nuevo.
create function private.exige_terminos_listing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ignoradas text[] := array['estado', 'updated_at', 'veredicto_en_pantalla', 'busqueda'];
begin
  if (select auth.uid()) is distinct from old.user_id then
    return new;
  end if;
  if old.estado = 'activa'
     and new.estado = 'pausada'
     and (to_jsonb(new) - v_ignoradas) = (to_jsonb(old) - v_ignoradas) then
    return new;
  end if;
  if not private.terminos_vigentes_aceptados() then
    raise exception 'terminos_no_aceptados' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.exige_terminos_listing() from public, anon, authenticated;

create trigger listings_exige_terminos
  before update on public.listings
  for each row execute function private.exige_terminos_listing();

-- users: sin aceptación, el dueño no escribe un valor NUEVO en `foto_url`,
-- `telefono` ni `carrera` (P3). Ponerlos en NULL sí pasa: quitar un dato no
-- publica nada. `nombre` y `campus_id` quedan fuera del `of` (P2).
create function private.exige_terminos_perfil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is distinct from old.id then
    return new;
  end if;
  if (   (new.foto_url is not null and new.foto_url is distinct from old.foto_url)
      or (new.telefono is not null and new.telefono is distinct from old.telefono)
      or (new.carrera  is not null and new.carrera  is distinct from old.carrera))
     and not private.terminos_vigentes_aceptados() then
    raise exception 'terminos_no_aceptados' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.exige_terminos_perfil() from public, anon, authenticated;

create trigger users_exige_terminos
  before update of foto_url, telefono, carrera on public.users
  for each row execute function private.exige_terminos_perfil();

-- ---------------------------------------------------------------------------
-- 7. seller_whatsapp: quinta causa de null
-- ---------------------------------------------------------------------------
--
-- Quien llama sin haber aceptado no recibe el número (P3, "contactar por
-- WhatsApp"). Solo se mira a QUIEN LLAMA: un vendedor que aceptó una versión
-- anterior sigue siendo contactable (Q1). `create or replace` conserva OID,
-- grants y contrato. El resto del cuerpo es el de 20261013000487.
create or replace function public.seller_whatsapp(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- Devuelve NULL —y no `raise exception`— en los cinco casos: vendedor sin
  -- número, llamante suspendido, objetivo suspendido, bloqueo entre los dos
  -- (en cualquier dirección, 20261013000487) y llamante sin los términos
  -- vigentes aceptados (20261026000490). La función no dice por qué negó; la
  -- UI separa las causas con datos que ya tiene (el `estado` del propio
  -- usuario y el del vendedor, `interaccion_disponible()` para el bloqueo y
  -- `estado_terminos()` para los términos).
  select case
    when (select private.is_active_user())
     and (select private.terminos_vigentes_aceptados())
    then (select u.telefono
          from public.users u
          where u.id = p_user_id
            and u.estado = 'activo'
            and not exists (
              select 1
                from public.user_bloqueos b
               where (b.user_id = (select auth.uid()) and b.bloqueado_id = p_user_id)
                  or (b.user_id = p_user_id and b.bloqueado_id = (select auth.uid()))
            ))
  end;
$$;
