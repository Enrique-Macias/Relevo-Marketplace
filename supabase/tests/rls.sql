-- ===========================================================================
-- Relevo — suite de regresión de RLS, grants y triggers.
--
-- Cómo correrla:
--     supabase db reset
--     docker exec -i $(docker ps --filter name=supabase_db_relevo-marketplace \
--       --format '{{.ID}}') psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
--       < supabase/tests/rls.sql
--
-- NO uses `supabase test db`: ese comando corre las pruebas bajo un harness
-- pgTAP y termina en "Result: FAIL / No plan found in TAP output" AUNQUE TODAS
-- las aserciones hayan pasado — esta suite no emite TAP, emite `raise notice`.
-- Ese FAIL es del harness, no del esquema, y confunde de verdad: se ven 46
-- líneas "ok —" seguidas de un FAIL. Corriéndola por psql, el código de salida
-- sí es el real (0 = todo bien).
--
-- Falla ruidosamente: cada aserción levanta una excepción si no se cumple, y
-- ON_ERROR_STOP corta a la primera. Si el script termina imprimiendo
-- "TODAS LAS PRUEBAS PASARON", todo está bien.
--
-- Por qué existe: un agujero real sobrevivió a la revisión del esquema y solo
-- apareció al ejecutar consultas como un usuario autenticado de verdad. El
-- pg_default_acl de Supabase otorga TODOS los privilegios sobre cada tabla nueva
-- a anon/authenticated, así que los grants de columna eran aditivos y no
-- protegían nada: `users.correo` resultó legible por cualquiera. Como `postgres`
-- es dueño de las tablas y esquiva RLS y privilegios de columna, correr las
-- pruebas como superusuario habría dado todo por bueno.
-- Las pruebas T1, T4, T4b, T7c, T8b y las de T12 cazan una regresión de eso.
--
-- Las escrituras (T3, T6, T7...) son además la evidencia continua de que las
-- policies pueden llamar a las funciones de `private` sin que `authenticated`
-- tenga acceso a ese esquema: las expresiones de policy se evalúan con los
-- privilegios del dueño de la tabla.
-- ===========================================================================

\set ON_ERROR_STOP on
\pset pager off
\timing off

begin;

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

create or replace function pg_temp.assert(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'FALLÓ: %', p_msg;
  end if;
  raise notice '  ok — %', p_msg;
end $$;

-- Ejecuta un SQL como `authenticated` con el JWT de p_uid y espera que falle
-- con el SQLSTATE dado. 42501 = privilege_not_granted, 42501 también cubre el
-- "permission denied" de columna; las violaciones de RLS llegan como 42501.
-- NOTA: el rol se cambia con set_config('role', ...) y NO con
-- `execute 'set local role ...'`. La segunda forma, combinada con el manejador
-- de excepciones de abajo, dispara de manera intermitente un SIGSEGV del backend
-- en PostgreSQL 17.6 — ver supabase/KNOWN_ISSUES.md. Es un problema del harness,
-- no del esquema: PostgREST nunca cambia de rol dentro de un bloque plpgsql con
-- captura de excepciones.
create or replace function pg_temp.expect_error(
  p_uid uuid, p_sql text, p_msg text
) returns void language plpgsql as $$
declare
  v_err text;
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute p_sql;
    perform set_config('role', 'postgres', true);
    raise exception 'FALLÓ: % — la operación fue permitida y debía ser rechazada', p_msg;
  exception
    when insufficient_privilege then
      perform set_config('role', 'postgres', true);
      raise notice '  ok — % (rechazado: permiso)', p_msg;
    when others then
      v_err := sqlerrm;
      perform set_config('role', 'postgres', true);
      if sqlstate = 'P0001' and v_err like 'FALLÓ:%' then
        raise exception '%', v_err;
      end if;
      raise notice '  ok — % (rechazado: %)', p_msg, v_err;
  end;
end $$;

-- Corre un SQL como `authenticated` y devuelve el escalar resultante.
create or replace function pg_temp.as_user_int(p_uid uuid, p_sql text)
returns bigint language plpgsql as $$
declare v_out bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v_out;
  perform set_config('role', 'postgres', true);
  return v_out;
end $$;

-- Hermana de as_user_int para columnas y funciones que devuelven texto. La
-- estrena T16 (`seller_whatsapp` devuelve el número, no un conteo).
create or replace function pg_temp.as_user_text(p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare v_out text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v_out;
  perform set_config('role', 'postgres', true);
  return v_out;
end $$;

-- Ejecuta un SQL como `authenticated` esperando que funcione.
create or replace function pg_temp.as_user(p_uid uuid, p_sql text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql;
  perform set_config('role', 'postgres', true);
end $$;

-- Nació con T28 y se subió aquí para que T16 (el check del teléfono) la use:
-- `expect_error` acepta CUALQUIER error, así que un rechazo por el candado
-- equivocado pasaría; ésta compara SQLSTATE y NOMBRE del constraint.
-- `<sqlstate>:<constraint>` del error que lanza p_sql, u 'ok'. Como
-- `authenticated` si p_uid no es null; como `postgres` si lo es.
create or replace function pg_temp.rechazo_de(p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare v_con text;
begin
  if p_uid is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
  end if;
  execute p_sql;
  perform set_config('role', 'postgres', true);
  return 'ok';
exception when others then
  get stacked diagnostics v_con = constraint_name;
  perform set_config('role', 'postgres', true);
  return sqlstate || coalesce(':' || nullif(v_con, ''), '');
end $$;

-- RF-17, Ola 1 (T35): claims con `aal` y `amr`. Los helpers de arriba solo
-- ponen `sub` y `role`. Con `p_con_amr = false` la clave `amr` NO va; con
-- `p_con_amr = true` y `p_amr = null` va como JSON `null`, a propósito: es el
-- caso de D18 que `coalesce` no atrapa (`cannot extract elements from a scalar`).
create or replace function pg_temp.claims_aal(
  p_uid uuid, p_aal text, p_amr jsonb, p_con_amr boolean default true)
returns text language sql as $$
  select (jsonb_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)
          || case when p_con_amr then jsonb_build_object('amr', p_amr)
                  else '{}'::jsonb end)::text
$$;

-- El `amr` que emite GoTrue tras password + TOTP (medido en el Paso 0 de la
-- Ola 1), con los dos timestamps de hace `p_horas` horas.
create or replace function pg_temp.amr_totp(p_horas int)
returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('method', 'password',
                       'timestamp', extract(epoch from now())::bigint - p_horas * 3600),
    jsonb_build_object('method', 'totp',
                       'timestamp', extract(epoch from now())::bigint - p_horas * 3600))
$$;

-- `'ok'` o `<sqlstate>:<constraint, o el MENSAJE si no hay constraint>`. Las
-- guardas de `admin.*` y de `private.exigir_admin()` comparten SQLSTATE (42501)
-- y se distinguen por el mensaje (`no_admin`, `mfa_requerido`, `totp_vencido`,
-- `objetivo_es_admin`…), así que compararlo es lo único que dice CUÁL rechazó.
-- Con `p_como_authenticated = false` corre como `postgres` con los claims
-- puestos: así se llama a `private.exigir_admin()`, revocada a authenticated.
create or replace function pg_temp.rechazo_aal(
  p_uid uuid, p_aal text, p_amr jsonb, p_sql text,
  p_con_amr boolean default true, p_como_authenticated boolean default true)
returns text language plpgsql as $$
declare v_con text; v_msg text;
begin
  perform set_config('request.jwt.claims',
    pg_temp.claims_aal(p_uid, p_aal, p_amr, p_con_amr), true);
  if p_como_authenticated then
    perform set_config('role', 'authenticated', true);
  end if;
  execute p_sql;
  perform set_config('role', 'postgres', true);
  return 'ok';
exception when others then
  get stacked diagnostics v_con = constraint_name, v_msg = message_text;
  perform set_config('role', 'postgres', true);
  return sqlstate || ':' || coalesce(nullif(v_con, ''), v_msg);
end $$;

-- Hermana de `as_user_text` con `aal`/`amr`: el escalar de p_sql, como
-- authenticated.
create or replace function pg_temp.as_aal_text(
  p_uid uuid, p_aal text, p_amr jsonb, p_sql text, p_con_amr boolean default true)
returns text language plpgsql as $$
declare v_out text;
begin
  perform set_config('request.jwt.claims',
    pg_temp.claims_aal(p_uid, p_aal, p_amr, p_con_amr), true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v_out;
  perform set_config('role', 'postgres', true);
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures. Se crean dentro de la transacción y desaparecen con el rollback
-- final, así que la suite es idempotente y puede correrse cuantas veces sea.
-- ---------------------------------------------------------------------------

\set A '''aaaaaaaa-0000-0000-0000-00000000000a'''
\set B '''bbbbbbbb-0000-0000-0000-00000000000b'''
\set C '''cccccccc-0000-0000-0000-00000000000c'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  (:A::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-a@tec.mx', '', now(), now(), now()),
  (:B::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-b@tec.mx', '', now(), now(), now()),
  (:C::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-c@tec.mx', '', now(), now(), now());

\echo ''
\echo '== T0 — trigger de provisión de perfiles =='
select pg_temp.assert(
  (select count(*) from public.users where id in (:A::uuid, :B::uuid, :C::uuid)) = 3,
  'handle_new_user creó los 3 perfiles desde auth.users');

-- Y con la universidad de su dominio (20260924000466). No es redundante con
-- T28 (a): las publicaciones sembradas justo abajo dependen de esto, porque
-- `listings_user_universidad_fkey` exige que la universidad de la publicación
-- sea la del dueño. Sin esta aserción, un trigger que dejara de asignarla
-- tumbaría la suite en el insert de abajo con un error crudo de FK, lejos de
-- su causa.
select pg_temp.assert(
  (select count(*) from public.users
    where id in (:A::uuid, :B::uuid, :C::uuid)
      and universidad_id = (select universidad_id from public.universidad_dominios
                             where dominio = 'tec.mx')) = 3,
  'los 3 perfiles nacen con la universidad de su dominio (tec.mx)');

update public.users set nombre = 'Ana'  where id = :A::uuid;
update public.users set nombre = 'Beto' where id = :B::uuid;
update public.users set nombre = 'Caro' where id = :C::uuid;

-- Publicaciones de B: una activa y una pausada.
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, descripcion, precio, condicion, estado)
values
  (:B::uuid, 1, 1, 1, 'RLS Cálculo de Larson', 'Novena edición', 350, 'como_nuevo', 'activa'),
  (:B::uuid, 1, 1, 1, 'RLS Libro pausado',     'No visible',     100, 'usado',      'pausada');

create temp table t_ids as
select
  (select id from public.listings where titulo = 'RLS Cálculo de Larson') as activa,
  (select id from public.listings where titulo = 'RLS Libro pausado')     as pausada;

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T1 — RNF-05: `correo` no es legible por la Data API =='
-- Regresión de: pg_default_acl. Si alguien agrega una tabla sin `revoke all`
-- previo, o quita el de users, esta prueba vuelve a fallar.
select pg_temp.expect_error(:A::uuid,
  'select correo from public.users limit 1',
  'A no puede leer users.correo');

select pg_temp.assert(
  pg_temp.as_user_int(:A::uuid, 'select count(*) from public.users') = 3,
  'A sí ve las columnas públicas de los 3 perfiles');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T2 — listings: las pausadas solo las ve su dueño =='
select pg_temp.assert(
  pg_temp.as_user_int(:A::uuid,
    'select count(*) from public.listings where titulo like ''RLS %''') = 1,
  'A ve solo la publicación activa de B');

select pg_temp.assert(
  pg_temp.as_user_int(:B::uuid,
    'select count(*) from public.listings where titulo like ''RLS %''') = 2,
  'B ve las suyas, incluida la pausada');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T3 — no se puede publicar en nombre de otro =='
-- `estado` VA EXPLÍCITO Y EN 'pendiente', y no es prolijidad: desde
-- 20260919000463 el `with_check` de listings_insert_own también lo exige. Sin
-- esta columna el insert cae al default 'activa' de la tabla, y esta aserción
-- seguiría en VERDE por el estado en vez de por el `user_id` suplantado —
-- `expect_error` acepta cualquier error, así que la diferencia no se vería.
-- Es la lección de `:C` en T11b: una aserción que pasa por otro motivo no está
-- probando lo que dice.
select pg_temp.expect_error(:A::uuid,
  format('insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                                       titulo, precio, condicion, estado)
          values (%L, 1, 1, 1, ''RLS Suplantado'', 1, ''nuevo'', ''pendiente'')', :B::uuid),
  'A no puede insertar un listing con user_id de B');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T4 — columnas mantenidas por el sistema, no por el cliente =='
select pg_temp.expect_error(:A::uuid,
  format('update public.users set rating_promedio = 5 where id = %L', :A::uuid),
  'A no puede escribir su propio rating_promedio');

select pg_temp.expect_error(:B::uuid,
  format('update public.listings set vistas_count = 99999 where id = %s',
         (select activa from t_ids)),
  'el dueño no puede escribir vistas_count directamente');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T5 — RPC de vistas: cuenta a ajenos, no al dueño =='
select pg_temp.as_user(:A::uuid,
  format('select public.increment_listing_view(%s)', (select activa from t_ids)));
select pg_temp.assert(
  (select vistas_count from public.listings where id = (select activa from t_ids)) = 1,
  'la visita de A incrementó el contador');

select pg_temp.as_user(:B::uuid,
  format('select public.increment_listing_view(%s)', (select activa from t_ids)));
select pg_temp.assert(
  (select vistas_count from public.listings where id = (select activa from t_ids)) = 1,
  'la visita del dueño B NO incrementó el contador');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T6 — listing_contacts habilita "¿A quién le vendiste?" =='
select pg_temp.as_user(:A::uuid,
  format('insert into public.listing_contacts (user_id, listing_id) values (%L, %s)',
         :A::uuid, (select activa from t_ids)));

select pg_temp.assert(
  pg_temp.as_user_int(:B::uuid, 'select count(*) from public.listing_contacts') = 1,
  'el vendedor B ve quién lo contactó');

select pg_temp.assert(
  pg_temp.as_user_int(:C::uuid, 'select count(*) from public.listing_contacts') = 0,
  'un tercero (C) no ve los contactos ajenos');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T7 — ratings: requieren contacto previo y no se reapuntan =='
select pg_temp.expect_error(:C::uuid,
  format('insert into public.ratings (from_user_id, to_user_id, listing_id, estrellas)
          values (%L, %L, %s, 5)', :C::uuid, :B::uuid, (select activa from t_ids)),
  'C no puede calificar a B sin haberlo contactado');

select pg_temp.as_user(:A::uuid,
  format('insert into public.ratings (from_user_id, to_user_id, listing_id, estrellas, comentario)
          values (%L, %L, %s, 4, ''Todo bien'')',
         :A::uuid, :B::uuid, (select activa from t_ids)));

select pg_temp.assert(
  (select rating_promedio from public.users where id = :B::uuid) = 4.00,
  'el trigger dejó el rating_promedio de B en 4.00');

select pg_temp.expect_error(:A::uuid,
  format('update public.ratings set to_user_id = %L where from_user_id = %L', :C::uuid, :A::uuid),
  'A no puede reapuntar su reseña hacia otra persona');

select pg_temp.as_user(:A::uuid,
  format('update public.ratings set estrellas = 2 where from_user_id = %L', :A::uuid));
select pg_temp.assert(
  (select rating_promedio from public.users where id = :B::uuid) = 2.00,
  'corregir las estrellas recalculó el promedio a 2.00');

select pg_temp.expect_error(:A::uuid,
  format('delete from public.ratings where from_user_id = %L', :A::uuid),
  'una calificación no se puede borrar');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T8 — reports: snapshots y supervivencia al borrado del objetivo =='
-- Este insert valida que capture_report_snapshot() es SECURITY DEFINER: como
-- invoker fallaría al leer users.correo, que no está en el grant.
select pg_temp.as_user(:A::uuid,
  format('insert into public.reports (reporter_id, reported_user_id, motivo, comentario)
          values (%L, %L, ''no_es_estudiante'', ''Perfil sospechoso'')', :A::uuid, :C::uuid));

select pg_temp.assert(
  (select reported_user_correo from public.reports where reported_user_id = :C::uuid) = 'rls-c@tec.mx',
  'el snapshot guardó el correo del usuario reportado');

select pg_temp.expect_error(:A::uuid,
  'select reported_user_correo from public.reports',
  'el reportante no puede leer reported_user_correo');

select pg_temp.as_user(:A::uuid,
  format('insert into public.reports (reporter_id, listing_id, motivo)
          values (%L, %s, ''sospecha_fraude'')', :A::uuid, (select activa from t_ids)));

select pg_temp.assert(
  (select listing_titulo from public.reports where listing_id = (select activa from t_ids))
    = 'RLS Cálculo de Larson',
  'el snapshot guardó el título de la publicación reportada');

select pg_temp.expect_error(:A::uuid,
  format('insert into public.reports (reporter_id, listing_id, reported_user_id, motivo)
          values (%L, %s, %L, ''otro'')',
         :A::uuid, (select pausada from t_ids), :B::uuid),
  'no se puede reportar publicación y usuario a la vez (XOR)');

-- El caso que rompía el check de XOR estricto.
select pg_temp.as_user(:B::uuid,
  format('delete from public.listings where id = %s', (select activa from t_ids)));
select pg_temp.assert(
  exists (select 1 from public.reports
          where listing_id is null and listing_titulo = 'RLS Cálculo de Larson'),
  'borrar la publicación reportada no falla y el reporte sobrevive con su título');

-- Hasta 20260929000474 el correo se CONSERVABA (era para qué existía el
-- snapshot). Desde "Eliminar cuenta" (decisión 5, CLAUDE.md §3) el reporte
-- sobrevive pero sin la identidad de quien borró su cuenta. T33 lo prueba a
-- fondo; aquí se corrige la aserción que afirmaba lo contrario.
delete from auth.users where id = :C::uuid;
select pg_temp.assert(
  exists (select 1 from public.reports
          where reported_user_id is null and reported_user_correo is null
            and listing_id is null and listing_titulo is null)
  and not exists (select 1 from public.reports where reported_user_correo = 'rls-c@tec.mx'),
  'borrar la cuenta reportada no borra el reporte, pero sí el snapshot de su correo');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T9 — tope de 5 fotos por publicación =='
select pg_temp.as_user(:B::uuid,
  format('insert into public.listing_photos (listing_id, storage_path, orden) values
          (%1$s,''u0'',0),(%1$s,''u1'',1),(%1$s,''u2'',2),(%1$s,''u3'',3),(%1$s,''u4'',4)',
         (select pausada from t_ids)));

select pg_temp.expect_error(:B::uuid,
  format('insert into public.listing_photos (listing_id, storage_path, orden)
          values (%s, ''u5'', 5)', (select pausada from t_ids)),
  'la sexta foto es rechazada por el trigger');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T10 — usuario suspendido =='
-- Desde 20260930000478, suspender exige `suspendido_at` y un motivo
-- (`users_suspension_coherente`), también como postgres (D15).
update public.users set estado = 'suspendido', suspendido_at = now(), suspension_motivo = 'fixture de prueba' where id = :B::uuid;

select pg_temp.assert(
  pg_temp.as_user_int(:B::uuid,
    format('with u as (update public.listings set titulo = ''Cambiado'' where id = %s returning 1)
            select count(*) from u', (select pausada from t_ids))) = 0,
  'un suspendido no puede editar su publicación');

select pg_temp.assert(
  pg_temp.as_user_int(:B::uuid,
    format('with d as (delete from public.listings where id = %s returning 1)
            select count(*) from d', (select pausada from t_ids))) = 0,
  'un suspendido no puede borrar su publicación');

-- `estado` explícito por el mismo motivo que en T3: sin él, esta aserción
-- pasaría por el `with_check` de moderación y no por `is_active_user()`.
select pg_temp.expect_error(:B::uuid,
  format('insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                                       titulo, precio, condicion, estado)
          values (%L, 1, 1, 1, ''RLS Nueva'', 10, ''nuevo'', ''pendiente'')', :B::uuid),
  'un suspendido no puede publicar');

select pg_temp.assert(
  pg_temp.as_user_int(:B::uuid, 'select count(*) from public.listings') >= 1,
  'un suspendido SÍ puede leer el catálogo');

select pg_temp.as_user(:B::uuid,
  format('insert into public.favorites (user_id, listing_id) values (%L, %s)',
         :B::uuid, (select pausada from t_ids)));
select pg_temp.as_user(:B::uuid,
  format('update public.users set nombre = ''Beto corregido'' where id = %L', :B::uuid));
select pg_temp.assert(
  (select nombre from public.users where id = :B::uuid) = 'Beto corregido',
  'un suspendido SÍ puede usar favoritos y editar su perfil');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T11 — favoritos privados =='
select pg_temp.assert(
  pg_temp.as_user_int(:A::uuid, 'select count(*) from public.favorites') = 0,
  'A no ve los favoritos de B');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T11b — conteo de favoritos: solo lo ve el dueño de la publicación =='
-- La tarjeta de stats de "Detalle (vista vendedor)" necesita este número, pero
-- la RLS de favorites se lo esconde al vendedor. listing_favorites_count() lo
-- devuelve sin exponer QUIÉN dio favorito — y solo al dueño.
--
-- OJO CON REUSAR t_ids AQUÍ: para este punto del archivo, `t_ids.activa` ya no
-- existe — T8 la borra a propósito, probando que un reporte sobrevive al
-- borrado de su objetivo. Y `:C` tampoco: T8 borra esa cuenta de auth.users.
-- Por eso esta sección se siembra su propia publicación, como hacen las
-- fixtures del inicio: directo, no vía as_user, porque `listings_insert_own`
-- exige is_active_user() y B quedó suspendido en T10.
--
-- RF-17 Ola 4 (20261007000480): una `activa` de un dueño suspendido ya no se
-- puede crear, ni como postgres. Aquí el dueño TIENE que ser `:B`, porque la
-- primera aserción prueba justo que un suspendido lee el conteo de SU
-- publicación; con otro dueño dejaría de probarlo. Así que la fila se siembra
-- como el estado LEGACY que representa (anterior a …480), apagando el trigger
-- de INSERT solo alrededor de este insert, dentro de la transacción de la suite.
alter table public.listings disable trigger listings_exige_dueno_activo_ins;
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
values (:B::uuid, 1, 1, 1, 'RLS Favoritos contables', 99, 'nuevo', 'activa');
alter table public.listings enable trigger listings_exige_dueno_activo_ins;

create temp table t_fav as
select (select id from public.listings where titulo = 'RLS Favoritos contables') as listing;

-- A sigue activo y no es dueño de nada: es quien da el favorito.
select pg_temp.as_user(:A::uuid,
  format('insert into public.favorites (user_id, listing_id) values (%L, %s)',
         :A::uuid, (select listing from t_fav)));

-- B está suspendido desde T10, y aun así lee el conteo de SU publicación: leer
-- es de las cosas que un suspendido conserva (tabla de decisión, CLAUDE.md §3),
-- y la función no lleva is_active_user() a propósito. Si alguien se lo agrega
-- "por endurecer", esta aserción es la que lo caza.
select pg_temp.assert(
  pg_temp.as_user_int(:B::uuid,
    format('select public.listing_favorites_count(%s)', (select listing from t_fav))) = 1,
  'B, dueño de la publicación, recibe el conteo real (1)');

-- Camino negativo — lo que de verdad importa: sin el `exists` de la función,
-- esta devolvería 1 y filtraría un agregado de una publicación ajena. A es el
-- caso más estricto posible: ni siendo quien dio el favorito puede contarlos.
select pg_temp.assert(
  pg_temp.as_user_int(:A::uuid,
    format('select public.listing_favorites_count(%s)', (select listing from t_fav))) is null,
  'A, que NO es dueño, recibe null aunque él mismo dio el favorito');

select pg_temp.assert(
  pg_temp.as_user_int(:B::uuid,
    'select public.listing_favorites_count(-1)') is null,
  'una publicación inexistente devuelve null, no 0');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T13 — búsqueda de texto (columna generada `busqueda`) =='
-- Autocontenida, mismo criterio que T11b: siembra su propia fila y no reutiliza
-- t_ids, que T8 ya borró. Se inserta directo (no vía as_user) porque B quedó
-- suspendido en T10 y listings_insert_own exige is_active_user().
--
-- El título lleva acento A PROPÓSITO: la razón de existir de esta migración es
-- que `ilike '%calculo%'` devolvía 0 sobre "Cálculo de Larson", y el usuario
-- teclea sin acento. Si alguien cambia la config del to_tsvector a 'simple' o
-- 'english', el stemmer deja de plegar el acento y ESTA es la prueba que falla.
--
-- RF-17 Ola 4 (20261007000480): el dueño era `:B` (suspendido) por pura
-- casualidad, y una `activa` de un suspendido ya no se puede sembrar. El dueño
-- aquí es incidental (la búsqueda la hace `:A`), así que va uno ACTIVO propio,
-- `:N13`. No `:A`: T14 depende de que a esta altura `:A` no tenga publicaciones.
\set N13 '''13131313-0000-0000-0000-0000000013a0'''
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values (:N13::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'rls-n13@tec.mx', '', now(), now(), now());

insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, descripcion, precio, condicion, estado)
values (:N13::uuid, 1, 1, 1, 'RLS Cálculo de Larson, 9a edición',
        'Sin subrayados ni marcas', 280, 'como_nuevo', 'activa');

create temp table t_fts as
select (select id from public.listings
         where titulo = 'RLS Cálculo de Larson, 9a edición') as listing;

-- El bug real, no la sintaxis: buscar SIN acento tiene que encontrarlo.
select pg_temp.assert(
  pg_temp.as_user_int(:A::uuid,
    format('select count(*) from public.listings
             where id = %s and busqueda @@ websearch_to_tsquery(''spanish'', ''calculo'')',
           (select listing from t_fts))) = 1,
  'buscar "calculo" SIN acento encuentra "Cálculo" (el bug que motivó la migración)');

select pg_temp.assert(
  pg_temp.as_user_int(:A::uuid,
    format('select count(*) from public.listings
             where id = %s and busqueda @@ websearch_to_tsquery(''spanish'', ''Cálculo'')',
           (select listing from t_fts))) = 1,
  'buscar "Cálculo" CON acento lo encuentra igual');

-- La descripción también entra al vector, no solo el título (RF-10).
select pg_temp.assert(
  pg_temp.as_user_int(:A::uuid,
    format('select count(*) from public.listings
             where id = %s and busqueda @@ websearch_to_tsquery(''spanish'', ''subrayados'')',
           (select listing from t_fts))) = 1,
  'un término que solo vive en la descripción también casa');

-- `*` produce una tsquery vacía, que no casa con nada. Es lo que reemplaza al
-- corto circuito que el cliente tenía cuando la búsqueda era por ilike.
select pg_temp.assert(
  pg_temp.as_user_int(:A::uuid,
    format('select count(*) from public.listings
             where id = %s and busqueda @@ websearch_to_tsquery(''spanish'', ''*'')',
           (select listing from t_fts))) = 0,
  'un término de solo comodines no devuelve nada (tsquery vacía)');

-- Candado sobre el grant HEREDADO: `select` en listings se otorgó a nivel
-- tabla, así que cubre esta columna nueva sin grant propio. Filtrar por una
-- columna exige SELECT sobre ella; si alguien "endurece" el grant a una lista
-- explícita, la app deja de encontrar cosas sin ningún error visible, y esta
-- aserción es lo que lo convierte en una falla ruidosa.
select pg_temp.assert(
  has_column_privilege('authenticated', 'public.listings', 'busqueda', 'select'),
  'authenticated puede leer/filtrar la columna busqueda (grant heredado de tabla)');

-- Columna generada: Postgres la rechaza por sí mismo, sin depender de grants.
select pg_temp.expect_error(:A::uuid,
  format('update public.listings set busqueda = null where id = %s',
         (select listing from t_fts)),
  'nadie puede escribir busqueda (columna generada)');

-- Sin el índice la búsqueda sigue funcionando, solo que por seq scan: se
-- degradaría en silencio justo el motivo de performance de esta migración.
select pg_temp.assert(
  exists (select 1 from pg_indexes
           where schemaname = 'public' and tablename = 'listings'
             and indexname = 'listings_busqueda_idx'
             and indexdef like '%USING gin (busqueda)%'),
  'el índice GIN apunta a la columna busqueda, no a la expresión vieja');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T14 — bucket privado `listing-photos` (RLS de storage.objects) =='
-- Autocontenida, mismo criterio que T11b y T13: siembra lo suyo y no reutiliza
-- t_ids, porque T8 ya borró filas a propósito y T10 dejó suspendido a :B.
-- Aquí el dueño activo es :A, que hasta este punto del archivo no posee nada.
--
-- QUÉ CUBRE Y QUÉ NO: esto prueba las POLICIES. Que el servicio de Storage las
-- aplique de punta a punta sobre HTTP lo prueba scripts/probe-storage.mjs, que
-- habla con el API real en vez de insertar en storage.objects por SQL.

-- El bucket es una fila, no esquema: ninguna migración lo crea. `supabase start`
-- y `db reset` lo levantan desde config.toml, pero la suite no depende de eso
-- para poder correr en una base que venga de otro lado.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Segundo bucket, solo para el control negativo del guard `bucket_id`.
insert into storage.buckets (id, name, public)
values ('otro-bucket', 'otro-bucket', false)
on conflict (id) do nothing;

insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
values
  (:A::uuid, 1, 1, 1, 'RLS Fotos activa',      50, 'nuevo', 'activa'),
  (:A::uuid, 1, 1, 1, 'RLS Fotos pausada',     50, 'nuevo', 'pausada'),
  -- `pausada` y no `activa` desde 20261007000480 (una `activa` de un
  -- suspendido ya no se puede sembrar). Las dos aserciones que la usan siguen
  -- probando lo mismo: la policy de INSERT del objeto mira dueño e
  -- is_active_user(), no el estado, y el dueño ve su `pausada`.
  (:B::uuid, 1, 1, 1, 'RLS Fotos suspendido',  50, 'nuevo', 'pausada');

create temp table t_obj as
select
  (select id from public.listings where titulo = 'RLS Fotos activa')     as activa,
  (select id from public.listings where titulo = 'RLS Fotos pausada')    as pausada,
  (select id from public.listings where titulo = 'RLS Fotos suspendido') as suspendido;

-- --- El parser de ruta -------------------------------------------------------
-- Estas dos aserciones son la razón por la que el helper usa `case` y no un
-- `and` suelto: el nombre del objeto es entrada arbitraria. Si alguien lo
-- "simplifica" a `(storage.foldername(name))[1]::bigint`, esto revienta con
-- 22P02 en vez de devolver null, y la policy pasa de rechazar a fallar.
-- OJO: esto NO se puede probar solo con expect_error sobre el insert — ese
-- helper acepta CUALQUIER error, así que un 22P02 lo daría por bueno y la
-- prueba pasaría por la razón equivocada.
select pg_temp.assert(
  pg_temp.as_user_int(:A::uuid,
    'select (private.listing_id_from_object_name(''basura/x.jpg'') is null
         and private.listing_id_from_object_name(''foto.jpg'') is null
         and private.listing_id_from_object_name(''99999999999999999999999999/x.jpg'') is null)::int') = 1,
  'una ruta no numérica, sin carpeta, o de más de 18 dígitos devuelve null sin error de cast');

select pg_temp.assert(
  pg_temp.as_user_int(:A::uuid,
    format('select private.listing_id_from_object_name(''%s/uuid.jpg'')',
           (select activa from t_obj))) = (select activa from t_obj),
  'una ruta bien formada resuelve al listing_id de su carpeta');

-- --- Escritura ---------------------------------------------------------------
select pg_temp.as_user(:A::uuid,
  format('insert into storage.objects (bucket_id, name) values (''listing-photos'', ''%s/foto.jpg'')',
         (select activa from t_obj)));
select pg_temp.assert(
  (select count(*) from storage.objects where name = (select activa from t_obj) || '/foto.jpg') = 1,
  'A, dueño y activo, sube una foto a la carpeta de su publicación');

select pg_temp.expect_error(:B::uuid,
  format('insert into storage.objects (bucket_id, name) values (''listing-photos'', ''%s/intruso.jpg'')',
         (select activa from t_obj)),
  'B no puede subir a la carpeta de una publicación de A');

select pg_temp.expect_error(:A::uuid,
  format('insert into storage.objects (bucket_id, name) values (''listing-photos'', ''%s/ajena.jpg'')',
         (select suspendido from t_obj)),
  'A no puede subir a la carpeta de una publicación ajena');

select pg_temp.expect_error(:A::uuid,
  'insert into storage.objects (bucket_id, name) values (''listing-photos'', ''basura/x.jpg'')',
  'una ruta sin carpeta de listing es rechazada por la policy');

-- Control negativo del guard `bucket_id`: MISMA ruta, que en listing-photos sí
-- está permitida, pero en otro bucket. Sin ese guard, estas policies estarían
-- concediendo acceso a todo bucket que se agregue después.
select pg_temp.expect_error(:A::uuid,
  format('insert into storage.objects (bucket_id, name) values (''otro-bucket'', ''%s/foto.jpg'')',
         (select activa from t_obj)),
  'la misma ruta en otro bucket no queda cubierta por estas policies');

-- B sigue suspendido desde T10. Es dueño de 'RLS Fotos suspendido', así que lo
-- único que lo detiene es is_active_user(). Si alguien lo quita "porque la tabla
-- ya lo valida", el suspendido quedaría bloqueado en listing_photos pero libre
-- de escribir en Storage, que es la mitad que cuesta dinero.
select pg_temp.expect_error(:B::uuid,
  format('insert into storage.objects (bucket_id, name) values (''listing-photos'', ''%s/suspendido.jpg'')',
         (select suspendido from t_obj)),
  'un suspendido no puede subir fotos ni a su propia publicación');

-- --- Lectura -----------------------------------------------------------------
-- B está suspendido y aun así lee: la policy de SELECT no lleva is_active_user()
-- a propósito (tabla de decisión, CLAUDE.md §3 — un suspendido conserva la
-- lectura del catálogo). Si alguien se la agrega "por endurecer", falla aquí.
select pg_temp.assert(
  pg_temp.as_user_int(:B::uuid,
    format('select count(*) from storage.objects where name = ''%s/foto.jpg''',
           (select activa from t_obj))) = 1,
  'cualquier authenticated lee la foto de una publicación activa');

select pg_temp.as_user(:A::uuid,
  format('insert into storage.objects (bucket_id, name) values (''listing-photos'', ''%s/oculta.jpg'')',
         (select pausada from t_obj)));

-- ESTA es la aserción que justifica que el bucket sea privado. Si alguien lo
-- pone público, o migra la lectura a signed URLs (que evalúan la RLS al firmar y
-- no al servir), esta regla deja de cumplirse en la app aunque la policy siga
-- intacta. Ver la nota de CLAUDE.md §9.
select pg_temp.assert(
  pg_temp.as_user_int(:B::uuid,
    format('select count(*) from storage.objects where name = ''%s/oculta.jpg''',
           (select pausada from t_obj))) = 0,
  'un ajeno NO ve la foto de una publicación pausada');

select pg_temp.assert(
  pg_temp.as_user_int(:A::uuid,
    format('select count(*) from storage.objects where name = ''%s/oculta.jpg''',
           (select pausada from t_obj))) = 1,
  'su dueño SÍ ve la foto de su publicación pausada');

-- --- Borrado: NO se puede probar aquí, y el motivo importa --------------------
-- storage.objects tiene un trigger propio de Supabase (storage.protect_delete)
-- que aborta CUALQUIER delete por SQL directo con "Direct deletion from storage
-- tables is not allowed. Use the Storage API instead." Se dispara antes que la
-- RLS, así que una aserción aquí probaría el trigger de Supabase, no nuestra
-- policy: pasaría igual de bonito con listing_photos_objects_delete_own borrada.
--
-- Esa es justamente una prueba que pasa por la razón equivocada, así que la
-- cobertura de DELETE vive en scripts/probe-storage.mjs, que va por el Storage
-- API y sí ejercita la policy.

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T15 — una publicación no se activa sin fotos =='
-- Autocontenida, mismo criterio que T11b, T13 y T14: siembra lo suyo. El dueño
-- es :A, el único que sigue activo a esta altura del archivo (:B quedó
-- suspendido en T10 y :C borrado en T8), y no reutiliza los listings de T14
-- porque esa sección ya les colgó objetos de Storage.
--
-- QUÉ PROTEGE: el modelo atómico del alta garantiza que *Publicar* nunca active
-- una publicación con fotos incompletas, pero REACTIVAR —desde "Mis
-- publicaciones" o desde el toggle de "Editar publicación"— no validaba nada.
-- El candado es el trigger, no el guard del cliente (CLAUDE.md §0 regla 7).

insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
values
  (:A::uuid, 1, 1, 1, 'RLS Activación pausada', 10, 'nuevo', 'pausada'),
  (:A::uuid, 1, 1, 1, 'RLS Activación vieja',   10, 'nuevo', 'activa');

create temp table t_act as
select
  (select id from public.listings where titulo = 'RLS Activación pausada') as pausada,
  (select id from public.listings where titulo = 'RLS Activación vieja')   as vieja;

select pg_temp.expect_error(:A::uuid,
  format('update public.listings set estado = ''activa'' where id = %s',
         (select pausada from t_act)),
  'ni el dueño puede activar una publicación sin fotos');

-- Con una foto, la misma operación pasa. Sin esta aserción el trigger podría
-- estar rechazando SIEMPRE y la de arriba seguiría en verde.
select pg_temp.as_user(:A::uuid,
  format('insert into public.listing_photos (listing_id, storage_path, orden)
          values (%s, ''%s/foto.jpg'', 0)',
         (select pausada from t_act), (select pausada from t_act)));

select pg_temp.as_user(:A::uuid,
  format('update public.listings set estado = ''activa'' where id = %s',
         (select pausada from t_act)));

select pg_temp.assert(
  (select estado from public.listings where id = (select pausada from t_act)) = 'activa',
  'con al menos una foto, el dueño sí activa su publicación');

-- EL CONTROL QUE PROTEGE LAS FILAS VIEJAS. En remoto hay publicaciones `activa`
-- con 0 fotos (creadas antes de que existiera la subida, o dadas de alta desde
-- Studio). El trigger lleva `when (old.estado is distinct from new.estado ...)`
-- justamente para no tocarlas: sin ese `when`, editarle el precio a una de ellas
-- fallaría sin que nada explique por qué.
--
-- OJO: si alguien quita el `when`, la suite falla ANTES de llegar aquí — muere
-- en T5, porque increment_listing_view() actualiza vistas_count y el trigger se
-- le dispara encima. Esta aserción igual se queda: es la que nombra el caso, y
-- T5 seguiría en verde si algún día esa RPC dejara de tocar `listings`.
select pg_temp.as_user(:A::uuid,
  format('update public.listings set titulo = ''RLS Activación vieja editada'' where id = %s',
         (select vieja from t_act)));

select pg_temp.assert(
  (select titulo from public.listings where id = (select vieja from t_act))
    = 'RLS Activación vieja editada',
  'una publicación activa SIN fotos sigue siendo editable (el `when` no dispara)');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T16 — teléfono del vendedor (RF-13) sin romper RNF-05 =='
-- Autocontenida, mismo criterio que T11b, T13, T14 y T15: no reutiliza fixtures
-- de secciones anteriores.
--
-- ES LA PRIMERA SECCIÓN QUE SIEMBRA SU PROPIO USUARIO, y hace falta: el contacto
-- tiene DOS puntas y `seller_whatsapp` valida las dos, así que probarlo exige un
-- vendedor ACTIVO — y a esta altura del archivo :A es el único que queda activo
-- (:B lo suspendió T10, :C lo borró T8). Sin :D, el camino feliz solo podría
-- probarse contra uno mismo, y la negativa del objetivo no podría distinguirse
-- de la del llamante.
--
-- El reparto: cada aserción prueba UNA cosa.
--   :A — comprador activo, y el dueño que escribe su propio número.
--   :D — vendedor ACTIVO con teléfono → el camino feliz.
--   :B — vendedor SUSPENDIDO con teléfono → no se le puede contactar.
\set D '''dddddddd-0000-0000-0000-00000000000d'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values (:D::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'rls-d@tec.mx', '', now(), now(), now());
update public.users set nombre = 'Dora' where id = :D::uuid;

-- El corazón de RNF-05: el número no se lee por la Data API, ni el propio.
-- Hermana de T1 con `correo`. Si alguien agrega `telefono` al grant de select
-- "para que el cliente lo pinte", esta es la que lo caza.
select pg_temp.expect_error(:A::uuid,
  'select telefono from public.users limit 1',
  'A no puede leer users.telefono');

-- El booleano derivado SÍ es público: es lo que el gate de Publicar necesita
-- para decidir si mostrar el campo, y no dice nada del número.
--
-- Se pregunta por :D y no por un count() de la tabla a propósito: a esta altura
-- del archivo :C ya no existe (T8 borra su cuenta de auth.users y el cascade se
-- lleva su perfil), así que cualquier conteo global aquí probaría de rebote una
-- cuenta que otra sección maneja — la moraleja de CLAUDE.md §3.
select pg_temp.assert(
  pg_temp.as_user_int(:A::uuid,
    format('select (tiene_telefono)::int from public.users where id = %L', :D::uuid)) = 0,
  'A puede leer tiene_telefono de otro usuario, y D todavía no tiene número');

-- El check de formato. Los dos casos que un usuario real produce: escribir los
-- 10 dígitos sin lada, y quedarse a medias.
--
-- CAMBIARON con 20260927000470 (ladas de cualquier país), y no se borraron:
-- los dos siguen siendo rechazos, pero la CAUSA de la primera ya no es "le
-- falta el +52" —hoy +1, +34… son válidos— sino "le falta el `+`", y el check
-- se renombró de `users_telefono_e164_mx` a `users_telefono_e164`. Pasaron de
-- `expect_error` (acepta cualquier error) a `rechazo_de()`, que fija el
-- SQLSTATE y el nombre del constraint. La cobertura por país vive en T31.
select pg_temp.assert(
  pg_temp.rechazo_de(:A::uuid,
    format('update public.users set telefono = ''8111234567'' where id = %L', :A::uuid))
    = '23514:users_telefono_e164',
  'un número sin + (sin lada) lo rechaza el check');
select pg_temp.assert(
  pg_temp.rechazo_de(:A::uuid,
    format('update public.users set telefono = ''+521234'' where id = %L', :A::uuid))
    = '23514:users_telefono_e164',
  'un número incompleto lo rechaza el check');

-- El dueño escribe el suyo.
select pg_temp.as_user(:A::uuid,
  format('update public.users set telefono = ''+528111111111'' where id = %L', :A::uuid));
select pg_temp.assert(
  (select telefono from public.users where id = :A::uuid) = '+528111111111',
  'A guardó su propio teléfono');

-- La columna generada se mantiene sola. Si alguien la cambia por una columna
-- normal "para poder escribirla", esta aserción sigue pasando pero la de abajo
-- (la que prueba que NO se puede escribir) no.
select pg_temp.assert(
  pg_temp.as_user_int(:A::uuid,
    format('select (tiene_telefono)::int from public.users where id = %L', :A::uuid)) = 1,
  'tiene_telefono pasó a true solo, sin escribirla nadie');

-- Doble candado, y da igual cuál conteste primero: no hay grant de UPDATE sobre
-- la columna (42501) y Postgres rechaza escribir una columna generada de todos
-- modos (428C9). Lo que se prueba es que no hay camino.
select pg_temp.expect_error(:A::uuid,
  format('update public.users set tiene_telefono = false where id = %L', :A::uuid),
  'tiene_telefono no es escribible ni por su dueño');

-- Nadie escribe el teléfono de otro. `users_update_own` no lanza error: filtra
-- la fila y el update afecta 0 filas, así que lo que se comprueba es que el
-- valor de D siga intacto.
select pg_temp.as_user(:A::uuid,
  format('update public.users set telefono = ''+529999999999'' where id = %L', :D::uuid));
select pg_temp.assert(
  (select telefono from public.users where id = :D::uuid) is null,
  'A no pudo escribir el teléfono de D');

-- Vendedor sin número: la RPC devuelve null, no error. Es el caso de las
-- publicaciones creadas antes de que esta columna existiera.
--
-- SE PREGUNTA POR :D Y NO POR :B, y es justo el punto: :B está suspendido, así
-- que desde que la RPC valida también al objetivo daría null por DOS motivos a
-- la vez y esta aserción pasaría por la razón equivocada — el mismo error que
-- CLAUDE.md §3 documenta con la cuenta :C de T11b. :D está activo, así que el
-- null solo puede ser porque no tiene número.
select pg_temp.assert(
  pg_temp.as_user_text(:A::uuid,
    format('select public.seller_whatsapp(%L)', :D::uuid)) is null,
  'un vendedor ACTIVO sin número devuelve null, no error');

-- Los dos vendedores guardan el suyo. :B está SUSPENDIDO desde T10 y aun así
-- puede: editar el propio perfil es de las cosas que un suspendido conserva
-- (tabla de decisión de CLAUDE.md §3). Si alguien le agrega is_active_user() al
-- update de users, esta es la que lo caza.
select pg_temp.as_user(:D::uuid,
  format('update public.users set telefono = ''+528133333333'' where id = %L', :D::uuid));
select pg_temp.as_user(:B::uuid,
  format('update public.users set telefono = ''+528122222222'' where id = %L', :B::uuid));

-- El camino feliz de RF-13: un comprador activo obtiene el número de un vendedor
-- activo para abrir WhatsApp.
select pg_temp.assert(
  pg_temp.as_user_text(:A::uuid,
    format('select public.seller_whatsapp(%L)', :D::uuid)) = '+528133333333',
  'A (activo) recibe el número de D (activo) para contactarlo');

-- LAS DOS PUNTAS DEL CONTACTO. La tabla de decisión de §3 dice que un suspendido
-- no puede contactar NI SER CONTACTADO, y cada dirección la hace cumplir una
-- mitad distinta de la función — por eso son dos aserciones y no una.
--
-- Esta es la del OBJETIVO: la descubrió una prueba en dispositivo, donde un
-- comprador activo sí llegaba a WhatsApp de un vendedor suspendido. La hace
-- cumplir el `and u.estado = 'activo'` del subselect.
select pg_temp.assert(
  pg_temp.as_user_text(:A::uuid,
    format('select public.seller_whatsapp(%L)', :B::uuid)) is null,
  'A (activo) NO obtiene el número de B: no se contacta a una cuenta suspendida');

-- Y esta es la del LLAMANTE, que hace cumplir el `case` de arriba. Pide el
-- número de :D (activo) a propósito: si pidiera el de un suspendido, el null
-- podría venir del otro chequeo y la aserción no probaría nada.
--
-- Por qué ninguna de las dos puede vivir en otro lado: listing_contacts_insert_own
-- ya exige is_active_user(), pero el cliente se traga ese rechazo a propósito
-- (abre wa.me igual y solo avisa con un toast, para no negar un contacto por un
-- fallo de log), así que el único efecto real de estar suspendido era no quedar
-- registrado. Con el número detrás de la RPC, estas dos aserciones son lo que
-- impide que alguien quite cualquiera de los dos chequeos "por simplificar".
select pg_temp.assert(
  pg_temp.as_user_text(:B::uuid,
    format('select public.seller_whatsapp(%L)', :D::uuid)) is null,
  'B (suspendido) NO obtiene el número de D: no puede contactar');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T17 — tokens de push por dispositivo (RF-16) =='
-- Autocontenida, mismo criterio que T11b, T13, T14, T15 y T16: siembra sus
-- propios usuarios. A esta altura del archivo :B está suspendido, :C fue borrada
-- por T8 y :A ya tiene teléfono y estado propios — reutilizar cualquiera haría
-- que una aserción pasara por la razón equivocada (CLAUDE.md §3).
--
-- El reparto: :E y :F son dos cuentas activas cualesquiera. Lo que se prueba no
-- depende de su estado, sino de quién es dueño de qué fila.
\set E '''eeeeeeee-0000-0000-0000-00000000000e'''
\set F '''ffffffff-0000-0000-0000-00000000000f'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  (:E::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-e@tec.mx', '', now(), now(), now()),
  (:F::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-f@tec.mx', '', now(), now(), now());
update public.users set nombre = 'Eva'  where id = :E::uuid;
update public.users set nombre = 'Fito' where id = :F::uuid;

-- El registro normal: cada quien inserta el token de su propio aparato.
select pg_temp.as_user(:E::uuid,
  format('insert into public.push_tokens (token, user_id, platform)
          values (''ExponentPushToken[EEE]'', %L, ''ios'')', :E::uuid));
select pg_temp.as_user(:F::uuid,
  format('insert into public.push_tokens (token, user_id, platform)
          values (''ExponentPushToken[FFF]'', %L, ''android'')', :F::uuid));

select pg_temp.assert(
  pg_temp.as_user_int(:E::uuid, 'select count(*) from public.push_tokens') = 1,
  'E solo ve su propio token, no el de F');

-- Nadie registra un token a nombre de otro. Este es el punto de enforcement que
-- el trigger de reasignación NO reemplaza: la policy de insert sigue siendo la
-- que decide de quién puede ser la fila nueva.
select pg_temp.expect_error(:E::uuid,
  format('insert into public.push_tokens (token, user_id, platform)
          values (''ExponentPushToken[ROBADO]'', %L, ''ios'')', :F::uuid),
  'E no puede registrar un token a nombre de F');

-- Sin grant de UPDATE: la única escritura que lo habría necesitado era el upsert
-- de reasignación, que no funciona (ver la migración). Si alguien lo agrega
-- "para poder hacer upsert", esta lo caza.
select pg_temp.expect_error(:E::uuid,
  'update public.push_tokens set platform = ''android''',
  'push_tokens no tiene grant de UPDATE para nadie');

-- Borrar el ajeno no lanza error: la policy filtra la fila y el delete afecta 0.
-- Lo que se comprueba es que el token de F siga existiendo.
select pg_temp.as_user(:E::uuid,
  'delete from public.push_tokens where token = ''ExponentPushToken[FFF]''');
select pg_temp.assert(
  (select count(*) from public.push_tokens where token = 'ExponentPushToken[FFF]') = 1,
  'E no pudo borrar el token de F');

-- EL CASO QUE ORIGINÓ TODO EL DISEÑO DE ESTA TABLA: el mismo teléfono cambia de
-- cuenta. Expo entrega el MISMO token, así que la fila tiene que cambiar de
-- dueño. El cliente manda un insert plano con DO NOTHING y el trigger
-- `push_tokens_claim` libera la fila del dueño anterior.
--
-- Si alguien "simplifica" esto a un upsert (`do update`), falla con
-- "new row violates row-level security policy (USING expression)", porque el
-- USING de la policy de UPDATE se evalúa contra la fila VIEJA. Y si lo deja en
-- DO NOTHING sin el trigger, no falla: se queda callado y F nunca recibe un push.
select pg_temp.as_user(:F::uuid,
  format('insert into public.push_tokens (token, user_id, platform)
          values (''ExponentPushToken[EEE]'', %L, ''android'')
          on conflict (token) do nothing', :F::uuid));
select pg_temp.assert(
  (select count(*) from public.push_tokens where token = 'ExponentPushToken[EEE]') = 1
  and (select user_id from public.push_tokens where token = 'ExponentPushToken[EEE]') = :F::uuid,
  'un token que cambia de cuenta queda en UNA sola fila, del dueño nuevo');

select pg_temp.assert(
  pg_temp.as_user_int(:E::uuid, 'select count(*) from public.push_tokens') = 0,
  'E dejó de tener ese token: el aparato ya no es suyo');

-- CONTROL NEGATIVO de la anterior, y sin él la anterior no prueba lo que dice:
-- un trigger que borrara INCONDICIONALMENTE también dejaría una sola fila. Lo
-- que distingue al correcto es que el re-registro normal de cada arranque —el
-- mismo usuario mandando su mismo token— no duplique ni borre nada.
select pg_temp.as_user(:F::uuid,
  format('insert into public.push_tokens (token, user_id, platform)
          values (''ExponentPushToken[EEE]'', %L, ''android'')
          on conflict (token) do nothing', :F::uuid));
select pg_temp.assert(
  (select count(*) from public.push_tokens where user_id = :F::uuid) = 2,
  'F re-registrando su propio token no duplica ni pierde el otro');

-- Cerrar sesión: el cliente borra el token de ESTE aparato, o el teléfono
-- seguiría recibiendo los push de la cuenta anterior.
select pg_temp.as_user(:F::uuid,
  'delete from public.push_tokens where token = ''ExponentPushToken[EEE]''');
select pg_temp.assert(
  (select count(*) from public.push_tokens where token = 'ExponentPushToken[EEE]') = 0,
  'F borró el token de su propio aparato al cerrar sesión');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T18 — inbox de notificaciones y sus disparadores (RF-16) =='
-- Sigue con :E y :F de T17, que son de esta misma tanda y cuyo estado no lo toca
-- ninguna sección intermedia.
--   :E — vendedora. Marca como favorita SU PROPIA publicación, que es lo que
--        hace falta para probar que no se le notifica a sí misma.
--   :F — compradora que tiene la publicación en favoritos.

insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, descripcion, precio, condicion, estado)
values (:E::uuid, 1, 1, 1, 'RLS Monitor', 'Para notificaciones', 3200, 'buen_estado', 'activa'),
       (:E::uuid, 1, 1, 1, 'RLS Pausada', 'Para notificaciones', 500, 'usado', 'pausada');

create temporary table t_notif on commit drop as
select max(id) filter (where titulo = 'RLS Monitor')  as activa,
       max(id) filter (where titulo = 'RLS Pausada')  as pausada
  from public.listings where user_id = :E::uuid;

insert into public.favorites (user_id, listing_id)
select :F::uuid, activa from t_notif
union all
select :E::uuid, activa from t_notif   -- la dueña también la tiene en favoritos
union all
select :F::uuid, pausada from t_notif;

-- --- Disparador 1: bajó el precio ------------------------------------------

select pg_temp.as_user(:E::uuid,
  format('update public.listings set precio = 2900 where id = %s',
         (select activa from t_notif)));

select pg_temp.assert(
  (select count(*) from public.notifications where user_id = :F::uuid) = 1,
  'bajar el precio notifica a quien la tiene en favoritos');

-- El `and f.user_id <> new.user_id` del trigger. Un vendedor PUEDE marcar como
-- favorita su propia publicación (la RLS de favorites solo compara user_id), así
-- que sin ese `<>` se notificaría a sí mismo su propio cambio.
select pg_temp.assert(
  (select count(*) from public.notifications where user_id = :E::uuid) = 0,
  'a la dueña NO se le notifica su propio cambio de precio');

-- El texto se materializa en el trigger porque el precio ANTERIOR no existe en
-- ningún lado después del UPDATE. Esta aserción es lo único que amarra el
-- formato de SQL con `formatPrecio` del cliente.
select pg_temp.assert(
  (select cuerpo from public.notifications where user_id = :F::uuid)
    = '"RLS Monitor" ahora cuesta $2,900, antes $3,200.',
  'el cuerpo trae el precio nuevo y el anterior, con separador de miles');

select pg_temp.assert(
  (select listing_id from public.notifications where user_id = :F::uuid)
    = (select activa from t_notif),
  'la notificación de precio apunta a la publicación, para el tap');

-- El bloque "CENTAVOS" que vivía aquí (un update a precio = 99.50 y su
-- aserción de que el cuerpo sale "$99.50, no redondeado a $100") se quitó al
-- volver el precio un entero (20260922000464): escribir 99.50 ahora es un
-- error de `check`, no un caso de formateo que valga la pena probar en un
-- trigger de notificaciones. Ese `check` es hoy el amarre real entre
-- `formatPrecio` y `private.formato_precio()` — ver T26.

-- Las dos condiciones del `when`, cada una con su aserción.
select pg_temp.as_user(:E::uuid,
  format('update public.listings set precio = 5000 where id = %s',
         (select activa from t_notif)));
select pg_temp.assert(
  (select count(*) from public.notifications where user_id = :F::uuid) = 1,
  'SUBIR el precio no notifica a nadie');

select pg_temp.as_user(:E::uuid,
  format('update public.listings set precio = 100 where id = %s',
         (select pausada from t_notif)));
select pg_temp.assert(
  (select count(*) from public.notifications where user_id = :F::uuid) = 1,
  'bajar el precio de una PAUSADA no notifica: nadie más puede verla');

-- --- Disparador 2: respuesta a un reporte -----------------------------------

insert into public.reports (reporter_id, listing_id, motivo)
select :F::uuid, activa, 'spam_publicidad' from t_notif;

-- La transición la hace service_role desde Studio (RF-17): `reports` no tiene
-- grant de update para authenticated, así que el trigger no puede depender de
-- auth.uid().
update public.reports set estado = 'resuelto' where reporter_id = :F::uuid;

select pg_temp.assert(
  (select count(*) from public.notifications
    where user_id = :F::uuid and tipo = 'reporte_resuelto') = 1,
  'resolver un reporte notifica a quien lo levantó');

select pg_temp.assert(
  (select cuerpo from public.notifications
    where user_id = :F::uuid and tipo = 'reporte_resuelto')
    = 'Revisamos tu reporte sobre una publicación y tomamos acción.',
  'el copy del reporte sale de `estado`, sin necesitar un campo de respuesta');

-- El tap NO lleva de vuelta al contenido que la persona denunció.
select pg_temp.assert(
  (select listing_id from public.notifications
    where user_id = :F::uuid and tipo = 'reporte_resuelto') is null,
  'la notificación de reporte no deep-linkea a la publicación reportada');

-- El `old.estado is distinct from new.estado` del `when`: un update que no
-- cambia el estado (por ejemplo llenar un snapshot a mano) no debe re-notificar.
update public.reports set comentario = 'nota de moderación' where reporter_id = :F::uuid;
select pg_temp.assert(
  (select count(*) from public.notifications
    where user_id = :F::uuid and tipo = 'reporte_resuelto') = 1,
  'un update de reports que no toca `estado` no vuelve a notificar');

-- --- La RLS del inbox -------------------------------------------------------

select pg_temp.assert(
  pg_temp.as_user_int(:E::uuid, 'select count(*) from public.notifications') = 0,
  'E no ve ninguna notificación de F');

-- Sin grant de insert: las filas solo nacen de los triggers. Sin esto, cualquiera
-- podría fabricarse avisos — o peor, fabricárselos a otro.
select pg_temp.expect_error(:F::uuid,
  format('insert into public.notifications (user_id, tipo, titulo, cuerpo)
          values (%L, ''precio_favorito'', ''Falso'', ''Falso'')', :F::uuid),
  'nadie puede insertar una notificación a mano');

-- Marcar leído es lo ÚNICO que el cliente puede escribir.
select pg_temp.as_user(:F::uuid,
  'update public.notifications set leida_at = now()');
select pg_temp.assert(
  pg_temp.as_user_int(:F::uuid,
    'select count(*) from public.notifications where leida_at is null') = 0,
  'F puede marcar sus notificaciones como leídas');

-- El grant de COLUMNA. La policy dice qué filas; esto dice qué columnas. Sin él,
-- un usuario reescribiría el texto de su propia notificación.
select pg_temp.expect_error(:F::uuid,
  'update public.notifications set titulo = ''Editado''',
  'F no puede reescribir el titulo de su propia notificación');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T19 — venta registrada: comprador, corrección y can_rate (RF-07/RF-12) =='
-- Autocontenida, mismo criterio que T11b, T13, T14, T15, T16 y T17: siembra sus
-- propios usuarios y su propia publicación. A esta altura del archivo :B está
-- suspendido, :C fue borrada por T8, y :A/:D/:E/:F ya cargan estado de otras
-- secciones — reutilizar cualquiera haría que una aserción pasara por la razón
-- equivocada (CLAUDE.md §3).
--
-- El reparto, y cada pieza existe por una aserción concreta:
--   :G — el vendedor.
--   :H — el comprador REAL.
--   :I — otro contacto: preguntó y NO compró. Es el que prueba que `can_rate()`
--        quedó apretado, y el que en (l2) califica al vendedor sin congelar la
--        corrección.
\set G '''11111111-0000-0000-0000-000000000011'''
\set H '''22222222-0000-0000-0000-000000000022'''
\set I '''33333333-0000-0000-0000-000000000033'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  (:G::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-g@tec.mx', '', now(), now(), now()),
  (:H::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-h@tec.mx', '', now(), now(), now()),
  (:I::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-i@tec.mx', '', now(), now(), now());
update public.users set nombre = 'Gabriel' where id = :G::uuid;
update public.users set nombre = 'Hilda'   where id = :H::uuid;
update public.users set nombre = 'Iker'    where id = :I::uuid;

insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
values (:G::uuid, 1, 1, 1, 'RLS Venta bici', 1450, 'buen_estado', 'activa');
\set VENTA_ID '(select id from public.listings where titulo = ''RLS Venta bici'')'

-- Los dos contactan. Es la precondición de TODO lo demás: sin fila en
-- listing_contacts no hay venta registrable ni calificación posible.
insert into public.listing_contacts (user_id, listing_id)
values (:H::uuid, :VENTA_ID), (:I::uuid, :VENTA_ID);

-- (h2) CONTROL POSITIVO, y va antes de registrar la venta a propósito: sin fila
-- de venta, can_rate() se comporta como siempre y el vendedor puede calificar a
-- cualquiera de sus contactos. Sin esta, un can_rate() que devolviera false
-- siempre también pasaría (g2).
select pg_temp.assert(
  pg_temp.as_user_int(:G::uuid,
    format('select (private.can_rate(%L, %s))::int', :I::uuid, :VENTA_ID)) = 1,
  'sin venta registrada, G puede calificar a I (control positivo de la rama 1)');

-- (h) La misma, en la otra dirección.
select pg_temp.assert(
  pg_temp.as_user_int(:I::uuid,
    format('select (private.can_rate(%L, %s))::int', :G::uuid, :VENTA_ID)) = 1,
  'sin venta registrada, I puede calificar a G (control positivo de la rama 2)');

-- (c) No puede venderse a sí mismo.
select pg_temp.expect_error(:G::uuid,
  format('insert into public.listing_sales (listing_id, comprador_id)
          values (%s, %L)', :VENTA_ID, :G::uuid),
  'G no puede registrarse a sí mismo como comprador');

-- (b) EL punto de enforcement de "el comprador tiene que haberte contactado".
-- :D nunca contactó esta publicación. Sin este exists, un vendedor apuntaría a
-- cualquiera y le dispararía la notificación de compra.
select pg_temp.expect_error(:G::uuid,
  format('insert into public.listing_sales (listing_id, comprador_id)
          values (%s, %L)', :VENTA_ID, :D::uuid),
  'G no puede acreditar como comprador a alguien que nunca lo contactó');

-- (d) Un tercero no registra la venta de una publicación ajena.
select pg_temp.expect_error(:H::uuid,
  format('insert into public.listing_sales (listing_id, comprador_id)
          values (%s, %L)', :VENTA_ID, :H::uuid),
  'H no puede registrarse como comprador de la publicación de G');

-- (a) El camino feliz.
select pg_temp.as_user(:G::uuid,
  format('insert into public.listing_sales (listing_id, comprador_id)
          values (%s, %L)', :VENTA_ID, :H::uuid));
select pg_temp.assert(
  (select comprador_id from public.listing_sales where listing_id = :VENTA_ID) = :H::uuid,
  'G registró a H como compradora');

-- (i) El disparador del cuarto tipo de notificación.
select pg_temp.assert(
  (select count(*) from public.notifications
    where user_id = :H::uuid and tipo = 'compra_calificable'
      and listing_id = :VENTA_ID) = 1,
  'H recibió su aviso "Califica tu compra", con listing_id poblado');

-- (e) Solo las dos partes ven la fila. I contactó esa misma publicación y aun
-- así no puede saber quién se la llevó.
select pg_temp.assert(
  pg_temp.as_user_int(:H::uuid, 'select count(*) from public.listing_sales') = 1,
  'H ve la venta en la que es compradora');
select pg_temp.assert(
  pg_temp.as_user_int(:I::uuid, 'select count(*) from public.listing_sales') = 0,
  'I no ve la venta, aunque haya contactado esa publicación');

-- (g)/(g2) EL APRIETE DE can_rate(), en las dos direcciones. Comparar con (h) y
-- (h2) de arriba: los mismos dos pares de personas, el mismo listing, y la
-- ÚNICA diferencia es que ahora existe la fila de venta.
select pg_temp.assert(
  pg_temp.as_user_int(:I::uuid,
    format('select (private.can_rate(%L, %s))::int', :G::uuid, :VENTA_ID)) = 0,
  'registrada la venta, I ya NO puede calificar al vendedor (rama 2)');
select pg_temp.assert(
  pg_temp.as_user_int(:G::uuid,
    format('select (private.can_rate(%L, %s))::int', :I::uuid, :VENTA_ID)) = 0,
  'registrada la venta, G ya NO puede calificar a I (rama 1)');

-- (f) Y la pareja correcta sí puede.
select pg_temp.assert(
  pg_temp.as_user_int(:H::uuid,
    format('select (private.can_rate(%L, %s))::int', :G::uuid, :VENTA_ID)) = 1,
  'H, la compradora registrada, sí puede calificar al vendedor');

-- (o) La corrección no puede apuntarse al propio vendedor. Hermana de (c), que
-- prueba el mismo predicado en el insert.
select pg_temp.expect_error(:G::uuid,
  format('update public.listing_sales set comprador_id = %L where listing_id = %s',
         :G::uuid, :VENTA_ID),
  'G no puede corregir el comprador hacia sí mismo');

-- (k) Ni hacia alguien que nunca lo contactó.
select pg_temp.expect_error(:G::uuid,
  format('update public.listing_sales set comprador_id = %L where listing_id = %s',
         :D::uuid, :VENTA_ID),
  'G no puede corregir el comprador hacia alguien que nunca lo contactó');

-- (m) Un tercero no corrige la venta ajena. No lanza: el `using` filtra la fila
-- y el update afecta 0, así que lo que se comprueba es que H siga siendo la
-- compradora.
select pg_temp.as_user(:H::uuid,
  format('update public.listing_sales set comprador_id = %L where listing_id = %s',
         :H::uuid, :VENTA_ID));
select pg_temp.assert(
  (select comprador_id from public.listing_sales where listing_id = :VENTA_ID) = :H::uuid,
  'H no pudo tocar la venta de la publicación de G');

-- (l2) LA ASIMETRÍA DEL CONGELAMIENTO, que es la razón de ser de esta sección.
--
-- OJO CON EL ORDEN, que es lo único que hace que esta aserción pruebe lo que
-- dice: quien califica tiene que ser EL COMPRADOR REGISTRADO EN ESE MOMENTO. Si
-- calificara alguien que todavía no lo es, el congelamiento bidireccional
-- —que compara contra `listing_sales.comprador_id`— tampoco se dispararía, y
-- la aserción pasaría con las DOS variantes sin distinguir ninguna. (Medido: la
-- primera versión de este bloque tenía a I calificando mientras H seguía
-- registrada, y el control negativo de la variante bidireccional caía en la
-- aserción de abajo, no en esta.)
--
-- El insert va como H y no como postgres porque puede: es la compradora
-- registrada, así que can_rate() la autoriza — es la aserción (f) ejercida de
-- verdad.
select pg_temp.as_user(:H::uuid,
  format('insert into public.ratings (from_user_id, to_user_id, listing_id, estrellas)
          values (%L, %L, %s, 4)', :H::uuid, :G::uuid, :VENTA_ID));

-- Y ahora G se da cuenta de que se equivocó de persona. La reseña que H ya dejó
-- NO puede dejarlo sin corregir: castigaría a G y al comprador real por un acto
-- de un tercero. Si alguien "simplifica" el `not exists` de la policy a las dos
-- direcciones, esta es la aserción que lo caza.
select pg_temp.as_user(:G::uuid,
  format('update public.listing_sales set comprador_id = %L where listing_id = %s',
         :I::uuid, :VENTA_ID));
select pg_temp.assert(
  (select comprador_id from public.listing_sales where listing_id = :VENTA_ID) = :I::uuid,
  'una reseña DEL comprador registrado hacia el vendedor no congela la corrección');

-- (j) Y la corrección funciona en las dos direcciones: G vuelve a poner a H.
select pg_temp.as_user(:G::uuid,
  format('update public.listing_sales set comprador_id = %L where listing_id = %s',
         :H::uuid, :VENTA_ID));
select pg_temp.assert(
  (select comprador_id from public.listing_sales where listing_id = :VENTA_ID) = :H::uuid,
  'G corrigió el comprador de vuelta a H');

-- (n) Cada corrección avisa al comprador nuevo. H tiene dos: la del insert y la
-- de esta corrección. El anterior conserva el suyo — `notifications` no tiene
-- delete y sus filas son historia.
select pg_temp.assert(
  (select count(*) from public.notifications
    where user_id = :H::uuid and tipo = 'compra_calificable') = 2,
  'la corrección disparó un aviso nuevo para la compradora restituida');

-- (l) EL CONGELAMIENTO DE VERDAD: la reseña DEL VENDEDOR hacia el comprador
-- registrado. A partir de aquí la venta no se toca más.
insert into public.ratings (from_user_id, to_user_id, listing_id, estrellas)
values (:G::uuid, :H::uuid, :VENTA_ID, 5);

select pg_temp.as_user(:G::uuid,
  format('update public.listing_sales set comprador_id = %L where listing_id = %s',
         :I::uuid, :VENTA_ID));
select pg_temp.assert(
  (select comprador_id from public.listing_sales where listing_id = :VENTA_ID) = :H::uuid,
  'una vez que G calificó a H, la venta quedó congelada');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T20 — vendida es terminal: ningún UPDATE sobre listings (RF-08) =='
-- Autocontenida, por la misma moraleja de siempre (CLAUDE.md §3): a esta altura
-- del archivo casi todos los usuarios anteriores cargan estado de otras
-- secciones, y :G/:H/:I acaban de quedar con una venta CONGELADA por la reseña
-- de (l). Reutilizarlos haría que estas aserciones pasaran por la razón
-- equivocada.
--
-- El reparto:
--   :J — el vendedor, dueño de las tres publicaciones.
--   :K — la compradora. Además es quien invoca increment_listing_view() en (i),
--        porque esa función excluye al dueño por diseño.
--   :L — el segundo contacto, al que se reapunta la venta en (c).
--
-- Las tres publicaciones existen por una aserción cada una: una nace 'activa' y
-- se vende, otra nace 'pausada' y se vende (son dos transiciones distintas), y
-- la tercera NO se vende nunca — es el control de (h), sin el cual estas pruebas
-- no distinguirían "bloqueado por vendida" de "bloqueado por grant o por
-- suspensión".
\set J '''44444444-0000-0000-0000-000000000044'''
\set K '''55555555-0000-0000-0000-000000000055'''
\set L '''66666666-0000-0000-0000-000000000066'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  (:J::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-j@tec.mx', '', now(), now(), now()),
  (:K::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-k@tec.mx', '', now(), now(), now()),
  (:L::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-l@tec.mx', '', now(), now(), now());
update public.users set nombre = 'Julia'   where id = :J::uuid;
update public.users set nombre = 'Karla'   where id = :K::uuid;
update public.users set nombre = 'Leonel'  where id = :L::uuid;

insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
values
  (:J::uuid, 1, 1, 1, 'RLS Terminal activa',  900, 'nuevo',        'activa'),
  (:J::uuid, 1, 1, 1, 'RLS Terminal pausada', 700, 'buen_estado',  'pausada'),
  (:J::uuid, 1, 1, 1, 'RLS Terminal control', 500, 'como_nuevo',   'activa');

-- Los ids en una temp table y no en un \set sobre el título: (f) intenta
-- reescribir el título y (h) SÍ lo reescribe, así que un handle basado en el
-- título dejaría de resolver justo donde hace falta.
create temp table t_term as
select
  (select id from public.listings where titulo = 'RLS Terminal activa')  as vendida_a,
  (select id from public.listings where titulo = 'RLS Terminal pausada') as vendida_p,
  (select id from public.listings where titulo = 'RLS Terminal control') as control;

-- Precondición de la venta y de su corrección: ambas policies de listing_sales
-- exigen que el comprador tenga fila en listing_contacts.
insert into public.listing_contacts (user_id, listing_id)
values (:K::uuid, (select vendida_a from t_term)),
       (:L::uuid, (select vendida_a from t_term));

-- ESTA FOTO NO ES DECORADO, y lo destapó el control negativo: sin ella, (d)
-- fallaba con «Una publicación no puede activarse sin fotos» en vez de con su
-- propio mensaje. O sea que quien bloqueaba la reactivación era el trigger
-- `listings_enforce_activation_has_photos` (20260909000447) y no la policy de
-- esta migración, y (d) no probaba lo que dice. Con la foto, el trigger queda
-- satisfecho y el único candado posible sobre esa reactivación es el `estado <>
-- 'vendida'` del `using`.
insert into public.listing_photos (listing_id, storage_path, orden)
values ((select vendida_a from t_term),
        'rls-terminal/00000000-0000-0000-0000-0000000000aa.jpg', 0);

-- (a) La transición desde 'activa' sigue funcionando. El `using` se evalúa
-- contra la fila VIEJA, que todavía es 'activa', así que pasa.
select pg_temp.as_user(:J::uuid,
  format('insert into public.listing_sales (listing_id, comprador_id)
          values (%s, %L)', (select vendida_a from t_term), :K::uuid));
select pg_temp.as_user(:J::uuid,
  format('update public.listings set estado = ''vendida'' where id = %s',
         (select vendida_a from t_term)));

select pg_temp.assert(
  (select estado from public.listings where id = (select vendida_a from t_term)) = 'vendida',
  'J pudo marcar como vendida una publicación activa');

-- (b) Y desde 'pausada', que es la otra mitad de RF-08. Va sin comprador, o sea
-- por el camino de "No fue a través de Relevo".
select pg_temp.as_user(:J::uuid,
  format('update public.listings set estado = ''vendida'' where id = %s',
         (select vendida_p from t_term)));

select pg_temp.assert(
  (select estado from public.listings where id = (select vendida_p from t_term)) = 'vendida',
  'J pudo marcar como vendida una publicación pausada');

-- (c1)(c2) "Cambiar comprador" NO pasa por listings_update_own: es otra tabla con su
-- propia policy. Congelar listings no puede llevarse esto por delante, porque es
-- la única salida del vendedor que se equivocó de persona.
select pg_temp.assert(
  pg_temp.as_user_int(:J::uuid,
    format('with u as (update public.listing_sales set comprador_id = %L
                        where listing_id = %s returning 1)
            select count(*) from u', :L::uuid, (select vendida_a from t_term))) = 1,
  'sobre una publicación ya vendida, corregir el comprador sigue afectando 1 fila');

select pg_temp.assert(
  (select comprador_id from public.listing_sales
    where listing_id = (select vendida_a from t_term)) = :L::uuid,
  'y el comprador quedó reapuntado a L');

-- LOS TRES BLOQUEOS — (d), (e) y (f), una etiqueta por aserción. Ninguna usa
-- expect_error: el `using` FILTRA, así que el update no lanza nada y afecta 0
-- filas. Una aserción con expect_error aquí pasaría por la razón equivocada — o
-- no pasaría nunca.
--
-- (d) y (e) van separadas porque son las dos ramas distintas del mismo toggle de
-- "Editar publicación": reactivar y pausar. Es el bug concreto que motivó todo
-- esto, y con una sola aserción la otra rama quedaría sin red.

-- (d) Reactivar.
select pg_temp.assert(
  pg_temp.as_user_int(:J::uuid,
    format('with u as (update public.listings set estado = ''activa''
                        where id = %s returning 1)
            select count(*) from u', (select vendida_a from t_term))) = 0,
  'ni el dueño puede reactivar una publicación vendida');

-- (e) Pausar.
select pg_temp.assert(
  pg_temp.as_user_int(:J::uuid,
    format('with u as (update public.listings set estado = ''pausada''
                        where id = %s returning 1)
            select count(*) from u', (select vendida_a from t_term))) = 0,
  'ni el dueño puede pausar una publicación vendida');

-- (f) Editar contenido.
select pg_temp.assert(
  pg_temp.as_user_int(:J::uuid,
    format('with u as (update public.listings set titulo = ''RLS Terminal hackeada'',
                                                   precio = 1
                        where id = %s returning 1)
            select count(*) from u', (select vendida_a from t_term))) = 0,
  'ni el dueño puede editar el contenido de una publicación vendida');

-- (g) Y ninguno de los tres dejó rastro. Un `using` que filtra no lanza, así que
-- sin esta aserción "0 filas" y "0 filas pero algo cambió" se verían igual.
select pg_temp.assert(
  (select estado = 'vendida' and titulo = 'RLS Terminal activa' and precio = 900
     from public.listings where id = (select vendida_a from t_term)),
  'tras los tres intentos, la publicación vendida quedó intacta');

-- (h) CONTROL. El MISMO usuario, en la misma sesión, sí edita su publicación no
-- vendida. Sin esto, un grant roto o una suspensión inesperada harían pasar las
-- tres de arriba sin que el bloqueo nuevo existiera siquiera.
-- Es la ÚNICA de T20 que sobrevive a los tres controles negativos: si cayera,
-- el bloqueo no sería por estado.
select pg_temp.as_user(:J::uuid,
  format('update public.listings set titulo = ''RLS Terminal editada'' where id = %s',
         (select control from t_term)));

select pg_temp.assert(
  (select titulo from public.listings where id = (select control from t_term))
    = 'RLS Terminal editada',
  'el mismo dueño sí edita una publicación que no está vendida (el bloqueo es por estado)');

-- (i) GUARD DE REGRESIÓN DE "POLICY Y NO TRIGGER". increment_listing_view() es
-- SECURITY DEFINER, así que bypasea RLS y sigue contando vistas de una vendida
-- (su filtro es `estado <> 'pausada'`). Un trigger SÍ la alcanzaría y haría
-- reventar abrir el Detalle de cualquier publicación vendida — el fallo que
-- 20260909000447:39-44 documenta como medido. La invoca :K porque la función
-- excluye al dueño a propósito.
select pg_temp.as_user(:K::uuid,
  format('select public.increment_listing_view(%s)', (select vendida_a from t_term)));

select pg_temp.assert(
  (select vistas_count from public.listings where id = (select vendida_a from t_term)) = 1,
  'una publicación vendida sigue contando vistas (la regla vive en la policy, no en un trigger)');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T21 — no se puede reportar la publicación propia (RF-14) =='
-- Autocontenida por la moraleja de siempre (CLAUDE.md §3). En particular NO
-- reutiliza nada de T8, que es la otra sección que toca `reports`: aquella borra
-- la cuenta :C y la publicación `activa` de `t_ids` antes de terminar, justo
-- para probar que un reporte sobrevive a su objetivo.
--
--   :M — el dueño de la publicación. Es quien NO puede reportarla.
--   :N — un tercero activo. Es el control: la misma publicación, sí reportable.
--
-- LAS TRES ASERCIONES SON LAS TRES RAMAS DE LA CLÁUSULA NUEVA, y están las tres
-- aquí a propósito: esta sección tiene que sostenerse sola. La versión anterior
-- delegaba la rama de `listing_id is null` a T8 ("ya lo cubre, no se repite
-- aquí") y eso resultó ser un hueco MEDIDO, no teórico — ver (c).
\set M '''77777777-0000-0000-0000-000000000077'''
\set N '''88888888-0000-0000-0000-000000000088'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  (:M::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-m@tec.mx', '', now(), now(), now()),
  (:N::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-n@tec.mx', '', now(), now(), now());
update public.users set nombre = 'Mateo' where id = :M::uuid;
update public.users set nombre = 'Nadia' where id = :N::uuid;

insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
values (:M::uuid, 1, 1, 1, 'RLS Autorreporte', 350, 'usado', 'activa');

create temp table t_rep as
select (select id from public.listings where titulo = 'RLS Autorreporte') as propia;

-- (a) El bloqueo. A diferencia de T20, aquí SÍ va `expect_error`: un `with check`
-- de INSERT no filtra como un `using` de UPDATE — lanza.
select pg_temp.expect_error(:M::uuid,
  format('insert into public.reports (reporter_id, listing_id, motivo)
          values (%L, %s, ''spam_publicidad'')', :M::uuid, (select propia from t_rep)),
  'el dueño no puede reportar su propia publicación');

-- (b) CONTROL de (a): la MISMA publicación, en la misma sesión, reportada por
-- alguien que no es su dueño. Lo que protege es que (a) esté fallando POR LA
-- PROPIEDAD y no por cualquier otra cosa —:M suspendido, un grant roto, una
-- fixture mal sembrada—, que son todas formas de que (a) pase por la razón
-- equivocada.
--
-- Lo que NO protege, medido y no supuesto: un `not exists` demasiado ancho (sin
-- el `l.user_id = reporter_id`, o sea rechazando TODO reporte de publicación) NO
-- llega hasta aquí — muere antes en T8, que ya inserta un reporte de publicación
-- en la línea ~296. La primera versión de este comentario afirmaba lo contrario;
-- se corrigió tras correr ese control en vez de razonarlo.
select pg_temp.as_user(:N::uuid,
  format('insert into public.reports (reporter_id, listing_id, motivo, comentario)
          values (%L, %s, ''sospecha_fraude'', ''Pide depósito por adelantado'')',
         :N::uuid, (select propia from t_rep)));

select pg_temp.assert(
  exists (select 1 from public.reports
          where reporter_id = :N::uuid
            and listing_id = (select propia from t_rep)
            and listing_titulo = 'RLS Autorreporte'),
  'un tercero sí puede reportar esa publicación (el bloqueo es por ser su dueño)');

-- (c) LA TERCERA RAMA: reportar un USUARIO, o sea `listing_id` en NULL. La
-- cláusula nueva se evalúa también en este camino, y romperlo no se nota desde
-- la app —ese frame no existe todavía— pero deja la tabla a medias.
--
-- No es una aserción defensiva: la reescritura más natural de la cláusula,
--
--     and reporter_id <> (select l.user_id from public.listings l
--                         where l.id = listing_id)
--
-- (comparar contra el subselect en vez de un `not exists`) hace exactamente eso:
-- con `listing_id` null el subselect da NULL, `reporter_id <> NULL` da NULL, y el
-- with check RECHAZA. MEDIDO: contra esa variante, (a) y (b) pasan las dos y T21
-- entera daba verde — la cazaba solo T8, o sea que la protección de
-- 20260914000455 dependía de una sección que no sabe que esta existe. Con (c),
-- T21 se sostiene sola.
select pg_temp.as_user(:N::uuid,
  format('insert into public.reports (reporter_id, reported_user_id, motivo)
          values (%L, %L, ''no_es_estudiante'')', :N::uuid, :M::uuid));

select pg_temp.assert(
  exists (select 1 from public.reports
          where reporter_id = :N::uuid
            and reported_user_id = :M::uuid
            and listing_id is null),
  'reportar a un USUARIO sigue funcionando (la cláusula nueva no toca esa rama)');

-- (d) NADIE SE REPORTA A SÍ MISMO COMO USUARIO. Ojo: esto NO es una cuarta
-- variante de la tabla de arriba — las tres de (a)/(b)/(c) son ramas del `with
-- check` de 20260914000455, y esta prueba OTRO candado, el `check` de tabla de
-- 20260906000441 (`reported_user_id is null or reported_user_id <> reporter_id`).
-- Son dos mecanismos distintos porque tienen que serlo: el autorreporte de
-- usuario compara dos columnas de la MISMA fila y cabe en un `check`; el de
-- publicación necesita mirar `listings`, y un `check` con subconsulta no es
-- legal en Postgres.
--
-- Ese check existe desde la Fase 2 y hasta hoy no tenía control negativo propio:
-- ninguna pantalla podía alcanzarlo, así que (c) probaba el camino feliz de esta
-- rama y nadie probaba el de rechazo. RF-14 acaba de volverlo alcanzable desde
-- la bandera de "Perfil público", así que la aserción deja de ser teórica.
--
-- Va con `expect_error` como (a) y no con `assert`, pero por un motivo distinto:
-- (a) lanza porque un `with check` de INSERT aborta; esta lanza porque una
-- violación de `check` aborta (23514). Las dos abortan, ninguna filtra en
-- silencio como el `using` de un UPDATE.
select pg_temp.expect_error(:N::uuid,
  format('insert into public.reports (reporter_id, reported_user_id, motivo)
          values (%L, %L, ''otro'')', :N::uuid, :N::uuid),
  'nadie puede reportarse a sí mismo como usuario');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T22 — bucket público `avatars` (RLS de storage.objects, RF-03) =='
-- Autocontenida, mismo criterio que T11b, T13, T14, T15, T16, T17 y T19: siembra
-- sus propios usuarios. A esta altura del archivo :A es el único activo sin
-- publicaciones, :B lleva suspendido desde T10 y :C está borrado — reutilizar
-- cualquiera haría que una aserción pueda pasar por la razón equivocada (la
-- lección de :C en T11b).
--
--   :O — usuario ACTIVO. El camino feliz y el intruso.
--   :P — usuario SUSPENDIDO. Existe por (e), que es la razón de ser de esta
--        sección: aquí un suspendido SÍ puede escribir, al revés que en T14.
--
-- QUÉ CUBRE Y QUÉ NO: esto prueba las POLICIES. Que el bucket se sirva público,
-- que no sea enumerable por `anon` y que el DELETE funcione lo prueba
-- `scripts/probe-storage.mjs` contra el API HTTP — el DELETE no se puede probar
-- aquí por el trigger `storage.protect_delete`, mismo motivo que en T14.
\set O '''99999999-0000-0000-0000-000000000099'''
\set P '''aaaaaaaa-1111-1111-1111-0000000000a1'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  (:O::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-o@tec.mx', '', now(), now(), now()),
  (:P::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-p@tec.mx', '', now(), now(), now());
update public.users set nombre = 'Olivia'  where id = :O::uuid;
update public.users set nombre = 'Pablo', estado = 'suspendido', suspendido_at = now(), suspension_motivo = 'fixture de prueba'
 where id = :P::uuid;

-- El bucket es una fila, no esquema: ninguna migración lo crea. Mismo apaño que
-- T14, para que la suite corra en una base que venga de otro lado.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Para el control del guard `bucket_id`. T14 ya lo siembra, pero esta sección no
-- depende de que T14 haya corrido.
insert into storage.buckets (id, name, public)
values ('otro-bucket', 'otro-bucket', false)
on conflict (id) do nothing;

-- --- Escritura ---------------------------------------------------------------
-- (a) El camino feliz.
select pg_temp.as_user(:O::uuid,
  format('insert into storage.objects (bucket_id, name) values (''avatars'', ''%s/foto.jpg'')',
         :O::uuid));
select pg_temp.assert(
  (select count(*) from storage.objects
   where bucket_id = 'avatars' and name = :O || '/foto.jpg') = 1,
  'O sube su avatar a su propia carpeta');

-- (b) La carpeta ES la llave de autorización. Sin esta condición cualquiera
-- podría plantarle una foto de perfil a otra persona.
select pg_temp.expect_error(:O::uuid,
  format('insert into storage.objects (bucket_id, name) values (''avatars'', ''%s/intruso.jpg'')',
         :P::uuid),
  'O no puede subir a la carpeta de otro usuario');

-- (c) Una ruta sin carpeta de usuario. Aquí no hay cast que pueda reventar —la
-- comparación es de TEXTO contra auth.uid()::text—, así que este bucket no
-- necesita el helper `listing_id_from_object_name()` de T14: simplemente no
-- machea.
select pg_temp.expect_error(:O::uuid,
  'insert into storage.objects (bucket_id, name) values (''avatars'', ''basura.jpg'')',
  'una ruta sin carpeta de usuario es rechazada por la policy');

-- (d) Control del guard `bucket_id`: la MISMA ruta, que en `avatars` sí está
-- permitida, pero en otro bucket. Sin ese guard estas policies concederían
-- acceso a todo bucket que se agregue después.
select pg_temp.expect_error(:O::uuid,
  format('insert into storage.objects (bucket_id, name) values (''otro-bucket'', ''%s/foto.jpg'')',
         :O::uuid),
  'la misma ruta en otro bucket no queda cubierta por estas policies');

-- (e) LA ASERCIÓN QUE JUSTIFICA ESTA SECCIÓN, y la única que no tiene gemela en
-- T14 — ahí la equivalente es la CONTRARIA ("un suspendido no puede subir fotos
-- ni a su propia publicación").
--
-- Es POSITIVA a propósito: un suspendido SÍ puede editar su propio perfil,
-- incluida su foto y su teléfono (CLAUDE.md §3, tabla de decisión), y
-- `users_update_own` tampoco lleva `is_active_user()`. Copiar de T14 el
-- `is_active_user()` a las policies de `avatars` —que es exactamente lo que
-- invita a hacer la simetría entre las dos migraciones— sería una REGRESIÓN de
-- un comportamiento ya decidido, y sin esta aserción no la cazaría nada.
--
-- MEDIDO con el control negativo: agregando `is_active_user()` a la policy de
-- insert, (a) (b) (c) (d) pasan las cuatro y la suite muere AQUÍ, en ningún otro
-- lado. Ojo al leerlo: muere con el error CRUDO de Postgres («new row violates
-- row-level security policy for table "objects"»), no con el texto de la
-- aserción de abajo — el `as_user` aborta antes de llegar a ella. Es el mismo
-- patrón que T14 y no un descuido, pero conviene saberlo para no buscar el
-- mensaje bonito que no va a aparecer.
select pg_temp.as_user(:P::uuid,
  format('insert into storage.objects (bucket_id, name) values (''avatars'', ''%s/mia.jpg'')',
         :P::uuid));
select pg_temp.assert(
  (select count(*) from storage.objects
   where bucket_id = 'avatars' and name = :P || '/mia.jpg') = 1,
  'un usuario SUSPENDIDO sí puede subir su propio avatar');

-- --- Lectura -----------------------------------------------------------------
-- (f) La policy de SELECT es constante para `authenticated`, y NO es el control
-- de acceso en lectura: eso lo hace `public = true` sobre /object/public/, que
-- ni pasa por RLS. Lo que esta policy habilita es el camino del API — sin ella
-- el `remove()` del avatar anterior devuelve 200 con lista vacía y no borra
-- nada, en silencio (CLAUDE.md §9). Por eso se vigila que exista.
select pg_temp.assert(
  pg_temp.as_user_int(:P::uuid,
    format('select count(*) from storage.objects where name = ''%s/foto.jpg''',
           :O::uuid)) = 1,
  'cualquier authenticated ve el objeto por la policy de SELECT');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T23 — suspender una cuenta pausa sus publicaciones activas (RF-17) =='
-- Autocontenida, mismo criterio que T11b, T13, T14, T15, T16, T17, T19, T21 y
-- T22: siembra sus propios usuarios. A esta altura del archivo :B lleva
-- suspendido desde T10, :C está borrado por T8 y :A arrastra estado de medio
-- archivo — reutilizar cualquiera haría que una aserción pueda pasar por la
-- razón equivocada (la lección de :C en T11b).
--
--   :Q — la cuenta que se suspende. Lleva las TRES situaciones posibles a la
--        vez: una publicación `activa`, una `pausada` por su propio dueño y una
--        `vendida`. Las tres hacen falta: el update del trigger va acotado y
--        cada estado prueba una mitad distinta de ese `where`.
--   :R — otro vendedor ACTIVO con una publicación `activa`. Es el control de
--        radio: suspender a :Q no puede tocar el catálogo de nadie más.
--
-- LAS OCHO ASERCIONES TIENEN SU PROPIO CONTROL NEGATIVO, y ninguna es
-- intercambiable. MEDIDO corriendo cada variante por separado, y cada una contra
-- la suite completa Y contra esta sección aislada:
--
--   | Variante rota                                           | Cae en |
--   |--------------------------------------------------------|--------|
--   | sin trigger (el repo antes de esta tarea)               |  (a)   |
--   | `listings_select` aflojada a `using (true)`             | (a2)*  |
--   | sin el `and estado = 'activa'`                          |  (b)   |
--   | `estado <> 'pausada'` en vez de `= 'activa'`            |  (c)   |
--   | sin el `where user_id = new.id`                         |  (d)   |
--   | sin `old.estado is distinct from new.estado`            |  (e)   |
--   | sin el `when` ENTERO                                    |  (e)   |
--   | sin `new.estado = 'suspendido'`                         |  (g)   |
--   | cuerpo simétrico: despausa al reactivar                 |  (f)   |
--
-- Dos cosas de esa tabla que conviene no suponer, porque las dos contradicen lo
-- que este archivo predijo antes de medir:
--
--   · (f) NO caza "sin `new.estado = 'suspendido'`", que era la predicción
--     obvia: esa variante no despausa nada, pausa de MÁS otra fila. La suite
--     entera daba verde hasta que se agregó (g). Es la lección de :C en T11b
--     otra vez — una aserción que pasa sin probar lo que dice.
--   · el (*): esa fila es la ÚNICA donde las dos corridas difieren. Aislada la
--     caza (a2); dentro de la suite completa muere mucho antes, en T2 ("A ve
--     solo la publicación activa de B"), que es la sección dueña de
--     `listings_select`. O sea que para las siete variantes de la MIGRACIÓN T23
--     es la red completa y se sostiene sola, pero para la policy de la que
--     depende su efecto visible la red de primera línea vive en T2 — y por eso
--     (a2) igual tiene que estar aquí: sin ella, romper esa policy dejaría esta
--     sección en verde afirmando algo que dejó de ser cierto.
\set Q '''bbbbbbbb-1111-1111-1111-0000000000b1'''
\set R '''cccccccc-1111-1111-1111-0000000000c1'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  (:Q::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-q@tec.mx', '', now(), now(), now()),
  (:R::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-r@tec.mx', '', now(), now(), now());
update public.users set nombre = 'Quique' where id = :Q::uuid;
update public.users set nombre = 'Rita'   where id = :R::uuid;

-- EL `updated_at` DE LA PAUSADA SE SIEMBRA EN EL PASADO A PROPÓSITO, y no es
-- decoración: toda la suite corre dentro de UNA transacción, así que `now()` es
-- constante y `listings_set_updated_at` —que reescribe `updated_at := now()` en
-- absolutamente todo update— dejaría el mismo valor que ya tenía. Sin este
-- desfase, (b) no podría distinguir "no se tocó" de "se tocó y quedó igual".
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado, updated_at)
values
  (:Q::uuid, 1, 1, 1, 'RLS Susp activa',   100, 'nuevo', 'activa',  now()),
  (:Q::uuid, 1, 1, 1, 'RLS Susp pausada',  200, 'usado', 'pausada', now() - interval '1 day'),
  (:Q::uuid, 1, 1, 1, 'RLS Susp vendida',  300, 'nuevo', 'vendida', now()),
  (:R::uuid, 1, 1, 1, 'RLS Susp ajena',    400, 'nuevo', 'activa',  now());

create temp table t_susp as
select
  (select id from public.listings where titulo = 'RLS Susp activa')  as activa,
  (select id from public.listings where titulo = 'RLS Susp pausada') as pausada,
  (select id from public.listings where titulo = 'RLS Susp vendida') as vendida,
  (select id from public.listings where titulo = 'RLS Susp ajena')   as ajena,
  (select updated_at from public.listings where titulo = 'RLS Susp pausada') as ts_pausada;

-- ESTAS DOS FOTOS NO SON DECORADO, y es la misma lección que la foto de T20 (d),
-- reencontrada aquí midiendo: sin ellas, el control negativo de (f) —el cuerpo
-- que despausa al reactivar— muere con «Una publicación no puede activarse sin
-- fotos». O sea que quien bloquearía la reactivación sería
-- `listings_enforce_activation_has_photos` y no la ausencia de esa rama, y la
-- aserción no probaría lo que dice. Con ellas, (f) cae por su propio mensaje.
insert into public.listing_photos (listing_id, storage_path, orden)
values ((select activa  from t_susp), 'susp-activa.jpg',  0),
       ((select pausada from t_susp), 'susp-pausada.jpg', 0);

-- EL HECHO QUE DISPARA TODO. Va directo y no vía as_user porque `estado` no
-- está en el grant de update de authenticated (20260906000438:110): la única vía
-- real es service_role/Studio, y postgres es su equivalente aquí.
update public.users set estado = 'suspendido', suspendido_at = now(), suspension_motivo = 'fixture de prueba' where id = :Q::uuid;

-- (a) El camino feliz, y la razón de ser de la migración: lo que el comprador
-- veía en el feed de una cuenta que ya no puede contactar.
select pg_temp.assert(
  (select estado from public.listings where id = (select activa from t_susp)) = 'pausada',
  'la publicación activa de Q queda pausada al suspender la cuenta');

-- (a2) LA CONSECUENCIA VISIBLE, y la ÚNICA aserción de la sección que lee el
-- catálogo COMO OTRO USUARIO en vez de mirar la columna `estado` como postgres.
-- Es el motivo por el que existe la migración: el comprador deja de poder llegar
-- a una publicación que no va a poder contactar.
--
-- POR QUÉ NO ES REDUNDANTE con (a) + T2, que es lo que parece a primera vista:
-- T2 sí prueba que una `pausada` no la ve quien no es su dueño, pero sobre una
-- fila SEMBRADA así — nadie prueba la transitividad completa (dueño suspendido →
-- el trigger la pasa a `pausada` → desaparece del catálogo ajeno), que es
-- justamente la cadena que esta migración introduce. Componer dos aserciones de
-- secciones distintas para dar por probada una tercera es exactamente lo que la
-- lección de (c) en T21 desaconseja.
--
-- Va AUTOGUARDADA, con las dos mitades en la misma aserción: sin la segunda,
-- cualquier rotura que le escondiera el catálogo entero a :R —un grant, la
-- policy de select, una fixture mal sembrada— la dejaría pasar en verde por la
-- razón equivocada.
select pg_temp.assert(
  pg_temp.as_user_int(:R::uuid,
    format('select count(*) from public.listings where id = %s',
           (select activa from t_susp))) = 0
  and pg_temp.as_user_int(:R::uuid,
    format('select count(*) from public.listings where id = %s',
           (select ajena from t_susp))) = 1,
  'R deja de ver en el catálogo la publicación de la cuenta suspendida (y sigue viendo el resto)');

-- (b) LA QUE YA ESTABA PAUSADA NI SE TOCA. No es lo mismo que "quedó pausada":
-- sin el `and estado = 'activa'` del where, esta fila se reescribiría con el
-- mismo valor y se le movería el `updated_at`, o sea que el vendedor vería
-- "modificada hoy" una publicación que nadie modificó.
select pg_temp.assert(
  (select updated_at from public.listings where id = (select pausada from t_susp))
    = (select ts_pausada from t_susp),
  'la que ya estaba pausada no se toca (su updated_at no se movió)');

-- (c) `vendida` ES TERMINAL (20260913000454) y este código corre ELEVADO, así
-- que la policy que lo impide no lo frena: el único candado aquí es el `where`.
-- Sin él, suspender resucitaría una venta a `pausada` por la puerta de atrás.
select pg_temp.assert(
  (select estado from public.listings where id = (select vendida from t_susp)) = 'vendida',
  'la vendida sigue vendida: el pausado no rompe el estado terminal');

-- (d) CONTROL DE RADIO: sin el `user_id = new.id`, el update alcanzaría el
-- catálogo entero y suspender a una persona vaciaría el feed del campus.
select pg_temp.assert(
  (select estado from public.listings where id = (select ajena from t_susp)) = 'activa',
  'las publicaciones de otro usuario activo no se tocan');

-- --- Las dos mitades del `when`, que son candados distintos -------------------

-- Para que (e) sea observable hace falta que Q vuelva a tener algo `activa`
-- ESTANDO YA SUSPENDIDO. Se inserta directo: el trigger de fotos solo cubre
-- UPDATE (deuda consciente documentada en publicar-fotos.md) y la policy no
-- aplica porque esto corre como postgres, igual que el resto de las fixtures
-- posteriores a T10.
--
-- RF-17 Ola 4 (20261007000480): esa fila es EXACTAMENTE la deuda que el
-- trigger nuevo cierra, así que sin apagarlo (e) dejaría de ser observable. Se
-- apaga solo alrededor de este insert y dentro de la transacción de la suite:
-- la fila representa el estado legacy, anterior a …480.
alter table public.listings disable trigger listings_exige_dueno_activo_ins;
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
values (:Q::uuid, 1, 1, 1, 'RLS Susp posterior', 500, 'nuevo', 'activa');
alter table public.listings enable trigger listings_exige_dueno_activo_ins;

-- (e) `old.estado is distinct from new.estado`. Editar el propio perfil es de
-- las cosas que un suspendido CONSERVA (tabla de decisión de CLAUDE.md §3, y
-- T10/T22 lo prueban), así que este update no es hipotético: es lo que pasa cada
-- vez que una cuenta suspendida guarda su nombre, su teléfono o su avatar. Sin
-- esta mitad del `when`, cada uno de esos guardados volvería a pausarle todo.
update public.users set nombre = 'Quique corregido' where id = :Q::uuid;

select pg_temp.assert(
  (select estado from public.listings
    where titulo = 'RLS Susp posterior') = 'activa',
  'un update ordinario sobre una cuenta ya suspendida no vuelve a pausar');

-- Reactivar la cuenta. Las DOS aserciones que siguen miran filas distintas a
-- propósito, y hasta medirlo eran una sola que pasaba por la razón equivocada.
update public.users set estado = 'activo', suspendido_at = null, suspension_motivo = null
 where id = :Q::uuid;

-- (f) LA DECISIÓN DE PRODUCTO, escrita como aserción: reactivar NO despausa
-- nada. El vendedor las reactiva a mano desde "Mis publicaciones", que ya exige
-- al menos una foto (`listings_enforce_activation_has_photos`) — despausarlas
-- solas saltaría esa validación justo en las publicaciones viejas que no tienen
-- ninguna.
--
-- QUÉ VIGILA, con precisión: ninguna variante rota del `when` ni del `where` la
-- caza, y no es un descuido — ningún camino de esta función escribe `'activa'`,
-- así que la propiedad es cierta por construcción. Su control negativo es un
-- CUERPO futuro con la rama simétrica ("al reactivar, despausar"), que es la
-- regresión realista, y MEDIDO contra esa variante cae aquí y solo aquí. Pero
-- solo gracias a las fotos sembradas arriba: sin ellas esa variante ni siquiera
-- llega, la mata antes el trigger de fotos.
select pg_temp.assert(
  (select estado from public.listings where id = (select activa from t_susp)) = 'pausada',
  'reactivar la cuenta NO despausa: el vendedor las reactiva a mano');

-- (g) `new.estado = 'suspendido'`, LA OTRA MITAD DEL `when` — y la aserción que
-- de verdad la vigila. Sin esa condición el trigger se dispara en TODA
-- transición de estado, reactivación incluida, y entonces levantar la suspensión
-- pausa lo que el vendedor tuviera activo en ese momento: el castigo sobrevive
-- al castigo.
--
-- Esta aserción existe porque el plan predijo que (f) cazaría esa variante y la
-- MEDICIÓN dijo que no: (f) mira la fila que ya estaba pausada, que esa variante
-- no despausa. La suite entera daba verde. Es la lección de :C en T11b otra vez,
-- encontrada esta vez por correr el control en vez de razonarlo.
select pg_temp.assert(
  (select estado from public.listings where titulo = 'RLS Susp posterior') = 'activa',
  'reactivar la cuenta tampoco pausa de más lo que el vendedor tenga activo');
-- ---------------------------------------------------------------------------
\echo ''
\echo '== T24 — pendiente/bloqueada no son públicos ni los levanta su dueño (moderación) =='
-- Autocontenida, mismo criterio que T11b, T13, T14, T15, T16, T17, T19, T21, T22
-- y T23: siembra sus propios usuarios y no reutiliza fixtures de secciones
-- anteriores.
--
--   :S — el dueño, activo. Publica una vez en CADA uno de los 5 valores del
--        enum. Es la única forma de que "escritura" y "lectura" compartan
--        exactamente el mismo universo de filas.
--   :U — un ajeno cualquiera, autenticado y activo. Es quien lee (1) y quien
--        invoca la RPC de vistas en (3) — igual que en T5 y T20(i), la función
--        excluye al dueño por diseño y hay que llamarla desde otra cuenta.
--
-- CUATRO de las cinco llevan foto sembrada, y NO es decorado: es la misma
-- lección de T20(d) y T23(f), medida otra vez aquí. `pausada`, `vendida`,
-- `pendiente` y `bloqueada` intentan una transición HACIA 'activa' en (2), y sin
-- foto esa transición muere con «Una publicación no puede activarse sin fotos»
-- —el trigger de 20260909000447— en vez de con el mensaje de esta sección. Solo
-- `activa` se queda sin foto: nunca intenta volverse `activa`, ya lo es.
--
-- T_MOD ES DE SOLO LECTURA DE AQUÍ EN ADELANTE, y no por prolijidad: (1) y (3)
-- asumen que cada fila SIGUE en el estado con que nació. La primera versión de
-- esta sección reutilizaba `t_mod.activa`/`t_mod.pausada` para los controles
-- de pausar/reactivar de (2) — que SÍ escriben `estado` — y (3) leía esas MISMAS
-- filas después esperando que siguieran 'activa'/'pausada'. Medido: (3) fallaba
-- ("activa y vendida siguen contando vistas... " en 0) porque la fila que (1)
-- y (3) llaman "activa" ya era 'pausada' para cuando (3) corría. Es la misma
-- familia de error que la reordenada de T19 (l2): una sección con estado que
-- avanza necesita fijarse en CUÁNDO corre cada aserción, no solo contra quién.
-- La salida es la misma que ahí: filas dedicadas para lo que muta, y las de
-- lectura/vistas jamás se tocan.
\set S '''24242424-0000-0000-0000-000000002424'''
\set U '''42424242-0000-0000-0000-000000004242'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  (:S::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-s@tec.mx', '', now(), now(), now()),
  (:U::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-u@tec.mx', '', now(), now(), now());
update public.users set nombre = 'Selena' where id = :S::uuid;
update public.users set nombre = 'Ulises' where id = :U::uuid;

insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
values
  (:S::uuid, 1, 1, 1, 'RLS Mod activa',    100, 'nuevo', 'activa'),
  (:S::uuid, 1, 1, 1, 'RLS Mod pausada',   100, 'nuevo', 'pausada'),
  (:S::uuid, 1, 1, 1, 'RLS Mod vendida',   100, 'nuevo', 'vendida'),
  (:S::uuid, 1, 1, 1, 'RLS Mod pendiente', 100, 'nuevo', 'pendiente'),
  (:S::uuid, 1, 1, 1, 'RLS Mod bloqueada', 100, 'nuevo', 'bloqueada');

create temp table t_mod as
select
  (select id from public.listings where titulo = 'RLS Mod activa')    as activa,
  (select id from public.listings where titulo = 'RLS Mod pausada')   as pausada,
  (select id from public.listings where titulo = 'RLS Mod vendida')   as vendida,
  (select id from public.listings where titulo = 'RLS Mod pendiente') as pendiente,
  (select id from public.listings where titulo = 'RLS Mod bloqueada') as bloqueada;

insert into public.listing_photos (listing_id, storage_path, orden)
values
  ((select pausada   from t_mod), 'rls-mod/pausada.jpg',   0),
  ((select vendida   from t_mod), 'rls-mod/vendida.jpg',   0),
  ((select pendiente from t_mod), 'rls-mod/pendiente.jpg', 0),
  ((select bloqueada from t_mod), 'rls-mod/bloqueada.jpg', 0);

-- Par DEDICADO para (2)(d)/(2)(e): las dos únicas transiciones de esta sección
-- que SÍ escriben `estado`. Separado de t_mod a propósito, por la razón de
-- arriba.
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
values
  (:S::uuid, 1, 1, 1, 'RLS Mod ctrl-pausa',    100, 'nuevo', 'activa'),
  (:S::uuid, 1, 1, 1, 'RLS Mod ctrl-reactiva', 100, 'nuevo', 'pausada');

create temp table t_mod_ctrl as
select
  (select id from public.listings where titulo = 'RLS Mod ctrl-pausa')    as ctrl_pausa,
  (select id from public.listings where titulo = 'RLS Mod ctrl-reactiva') as ctrl_reactiva;

insert into public.listing_photos (listing_id, storage_path, orden)
values ((select ctrl_reactiva from t_mod_ctrl), 'rls-mod/ctrl-reactiva.jpg', 0);

-- ---------------------------------------------------------------------------
-- (1) LECTURA — listings_select. No la pidió la matriz original (esa cubría
-- solo escritura y vistas), pero SIN esto el control negativo de esta guardia
-- —pedido explícitamente— no tendría dónde fallar: quitar la condición nueva
-- no rompe ninguna aserción de escritura ni de vistas, y T2 (la dueña de
-- listings_select) solo conoce 'pausada', no 'pendiente'/'bloqueada'. Es
-- exactamente el caso de T23 (a2): la sección que introduce el efecto es la
-- que tiene que vigilarlo, aunque el mecanismo (una policy, no un trigger)
-- viva en otra migración.

-- (a) CONTROL: activa y vendida se siguen viendo. Sin este control, (b) podría
-- pasar por una razón equivocada — por ejemplo si is_active_user() o la
-- suspensión de S rompieran la visibilidad entera en vez de solo estos dos
-- valores.
select pg_temp.assert(
  pg_temp.as_user_int(:U::uuid,
    format('select count(*) from public.listings where id = %s',
           (select activa from t_mod))) = 1
  and pg_temp.as_user_int(:U::uuid,
    format('select count(*) from public.listings where id = %s',
           (select vendida from t_mod))) = 1,
  'un ajeno sigue viendo activa y vendida (control)');

-- (b) LO NUEVO: pendiente y bloqueada quedan tan ocultas para un ajeno como
-- pausada.
select pg_temp.assert(
  pg_temp.as_user_int(:U::uuid,
    format('select count(*) from public.listings where id = %s',
           (select pausada from t_mod))) = 0
  and pg_temp.as_user_int(:U::uuid,
    format('select count(*) from public.listings where id = %s',
           (select pendiente from t_mod))) = 0
  and pg_temp.as_user_int(:U::uuid,
    format('select count(*) from public.listings where id = %s',
           (select bloqueada from t_mod))) = 0,
  'un ajeno no ve pausada, pendiente ni bloqueada');

-- (c) El dueño ve las 5, sin importar el estado — igual que con `pausada`
-- desde siempre: "Mis publicaciones" no puede mentirle sobre su propio
-- catálogo.
-- id IN (…) contra t_mod y NO `titulo like 'RLS Mod %'`: ese patrón también
-- machea a t_mod_ctrl (dos filas más), que no son parte de este universo de 5.
select pg_temp.assert(
  pg_temp.as_user_int(:S::uuid,
    format('select count(*) from public.listings where id in (%s,%s,%s,%s,%s)',
           (select activa from t_mod), (select pausada from t_mod),
           (select vendida from t_mod), (select pendiente from t_mod),
           (select bloqueada from t_mod))) = 5,
  'el dueño ve sus 5 publicaciones sin importar el estado');

-- ---------------------------------------------------------------------------
-- (2) ESCRITURA — listings_update_own. Matriz medida antes de escribir esta
-- migración: con la policy vieja, pendiente->activa y bloqueada->activa
-- afectaban 1 fila (el dueño se auto-aprobaba). Con la lista nueva, 0.

-- (d) CONTROL: pausar y reactivar siguen siendo el flujo normal. Van sobre
-- t_mod_ctrl, NO sobre t_mod: (3) todavía necesita leer t_mod.activa/pausada
-- en su estado ORIGINAL, y estas dos SÍ escriben `estado`.
select pg_temp.assert(
  pg_temp.as_user_int(:S::uuid,
    format('with u as (update public.listings set estado = ''pausada''
                        where id = %s returning 1)
            select count(*) from u', (select ctrl_pausa from t_mod_ctrl))) = 1,
  'el dueño sigue pudiendo pausar una publicación activa (control)');

select pg_temp.assert(
  pg_temp.as_user_int(:S::uuid,
    format('with u as (update public.listings set estado = ''activa''
                        where id = %s returning 1)
            select count(*) from u', (select ctrl_reactiva from t_mod_ctrl))) = 1,
  'el dueño sigue pudiendo reactivar una publicación pausada (control)');

-- (e) CONTROL: `vendida` sigue terminal — esto ya lo prueba T20, y se repite
-- aquí en el mismo universo de filas que (f) y (g) para que las tres midan
-- exactamente la misma cosa con la misma vara.
select pg_temp.assert(
  pg_temp.as_user_int(:S::uuid,
    format('with u as (update public.listings set estado = ''activa''
                        where id = %s returning 1)
            select count(*) from u', (select vendida from t_mod))) = 0,
  'ni el dueño puede reactivar una publicación vendida (control)');

-- (f) LO NUEVO: pendiente->activa. Sin la guardia nueva, esto era el hueco —
-- el dueño se auto-aprobaba y se saltaba la revisión entera.
select pg_temp.assert(
  pg_temp.as_user_int(:S::uuid,
    format('with u as (update public.listings set estado = ''activa''
                        where id = %s returning 1)
            select count(*) from u', (select pendiente from t_mod))) = 0,
  'el dueño no puede saltarse la revisión: pendiente->activa queda bloqueado');

-- (g) LO NUEVO: bloqueada->activa. Sin la guardia nueva, el dueño deshacía la
-- moderación por su cuenta.
select pg_temp.assert(
  pg_temp.as_user_int(:S::uuid,
    format('with u as (update public.listings set estado = ''activa''
                        where id = %s returning 1)
            select count(*) from u', (select bloqueada from t_mod))) = 0,
  'el dueño no puede deshacer una moderación: bloqueada->activa queda bloqueado');

-- (h) Y ninguno de los tres intentos bloqueados dejó rastro — el mismo
-- candado que T20(g): un `using` que filtra no lanza, así que "0 filas" y "0
-- filas pero algo cambió" se verían igual sin esta aserción.
select pg_temp.assert(
  (select estado = 'vendida'   and titulo = 'RLS Mod vendida'   from public.listings
    where id = (select vendida   from t_mod))
  and (select estado = 'pendiente' and titulo = 'RLS Mod pendiente' from public.listings
    where id = (select pendiente from t_mod))
  and (select estado = 'bloqueada' and titulo = 'RLS Mod bloqueada' from public.listings
    where id = (select bloqueada from t_mod)),
  'los tres intentos bloqueados no dejaron rastro en las filas');

-- ---------------------------------------------------------------------------
-- (3) VISTAS — public.increment_listing_view. Es la ÚNICA de las tres guardias
-- que NO se arregla sola con (1): es SECURITY DEFINER sobre una tabla sin
-- `force row level security`, así que bypasea RLS. Medido antes del fix: con
-- listings_select YA corregida, un ajeno igual subía vistas_count de una
-- bloqueada.

select pg_temp.as_user(:U::uuid,
  format('select public.increment_listing_view(%s)', (select activa from t_mod)));
select pg_temp.as_user(:U::uuid,
  format('select public.increment_listing_view(%s)', (select vendida from t_mod)));
select pg_temp.as_user(:U::uuid,
  format('select public.increment_listing_view(%s)', (select pausada from t_mod)));
select pg_temp.as_user(:U::uuid,
  format('select public.increment_listing_view(%s)', (select pendiente from t_mod)));
select pg_temp.as_user(:U::uuid,
  format('select public.increment_listing_view(%s)', (select bloqueada from t_mod)));

-- (i) CONTROL: activa y vendida siguen contando vistas de un ajeno — vendida ya
-- lo prueba T20(i), y se repite aquí por la misma razón que (e): que las tres
-- midan sobre el mismo universo de filas.
select pg_temp.assert(
  (select vistas_count from public.listings where id = (select activa from t_mod)) = 1
  and (select vistas_count from public.listings where id = (select vendida from t_mod)) = 1,
  'activa y vendida siguen contando vistas de un ajeno (control)');

-- (j) LO YA CONOCIDO + LO NUEVO en una sola aserción: pausada seguía sin
-- contar desde siempre; pendiente y bloqueada son el cambio de esta
-- migración.
select pg_temp.assert(
  (select vistas_count from public.listings where id = (select pausada from t_mod)) = 0
  and (select vistas_count from public.listings where id = (select pendiente from t_mod)) = 0
  and (select vistas_count from public.listings where id = (select bloqueada from t_mod)) = 0,
  'pausada, pendiente y bloqueada no cuentan vistas de un ajeno');

-- ---------------------------------------------------------------------------
-- LO QUE T24 NO CUBRE, a propósito: que un cliente pueda INSERTAR directo en
-- 'activa'/'vendida'/'bloqueada' (listings_insert_own no restringe `estado`).
-- Es real y está medido, pero no es un candado que esta migración rompa o
-- arregle — no hay guardia nueva que probar. Queda en el índice de deuda
-- consciente de CLAUDE.md §8, con su propio disparador de revisión.
-- ---------------------------------------------------------------------------
\echo ''
\echo '== T25 — toda publicación de cliente nace `pendiente` (moderación) =='
-- Autocontenida, mismo criterio que T11b, T13, T14, T15, T16, T17, T19, T21,
-- T22, T23 y T24: siembra sus propios usuarios y no reutiliza fixtures de
-- secciones anteriores.
--
--   :V — un usuario activo. Es quien inserta en todas las aserciones.
--   :W — otro usuario activo, y su ÚNICO trabajo es ser el `user_id` ajeno de
--        (e). No se suspende ni se le toca nada más.
--
-- Prueba el `with_check` de `listings_insert_own` (20260919000463), que es la
-- otra mitad de 20260917000459: aquella cerró el UPDATE (`pendiente`/`bloqueada`
-- no los levanta su dueño) y dejó el INSERT abierto a propósito, con su propio
-- bloque "LO QUE ESTA MIGRACIÓN NO CIERRA". Esto lo cierra.

\set V '''25252525-0000-0000-0000-000000002525'''
\set W '''52525252-0000-0000-0000-000000005252'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  (:V::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-v@tec.mx', '', now(), now(), now()),
  (:W::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-w@tec.mx', '', now(), now(), now());
update public.users set nombre = 'Valeria' where id = :V::uuid;
update public.users set nombre = 'Wendy'   where id = :W::uuid;

-- (a) CONTROL, y va primero a propósito: sin él, (b)-(d) pasarían en verde
-- aunque el INSERT estuviera roto del todo (un `with check (false)`, un grant
-- revocado de más). Verifica las DOS cosas: que el insert ocurre Y que la fila
-- queda en `pendiente` — el `returning` sale del mismo statement, así que no
-- puede estar mirando otra fila.
select pg_temp.assert(
  pg_temp.as_user_text(:V::uuid,
    format('with i as (insert into public.listings (user_id, categoria_id,
                          universidad_id, campus_id, titulo, precio, condicion, estado)
                        values (%L, 1, 1, 1, ''RLS T25 ok'', 100, ''nuevo'', ''pendiente'')
                        returning estado)
            select estado::text from i', :V::uuid)) = 'pendiente',
  'un cliente activo SÍ crea su publicación en pendiente (control)');

-- (b) El caso obvio: el estado con el que `publicar.ts` creaba hasta RF-18 era
-- 'pausada', y el que la app terminaba poniendo era 'activa'. Los dos quedan
-- fuera; este prueba el segundo, que es el que se saltaba la revisión entera.
select pg_temp.expect_error(:V::uuid,
  format('insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                                       titulo, precio, condicion, estado)
          values (%L, 1, 1, 1, ''RLS T25 activa'', 100, ''nuevo'', ''activa'')', :V::uuid),
  'un cliente no puede crear su publicación directo en activa');

-- (c) EL SIGILOSO, y por eso va aparte de (b): omitir la columna NO es lo mismo
-- que no mandarla. El default de `listings.estado` sigue siendo 'activa' a
-- propósito (20260919000463 explica por qué no se voltea: las fixtures de esta
-- suite y de los cuatro probes siembran estados arbitrarios por fuera de RLS),
-- así que un insert sin `estado` cae ahí y tiene que ser rechazado igual.
select pg_temp.expect_error(:V::uuid,
  format('insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                                       titulo, precio, condicion)
          values (%L, 1, 1, 1, ''RLS T25 default'', 100, ''nuevo'')', :V::uuid),
  'omitir estado cae en el default activa y también se rechaza');

-- (d) Los otros tres valores del enum, para que la lista quede cerrada y no
-- solo "no activa". `bloqueada` es el que más importa: crearse una bloqueada a
-- uno mismo no tiene sentido, pero el hueco medido en 20260917000459 permitía
-- los CINCO, y una lista a medias se ve igual de bien que una completa.
select pg_temp.expect_error(:V::uuid,
  format('insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                                       titulo, precio, condicion, estado)
          values (%L, 1, 1, 1, ''RLS T25 pausada'', 100, ''nuevo'', ''pausada'')', :V::uuid),
  'tampoco pausada');

select pg_temp.expect_error(:V::uuid,
  format('insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                                       titulo, precio, condicion, estado)
          values (%L, 1, 1, 1, ''RLS T25 vendida'', 100, ''nuevo'', ''vendida'')', :V::uuid),
  'tampoco vendida');

select pg_temp.expect_error(:V::uuid,
  format('insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                                       titulo, precio, condicion, estado)
          values (%L, 1, 1, 1, ''RLS T25 bloqueada'', 100, ''nuevo'', ''bloqueada'')', :V::uuid),
  'tampoco bloqueada');

-- (e) La cláusula se SUMÓ, no reemplazó al resto del with_check. Es el control
-- del "drop + create mal hecho": alguien que reescriba la policy dejando solo
-- `estado = 'pendiente'` pasa (a)-(d) sin despeinarse y abre la suplantación.
-- T3 ya prueba esto, pero con un `estado` que hoy también sería rechazado por
-- la cláusula nueva; aquí el estado es el BUENO, así que el único motivo
-- posible de rechazo es el `user_id`.
select pg_temp.expect_error(:V::uuid,
  format('insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                                       titulo, precio, condicion, estado)
          values (%L, 1, 1, 1, ''RLS T25 ajena'', 100, ''nuevo'', ''pendiente'')', :W::uuid),
  'con el estado correcto, sigue sin poder insertar en nombre de otro');

-- (f) `postgres` sigue sembrando cualquier estado, y NO es una aserción de
-- adorno: es la premisa de la que dependen los 4 bloques de fixtures de esta
-- suite y los cuatro `scripts/probe-*.mjs` (que insertan con la secret key).
-- Si alguien "endureciera" esto con un trigger o un check de tabla —que sí
-- alcanzarían a service_role, a diferencia de una policy— la suite entera se
-- caería en cascada y nadie sabría por qué. Aquí cae una sola aserción y lo
-- dice con todas sus letras.
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
values (:V::uuid, 1, 1, 1, 'RLS T25 sembrada', 100, 'nuevo', 'activa');
select pg_temp.assert(
  (select estado = 'activa' from public.listings where titulo = 'RLS T25 sembrada'),
  'postgres/service_role siguen sembrando cualquier estado (premisa de las fixtures)');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T12 — invariantes de grants =='
select pg_temp.assert(
  not exists (select 1 from information_schema.table_privileges
              where grantee = 'anon' and table_schema = 'public'),
  'anon no tiene ni un privilegio en public');

-- Estas dos invariantes NO son de seguridad: son un candado sobre el workaround
-- del SIGSEGV de PostgreSQL 17.6 (supabase/KNOWN_ISSUES.md). Si alguien "endurece"
-- esto revocando el acceso, la base vuelve a caerse al capturar en plpgsql el
-- rechazo de una escritura. Que fallen aquí es mucho mejor que un backend muerto.
select pg_temp.assert(
  has_schema_privilege('authenticated', 'private', 'usage'),
  'authenticated conserva USAGE sobre private (workaround del SIGSEGV)');

select pg_temp.assert(
  has_function_privilege('authenticated', 'private.is_active_user()', 'execute')
  and has_function_privilege('authenticated', 'private.can_rate(uuid,bigint)', 'execute')
  and has_function_privilege('authenticated',
        'private.listing_id_from_object_name(text)', 'execute')
  -- RF-17 (20260930000477): la invocará la policy de Storage del admin en la
  -- Ola 2, así que lleva el mismo workaround desde que existe.
  and has_function_privilege('authenticated', 'private.is_admin()', 'execute'),
  'authenticated puede ejecutar las 4 funciones invocadas desde policies');

-- RF-17, Ola 2 (D-B3): la MISMA invariante, pero genérica. La lista de arriba
-- es fija; una policy nueva que llame a otra función de `private` sin EXECUTE
-- para authenticated no la tocaría y reabriría el SIGSEGV. `pg_depend` registra
-- cada función que una policy referencia (classid pg_policy → pg_proc), así
-- que esto cubre las policies de `public` y de `storage.objects` sin listarlas.
-- ALCANCE: solo dependencias DIRECTAS. Lo que una función llama por dentro
-- (`is_admin()` → `totp_timestamp()`, revocada) no aparece, y no hace falta:
-- corre como el dueño de la definer.
select pg_temp.assert(
  not exists (
    select 1
      from pg_depend d
      join pg_policy pol on pol.oid = d.objid
      join pg_proc p on p.oid = d.refobjid
      join pg_namespace n on n.oid = p.pronamespace
     where d.classid = 'pg_policy'::regclass and d.refclassid = 'pg_proc'::regclass
       and n.nspname = 'private'
       and not has_function_privilege('authenticated', p.oid, 'execute')),
  'toda función de private que invoca una policy es ejecutable por authenticated (pg_depend)');

-- Y la invariante de arriba no puede pasar VACÍA: tiene que ver al menos las 4
-- funciones de la lista fija, incluida `is_admin()` ligada a la policy de
-- Storage del admin (20260930000479). Si esa policy se borra o deja de llamar
-- a `is_admin()`, cae aquí.
select pg_temp.assert(
  exists (select 1
            from pg_depend d join pg_policy pol on pol.oid = d.objid
           where d.classid = 'pg_policy'::regclass and d.refclassid = 'pg_proc'::regclass
             and pol.polrelid = 'storage.objects'::regclass
             and pol.polname = 'listing_photos_objects_select_admin'
             and d.refobjid = 'private.is_admin()'::regprocedure)
  and (select count(distinct d.refobjid)
         from pg_depend d
         join pg_proc p on p.oid = d.refobjid
         join pg_namespace n on n.oid = p.pronamespace
        where d.classid = 'pg_policy'::regclass and d.refclassid = 'pg_proc'::regclass
          and n.nspname = 'private') >= 4,
  'listing_photos_objects_select_admin depende de private.is_admin() y la invariante pg_depend no está vacía');

-- Estas sí son de seguridad: solo disparan por trigger y nadie debe poder
-- invocarlas. Postgres verifica EXECUTE al crear el trigger, no al dispararlo.
-- Cuatro importan más que el resto: `claim_push_token`, que invocable a mano
-- sería un borrado arbitrario de la fila de cualquiera cuyo token se conozca;
-- `notify_push` y `notify_moderacion`, que leen la secret key de Vault; y
-- `pause_listings_on_suspend`, que invocable a mano pausaría el catálogo de
-- cualquier vendedor con solo pasarle su id —es SECURITY DEFINER y no mira
-- quién llama, porque su `when` ya decidió eso por ella.
select pg_temp.assert(
  not has_function_privilege('authenticated', 'private.handle_new_user()', 'execute')
  and not has_function_privilege('authenticated', 'private.enforce_photo_limit()', 'execute')
  and not has_function_privilege('authenticated', 'private.recalc_rating_promedio()', 'execute')
  and not has_function_privilege('authenticated', 'private.capture_report_snapshot()', 'execute')
  and not has_function_privilege('authenticated',
        'private.enforce_activation_has_photos()', 'execute')
  and not has_function_privilege('authenticated', 'private.claim_push_token()', 'execute')
  and not has_function_privilege('authenticated', 'private.notify_price_drop()', 'execute')
  and not has_function_privilege('authenticated', 'private.notify_report_resolved()', 'execute')
  and not has_function_privilege('authenticated', 'private.notify_push()', 'execute')
  and not has_function_privilege('authenticated',
        'private.notify_compra_calificable()', 'execute')
  and not has_function_privilege('authenticated',
        'private.pause_listings_on_suspend()', 'execute')
  and not has_function_privilege('authenticated',
        'private.notify_moderacion()', 'execute')
  -- RF-16, tanda 2 (20260928000473).
  and not has_function_privilege('authenticated',
        'private.notify_moderacion_listing()', 'execute')
  and not has_function_privilege('authenticated', 'private.notify_calificacion()', 'execute')
  and not has_function_privilege('authenticated',
        'private.notify_favorito_vendido()', 'execute')
  and not has_function_privilege('authenticated',
        'private.notify_avatar_eliminado()', 'execute')
  -- Eliminar cuenta (20260929000474): las dos borran/escriben filas ajenas.
  and not has_function_privilege('authenticated',
        'private.borra_avisos_de_cuenta()', 'execute')
  and not has_function_privilege('authenticated',
        'private.bloquea_correo_suspendido()', 'execute')
  -- RF-17 (20260930000477): el append-only de la auditoría del panel.
  and not has_function_privilege('authenticated',
        'private.admin_acciones_inmutable()', 'execute')
  -- RF-17, Ola 2 (20260930000479): sella `reports.resolved_at`. Es la primera
  -- INVOKER de esta lista: solo reescribe NEW (como las 4 de la aserción
  -- siguiente), pero se revoca igual por decisión del usuario, porque no hay
  -- motivo para que nadie la invoque.
  and not has_function_privilege('authenticated', 'private.sella_resolved_at()', 'execute')
  and not (select prosecdef from pg_proc where oid = 'private.sella_resolved_at()'::regprocedure)
  -- RF-17, Ola 4 (20261007000480): definer que lee el estado de OTRO usuario.
  and not has_function_privilege('authenticated', 'private.exige_dueno_activo()', 'execute')
  -- RF-17, Ola 4 (20261007000482): definer que escribe el registro retenido.
  and not has_function_privilege('authenticated', 'private.retiene_moderacion()', 'execute'),
  'las 22 funciones que solo disparan por trigger siguen revocadas');

-- Las DOS funciones de trigger que NO están en la lista de arriba, a
-- propósito: `set_updated_at()` y `limpia_veredicto_en_pantalla()` son
-- INVOKER, solo reescriben NEW y no leen ni escriben otras filas, así que no
-- hay nada que revocar (el criterio de 20260906000439:31). Lo que importa es
-- que SIGAN siendo invoker: volver definer a una función que corre en cada
-- update de `listings` sería elevar sin motivo. El EXECUTE abierto es por
-- consistencia entre las dos, no por necesidad — Postgres lo verifica al crear
-- el trigger, no al dispararlo. No había ninguna aserción sobre
-- `set_updated_at()` antes de esta: la cubre por primera vez.
select pg_temp.assert(
  not (select prosecdef from pg_proc where oid = 'private.set_updated_at()'::regprocedure)
  and not (select prosecdef from pg_proc
            where oid = 'private.limpia_veredicto_en_pantalla()'::regprocedure)
  and has_function_privilege('authenticated', 'private.set_updated_at()', 'execute')
  and has_function_privilege('authenticated',
        'private.limpia_veredicto_en_pantalla()', 'execute')
  -- Eliminar cuenta (20260929000474): mismo caso, solo reescriben NEW.
  and not (select prosecdef from pg_proc where oid = 'private.anonimiza_rating()'::regprocedure)
  and not (select prosecdef from pg_proc where oid = 'private.anonimiza_report()'::regprocedure)
  and has_function_privilege('authenticated', 'private.anonimiza_rating()', 'execute')
  and has_function_privilege('authenticated', 'private.anonimiza_report()', 'execute'),
  'las 4 funciones de trigger que solo reescriben NEW son INVOKER y no están revocadas');

-- El webhook no puede quedar como un grant abierto sobre Vault: si
-- `authenticated` pudiera leer `vault.decrypted_secrets`, la secret key del
-- proyecto sería legible por cualquier usuario de la app.
select pg_temp.assert(
  not has_schema_privilege('authenticated', 'vault', 'usage')
  and not has_schema_privilege('anon', 'vault', 'usage'),
  'ni authenticated ni anon tienen acceso al esquema vault');

select pg_temp.assert(
  not has_schema_privilege('anon', 'private', 'usage'),
  'anon no tiene acceso a private');

select pg_temp.assert(
  has_function_privilege('authenticated', 'public.increment_listing_view(bigint)', 'execute')
  and not has_function_privilege('anon', 'public.increment_listing_view(bigint)', 'execute'),
  'la RPC de vistas es ejecutable por authenticated y no por anon');

select pg_temp.assert(
  has_function_privilege('authenticated', 'public.listing_favorites_count(bigint)', 'execute')
  and not has_function_privilege('anon', 'public.listing_favorites_count(bigint)', 'execute'),
  'la RPC de conteo de favoritos es ejecutable por authenticated y no por anon');

select pg_temp.assert(
  has_function_privilege('authenticated', 'public.seller_whatsapp(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.seller_whatsapp(uuid)', 'execute'),
  'la RPC del teléfono es ejecutable por authenticated y no por anon');

select pg_temp.assert(
  not exists (select 1 from information_schema.column_privileges
              where grantee = 'authenticated' and table_schema = 'public'
                and table_name = 'users' and column_name = 'correo'),
  'authenticated no tiene ningún privilegio sobre users.correo');

-- Hermana de la de `correo`, con una diferencia que importa: `telefono` SÍ
-- tiene grant de UPDATE (su dueño lo escribe). Lo que no puede tener nunca es
-- SELECT — ahí es donde se rompería RNF-05 y el número se volvería enumerable
-- en bloque para cualquier autenticado.
select pg_temp.assert(
  not exists (select 1 from information_schema.column_privileges
              where grantee = 'authenticated' and table_schema = 'public'
                and table_name = 'users' and column_name = 'telefono'
                and privilege_type = 'SELECT'),
  'authenticated no puede leer users.telefono (solo escribir el propio)');

select pg_temp.assert(
  not exists (select 1 from information_schema.column_privileges
              where grantee = 'authenticated' and table_schema = 'public'
                and table_name = 'listings' and column_name = 'vistas_count'
                and privilege_type = 'UPDATE'),
  'authenticated no puede escribir listings.vistas_count');

-- `veredicto_en_pantalla` (20260928000473) decide si el veredicto de
-- moderación se avisa. Si el dueño pudiera escribirla, apagaría a mano el
-- aviso de su propia publicación. El grant de UPDATE de `listings` es por lista
-- de columnas, y esta no entra.
select pg_temp.assert(
  not exists (select 1 from information_schema.column_privileges
              where grantee = 'authenticated' and table_schema = 'public'
                and table_name = 'listings' and column_name = 'veredicto_en_pantalla'
                and privilege_type = 'UPDATE'),
  'authenticated no puede escribir listings.veredicto_en_pantalla');

-- Fase 2A (20260924000466): la universidad de un usuario la asigna el trigger
-- de alta, y una publicación conserva la universidad y el campus con los que
-- nació. Ninguna de las tres columnas se escribe desde el cliente después.
-- (`users.campus_id` SÍ: el usuario cambia de campus dentro de su universidad.)
select pg_temp.assert(
  not exists (select 1 from information_schema.column_privileges
              where grantee in ('authenticated', 'anon') and table_schema = 'public'
                and privilege_type = 'UPDATE'
                and ((table_name = 'users' and column_name = 'universidad_id')
                  or (table_name = 'listings' and column_name in ('universidad_id', 'campus_id')))),
  'authenticated no puede escribir users.universidad_id ni la universidad/campus de una publicación');

select pg_temp.assert(
  not exists (select 1 from information_schema.column_privileges
              where grantee = 'authenticated' and table_schema = 'public'
                and table_name = 'ratings' and column_name in ('to_user_id','listing_id')
                and privilege_type = 'UPDATE'),
  'authenticated no puede reapuntar una calificación');

select pg_temp.assert(
  not exists (select 1 from information_schema.table_privileges
              where grantee = 'authenticated' and table_schema = 'public'
                and table_name = 'ratings' and privilege_type = 'DELETE'),
  'ratings no tiene grant de DELETE (no sería un grant muerto: no hay policy)');

select pg_temp.assert(
  not exists (select 1 from information_schema.table_privileges
              where grantee = 'authenticated' and table_schema = 'public'
                and table_name = 'listing_contacts'
                and privilege_type in ('UPDATE','DELETE')),
  'listing_contacts es append-only');

-- Las notificaciones solo nacen de triggers y solo mueren con el cascade de su
-- dueño. Un grant de insert aquí dejaría que cualquiera se fabricara avisos.
select pg_temp.assert(
  not exists (select 1 from information_schema.table_privileges
              where grantee = 'authenticated' and table_schema = 'public'
                and table_name = 'notifications'
                and privilege_type in ('INSERT','DELETE')),
  'notifications no tiene grant de INSERT ni DELETE');

-- El UPDATE de notifications existe SOLO por columna, y solo sobre leida_at. Si
-- alguien lo sube a nivel tabla, el texto del aviso se vuelve editable por quien
-- lo recibe.
select pg_temp.assert(
  not exists (select 1 from information_schema.table_privileges
              where grantee = 'authenticated' and table_schema = 'public'
                and table_name = 'notifications' and privilege_type = 'UPDATE')
  and exists (select 1 from information_schema.column_privileges
              where grantee = 'authenticated' and table_schema = 'public'
                and table_name = 'notifications' and column_name = 'leida_at'
                and privilege_type = 'UPDATE'),
  'notifications solo se actualiza en la columna leida_at');

-- Sin UPDATE en push_tokens: la reasignación de un token entre cuentas la hace
-- el trigger, no un upsert del cliente (que además fallaría contra el USING de
-- la policy). Ver la migración 20260911000450.
select pg_temp.assert(
  not exists (select 1 from information_schema.table_privileges
              where grantee = 'authenticated' and table_schema = 'public'
                and table_name = 'push_tokens' and privilege_type = 'UPDATE')
  and not exists (select 1 from information_schema.column_privileges
                  where grantee = 'authenticated' and table_schema = 'public'
                    and table_name = 'push_tokens' and privilege_type = 'UPDATE'),
  'push_tokens no tiene grant de UPDATE por ningún lado');

-- Una venta registrada no se borra: deshacerla sería decir "no fue a través de
-- Relevo" después del hecho, y para eso está la corrección del comprador. Y su
-- UPDATE existe SOLO por columna — si alguien lo sube a nivel tabla, el vendedor
-- puede reapuntar `listing_id` y mover la venta a otra publicación.
select pg_temp.assert(
  not exists (select 1 from information_schema.table_privileges
              where grantee = 'authenticated' and table_schema = 'public'
                and table_name = 'listing_sales'
                and privilege_type in ('DELETE','UPDATE'))
  and exists (select 1 from information_schema.column_privileges
              where grantee = 'authenticated' and table_schema = 'public'
                and table_name = 'listing_sales' and column_name = 'comprador_id'
                and privilege_type = 'UPDATE')
  and not exists (select 1 from information_schema.column_privileges
                  where grantee = 'authenticated' and table_schema = 'public'
                    and table_name = 'listing_sales' and privilege_type = 'UPDATE'
                    and column_name <> 'comprador_id'),
  'listing_sales no se borra y solo se actualiza en la columna comprador_id');

-- `listing_moderacion` (RF-18) guarda POR QUÉ se marcó cada publicación: los
-- scores de SafeSearch, las palabras exactas que machearon, el veredicto de
-- GPT. Es lo que hace revisable la cola de `pendiente` desde Studio — y es
-- justo por eso que no puede tener NI UN privilegio para el cliente: el motivo
-- por el que se bloqueó a alguien no es dato del campus. Mismo criterio que
-- `reports.reported_user_correo`.
--
-- Se mira a nivel TABLA y a nivel COLUMNA, no solo tabla: el gotcha de
-- `pg_default_acl` (CLAUDE.md §9) concede por default sobre toda tabla nueva, y
-- un `grant` de columna que alguien agregue después no aparecería en
-- `table_privileges`. La migración no tiene ningún `grant` — el `revoke all`
-- ES el control de acceso completo, así que esta aserción vigila que siga
-- siéndolo.
select pg_temp.assert(
  not exists (select 1 from information_schema.table_privileges
              where grantee in ('authenticated', 'anon')
                and table_schema = 'public'
                and table_name = 'listing_moderacion')
  and not exists (select 1 from information_schema.column_privileges
                  where grantee in ('authenticated', 'anon')
                    and table_schema = 'public'
                    and table_name = 'listing_moderacion'),
  'listing_moderacion no tiene ni un privilegio para authenticated ni anon');

-- Y sin una sola policy, que es la otra mitad: con RLS activo (lo cubre la
-- aserción universal de abajo) y cero policies, la tabla queda negada por
-- completo para cualquier rol sin bypassrls, aunque un grant se colara.
select pg_temp.assert(
  not exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'listing_moderacion'),
  'listing_moderacion no tiene ninguna policy (solo service_role la lee)');

-- `listing_moderacion_reclamos` (20260928000471): el reclamo del camino
-- cliente de `moderar-contenido`. Mismas dos aserciones gemelas, y aquí un
-- privilegio colado sería peor que una lectura: un DELETE sobre su propio
-- reclamo COMPLETADO le devolvería a un dueño la posibilidad de volver a
-- evaluarse por API, que es exactamente lo que la tabla existe para impedir.
select pg_temp.assert(
  not exists (select 1 from information_schema.table_privileges
              where grantee in ('authenticated', 'anon')
                and table_schema = 'public'
                and table_name = 'listing_moderacion_reclamos')
  and not exists (select 1 from information_schema.column_privileges
                  where grantee in ('authenticated', 'anon')
                    and table_schema = 'public'
                    and table_name = 'listing_moderacion_reclamos'),
  'listing_moderacion_reclamos no tiene ni un privilegio para authenticated ni anon');

select pg_temp.assert(
  not exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'listing_moderacion_reclamos'),
  'listing_moderacion_reclamos no tiene ninguna policy (solo service_role la usa)');

-- `avatar_moderacion` (20260928000473): la auditoría de los avatares borrados
-- por moderación. Mismas dos gemelas: el motivo por el que se le borró la foto
-- a alguien no es dato del campus, y un INSERT colado dejaría a un cliente
-- fabricarse avisos "Quitamos tu foto de perfil".
select pg_temp.assert(
  not exists (select 1 from information_schema.table_privileges
              where grantee in ('authenticated', 'anon')
                and table_schema = 'public'
                and table_name = 'avatar_moderacion')
  and not exists (select 1 from information_schema.column_privileges
                  where grantee in ('authenticated', 'anon')
                    and table_schema = 'public'
                    and table_name = 'avatar_moderacion'),
  'avatar_moderacion no tiene ni un privilegio para authenticated ni anon');

select pg_temp.assert(
  not exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'avatar_moderacion'),
  'avatar_moderacion no tiene ninguna policy (solo service_role la usa)');

-- `correos_bloqueados` (20260929000474): hashes de correos de cuentas borradas
-- estando suspendidas. Un seudónimo, no un dato anónimo: el cliente no lo lee
-- ni lo escribe. Mismas dos gemelas, con una diferencia: aquí SÍ hay una
-- policy, la de `supabase_auth_admin` (portante, como la de
-- `universidad_dominios`), y tiene que ser la ÚNICA.
select pg_temp.assert(
  not exists (select 1 from information_schema.table_privileges
              where grantee in ('authenticated', 'anon')
                and table_schema = 'public'
                and table_name = 'correos_bloqueados')
  and not exists (select 1 from information_schema.column_privileges
                  where grantee in ('authenticated', 'anon')
                    and table_schema = 'public'
                    and table_name = 'correos_bloqueados'),
  'correos_bloqueados no tiene ni un privilegio para authenticated ni anon');

select pg_temp.assert(
  has_table_privilege('supabase_auth_admin', 'public.correos_bloqueados', 'select')
  and (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'correos_bloqueados'
         and roles = '{supabase_auth_admin}' and cmd = 'SELECT') = 1
  and (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'correos_bloqueados') = 1,
  'correos_bloqueados: supabase_auth_admin la lee y tiene la ÚNICA policy');

-- RF-17, Ola 1 (20260930000477). Las funciones internas del panel que NO son
-- de trigger ni se invocan desde policies: solo las llaman RPCs definer de
-- `admin.*` (que corren como su dueño), así que nadie más debe poder
-- ejecutarlas. `exigir_admin()` invocable a mano no daría nada, pero
-- `auditar()` sí: escribiría auditoría a nombre de quien llama.
select pg_temp.assert(
  not has_function_privilege('authenticated', 'private.exigir_admin()', 'execute')
  and not has_function_privilege('authenticated', 'private.totp_timestamp()', 'execute')
  and not has_function_privilege('authenticated',
        'private.claves_auditoria_ok(text,jsonb)', 'execute')
  and not has_function_privilege('authenticated',
        'private.auditar(text,text,text,jsonb,jsonb,text)', 'execute')
  and not has_function_privilege('anon', 'private.exigir_admin()', 'execute')
  and not has_function_privilege('anon', 'private.totp_timestamp()', 'execute')
  and not has_function_privilege('anon', 'private.claves_auditoria_ok(text,jsonb)', 'execute')
  and not has_function_privilege('anon',
        'private.auditar(text,text,text,jsonb,jsonb,text)', 'execute'),
  'exigir_admin, totp_timestamp, claves_auditoria_ok y auditar están revocadas a authenticated y anon');

-- `private.admins` y `private.admin_acciones`: sin un solo privilegio para el
-- cliente, mirando tabla Y columna (la lección de `listing_moderacion`: un
-- `grant select (motivo)` no aparece en `table_privileges`).
select pg_temp.assert(
  not exists (select 1 from information_schema.table_privileges
              where grantee in ('authenticated', 'anon') and table_schema = 'private'
                and table_name in ('admins', 'admin_acciones'))
  and not exists (select 1 from information_schema.column_privileges
                  where grantee in ('authenticated', 'anon') and table_schema = 'private'
                    and table_name in ('admins', 'admin_acciones')),
  'private.admins y private.admin_acciones no tienen ni un privilegio para authenticated ni anon');

-- RF-17, Ola 4 (20261007000482): `private.moderacion_retenida`, el registro
-- mínimo de moderación de las bloqueadas eliminadas. Las dos gemelas de
-- `listing_moderacion` (tabla Y columna, y ninguna policy), más RLS habilitado:
-- `authenticated` tiene USAGE sobre `private`, así que el `revoke all` es todo el
-- control de acceso. Y la lista blanca, que solo llama el trigger, revocada.
select pg_temp.assert(
  not exists (select 1 from information_schema.table_privileges
              where grantee in ('authenticated', 'anon')
                and table_schema = 'private' and table_name = 'moderacion_retenida')
  and not exists (select 1 from information_schema.column_privileges
                  where grantee in ('authenticated', 'anon')
                    and table_schema = 'private' and table_name = 'moderacion_retenida')
  and not exists (select 1 from pg_policies
                  where schemaname = 'private' and tablename = 'moderacion_retenida')
  and (select relrowsecurity from pg_class where oid = 'private.moderacion_retenida'::regclass),
  'private.moderacion_retenida: sin privilegios para authenticated ni anon, sin policies y con RLS');

select pg_temp.assert(
  not has_function_privilege('authenticated', 'private.minimo_moderacion(jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.minimo_moderacion(jsonb)', 'execute'),
  'private.minimo_moderacion está revocada a authenticated y anon');

-- Schema `admin`: authenticated lo usa, anon no.
select pg_temp.assert(
  has_schema_privilege('authenticated', 'admin', 'usage')
  and not has_schema_privilege('anon', 'admin', 'usage'),
  'authenticated tiene USAGE sobre el schema admin y anon no');

-- Toda función de `admin.*`: definer, `search_path` fijo, EXECUTE para
-- authenticated y NUNCA para anon ni PUBLIC. PUBLIC se mira en el ACL mismo
-- (grantee 0): Postgres le da EXECUTE a PUBLIC en toda función nueva, y
-- `has_function_privilege('anon', …)` ya lo cubriría, pero así el mensaje de
-- la caída dice cuál de los dos faltó revocar.
select pg_temp.assert(
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'admin')
  and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'admin'
       and (not p.prosecdef
            or not coalesce(p.proconfig @> array['search_path=""'], false)
            or has_function_privilege('anon', p.oid, 'execute')
            or not has_function_privilege('authenticated', p.oid, 'execute')
            or exists (select 1
                         from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                        where a.grantee = 0))),
  'toda función de admin.* es definer, con search_path fijo y EXECUTE solo para authenticated');

-- RF-17, Ola 1 (20260930000478): la suspensión y su motivo. Ni el propio
-- usuario los lee por aquí (lo hará por una RPC de la tarea del aviso de
-- suspensión), y nadie del cliente los escribe: si pudiera, se levantaría la
-- suspensión a sí mismo o se inventaría el motivo. `users` tiene grants por
-- lista de columnas, así que nacen sin privilegios; esto lo vigila.
select pg_temp.assert(
  not has_column_privilege('authenticated', 'public.users', 'suspendido_at', 'select')
  and not has_column_privilege('authenticated', 'public.users', 'suspendido_at', 'insert')
  and not has_column_privilege('authenticated', 'public.users', 'suspendido_at', 'update')
  and not has_column_privilege('authenticated', 'public.users', 'suspension_motivo', 'select')
  and not has_column_privilege('authenticated', 'public.users', 'suspension_motivo', 'insert')
  and not has_column_privilege('authenticated', 'public.users', 'suspension_motivo', 'update'),
  'authenticated no tiene SELECT, INSERT ni UPDATE sobre users.suspendido_at ni suspension_motivo');

-- Dos candados PREVENTIVOS sobre `public.users` (medido en local y en remoto
-- el 2026-09-29: hoy ninguna vía devuelve su fila entera). Con columnas que no
-- son legibles para el cliente (`correo`, `telefono` y, desde la Ola 1,
-- `suspendido_at`/`suspension_motivo`), dos caminos las expondrían sin tocar
-- ningún grant: publicar la tabla en Realtime, o una función que devuelva la
-- fila completa.
select pg_temp.assert(
  not exists (select 1 from pg_publication_tables
              where schemaname = 'public' and tablename = 'users'),
  'public.users no está en ninguna publicación (Realtime no la emite)');

select pg_temp.assert(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'admin')
                and p.prorettype in ('public.users'::regtype,
                                     (select typarray from pg_type
                                       where oid = 'public.users'::regtype))),
  'ninguna función de public ni admin devuelve la fila completa de public.users');

-- Todas las tablas de public tienen RLS activo.
select pg_temp.assert(
  not exists (select 1 from pg_tables t
              where t.schemaname = 'public'
                and not exists (select 1 from pg_class c
                                join pg_namespace n on n.oid = c.relnamespace
                                where n.nspname = 'public' and c.relname = t.tablename
                                  and c.relrowsecurity)),
  'todas las tablas de public tienen RLS habilitado');

\echo ''
\echo '== T26 — precio es un entero entre 0 y 100000 (RF-05) =='
-- Autocontenida, mismo criterio que T14-T25: siembra su propio usuario y no
-- reutiliza fixtures de secciones anteriores.
--
--   :X — un usuario activo. Es quien inserta/actualiza en todas las
--        aserciones; no hace falta un segundo usuario porque el `check` de
--        20260922000464 alcanza a cualquier rol por igual, y lo único que
--        esta sección confirma es que el camino real del cliente (INSERT/
--        UPDATE con RLS de por medio) también lo respeta.
--
-- (a)-(e) prueban el INSERT (`estado` va explícito en 'pendiente', igual que
-- T25, para que el único motivo de rechazo posible sea el precio y no el
-- `with_check` de 20260919000463). (f)-(j) prueban el UPDATE, sobre una fila
-- SEMBRADA APARTE de las de (a)/(b) — mismo criterio que T19/T20/T23: la fila
-- que se lee no puede ser la misma que se muta.

\set X '''58585858-0000-0000-0000-000000005858'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  (:X::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-x@tec.mx', '', now(), now(), now());
update public.users set nombre = 'Ximena' where id = :X::uuid;

-- (a) Acepta 0 en INSERT.
select pg_temp.as_user(:X::uuid,
  format('insert into public.listings (user_id, categoria_id, universidad_id,
                                       campus_id, titulo, precio, condicion, estado)
          values (%L, 1, 1, 1, ''RLS T26 cero'', 0, ''nuevo'', ''pendiente'')', :X::uuid));
select pg_temp.assert(
  exists (select 1 from public.listings
          where titulo = 'RLS T26 cero' and user_id = :X::uuid and precio = 0),
  '(a) precio = 0 se acepta en INSERT');

-- (b) Acepta 100000 en INSERT (el tope, inclusive).
select pg_temp.as_user(:X::uuid,
  format('insert into public.listings (user_id, categoria_id, universidad_id,
                                       campus_id, titulo, precio, condicion, estado)
          values (%L, 1, 1, 1, ''RLS T26 tope'', 100000, ''nuevo'', ''pendiente'')', :X::uuid));
select pg_temp.assert(
  exists (select 1 from public.listings
          where titulo = 'RLS T26 tope' and user_id = :X::uuid and precio = 100000),
  '(b) precio = 100000 se acepta en INSERT');

-- (c) Rechaza negativo en INSERT.
select pg_temp.expect_error(:X::uuid,
  format('insert into public.listings (user_id, categoria_id, universidad_id,
                                       campus_id, titulo, precio, condicion, estado)
          values (%L, 1, 1, 1, ''RLS T26 negativo'', -1, ''nuevo'', ''pendiente'')', :X::uuid),
  '(c) precio = -1 se rechaza en INSERT');

-- (d) Rechaza sobre el tope en INSERT.
select pg_temp.expect_error(:X::uuid,
  format('insert into public.listings (user_id, categoria_id, universidad_id,
                                       campus_id, titulo, precio, condicion, estado)
          values (%L, 1, 1, 1, ''RLS T26 sobretope'', 100001, ''nuevo'', ''pendiente'')', :X::uuid),
  '(d) precio = 100001 se rechaza en INSERT');

-- (e) Rechaza decimales en INSERT.
select pg_temp.expect_error(:X::uuid,
  format('insert into public.listings (user_id, categoria_id, universidad_id,
                                       campus_id, titulo, precio, condicion, estado)
          values (%L, 1, 1, 1, ''RLS T26 decimal'', 10.50, ''nuevo'', ''pendiente'')', :X::uuid),
  '(e) precio = 10.50 se rechaza en INSERT');

-- Fila propia para (f)-(j), sembrada aparte de (a)/(b): esas dos ya quedaron
-- en 0 y 100000 respectivamente, y mutarlas otra vez mezclaría lectura y
-- escritura sobre la misma fila (la lección de T19/T20/T23).
--
-- Sembrada DIRECTO como postgres (no vía `as_user`) y en 'activa', no
-- 'pendiente': `listings_update_own` excluye pendiente/bloqueada del `using`
-- (T24 — "pendiente/bloqueada no son públicos ni los levanta su dueño"), así
-- que una fila pendiente no la puede tocar ni su propio dueño. Solo
-- postgres/service_role pueden sembrar un estado que no sea 'pendiente'
-- directo (T25 (f)); el cliente real jamás pasa por aquí en 'activa' sin que
-- la Edge Function de moderación lo decida primero, pero eso no es lo que
-- esta sección prueba — aquí el punto es el `check` de precio, no el flujo
-- de moderación.
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
values (:X::uuid, 1, 1, 1, 'RLS T26 update', 500, 'nuevo', 'activa');

create temp table t_precio on commit drop as
select id from public.listings where titulo = 'RLS T26 update' and user_id = :X::uuid;

-- (f) Acepta UPDATE a 0.
select pg_temp.as_user(:X::uuid,
  format('update public.listings set precio = 0 where id = %s', (select id from t_precio)));
select pg_temp.assert(
  (select precio from public.listings where id = (select id from t_precio)) = 0,
  '(f) precio = 0 se acepta en UPDATE');

-- (g) Acepta UPDATE a 100000.
select pg_temp.as_user(:X::uuid,
  format('update public.listings set precio = 100000 where id = %s', (select id from t_precio)));
select pg_temp.assert(
  (select precio from public.listings where id = (select id from t_precio)) = 100000,
  '(g) precio = 100000 se acepta en UPDATE');

-- (h) Rechaza UPDATE a negativo.
select pg_temp.expect_error(:X::uuid,
  format('update public.listings set precio = -1 where id = %s', (select id from t_precio)),
  '(h) precio = -1 se rechaza en UPDATE');

-- (i) Rechaza UPDATE sobre el tope.
select pg_temp.expect_error(:X::uuid,
  format('update public.listings set precio = 100001 where id = %s', (select id from t_precio)),
  '(i) precio = 100001 se rechaza en UPDATE');

-- (j) Rechaza UPDATE con decimales.
select pg_temp.expect_error(:X::uuid,
  format('update public.listings set precio = 10.50 where id = %s', (select id from t_precio)),
  '(j) precio = 10.50 se rechaza en UPDATE');

\echo ''
\echo '== T27 — dominios de registro y el Auth Hook (20260923000465) =='
-- Autocontenida: siembra su propia universidad y su propio dominio
-- (`rls-t27.mx`) en vez de apoyarse en el `tec.mx` de seed.sql, y su propio
-- usuario :Y.
--
-- ALCANCE: esta sección prueba los GRANTS y la LÓGICA de la función,
-- llamándola directo como `postgres`. NO prueba que GoTrue la invoque, ni que
-- la policy de `supabase_auth_admin` deje leer la tabla: `postgres` tiene
-- bypassrls y no es miembro de `supabase_auth_admin`, así que aquí la policy no
-- se evalúa nunca. Eso lo cubre `scripts/probe-registro.mjs`, contra el Auth
-- local. Sin ese probe, borrar la policy daría esta sección entera en verde
-- mientras el hook rechaza TODOS los registros.
--
--   :Y — un usuario activo, para comprobar con comportamiento (no solo con
--        el catálogo) que `authenticated` no lee la tabla ni ejecuta la
--        función.

\set Y '''59595959-0000-0000-0000-000000005959'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  (:Y::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-y@tec.mx', '', now(), now(), now());

insert into public.universidades (nombre) values ('RLS T27 Universidad');
insert into public.universidad_dominios (dominio, universidad_id)
select 'rls-t27.mx', id from public.universidades where nombre = 'RLS T27 Universidad';

-- Lo que devuelve el hook para un email dado (null = sin campo `email`).
create or replace function pg_temp.hook(p_email text) returns jsonb
language sql as $$
  select public.hook_before_user_created(
    jsonb_build_object('user', jsonb_build_object('email', p_email)))
$$;

-- El rechazo exacto que reconoce el cliente (`src/lib/registro.ts`).
create or replace function pg_temp.rechazo() returns jsonb
language sql as $$
  select '{"error": {"http_code": 403, "message": "dominio_no_participante"}}'::jsonb
$$;

-- (a) Ni table_privileges NI column_privileges para anon/authenticated. Son
-- las dos, igual que listing_moderacion en T12: un `grant select (dominio)`
-- acotado solo aparece en la segunda.
select pg_temp.assert(
  not exists (select 1 from information_schema.table_privileges
              where grantee in ('authenticated', 'anon')
                and table_schema = 'public' and table_name = 'universidad_dominios')
  and not exists (select 1 from information_schema.column_privileges
                  where grantee in ('authenticated', 'anon')
                    and table_schema = 'public' and table_name = 'universidad_dominios'),
  '(a) universidad_dominios no tiene ni un privilegio para authenticated ni anon');

-- (b) Y con comportamiento: un autenticado de verdad no la lee.
select pg_temp.expect_error(:Y::uuid,
  'select count(*) from public.universidad_dominios',
  '(b) authenticated no puede leer universidad_dominios');

-- (c) Nadie más que supabase_auth_admin ejecuta el hook. `public` incluido:
-- sin su revoke, anon y authenticated lo heredarían por PUBLIC.
select pg_temp.assert(
  not has_function_privilege('anon', 'public.hook_before_user_created(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                  where p.oid = 'public.hook_before_user_created(jsonb)'::regprocedure
                    and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  '(c) ni anon, ni authenticated, ni PUBLIC ejecutan hook_before_user_created');

-- (d) Con comportamiento: un autenticado no puede invocarlo (ni por RPC).
select pg_temp.expect_error(:Y::uuid,
  'select public.hook_before_user_created(''{}''::jsonb)',
  '(d) authenticated no puede ejecutar hook_before_user_created');

-- (e) Y el positivo: GoTrue sí tiene lo que necesita. Sin esto, un revoke de
-- más pasaría (a)-(d) en verde y el hook fallaría cerrado para todos.
select pg_temp.assert(
  has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute')
  and has_table_privilege('supabase_auth_admin', 'public.universidad_dominios', 'select')
  and (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'universidad_dominios'
         and roles = '{supabase_auth_admin}' and cmd = 'SELECT') = 1
  and (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'universidad_dominios') = 1,
  '(e) supabase_auth_admin ejecuta el hook, lee la tabla y tiene la ÚNICA policy');

-- (f) La lógica: permite el dominio exacto, sin importar mayúsculas ni espacios.
select pg_temp.assert(
  pg_temp.hook('a01@rls-t27.mx') = '{}'::jsonb
  and pg_temp.hook('A01@RLS-T27.MX') = '{}'::jsonb
  and pg_temp.hook('  a01@rls-t27.mx  ') = '{}'::jsonb,
  '(f) el dominio sembrado pasa, en minúsculas, mayúsculas y con espacios');

-- (g) Coincidencia EXACTA: ni subdominios, ni sufijos, ni prefijos.
select pg_temp.assert(
  pg_temp.hook('x@estudiante.rls-t27.mx') = pg_temp.rechazo()
  and pg_temp.hook('x@rls-t27.mx.evil.com') = pg_temp.rechazo()
  and pg_temp.hook('x@evilrls-t27.mx') = pg_temp.rechazo(),
  '(g) subdominio, sufijo e imitación por prefijo se rechazan');

-- (h) Se toma lo que sigue al ÚLTIMO '@'. GoTrue ya rechaza estos correos por
-- formato antes del hook (medido: 400 validation_failed), así que esto
-- protege la función por sí sola, no un camino alcanzable hoy.
select pg_temp.assert(
  pg_temp.hook('x@rls-t27.mx@gmail.com') = pg_temp.rechazo()
  and pg_temp.hook('x@gmail.com@rls-t27.mx') = '{}'::jsonb,
  '(h) el dominio es lo que sigue al último @');

-- (i) Falla cerrado: un dominio desconocido, un email vacío o ausente rechazan.
select pg_temp.assert(
  pg_temp.hook('x@gmail.com') = pg_temp.rechazo()
  and pg_temp.hook('') = pg_temp.rechazo()
  and pg_temp.hook(null) = pg_temp.rechazo()
  and public.hook_before_user_created('{}'::jsonb) = pg_temp.rechazo(),
  '(i) gmail, email vacío, email null y evento sin usuario se rechazan');

-- (j) El check guarda el dominio ya normalizado: con mayúsculas, espacios o
-- '@' no machearía nunca contra lo que extrae el hook, así que se rechaza al
-- darlo de alta en vez de fallar en silencio al registrarse.
create or replace function pg_temp.rechaza_dominio(p_dominio text) returns boolean
language plpgsql as $$
begin
  insert into public.universidad_dominios (dominio, universidad_id)
  select p_dominio, id from public.universidades where nombre = 'RLS T27 Universidad';
  return false;
exception when check_violation then
  return true;
end $$;
select pg_temp.assert(
  pg_temp.rechaza_dominio('Otra.mx')
  and pg_temp.rechaza_dominio(' otra.mx')
  and pg_temp.rechaza_dominio('a@otra.mx')
  and pg_temp.rechaza_dominio(''),
  '(j) el check rechaza dominios con mayúsculas, espacios, @ o vacíos');

\echo ''
\echo '== T28 — la universidad sale del dominio y la base ata campus y publicaciones a ella =='
-- 20260924000466, fase 2A. Autocontenida, con su propia universidad, su dominio
-- `rls-t28.mx` y DOS campus propios (el segundo es el destino "legítimo" de
-- (d4), para que su control no choque con otra regla). Como universidad y
-- campus AJENOS usa los de `tec.mx`, que siembra seed.sql.
--
--   :Z  — `@rls-t28.mx`: dominio registrado, nace con universidad.
--   :Z2 — `@no-registrado-t28.mx`: el caso de una cuenta creada por llave
--         secreta (Studio, admin API), que no pasa por el Auth Hook.
--
-- `expect_error` acepta CUALQUIER error, y aquí hay cuatro mecanismos que se
-- confunden (grant 42501, dos FKs 23503 distintas y un check 23514). Por eso
-- estas aserciones comparan el SQLSTATE y el NOMBRE del constraint con
-- `pg_temp.rechazo_de()`: un rechazo por el candado equivocado no pasa.
--
-- CONTROLES NEGATIVOS, corridos uno a la vez contra la suite completa:
-- ver la tabla de CLAUDE.md §3 ("Y a N con las de T28").

\set Z  '''28282828-0000-0000-0000-000000002828'''
\set Z2 '''28282828-0000-0000-0000-000000002829'''

insert into public.universidades (nombre) values ('RLS T28 Universidad');
insert into public.universidad_dominios (dominio, universidad_id)
select 'rls-t28.mx', id from public.universidades where nombre = 'RLS T28 Universidad';
-- Un dominio DESACTIVADO (20261008000484) para el amarre de (a3): el hook lo
-- rechaza y el trigger no le asigna universidad. Filtrar `activo` en una sola
-- de las dos copias rompe el amarre.
insert into public.universidad_dominios (dominio, universidad_id, activo)
select 'rls-t28-inactivo.mx', id, false from public.universidades where nombre = 'RLS T28 Universidad';
insert into public.campus (universidad_id, nombre, ciudad)
select id, c, 'Ciudad T28'
from public.universidades, unnest(array['RLS T28 Campus A', 'RLS T28 Campus B']) as c
where nombre = 'RLS T28 Universidad';

create temp table t28 as
select
  (select id from public.universidades where nombre = 'RLS T28 Universidad') as uni,
  (select id from public.campus where nombre = 'RLS T28 Campus A') as campus_a,
  (select id from public.campus where nombre = 'RLS T28 Campus B') as campus_b,
  (select universidad_id from public.universidad_dominios where dominio = 'tec.mx') as uni_ajena,
  (select min(c.id) from public.campus c
    join public.universidad_dominios d on d.universidad_id = c.universidad_id
   where d.dominio = 'tec.mx') as campus_ajeno,
  (select min(id) from public.categories) as categoria;
grant select on t28 to authenticated;

-- Precondición de la sección: sin esto, (c)/(d) podrían pasar por la razón
-- equivocada (campus ajeno null, universidades iguales).
select pg_temp.assert(
  (select uni is not null and uni_ajena is not null and uni <> uni_ajena
          and campus_a is not null and campus_b is not null and campus_ajeno is not null
          and categoria is not null from t28),
  'T28: fixtures completos (dos universidades distintas, campus de cada una)');

-- `pg_temp.rechazo_de()` vive con los helpers del principio del archivo
-- (se subió ahí para que T16 la use; nació aquí, con T28).

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  (:Z::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-z@rls-t28.mx', '', now(), now(), now());

-- El alta de :Z2 va CAPTURADA y no como insert suelto: si el trigger lanzara
-- ante un dominio sin registrar, un insert suelto tumbaría la suite con el
-- error crudo antes de llegar a (a2), que es justo la aserción que lo prueba.
select pg_temp.rechazo_de(null, format(
  'insert into auth.users (id, instance_id, aud, role, email, encrypted_password, '
  || 'email_confirmed_at, created_at, updated_at) values (%L, %L, ''authenticated'', '
  || '''authenticated'', ''rls-z2@no-registrado-t28.mx'', '''', now(), now(), now())',
  :Z2::uuid, '00000000-0000-0000-0000-000000000000')) as r_alta_z2 \gset

-- (a) El trigger de alta asigna la universidad del dominio.
select pg_temp.assert(
  (select universidad_id from public.users where id = :Z::uuid) = (select uni from t28),
  '(a) un alta de un dominio registrado nace con la universidad de ese dominio');

-- (a2) Sin dominio registrado: la fila EXISTE (el alta no abortó) y nace sin
-- universidad. Es la mitad "nunca lanza" del trigger.
select pg_temp.assert(
  :'r_alta_z2' = 'ok'
  and exists (select 1 from public.users where id = :Z2::uuid and universidad_id is null),
  '(a2) un dominio no registrado crea el perfil igual, con universidad null');

-- (a3) El amarre entre las DOS copias de la normalización: el hook deja pasar
-- un correo ⇔ el trigger le asigna universidad. Cada caso es un borde donde
-- una copia descuidada divergiría (mayúsculas, espacios, dos '@', subdominio).
-- Se exige además que haya casos de las dos polaridades, para que no pase
-- porque todos rechazan o todos permiten.
create or replace function pg_temp.amarre(p_email text) returns boolean
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_hook_permite boolean;
  v_trigger_asigna boolean;
begin
  v_hook_permite := public.hook_before_user_created(
    jsonb_build_object('user', jsonb_build_object('email', p_email))) = '{}'::jsonb;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', p_email, '', now(), now(), now());
  select universidad_id is not null into v_trigger_asigna
    from public.users where id = v_id;
  return v_hook_permite = v_trigger_asigna;
end $$;
select pg_temp.assert(
  pg_temp.amarre('Mayus@RLS-T28.MX')
  and pg_temp.amarre('  espacios@rls-t28.mx  ')
  and pg_temp.amarre('x@gmail.com@rls-t28.mx')
  and pg_temp.amarre('x@rls-t28.mx@gmail.com')
  and pg_temp.amarre('x@sub.rls-t28.mx')
  and pg_temp.amarre('x@rls-t28-inactivo.mx')
  and pg_temp.hook('Mayus@RLS-T28.MX') = '{}'::jsonb
  and pg_temp.hook('x@sub.rls-t28.mx') = pg_temp.rechazo()
  and pg_temp.hook('x@rls-t28-inactivo.mx') = pg_temp.rechazo(),
  '(a3) el hook permite un correo si y solo si el trigger le asigna universidad');

-- (b) Nadie cambia su universidad desde el cliente: la columna salió del grant.
select pg_temp.assert(
  pg_temp.rechazo_de(:Z::uuid, format(
    'update public.users set universidad_id = %s where id = %L',
    (select uni_ajena from t28), :Z::uuid)) = '42501',
  '(b) authenticated no puede cambiar su universidad_id (grant)');

-- (c) Ni elegir un campus de otra universidad: la FK compuesta.
select pg_temp.assert(
  pg_temp.rechazo_de(:Z::uuid, format(
    'update public.users set campus_id = %s where id = %L',
    (select campus_ajeno from t28), :Z::uuid)) = '23503:users_campus_universidad_fkey',
  '(c) authenticated no puede fijar un campus de otra universidad');

-- (c2) Control positivo de (c): un campus de SU universidad sí. Sin esta, (c)
-- pasaría igual si `campus_id` hubiera salido del grant por error.
--
-- La acción y la comprobación del estado van en SENTENCIAS DISTINTAS (`\gset`),
-- y no es estilo: una subconsulta dentro del mismo `select pg_temp.assert(...)`
-- corre con el snapshot de ESA sentencia y no ve lo que escribió
-- `rechazo_de()`. Medido: con todo en una sola sentencia, esta aserción caía
-- aunque el update sí había escrito. Y en (d4)/(d6), que comprueban que algo NO
-- cambió, el mismo error las habría dejado pasando sin probar nada.
select pg_temp.rechazo_de(:Z::uuid, format(
  'update public.users set campus_id = %s where id = %L',
  (select campus_a from t28), :Z::uuid)) as r_c2 \gset
select pg_temp.assert(
  :'r_c2' = 'ok'
  and (select campus_id from public.users where id = :Z::uuid) = (select campus_a from t28),
  '(c2) authenticated sí elige un campus de su universidad');

-- (c3) Sin universidad no hay campus. La FK es MATCH SIMPLE y NO se evalúa con
-- `universidad_id` null: quien lo impide es el check. Como postgres, para que
-- el grant no se meta.
select pg_temp.assert(
  pg_temp.rechazo_de(null, format(
    'update public.users set campus_id = %s where id = %L',
    (select campus_a from t28), :Z2::uuid)) = '23514:users_campus_requiere_universidad',
  '(c3) un perfil sin universidad no puede tener campus (check)');

-- Publicaciones. Todas nacen `pendiente` (el único estado que el cliente puede
-- insertar, T25), con estado explícito para que ése no sea el motivo de rechazo.
create or replace function pg_temp.insert_t28(p_uni bigint, p_campus bigint, p_titulo text)
returns text language sql as $$
  select format(
    'insert into public.listings (user_id, categoria_id, universidad_id, campus_id, '
    || 'titulo, precio, condicion, estado) values (auth.uid(), %s, %s, %s, %L, 100, '
    || '''usado'', ''pendiente'')',
    (select categoria from t28), p_uni, p_campus, p_titulo)
$$;

-- (d) No se publica en otra universidad: FK publicación ↔ dueño. El campus
-- ajeno SÍ es de esa universidad ajena, así que el único candado en juego es
-- `listings_user_universidad_fkey`.
select pg_temp.assert(
  pg_temp.rechazo_de(:Z::uuid, pg_temp.insert_t28(
    (select uni_ajena from t28), (select campus_ajeno from t28), 'T28 d'))
    = '23503:listings_user_universidad_fkey',
  '(d) authenticated no puede crear una publicación en otra universidad');

-- (d2) Ni en SU universidad con un campus de otra: FK campus ↔ universidad.
select pg_temp.assert(
  pg_temp.rechazo_de(:Z::uuid, pg_temp.insert_t28(
    (select uni from t28), (select campus_ajeno from t28), 'T28 d2'))
    = '23503:listings_campus_universidad_fkey',
  '(d2) authenticated no puede crear una publicación con un campus ajeno a su universidad');

-- (d3) Control positivo: coherente, pasa. Sin ella, (d)/(d2) pasarían igual si
-- el insert estuviera roto por otra razón.
select pg_temp.assert(
  pg_temp.rechazo_de(:Z::uuid, pg_temp.insert_t28(
    (select uni from t28), (select campus_a from t28), 'T28 d3')) = 'ok',
  '(d3) authenticated sí publica en su universidad y un campus de ella');

-- (d4) Una publicación no se MUEVE: ni de universidad ni de campus. Sobre una
-- fila `activa` sembrada como postgres (una `pendiente` la filtra el `using` de
-- update, T24), y con destino a su OTRO campus propio: con el grant restituido,
-- el update pasaría limpio y el control caería aquí y no en otra regla.
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
select :Z::uuid, categoria, uni, campus_a, 'T28 d4', 100, 'usado', 'activa' from t28;
select pg_temp.rechazo_de(:Z::uuid, format(
  'update public.listings set campus_id = %s where titulo = %L',
  (select campus_b from t28), 'T28 d4')) as r_d4_campus \gset
select pg_temp.rechazo_de(:Z::uuid, format(
  'update public.listings set universidad_id = %s where titulo = %L',
  (select uni_ajena from t28), 'T28 d4')) as r_d4_uni \gset
select pg_temp.assert(
  :'r_d4_campus' = '42501' and :'r_d4_uni' = '42501'
  and (select campus_id from public.listings where titulo = 'T28 d4') = (select campus_a from t28),
  '(d4) authenticated no puede mover una publicación de campus ni de universidad (grant)');

-- (d5) Un dueño SIN universidad no publica en ninguna: `(id, null)` no machea
-- ninguna fila de `users(id, universidad_id)`.
select pg_temp.assert(
  pg_temp.rechazo_de(:Z2::uuid, pg_temp.insert_t28(
    (select uni from t28), (select campus_a from t28), 'T28 d5'))
    = '23503:listings_user_universidad_fkey',
  '(d5) un usuario sin universidad no puede publicar');

-- (d6) Aplica también a postgres/Studio: mover a un usuario CON publicaciones a
-- otra universidad aborta. El cascade lleva la universidad nueva a sus
-- publicaciones, que conservan el campus viejo, y la FK campus ↔ universidad
-- las rechaza. Falla cerrado, y la universidad del usuario no cambia.
select pg_temp.rechazo_de(null, format(
  'update public.users set universidad_id = %s, campus_id = %s where id = %L',
  (select uni_ajena from t28), (select campus_ajeno from t28), :Z::uuid)) as r_d6 \gset
select pg_temp.assert(
  :'r_d6' = '23503:listings_campus_universidad_fkey'
  and (select universidad_id from public.users where id = :Z::uuid) = (select uni from t28),
  '(d6) mover de universidad a un usuario con publicaciones aborta (también como postgres)');

\echo ''
\echo '== T29 — coordenadas de campus (fase 2C, "Detectar campus más cercano") =='
-- 20260925000467. Autocontenida, con su propia universidad "RLS T29
-- Universidad" y su propio usuario `:W` — no reusa los fixtures de T28
-- (la moraleja de siempre: un estado incidental de otra sección puede
-- volverse load-bearing sin querer). `pg_temp.rechazo_de()` está definida con
-- los helpers del principio del archivo; no hace falta redefinirla.
--
-- (a)-(e) corren como postgres (`p_uid = null`): son checks de tabla, no
-- policies, y validan la fila resultante sin importar el rol que escribe —
-- no hay nada que el grant pudiera "meterse" a confundir, al revés que (c3)
-- de T28. (f)/(g) sí necesitan `authenticated`: prueban el grant, no el check.

\set W '''29292929-0000-0000-0000-000000002929'''

insert into public.universidades (nombre) values ('RLS T29 Universidad');
create temp table t29 as
select (select id from public.universidades where nombre = 'RLS T29 Universidad') as uni;
select pg_temp.assert((select uni is not null from t29), 'T29: fixture de universidad presente');

-- (a) Rechaza latitud > 90.
select pg_temp.assert(
  pg_temp.rechazo_de(null, format(
    'insert into public.campus (universidad_id, nombre, ciudad, latitud, longitud) '
    || 'values (%s, ''T29 a'', ''Ciudad T29'', 95, 0)', (select uni from t29)))
    = '23514:campus_latitud_check',
  '(a) rechaza latitud > 90');

-- (a2) Rechaza latitud < -90.
select pg_temp.assert(
  pg_temp.rechazo_de(null, format(
    'insert into public.campus (universidad_id, nombre, ciudad, latitud, longitud) '
    || 'values (%s, ''T29 a2'', ''Ciudad T29'', -95, 0)', (select uni from t29)))
    = '23514:campus_latitud_check',
  '(a2) rechaza latitud < -90');

-- (b) Rechaza longitud > 180.
select pg_temp.assert(
  pg_temp.rechazo_de(null, format(
    'insert into public.campus (universidad_id, nombre, ciudad, latitud, longitud) '
    || 'values (%s, ''T29 b'', ''Ciudad T29'', 0, 185)', (select uni from t29)))
    = '23514:campus_longitud_check',
  '(b) rechaza longitud > 180');

-- (b2) Rechaza longitud < -180.
select pg_temp.assert(
  pg_temp.rechazo_de(null, format(
    'insert into public.campus (universidad_id, nombre, ciudad, latitud, longitud) '
    || 'values (%s, ''T29 b2'', ''Ciudad T29'', 0, -185)', (select uni from t29)))
    = '23514:campus_longitud_check',
  '(b2) rechaza longitud < -180');

-- (c) Rechaza latitud SIN longitud.
select pg_temp.assert(
  pg_temp.rechazo_de(null, format(
    'insert into public.campus (universidad_id, nombre, ciudad, latitud, longitud) '
    || 'values (%s, ''T29 c'', ''Ciudad T29'', 25.6, null)', (select uni from t29)))
    = '23514:campus_coordenadas_completas_check',
  '(c) rechaza latitud sin longitud');

-- (c2) Y al revés: longitud SIN latitud.
select pg_temp.assert(
  pg_temp.rechazo_de(null, format(
    'insert into public.campus (universidad_id, nombre, ciudad, latitud, longitud) '
    || 'values (%s, ''T29 c2'', ''Ciudad T29'', null, -100.2)', (select uni from t29)))
    = '23514:campus_coordenadas_completas_check',
  '(c2) rechaza longitud sin latitud');

-- (d) Acepta ambas NULL: un campus sin coordenadas capturadas todavía no
-- participa en la detección, pero sigue siendo una fila válida.
select pg_temp.assert(
  pg_temp.rechazo_de(null, format(
    'insert into public.campus (universidad_id, nombre, ciudad, latitud, longitud) '
    || 'values (%s, ''T29 d'', ''Ciudad T29'', null, null)', (select uni from t29)))
    = 'ok',
  '(d) acepta ambas coordenadas en NULL');

-- (e) Acepta ambas válidas, incluidos los bordes EXACTOS ±90/±180 — los checks
-- son `>=`/`<=`, no estrictos.
select pg_temp.assert(
  pg_temp.rechazo_de(null, format(
    'insert into public.campus (universidad_id, nombre, ciudad, latitud, longitud) '
    || 'values (%s, ''T29 e1'', ''Ciudad T29'', 25.65, -100.29)', (select uni from t29)))
    = 'ok'
  and pg_temp.rechazo_de(null, format(
    'insert into public.campus (universidad_id, nombre, ciudad, latitud, longitud) '
    || 'values (%s, ''T29 e2'', ''Ciudad T29'', 90, 180)', (select uni from t29)))
    = 'ok'
  and pg_temp.rechazo_de(null, format(
    'insert into public.campus (universidad_id, nombre, ciudad, latitud, longitud) '
    || 'values (%s, ''T29 e3'', ''Ciudad T29'', -90, -180)', (select uni from t29)))
    = 'ok',
  '(e) acepta coordenadas válidas, incluidos los bordes exactos ±90/±180');

-- (f)/(g): grant heredado de tabla (CLAUDE.md §3, mismo caso que
-- `listings.busqueda`). Sembrada como postgres para no depender de (d)/(e).
insert into public.campus (universidad_id, nombre, ciudad, latitud, longitud)
select uni, 'T29 f', 'Ciudad T29', 25.5, -100.3 from t29;

-- (f) authenticated SÍ puede leer latitud/longitud.
select pg_temp.assert(
  pg_temp.rechazo_de(:W::uuid,
    'select latitud, longitud from public.campus where nombre = ''T29 f''')
    = 'ok',
  '(f) authenticated puede leer latitud/longitud');

-- (g) authenticated NO puede escribirlas: `revoke all` (20260906000437) nunca
-- se contradijo con ningún grant de columna para estas dos.
select pg_temp.assert(
  pg_temp.rechazo_de(:W::uuid,
    'update public.campus set latitud = 0, longitud = 0 where nombre = ''T29 f''')
    = '42501',
  '(g) authenticated no puede escribir latitud/longitud (grant)');

\echo ''
\echo '== T30 — búsqueda por prefijo en el último término (public.buscar_listings) =='
-- 20260926000468. Autocontenida: sus propios `:V30` (vendedor) y `:C30`
-- (comprador), y sus propias publicaciones con el prefijo "RLS T30" en el
-- título. Cada aserción cuenta SOLO filas cuyo título es el esperado, porque
-- T0 sembró otro "RLS Cálculo de Larson" que también casa con `calc`.
--
-- La acción corre como `authenticated` (as_user_int): la RLS de listings es
-- parte de lo que se prueba, y como postgres (bypassrls) la aserción (h)
-- pasaría por la razón equivocada.

\set V30 '''30303030-0000-0000-0000-000000003030'''
\set C30 '''30303030-0000-0000-0000-000000003031'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  (:V30::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-t30-v@tec.mx', '', now(), now(), now()),
  (:C30::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-t30-c@tec.mx', '', now(), now(), now());

-- Como postgres: la policy de insert obliga a `pendiente` y aquí hace falta
-- sembrar `activa`/`pausada` directo (mismo criterio que T0).
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, descripcion, precio, condicion, estado)
select :V30::uuid, 1, u.universidad_id, 1, v.titulo, v.descripcion, 100, 'usado', v.estado::public.listing_status
from public.users u,
     (values ('RLS T30 Cálculo de Larson', 'Novena edición', 'activa'),
             ('RLS T30 Libro de cálculo',  'Diferencial',    'activa'),
             ('RLS T30 Estetoscopio',      'Littmann',       'activa'),
             ('RLS T30 Cálculo pausado',   'No visible',     'pausada')) as v(titulo, descripcion, estado)
where u.id = :V30::uuid;

select pg_temp.assert(
  (select count(*) from public.listings where titulo like 'RLS T30 %') = 4,
  'T30: fixtures sembrados (4 publicaciones, una pausada)');

-- Cuántas filas con ESE título devuelve la función para `p_q`, como `p_uid`.
create or replace function pg_temp.t30(p_uid uuid, p_q text, p_titulo text)
returns bigint language sql as $$
  select pg_temp.as_user_int(p_uid, format(
    'select count(*) from public.buscar_listings(%L) where titulo like %L', p_q, p_titulo))
$$;

-- (a)-(c) El prefijo, y los acentos siguen resueltos por el stemmer.
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'calc', 'RLS T30 Cálculo de Larson') = 1,
  '(a) "calc" encuentra "Cálculo de Larson"');
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'calculo', 'RLS T30 Cálculo de Larson') = 1,
  '(b) "calculo" (sin acento) encuentra "Cálculo de Larson"');
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'cálculo', 'RLS T30 Cálculo de Larson') = 1,
  '(c) "cálculo" encuentra "Cálculo de Larson"');

-- (d) Varios términos: los anteriores al último se exigen como hoy.
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'libro calc', 'RLS T30 Libro de cálculo') = 1,
  '(d1) "libro calc" encuentra "Libro de cálculo"');
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'libro calc', 'RLS T30 Cálculo de Larson') = 0,
  '(d2) "libro calc" NO encuentra "Cálculo de Larson" (exige los dos términos)');

-- (e) Una stopword de 3+ letras como último término va como prefijo sin
-- stemming: "este" es stopword y también el inicio de "estetoscopio".
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'este', 'RLS T30 Estetoscopio') = 1,
  '(e) "este" (stopword de 4 letras) encuentra "Estetoscopio"');

-- (f) Una stopword corta cuenta como ausente: tsquery vacía, 0 filas — nunca
-- el catálogo entero.
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'de', 'RLS T30 %') = 0,
  '(f) "de" (stopword) no devuelve nada');

-- (g) Menos de 3 letras: palabra completa, no prefijo.
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'ca', 'RLS T30 Cálculo de Larson') = 0,
  '(g) "ca" (2 letras) no casa por prefijo con "Cálculo"');

-- (h) La RLS aplica DENTRO de la función (SECURITY INVOKER). (h2) es el
-- control de la MISMA fila: su dueño sí la encuentra, así que el motivo de
-- (h) es la RLS y no el texto.
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'calc', 'RLS T30 Cálculo pausado') = 0,
  '(h) un tercero NO encuentra la publicación pausada ajena');
select pg_temp.assert(pg_temp.t30(:V30::uuid, 'calc', 'RLS T30 Cálculo pausado') = 1,
  '(h2) su dueño SÍ la encuentra (control: el filtro es la RLS)');

-- (i) Invariantes de la función. `proconfig is null` no es cosmético: una
-- cláusula SET (p. ej. `set search_path`) impide que Postgres inlinee la
-- función, y sin inlining los filtros del cliente se aplican DESPUÉS de
-- materializar todas las coincidencias.
select pg_temp.assert(
  (select not prosecdef from pg_proc where oid = 'public.buscar_listings(text)'::regprocedure),
  '(i1) buscar_listings es SECURITY INVOKER');
select pg_temp.assert(
  (select provolatile = 's' and proconfig is null
     from pg_proc where oid = 'public.buscar_listings(text)'::regprocedure),
  '(i2) buscar_listings es STABLE y sin cláusulas SET (inlineable)');
select pg_temp.assert(
  has_function_privilege('authenticated', 'public.buscar_listings(text)', 'execute')
  and not has_function_privilege('anon', 'public.buscar_listings(text)', 'execute'),
  '(i3) authenticated puede ejecutarla y anon no');

-- (j) Fuzz: ninguna entrada lanza (un error aborta la suite aquí mismo, con
-- ON_ERROR_STOP) y ninguna devuelve publicaciones de T30.
select pg_temp.assert(pg_temp.t30(:C30::uuid, '', 'RLS T30 %') = 0, '(j) fuzz: cadena vacía');
select pg_temp.assert(pg_temp.t30(:C30::uuid, '   ', 'RLS T30 %') = 0, '(j) fuzz: solo espacios');
select pg_temp.assert(pg_temp.t30(:C30::uuid, '''', 'RLS T30 %') = 0, '(j) fuzz: comilla simple');
select pg_temp.assert(pg_temp.t30(:C30::uuid, '&', 'RLS T30 %') = 0, '(j) fuzz: &');
select pg_temp.assert(pg_temp.t30(:C30::uuid, '|', 'RLS T30 %') = 0, '(j) fuzz: |');
select pg_temp.assert(pg_temp.t30(:C30::uuid, '!', 'RLS T30 %') = 0, '(j) fuzz: !');
select pg_temp.assert(pg_temp.t30(:C30::uuid, '(', 'RLS T30 %') = 0, '(j) fuzz: (');
select pg_temp.assert(pg_temp.t30(:C30::uuid, ':*', 'RLS T30 %') = 0, '(j) fuzz: :*');
select pg_temp.assert(pg_temp.t30(:C30::uuid, '\', 'RLS T30 %') = 0, '(j) fuzz: backslash');
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'a:*b', 'RLS T30 %') = 0, '(j) fuzz: a:*b');
select pg_temp.assert(pg_temp.t30(:C30::uuid, '😀🔥', 'RLS T30 %') = 0, '(j) fuzz: emojis');
select pg_temp.assert(pg_temp.t30(:C30::uuid, repeat('calc', 125), 'RLS T30 %') = 0,
  '(j) fuzz: 500 caracteres');
select pg_temp.assert(pg_temp.t30(:C30::uuid, repeat('x', 3000), 'RLS T30 %') = 0,
  '(j) fuzz: un token de 3000 caracteres (más largo de lo que tsvector indexa)');
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'de la', 'RLS T30 %') = 0,
  '(j) fuzz: solo stopwords');
-- (j2) Un término REAL pegado a sintaxis de tsquery. Son las entradas que
-- revientan una concatenación cruda (`to_tsquery(tail || ':*')` da error de
-- sintaxis con `calc'` o `calc)`): la basura de (j) no llega a ese camino
-- porque no produce lexemas. Aquí sí hay un lexema, así que se busca con
-- prefijo y la puntuación pegada se ignora.
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'calc''', 'RLS T30 Cálculo de Larson') = 1,
  '(j2) fuzz: calc'' (comilla pegada) no lanza y encuentra');
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'calc)', 'RLS T30 Cálculo de Larson') = 1,
  '(j2) fuzz: calc) no lanza y encuentra');
select pg_temp.assert(pg_temp.t30(:C30::uuid, '(calc', 'RLS T30 Cálculo de Larson') = 1,
  '(j2) fuzz: (calc no lanza y encuentra');
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'calc&', 'RLS T30 Cálculo de Larson') = 1,
  '(j2) fuzz: calc& no lanza y encuentra');
select pg_temp.assert(pg_temp.t30(:C30::uuid, '!calc', 'RLS T30 Cálculo de Larson') = 1,
  '(j2) fuzz: !calc no lanza y encuentra');
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'calc:*', 'RLS T30 Cálculo de Larson') = 1,
  '(j2) fuzz: calc:* no lanza y encuentra');
select pg_temp.assert(pg_temp.t30(:C30::uuid, 'calc\', 'RLS T30 Cálculo de Larson') = 1,
  '(j2) fuzz: calc\ no lanza y encuentra');

-- La mezcla, con un término real al final: la basura del head no lanza ni
-- estorba, y el último término sigue yendo con prefijo.
select pg_temp.assert(
  pg_temp.t30(:C30::uuid, '''&|!():*\ 😀 de la calc', 'RLS T30 Cálculo de Larson') = 1,
  '(j) fuzz: la mezcla de todo, con "calc" al final, encuentra "Cálculo de Larson"');

\echo ''
\echo '== T31 — validaciones del perfil: nombre (users_nombre_valido) =='
-- 20260927000469. Autocontenida: su propio `:N31`, con un correo de `tec.mx`
-- para que el trigger de alta le asigne universidad (no hace falta aquí, pero
-- es la fila que la app de verdad produce). Cada caso es un UPDATE del propio
-- `nombre` COMO `authenticated`, que es el camino real de "Completar perfil" y
-- "Editar perfil" — y `rechazo_de()` compara SQLSTATE y NOMBRE del constraint,
-- así que un rechazo por grant (42501) o por otro check no pasa por éste.
--
-- `pg_temp.rechazo_de()` está definida con los helpers del principio del archivo.
--
-- Los mismos casos corren en `scripts/probe-perfil.mjs` contra
-- `src/lib/validacion-perfil.ts`: ese es el amarre cliente ↔ base.
--
-- CONTROLES NEGATIVOS, uno a la vez contra la suite completa: ver la tabla de
-- CLAUDE.md §3 ("Y a N con las de T31").

\set N31 '''31313131-0000-0000-0000-000000003131'''

-- El alta va CAPTURADA y no como insert suelto, mismo recurso que :Z2 en T28:
-- el trigger de alta crea la fila de `users` con `nombre` NULL, así que un check
-- que rechazara NULL haría reventar este insert con el error crudo, lejos de la
-- aserción que lo explica. Capturado, cae en (e) con su nombre.
select pg_temp.rechazo_de(null, format(
  'insert into auth.users (id, instance_id, aud, role, email, encrypted_password, '
  || 'email_confirmed_at, created_at, updated_at) values (%L, %L, ''authenticated'', '
  || '''authenticated'', ''rls-t31@tec.mx'', '''', now(), now(), now())',
  :N31::uuid, '00000000-0000-0000-0000-000000000000')) as r_alta_n31 \gset

-- (e) NULL, en el camino real: la fila nace sin nombre (lo recibe en
-- "Completar perfil"), así que el check tiene que dejarla nacer.
select pg_temp.assert(
  :'r_alta_n31' = 'ok'
  and (select nombre is null from public.users where id = :N31::uuid),
  '(e) acepta NULL: el alta crea la fila de users sin nombre');

-- El UPDATE del propio nombre, como :N31. Devuelve 'ok' o '<sqlstate>:<constraint>'.
create or replace function pg_temp.t31_nombre(p_nombre text)
returns text language sql as $$
  select pg_temp.rechazo_de('31313131-0000-0000-0000-000000003131'::uuid, format(
    'update public.users set nombre = %L where id = %L',
    p_nombre, '31313131-0000-0000-0000-000000003131'))
$$;

-- (a)-(d) Acepta nombres de persona: acentos, ñ, ü, guion, apóstrofe.
select pg_temp.assert(pg_temp.t31_nombre('José Ñúñez') = 'ok',
  '(a) acepta "José Ñúñez" (acentos y ñ, mayúsculas incluidas)');
select pg_temp.assert(pg_temp.t31_nombre('María-José') = 'ok',
  '(b) acepta "María-José" (guion entre letras)');
select pg_temp.assert(pg_temp.t31_nombre('O''Connor') = 'ok',
  '(c) acepta "O''Connor" (apóstrofe recto entre letras)');
select pg_temp.assert(pg_temp.t31_nombre('Müller') = 'ok',
  '(d) acepta "Müller" (diéresis)');

-- (e2) Y volver a NULL por UPDATE también pasa: el check no puede exigir
-- nombre, o la fila de (e) no habría podido nacer.
select pg_temp.assert(pg_temp.t31_nombre(null) = 'ok',
  '(e2) acepta NULL también por UPDATE');

-- (f)-(l) Rechaza, cada uno por el MISMO constraint.
select pg_temp.assert(pg_temp.t31_nombre('Juan123') = '23514:users_nombre_valido',
  '(f) rechaza "Juan123" (dígitos)');
select pg_temp.assert(pg_temp.t31_nombre('Juan_') = '23514:users_nombre_valido',
  '(g) rechaza "Juan_" (símbolo fuera de la regla)');
select pg_temp.assert(pg_temp.t31_nombre('  Juan') = '23514:users_nombre_valido',
  '(h) rechaza "  Juan" (espacio al inicio: la base no normaliza)');
select pg_temp.assert(pg_temp.t31_nombre('Juan  Pérez') = '23514:users_nombre_valido',
  '(i) rechaza "Juan  Pérez" (espacio doble)');
select pg_temp.assert(pg_temp.t31_nombre('J') = '23514:users_nombre_valido',
  '(j) rechaza "J" (1 carácter; el mínimo es 2)');
select pg_temp.assert(pg_temp.t31_nombre(repeat('a', 51)) = '23514:users_nombre_valido',
  '(k) rechaza 51 caracteres (el máximo es 50)');
select pg_temp.assert(pg_temp.t31_nombre('Juan ' || chr(128512)) = '23514:users_nombre_valido',
  '(l) rechaza un emoji');

-- (m) Rechaza la forma NFD de "José" (e + acento combinante). No lo pidió la
-- regla por nombre: documenta que la base NO normaliza y por qué
-- `normalizarNombre()` pasa a NFC antes de guardar.
select pg_temp.assert(pg_temp.t31_nombre(normalize('José', nfd)) = '23514:users_nombre_valido',
  '(m) rechaza "José" en NFD (la base no normaliza; el cliente pasa a NFC)');

\echo ''
\echo '== T31 (cont.) — teléfono de cualquier país (users_telefono_e164) =='
-- 20260927000470. Mismo `:N31` y mismo camino: UPDATE del propio `telefono`
-- COMO `authenticated`. E.164 genérico (lada sin 0, 8-15 dígitos en total) y,
-- si la lada es +52, exactamente 10 después. La validación POR PAÍS no es de
-- la base (libphonenumber, en el cliente); el amarre es `scripts/probe-perfil.mjs`.

create or replace function pg_temp.t31_tel(p_tel text)
returns text language sql as $$
  select pg_temp.rechazo_de('31313131-0000-0000-0000-000000003131'::uuid, format(
    'update public.users set telefono = %L where id = %L',
    p_tel, '31313131-0000-0000-0000-000000003131'))
$$;

-- (n)-(p) Acepta: México como siempre, y dos ladas que antes se rechazaban.
select pg_temp.assert(pg_temp.t31_tel('+528112345678') = 'ok',
  '(n) acepta +52 con 10 dígitos');
select pg_temp.assert(pg_temp.t31_tel('+12025550123') = 'ok',
  '(o) acepta +1 con 10 dígitos (antes: rechazado por la lada)');
select pg_temp.assert(pg_temp.t31_tel('+34612345678') = 'ok',
  '(p) acepta +34 con 9 dígitos (antes: rechazado por la lada)');

-- (q)-(v) Rechaza, cada uno por el MISMO constraint.
select pg_temp.assert(pg_temp.t31_tel('+5281123456') = '23514:users_telefono_e164',
  '(q) rechaza +52 con 8 dígitos (México sigue estricto)');
-- 11 dígitos EXACTOS después del 52: la primera versión usaba
-- '+52811234567890', que tiene 12, y pasaba contra la variante "México acepta
-- 10 u 11" — o sea que no probaba lo que decía. Lo destapó su control negativo.
select pg_temp.assert(pg_temp.t31_tel('+5281123456789') = '23514:users_telefono_e164',
  '(r) rechaza +52 con 11 dígitos');
select pg_temp.assert(pg_temp.t31_tel('+0123456789') = '23514:users_telefono_e164',
  '(s) rechaza una lada que empieza con 0');
select pg_temp.assert(pg_temp.t31_tel('+52811234abcd') = '23514:users_telefono_e164',
  '(t) rechaza letras');
select pg_temp.assert(pg_temp.t31_tel('528112345678') = '23514:users_telefono_e164',
  '(u) rechaza sin +');
select pg_temp.assert(pg_temp.t31_tel('+1234567890123456') = '23514:users_telefono_e164',
  '(v) rechaza 16 dígitos (el máximo de E.164 es 15)');

\echo ''
\echo '== T32 — avisos nuevos del inbox: moderación, calificación, favorito vendido, avatar (RF-16) =='
-- 20260928000472 (enum) + 20260928000473 (productores). Autocontenida: siembra
-- sus propios usuarios y publicaciones y no reusa nada de secciones anteriores
-- (la moraleja de T16). Cada aserción cuenta los avisos de UNA publicación o
-- UN usuario y UN tipo, para que ningún otro productor la haga pasar.
--
-- Las transiciones de moderación corren como `postgres`: en la vida real las
-- escribe la Edge Function (supabaseAdmin) o Studio, y los dos saltan la RLS.
-- La acción y la comprobación van en SENTENCIAS DISTINTAS (lección de T28).
--
-- CONTROLES NEGATIVOS, uno a la vez contra la suite completa: ver la tabla de
-- CLAUDE.md §3 ("Y a N con las de T32").

\set D32  '''32323232-0000-0000-0000-0000000032d0'''
\set F32a '''32323232-0000-0000-0000-0000000032a1'''
\set F32b '''32323232-0000-0000-0000-0000000032b2'''
\set F32c '''32323232-0000-0000-0000-0000000032c3'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  (:D32::uuid,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-t32-d@tec.mx', '', now(), now(), now()),
  (:F32a::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-t32-a@tec.mx', '', now(), now(), now()),
  (:F32b::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-t32-b@tec.mx', '', now(), now(), now()),
  (:F32c::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-t32-c@tec.mx', '', now(), now(), now());

update public.users set nombre = 'Jorge' where id = :F32a::uuid;
update public.users set nombre = 'Diana' where id = :D32::uuid;

-- Una publicación por caso, con su título como llave. Todas llevan foto:
-- `listings_enforce_activation_has_photos` rechazaría pasar a `activa` sin
-- ella, y la aserción caería por el motivo equivocado (la foto load-bearing
-- de T20 (d)).
insert into public.listings (user_id, categoria_id, universidad_id, campus_id, titulo,
                             descripcion, precio, condicion, estado, veredicto_en_pantalla)
select :D32::uuid, 1, 1, 1, t, 'T32', 100, 'nuevo', e::public.listing_status, v
  from (values ('RLS T32 a', 'pendiente', false), ('RLS T32 b', 'pendiente', false),
               ('RLS T32 a2', 'activa', true),   ('RLS T32 a3', 'activa', true),
               ('RLS T32 a4', 'activa', true),   ('RLS T32 c', 'pendiente', false),
               ('RLS T32 d', 'pendiente', false), ('RLS T32 e', 'activa', false),
               ('RLS T32 f', 'pausada', false),  ('RLS T32 g', 'activa', false),
               ('RLS T32 h', 'bloqueada', false), ('RLS T32 Reseña', 'activa', false),
               ('RLS T32 vendida', 'activa', false), ('RLS T32 sin comprador', 'activa', false),
               ('RLS T32 pausar', 'activa', false)) as x(t, e, v);

insert into public.listing_photos (listing_id, storage_path, orden)
select id, id || '/t32.jpg', 0 from public.listings where user_id = :D32::uuid;

create or replace function pg_temp.t32(p_titulo text) returns bigint
language sql as $$
  select id from public.listings
   where user_id = '32323232-0000-0000-0000-0000000032d0' and titulo = p_titulo
$$;

-- Avisos de un tipo sobre una publicación.
create or replace function pg_temp.t32_n(p_titulo text, p_tipo text) returns bigint
language sql as $$
  select count(*) from public.notifications
   where listing_id = pg_temp.t32(p_titulo) and tipo::text = p_tipo
$$;

-- Avisos de un tipo para un usuario.
create or replace function pg_temp.t32_u(p_user uuid, p_tipo text) returns bigint
language sql as $$
  select count(*) from public.notifications where user_id = p_user and tipo::text = p_tipo
$$;

select pg_temp.assert(
  (select count(*) from public.listing_photos lp join public.listings l on l.id = lp.listing_id
    where l.user_id = :D32::uuid) = 15,
  'precondición: las 15 publicaciones de T32 existen y tienen foto');

-- --- Tipo 1: veredicto de moderación ------------------------------------

-- (a) El veredicto del alta, por el camino CLIENTE: la función pone
-- `veredicto_en_pantalla` en el MISMO update. El usuario lo está viendo.
update public.listings set estado = 'activa', veredicto_en_pantalla = true
 where id = pg_temp.t32('RLS T32 a');
select pg_temp.assert(pg_temp.t32_n('RLS T32 a', 'publicacion_aprobada') = 0,
  '(a) pendiente → activa con veredicto_en_pantalla (el alta, visto en pantalla): sin aviso');

-- (b) La resolución de Studio: no toca la columna.
update public.listings set estado = 'activa' where id = pg_temp.t32('RLS T32 b');
select pg_temp.assert(
  pg_temp.t32_n('RLS T32 b', 'publicacion_aprobada') = 1
  and (select titulo = 'Tu publicación ya está publicada'
              and cuerpo = '"RLS T32 b" pasó la revisión y ya es visible para otros estudiantes.'
              and user_id = :D32::uuid
         from public.notifications where listing_id = pg_temp.t32('RLS T32 b')),
  '(b) pendiente → activa resuelta en Studio: 1 aviso al dueño, con el copy del frame');

-- (a2) EL ESCENARIO de la revisión del plan: aprobada en el alta (true),
-- meses después el trigger de Storage la escala (la función escribe false) y
-- Studio la resuelve.
update public.listings set estado = 'pendiente', veredicto_en_pantalla = false
 where id = pg_temp.t32('RLS T32 a2');
update public.listings set estado = 'activa' where id = pg_temp.t32('RLS T32 a2');
select pg_temp.assert(pg_temp.t32_n('RLS T32 a2', 'publicacion_aprobada') = 1,
  '(a2) aprobada en el alta → escalada por una foto → resuelta a activa: SÍ avisa');

-- (a3) Lo mismo, resuelta a bloqueada.
update public.listings set estado = 'pendiente', veredicto_en_pantalla = false
 where id = pg_temp.t32('RLS T32 a3');
update public.listings set estado = 'bloqueada' where id = pg_temp.t32('RLS T32 a3');
select pg_temp.assert(
  pg_temp.t32_n('RLS T32 a3', 'publicacion_bloqueada') = 1
  and (select titulo from public.notifications
        where listing_id = pg_temp.t32('RLS T32 a3')) = 'Tu publicación no fue aprobada',
  '(a3) aprobada en el alta → escalada → resuelta a bloqueada: SÍ avisa, "no fue aprobada"');

-- (a4) Studio la manda a pendiente A MANO, sin tocar la columna (sigue true
-- del alta). La limpieza la baja y la resolución sí avisa.
update public.listings set estado = 'pendiente' where id = pg_temp.t32('RLS T32 a4');
select not veredicto_en_pantalla as limpia_a4 from public.listings
 where id = pg_temp.t32('RLS T32 a4') \gset
update public.listings set estado = 'activa' where id = pg_temp.t32('RLS T32 a4');
select pg_temp.assert(:'limpia_a4'::boolean and pg_temp.t32_n('RLS T32 a4', 'publicacion_aprobada') = 1,
  '(a4) entrar a pendiente sin mandar la columna la limpia, y la resolución avisa');

-- (c) pendiente → bloqueada resuelta en Studio.
update public.listings set estado = 'bloqueada' where id = pg_temp.t32('RLS T32 c');
select pg_temp.assert(
  pg_temp.t32_n('RLS T32 c', 'publicacion_bloqueada') = 1
  and (select cuerpo from public.notifications where listing_id = pg_temp.t32('RLS T32 c'))
      = '"RLS T32 c" no cumple con las reglas de la comunidad, así que no se publicó.',
  '(c) pendiente → bloqueada resuelta en Studio: 1 aviso, "no fue aprobada"');

-- (d) El bloqueo del alta, visto en "Publicación no aprobada".
update public.listings set estado = 'bloqueada', veredicto_en_pantalla = true
 where id = pg_temp.t32('RLS T32 d');
select pg_temp.assert(pg_temp.t32_n('RLS T32 d', 'publicacion_bloqueada') = 0,
  '(d) pendiente → bloqueada con veredicto_en_pantalla (el alta): sin aviso');

-- (x1) Un cliente no puede nacer con la columna en true: la fila nace
-- `pendiente` y la limpieza la baja.
select pg_temp.as_user(:D32::uuid, format(
  'insert into public.listings (user_id, categoria_id, universidad_id, campus_id, titulo, '
  || 'precio, condicion, estado, veredicto_en_pantalla) values '
  || '(%L, 1, 1, 1, ''RLS T32 x1'', 100, ''nuevo'', ''pendiente'', true)', :D32::uuid));
select pg_temp.assert(
  (select not veredicto_en_pantalla from public.listings where id = pg_temp.t32('RLS T32 x1')),
  '(x1) un insert de cliente con veredicto_en_pantalla = true queda en false');

-- (e) Ya publicada y bloqueada por una foto editada: nadie lo está mirando.
update public.listings set estado = 'bloqueada' where id = pg_temp.t32('RLS T32 e');
select pg_temp.assert(
  pg_temp.t32_n('RLS T32 e', 'publicacion_bloqueada') = 1
  and (select titulo from public.notifications
        where listing_id = pg_temp.t32('RLS T32 e')) = 'Retiramos tu publicación',
  '(e) activa → bloqueada: 1 aviso, "Retiramos tu publicación"');

-- (f) El dueño reactiva su pausada: no es un veredicto.
select pg_temp.as_user(:D32::uuid, format(
  'update public.listings set estado = ''activa'' where id = %s', pg_temp.t32('RLS T32 f')));
select pg_temp.assert(
  (select estado from public.listings where id = pg_temp.t32('RLS T32 f')) = 'activa'
  and pg_temp.t32_n('RLS T32 f', 'publicacion_aprobada') = 0,
  '(f) el dueño reactiva su pausada: sin aviso');

-- (g) La escalada a pendiente: se avisa su resolución, no la escalada.
update public.listings set estado = 'pendiente' where id = pg_temp.t32('RLS T32 g');
select pg_temp.assert(
  (select count(*) from public.notifications where listing_id = pg_temp.t32('RLS T32 g')) = 0,
  '(g) activa → pendiente: sin aviso');

-- (h) Studio re-guarda una bloqueada: el estado no cambió.
update public.listings set estado = 'bloqueada', titulo = 'RLS T32 h'
 where id = pg_temp.t32('RLS T32 h');
select pg_temp.assert(
  (select count(*) from public.notifications where listing_id = pg_temp.t32('RLS T32 h')) = 0,
  '(h) un update sin cambio de estado sobre una bloqueada: sin aviso');

-- --- Tipo 2: me calificaron ---------------------------------------------

-- :F32a contactó a la dueña, así que puede calificarla (can_rate()), y ella
-- a él.
insert into public.listing_contacts (user_id, listing_id)
values (:F32a::uuid, pg_temp.t32('RLS T32 Reseña'));

select pg_temp.as_user(:F32a::uuid, format(
  'insert into public.ratings (from_user_id, to_user_id, listing_id, estrellas, comentario) '
  || 'values (%L, %L, %s, 4, ''COMENTARIO-PRIVADO-T32'')',
  :F32a::uuid, :D32::uuid, pg_temp.t32('RLS T32 Reseña')));
select pg_temp.assert(
  pg_temp.t32_u(:D32::uuid, 'calificacion_recibida') = 1
  and (select titulo = 'Recibiste una calificación'
              and cuerpo = 'Jorge te dio 4 estrellas por "RLS T32 Reseña".'
         from public.notifications where user_id = :D32::uuid and tipo = 'calificacion_recibida'),
  '(i) crear una reseña avisa a quien la recibe, con las estrellas y el nombre');

select pg_temp.assert(
  (select position('COMENTARIO-PRIVADO' in cuerpo) = 0 from public.notifications
    where user_id = :D32::uuid and tipo = 'calificacion_recibida'),
  '(k) el aviso NUNCA incluye el comentario de la reseña');

select pg_temp.as_user(:F32a::uuid, format(
  'update public.ratings set estrellas = 5, comentario = ''otro'' '
  || 'where from_user_id = %L and listing_id = %s', :F32a::uuid, pg_temp.t32('RLS T32 Reseña')));
select pg_temp.assert(
  (select estrellas from public.ratings where from_user_id = :F32a::uuid
     and listing_id = pg_temp.t32('RLS T32 Reseña')) = 5
  and pg_temp.t32_u(:D32::uuid, 'calificacion_recibida') = 1,
  '(j) EDITAR la reseña no produce otro aviso');

select pg_temp.as_user(:D32::uuid, format(
  'insert into public.ratings (from_user_id, to_user_id, listing_id, estrellas) '
  || 'values (%L, %L, %s, 1)', :D32::uuid, :F32a::uuid, pg_temp.t32('RLS T32 Reseña')));
select pg_temp.assert(
  (select cuerpo from public.notifications
    where user_id = :F32a::uuid and tipo = 'calificacion_recibida')
    = 'Diana te dio 1 estrella por "RLS T32 Reseña".',
  '(i2) con 1 estrella el cuerpo va en singular');

-- --- Tipo 3: se vendió un favorito --------------------------------------

-- Tienen la publicación en favoritos: la dueña (la suya), :F32a, :F32b (que
-- será la compradora) y :F32c.
insert into public.favorites (user_id, listing_id)
select u, pg_temp.t32('RLS T32 vendida')
  from unnest(array[:D32::uuid, :F32a::uuid, :F32b::uuid, :F32c::uuid]) as u;
insert into public.listing_contacts (user_id, listing_id)
values (:F32b::uuid, pg_temp.t32('RLS T32 vendida')),
       (:F32c::uuid, pg_temp.t32('RLS T32 vendida'));

-- El orden del cliente (registrarVenta()): la venta PRIMERO, el estado después.
select pg_temp.as_user(:D32::uuid, format(
  'insert into public.listing_sales (listing_id, comprador_id) values (%s, %L)',
  pg_temp.t32('RLS T32 vendida'), :F32b::uuid));
select pg_temp.as_user(:D32::uuid, format(
  'update public.listings set estado = ''vendida'' where id = %s', pg_temp.t32('RLS T32 vendida')));

select pg_temp.assert(
  (select count(*) from public.notifications
    where listing_id = pg_temp.t32('RLS T32 vendida') and tipo = 'favorito_vendido'
      and user_id in (:F32a::uuid, :F32c::uuid)) = 2
  and (select cuerpo from public.notifications
        where listing_id = pg_temp.t32('RLS T32 vendida') and tipo = 'favorito_vendido'
          and user_id = :F32a::uuid)
      = '"RLS T32 vendida" ya se vendió y dejó de estar disponible.',
  '(l) marcar vendida avisa a cada uno de los que la tenían en favoritos');

select pg_temp.assert(
  (select count(*) from public.notifications where user_id = :F32b::uuid
     and listing_id = pg_temp.t32('RLS T32 vendida') and tipo = 'favorito_vendido') = 0
  and (select count(*) from public.notifications where user_id = :F32b::uuid
         and listing_id = pg_temp.t32('RLS T32 vendida') and tipo = 'compra_calificable') = 1,
  '(m) la compradora registrada NO recibe "se vendió" (recibe "Califica tu compra")');

select pg_temp.assert(
  (select count(*) from public.notifications where user_id = :D32::uuid
     and tipo = 'favorito_vendido') = 0,
  '(n) la dueña, con su propia publicación en favoritos, no se avisa a sí misma');

-- (p) Corregir a la compradora no es una venta nueva.
update public.listing_sales set comprador_id = :F32c::uuid
 where listing_id = pg_temp.t32('RLS T32 vendida');
select pg_temp.assert(pg_temp.t32_n('RLS T32 vendida', 'favorito_vendido') = 2,
  '(p) corregir a la compradora no vuelve a avisar "se vendió"');

-- (r) Un update sobre una ya vendida.
update public.listings set estado = 'vendida', precio = 90
 where id = pg_temp.t32('RLS T32 vendida');
select pg_temp.assert(pg_temp.t32_n('RLS T32 vendida', 'favorito_vendido') = 2,
  '(r) un update sin cambio de estado sobre una vendida no vuelve a avisar');

-- (o) "No fue a través de Relevo": sin fila de venta, les llega a todos
-- menos a la dueña.
insert into public.favorites (user_id, listing_id)
select u, pg_temp.t32('RLS T32 sin comprador')
  from unnest(array[:D32::uuid, :F32a::uuid, :F32b::uuid]) as u;
select pg_temp.as_user(:D32::uuid, format(
  'update public.listings set estado = ''vendida'' where id = %s',
  pg_temp.t32('RLS T32 sin comprador')));
select pg_temp.assert(
  (select count(*) from public.notifications
    where listing_id = pg_temp.t32('RLS T32 sin comprador') and tipo = 'favorito_vendido'
      and user_id in (:F32a::uuid, :F32b::uuid)) = 2
  and pg_temp.t32_n('RLS T32 sin comprador', 'favorito_vendido') = 2,
  '(o) sin comprador registrado: avisa a todos los que la tenían, menos a la dueña');

-- (q) Pausar no es vender.
insert into public.favorites (user_id, listing_id)
values (:F32a::uuid, pg_temp.t32('RLS T32 pausar'));
select pg_temp.as_user(:D32::uuid, format(
  'update public.listings set estado = ''pausada'' where id = %s', pg_temp.t32('RLS T32 pausar')));
select pg_temp.assert(
  (select count(*) from public.notifications where listing_id = pg_temp.t32('RLS T32 pausar')) = 0,
  '(q) pausar una publicación en favoritos: sin aviso');

-- --- Tipo 4: la moderación borró mi foto de perfil ------------------------

-- Las filas las escribe moderarAvatar() con supabaseAdmin; aquí, postgres.
insert into public.avatar_moderacion (user_id, storage_path, foto_url_nulificado)
values (:F32a::uuid, 'rls-t32/a.jpg', true);
select pg_temp.assert(
  pg_temp.t32_u(:F32a::uuid, 'avatar_eliminado') = 1
  and (select listing_id is null and titulo = 'Quitamos tu foto de perfil'
         from public.notifications where user_id = :F32a::uuid and tipo = 'avatar_eliminado'),
  '(s) un avatar borrado con foto_url nulificado avisa, sin publicación');

insert into public.avatar_moderacion (user_id, storage_path, foto_url_nulificado)
values (:F32b::uuid, 'rls-t32/b.jpg', false);
select pg_temp.assert(pg_temp.t32_u(:F32b::uuid, 'avatar_eliminado') = 0,
  '(t) si el guard de la carrera dejó el avatar vigente (no nulificado): sin aviso');

-- (u) El usuario quita su propia foto por API: no es moderación.
update public.users set foto_url = 'rls-t32/c.jpg' where id = :F32c::uuid;
select pg_temp.as_user(:F32c::uuid, format(
  'update public.users set foto_url = null where id = %L', :F32c::uuid));
select pg_temp.assert(
  (select foto_url is null from public.users where id = :F32c::uuid)
  and pg_temp.t32_u(:F32c::uuid, 'avatar_eliminado') = 0,
  '(u) poner la propia foto_url en null por API no produce el aviso');

-- --- El cliente sigue sin escribir notificaciones -------------------------

select pg_temp.assert(
  pg_temp.rechazo_de(:F32a::uuid, format(
    'insert into public.notifications (user_id, tipo, titulo, cuerpo) '
    || 'values (%L, ''avatar_eliminado'', ''x'', ''y'')', :F32a::uuid)) = '42501',
  '(v) authenticated NO puede insertar notificaciones, ni de los tipos nuevos');

select pg_temp.assert(
  pg_temp.rechazo_de(:F32a::uuid, format(
    'delete from public.notifications where user_id = %L', :F32a::uuid)) = '42501'
  and pg_temp.t32_u(:F32a::uuid, 'avatar_eliminado') = 1,
  '(w) authenticated NO puede borrar sus notificaciones');

\echo ''
\echo '== T33 — eliminar cuenta: qué se borra y qué se conserva anonimizado =='
-- 20260929000474. Autocontenida: siembra sus propios usuarios, publicaciones,
-- ventas, reseñas, reportes y avisos, y no reusa nada de secciones anteriores.
--
--   :K33 — la cuenta que se borra ("Kevinesco"). Vende una publicación a :C33,
--          compra una de :V33, califica y es calificado en las dos, reporta a
--          :V33 y es reportado por :R33.
--   :V33 — vendedor que le vendió a :K33.
--   :C33 — comprador de :K33.
--   :R33 — reporta a :K33 (usuario y publicación) y tiene en favoritos una
--          publicación de :K33 y otra de :V33.
--   :S33 / :A33 — una cuenta suspendida y una activa, para el hash de (k).
--
-- El borrado es `delete from auth.users` como `postgres`: lo mismo que hace
-- `auth.admin.deleteUser` (las cascadas hacen el resto). La acción y cada
-- comprobación van en SENTENCIAS DISTINTAS (lección de T28), y todo lo que se
-- compara después se guarda antes con `\gset`.
--
-- CONTROLES NEGATIVOS, uno a la vez contra la suite completa: ver la tabla de
-- CLAUDE.md §3 ("Y a N con las de T33").

\set K33 '''3a3a3a3a-0000-0000-0000-0000000033a0'''
\set V33 '''3a3a3a3a-0000-0000-0000-0000000033b0'''
\set C33 '''3a3a3a3a-0000-0000-0000-0000000033c0'''
\set R33 '''3a3a3a3a-0000-0000-0000-0000000033d0'''
\set S33 '''3a3a3a3a-0000-0000-0000-0000000033e0'''
\set A33 '''3a3a3a3a-0000-0000-0000-0000000033f0'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       e, '', now(), now(), now()
  from (values (:K33, 'rls-t33-k@tec.mx'), (:V33, 'rls-t33-v@tec.mx'),
               (:C33, 'rls-t33-c@tec.mx'), (:R33, 'rls-t33-r@tec.mx'),
               (:S33, 'rls-t33-s@tec.mx'), (:A33, 'rls-t33-a@tec.mx')) as x(u, e);

update public.users set nombre = 'Kevinesco' where id = :K33::uuid;
update public.users set nombre = 'Vera' where id = :V33::uuid;

insert into public.listings (user_id, categoria_id, universidad_id, campus_id, titulo,
                             descripcion, precio, condicion, estado)
values (:K33::uuid, 1, 1, 1, 'RLS T33 K vendida', 'T33', 500, 'nuevo', 'activa'),
       (:K33::uuid, 1, 1, 1, 'RLS T33 K fav',     'T33', 500, 'nuevo', 'activa'),
       (:V33::uuid, 1, 1, 1, 'RLS T33 V vendida', 'T33', 500, 'nuevo', 'activa'),
       (:V33::uuid, 1, 1, 1, 'RLS T33 V otra',    'T33', 500, 'nuevo', 'activa');

insert into public.listing_photos (listing_id, storage_path, orden)
select id, id || '/t33.jpg', 0 from public.listings where titulo like 'RLS T33 %';

select (select id from public.listings where titulo = 'RLS T33 K vendida') as l_kv,
       (select id from public.listings where titulo = 'RLS T33 K fav')     as l_kf,
       (select id from public.listings where titulo = 'RLS T33 V vendida') as l_vv,
       (select id from public.listings where titulo = 'RLS T33 V otra')    as l_vo \gset

-- Contactos y ventas, en el orden del cliente (la venta antes del estado).
insert into public.listing_contacts (user_id, listing_id)
values (:C33::uuid, :l_kv), (:K33::uuid, :l_vv);

select pg_temp.as_user(:K33::uuid, format(
  'insert into public.listing_sales (listing_id, comprador_id) values (%s, %L)', :l_kv, :C33::uuid));
select pg_temp.as_user(:K33::uuid, format(
  'update public.listings set estado = ''vendida'' where id = %s', :l_kv));
select pg_temp.as_user(:V33::uuid, format(
  'insert into public.listing_sales (listing_id, comprador_id) values (%s, %L)', :l_vv, :K33::uuid));
select pg_temp.as_user(:V33::uuid, format(
  'update public.listings set estado = ''vendida'' where id = %s', :l_vv));

-- Reseñas en las dos direcciones de las dos ventas. Las de :K33 llevan
-- comentario, que es lo que (a) comprueba que se borra.
select pg_temp.as_user(:K33::uuid, format(
  'insert into public.ratings (from_user_id, to_user_id, listing_id, estrellas, comentario) '
  || 'values (%L, %L, %s, 4, ''COMENTARIO-K33-a-C33'')', :K33::uuid, :C33::uuid, :l_kv));
select pg_temp.as_user(:C33::uuid, format(
  'insert into public.ratings (from_user_id, to_user_id, listing_id, estrellas) '
  || 'values (%L, %L, %s, 5)', :C33::uuid, :K33::uuid, :l_kv));
select pg_temp.as_user(:K33::uuid, format(
  'insert into public.ratings (from_user_id, to_user_id, listing_id, estrellas, comentario) '
  || 'values (%L, %L, %s, 2, ''COMENTARIO-K33-a-V33'')', :K33::uuid, :V33::uuid, :l_vv));
select pg_temp.as_user(:V33::uuid, format(
  'insert into public.ratings (from_user_id, to_user_id, listing_id, estrellas) '
  || 'values (%L, %L, %s, 1)', :V33::uuid, :K33::uuid, :l_vv));

-- Favoritos de :R33 y los avisos que producen los triggers REALES: una baja
-- de precio y una venta sin comprador sobre la publicación de :K33, y una
-- baja de precio sobre la de :V33 (la que debe sobrevivir, (g3)).
insert into public.favorites (user_id, listing_id) values (:R33::uuid, :l_kf), (:R33::uuid, :l_vo);
select pg_temp.as_user(:K33::uuid, format(
  'update public.listings set precio = 400 where id = %s', :l_kf));
select pg_temp.as_user(:V33::uuid, format(
  'update public.listings set precio = 400 where id = %s', :l_vo));

-- Reportes, antes de vender la favorita: :K33 reporta a :V33, :R33 reporta a
-- :K33 como usuario y a su publicación.
select pg_temp.as_user(:K33::uuid, format(
  'insert into public.reports (reporter_id, reported_user_id, motivo, comentario) '
  || 'values (%L, %L, ''otro'', ''COMENTARIO-REPORTE-K33'')', :K33::uuid, :V33::uuid));
select pg_temp.as_user(:R33::uuid, format(
  'insert into public.reports (reporter_id, reported_user_id, motivo) '
  || 'values (%L, %L, ''sospecha_fraude'')', :R33::uuid, :K33::uuid));
select pg_temp.as_user(:R33::uuid, format(
  'insert into public.reports (reporter_id, listing_id, motivo) '
  || 'values (%L, %s, ''spam_publicidad'')', :R33::uuid, :l_kf));

select pg_temp.as_user(:K33::uuid, format(
  'update public.listings set estado = ''vendida'' where id = %s', :l_kf));

-- Todo lo que se compara después del borrado, guardado ANTES.
select
  (select id from public.ratings where from_user_id = :K33::uuid and to_user_id = :C33::uuid) as r_kc,
  (select id from public.ratings where from_user_id = :K33::uuid and to_user_id = :V33::uuid) as r_kv,
  (select id from public.ratings where from_user_id = :C33::uuid and to_user_id = :K33::uuid) as r_ck,
  (select id from public.ratings where from_user_id = :V33::uuid and to_user_id = :K33::uuid) as r_vk,
  (select rating_promedio from public.users where id = :V33::uuid) as prom_v,
  (select rating_promedio from public.users where id = :C33::uuid) as prom_c,
  (select count(*) from public.ratings where to_user_id = :V33::uuid) as n_v,
  (select count(*) from public.ratings where to_user_id = :C33::uuid) as n_c,
  (select id from public.notifications
    where user_id = :R33::uuid and listing_id = :l_kf and tipo = 'precio_favorito') as n_pf,
  (select id from public.notifications
    where user_id = :R33::uuid and listing_id = :l_kf and tipo = 'favorito_vendido') as n_fv,
  (select id from public.notifications
    where user_id = :C33::uuid and listing_id = :l_kv and tipo = 'calificacion_recibida') as n_cr_c,
  (select id from public.notifications
    where user_id = :C33::uuid and listing_id = :l_kv and tipo = 'compra_calificable') as n_cc,
  (select id from public.notifications
    where user_id = :V33::uuid and listing_id = :l_vv and tipo = 'calificacion_recibida') as n_cr_v,
  (select id from public.notifications
    where user_id = :R33::uuid and listing_id = :l_vo and tipo = 'precio_favorito') as n_otra,
  (select id from public.reports where reporter_id = :K33::uuid) as rep_kv,
  (select id from public.reports where reporter_id = :R33::uuid and reported_user_id = :K33::uuid) as rep_rk,
  (select id from public.reports where reporter_id = :R33::uuid and listing_id = :l_kf) as rep_rl
\gset

select pg_temp.assert(
  (select count(*) from public.ratings where id in (:r_kc, :r_kv, :r_ck, :r_vk)) = 4
  and (select count(*) from public.notifications
        where id in (:n_pf, :n_fv, :n_cr_c, :n_cc, :n_cr_v, :n_otra)) = 6
  and (select count(*) from public.notifications
        where id in (:n_cr_c, :n_cc, :n_cr_v) and cuerpo like '%Kevinesco%') = 3
  and (select count(*) from public.reports where id in (:rep_kv, :rep_rk, :rep_rl)) = 3
  and (select reported_user_correo = 'rls-t33-k@tec.mx' from public.reports where id = :rep_rk),
  'precondición: 4 reseñas, 6 avisos (3 con el nombre de Kevinesco) y 3 reportes sembrados');

-- (i) ANTES del borrado: la anonimización solo la produce el borrado. Un
-- cliente no puede anular el autor de una reseña ni el reportante de un
-- reporte, así que no puede "anonimizarse" a medias.
--
-- Mira el PRIVILEGIO de columna además del comportamiento, y no es redundante:
-- medido con un `grant update (from_user_id)` puesto a mano, el update de
-- ratings SIGUE dando 42501, porque el `with check (from_user_id = auth.uid())`
-- de `ratings_update_own` lo rechaza también. Solo con el comportamiento, esta
-- aserción pasaba por la policy y no por el grant que dice vigilar.
select pg_temp.assert(
  not has_column_privilege('authenticated', 'public.ratings', 'from_user_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.reports', 'reporter_id', 'UPDATE')
  and pg_temp.rechazo_de(:C33::uuid, format(
    'update public.ratings set from_user_id = null where id = %s', :r_ck)) = '42501'
  and pg_temp.rechazo_de(:R33::uuid, format(
    'update public.reports set reporter_id = null where id = %s', :rep_rk)) = '42501',
  '(i) un cliente no puede anular from_user_id ni reporter_id (sin privilegio y rechazado)');

-- EL BORRADO.
delete from auth.users where id = :K33::uuid;

-- (a) Decisión 1: las reseñas que ESCRIBIÓ siguen, con sus estrellas, sin
-- autor y sin comentario. La de :C33 colgaba de SU publicación (con
-- listing_id en CASCADE habría desaparecido) y queda sin publicación; la de
-- :V33 cuelga de una publicación AJENA, que sigue existiendo, y la conserva.
select pg_temp.assert(
  (select count(*) from public.ratings
    where id = :r_kc and from_user_id is null and to_user_id = :C33::uuid
      and estrellas = 4 and comentario is null and listing_id is null) = 1
  and (select count(*) from public.ratings
        where id = :r_kv and from_user_id is null and to_user_id = :V33::uuid
          and estrellas = 2 and comentario is null and listing_id = :l_vv) = 1,
  '(a) las reseñas que escribió siguen, con estrellas, sin autor ni comentario');

-- (b) El promedio Y el conteo de quienes calificó no se mueven.
select pg_temp.assert(
  (select rating_promedio from public.users where id = :V33::uuid) = :prom_v
  and (select rating_promedio from public.users where id = :C33::uuid) = :prom_c
  and (select count(*) from public.ratings where to_user_id = :V33::uuid) = :n_v
  and (select count(*) from public.ratings where to_user_id = :C33::uuid) = :n_c,
  '(b) promedio y conteo de reseñas de los calificados quedan idénticos');

-- (c) Decisión 2: las que RECIBIÓ se borran con él.
select pg_temp.assert(
  (select count(*) from public.ratings where id in (:r_ck, :r_vk)) = 0,
  '(c) las reseñas que recibió se borran');

-- (d) Decisión 3: su compra se borra; la publicación del vendedor sigue vendida.
select pg_temp.assert(
  (select count(*) from public.listing_sales where listing_id = :l_vv) = 0
  and (select estado from public.listings where id = :l_vv) = 'vendida',
  '(d) su fila de comprador en listing_sales se borra y la publicación sigue vendida');

-- (e) Decisión 4: sus publicaciones y sus filas de fotos se borran (los
-- objetos de Storage los borra la Edge Function, probe-eliminar-cuenta.mjs).
select pg_temp.assert(
  (select count(*) from public.listings where id in (:l_kv, :l_kf)) = 0
  and (select count(*) from public.listing_photos where listing_id in (:l_kv, :l_kf)) = 0,
  '(e) sus publicaciones y sus listing_photos se borran');

-- (f) Decisión 5: el reporte que HIZO sigue, sin reportante. Su objetivo y su
-- texto quedan para moderación.
select pg_temp.assert(
  (select count(*) from public.reports
    where id = :rep_kv and reporter_id is null and reported_user_id = :V33::uuid
      and comentario = 'COMENTARIO-REPORTE-K33') = 1,
  '(f) el reporte que hizo sigue, con reporter_id NULL');

-- (g) Decisión 5: los reportes EN SU CONTRA siguen, sin su id ni su correo.
-- El de su publicación conserva el título (contenido, no identidad).
select pg_temp.assert(
  (select count(*) from public.reports
    where id = :rep_rk and reporter_id = :R33::uuid
      and reported_user_id is null and reported_user_correo is null) = 1
  and (select count(*) from public.reports
        where id = :rep_rl and reporter_id = :R33::uuid and listing_id is null
          and listing_titulo = 'RLS T33 K fav') = 1,
  '(g) los reportes en su contra siguen, sin reported_user_id ni el snapshot del correo');

-- (g2) Alcance ampliado del borrado de avisos. Cada grupo en su aserción, para
-- que su control negativo caiga en una sola.
select pg_temp.assert(
  (select count(*) from public.notifications where id in (:n_pf, :n_fv)) = 0,
  '(g2) los avisos ajenos con el TÍTULO de su publicación (precio_favorito, favorito_vendido) desaparecen');

select pg_temp.assert(
  (select count(*) from public.notifications where id in (:n_cr_c, :n_cc)) = 0,
  '(g2b) los avisos ajenos con su NOMBRE sobre su publicación (calificacion_recibida, compra_calificable) desaparecen');

select pg_temp.assert(
  (select count(*) from public.notifications where id = :n_cr_v) = 0,
  '(g2c) el calificacion_recibida que generó sobre una publicación AJENA desaparece');

-- (g3) Y no más: el aviso de :R33 sobre la publicación de :V33 sobrevive.
select pg_temp.assert(
  (select count(*) from public.notifications where id = :n_otra) = 1,
  '(g3) un aviso ajeno que no es de su cuenta sobrevive');

-- (h) El barrido: ni una columna uuid de `public` guarda su id, auth.users
-- tampoco, y ningún aviso lleva su nombre. Genérico a propósito: una tabla
-- nueva con una FK mal elegida cae aquí sin que nadie la agregue a la lista.
create or replace function pg_temp.t33_filas_con(p_uid uuid) returns bigint
language plpgsql as $$
declare
  c record;
  v_n bigint;
  v_total bigint := 0;
begin
  for c in select table_name, column_name from information_schema.columns
            where table_schema = 'public' and data_type = 'uuid'
              and table_name in (select table_name from information_schema.tables
                                  where table_schema = 'public' and table_type = 'BASE TABLE')
  loop
    execute format('select count(*) from public.%I where %I = $1', c.table_name, c.column_name)
      into v_n using p_uid;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end $$;

select pg_temp.assert(
  pg_temp.t33_filas_con(:K33::uuid) = 0
  and (select count(*) from auth.users where id = :K33::uuid) = 0
  and (select count(*) from public.notifications where cuerpo like '%Kevinesco%') = 0
  and (select count(*) from public.reports where reported_user_correo = 'rls-t33-k@tec.mx') = 0,
  '(h) ninguna fila de public ni de auth.users guarda su id, su nombre en avisos ni su correo');

-- (k) Evasión de suspensión: borrar una cuenta SUSPENDIDA deja el hash de su
-- correo; una ACTIVA no. El hook rechaza ese correo (normalizado igual que el
-- dominio) y sigue aceptando otro del mismo dominio. La otra mitad —que GoTrue
-- lo aplique con la policy de supabase_auth_admin— vive en probe-registro.mjs.
update public.users set estado = 'suspendido', suspendido_at = now(), suspension_motivo = 'fixture de prueba' where id = :S33::uuid;
delete from auth.users where id in (:S33::uuid, :A33::uuid);

select pg_temp.assert(
  (select count(*) from public.correos_bloqueados
    where correo_hash = sha256(convert_to('rls-t33-s@tec.mx', 'UTF8'))) = 1
  and (select count(*) from public.correos_bloqueados
        where correo_hash = sha256(convert_to('rls-t33-a@tec.mx', 'UTF8'))) = 0,
  '(k) borrar una cuenta suspendida guarda el hash de su correo; una activa no');

select pg_temp.assert(
  public.hook_before_user_created(
    jsonb_build_object('user', jsonb_build_object('email', '  RLS-T33-S@TEC.MX ')))
    = '{"error": {"http_code": 403, "message": "correo_bloqueado"}}'::jsonb
  and public.hook_before_user_created(
    jsonb_build_object('user', jsonb_build_object('email', 'rls-t33-a@tec.mx'))) = '{}'::jsonb,
  '(k2) el hook rechaza el correo bloqueado (mayúsculas/espacios incluidos) y acepta otro del dominio');

\echo ''
\echo '== T34 — intereses del usuario y recomendar_listings =='
-- 20260930000475. Autocontenida: su propia universidad (dominio `rls-t34.mx`)
-- con DOS campus, sus propios usuarios y sus propias publicaciones. Como
-- universidad AJENA usa la de `tec.mx`, que siembra seed.sql.
--
--   :A34 — el que recibe recomendaciones. Interés explícito en c1, contactó una
--          de c2, guardó una de c3 y guardó una de c4 hace 100 días (fuera de
--          la ventana). Publica UNA propia (c1, la más nueva) que nunca debe
--          verse en SUS recomendados.
--   :B34 — vendedor en la misma universidad. Tiene su propio interés (c2), y
--          publicaciones pausada/pendiente/bloqueada de c1 que, si se vieran,
--          saldrían primero.
--   :N34 — cold start: ninguna señal.
--   :X34 — vendedor de OTRA universidad (tec.mx), para el alcance "todo".
--
-- Los fixtures se insertan en un orden en que `id` y `created_at` NO
-- coinciden: si coincidieran, (f) y (h) no distinguirían "ordena por recencia"
-- de "ordena por id". Las acciones corren como `authenticated` (la RLS es
-- parte de lo que se prueba) y cada comprobación va en su propia sentencia.
--
-- CONTROLES NEGATIVOS, uno a la vez contra la suite completa: ver la tabla de
-- CLAUDE.md §3 ("Y a N con las de T34").

\set A34 '''34343434-0000-0000-0000-0000000034a0'''
\set B34 '''34343434-0000-0000-0000-0000000034b0'''
\set N34 '''34343434-0000-0000-0000-0000000034c0'''
\set X34 '''34343434-0000-0000-0000-0000000034d0'''

insert into public.universidades (nombre) values ('RLS T34 Universidad');
insert into public.universidad_dominios (dominio, universidad_id)
select 'rls-t34.mx', id from public.universidades where nombre = 'RLS T34 Universidad';
insert into public.campus (universidad_id, nombre, ciudad)
select id, c, 'Ciudad T34'
from public.universidades, unnest(array['RLS T34 Campus A', 'RLS T34 Campus B']) as c
where nombre = 'RLS T34 Universidad';

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       e, '', now(), now(), now()
  from (values (:A34, 'rls-t34-a@rls-t34.mx'), (:B34, 'rls-t34-b@rls-t34.mx'),
               (:N34, 'rls-t34-n@rls-t34.mx'), (:X34, 'rls-t34-x@tec.mx')) as x(u, e);

create temp table t34 as
select
  (select id from public.universidades where nombre = 'RLS T34 Universidad') as uni,
  (select id from public.campus where nombre = 'RLS T34 Campus A') as campus_a,
  (select id from public.campus where nombre = 'RLS T34 Campus B') as campus_b,
  (select min(c.id) from public.campus c
    join public.universidad_dominios d on d.universidad_id = c.universidad_id
   where d.dominio = 'tec.mx') as campus_ajeno,
  (select id from public.categories order by id limit 1 offset 0) as c1,
  (select id from public.categories order by id limit 1 offset 1) as c2,
  (select id from public.categories order by id limit 1 offset 2) as c3,
  (select id from public.categories order by id limit 1 offset 3) as c4,
  (select id from public.categories order by id limit 1 offset 4) as c5;
grant select on t34 to authenticated;

update public.users u
   set campus_id = case when u.id = :X34::uuid then t.campus_ajeno else t.campus_a end
  from t34 t
 where u.id in (:A34::uuid, :B34::uuid, :N34::uuid, :X34::uuid);

-- Como postgres: la policy de insert obliga a `pendiente`, y aquí hacen falta
-- `activa`/`pausada`/`bloqueada` y fechas fijas. El `order by v.n` fija el
-- orden de los ids (sin él, el join con `users` los reordena: medido, T1-T3
-- salieron al revés): X es la MÁS VIEJA pero la de menor id, y T1-T3
-- comparten `created_at` para que solo el `id` las desempate.
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, descripcion, precio, condicion, estado, created_at)
select v.dueno::uuid,
       case v.cat when 1 then t.c1 when 2 then t.c2 when 3 then t.c3 when 4 then t.c4 else t.c5 end,
       u.universidad_id,
       case v.lugar when 'a' then t.campus_a when 'b' then t.campus_b else t.campus_ajeno end,
       v.titulo, 'T34', 100, 'usado', v.estado::public.listing_status,
       now() - v.edad
  from t34 t,
       (values
         ( 1, :B34, 1, 'a', 'RLS T34 X',          'activa',    interval '30 days'),
         ( 2, :B34, 2, 'a', 'RLS T34 Y',          'activa',    interval '1 day'),
         ( 3, :B34, 3, 'a', 'RLS T34 Z',          'activa',    interval '2 hours'),
         ( 4, :B34, 4, 'a', 'RLS T34 W',          'activa',    interval '1 minute'),
         ( 5, :B34, 4, 'a', 'RLS T34 T1',         'activa',    interval '10 days'),
         ( 6, :B34, 4, 'a', 'RLS T34 T2',         'activa',    interval '10 days'),
         ( 7, :B34, 4, 'a', 'RLS T34 T3',         'activa',    interval '10 days'),
         ( 8, :B34, 1, 'a', 'RLS T34 pausada',    'pausada',   interval '1 second'),
         ( 9, :B34, 1, 'a', 'RLS T34 pendiente',  'pendiente', interval '1 second'),
         (10, :B34, 1, 'a', 'RLS T34 bloqueada',  'bloqueada', interval '1 second'),
         (11, :B34, 1, 'b', 'RLS T34 campus B',   'activa',    interval '1 second'),
         (12, :X34, 1, 'x', 'RLS T34 ajena',      'activa',    interval '1 second'),
         (13, :A34, 1, 'a', 'RLS T34 propia',     'activa',    interval '0 seconds'),
         (14, :B34, 5, 'a', 'RLS T34 V',          'activa',    interval '20 days'),
         (15, :B34, 5, 'a', 'RLS T34 pausada 2',  'pausada',   interval '1 second'),
         (16, :B34, 1, 'a', 'RLS T34 vendida',    'vendida',   interval '1 second'))
         as v(n, dueno, cat, lugar, titulo, estado, edad)
  join public.users u on u.id = v.dueno::uuid
 order by v.n;

-- Señales de :A34 (y un interés de :B34 para (a)-(c)).
insert into public.user_intereses (user_id, categoria_id)
select :A34::uuid, c1 from t34
union all select :B34::uuid, c2 from t34;
insert into public.listing_contacts (user_id, listing_id)
select :A34::uuid, id from public.listings where titulo = 'RLS T34 Y';
insert into public.favorites (user_id, listing_id, created_at)
select :A34::uuid, id, now() from public.listings where titulo = 'RLS T34 Z'
union all
select :A34::uuid, id, now() - interval '100 days' from public.listings where titulo = 'RLS T34 W'
union all
-- Un favorito RECIENTE sobre una pausada ajena de c5: por ser INVOKER, la
-- categoría de esa señal no se ve y c5 queda en 0 — lo prueba (d3).
select :A34::uuid, id, now() from public.listings where titulo = 'RLS T34 pausada 2';

select pg_temp.assert(
  (select count(*) from public.listings where titulo like 'RLS T34 %') = 16
  and (select c1 is not null and c5 is not null and campus_a is not null
              and campus_b is not null and campus_ajeno is not null from t34)
  and (select count(*) from public.users
        where id in (:A34::uuid, :B34::uuid, :N34::uuid)
          and universidad_id = (select uni from t34)) = 3
  and (select array_agg(titulo order by id) from public.listings
        where titulo in ('RLS T34 X', 'RLS T34 T1', 'RLS T34 T2', 'RLS T34 T3'))
      = array['RLS T34 X', 'RLS T34 T1', 'RLS T34 T2', 'RLS T34 T3'],
  'T34: fixtures completos (16 publicaciones, 5 categorías, 3 campus, universidad asignada, ids en orden)');

-- Lo que devuelve la función para `p_uid`, como una lista de títulos, EN EL
-- ORDEN EN QUE LA FUNCIÓN LOS EMITE (`with ordinality`), no en uno propio: la
-- primera versión reordenaba con su `string_agg(... order by puntaje, ...)` y
-- así (e2)/(f) solo probaban los puntajes, no el ORDER BY de la función
-- (medido: quitarle `created_at` al orden no lo cazaba ninguna de las dos).
-- El join con `listings` corre como authenticated; una fila que la función
-- devuelva y la RLS esconda sale como "RLS T34 OCULTA" en vez de perderse.
-- p_alcance: 'a' = campus A, 'u' = la universidad T34, 't' = todo.
create or replace function pg_temp.t34(p_uid uuid, p_alcance text, p_limit int default 50)
returns text language sql as $$
  select pg_temp.as_user_text(p_uid, format(
    'select string_agg(coalesce(l.titulo, ''RLS T34 OCULTA''), '','' order by r.ord)
       from public.recomendar_listings(p_campus_id => %s, p_universidad_id => %s, p_limit => %s)
            with ordinality as r(id, puntaje, created_at, ord)
       left join public.listings l on l.id = r.id
      where coalesce(l.titulo, ''RLS T34 OCULTA'') like ''RLS T34 %%''',
    case when p_alcance = 'a' then (select campus_a from t34)::text else 'null' end,
    case when p_alcance = 'u' then (select uni from t34)::text else 'null' end,
    p_limit))
$$;

-- Los ids de las cuatro ocultas de B, leídos como postgres: (d) los cuenta en la
-- salida CRUDA de la función, sin pasar por un join con `listings` que la RLS
-- filtraría por su cuenta (medido: con la función como DEFINER, la versión
-- que miraba títulos seguía en verde por ese join).
create temp table t34_ocultas as
select id from public.listings
 where titulo in ('RLS T34 pausada', 'RLS T34 pendiente', 'RLS T34 bloqueada', 'RLS T34 pausada 2');
grant select on t34_ocultas to authenticated;

-- Recorre TODAS las páginas de tamaño p_tam con el cursor de la última fila,
-- como lo hará el cliente, y devuelve los títulos en el orden recibido.
create or replace function pg_temp.t34_paginado(p_uid uuid, p_tam int)
returns text language plpgsql as $$
declare
  v_p int; v_c timestamptz; v_i bigint;
  v_out text := ''; v_n int; r record; v_vueltas int := 0;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  loop
    v_n := 0;
    for r in
      select x.id, x.puntaje, x.created_at, l.titulo
        from public.recomendar_listings((select campus_a from t34), null,
                                        v_p, v_c, v_i, p_tam) with ordinality as x(id, puntaje, created_at, ord)
        join public.listings l on l.id = x.id
       order by x.ord
    loop
      v_n := v_n + 1;
      v_out := v_out || r.titulo || ',';
      v_p := r.puntaje; v_c := r.created_at; v_i := r.id;
    end loop;
    v_vueltas := v_vueltas + 1;
    exit when v_n < p_tam or v_vueltas > 50;
  end loop;
  perform set_config('role', 'postgres', true);
  return rtrim(v_out, ',');
end $$;

-- (a)-(c2) user_intereses: cada quien ve y edita SOLO las suyas.
select pg_temp.assert(
  pg_temp.as_user_int(:A34::uuid, 'select count(*) from public.user_intereses') = 1
  and pg_temp.as_user_int(:A34::uuid, format(
        'select count(*) from public.user_intereses where user_id = %L', :B34)) = 0,
  '(a) A lee su interés y NO lee los de B');

select pg_temp.assert(
  pg_temp.rechazo_de(:A34::uuid, format(
    'insert into public.user_intereses (user_id, categoria_id) values (%L, %s)',
    :B34, (select c3 from t34))) = '42501',
  '(b) A no inserta un interés a nombre de B (42501)');

select pg_temp.assert(
  pg_temp.rechazo_de(:A34::uuid, format(
    'insert into public.user_intereses (user_id, categoria_id) values (%L, %s)',
    :A34, (select c3 from t34))) = 'ok',
  '(b2) A SÍ inserta uno propio (control: el rechazo de (b) es por el dueño)');
-- Se deshace (b2) para no mover el puntaje de c3 en (e2).
delete from public.user_intereses where user_id = :A34::uuid and categoria_id = (select c3 from t34);

-- (c) El DELETE va SIN `where`, a propósito: con un `where user_id = B`
-- Postgres aplica también la policy de SELECT a las filas que filtra, así que
-- afectaría 0 filas aunque la de DELETE fuera `using (true)` — medido, la
-- aserción pasaba por la policy equivocada. Sin `where` solo decide la de
-- DELETE. Borra también la fila propia de A, que se restaura enseguida.
select pg_temp.as_user(:A34::uuid, 'delete from public.user_intereses');
select pg_temp.assert(
  (select count(*) from public.user_intereses where user_id = :B34::uuid) = 1
  and (select count(*) from public.user_intereses where user_id = :A34::uuid) = 0,
  '(c) un DELETE sin filtro de A borra solo lo suyo: los intereses de B siguen');
insert into public.user_intereses (user_id, categoria_id) select :A34::uuid, c1 from t34;

select pg_temp.assert(
  not has_table_privilege('authenticated', 'public.user_intereses', 'update')
  and not exists (select 1 from information_schema.table_privileges
                   where table_schema = 'public' and table_name = 'user_intereses'
                     and grantee = 'anon')
  and not exists (select 1 from information_schema.column_privileges
                   where table_schema = 'public' and table_name = 'user_intereses'
                     and (grantee = 'anon'
                          or (grantee = 'authenticated' and privilege_type = 'UPDATE'))),
  '(c2) sin UPDATE para authenticated y sin un solo privilegio para anon');

-- (i) Alcance. Va PRIMERO entre las de la función: todas las demás leen
-- `p_limit => 50` del campus A, y sin el filtro de alcance ese corte se
-- llena con publicaciones de toda la suite (medido: (d3) leía NULL porque V
-- quedaba fuera del corte, y la variante caía ahí en vez de aquí).
select pg_temp.assert(
  position('campus B' in pg_temp.t34(:A34::uuid, 'a')) = 0
  and position('ajena' in pg_temp.t34(:A34::uuid, 'a')) = 0,
  '(i1) campus: ni el otro campus ni la otra universidad');
select pg_temp.assert(
  position('campus B' in pg_temp.t34(:A34::uuid, 'u')) > 0
  and position('ajena' in pg_temp.t34(:A34::uuid, 'u')) = 0,
  '(i2) universidad: incluye su otro campus, no la otra universidad');
select pg_temp.assert(
  position('campus B' in pg_temp.t34(:A34::uuid, 't')) > 0
  and position('ajena' in pg_temp.t34(:A34::uuid, 't')) > 0,
  '(i3) todo: incluye la otra universidad');

-- ORDEN DE LAS ASERCIONES, a propósito: las de presencia ((d), (g)) y
-- las de un solo puntaje ((e), (e3)) van ANTES de las de orden completo
-- ((f), (e2), (h)). La propia, la del campus B y la de la otra universidad
-- son de c1 y más nuevas que X, así que una variante que las dejara pasar
-- tumbaría primero a (e) y la aserción con su nombre nunca llegaría a correr.

-- (d) La RLS aplica DENTRO de la función (SECURITY INVOKER): las pausada,
-- pendiente y bloqueada de B son de c1 y las más nuevas, así que visibles
-- saldrían primero. (d2) es el control: son SUS filas y su dueño sí las lee
-- desde `listings`, así que (d) no pasa porque no existan.
select pg_temp.assert(
  pg_temp.as_user_int(:A34::uuid, format(
    'select count(*) from public.recomendar_listings(p_campus_id => %s)
      where id in (select id from t34_ocultas)', (select campus_a from t34))) = 0
  and (select count(*) from t34_ocultas) = 4,
  '(d) no devuelve pausadas, pendientes ni bloqueadas ajenas');
select pg_temp.assert(
  pg_temp.as_user_int(:B34::uuid,
    'select count(*) from public.listings where id in (select id from t34_ocultas)') = 4,
  '(d2) control: su dueño sí las ve en listings');

-- (d) tiene DOS candados sobre esas filas —el `estado = 'activa'` de la
-- función y la RLS— y ninguna variante de una sola pieza la tumba (medido:
-- con la función como DEFINER sigue en verde). Lo que distingue a un DEFINER
-- en su comportamiento es otra cosa, y la prueba (d3): leería las SEÑALES de
-- publicaciones que la RLS le esconde. A guardó hace un momento la pausada de
-- c5; invoker no ve esa publicación, así que c5 (la de V) sigue en 0.
select pg_temp.assert(
  pg_temp.as_user_int(:A34::uuid, format(
    'select r.puntaje from public.recomendar_listings(p_campus_id => %s) r
       join public.listings l on l.id = r.id where l.titulo = ''RLS T34 V''',
    (select campus_a from t34))) = 0,
  '(d3) un favorito sobre una publicación ajena oculta no da señal (INVOKER)');

-- (d4) Las VENDIDAS son públicas por RLS (el campus entero las ve), así que
-- ahí el ÚNICO candado es el `estado = 'activa'` de la función. La segunda
-- mitad es el control: A sí la lee en `listings`.
select pg_temp.assert(
  pg_temp.as_user_int(:A34::uuid, format(
    'select count(*) from public.recomendar_listings(p_campus_id => %s) r
       join public.listings l on l.id = r.id where l.titulo = ''RLS T34 vendida''',
    (select campus_a from t34))) = 0
  and pg_temp.as_user_int(:A34::uuid,
    'select count(*) from public.listings where titulo = ''RLS T34 vendida''') = 1,
  '(d4) no devuelve vendidas, que sí son visibles en listings');

-- (g) Las propias nunca aparecen, en ningún alcance. (g2) es el control: la
-- misma publicación SÍ le aparece a otro usuario.
select pg_temp.assert(
  position('propia' in coalesce(pg_temp.t34(:A34::uuid, 'a'), '')) = 0
  and position('propia' in coalesce(pg_temp.t34(:A34::uuid, 't'), '')) = 0,
  '(g) las publicaciones propias no aparecen');
select pg_temp.assert(
  position('propia' in pg_temp.t34(:N34::uuid, 'a')) > 0,
  '(g2) control: la misma publicación sí le aparece a otro usuario');

-- (e) Con interés en c1, X (c1) sale PRIMERO aunque sea la más vieja. Con
-- p_limit = 1 lo decide el ORDER BY + LIMIT de la función.
select pg_temp.assert(pg_temp.t34(:A34::uuid, 'a', 1) = 'RLS T34 X',
  '(e) con interés explícito en X, la de X sale primero aunque sea la más vieja');

-- (e3) El favorito de W tiene 100 días: fuera de la ventana, c4 vale 0.
select pg_temp.assert(
  pg_temp.as_user_int(:A34::uuid, format(
    'select r.puntaje from public.recomendar_listings(p_campus_id => %s) r
       join public.listings l on l.id = r.id where l.titulo = ''RLS T34 W''',
    (select campus_a from t34))) = 0,
  '(e3) una señal de hace 100 días no cuenta (ventana de 90)');

-- (f) Cold start: sin señales, puntaje 0 y el orden es recencia
-- (created_at, id) desc. Por id sería V,T3,T2,T1,W,Z,Y,X; por recencia es otro.
select pg_temp.assert(
  pg_temp.t34(:N34::uuid, 'a') = 'RLS T34 propia,RLS T34 W,RLS T34 Z,RLS T34 Y,RLS T34 T3,RLS T34 T2,RLS T34 T1,RLS T34 V,RLS T34 X'
  and pg_temp.as_user_int(:N34::uuid, format(
        'select max(puntaje) from public.recomendar_listings(p_campus_id => %s)',
        (select campus_a from t34))) = 0,
  '(f) sin señales, puntaje 0 y orden por recencia');

-- (e2) El orden COMPLETO con señales: X (interés), Y (contacto) antes que Z
-- (favorito) aunque Z sea más nueva, y luego W y T1-T3 (puntaje 0) por
-- recencia, con T1-T3 desempatadas por id.
select pg_temp.assert(
  pg_temp.t34(:A34::uuid, 'a') = 'RLS T34 X,RLS T34 Y,RLS T34 Z,RLS T34 W,RLS T34 T3,RLS T34 T2,RLS T34 T1,RLS T34 V',
  '(e2) orden: interés > contacto > favorito > sin señal, y recencia/id dentro de cada puntaje');

-- (h) Keyset: recorrer páginas de 2 da exactamente la lista completa, sin
-- duplicados ni saltos. T1-T3 empatan en (puntaje, created_at) y solo el `id`
-- las ordena: es lo que caza un cursor sin `id`.
select pg_temp.assert(
  pg_temp.t34_paginado(:A34::uuid, 2) = pg_temp.t34(:A34::uuid, 'a'),
  '(h) paginar de 2 en 2 con cursor reproduce la lista completa');

-- (j) Invariantes de la función. `proconfig is null` no es cosmético: una
-- cláusula SET impide el inlining (ver la migración).
select pg_temp.assert(
  (select not prosecdef and provolatile = 's' and proconfig is null
     from pg_proc
    where oid = 'public.recomendar_listings(bigint, bigint, integer, timestamptz, bigint, integer)'::regprocedure),
  '(j1) recomendar_listings es INVOKER, STABLE y sin SET');
select pg_temp.assert(
  has_function_privilege('authenticated',
    'public.recomendar_listings(bigint, bigint, integer, timestamptz, bigint, integer)', 'execute')
  and not has_function_privilege('anon',
    'public.recomendar_listings(bigint, bigint, integer, timestamptz, bigint, integer)', 'execute'),
  '(j2) EXECUTE solo para authenticated');

-- (k) Borrar la cuenta borra sus intereses (cascade desde auth.users).
select count(*) as t34_intereses_antes from public.user_intereses where user_id = :A34::uuid \gset
delete from auth.users where id = :A34::uuid;
select pg_temp.assert(
  :t34_intereses_antes = 1
  and (select count(*) from public.user_intereses where user_id = :A34::uuid) = 0,
  '(k) borrar la cuenta borra sus intereses');

\echo ''
\echo '== T35 — admins del panel: identidad, MFA y auditoría append-only (RF-17, Ola 1) =='
-- 20260930000477. Autocontenida: sus propias cuentas, ninguna de otra sección.
--
--   :A35 — admin activado (el que actúa).
--   :X35 — otro admin activado (objetivo que las RPCs rechazan, Paso 4).
--   :N35 — admin creado pero SIN activar (`activado_at` NULL).
--   :S35 — usuario del marketplace, no admin.
--   :K35 — admin cuya cuenta se borra en (k).
--   :L35 — admin al que se revoca en (l).
--   :U35 — usuario activo: objetivo de las guardas de motivo y de estado.
--   :V35 — vendedor activo: la publicación ajena que `:S35` contacta en (m).
--
-- Los rechazos se comparan como `sqlstate:mensaje` (`rechazo_aal`): todas las
-- guardas comparten 42501 y solo el mensaje dice cuál rechazó. `exigir_admin()`
-- se llama como `postgres` con los claims puestos (está revocada a
-- authenticated); `admin.sesion()`, como authenticated.
--
-- CONTROLES NEGATIVOS: ver la tabla de CLAUDE.md §3 ("Y a 406 con la Ola 1 de RF-17").

\set A35 '''35353535-0000-0000-0000-0000000035a0'''
\set X35 '''35353535-0000-0000-0000-0000000035b0'''
\set N35 '''35353535-0000-0000-0000-0000000035c0'''
\set S35 '''35353535-0000-0000-0000-0000000035d0'''
\set K35 '''35353535-0000-0000-0000-0000000035e0'''
\set L35 '''35353535-0000-0000-0000-0000000035f0'''
\set U35 '''35353535-0000-0000-0000-000000003510'''
\set V35 '''35353535-0000-0000-0000-000000003520'''

-- Universidad y dominio propios ANTES de las cuentas: `handle_new_user()` les
-- asigna la universidad desde el dominio, y sin ella `:S35`/`:V35` no podrían
-- tener publicaciones (FK publicación ↔ dueño, 20260924000466).
insert into public.universidades (nombre) values ('RLS T35 Universidad');
insert into public.universidad_dominios (dominio, universidad_id)
select 'rls-t35.mx', id from public.universidades where nombre = 'RLS T35 Universidad';
insert into public.campus (universidad_id, nombre, ciudad)
select id, 'RLS T35 Campus', 'Ciudad T35' from public.universidades
 where nombre = 'RLS T35 Universidad';

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       e, '', now(), now(), now()
  from (values (:A35, 'rls-t35-a@rls-t35.mx'), (:X35, 'rls-t35-x@rls-t35.mx'),
               (:N35, 'rls-t35-n@rls-t35.mx'), (:S35, 'rls-t35-s@rls-t35.mx'),
               (:K35, 'rls-t35-k@rls-t35.mx'), (:L35, 'rls-t35-l@rls-t35.mx'),
               (:U35, 'rls-t35-u@rls-t35.mx'), (:V35, 'rls-t35-v@rls-t35.mx')) as v(u, e);

insert into private.admins (user_id, nombre, activado_at)
values (:A35::uuid, 'Admin T35', now()),
       (:X35::uuid, 'Otro admin T35', now()),
       (:N35::uuid, 'Admin sin activar T35', null),
       (:K35::uuid, 'Admin borrado T35', now()),
       (:L35::uuid, 'Admin revocado T35', now());

select pg_temp.assert(
  (select count(*) from public.users where id in
     (:A35::uuid, :X35::uuid, :N35::uuid, :S35::uuid, :K35::uuid, :L35::uuid,
      :U35::uuid, :V35::uuid)
     and universidad_id = (select id from public.universidades
                            where nombre = 'RLS T35 Universidad')) = 8
  and (select count(*) from private.admins where user_id in
     (:A35::uuid, :X35::uuid, :N35::uuid, :K35::uuid, :L35::uuid)) = 5,
  'precondición T35: las 8 cuentas tienen perfil con la universidad de T35 y 5 son admins');

-- (b0) El camino feliz. Sin esta, un `is_admin()` que rechace SIEMPRE pasaría
-- todas las aserciones de rechazo de abajo.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
    'select private.exigir_admin()', true, false) = 'ok'
  and pg_temp.as_aal_text(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
    'select (admin.sesion()->>''es_admin'')') = 'true',
  '(b0) admin activado, aal2 y TOTP de hace 1 h → pasa, y sesion() dice es_admin');

-- (a0) Un usuario que no es admin, aunque tuviera aal2 con TOTP, recibe no_admin.
select pg_temp.assert(
  pg_temp.rechazo_aal(:S35::uuid, 'aal2', pg_temp.amr_totp(1),
    'select private.exigir_admin()', true, false) = '42501:no_admin',
  '(a0) un no-admin recibe no_admin');

-- (b) aal1 (solo contraseña) → mfa_requerido.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35::uuid, 'aal1',
    '[{"method":"password","timestamp":0}]'::jsonb
      || jsonb_build_array(jsonb_build_object('method', 'password',
           'timestamp', extract(epoch from now())::bigint)),
    'select private.exigir_admin()', true, false) = '42501:mfa_requerido'
  and pg_temp.as_aal_text(:A35::uuid, 'aal1', pg_temp.amr_totp(1),
    'select (admin.sesion()->>''es_admin'')') = 'false',
  '(b) aal1 recibe mfa_requerido, y sesion() no lo da por admin');

-- (c) Admin sin activar, con aal2 y TOTP recientes → no_admin. Es la ventana
-- entre crear la cuenta y el paso `activar` de crear-admin.mjs.
select pg_temp.assert(
  pg_temp.rechazo_aal(:N35::uuid, 'aal2', pg_temp.amr_totp(1),
    'select private.exigir_admin()', true, false) = '42501:no_admin'
  and pg_temp.as_aal_text(:N35::uuid, 'aal2', pg_temp.amr_totp(1),
    'select (admin.sesion()->>''es_admin'')') = 'false',
  '(c) admin con activado_at nulo recibe no_admin');

-- (d) TOTP de hace 13 h → totp_vencido (la ventana es de 12 h, D16).
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35::uuid, 'aal2', pg_temp.amr_totp(13),
    'select private.exigir_admin()', true, false) = '42501:totp_vencido'
  and pg_temp.as_aal_text(:A35::uuid, 'aal2', pg_temp.amr_totp(13),
    'select (admin.sesion()->>''totp_reciente'')') = 'false',
  '(d) TOTP de hace 13 h recibe totp_vencido');

-- (d2) D18: token SIN la clave `amr`, y con `"amr": null`. Rechazo LIMPIO
-- (42501 totp_vencido), no el `22023 cannot extract elements from a scalar`
-- que daría la forma con `coalesce`.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35::uuid, 'aal2', null,
    'select private.exigir_admin()', false, false) = '42501:totp_vencido'
  and pg_temp.rechazo_aal(:A35::uuid, 'aal2', null,
    'select private.exigir_admin()', true, false) = '42501:totp_vencido'
  and pg_temp.rechazo_aal(:A35::uuid, 'aal2', null,
    'select admin.sesion()', true, true) = 'ok',
  '(d2) sin amr y con amr: null → rechazo limpio 42501, no 22023');

-- (d3) Nota heredada: `amr` con timestamp basura, y con strings en vez de
-- objetos. Rechazo limpio, no el `22P02` del cast.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35::uuid, 'aal2',
    '[{"method":"totp","timestamp":"abc"}]'::jsonb,
    'select private.exigir_admin()', true, false) = '42501:totp_vencido'
  and pg_temp.rechazo_aal(:A35::uuid, 'aal2', '["totp"]'::jsonb,
    'select private.exigir_admin()', true, false) = '42501:totp_vencido',
  '(d3) amr con timestamp basura o con strings → rechazo limpio');

-- (i) APPEND-ONLY: UPDATE, DELETE y TRUNCATE sobre la auditoría lanzan, incluso
-- como `postgres`. Una fila sembrada a mano (la escritura normal es por
-- `private.auditar()`, que se prueba en el Paso 4).
insert into private.admin_acciones
  (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, antes, despues, motivo)
values (:A35::uuid, 'rls-t35-a@rls-t35.mx', 'suspender_usuario', 'usuario', :S35,
        '{"estado":"activo"}', '{"estado":"suspendido"}', 'fila de prueba T35');

-- Cada acción en su propia sentencia (`\gset`), no dentro del `assert`: un
-- TRUNCATE en la misma sentencia que el `count(*)` de abajo choca con la tabla
-- abierta (55006) antes de llegar al trigger, y la aserción mediría eso.
select pg_temp.rechazo_de(null, format(
  'update private.admin_acciones set motivo = ''otro'' where objetivo_id = %L', :S35))
  as t35_i_update \gset
select pg_temp.rechazo_de(null, format(
  'delete from private.admin_acciones where objetivo_id = %L', :S35))
  as t35_i_delete \gset
select pg_temp.rechazo_de(null, 'truncate private.admin_acciones') as t35_i_truncate \gset

select pg_temp.assert(
  :'t35_i_update' = '42501' and :'t35_i_delete' = '42501' and :'t35_i_truncate' = '42501'
  and (select count(*) from private.admin_acciones where objetivo_id = :S35) = 1,
  '(i) UPDATE, DELETE y TRUNCATE sobre admin_acciones lanzan, incluso como postgres');

-- (j) Lo que NO puede ir en `antes`/`despues` (D20): un correo, un valor
-- anidado y una clave permitida en OTRO tipo (`nombre` es de `universidad`).
-- Y el control positivo: la clave válida del tipo pasa.
select pg_temp.assert(
  pg_temp.rechazo_de(null, format($f$
    insert into private.admin_acciones
      (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, antes, motivo)
    values (%L, 'x', 'suspender_usuario', 'usuario', 'x', '{"correo":"a@b.mx"}', 'abc')$f$,
    :A35)) = '23514:admin_acciones_claves_ok'
  and pg_temp.rechazo_de(null, format($f$
    insert into private.admin_acciones
      (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, despues, motivo)
    values (%L, 'x', 'suspender_usuario', 'usuario', 'x', '{"estado":{"correo":"a@b.mx"}}', 'abc')$f$,
    :A35)) = '23514:admin_acciones_claves_ok'
  and pg_temp.rechazo_de(null, format($f$
    insert into private.admin_acciones
      (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, despues, motivo)
    values (%L, 'x', 'suspender_usuario', 'usuario', 'x', '{"nombre":"Juan"}', 'abc')$f$,
    :A35)) = '23514:admin_acciones_claves_ok'
  and pg_temp.rechazo_de(null, format($f$
    insert into private.admin_acciones
      (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, despues, motivo)
    values (%L, 'x', 'suspender_usuario', 'usuario', 'x',
            '{"estado":"suspendido","publicaciones_pausadas":2}', 'abc')$f$,
    :A35)) = 'ok',
  '(j) correo, valor anidado o clave de otro tipo en la auditoría → 23514; la válida pasa');

-- (j2) El motivo de la auditoría: 3-500 caracteres tras btrim, la misma regla
-- que las RPCs y que `users_suspension_motivo_valido`.
select pg_temp.assert(
  pg_temp.rechazo_de(null, format($f$
    insert into private.admin_acciones
      (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, motivo)
    values (%L, 'x', 'suspender_usuario', 'usuario', 'x', '    ')$f$,
    :A35)) = '23514:admin_acciones_motivo_valido'
  and pg_temp.rechazo_de(null, format($f$
    insert into private.admin_acciones
      (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, motivo)
    values (%L, 'x', 'suspender_usuario', 'usuario', 'x', %L)$f$,
    :A35, repeat('m', 501))) = '23514:admin_acciones_motivo_valido'
  and pg_temp.rechazo_de(null, format($f$
    insert into private.admin_acciones
      (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, motivo)
    values (%L, 'x', 'suspender_usuario', 'usuario', 'x', %L)$f$,
    :A35, '  ' || repeat('m', 500) || '  ')) = 'ok',
  '(j2) motivo en blanco o de 501 → 23514; 500 con espacios alrededor pasa');

-- (j3) `desactivar_admin` (20260930000479, sumada en la Ola 3) entra con las
-- claves del tipo `admin`, como la escribe `crear-admin.mjs desactivar`; una
-- acción fuera de la lista sigue rechazada. Las dos mitades cazan cosas
-- distintas: la primera, un CHECK sin la acción nueva; la segunda, un CHECK
-- que acepte cualquier texto.
select pg_temp.assert(
  pg_temp.rechazo_de(null, format($f$
    insert into private.admin_acciones
      (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, antes, despues, motivo)
    values ('00000000-0000-0000-0000-000000000000', 'script:crear-admin.mjs',
            'desactivar_admin', 'admin', %L,
            '{"activado_at":"2026-10-01T00:00:00Z"}', '{"activado_at":null}',
            'perdió el teléfono')$f$,
    :A35)) = 'ok'
  and pg_temp.rechazo_de(null, format($f$
    insert into private.admin_acciones
      (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, motivo)
    values (%L, 'x', 'desactivar', 'admin', 'x', 'abc')$f$,
    :A35)) = '23514:admin_acciones_accion_check',
  '(j3) desactivar_admin se audita; una acción fuera de la lista → 23514');

-- (k) Borrar la cuenta de un admin: su fila de `private.admins` se va (cascade
-- desde auth.users), su auditoría SE QUEDA (`admin_id` no lleva FK).
insert into private.admin_acciones
  (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, antes, despues, motivo)
values (:K35::uuid, 'rls-t35-k@rls-t35.mx', 'reactivar_usuario', 'usuario', :S35,
        '{"estado":"suspendido"}', '{"estado":"activo"}', 'fila de prueba T35 (k)');

select pg_temp.rechazo_de(null, format('delete from auth.users where id = %L', :K35))
  as t35_borrar_k \gset

select pg_temp.assert(
  :'t35_borrar_k' = 'ok'
  and not exists (select 1 from private.admins where user_id = :K35::uuid)
  and (select count(*) from private.admin_acciones where admin_id = :K35::uuid) = 1,
  '(k) borrar al admin de auth.users conserva su fila de auditoría');

-- (l) Revocar a un admin es BORRAR su fila, y surte efecto en la llamada
-- siguiente: con el MISMO token (aal2, TOTP reciente), antes pasa y después no.
select pg_temp.rechazo_aal(:L35::uuid, 'aal2', pg_temp.amr_totp(1),
  'select private.exigir_admin()', true, false) as t35_l_antes \gset
delete from private.admins where user_id = :L35::uuid;
select pg_temp.rechazo_aal(:L35::uuid, 'aal2', pg_temp.amr_totp(1),
  'select private.exigir_admin()', true, false) as t35_l_despues \gset

select pg_temp.assert(
  :'t35_l_antes' = 'ok'
  and :'t35_l_despues' = '42501:no_admin'
  and pg_temp.as_aal_text(:L35::uuid, 'aal2', pg_temp.amr_totp(1),
    'select (admin.sesion()->>''es_admin'')') = 'false',
  '(l) revocar (borrar la fila) surte efecto en la llamada siguiente con el mismo token');

-- ---------------------------------------------------------------------------
-- T35, segunda mitad: suspender / reactivar (20260930000478)
-- ---------------------------------------------------------------------------
--
-- Publicaciones de `:S35`, una por estado que importa, más la ajena de `:V35`
-- que `:S35` contacta en (m). Sembradas como postgres (la escritura normal
-- pasa por moderación; aquí interesa el estado de partida).

create temp table t35_l as
with ins as (
  insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                               titulo, precio, condicion, estado, updated_at)
  select v.dueno::uuid, 1, u.universidad_id,
         (select c.id from public.campus c where c.nombre = 'RLS T35 Campus'),
         v.titulo, 100, 'usado', v.estado::public.listing_status,
         now() - interval '3 days'
    from (values (:S35, 'RLS T35 activa con foto', 'activa'),
                 (:S35, 'RLS T35 activa sin foto', 'activa'),
                 (:S35, 'RLS T35 pausada previa',  'pausada'),
                 (:S35, 'RLS T35 vendida',         'vendida'),
                 (:S35, 'RLS T35 pendiente',       'pendiente'),
                 (:S35, 'RLS T35 bloqueada',       'bloqueada'),
                 (:V35, 'RLS T35 ajena de V',      'activa')) as v(dueno, titulo, estado)
    join public.users u on u.id = v.dueno::uuid
  returning id, titulo, estado, updated_at
)
select * from ins;

insert into public.listing_photos (listing_id, storage_path, orden)
select id, id || '/t35.jpg', 0 from t35_l where titulo = 'RLS T35 activa con foto';

select pg_temp.assert(
  (select count(*) from t35_l) = 7,
  'precondición T35 (suspensión): las 7 publicaciones sembradas');

-- (a) Un no-admin, aun con aal2 y TOTP recientes, recibe `no_admin` en CADA una
-- de las 4 RPCs de la Ola 1 (G1). Una por RPC: el control quita G1 de una sola.
select pg_temp.assert(
  pg_temp.rechazo_aal(:S35::uuid, 'aal2', pg_temp.amr_totp(1),
    'select * from admin.buscar_usuarios(''x'')') = '42501:no_admin'
  and pg_temp.rechazo_aal(:S35::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.detalle_usuario(%L)', :U35)) = '42501:no_admin'
  and pg_temp.rechazo_aal(:S35::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.suspender_usuario(%L, ''motivo válido'')', :U35)) = '42501:no_admin'
  and pg_temp.rechazo_aal(:S35::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.reactivar_usuario(%L, ''motivo válido'')', :U35)) = '42501:no_admin',
  '(a)/(r1) un no-admin recibe no_admin en buscar, detalle, suspender y reactivar');

-- (m), primera mitad: "JWT vivo". Con ESTOS claims (aal1, solo contraseña:
-- los de la app móvil), `:S35` todavía activo inserta un contacto y una
-- publicación `pendiente`. La segunda mitad, con los MISMOS claims, va
-- después de suspenderlo.
select pg_temp.rechazo_aal(:S35::uuid, 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'password',
                    'timestamp', extract(epoch from now())::bigint)),
  format('insert into public.listing_contacts (user_id, listing_id) values (%L, %s)',
         :S35, (select id from t35_l where titulo = 'RLS T35 ajena de V')))
  as t35_m_contacto_antes \gset
select pg_temp.rechazo_aal(:S35::uuid, 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'password',
                    'timestamp', extract(epoch from now())::bigint)),
  format($f$insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                                         titulo, precio, condicion, estado)
            select %L, 1, universidad_id, (select id from public.campus
                                            where nombre = 'RLS T35 Campus'),
                   'RLS T35 JWT vivo antes', 10, 'usado', 'pendiente'
              from public.users where id = %L$f$, :S35, :S35))
  as t35_m_publica_antes \gset

select pg_temp.assert(
  :'t35_m_contacto_antes' = 'ok' and :'t35_m_publica_antes' = 'ok',
  '(m) antes de suspender, los mismos claims contactan y publican');

-- (g0) Coherencia en los DOS sentidos, como postgres (lo que haría Studio):
-- suspendido sin fecha, y activo con un motivo colgando.
select pg_temp.assert(
  pg_temp.rechazo_de(null, format($f$update public.users set estado = 'suspendido',
      suspension_motivo = 'motivo válido' where id = %L$f$, :U35))
    = '23514:users_suspension_coherente'
  and pg_temp.rechazo_de(null, format($f$update public.users
      set suspension_motivo = 'motivo válido' where id = %L$f$, :U35))
    = '23514:users_suspension_coherente',
  '(g0) suspendido sin suspendido_at, o activo con motivo → 23514 users_suspension_coherente');

-- (g0b) La otra variante de "activo con UNA sola columna": solo
-- `suspendido_at`, sin motivo. La forma del plan en un solo sentido
-- (`(estado = 'suspendido') = (… and …)`) la deja pasar: `false = false`.
-- (g0) solo cubre la variante con el motivo; sin esta, esa forma débil pasaba
-- la suite con esta mitad abierta.
select pg_temp.assert(
  pg_temp.rechazo_de(null, format($f$update public.users
      set suspendido_at = now() where id = %L$f$, :U35))
    = '23514:users_suspension_coherente',
  '(g0b) activo con solo suspendido_at → 23514 users_suspension_coherente');

-- (g1) Motivo en blanco por la RPC → lo rechaza G2 de la función, ANTES de
-- tocar la fila (22023, no el 23514 del CHECK).
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.suspender_usuario(%L, ''   '')', :U35)) = '22023:motivo_invalido',
  '(g1) suspender con motivo en blanco → 22023 motivo_invalido (la función)');

-- (g2) El mismo motivo por UPDATE directo como postgres → el CHECK de la tabla.
select pg_temp.assert(
  pg_temp.rechazo_de(null, format($f$update public.users set estado = 'suspendido',
      suspendido_at = now(), suspension_motivo = '   ' where id = %L$f$, :U35))
    = '23514:users_suspension_motivo_valido',
  '(g2) motivo en blanco por UPDATE directo → 23514 users_suspension_motivo_valido');

-- (g3) 501 caracteres, por las dos vías.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.suspender_usuario(%L, %L)', :U35, repeat('m', 501)))
    = '22023:motivo_invalido'
  and pg_temp.rechazo_de(null, format($f$update public.users set estado = 'suspendido',
      suspendido_at = now(), suspension_motivo = %L where id = %L$f$, repeat('m', 501), :U35))
    = '23514:users_suspension_motivo_valido',
  '(g3) motivo de 501 caracteres → rechazado por la función y por el CHECK');

-- (h1) Un admin no se suspende a sí mismo. `:A35` también es admin, así que G4
-- lo rechazaría igual: por eso se compara el MENSAJE, no solo el SQLSTATE.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.suspender_usuario(%L, ''motivo válido'')', :A35))
    = '42501:no_sobre_si_mismo',
  '(h1) suspenderse a sí mismo → no_sobre_si_mismo');

-- (h2) Ni a otro admin: desde el panel, un admin no suspende a otro (revocar
-- es borrar su fila de private.admins).
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.suspender_usuario(%L, ''motivo válido'')', :X35))
    = '42501:objetivo_es_admin'
  and (select estado from public.users where id = :X35::uuid) = 'activo',
  '(h2) suspender a otro admin → objetivo_es_admin');

-- (e) Suspender de verdad. La acción en su propia sentencia y la comprobación
-- en otra (lección de T28).
select count(*) as t35_aud_antes from private.admin_acciones
 where accion = 'suspender_usuario' and objetivo_id = :S35 \gset

select pg_temp.as_aal_text(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
  format('select admin.suspender_usuario(%L, ''  Spam reiterado en el catálogo  '')', :S35))
  as t35_pausadas \gset

select pg_temp.assert(
  :'t35_pausadas' = '2'
  and (select estado from public.users where id = :S35::uuid) = 'suspendido'
  and (select suspendido_at is not null from public.users where id = :S35::uuid)
  and (select suspension_motivo from public.users where id = :S35::uuid)
      = 'Spam reiterado en el catálogo'
  and (select count(*) from public.listings l join t35_l t on t.id = l.id
        where t.titulo in ('RLS T35 activa con foto', 'RLS T35 activa sin foto')
          and l.estado = 'pausada') = 2
  and (select l.estado from public.listings l join t35_l t on t.id = l.id
        where t.titulo = 'RLS T35 vendida') = 'vendida'
  and (select l.estado from public.listings l join t35_l t on t.id = l.id
        where t.titulo = 'RLS T35 pendiente') = 'pendiente'
  and (select l.estado from public.listings l join t35_l t on t.id = l.id
        where t.titulo = 'RLS T35 bloqueada') = 'bloqueada'
  and (select l.updated_at = t.updated_at from public.listings l join t35_l t on t.id = l.id
        where t.titulo = 'RLS T35 pausada previa'),
  '(e) suspender: estado, fecha y motivo (con btrim); devuelve las 2 que pasaron de activa a pausada; vendida, pendiente, bloqueada y la pausada previa intactas');

-- (e2) Suspender a quien ya está suspendido → el CAS no escribe y LANZA.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.suspender_usuario(%L, ''otra vez'')', :S35))
    = '55000:estado_inesperado',
  '(e2) suspender a un suspendido → 55000 estado_inesperado');

-- (f) La auditoría, exacta: una fila más, del actor real, con solo las claves
-- permitidas y los valores de ESTA acción.
select pg_temp.assert(
  (select count(*) from private.admin_acciones
    where accion = 'suspender_usuario' and objetivo_id = :S35) = :t35_aud_antes + 1
  and (select jsonb_build_array(admin_id, admin_correo, objetivo_tipo, antes,
                                despues - 'suspendido_at', motivo)
         from private.admin_acciones
        where accion = 'suspender_usuario' and objetivo_id = :S35
        order by id desc limit 1)
      = jsonb_build_array(:A35::uuid, 'rls-t35-a@rls-t35.mx', 'usuario',
                          '{"estado":"activo"}'::jsonb,
                          '{"estado":"suspendido","publicaciones_pausadas":2}'::jsonb,
                          'Spam reiterado en el catálogo')
  and (select (despues->>'suspendido_at')::timestamptz from private.admin_acciones
        where accion = 'suspender_usuario' and objetivo_id = :S35
        order by id desc limit 1)
      = (select suspendido_at from public.users where id = :S35::uuid),
  '(f) la auditoría de suspender trae actor, antes y despues exactos');

-- (m), segunda mitad: los MISMOS claims de antes, ya suspendido. El JWT sigue
-- vivo, pero `is_active_user()` lee `users.estado` en cada request.
select pg_temp.rechazo_aal(:S35::uuid, 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'password',
                    'timestamp', extract(epoch from now())::bigint)),
  format('insert into public.listing_contacts (user_id, listing_id) values (%L, %s)',
         :S35, (select id from t35_l where titulo = 'RLS T35 ajena de V')))
  as t35_m_contacto_despues \gset
select pg_temp.rechazo_aal(:S35::uuid, 'aal1',
  jsonb_build_array(jsonb_build_object('method', 'password',
                    'timestamp', extract(epoch from now())::bigint)),
  format($f$insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                                         titulo, precio, condicion, estado)
            select %L, 1, universidad_id, (select id from public.campus
                                            where nombre = 'RLS T35 Campus'),
                   'RLS T35 JWT vivo después', 10, 'usado', 'pendiente'
              from public.users where id = %L$f$, :S35, :S35))
  as t35_m_publica_despues \gset

select pg_temp.assert(
  :'t35_m_contacto_despues' like '42501:new row violates row-level security policy%'
  and :'t35_m_publica_despues' like '42501:new row violates row-level security policy%',
  '(m) JWT vivo: después de suspender, los mismos claims ya no contactan ni publican');

-- (o), (o2), (o3) Los conteos de `detalle_usuario`, con publicaciones
-- sembradas DESPUÉS de suspender (el camino de la deuda `dueno_no_activo`,
-- Ola 4: algo que se activa con el dueño ya suspendido).
--
-- Desde 20261007000480 ese estado ya no se puede crear; estas filas son las
-- LEGACY (anteriores a …480, o de Studio antes del trigger), que
-- `detalle_usuario` tiene que seguir contando. Trigger apagado solo aquí.
alter table public.listings disable trigger listings_exige_dueno_activo_ins;
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
select :S35::uuid, 1, u.universidad_id,
       (select c.id from public.campus c where c.nombre = 'RLS T35 Campus'),
       v.t, 100, 'usado', 'activa'
  from public.users u,
       (values ('RLS T35 activa tardía con foto'), ('RLS T35 activa tardía sin foto')) as v(t)
 where u.id = :S35::uuid;
alter table public.listings enable trigger listings_exige_dueno_activo_ins;
insert into public.listing_photos (listing_id, storage_path, orden)
select id, id || '/t35.jpg', 0 from public.listings
 where titulo = 'RLS T35 activa tardía con foto';

select pg_temp.as_aal_text(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
  format('select admin.detalle_usuario(%L)::text', :S35)) as t35_detalle \gset

select pg_temp.assert(
  (:'t35_detalle'::jsonb->>'publicaciones_activas')::int = 2
  and (:'t35_detalle'::jsonb->>'estado') = 'suspendido'
  and (:'t35_detalle'::jsonb->>'correo') = 'rls-t35-s@rls-t35.mx',
  '(o) detalle_usuario cuenta solo las activas (2, sembradas tras suspender) y trae el correo (D8)');

select pg_temp.assert(
  (:'t35_detalle'::jsonb->>'activas_sin_foto')::int = 1,
  '(o2) activas_sin_foto cuenta solo las activas sin fila en listing_photos');

select pg_temp.assert(
  (:'t35_detalle'::jsonb->>'publicaciones_pendientes')::int = 2,
  '(o3) publicaciones_pendientes cuenta solo las pendiente (la sembrada y la de (m)), no las bloqueadas');

select pg_temp.assert(
  jsonb_array_length(:'t35_detalle'::jsonb->'auditoria') >= 1
  and (:'t35_detalle'::jsonb->'auditoria'->0->>'accion') = 'suspender_usuario',
  '(o4) detalle_usuario trae la auditoría del usuario, la más reciente primero');

-- (p) buscar_usuarios: encuentra por correo, lo trae, y un `%` tecleado es un
-- CARÁCTER, no un comodín (gotcha del comodín de búsqueda, CLAUDE.md §9).
select pg_temp.assert(
  pg_temp.as_aal_text(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
    'select string_agg(correo, '','') from admin.buscar_usuarios(''rls-t35-s@'')')
    = 'rls-t35-s@rls-t35.mx'
  and pg_temp.as_aal_text(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
    'select count(*)::text from admin.buscar_usuarios(''%'')') = '0'
  and pg_temp.as_aal_text(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
    'select count(*)::text from admin.buscar_usuarios(''rls_t35'')') = '0',
  '(p) buscar_usuarios encuentra por correo, y % y _ tecleados no son comodines');

-- (r2) Reactivar con motivo en blanco → G2 (22023), antes de tocar la fila.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.reactivar_usuario(%L, ''  '')', :S35)) = '22023:motivo_invalido'
  and (select estado from public.users where id = :S35::uuid) = 'suspendido',
  '(r2) reactivar con motivo en blanco → 22023 motivo_invalido');

-- (n) Reactivar: `activo`, las dos columnas en NULL, y NO despausa (decisión de
-- 20260917000457: la base no distingue quién pausó).
select pg_temp.rechazo_aal(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
  format('select admin.reactivar_usuario(%L, ''Apelación aceptada'')', :S35))
  as t35_reactivar \gset

select pg_temp.assert(
  :'t35_reactivar' = 'ok'
  and (select estado from public.users where id = :S35::uuid) = 'activo'
  and (select suspendido_at is null and suspension_motivo is null
         from public.users where id = :S35::uuid)
  and (select count(*) from public.listings l join t35_l t on t.id = l.id
        where t.titulo in ('RLS T35 activa con foto', 'RLS T35 activa sin foto')
          and l.estado = 'pausada') = 2
  and (select despues from private.admin_acciones
        where accion = 'reactivar_usuario' and objetivo_id = :S35
          and admin_id = :A35::uuid
        order by id desc limit 1) = '{"estado":"activo"}'::jsonb,
  '(n) reactivar pone activo, limpia las dos columnas, audita, y NO despausa');

-- (r3) Un admin suspendido por otra vía (Studio) no se reactiva a sí mismo.
-- Suspender no lo revoca (is_admin no mira users.estado), así que pasa G1 y es
-- G3 quien lo frena.
update public.users set estado = 'suspendido', suspendido_at = now(),
       suspension_motivo = 'suspendido desde Studio' where id = :A35::uuid;
select pg_temp.rechazo_aal(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
  format('select admin.reactivar_usuario(%L, ''me reactivo'')', :A35)) as t35_r3 \gset
select estado::text as t35_r3_estado from public.users where id = :A35::uuid \gset
update public.users set estado = 'activo', suspendido_at = null, suspension_motivo = null
 where id = :A35::uuid;

select pg_temp.assert(
  :'t35_r3' = '42501:no_sobre_si_mismo' and :'t35_r3_estado' = 'suspendido',
  '(r3) un admin suspendido desde Studio no se reactiva a sí mismo');

-- (r4) Pero OTRO admin sí lo reactiva: reactivar no lleva G4.
update public.users set estado = 'suspendido', suspendido_at = now(),
       suspension_motivo = 'suspendido desde Studio' where id = :X35::uuid;
select pg_temp.rechazo_aal(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
  format('select admin.reactivar_usuario(%L, ''error de Studio'')', :X35)) as t35_r4 \gset

select pg_temp.assert(
  :'t35_r4' = 'ok'
  and (select estado from public.users where id = :X35::uuid) = 'activo',
  '(r4) un admin reactiva a otro admin suspendido por otra vía');

-- (r5) Reactivar a quien está activo → el CAS no escribe y LANZA.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.reactivar_usuario(%L, ''motivo válido'')', :U35))
    = '55000:estado_inesperado',
  '(r5) reactivar a un activo → 55000 estado_inesperado');

-- (r6) Un uuid que no existe → P0002, en las dos RPCs (no el 55000 del CAS).
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
    'select admin.reactivar_usuario(''00000000-0000-0000-0000-0000000035ff'', ''motivo válido'')')
    = 'P0002:usuario_no_existe'
  and pg_temp.rechazo_aal(:A35::uuid, 'aal2', pg_temp.amr_totp(1),
    'select admin.suspender_usuario(''00000000-0000-0000-0000-0000000035ff'', ''motivo válido'')')
    = 'P0002:usuario_no_existe',
  '(r6) un uuid inexistente → P0002 usuario_no_existe al suspender y al reactivar');

\echo ''
\echo '== T36 — resolver el reporte de una cuenta eliminada (RF-17, Ola 0) =='
-- 20260930000476. Autocontenida: sus propias tres cuentas y sus dos reportes.
-- (T35 está reservada para la Ola 1 de RF-17, identidad y MFA del panel; T36
-- abre con esta corrección y la Ola 2 le suma el resto de los reportes.)
--
--   :R36 — reportó a :T36 y después ELIMINÓ su cuenta (reporter_id queda NULL).
--   :V36 — reportó a :T36 y sigue viva.
--   :T36 — el reportado.
--
-- El bug: `notify_report_resolved()` insertaba `new.reporter_id` en
-- `notifications.user_id` (NOT NULL), así que resolver el reporte de una cuenta
-- eliminada abortaba con 23502. Se mide corriendo el UPDATE COMO `postgres`
-- (lo que hará el panel a través de una RPC definer) y capturando el rechazo
-- con `rechazo_de(null, …)`: con un UPDATE suelto, la variante rota moriría con
-- el error crudo en vez de con el texto de la aserción (mismo recurso que
-- `:Z2` en T28). La acción y la comprobación van en sentencias distintas
-- (`\gset`), por la lección de T28.
--
-- CONTROLES NEGATIVOS, uno a la vez contra la suite completa y contra T36
-- aislada: ver la tabla de CLAUDE.md §3 ("Y a 362 con las de T36").

\set R36 '''36363636-0000-0000-0000-0000000036a0'''
\set V36 '''36363636-0000-0000-0000-0000000036b0'''
\set T36 '''36363636-0000-0000-0000-0000000036c0'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       e, '', now(), now(), now()
  from (values (:R36, 'rls-t36-r@rls-t36.mx'), (:V36, 'rls-t36-v@rls-t36.mx'),
               (:T36, 'rls-t36-t@rls-t36.mx')) as v(u, e);

insert into public.reports (reporter_id, reported_user_id, motivo)
values (:R36::uuid, :T36::uuid, 'spam_publicidad'),
       (:V36::uuid, :T36::uuid, 'spam_publicidad');

create temp table t36 as
select (select id from public.reports where reporter_id = :R36::uuid) as rep_borrada,
       (select id from public.reports where reporter_id = :V36::uuid) as rep_viva;

-- Precondición: el reporte existe y su reportante todavía no se borró.
select pg_temp.assert(
  (select count(*) from public.reports where reported_user_id = :T36::uuid) = 2
  and (select count(*) from public.reports where reporter_id = :R36::uuid) = 1,
  'T36: fixtures — dos reportes contra :T36, uno de :R36 aún con reportante');

delete from auth.users where id = :R36::uuid;

select pg_temp.assert(
  (select reporter_id from public.reports where id = (select rep_borrada from t36)) is null,
  'T36: fixtures — al borrar la cuenta el reporte se conserva con reporter_id NULL');

select count(*) as t36_avisos_antes
  from public.notifications where tipo = 'reporte_resuelto' \gset

-- (a) Resolver el reporte de la cuenta eliminada funciona, y no genera aviso.
select pg_temp.rechazo_de(null, format(
  'update public.reports set estado = ''resuelto'' where id = %s',
  (select rep_borrada from t36))) as t36_r_borrada \gset
select estado::text as t36_est_borrada
  from public.reports where id = (select rep_borrada from t36) \gset
select count(*) as t36_avisos_despues_a
  from public.notifications where tipo = 'reporte_resuelto' \gset

select pg_temp.assert(
  :'t36_r_borrada' = 'ok'
  and :'t36_est_borrada' = 'resuelto'
  and :t36_avisos_despues_a = :t36_avisos_antes,
  '(a) resolver el reporte de una cuenta eliminada funciona y no avisa a nadie');

-- (a2) El reporte de una cuenta VIVA sigue avisando (control de que el fix no
-- apagó el trigger entero: sin esta aserción, `when (false)` pasaría (a)).
select pg_temp.rechazo_de(null, format(
  'update public.reports set estado = ''descartado'' where id = %s',
  (select rep_viva from t36))) as t36_r_viva \gset

select pg_temp.assert(
  :'t36_r_viva' = 'ok'
  and (select count(*) from public.notifications
        where user_id = :V36::uuid and tipo = 'reporte_resuelto') = 1
  and (select cuerpo from public.notifications
        where user_id = :V36::uuid and tipo = 'reporte_resuelto')
        like '%No encontramos motivo para tomar acción.',
  '(a2) el reporte de una cuenta viva SÍ avisa (descartado → copy de descartado)');

\echo '== T35c — Storage: el admin lee las fotos de una publicación ajena (RF-17, Ola 2) =='
-- 20260930000479, sección 4: `listing_photos_objects_select_admin`. Autocontenida:
-- su propia universidad, su admin `:A35c` y el dueño `:S35c`, con una publicación
-- `pendiente` (invisible para cualquiera que no sea su dueño por
-- `listings_select`) y su objeto insertado como `postgres`, igual que T14.
--
-- QUÉ CUBRE Y QUÉ NO: las policies, con claims fabricados por `claims_aal`.
-- Que el servicio de Storage propague `aal`/`amr` por HTTP lo prueba
-- `scripts/probe-storage.mjs`.
--
-- Las (c)-(f) del plan (la policy del DUEÑO sobre una `bloqueada`) llegaron
-- con la Ola 4: sección "T35c (Ola 4)", más abajo.

\set A35c '''35c35c35-0000-0000-0000-00000000a35c'''
\set S35c '''35c35c35-0000-0000-0000-00000000535c'''

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', false, 5242880,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
values ('otro-bucket', 'otro-bucket', false)
on conflict (id) do nothing;

insert into public.universidades (nombre) values ('RLS T35c Universidad');
insert into public.universidad_dominios (dominio, universidad_id)
select 'rls-t35c.mx', id from public.universidades where nombre = 'RLS T35c Universidad';
insert into public.campus (universidad_id, nombre, ciudad)
select id, 'RLS T35c Campus', 'Ciudad T35c' from public.universidades
 where nombre = 'RLS T35c Universidad';

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       e, '', now(), now(), now()
  from (values (:A35c, 'rls-t35c-a@rls-t35c.mx'), (:S35c, 'rls-t35c-s@rls-t35c.mx')) as v(u, e);

insert into private.admins (user_id, nombre, activado_at)
values (:A35c::uuid, 'Admin T35c', now());

insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
select u.id, 1, u.universidad_id, c.id, 'RLS T35c pendiente', 50, 'nuevo', 'pendiente'
  from public.users u join public.campus c on c.universidad_id = u.universidad_id
 where u.id = :S35c::uuid;

select id || '/t35c.jpg' as t35c_obj
  from public.listings where titulo = 'RLS T35c pendiente' \gset

insert into storage.objects (bucket_id, name)
values ('listing-photos', :'t35c_obj'), ('otro-bucket', :'t35c_obj');

select pg_temp.assert(
  (select count(*) from storage.objects where name = :'t35c_obj') = 2
  and (select count(*) from private.admins where user_id = :A35c::uuid and activado_at is not null) = 1,
  'precondición T35c: el objeto existe en los dos buckets y :A35c es admin activado');

-- (a) El camino feliz: admin aal2 con TOTP de hace 1 h ve el objeto de una
-- `pendiente` ajena. Sin la policy de admin, `listing_photos_objects_select`
-- lo esconde (el `exists` sobre `listings` pasa por `listings_select`).
select pg_temp.assert(
  pg_temp.as_aal_text(:A35c::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select count(*) from storage.objects where bucket_id = %L and name = %L',
    'listing-photos', :'t35c_obj')) = '1',
  'T35c (a) un admin aal2 con TOTP reciente ve la foto de una pendiente ajena');

-- (a2) TOTP de hace 13 h: `is_admin()` exige uno de las últimas 12.
select pg_temp.assert(
  pg_temp.as_aal_text(:A35c::uuid, 'aal2', pg_temp.amr_totp(13), format(
    'select count(*) from storage.objects where bucket_id = %L and name = %L',
    'listing-photos', :'t35c_obj')) = '0',
  'T35c (a2) con el TOTP vencido (13 h) el admin ya no ve la foto');

-- (b) aal1 con el MISMO amr reciente: aísla la cláusula `aal`.
select pg_temp.assert(
  pg_temp.as_aal_text(:A35c::uuid, 'aal1', pg_temp.amr_totp(1), format(
    'select count(*) from storage.objects where bucket_id = %L and name = %L',
    'listing-photos', :'t35c_obj')) = '0',
  'T35c (b) con aal1 el admin no ve la foto');

-- (b2) La MISMA ruta en otro bucket privado: la policy de admin está acotada a
-- `listing-photos`. Sin el guard `bucket_id`, un admin leería cualquier bucket
-- que se agregue después.
select pg_temp.assert(
  pg_temp.as_aal_text(:A35c::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select count(*) from storage.objects where bucket_id = %L and name = %L',
    'otro-bucket', :'t35c_obj')) = '0',
  'T35c (b2) la policy de admin no abre otros buckets privados');

\echo '== T36 (Ola 2) — reportes y bloqueo desde el panel (RF-17) =='
-- 20260930000479, secciones 1-3. Autocontenida: universidad `rls-t36b.mx` y
-- sus propias cuentas; no reutiliza los fixtures de la primera mitad de T36.
--
--   :A36 — admin activado (actúa). También es dueño de una publicación y parte
--          de dos reportes: las guardas D-B2 de las dos RPCs que escriben.
--   :X36 — otro admin, dueño de una publicación (G4 de bloquear).
--   :S36 — vendedor (no admin): dueño de las publicaciones que se bloquean.
--   :P36, :O36 — reportantes vivos. :Q36 — reportante que ELIMINA su cuenta.
--   :U36 — usuario reportado. :D36 — reportado que ELIMINA su cuenta.
--   :C36 — comprador de la `vendida`.
--
-- Las acciones van como `authenticated` con claims aal2 + TOTP de hace 1 h
-- (`rechazo_aal`, que devuelve `sqlstate:mensaje`), y la comprobación del
-- estado en una sentencia aparte (`\gset`), por la lección de T28.
--
-- CONTROLES NEGATIVOS, uno a la vez contra la suite completa y contra esta
-- sección aislada: ver la tabla de CLAUDE.md §3.

\set A36 '''36b36b36-0000-0000-0000-00000000a036'''
\set X36 '''36b36b36-0000-0000-0000-00000000b036'''
\set S36 '''36b36b36-0000-0000-0000-00000000c036'''
\set P36 '''36b36b36-0000-0000-0000-00000000d036'''
\set O36 '''36b36b36-0000-0000-0000-00000000e036'''
\set Q36 '''36b36b36-0000-0000-0000-00000000f036'''
\set U36 '''36b36b36-0000-0000-0000-000000001036'''
\set D36 '''36b36b36-0000-0000-0000-000000002036'''
\set C36 '''36b36b36-0000-0000-0000-000000003036'''
\set MOT36 '''Revisado por la suite T36'''

insert into public.universidades (nombre) values ('RLS T36b Universidad');
insert into public.universidad_dominios (dominio, universidad_id)
select 'rls-t36b.mx', id from public.universidades where nombre = 'RLS T36b Universidad';
insert into public.campus (universidad_id, nombre, ciudad)
select id, 'RLS T36b Campus', 'Ciudad T36b' from public.universidades
 where nombre = 'RLS T36b Universidad';

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       e, '', now(), now(), now()
  from (values (:A36, 'rls-t36b-a@rls-t36b.mx'), (:X36, 'rls-t36b-x@rls-t36b.mx'),
               (:S36, 'rls-t36b-s@rls-t36b.mx'), (:P36, 'rls-t36b-p@rls-t36b.mx'),
               (:O36, 'rls-t36b-o@rls-t36b.mx'), (:Q36, 'rls-t36b-q@rls-t36b.mx'),
               (:U36, 'rls-t36b-u@rls-t36b.mx'), (:D36, 'rls-t36b-d@rls-t36b.mx'),
               (:C36, 'rls-t36b-c@rls-t36b.mx')) as v(u, e);

insert into private.admins (user_id, nombre, activado_at)
values (:A36::uuid, 'Admin T36b', now()),
       (:X36::uuid, 'Otro admin T36b', now());

-- El relleno va PRIMERO: así sus reportes tienen ids menores y la primera
-- página de `listar_reportes` (orden `id desc`, tope 100) trae los de la
-- sección. 101 reportes bastan para que (e) pida 10000 y deba recibir 100.
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
select u.id, 1, u.universidad_id, c.id, 'RLS T36b relleno ' || g, 10, 'nuevo', 'activa'
  from public.users u join public.campus c on c.universidad_id = u.universidad_id
 cross join generate_series(1, 101) g
 where u.id = :S36::uuid;

insert into public.reports (reporter_id, listing_id, motivo)
select :P36::uuid, l.id, 'otro'
  from public.listings l where l.titulo like 'RLS T36b relleno %';

insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
select v.uid, 1, u.universidad_id, c.id, v.titulo, 100, 'nuevo', v.estado::public.listing_status
  from (values (:S36::uuid, 'T36b pub',     'activa'),
               (:S36::uuid, 'T36b del',     'activa'),
               (:S36::uuid, 'T36b pend',    'pendiente'),
               (:S36::uuid, 'T36b act',     'activa'),
               (:S36::uuid, 'T36b paus',    'pausada'),
               (:S36::uuid, 'T36b vend',    'vendida'),
               (:S36::uuid, 'T36b bloq',    'bloqueada'),
               (:S36::uuid, 'T36b studio1', 'activa'),
               (:S36::uuid, 'T36b studio2', 'activa'),
               (:A36::uuid, 'T36b de A',    'activa'),
               (:X36::uuid, 'T36b de X',    'activa')) as v(uid, titulo, estado)
  join public.users u on u.id = v.uid
  join public.campus c on c.universidad_id = u.universidad_id;

create temp table t36b_l as
select (select id from public.listings where titulo = 'T36b pub')     as pub,
       (select id from public.listings where titulo = 'T36b del')     as del,
       (select id from public.listings where titulo = 'T36b pend')    as pend,
       (select id from public.listings where titulo = 'T36b act')     as act,
       (select id from public.listings where titulo = 'T36b paus')    as paus,
       (select id from public.listings where titulo = 'T36b vend')    as vend,
       (select id from public.listings where titulo = 'T36b bloq')    as bloq,
       (select id from public.listings where titulo = 'T36b studio1') as studio1,
       (select id from public.listings where titulo = 'T36b studio2') as studio2,
       (select id from public.listings where titulo = 'T36b de A')    as de_a,
       (select id from public.listings where titulo = 'T36b de X')    as de_x;

-- La `pendiente` se marca con `veredicto_en_pantalla = true` A PROPÓSITO:
-- `listings_limpia_veredicto_en_pantalla` la baja a false (compuerta medida en
-- B0), y es esa limpieza la que deja pasar la rama 1 del aviso de bloqueo. Sin
-- esta línea, (j1) pasaría aunque la limpieza no existiera. No se afirma aquí:
-- el control "sin la limpieza" tiene que caer en (j1), no en una precondición.
update public.listings set veredicto_en_pantalla = true where titulo = 'T36b pend';

-- La venta de la `vendida`: contacto primero (la regla de listing_sales).
insert into public.listing_contacts (user_id, listing_id)
select :C36::uuid, vend from t36b_l;
insert into public.listing_sales (listing_id, comprador_id)
select vend, :C36::uuid from t36b_l;

-- Dos fotos fuera de orden y dos evaluaciones para `detalle_listing` (k).
insert into public.listing_photos (listing_id, storage_path, orden)
select pub, pub || '/segunda.jpg', 1 from t36b_l
union all
select pub, pub || '/primera.jpg', 0 from t36b_l;
insert into public.listing_moderacion (listing_id, veredicto, estado_resultante, detalle, created_at)
select pub, 'limpio', 'activa'::public.listing_status, '{}'::jsonb, now() - interval '2 days' from t36b_l
union all
select pub, 'revisar', 'pendiente'::public.listing_status, '{}'::jsonb, now() - interval '1 day' from t36b_l;

insert into public.reports (reporter_id, listing_id, reported_user_id, motivo)
select v.rep, v.lid, v.uid, 'otro'
  from t36b_l l,
       lateral (values (:P36::uuid, l.pub,     null::uuid),
                       (:O36::uuid, l.pub,     null::uuid),
                       (:P36::uuid, null,      :U36::uuid),
                       (:O36::uuid, null,      :U36::uuid),
                       (:A36::uuid, null,      :U36::uuid),
                       (:Q36::uuid, null,      :U36::uuid),
                       (:P36::uuid, l.del,     null::uuid),
                       (:P36::uuid, null,      :D36::uuid),
                       (:P36::uuid, null,      :A36::uuid),
                       (:P36::uuid, l.studio1, null::uuid),
                       (:Q36::uuid, l.studio2, null::uuid),
                       (:P36::uuid, l.de_a,    null::uuid)) as v(rep, lid, uid);

create temp table t36b_r as
select (select id from public.reports where reporter_id = :P36::uuid and listing_id = (select pub from t36b_l)) as r_pub,
       (select id from public.reports where reporter_id = :P36::uuid and reported_user_id = :U36::uuid) as r_usr,
       (select id from public.reports where reporter_id = :Q36::uuid and reported_user_id = :U36::uuid) as r_sinrep,
       (select id from public.reports where reporter_id = :A36::uuid and reported_user_id = :U36::uuid) as r_de_admin,
       (select id from public.reports where reporter_id = :P36::uuid and reported_user_id = :A36::uuid) as r_contra_admin,
       (select id from public.reports where reporter_id = :P36::uuid and listing_id = (select del from t36b_l)) as r_ldel,
       (select id from public.reports where reporter_id = :P36::uuid and reported_user_id = :D36::uuid) as r_udel,
       (select id from public.reports where reporter_id = :P36::uuid and listing_id = (select studio1 from t36b_l)) as r_studio1,
       (select id from public.reports where reporter_id = :Q36::uuid and listing_id = (select studio2 from t36b_l)) as r_studio2,
       (select id from public.reports where reporter_id = :P36::uuid and listing_id = (select de_a from t36b_l)) as r_pub_de_admin;

-- Los dos objetivos eliminados y el reportante eliminado, por los caminos
-- reales: borrar la publicación y borrar las cuentas.
delete from public.listings where id = (select del from t36b_l);
delete from auth.users where id in (:D36::uuid, :Q36::uuid);

select r_pub, r_usr, r_sinrep, r_de_admin, r_contra_admin, r_ldel, r_udel, r_studio1, r_studio2,
       r_pub_de_admin
  from t36b_r \gset
select pub, pend, act, paus, vend, bloq, de_a, de_x from t36b_l \gset

select pg_temp.assert(
  (select count(*) from public.reports
    where id in (:r_pub, :r_usr, :r_sinrep, :r_de_admin, :r_contra_admin,
                 :r_ldel, :r_udel, :r_studio1, :r_studio2, :r_pub_de_admin)) = 10
  and (select reported_user_id is null from public.reports where id = :r_pub_de_admin)
  and (select listing_id is null and listing_titulo = 'T36b del' from public.reports where id = :r_ldel)
  and (select reported_user_id is null and reported_user_correo is null from public.reports where id = :r_udel)
  and (select reporter_id is null from public.reports where id = :r_sinrep)
  and (select reporter_id is null from public.reports where id = :r_studio2)
  and (select count(*) from public.reports where estado = 'pendiente') >= 101
  and (select count(*) from public.listing_sales where listing_id = :vend and comprador_id = :C36::uuid) = 1,
  'precondición T36 (Ola 2): los 10 reportes, los dos objetivos eliminados, el reportante eliminado, el relleno y la venta');

-- --- listar_reportes -----------------------------------------------------------

-- (b) Los 4 `objetivo_tipo`, ninguno escondido, más el reporte sin reportante.
-- Con `p_estado` NULL = todos.
select pg_temp.assert(
  pg_temp.as_aal_text(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select string_agg(objetivo_tipo, '','' order by array_position(array[%s, %s, %s, %s, %s]::bigint[], id))
       from admin.listar_reportes(null, null, 100) where id in (%s, %s, %s, %s, %s)',
    :r_pub, :r_usr, :r_sinrep, :r_ldel, :r_udel, :r_pub, :r_usr, :r_sinrep, :r_ldel, :r_udel))
  = 'publicacion,usuario,usuario,publicacion_eliminada,cuenta_eliminada',
  'T36 (b) listar_reportes devuelve los 4 objetivo_tipo y el reporte sin reportante');

-- (b2) `reportes_mismo_objetivo`: 2 sobre la publicación, 4 sobre :U36 (uno de
-- ellos de una cuenta eliminada) y NULL en los dos objetivos eliminados.
select pg_temp.assert(
  pg_temp.as_aal_text(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select string_agg(coalesce(reportes_mismo_objetivo::text, ''null''), '','' order by array_position(array[%s, %s, %s, %s]::bigint[], id))
       from admin.listar_reportes(null, null, 100) where id in (%s, %s, %s, %s)',
    :r_pub, :r_usr, :r_ldel, :r_udel, :r_pub, :r_usr, :r_ldel, :r_udel))
  = '2,4,null,null',
  'T36 (b2) reportes_mismo_objetivo cuenta por objetivo y es NULL en los eliminados');

-- (b5) `p_estado` fuera de la lista → 22023, también en la lectura.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1),
    'select count(*) from admin.listar_reportes(''abierto'')') = '22023:estado_invalido',
  'T36 (b5) listar_reportes rechaza un p_estado fuera de {pendiente, resuelto, descartado}');

-- (e) Tope: pedir 10000 devuelve 100. (e2) El cursor no repite ni salta.
select pg_temp.assert(
  pg_temp.as_aal_text(:A36::uuid, 'aal2', pg_temp.amr_totp(1),
    'select count(*) from admin.listar_reportes(null, null, 10000)') = '100',
  'T36 (e) p_limit = 10000 devuelve como máximo 100');

select pg_temp.as_aal_text(:A36::uuid, 'aal2', pg_temp.amr_totp(1),
  'select min(id) from admin.listar_reportes(null, null, 100)') as t36_min1 \gset
select pg_temp.assert(
  pg_temp.as_aal_text(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select (max(id) < %s and count(*) > 0)::text from admin.listar_reportes(null, %s, 100)',
    :t36_min1, :t36_min1)) = 'true',
  'T36 (e2) la segunda página empieza justo debajo de la primera');

-- --- resolver_reporte ----------------------------------------------------------

-- (gr) Un no-admin con aal2 y TOTP reciente: G1.
select pg_temp.assert(
  pg_temp.rechazo_aal(:S36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.resolver_reporte(%s, %L, %L)', :r_pub, 'resuelto', :MOT36)) = '42501:no_admin',
  'T36 (gr) un no-admin no resuelve reportes');

-- (d6) Motivo de 2 caracteres tras btrim: G2.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.resolver_reporte(%s, %L, %L)', :r_pub, 'resuelto', '  ab  ')) = '22023:motivo_invalido',
  'T36 (d6) resolver exige un motivo de 3 a 500 caracteres tras btrim');

-- (d2) `p_estado = 'pendiente'` y (d3) `p_estado` NULL: G2b, null-safe.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.resolver_reporte(%s, %L, %L)', :r_pub, 'pendiente', :MOT36)) = '22023:estado_invalido',
  'T36 (d2) resolver rechaza p_estado = pendiente');
select pg_temp.assert(
  pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.resolver_reporte(%s, null, %L)', :r_pub, :MOT36)) = '22023:estado_invalido',
  'T36 (d3) resolver rechaza p_estado NULL (la validación es null-safe)');

-- (d5) Un reporte que no existe: G5.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.resolver_reporte(%s, %L, %L)', 999999999, 'resuelto', :MOT36)) = 'P0002:reporte_no_existe',
  'T36 (d5) resolver un reporte inexistente → reporte_no_existe');

-- (g3r) El admin es parte del reporte, de los dos lados: G3.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.resolver_reporte(%s, %L, %L)', :r_de_admin, 'resuelto', :MOT36)) = '42501:no_sobre_si_mismo'
  and pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.resolver_reporte(%s, %L, %L)', :r_contra_admin, 'resuelto', :MOT36)) = '42501:no_sobre_si_mismo',
  'T36 (g3r) un admin no resuelve un reporte que hizo ni uno en su contra');

-- (g3r2) Ni uno sobre SU publicación. Es un caso aparte y no una tercera
-- condición de (g3r): `listing_id` y `reported_user_id` son excluyentes
-- (`reports_check`), así que el reporte de una publicación del admin tiene
-- `reported_user_id` NULL y la rama "reportado" de G3 no lo alcanza nunca.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.resolver_reporte(%s, %L, %L)', :r_pub_de_admin, 'resuelto', :MOT36)) = '42501:no_sobre_si_mismo',
  'T36 (g3r2) un admin no resuelve un reporte sobre su propia publicación');

-- (c1) Por la RPC, con reportante: la RPC no escribe `resolved_at`, la sella
-- el trigger.
select pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
  'select admin.resolver_reporte(%s, %L, %L)', :r_usr, 'resuelto', :MOT36)) as t36_c1 \gset
select (resolved_at is not null)::text as t36_c1_sellado, estado::text as t36_c1_estado
  from public.reports where id = :r_usr \gset
select pg_temp.assert(
  :'t36_c1' = 'ok' and :'t36_c1_estado' = 'resuelto' and :'t36_c1_sellado' = 'true',
  'T36 (c1) resolver por la RPC sella resolved_at');

-- (c2) Por la RPC, SIN reportante (cuenta eliminada): también se sella. Es la
-- cláusula `reporter_id is not null` del aviso, que el trigger NO copia.
select pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
  'select admin.resolver_reporte(%s, %L, %L)', :r_sinrep, 'descartado', :MOT36)) as t36_c2 \gset
select (resolved_at is not null)::text as t36_c2_sellado
  from public.reports where id = :r_sinrep \gset
select pg_temp.assert(
  :'t36_c2' = 'ok' and :'t36_c2_sellado' = 'true',
  'T36 (c2) resolver por la RPC un reporte sin reportante también sella resolved_at');

-- (c1b) Por UPDATE directo como `postgres` (la ruta de Studio), con reportante.
select set_config('role', 'postgres', true) as t36_rol \gset
update public.reports set estado = 'resuelto' where id = :r_studio1;
select (resolved_at is not null)::text as t36_c1b_sellado
  from public.reports where id = :r_studio1 \gset
select pg_temp.assert(
  :'t36_c1b_sellado' = 'true',
  'T36 (c1b) resolver por UPDATE directo (Studio) también sella resolved_at');

-- (c2b) Por UPDATE directo, SIN reportante.
update public.reports set estado = 'resuelto' where id = :r_studio2;
select (resolved_at is not null)::text as t36_c2b_sellado
  from public.reports where id = :r_studio2 \gset
select pg_temp.assert(
  :'t36_c2b_sellado' = 'true',
  'T36 (c2b) resolver por UPDATE directo un reporte sin reportante también sella resolved_at');

-- (c3) Volver a `pendiente` (solo Studio) limpia `resolved_at`.
update public.reports set estado = 'pendiente' where id = :r_studio1;
select (resolved_at is null)::text as t36_c3_limpio
  from public.reports where id = :r_studio1 \gset
select pg_temp.assert(
  :'t36_c3_limpio' = 'true',
  'T36 (c3) volver a pendiente deja resolved_at en NULL');

-- (d) Resolver lo ya resuelto: el CAS desde `pendiente` lanza.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.resolver_reporte(%s, %L, %L)', :r_usr, 'descartado', :MOT36)) = '55000:estado_inesperado',
  'T36 (d) resolver un reporte ya resuelto → estado_inesperado');

-- (b4) Sin `p_estado`, la lista es la de pendientes: el resuelto ya no sale.
select pg_temp.assert(
  pg_temp.as_aal_text(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select count(*) from admin.listar_reportes() where id = %s', :r_usr)) = '0'
  and pg_temp.as_aal_text(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select count(*) from admin.listar_reportes() where id = %s', :r_pub)) = '1',
  'T36 (b4) listar_reportes sin argumentos trae solo los pendientes');

-- (f) La auditoría de resolver: `antes` = {estado}, `despues` = {estado,
-- resolved_at}, con el valor que selló el trigger.
select pg_temp.assert(
  (select antes = '{"estado": "pendiente"}'::jsonb
      and (select array_agg(k order by k) from jsonb_object_keys(despues) k) = array['estado', 'resolved_at']
      and despues->>'estado' = 'resuelto'
      and (despues->>'resolved_at')::timestamptz = (select resolved_at from public.reports where id = :r_usr)
      and admin_id = :A36::uuid and motivo = :MOT36
     from private.admin_acciones
    where accion = 'resolver_reporte' and objetivo_tipo = 'reporte' and objetivo_id = :r_usr::text),
  'T36 (f) la auditoría de resolver trae solo estado y resolved_at');

-- --- bloquear_listing ----------------------------------------------------------

-- (g) Un no-admin: G1. (g2) Motivo inválido: G2. (g5) No existe: G5.
select pg_temp.assert(
  pg_temp.rechazo_aal(:S36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.bloquear_listing(%s, %L)', :act, :MOT36)) = '42501:no_admin',
  'T36 (g) un no-admin no bloquea publicaciones');
select pg_temp.assert(
  pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.bloquear_listing(%s, %L)', :act, '   ')) = '22023:motivo_invalido',
  'T36 (g2) bloquear exige un motivo de 3 a 500 caracteres tras btrim');
select pg_temp.assert(
  pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.bloquear_listing(%s, %L)', 999999999, :MOT36)) = 'P0002:listing_no_existe',
  'T36 (g5) bloquear una publicación inexistente → listing_no_existe');

-- (g3) Su propia publicación: G3. (g4) La de otro admin: G4.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.bloquear_listing(%s, %L)', :de_a, :MOT36)) = '42501:no_sobre_si_mismo',
  'T36 (g3) un admin no bloquea su propia publicación');
select pg_temp.assert(
  pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.bloquear_listing(%s, %L)', :de_x, :MOT36)) = '42501:objetivo_es_admin',
  'T36 (g4) un admin no bloquea la publicación de otro admin');

-- (h) Desde `bloqueada`: G6 lanza (D10, no hay desbloquear).
select pg_temp.assert(
  pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.bloquear_listing(%s, %L)', :bloq, :MOT36)) = '55000:estado_inesperado',
  'T36 (h) bloquear una publicación ya bloqueada → estado_inesperado');

-- (h1)-(h4) Desde cada estado de origen permitido. Cada uno en su sentencia y
-- su comprobación aparte: un solo assert con los cuatro diría "falló" sin
-- decir CUÁL origen.
select pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
  'select admin.bloquear_listing(%s, %L)', :pend, :MOT36)) as t36_h1 \gset
select estado::text as t36_h1_estado from public.listings where id = :pend \gset
select pg_temp.assert(:'t36_h1' = 'ok' and :'t36_h1_estado' = 'bloqueada',
  'T36 (h1) bloquear desde pendiente');

select pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
  'select admin.bloquear_listing(%s, %L)', :act, :MOT36)) as t36_h2 \gset
select estado::text as t36_h2_estado from public.listings where id = :act \gset
select pg_temp.assert(:'t36_h2' = 'ok' and :'t36_h2_estado' = 'bloqueada',
  'T36 (h2) bloquear desde activa');

select pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
  'select admin.bloquear_listing(%s, %L)', :paus, :MOT36)) as t36_h3 \gset
select estado::text as t36_h3_estado from public.listings where id = :paus \gset
select pg_temp.assert(:'t36_h3' = 'ok' and :'t36_h3_estado' = 'bloqueada',
  'T36 (h3) bloquear desde pausada');

select pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
  'select admin.bloquear_listing(%s, %L)', :vend, :MOT36)) as t36_h4 \gset
select estado::text as t36_h4_estado from public.listings where id = :vend \gset
select pg_temp.assert(:'t36_h4' = 'ok' and :'t36_h4_estado' = 'bloqueada',
  'T36 (h4) bloquear desde vendida');

-- (h5) Bloquear una vendida NO toca su venta.
select pg_temp.assert(
  (select count(*) from public.listing_sales where listing_id = :vend and comprador_id = :C36::uuid) = 1,
  'T36 (h5) bloquear una vendida conserva su listing_sales');

-- (i) La auditoría de bloquear trae SOLO `estado`, con el origen real.
select pg_temp.assert(
  (select antes = '{"estado": "activa"}'::jsonb and despues = '{"estado": "bloqueada"}'::jsonb
          and admin_id = :A36::uuid
     from private.admin_acciones
    where accion = 'bloquear_listing' and objetivo_tipo = 'listing' and objetivo_id = :act::text)
  and (select antes = '{"estado": "vendida"}'::jsonb
     from private.admin_acciones
    where accion = 'bloquear_listing' and objetivo_tipo = 'listing' and objetivo_id = :vend::text),
  'T36 (i) la auditoría de bloquear trae solo estado, con el origen real');

-- (j1)-(j4) El dueño recibe UN aviso `publicacion_bloqueada` desde cada origen,
-- con el título y el cuerpo exactos de 20260928000473:88-99. Desde
-- `pendiente` depende de que `listings_limpia_veredicto_en_pantalla` deje la
-- columna en false (compuerta medida en B0).
select pg_temp.assert(
  (select count(*) = 1
          and min(titulo) = 'Tu publicación no fue aprobada'
          and min(cuerpo) = '"T36b pend" no cumple con las reglas de la comunidad, así que no se publicó.'
     from public.notifications
    where user_id = :S36::uuid and listing_id = :pend and tipo = 'publicacion_bloqueada'),
  'T36 (j1) bloquear desde pendiente avisa al dueño: "no fue aprobada"');
select pg_temp.assert(
  (select count(*) = 1
          and min(titulo) = 'Retiramos tu publicación'
          and min(cuerpo) = '"T36b act" dejó de cumplir con las reglas de la comunidad y ya no es visible.'
     from public.notifications
    where user_id = :S36::uuid and listing_id = :act and tipo = 'publicacion_bloqueada'),
  'T36 (j2) bloquear desde activa avisa al dueño: "Retiramos tu publicación"');
select pg_temp.assert(
  (select count(*) = 1
          and min(titulo) = 'Retiramos tu publicación'
          and min(cuerpo) = '"T36b paus" dejó de cumplir con las reglas de la comunidad y ya no es visible.'
     from public.notifications
    where user_id = :S36::uuid and listing_id = :paus and tipo = 'publicacion_bloqueada'),
  'T36 (j3) bloquear desde pausada avisa al dueño: "Retiramos tu publicación"');
select pg_temp.assert(
  (select count(*) = 1
          and min(titulo) = 'Retiramos tu publicación'
          and min(cuerpo) = '"T36b vend" dejó de cumplir con las reglas de la comunidad y ya no es visible.'
     from public.notifications
    where user_id = :S36::uuid and listing_id = :vend and tipo = 'publicacion_bloqueada'),
  'T36 (j4) bloquear desde vendida avisa al dueño: "Retiramos tu publicación"');

-- --- detalle_listing -----------------------------------------------------------

-- (k) Cualquier estado, fotos por `orden`, historial completo con la más
-- reciente primero, y sus reportes.
select pg_temp.assert(
  pg_temp.as_aal_text(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select (d->>''estado'' = ''activa''
             and d->''dueno''->>''id'' = %L
             and d->''fotos''->>0 = %L
             and jsonb_array_length(d->''fotos'') = 2
             and jsonb_array_length(d->''moderacion'') = 2
             and d->''moderacion''->0->>''veredicto'' = ''revisar''
             and jsonb_array_length(d->''reportes'') = 2)::text
       from admin.detalle_listing(%s) d', :S36, :pub || '/primera.jpg', :pub)) = 'true',
  'T36 (k) detalle_listing trae la publicación, sus fotos en orden, todo su historial y sus reportes');

select pg_temp.assert(
  pg_temp.as_aal_text(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select d->>''estado'' from admin.detalle_listing(%s) d', :vend)) = 'bloqueada',
  'T36 (k1) detalle_listing ve una publicación bloqueada');

select pg_temp.assert(
  pg_temp.rechazo_aal(:S36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.detalle_listing(%s)', :pub)) = '42501:no_admin'
  and pg_temp.rechazo_aal(:A36::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select admin.detalle_listing(%s)', 999999999)) = 'P0002:listing_no_existe',
  'T36 (k2) detalle_listing rechaza a un no-admin y una publicación inexistente');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T35b — una publicación no pasa a activa si su dueño no está activo (RF-17, Ola 4) =='
-- 20261007000480. Autocontenida: sus propios `:D35b` (dueño que se suspende) y
-- `:E35b` (dueño activo), con universidad y campus de tec.mx (la 1/1 sembrada).
-- Las acciones corren como `postgres` a propósito: el trigger tiene que
-- alcanzar también a Studio y a `moderar-contenido`, que escriben elevados.
--
-- `rechazo_msg` devuelve `sqlstate:mensaje` (no `sqlstate:constraint` como
-- `rechazo_de`): aquí hay dos rechazos que se confunden en la misma
-- transición —el de este trigger y el de fotos de 20260909000447— y solo el
-- mensaje dice cuál fue.
create or replace function pg_temp.rechazo_msg(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $$;

\set D35b '''35b35b35-0000-0000-0000-00000035b0d0'''
\set E35b '''35b35b35-0000-0000-0000-00000035b0e0'''
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  (:D35b::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-d35b@tec.mx', '', now(), now(), now()),
  (:E35b::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-e35b@tec.mx', '', now(), now(), now());

-- Tres `pendiente` sembradas MIENTRAS los dos dueños están activos: con foto
-- de D, sin foto de D, y con foto de E. La foto es load-bearing (lección de
-- T20 (d)): sin ella, el rechazo de (a) vendría del trigger de fotos.
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
values
  (:D35b::uuid, 1, 1, 1, 'RLS T35b pendiente con foto', 100, 'usado', 'pendiente'),
  (:D35b::uuid, 1, 1, 1, 'RLS T35b pendiente sin foto', 100, 'usado', 'pendiente'),
  (:E35b::uuid, 1, 1, 1, 'RLS T35b pendiente activo',   100, 'usado', 'pendiente');
insert into public.listing_photos (listing_id, storage_path, orden)
select id, id || '/t35b.jpg', 0 from public.listings
 where titulo in ('RLS T35b pendiente con foto', 'RLS T35b pendiente activo');

select (select id from public.listings where titulo = 'RLS T35b pendiente con foto') as t35b_con,
       (select id from public.listings where titulo = 'RLS T35b pendiente sin foto') as t35b_sin,
       (select id from public.listings where titulo = 'RLS T35b pendiente activo')   as t35b_act
\gset

update public.users set estado = 'suspendido', suspendido_at = now(),
                        suspension_motivo = 'T35b: dueño suspendido'
 where id = :D35b::uuid;

select pg_temp.assert(
  (select count(*) from public.listings
    where user_id = :D35b::uuid and estado = 'pendiente') = 2,
  'precondición T35b: suspender no tocó las pendiente de :D35b');

-- (a) La transición que este trigger existe para cerrar, con foto: el único
-- motivo posible de rechazo es el dueño.
select pg_temp.rechazo_msg(format(
  'update public.listings set estado = ''activa'' where id = %s', :t35b_con)) as t35b_a \gset
select pg_temp.assert(
  :'t35b_a' = '55000:dueno_no_activo'
  and (select estado from public.listings where id = :t35b_con) = 'pendiente',
  'T35b (a) pendiente → activa con el dueño suspendido lanza 55000:dueno_no_activo, también como postgres');

-- (a2) El INSERT directo de una `activa` (Studio, service_role).
select pg_temp.rechazo_msg(format(
  'insert into public.listings (user_id, categoria_id, universidad_id, campus_id, titulo, precio, condicion, estado)
   values (%L, 1, 1, 1, ''RLS T35b insert activa'', 100, ''usado'', ''activa'')', :D35b)) as t35b_a2 \gset
select pg_temp.assert(
  :'t35b_a2' = '55000:dueno_no_activo'
  and not exists (select 1 from public.listings where titulo = 'RLS T35b insert activa'),
  'T35b (a2) insertar una activa de un dueño suspendido lanza 55000:dueno_no_activo');

-- (b) El control positivo: con el dueño activo, la misma transición pasa. Sin
-- él, un trigger que rechazara todo pasaría (a) y (a2).
select pg_temp.rechazo_msg(format(
  'update public.listings set estado = ''activa'' where id = %s', :t35b_act)) as t35b_b \gset
select pg_temp.assert(
  :'t35b_b' = 'ok'
  and (select estado from public.listings where id = :t35b_act) = 'activa',
  'T35b (b) con el dueño activo, pendiente → activa pasa');

-- (c) Una `activa` LEGACY de un suspendido (anterior a …480; se siembra con el
-- trigger de INSERT apagado) sigue aceptando los UPDATE que no cambian el
-- estado. Sin el `old.estado is distinct from new.estado`, abrir su Detalle
-- (increment_listing_view) y editarla desde Studio reventarían.
alter table public.listings disable trigger listings_exige_dueno_activo_ins;
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
values (:D35b::uuid, 1, 1, 1, 'RLS T35b legacy activa', 100, 'usado', 'activa');
alter table public.listings enable trigger listings_exige_dueno_activo_ins;
select id as t35b_leg from public.listings where titulo = 'RLS T35b legacy activa' \gset

-- La vista se CAPTURA con rechazo_de en vez de correr suelta con as_user: sin
-- el `old.estado is distinct from`, es justo esta llamada la que revienta, y
-- así cae aquí con el nombre de (c) en vez de con un error crudo.
select pg_temp.rechazo_de(:E35b::uuid,
  format('select public.increment_listing_view(%s)', :t35b_leg)) as t35b_c_vista \gset
select pg_temp.rechazo_msg(format(
  'update public.listings set estado = ''activa'', precio = 90 where id = %s', :t35b_leg)) as t35b_c \gset
select pg_temp.assert(
  :'t35b_c_vista' = 'ok'
  and :'t35b_c' = 'ok'
  and (select vistas_count from public.listings where id = :t35b_leg) = 1
  and (select precio from public.listings where id = :t35b_leg) = 90,
  'T35b (c) una activa legacy de un suspendido acepta vistas y updates que no cambian el estado');

-- (d) Dueño suspendido Y sin fotos: gana el trigger de fotos, que dispara
-- antes por orden alfabético (`…enforce_activation…` < `…exige_dueno…`).
-- Fija ese orden: si alguien renombra el trigger y lo adelanta, cae aquí.
select pg_temp.rechazo_msg(format(
  'update public.listings set estado = ''activa'' where id = %s', :t35b_sin)) as t35b_d \gset
select pg_temp.assert(
  :'t35b_d' = 'P0001:Una publicación no puede activarse sin fotos',
  'T35b (d) suspendido y sin fotos: el rechazo es el de fotos (orden de disparo)');

-- (e) FAIL-CLOSED: un dueño que no existe también lanza `dueno_no_activo`,
-- antes que la FK (el BEFORE corre primero). La forma `into v … <> 'activo'`
-- dejaría pasar el NULL y el error llegaría como 23503.
select pg_temp.rechazo_msg(
  'insert into public.listings (user_id, categoria_id, universidad_id, campus_id, titulo, precio, condicion, estado)
   values (''35b35b35-0000-0000-0000-0000000000ff'', 1, 1, 1, ''RLS T35b fantasma'', 100, ''usado'', ''activa'')') as t35b_e \gset
select pg_temp.assert(
  :'t35b_e' = '55000:dueno_no_activo',
  'T35b (e) una activa cuyo dueño no existe lanza 55000:dueno_no_activo, no 23503');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T35c (Ola 4) — el dueño de una bloqueada ya no ve ni escribe sus fotos (D5) =='
-- 20261007000481, sección 4. Autocontenida: universidad `rls-t35e.mx`, dueño
-- ACTIVO `:D35e` (el caso de D5 es justo el activo: un suspendido ya no escribe
-- por is_active_user()) y un tercero `:T35e`. Tres publicaciones del dueño:
-- `bloqueada`, `pendiente` y `activa`, cada una con su fila en `listing_photos` y
-- su objeto en el bucket, sembrados como `postgres` igual que T14.
--
-- `filas_como` ejecuta como authenticated y devuelve el ROW_COUNT, o el
-- SQLSTATE si lanza: aquí importa distinguir "0 filas" (filtrado por RLS, no
-- lanza) de "rechazo" (42501), y `as_user_int` no da el conteo de un DML.
-- Las de Storage ponen `storage.allow_delete_query`, como la Storage API: sin
-- él, `storage.protect_delete` (BEFORE por sentencia) lanza antes que la RLS y
-- la prueba pasaría por la razón equivocada.
create or replace function pg_temp.filas_como(p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare v_n int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('storage.allow_delete_query', 'true', true);
  perform set_config('role', 'authenticated', true);
  execute p_sql;
  get diagnostics v_n = row_count;
  perform set_config('role', 'postgres', true);
  perform set_config('storage.allow_delete_query', 'false', true);
  return v_n::text;
exception when others then
  perform set_config('role', 'postgres', true);
  perform set_config('storage.allow_delete_query', 'false', true);
  return sqlstate;
end $$;

\set D35e '''35e35e35-0000-0000-0000-00000000d35e'''
\set T35e '''35e35e35-0000-0000-0000-00000000735e'''

insert into public.universidades (nombre) values ('RLS T35e Universidad');
insert into public.universidad_dominios (dominio, universidad_id)
select 'rls-t35e.mx', id from public.universidades where nombre = 'RLS T35e Universidad';
insert into public.campus (universidad_id, nombre, ciudad)
select id, 'RLS T35e Campus', 'Ciudad T35e' from public.universidades
 where nombre = 'RLS T35e Universidad';

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       e, '', now(), now(), now()
  from (values (:D35e, 'rls-t35e-d@rls-t35e.mx'), (:T35e, 'rls-t35e-t@rls-t35e.mx')) as v(u, e);

insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
select u.id, 1, u.universidad_id, c.id, v.t, 50, 'nuevo', v.e::public.listing_status
  from public.users u join public.campus c on c.universidad_id = u.universidad_id,
       (values ('RLS T35e bloqueada', 'bloqueada'), ('RLS T35e pendiente', 'pendiente'),
               ('RLS T35e activa', 'activa')) as v(t, e)
 where u.id = :D35e::uuid;

select (select id from public.listings where titulo = 'RLS T35e bloqueada') as t35e_bloq,
       (select id from public.listings where titulo = 'RLS T35e pendiente') as t35e_pend,
       (select id from public.listings where titulo = 'RLS T35e activa')    as t35e_act
\gset

insert into public.listing_photos (listing_id, storage_path, orden)
values (:t35e_bloq, :t35e_bloq || '/a.jpg', 0), (:t35e_pend, :t35e_pend || '/a.jpg', 0),
       (:t35e_act, :t35e_act || '/a.jpg', 0);
insert into storage.objects (bucket_id, name)
values ('listing-photos', :t35e_bloq || '/a.jpg'), ('listing-photos', :t35e_pend || '/a.jpg'),
       ('listing-photos', :t35e_act || '/a.jpg');

select pg_temp.assert(
  (select count(*) from public.listing_photos
    where listing_id in (:t35e_bloq, :t35e_pend, :t35e_act)) = 3
  and (select count(*) from storage.objects
        where name in (:t35e_bloq || '/a.jpg', :t35e_pend || '/a.jpg', :t35e_act || '/a.jpg')) = 3,
  'precondición T35c (Ola 4): 3 publicaciones del dueño, cada una con su fila y su objeto');

-- (c) El objeto de su BLOQUEADA ya no lo ve el dueño (la condición portante).
select pg_temp.assert(
  pg_temp.as_user_int(:D35e::uuid, format(
    'select count(*) from storage.objects where bucket_id = ''listing-photos'' and name = %L',
    :t35e_bloq || '/a.jpg')) = 0,
  'T35c (c) el dueño NO ve el objeto de su bloqueada');

-- (d) Los de su PENDIENTE y su ACTIVA, sí. Sin esto, una condición escrita como
-- `not in ('pendiente','bloqueada')` pasaría (c) escondiéndole de más.
select pg_temp.assert(
  pg_temp.as_user_int(:D35e::uuid, format(
    'select count(*) from storage.objects where bucket_id = ''listing-photos'' and name in (%L, %L)',
    :t35e_pend || '/a.jpg', :t35e_act || '/a.jpg')) = 2,
  'T35c (d) el dueño SÍ ve los objetos de su pendiente y de su activa');

-- (e) Un tercero no ve la `pendiente` (listings_select la esconde) y sí la activa.
select pg_temp.assert(
  pg_temp.as_user_int(:T35e::uuid, format(
    'select count(*) from storage.objects where bucket_id = ''listing-photos'' and name = %L',
    :t35e_pend || '/a.jpg')) = 0
  and pg_temp.as_user_int(:T35e::uuid, format(
    'select count(*) from storage.objects where bucket_id = ''listing-photos'' and name = %L',
    :t35e_act || '/a.jpg')) = 1,
  'T35c (e) un tercero no ve el objeto de una pendiente ajena y sí el de una activa');

-- (f) La tabla espejea: sin filas de la bloqueada para su dueño, con las otras dos.
select pg_temp.assert(
  pg_temp.as_user_int(:D35e::uuid, format(
    'select count(*) from public.listing_photos where listing_id = %s', :t35e_bloq)) = 0
  and pg_temp.as_user_int(:D35e::uuid, format(
    'select count(*) from public.listing_photos where listing_id in (%s, %s)',
    :t35e_pend, :t35e_act)) = 2,
  'T35c (f) en la tabla listing_photos, el dueño no ve la fila de su bloqueada y sí las otras');

-- (g) INSERT de una fila nueva para su bloqueada: rechazado. Hoy (antes de
-- …481) pasaba, medido: `listing_photos_insert_own` no miraba el estado.
select pg_temp.assert(
  pg_temp.filas_como(:D35e::uuid, format(
    'insert into public.listing_photos (listing_id, storage_path, orden) values (%s, %L, 1)',
    :t35e_bloq, :t35e_bloq || '/b.jpg')) = '42501',
  'T35c (g) el dueño no puede insertar filas de fotos en su bloqueada');

-- (h) e (i) UPDATE y DELETE filtrando por la publicación: 0 filas, y la fila
-- sigue intacta (comprobado como postgres en otra sentencia).
select pg_temp.filas_como(:D35e::uuid, format(
  'update public.listing_photos set orden = 3 where listing_id = %s', :t35e_bloq)) as t35e_h \gset
select pg_temp.filas_como(:D35e::uuid, format(
  'delete from public.listing_photos where listing_id = %s', :t35e_bloq)) as t35e_i \gset
select pg_temp.assert(
  :'t35e_h' = '0' and :'t35e_i' = '0'
  and (select orden from public.listing_photos where listing_id = :t35e_bloq) = 0,
  'T35c (h)(i) el dueño no reordena ni borra las filas de fotos de su bloqueada');

-- (j) DELETE SIN WHERE: aísla la policy de DELETE de la de SELECT (CLAUDE.md §9:
-- con WHERE, la de SELECT filtra antes y la de DELETE no se prueba). El dueño
-- sí borra las de su pendiente y su activa (sus policies lo permiten); la de la
-- bloqueada tiene que sobrevivir.
select pg_temp.filas_como(:D35e::uuid, 'delete from public.listing_photos') as t35e_j \gset
select pg_temp.assert(
  (select count(*) from public.listing_photos where listing_id = :t35e_bloq) = 1,
  'T35c (j) un DELETE sin WHERE del dueño no alcanza la fila de su bloqueada');
insert into public.listing_photos (listing_id, storage_path, orden)
select v.id, v.id || '/a.jpg', 0
  from (values (:t35e_pend), (:t35e_act)) as v(id)
 where not exists (select 1 from public.listing_photos p where p.listing_id = v.id);

-- (k) Storage, las cuatro operaciones del dueño sobre `{id}/` de su bloqueada:
-- subir un objeto nuevo (rechazo; antes de …481 pasaba sin RETURNING, medido),
-- sobrescribir (0), borrar con WHERE y sin WHERE (0). El objeto sigue ahí.
select pg_temp.filas_como(:D35e::uuid, format(
  'insert into storage.objects (bucket_id, name) values (''listing-photos'', %L)',
  :t35e_bloq || '/nuevo.jpg')) as t35e_k1 \gset
select pg_temp.filas_como(:D35e::uuid, format(
  'update storage.objects set metadata = ''{}'' where bucket_id = ''listing-photos'' and name = %L',
  :t35e_bloq || '/a.jpg')) as t35e_k2 \gset
select pg_temp.filas_como(:D35e::uuid, format(
  'delete from storage.objects where bucket_id = ''listing-photos'' and name = %L',
  :t35e_bloq || '/a.jpg')) as t35e_k3 \gset
select pg_temp.filas_como(:D35e::uuid, format(
  'delete from storage.objects where bucket_id = ''listing-photos'' and name like %L',
  :t35e_bloq || '/%')) as t35e_k4 \gset
select pg_temp.assert(
  :'t35e_k1' = '42501' and :'t35e_k2' = '0' and :'t35e_k3' = '0' and :'t35e_k4' = '0'
  and (select count(*) from storage.objects where name = :t35e_bloq || '/a.jpg') = 1
  and (select count(*) from storage.objects where name = :t35e_bloq || '/nuevo.jpg') = 0,
  'T35c (k) en el bucket, el dueño no sube, no sobrescribe ni borra en la carpeta de su bloqueada');

-- (k2) Control de radio de (k): sobre su ACTIVA el mismo dueño sí sobrescribe.
-- Sin esto, (k) no distinguiría "bloqueado por estado" de "bloqueado por todo".
select pg_temp.assert(
  pg_temp.filas_como(:D35e::uuid, format(
    'update storage.objects set metadata = ''{}'' where bucket_id = ''listing-photos'' and name = %L',
    :t35e_act || '/a.jpg')) = '1',
  'T35c (k2) sobre su activa, el mismo dueño sí escribe en el bucket');

-- (l) Y no se desbloquea ni la edita: `listings_update_own` excluye `bloqueada`
-- de su `using`, que se evalúa contra la fila vieja → 0 filas, sin error.
select pg_temp.filas_como(:D35e::uuid, format(
  'update public.listings set estado = ''pausada'' where id = %s', :t35e_bloq)) as t35e_l1 \gset
select pg_temp.filas_como(:D35e::uuid, format(
  'update public.listings set titulo = ''RLS T35e editada'' where id = %s', :t35e_bloq)) as t35e_l2 \gset
select pg_temp.assert(
  :'t35e_l1' = '0' and :'t35e_l2' = '0'
  and (select estado from public.listings where id = :t35e_bloq) = 'bloqueada',
  'T35c (l) el dueño no puede desbloquear ni editar su bloqueada');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T35d — cola de moderación y aprobar (RF-17, Ola 4) =='
-- 20261007000481, secciones 1-3. Autocontenida: universidad `rls-t35d.mx` y
-- sus cuentas:
--   :A35d — admin activado (actúa); dueño de una pendiente (G4).
--   :X35d — otro admin, dueño de una pendiente (G5).
--   :S35d — dueño activo, no admin: también el llamante no-admin.
--   :Z35d — dueño que se suspende (G7).
-- Todas las pendiente se siembran con los dueños ACTIVOS y con foto, salvo la
-- de `sin_fotos`; `:Z35d` se suspende después.
\set A35d '''35d35d35-0000-0000-0000-00000000a35d'''
\set X35d '''35d35d35-0000-0000-0000-00000000c35d'''
\set S35d '''35d35d35-0000-0000-0000-00000000535d'''
\set Z35d '''35d35d35-0000-0000-0000-00000000235d'''

insert into public.universidades (nombre) values ('RLS T35d Universidad');
insert into public.universidad_dominios (dominio, universidad_id)
select 'rls-t35d.mx', id from public.universidades where nombre = 'RLS T35d Universidad';
insert into public.campus (universidad_id, nombre, ciudad)
select id, 'RLS T35d Campus', 'Ciudad T35d' from public.universidades
 where nombre = 'RLS T35d Universidad';

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       e, '', now(), now(), now()
  from (values (:A35d, 'rls-t35d-a@rls-t35d.mx'), (:X35d, 'rls-t35d-x@rls-t35d.mx'),
               (:S35d, 'rls-t35d-s@rls-t35d.mx'), (:Z35d, 'rls-t35d-z@rls-t35d.mx')) as v(u, e);

insert into private.admins (user_id, nombre, activado_at)
values (:A35d::uuid, 'Admin T35d', now()), (:X35d::uuid, 'Otro admin T35d', now());

insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
select u.id, 1, u.universidad_id, c.id, v.t, 50, 'nuevo', v.e::public.listing_status
  from (values (:S35d, 'RLS T35d aprobable',   'pendiente'),
               (:S35d, 'RLS T35d sin evaluar', 'pendiente'),
               (:S35d, 'RLS T35d sin fotos',   'pendiente'),
               (:Z35d, 'RLS T35d dueño susp',  'pendiente'),
               (:X35d, 'RLS T35d de otro admin', 'pendiente'),
               (:A35d, 'RLS T35d del admin',   'pendiente'),
               (:S35d, 'RLS T35d activa',      'activa'),
               (:S35d, 'RLS T35d en vuelo',    'pendiente'),
               (:S35d, 'RLS T35d vencido',     'pendiente'),
               (:S35d, 'RLS T35d completado',  'pendiente')) as v(uid, t, e)
  join public.users u on u.id = v.uid::uuid
  join public.campus c on c.universidad_id = u.universidad_id;

create temp table t35d as
select titulo, id from public.listings where titulo like 'RLS T35d %';

insert into public.listing_photos (listing_id, storage_path, orden)
select id, id || '/t35d.jpg', 0 from t35d where titulo <> 'RLS T35d sin fotos';

-- Una evaluación para todas salvo "sin evaluar", y la de "aprobable" con un
-- detalle reconocible para comprobar que la cola trae la ÚLTIMA.
insert into public.listing_moderacion (listing_id, veredicto, estado_resultante, detalle)
select id, 'limpio', 'pendiente', '{"orden": 1}'::jsonb
  from t35d where titulo not in ('RLS T35d sin evaluar', 'RLS T35d activa');
insert into public.listing_moderacion (listing_id, veredicto, estado_resultante, detalle)
select id, 'revisar', 'pendiente', '{"orden": 2}'::jsonb
  from t35d where titulo = 'RLS T35d aprobable';

insert into public.listing_moderacion_reclamos (listing_id, reclamada_at, completada_at)
select id, now() - interval '179 seconds', null::timestamptz from t35d where titulo = 'RLS T35d en vuelo'
union all
select id, now() - interval '181 seconds', null::timestamptz from t35d where titulo = 'RLS T35d vencido'
union all
select id, now() - interval '1 day', now() - interval '1 day' from t35d where titulo = 'RLS T35d completado';

update public.users set estado = 'suspendido', suspendido_at = now(),
                        suspension_motivo = 'T35d: dueño suspendido'
 where id = :Z35d::uuid;

select (select id from t35d where titulo = 'RLS T35d aprobable')     as d_ok,
       (select id from t35d where titulo = 'RLS T35d sin evaluar')   as d_sinev,
       (select id from t35d where titulo = 'RLS T35d sin fotos')     as d_sinfoto,
       (select id from t35d where titulo = 'RLS T35d dueño susp')    as d_susp,
       (select id from t35d where titulo = 'RLS T35d de otro admin') as d_otroadm,
       (select id from t35d where titulo = 'RLS T35d del admin')     as d_propia,
       (select id from t35d where titulo = 'RLS T35d activa')        as d_activa,
       (select id from t35d where titulo = 'RLS T35d en vuelo')      as d_vuelo,
       (select id from t35d where titulo = 'RLS T35d vencido')       as d_vencido,
       (select id from t35d where titulo = 'RLS T35d completado')    as d_compl
\gset

select pg_temp.assert(
  (select count(*) from t35d) = 10
  and (select count(*) from public.listings where id in (select id from t35d) and estado = 'pendiente') = 9,
  'precondición T35d: 10 publicaciones, 9 pendiente (la de Z sigue pendiente tras suspenderlo)');

-- (a) Un no-admin no llama a ninguna de las dos.
select pg_temp.assert(
  pg_temp.rechazo_aal(:S35d::uuid, 'aal2', pg_temp.amr_totp(1),
    'select count(*) from admin.cola_moderacion()') = '42501:no_admin'
  and pg_temp.rechazo_aal(:S35d::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.aprobar_listing(%s, %L)', :d_ok, 'motivo de prueba')) = '42501:no_admin',
  'T35d (a) un no-admin recibe no_admin en cola_moderacion y en aprobar_listing');

-- (b) La cola: evaluadas y sin evaluar son conjuntos DISJUNTOS, solo
-- `pendiente`, y la fila trae su ÚLTIMA evaluación y sus fotos.
select pg_temp.assert(
  pg_temp.as_aal_text(:A35d::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select string_agg(id::text, '','' order by id) from admin.cola_moderacion(true, null, 100)
      where id in (%s)', (select string_agg(id::text, ',') from t35d)))
    = (select string_agg(id::text, ',' order by id) from t35d
        where titulo not in ('RLS T35d sin evaluar', 'RLS T35d activa'))
  and pg_temp.as_aal_text(:A35d::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select string_agg(id::text, '','') from admin.cola_moderacion(false, null, 100)
      where id in (%s)', (select string_agg(id::text, ',') from t35d))) = :'d_sinev',
  'T35d (b) evaluadas = las 8 pendiente con evaluación; sin evaluar = solo la que no tiene; nunca la activa');

select pg_temp.assert(
  pg_temp.as_aal_text(:A35d::uuid, 'aal2', pg_temp.amr_totp(1), format(
    'select (ultimo_veredicto = ''revisar'' and ultimo_detalle->>''orden'' = ''2''
             and evaluaciones = 2 and fotos = array[%L] and dueno_estado = ''activo'')::text
       from admin.cola_moderacion(true, null, 100) where id = %s',
    :d_ok || '/t35d.jpg', :d_ok)) = 'true',
  'T35d (b2) la fila trae la última evaluación, el conteo, las fotos y el estado del dueño');

-- (c) Tope de la plantilla: 100 filas aunque se pidan 10 000. Con las 10 de
-- arriba un `count(*) <= 100` pasaría con o sin tope, así que se siembran 101
-- pendientes SIN evaluar más (el chip "Sin evaluar" las junta) y se exige
-- EXACTAMENTE 100. Se borran después para no ensuciar las aserciones que siguen.
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
select u.id, 1, u.universidad_id, c.id, 'RLS T35d tope ' || g, 50, 'nuevo', 'pendiente'
  from public.users u join public.campus c on c.universidad_id = u.universidad_id,
       generate_series(1, 101) g
 where u.id = :S35d::uuid;
select pg_temp.assert(
  pg_temp.as_aal_text(:A35d::uuid, 'aal2', pg_temp.amr_totp(1),
    'select count(*)::text from admin.cola_moderacion(false, null, 10000)') = '100',
  'T35d (c) cola_moderacion devuelve exactamente 100 filas cuando hay más y se piden 10 000');
delete from public.listings where titulo like 'RLS T35d tope %';

-- (d)-(k) Cada guarda de aprobar_listing, por su `sqlstate:mensaje`.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35d::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.aprobar_listing(%s, %L)', :d_ok, '  x ')) = '22023:motivo_invalido',
  'T35d (d) motivo de menos de 3 caracteres tras btrim → 22023:motivo_invalido');

select pg_temp.assert(
  pg_temp.rechazo_aal(:A35d::uuid, 'aal2', pg_temp.amr_totp(1),
    'select admin.aprobar_listing(999999999, ''motivo de prueba'')') = 'P0002:listing_no_existe',
  'T35d (e) publicación inexistente → P0002:listing_no_existe');

select pg_temp.assert(
  pg_temp.rechazo_aal(:A35d::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.aprobar_listing(%s, %L)', :d_propia, 'motivo de prueba')) = '42501:no_sobre_si_mismo',
  'T35d (f) una publicación propia del admin → 42501:no_sobre_si_mismo');

select pg_temp.assert(
  pg_temp.rechazo_aal(:A35d::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.aprobar_listing(%s, %L)', :d_otroadm, 'motivo de prueba')) = '42501:objetivo_es_admin',
  'T35d (g) una publicación de otro admin → 42501:objetivo_es_admin');

select pg_temp.assert(
  pg_temp.rechazo_aal(:A35d::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.aprobar_listing(%s, %L)', :d_activa, 'motivo de prueba')) = '55000:estado_inesperado',
  'T35d (h) una publicación que no está en pendiente → 55000:estado_inesperado');

select pg_temp.assert(
  pg_temp.rechazo_aal(:A35d::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.aprobar_listing(%s, %L)', :d_susp, 'motivo de prueba')) = '55000:dueno_no_activo'
  and (select estado from public.listings where id = :d_susp) = 'pendiente',
  'T35d (i) dueño suspendido → 55000:dueno_no_activo, y sigue pendiente');

select pg_temp.assert(
  pg_temp.rechazo_aal(:A35d::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.aprobar_listing(%s, %L)', :d_sinfoto, 'motivo de prueba')) = '55000:sin_fotos',
  'T35d (j) sin fotos → 55000:sin_fotos');

-- `aal_valor`: as_aal_text que CAPTURA el error y lo devuelve como
-- `ERR:<sqlstate>:<mensaje>`. Lo usan (l)-(n), donde el camino feliz devuelve un
-- valor: sin capturar, una regresión moriría con un error crudo en vez de en la
-- aserción con nombre.
create or replace function pg_temp.aal_valor(p_uid uuid, p_aal text, p_amr jsonb, p_sql text)
returns text language plpgsql as $$
declare v_out text;
begin
  perform set_config('request.jwt.claims', pg_temp.claims_aal(p_uid, p_aal, p_amr), true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v_out;
  perform set_config('role', 'postgres', true);
  return v_out;
exception when others then
  perform set_config('role', 'postgres', true);
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

-- (k) El reclamo EN VUELO (179 s, sin completar): no se aprueba, y el reclamo
-- queda como estaba (la raise revierte todo, también el intento de tomarlo).
select pg_temp.rechazo_aal(:A35d::uuid, 'aal2', pg_temp.amr_totp(1),
  format('select admin.aprobar_listing(%s, %L)', :d_vuelo, 'motivo de prueba')) as t35d_k \gset
select pg_temp.assert(
  :'t35d_k' = '55000:moderacion_en_curso'
  and (select estado from public.listings where id = :d_vuelo) = 'pendiente'
  and (select completada_at is null from public.listing_moderacion_reclamos where listing_id = :d_vuelo),
  'T35d (k) con un reclamo en vuelo (179 s) → 55000:moderacion_en_curso, nada cambia');

-- (l) El reclamo VENCIDO (181 s): se libera, se toma completado y se aprueba.
-- (k) y (l) juntos pinan el TTL de 180 s; el tripwire de probe-admin.mjs
-- compara ese literal con TTL_RECLAMO_MS de moderar-contenido.
select pg_temp.aal_valor(:A35d::uuid, 'aal2', pg_temp.amr_totp(1),
  format('select admin.aprobar_listing(%s, %L)', :d_vencido, 'motivo de prueba')) as t35d_l \gset
select pg_temp.assert(
  :'t35d_l' = 'activa'
  and (select estado from public.listings where id = :d_vencido) = 'activa'
  and (select completada_at is not null from public.listing_moderacion_reclamos where listing_id = :d_vencido),
  'T35d (l) con un reclamo vencido (181 s), se aprueba y el reclamo queda completado');

-- (m) Un reclamo COMPLETADO no bloquea.
select pg_temp.assert(
  pg_temp.aal_valor(:A35d::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.aprobar_listing(%s, %L)', :d_compl, 'motivo de prueba')) = 'activa',
  'T35d (m) un reclamo completado no impide aprobar');

-- (n) El camino feliz, sin reclamo previo: activa, auditada SOLO con estado,
-- con el motivo, con el reclamo tomado completado y con el aviso al dueño.
select pg_temp.aal_valor(:A35d::uuid, 'aal2', pg_temp.amr_totp(1),
  format('select admin.aprobar_listing(%s, %L)', :d_ok, '  Es una silla; falso positivo.  ')) as t35d_n \gset
select pg_temp.assert(
  :'t35d_n' = 'activa'
  and (select estado from public.listings where id = :d_ok) = 'activa'
  and (select count(*) from private.admin_acciones
        where accion = 'aprobar_listing' and objetivo_tipo = 'listing' and objetivo_id = :d_ok::text
          and admin_id = :A35d::uuid
          and antes = '{"estado":"pendiente"}'::jsonb and despues = '{"estado":"activa"}'::jsonb
          and motivo = 'Es una silla; falso positivo.') = 1
  and (select completada_at is not null from public.listing_moderacion_reclamos where listing_id = :d_ok),
  'T35d (n) aprobar: activa, auditada con {estado} y el motivo sin espacios, reclamo completado');

select pg_temp.assert(
  (select count(*) from public.notifications
    where user_id = :S35d::uuid and listing_id = :d_ok and tipo = 'publicacion_aprobada') = 1,
  'T35d (n2) el dueño recibe el aviso publicacion_aprobada');

-- (o) Aprobarla otra vez: ya no está en pendiente.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35d::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.aprobar_listing(%s, %L)', :d_ok, 'motivo de prueba')) = '55000:estado_inesperado',
  'T35d (o) aprobar dos veces → 55000:estado_inesperado');

-- (p) aal1 con TOTP reciente: lo rechaza exigir_admin (mfa_requerido), no las
-- guardas de negocio.
select pg_temp.assert(
  pg_temp.rechazo_aal(:A35d::uuid, 'aal1', pg_temp.amr_totp(1),
    format('select admin.aprobar_listing(%s, %L)', :d_sinev, 'motivo de prueba')) = '42501:mfa_requerido',
  'T35d (p) un admin aal1 recibe mfa_requerido');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T35e — registro mínimo de moderación de una bloqueada eliminada (RF-17, Ola 4) =='
-- 20261007000482. Autocontenida: universidad `rls-t35f.mx`; admin `:A35f`;
-- dueño `:D35f` con dos bloqueadas (una se elimina, la otra se queda), una
-- pendiente y una activa; y `:K35f`, que elimina su cuenta con una bloqueada.
-- El `detalle` de las evaluaciones sembradas lleva A PROPÓSITO todo lo que la
-- lista blanca tiene que dejar fuera: la ruta de la foto, una palabra de la
-- lista y el texto de un error de OpenAI.
\set A35f '''35f35f35-0000-0000-0000-00000000a35f'''
\set D35f '''35f35f35-0000-0000-0000-00000000d35f'''
\set K35f '''35f35f35-0000-0000-0000-00000000c35f'''

insert into public.universidades (nombre) values ('RLS T35f Universidad');
insert into public.universidad_dominios (dominio, universidad_id)
select 'rls-t35f.mx', id from public.universidades where nombre = 'RLS T35f Universidad';
insert into public.campus (universidad_id, nombre, ciudad)
select id, 'RLS T35f Campus', 'Ciudad T35f' from public.universidades
 where nombre = 'RLS T35f Universidad';

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       e, '', now(), now(), now()
  from (values (:A35f, 'rls-t35f-a@rls-t35f.mx'), (:D35f, 'rls-t35f-d@rls-t35f.mx'),
               (:K35f, 'rls-t35f-k@rls-t35f.mx')) as v(u, e);
insert into private.admins (user_id, nombre, activado_at) values (:A35f::uuid, 'Admin T35f', now());

insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
select u.id, 1, u.universidad_id, c.id, v.t, 50, 'nuevo', v.e::public.listing_status
  from (values (:D35f, 'RLS T35f bloqueada se borra', 'bloqueada'),
               (:D35f, 'RLS T35f bloqueada se queda', 'bloqueada'),
               (:D35f, 'RLS T35f pendiente',          'pendiente'),
               (:D35f, 'RLS T35f activa',             'activa'),
               (:K35f, 'RLS T35f de la cuenta',       'bloqueada')) as v(uid, t, e)
  join public.users u on u.id = v.uid::uuid
  join public.campus c on c.universidad_id = u.universidad_id;

select (select id from public.listings where titulo = 'RLS T35f bloqueada se borra') as f_bor,
       (select id from public.listings where titulo = 'RLS T35f pendiente')          as f_pend,
       (select id from public.listings where titulo = 'RLS T35f activa')             as f_act,
       (select id from public.listings where titulo = 'RLS T35f de la cuenta')       as f_cta
\gset

insert into public.listing_moderacion (listing_id, veredicto, estado_resultante, detalle)
values
  (:f_bor, 'revisar', 'pendiente', jsonb_build_object(
     'eje_que_manda', 'rekognition',
     'ejes', jsonb_build_object('vision', 'limpio', 'rekognition', 'revisar'),
     'gpt', jsonb_build_object('motivo', 'error_http', 'detalle', 'TEXTO_DE_ERROR_T35F'),
     'lista_tecleada', '[]'::jsonb,
     'lista_ocr', jsonb_build_array('PALABRA_T35F'),
     'fotos', jsonb_build_array(jsonb_build_object(
        'storage_path', :f_bor || '/RUTA_T35F.jpg', 'estado', 'evaluada',
        'safe_search', jsonb_build_object('adult', 'VERY_UNLIKELY'),
        'rekognition', jsonb_build_array(jsonb_build_object(
           'name', 'Alcohol', 'confidence', 95.7, 'taxonomy_level', 1, 'parent_name', '')))))),
  (:f_bor, 'bloquear', 'bloqueada', jsonb_build_object(
     'eje_que_manda', 'listaTecleada',
     'gpt', jsonb_build_object('veredicto', jsonb_build_object('articulo_prohibido', 'claro')),
     'lista_tecleada', jsonb_build_array('PALABRA_T35F'))),
  (:f_cta, 'bloquear', 'bloqueada', '{}'::jsonb);

insert into private.admin_acciones (admin_id, admin_correo, accion, objetivo_tipo,
                                    objetivo_id, antes, despues, motivo)
values (:A35f::uuid, 'rls-t35f-a@rls-t35f.mx', 'bloquear_listing', 'listing', :f_bor::text,
        '{"estado":"pendiente"}', '{"estado":"bloqueada"}', 'T35f: motivo del bloqueo')
returning id as f_accion \gset

-- (a) EL CAMINO REAL: el dueño activo elimina su bloqueada como authenticated
-- (lo que hará `eliminar-publicacion` con su JWT). La fila retenida guarda la
-- publicación, el dueño, las dos evaluaciones en orden y la acción del panel.
select pg_temp.filas_como(:D35f::uuid,
  format('delete from public.listings where id = %s', :f_bor)) as t35f_a \gset
select pg_temp.assert(
  :'t35f_a' = '1'
  and (select count(*) from private.moderacion_retenida where listing_id = :f_bor) = 1
  and (select user_id = :D35f::uuid
              and jsonb_array_length(evaluaciones) = 2
              and evaluaciones->0->>'veredicto' = 'revisar'
              and evaluaciones->1->>'estado_resultante' = 'bloqueada'
              and admin_accion_ids = array[:f_accion::bigint]
              and retener_hasta between now() + interval '12 months' - interval '1 minute'
                                    and now() + interval '12 months' + interval '1 minute'
         from private.moderacion_retenida where listing_id = :f_bor),
  'T35e (a) eliminar una bloqueada deja su registro: dueño, evaluaciones en orden, acción del panel y 12 meses');

-- (b) Una `pendiente` o una `activa` eliminadas no son infracción: nada.
delete from public.listings where id in (:f_pend, :f_act);
select pg_temp.assert(
  (select count(*) from private.moderacion_retenida where listing_id in (:f_pend, :f_act)) = 0,
  'T35e (b) eliminar una pendiente o una activa no deja registro');

-- (c) LA LISTA BLANCA: ni la ruta, ni la palabra, ni el texto del error. Sí el
-- nivel por eje, la etiqueta de Rekognition con su confianza, SafeSearch, el
-- motivo del fallo de GPT, el veredicto de GPT y CUÁNTAS coincidencias hubo.
select pg_temp.assert(
  (select evaluaciones::text not like '%RUTA_T35F%'
          and evaluaciones::text not like '%PALABRA_T35F%'
          and evaluaciones::text not like '%TEXTO_DE_ERROR_T35F%'
          and evaluaciones::text not like '%storage_path%'
          and evaluaciones::text not like '%parent_name%'
          and evaluaciones->0->'detalle'->'ejes'->>'rekognition' = 'revisar'
          and evaluaciones->0->'detalle'->'fotos'->0->'rekognition'->0->>'name' = 'Alcohol'
          and (evaluaciones->0->'detalle'->'fotos'->0->'rekognition'->0->>'confidence')::numeric = 95.7
          and evaluaciones->0->'detalle'->'fotos'->0->'safe_search'->>'adult' = 'VERY_UNLIKELY'
          and evaluaciones->0->'detalle'->'gpt'->>'motivo' = 'error_http'
          and (evaluaciones->0->'detalle'->>'coincidencias_lista_ocr')::int = 1
          and evaluaciones->1->'detalle'->'gpt'->'veredicto'->>'articulo_prohibido' = 'claro'
          and (evaluaciones->1->'detalle'->>'coincidencias_lista_tecleada')::int = 1
     from private.moderacion_retenida where listing_id = :f_bor),
  'T35e (c) el registro no guarda rutas, palabras ni textos de error; sí niveles, etiquetas y conteos');

-- (d) Eliminar la CUENTA: el cascade borra su bloqueada y el registro queda,
-- con su `user_id` (decisión del usuario; la cuenta ya no existe).
-- El borrado se CAPTURA: si alguien le pone una FK a `user_id`, el insert del
-- trigger falla dentro del cascade (la fila del dueño ya no es visible), y así
-- cae aquí con nombre en vez de con un error crudo.
select pg_temp.rechazo_de(null, format('delete from auth.users where id = %L', :K35f)) as t35f_d \gset
select pg_temp.assert(
  :'t35f_d' = 'ok'
  and not exists (select 1 from public.users where id = :K35f::uuid)
  and (select count(*) from private.moderacion_retenida
        where listing_id = :f_cta and user_id = :K35f::uuid) = 1,
  'T35e (d) eliminar la cuenta deja el registro de su bloqueada, con su user_id');

-- (e) LA PURGA: se ejecuta el comando EXACTO del job (leído de cron.job, no
-- transcrito) con una fila vencida y otra vigente.
update private.moderacion_retenida set retener_hasta = now() - interval '1 second'
 where listing_id = :f_cta;
do $$
begin
  execute (select command from cron.job where jobname = 'purga-moderacion-retenida');
end $$;
select pg_temp.assert(
  (select count(*) from private.moderacion_retenida where listing_id = :f_cta) = 0
  and (select count(*) from private.moderacion_retenida where listing_id = :f_bor) = 1,
  'T35e (e) el comando del job borra la fila vencida y conserva la vigente');

-- (f) El job existe con su horario.
select pg_temp.assert(
  (select count(*) from cron.job
    where jobname = 'purga-moderacion-retenida' and schedule = '17 4 * * *' and active) = 1,
  'T35e (f) cron.job tiene la purga diaria activa');

-- (g) El consumidor: `bloqueadas` = 1 bloqueada actual + 1 retenida vigente.
select pg_temp.assert(
  pg_temp.as_aal_text(:A35f::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select (admin.detalle_usuario(%L)->>''bloqueadas'')', :D35f)) = '2',
  'T35e (g) detalle_usuario.bloqueadas suma las bloqueadas actuales y las eliminadas retenidas');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T35f — restablecer la app autenticadora de otro admin (RF-17, Ola 3b) =='
-- 20261008000483. Autocontenida: sus propias cuentas (prefijo `rls-t3b`) y sus
-- factores, sembrados como `postgres` en `auth.mfa_factors` (la Edge Function
-- los borra con la API de Auth; aquí se simula con un DELETE). Toda la suite
-- corre en UNA transacción, así que `now()` es constante: el inicio de cada
-- intento es `now()`, un factor "viejo" lleva `now() - 1 day` y uno "nuevo"
-- (enrolado después del inicio) `now() + 1 minute`. El borde exacto
-- (`created_at = inicio`) cuenta como viejo: lo vigila (b).
--   :E3b  ejecutor (admin activado)      :E3c  segundo ejecutor
--   :X3b  objetivo activado, con TOTP    :Y3b  objetivo YA desactivado, con TOTP
--   :Z3b  objetivo desactivado, sin TOTP (solo un webauthn)
--   :V3b  objetivo activado, sin ningún factor
--   :N3b  cuenta que no es admin
\set E3b '''3b3b3b3b-0000-0000-0000-0000000000e1'''
\set E3c '''3b3b3b3b-0000-0000-0000-0000000000e2'''
\set X3b '''3b3b3b3b-0000-0000-0000-0000000000a1'''
\set Y3b '''3b3b3b3b-0000-0000-0000-0000000000a2'''
\set Z3b '''3b3b3b3b-0000-0000-0000-0000000000a3'''
\set V3b '''3b3b3b3b-0000-0000-0000-0000000000a4'''
\set N3b '''3b3b3b3b-0000-0000-0000-0000000000b1'''

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       e, '', now(), now(), now()
  from (values (:E3b, 'rls-t3b-e1@rls-t3b.test'), (:E3c, 'rls-t3b-e2@rls-t3b.test'),
               (:X3b, 'rls-t3b-x@rls-t3b.test'),  (:Y3b, 'rls-t3b-y@rls-t3b.test'),
               (:Z3b, 'rls-t3b-z@rls-t3b.test'),  (:V3b, 'rls-t3b-v@rls-t3b.test'),
               (:N3b, 'rls-t3b-n@rls-t3b.test')) as v(u, e);
insert into private.admins (user_id, nombre, activado_at)
values (:E3b::uuid, 'Ejecutor T3b', now()), (:E3c::uuid, 'Ejecutor 2 T3b', now()),
       (:X3b::uuid, 'Objetivo X T3b', now() - interval '3 days'),
       (:Y3b::uuid, 'Objetivo Y T3b', null), (:Z3b::uuid, 'Objetivo Z T3b', null),
       (:V3b::uuid, 'Objetivo V T3b', now());

-- Factores de :X3b: TOTP verified viejo, TOTP unverified viejo, WebAuthn viejo y
-- un TOTP EXACTAMENTE en el inicio (el borde).
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
values
  ('3b3b3b3b-f000-0000-0000-0000000000f1', :X3b::uuid, 'totp',     'verified',   now() - interval '1 day', now()),
  ('3b3b3b3b-f000-0000-0000-0000000000f2', :X3b::uuid, 'totp',     'unverified', now() - interval '1 day', now()),
  ('3b3b3b3b-f000-0000-0000-0000000000f3', :X3b::uuid, 'webauthn', 'verified',   now() - interval '1 day', now()),
  ('3b3b3b3b-f000-0000-0000-0000000000f4', :X3b::uuid, 'totp',     'verified',   now(),                    now()),
  ('3b3b3b3b-f000-0000-0000-0000000000f6', :Y3b::uuid, 'totp',     'verified',   now() - interval '1 day', now()),
  ('3b3b3b3b-f000-0000-0000-0000000000f7', :Z3b::uuid, 'webauthn', 'verified',   now() - interval '1 day', now());

-- El iniciar del ejecutor `:E3b` con aal2 y TOTP de hace 1 h, como texto jsonb
-- (o `ERR:<sqlstate>:<mensaje>`, por `aal_valor`).
create or replace function pg_temp.t3b_iniciar(p_obj uuid, p_motivo text, p_pend bigint default null,
                                               p_ejec uuid default '3b3b3b3b-0000-0000-0000-0000000000e1')
returns text language sql as $$
  select pg_temp.aal_valor(p_ejec, 'aal2', pg_temp.amr_totp(1),
    format('select admin.restablecer_mfa_iniciar(%L, %L, %s)::text', p_obj, p_motivo,
           coalesce(p_pend::text, 'null')))
$$;
create or replace function pg_temp.t3b_completar(p_id bigint,
                                                 p_ejec uuid default '3b3b3b3b-0000-0000-0000-0000000000e1')
returns text language sql as $$
  select pg_temp.aal_valor(p_ejec, 'aal2', pg_temp.amr_totp(1),
    format('select admin.restablecer_mfa_completar(%s)::text', p_id))
$$;
-- El texto de `t3b_iniciar`/`t3b_completar` como jsonb. Un `ERR:…` no es JSON:
-- sin esto, una regresión moriría con "invalid input syntax for type json" en
-- vez de en la aserción con nombre (medido con los controles negativos).
create or replace function pg_temp.t3b_json(p text) returns jsonb language sql as $$
  select case when p like 'ERR:%' or p is null then jsonb_build_object('error', p) else p::jsonb end
$$;
create or replace function pg_temp.t3b_filas(p_obj uuid, p_accion text) returns bigint
language sql as $$
  select count(*) from private.admin_acciones
   where objetivo_tipo = 'admin' and objetivo_id = p_obj::text and accion = p_accion
$$;

-- (a) GUARDAS de iniciar, cada una con su mensaje, y ninguna cambia nada.
select
  pg_temp.rechazo_aal(:N3b::uuid, 'aal2', pg_temp.amr_totp(1),
    format('select admin.restablecer_mfa_iniciar(%L, %L)', :X3b, 'motivo de prueba')) as t3b_a1,
  pg_temp.rechazo_aal(:E3b::uuid, 'aal1', pg_temp.amr_totp(1),
    format('select admin.restablecer_mfa_iniciar(%L, %L)', :X3b, 'motivo de prueba')) as t3b_a2,
  pg_temp.rechazo_aal(:E3b::uuid, 'aal2', pg_temp.amr_totp(13),
    format('select admin.restablecer_mfa_iniciar(%L, %L)', :X3b, 'motivo de prueba')) as t3b_a3,
  pg_temp.t3b_iniciar(:X3b::uuid, '  ok ') as t3b_a4,
  pg_temp.t3b_iniciar(:E3b::uuid, 'motivo de prueba') as t3b_a5,
  pg_temp.t3b_iniciar(:N3b::uuid, 'motivo de prueba') as t3b_a6,
  pg_temp.t3b_iniciar(:X3b::uuid, 'motivo de prueba', 999999999) as t3b_a7
\gset
select pg_temp.assert(:'t3b_a1' = '42501:no_admin', 'T35f (a1) un no admin → 42501:no_admin');
select pg_temp.assert(:'t3b_a2' = '42501:mfa_requerido', 'T35f (a2) ejecutor aal1 → 42501:mfa_requerido');
select pg_temp.assert(:'t3b_a3' = '42501:totp_vencido', 'T35f (a3) ejecutor con TOTP de hace 13 h → 42501:totp_vencido');
select pg_temp.assert(:'t3b_a4' like 'ERR:22023:motivo_invalido%', 'T35f (a4) motivo de 2 caracteres tras btrim → 22023:motivo_invalido');
select pg_temp.assert(:'t3b_a5' like 'ERR:42501:no_sobre_si_mismo%', 'T35f (a5) sobre sí mismo → 42501:no_sobre_si_mismo');
select pg_temp.assert(:'t3b_a6' like 'ERR:P0002:objetivo_no_es_admin%', 'T35f (a6) un objetivo que no es admin → P0002:objetivo_no_es_admin');
select pg_temp.assert(:'t3b_a7' like 'ERR:P0002:intento_no_existe%', 'T35f (a7) un p_intento_pendiente que no existe → P0002:intento_no_existe');
select pg_temp.assert(
  (select activado_at is not null from private.admins where user_id = :X3b::uuid)
  and pg_temp.t3b_filas(:X3b::uuid, 'restablecer_mfa') = 0
  and (select count(*) from auth.mfa_factors where user_id = :X3b::uuid) = 4,
  'T35f (a8) ningún rechazo desactivó, auditó ni tocó factores');

-- (b) NUEVO sobre un objetivo ACTIVADO: desactiva, audita el inicio y devuelve
-- SOLO los TOTP viejos (verified y unverified, borde incluido), no el WebAuthn.
select pg_temp.t3b_iniciar(:X3b::uuid, 'Perdió el teléfono, confirmado por llamada') as t3b_b \gset
select (pg_temp.t3b_json(:'t3b_b')->>'accion_id')::bigint as t3b_r \gset
select pg_temp.assert(
  pg_temp.t3b_json(:'t3b_b')->>'estado' = 'nuevo'
  and (pg_temp.t3b_json(:'t3b_b')->>'desactivado')::boolean
  and (select array_agg(x order by x) from jsonb_array_elements_text(pg_temp.t3b_json(:'t3b_b')->'factores') x)
      = array['3b3b3b3b-f000-0000-0000-0000000000f1', '3b3b3b3b-f000-0000-0000-0000000000f2',
              '3b3b3b3b-f000-0000-0000-0000000000f4'],
  'T35f (b) nuevo: desactivado y factores = los 3 TOTP viejos (verified, unverified y el del borde), sin el WebAuthn');
select pg_temp.assert(
  (select activado_at is null from private.admins where user_id = :X3b::uuid)
  and (select count(*) from private.admin_acciones
        where id = :t3b_r and accion = 'restablecer_mfa' and admin_id = :E3b::uuid
          and antes ? 'activado_at' and antes->>'activado_at' is not null
          and despues = jsonb_build_object('activado_at', null, 'factores_totp', 3)
          and motivo = 'Perdió el teléfono, confirmado por llamada'
          and created_at = now()) = 1,
  'T35f (b2) la fila de inicio: actor, antes {activado_at}, despues {activado_at: null, factores_totp: 3}, inicio = now()');

-- El objetivo enrola su TOTP NUEVO después del inicio (S1 en curso).
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
values ('3b3b3b3b-f000-0000-0000-0000000000f5', :X3b::uuid, 'totp', 'verified', now() + interval '1 minute', now());

-- (c) El detalle refleja el estado: desactivado, app registrada, intento pendiente.
select pg_temp.as_aal_text(:E3b::uuid, 'aal2', pg_temp.amr_totp(1),
  format('select admin.detalle_usuario(%L)::text', :X3b)) as t3b_c \gset
select pg_temp.assert(
  (pg_temp.t3b_json(:'t3b_c')->>'admin_activado')::boolean = false
  and (pg_temp.t3b_json(:'t3b_c')->>'app_registrada')::boolean
  and (pg_temp.t3b_json(:'t3b_c')->>'restablecimiento_pendiente')::bigint = :t3b_r
  and exists (select 1 from jsonb_array_elements(pg_temp.t3b_json(:'t3b_c')->'auditoria') a
               where a->>'accion' = 'restablecer_mfa'),
  'T35f (c) detalle: admin_activado=false, app_registrada=true, pendiente = el intento, y su auditoría tipo admin');

-- (d) completar con TOTP viejos todavía presentes → no cierra.
select pg_temp.t3b_completar(:t3b_r) as t3b_d \gset
select pg_temp.assert(
  :'t3b_d' like 'ERR:55000:factores_pendientes%'
  and pg_temp.t3b_filas(:X3b::uuid, 'factores_mfa_borrados') = 0,
  'T35f (d) completar con TOTP viejos presentes → 55000:factores_pendientes, sin cierre');

-- (e) S1: reintentar REANUDA el mismo intento, sin fila nueva, y no devuelve el
-- TOTP nuevo (posterior al inicio).
select pg_temp.t3b_iniciar(:X3b::uuid, 'reintento') as t3b_e \gset
select pg_temp.assert(
  pg_temp.t3b_json(:'t3b_e')->>'estado' = 'reanudado'
  and (pg_temp.t3b_json(:'t3b_e')->>'accion_id')::bigint = :t3b_r
  and jsonb_array_length(pg_temp.t3b_json(:'t3b_e')->'factores') = 3
  and not (pg_temp.t3b_json(:'t3b_e')->'factores') ? '3b3b3b3b-f000-0000-0000-0000000000f5'
  and pg_temp.t3b_filas(:X3b::uuid, 'restablecer_mfa') = 1,
  'T35f (e) S1: reanudado con el MISMO intento, sin fila nueva, y sin el TOTP nuevo');

-- (f) Borrado parcial (Auth borró uno): reanuda con los que quedan.
delete from auth.mfa_factors where id = '3b3b3b3b-f000-0000-0000-0000000000f1';
select pg_temp.t3b_iniciar(:X3b::uuid, 'reintento', :t3b_r) as t3b_f \gset
select pg_temp.assert(
  pg_temp.t3b_json(:'t3b_f')->>'estado' = 'reanudado'
  and (select array_agg(x order by x) from jsonb_array_elements_text(pg_temp.t3b_json(:'t3b_f')->'factores') x)
      = array['3b3b3b3b-f000-0000-0000-0000000000f2', '3b3b3b3b-f000-0000-0000-0000000000f4'],
  'T35f (f) tras un borrado parcial, reanuda con los TOTP viejos que quedan');

-- (g) S2 + TOTP NUEVO: Auth terminó pero faltó el cierre. Reintentar CIERRA el
-- intento y TERMINA: conserva el TOTP nuevo y el WebAuthn, no crea otro inicio.
delete from auth.mfa_factors where id in ('3b3b3b3b-f000-0000-0000-0000000000f2',
                                          '3b3b3b3b-f000-0000-0000-0000000000f4');
select pg_temp.t3b_iniciar(:X3b::uuid, 'reintento', :t3b_r) as t3b_g \gset
select pg_temp.assert(
  pg_temp.t3b_json(:'t3b_g')->>'estado' = 'cierre_recuperado'
  and (pg_temp.t3b_json(:'t3b_g')->>'accion_id')::bigint = :t3b_r
  and jsonb_array_length(pg_temp.t3b_json(:'t3b_g')->'factores') = 0,
  'T35f (g) S2: cierre_recuperado del MISMO intento, sin factores que borrar');
select pg_temp.assert(
  pg_temp.t3b_filas(:X3b::uuid, 'restablecer_mfa') = 1
  and (select count(*) from private.admin_acciones
        where objetivo_tipo = 'admin' and objetivo_id = :X3b and accion = 'factores_mfa_borrados'
          and id > :t3b_r and despues = jsonb_build_object('factores_borrados', 3)
          and antes is null and motivo = 'Perdió el teléfono, confirmado por llamada') = 1
  and exists (select 1 from auth.mfa_factors where id = '3b3b3b3b-f000-0000-0000-0000000000f5')
  and exists (select 1 from auth.mfa_factors where id = '3b3b3b3b-f000-0000-0000-0000000000f3')
  and (select activado_at is null from private.admins where user_id = :X3b::uuid),
  'T35f (g2) S2 + TOTP nuevo: un solo inicio, un cierre (3, con el motivo del inicio), el TOTP nuevo y el WebAuthn sobreviven');

-- (h) El reintento CONCURRENTE que llega después: con p_intento_pendiente ya
-- cerrado → ya_completado, sin crear otro intento ni tocar el TOTP nuevo.
select pg_temp.t3b_iniciar(:X3b::uuid, 'reintento tardío', :t3b_r, :E3c::uuid) as t3b_h \gset
select pg_temp.assert(
  pg_temp.t3b_json(:'t3b_h')->>'estado' = 'ya_completado'
  and pg_temp.t3b_filas(:X3b::uuid, 'restablecer_mfa') = 1
  and exists (select 1 from auth.mfa_factors where id = '3b3b3b3b-f000-0000-0000-0000000000f5'),
  'T35f (h) reintento con p_intento_pendiente ya cerrado → ya_completado, sin intento nuevo, el TOTP nuevo sigue');

-- (i) completar es idempotente.
select pg_temp.t3b_completar(:t3b_r) as t3b_i \gset
select pg_temp.assert(
  pg_temp.t3b_json(:'t3b_i')->>'estado' = 'ya_completado'
  and pg_temp.t3b_filas(:X3b::uuid, 'factores_mfa_borrados') = 1,
  'T35f (i) completar sobre un intento cerrado → ya_completado, un solo cierre');

-- (j) El detalle ya no muestra pendiente.
select pg_temp.as_aal_text(:E3b::uuid, 'aal2', pg_temp.amr_totp(1),
  format('select admin.detalle_usuario(%L)::text', :X3b)) as t3b_j \gset
select pg_temp.assert(
  pg_temp.t3b_json(:'t3b_j')->'restablecimiento_pendiente' = 'null'::jsonb
  and (pg_temp.t3b_json(:'t3b_j')->>'app_registrada')::boolean,
  'T35f (j) detalle tras el cierre: sin pendiente; app_registrada por el TOTP nuevo');

-- (k) Nada que hacer: desactivado, sin TOTP (un WebAuthn no cuenta) y sin
-- pendiente → 55000:estado_inesperado, sin fila.
select pg_temp.t3b_iniciar(:Z3b::uuid, 'motivo de prueba') as t3b_k \gset
select pg_temp.assert(
  :'t3b_k' like 'ERR:55000:estado_inesperado%'
  and pg_temp.t3b_filas(:Z3b::uuid, 'restablecer_mfa') = 0
  and exists (select 1 from auth.mfa_factors where id = '3b3b3b3b-f000-0000-0000-0000000000f7'),
  'T35f (k) desactivado + solo WebAuthn + sin pendiente → 55000:estado_inesperado');

-- (l) NUEVO sobre un objetivo YA desactivado: no "desactiva", pero audita.
select pg_temp.t3b_iniciar(:Y3b::uuid, 'Cambió de teléfono') as t3b_l \gset
select (pg_temp.t3b_json(:'t3b_l')->>'accion_id')::bigint as t3b_ry \gset
select pg_temp.assert(
  pg_temp.t3b_json(:'t3b_l')->>'estado' = 'nuevo'
  and not (pg_temp.t3b_json(:'t3b_l')->>'desactivado')::boolean
  and (select antes = jsonb_build_object('activado_at', null) from private.admin_acciones where id = :t3b_ry),
  'T35f (l) nuevo sobre uno ya desactivado: desactivado=false y antes {activado_at: null}');

-- (m) Lo cierra OTRO admin: el actor del cierre es quien cierra.
delete from auth.mfa_factors where id = '3b3b3b3b-f000-0000-0000-0000000000f6';
select pg_temp.t3b_completar(:t3b_ry, :E3c::uuid) as t3b_m \gset
select pg_temp.assert(
  pg_temp.t3b_json(:'t3b_m')->>'estado' = 'completado'
  and (pg_temp.t3b_json(:'t3b_m')->>'factores_borrados')::int = 1
  and (select admin_id from private.admin_acciones
        where accion = 'factores_mfa_borrados' and objetivo_id = :Y3b) = :E3c::uuid,
  'T35f (m) otro admin completa: completado, factores_borrados=1, actor = quien cierra');

-- (n) completar con un id que no es restablecer_mfa → intento_no_existe.
select pg_temp.t3b_completar((select max(id) from private.admin_acciones
                               where accion = 'factores_mfa_borrados')) as t3b_n \gset
select pg_temp.assert(:'t3b_n' like 'ERR:P0002:intento_no_existe%',
  'T35f (n) completar con un id que no es restablecer_mfa → P0002:intento_no_existe');

-- (o) Activado SIN ningún factor: igual se desactiva (falla cerrado) y se
-- cierra con 0.
select pg_temp.t3b_iniciar(:V3b::uuid, 'Sin factor y activado') as t3b_o \gset
select pg_temp.t3b_completar((pg_temp.t3b_json(:'t3b_o')->>'accion_id')::bigint) as t3b_o2 \gset
select pg_temp.assert(
  pg_temp.t3b_json(:'t3b_o')->>'estado' = 'nuevo' and jsonb_array_length(pg_temp.t3b_json(:'t3b_o')->'factores') = 0
  and pg_temp.t3b_json(:'t3b_o2')->>'estado' = 'completado' and (pg_temp.t3b_json(:'t3b_o2')->>'factores_borrados')::int = 0
  and (select activado_at is null from private.admins where user_id = :V3b::uuid),
  'T35f (o) activado sin factores: nuevo con [] (desactivado) y completado con 0');

-- (p) El detalle de una cuenta que no es admin: los tres campos nuevos en null.
select pg_temp.as_aal_text(:E3b::uuid, 'aal2', pg_temp.amr_totp(1),
  format('select admin.detalle_usuario(%L)::text', :N3b)) as t3b_p \gset
select pg_temp.assert(
  pg_temp.t3b_json(:'t3b_p')->'admin_activado' = 'null'::jsonb
  and pg_temp.t3b_json(:'t3b_p')->'app_registrada' = 'null'::jsonb
  and pg_temp.t3b_json(:'t3b_p')->'restablecimiento_pendiente' = 'null'::jsonb,
  'T35f (p) detalle de una cuenta que no es admin: admin_activado, app_registrada y pendiente en null');

-- (q) CHECK y claves: las 2 acciones y `factores_totp` (solo para admin) entran;
-- una acción inventada, o `factores_totp` en un objetivo usuario, no.
select
  pg_temp.rechazo_de(null, format($q$insert into private.admin_acciones
    (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, antes, despues, motivo)
    values (%L, 'x', 'restablecer_mfa', 'admin', 'x', null, '{"factores_totp": 1}', 'motivo')$q$, :E3b)) as t3b_q1,
  pg_temp.rechazo_de(null, format($q$insert into private.admin_acciones
    (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, antes, despues, motivo)
    values (%L, 'x', 'restablecer_inventado', 'admin', 'x', null, null, 'motivo')$q$, :E3b)) as t3b_q2,
  pg_temp.rechazo_de(null, format($q$insert into private.admin_acciones
    (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, antes, despues, motivo)
    values (%L, 'x', 'suspender_usuario', 'usuario', 'x', null, '{"factores_totp": 1}', 'motivo')$q$, :E3b)) as t3b_q3
\gset
select pg_temp.assert(
  :'t3b_q1' = 'ok'
  and :'t3b_q2' = '23514:admin_acciones_accion_check'
  and :'t3b_q3' = '23514:admin_acciones_claves_ok',
  'T35f (q) CHECK: restablecer_mfa con factores_totp entra; una acción inventada y factores_totp en usuario → 23514');

-- (s) `app_registrada` exige un TOTP VERIFIED: un unverified (o un WebAuthn)
-- no cuenta como "Registrada".
insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at)
values ('3b3b3b3b-f000-0000-0000-0000000000f8', :Z3b::uuid, 'totp', 'unverified', now() + interval '1 minute', now());
select pg_temp.as_aal_text(:E3b::uuid, 'aal2', pg_temp.amr_totp(1),
  format('select admin.detalle_usuario(%L)::text', :Z3b)) as t3b_s \gset
select pg_temp.assert(
  (pg_temp.t3b_json(:'t3b_s')->>'app_registrada')::boolean = false
  and (pg_temp.t3b_json(:'t3b_s')->>'admin_activado')::boolean = false,
  'T35f (s) solo un TOTP unverified y un WebAuthn → app_registrada=false');

-- (r) El cierre compartido NO es invocable por el cliente.
select pg_temp.assert(
  not has_function_privilege('authenticated', 'private.cerrar_restablecer_mfa(bigint)', 'execute')
  and not has_function_privilege('anon', 'private.cerrar_restablecer_mfa(bigint)', 'execute'),
  'T35f (r) private.cerrar_restablecer_mfa está revocada a authenticated y anon');

\echo ''
\echo '== T37 — catálogo institucional: dominios activos, universidades y campus (RF-17, Ola 5) =='
-- 20261008000484. Autocontenida: sus propias cuentas (prefijo `rls-t37`), sus
-- universidades, campus y dominios. Los rechazos se comparan con
-- `ERR:<sqlstate>:<mensaje>` (helper `pg_temp.t37`), y cada acción va en una
-- sentencia y su comprobación en otra (`\gset`, la lección de T28).
--
-- ALCANCE de (b): corre como `postgres`, así que prueba la LÓGICA del hook y
-- del trigger, no el rol real. `postgres` no puede `set role
-- supabase_auth_admin` (medido): la ejecución bajo `supabase_auth_admin` la
-- cubren la verificación del commit de la migración (como `supabase_admin`) y
-- `scripts/probe-registro.mjs` contra GoTrue.
--
-- Concurrencia: sin advisory lock (decisión del usuario), las carreras las
-- deciden `on conflict`, CAS y los índices únicos. Una sola sesión no las
-- puede provocar: lo mide `scripts/probe-admin.mjs` con dos llamadas HTTP.
--
--   :E37 admin activado      :N37 cuenta que no es admin
--   :U37 usuario de `rls-t37b.mx` (Otra), con campus

\set E37 '''37373737-0000-0000-0000-0000000000e1'''
\set N37 '''37373737-0000-0000-0000-0000000000b1'''
\set U37 '''37373737-0000-0000-0000-0000000000c1'''

insert into public.universidades (nombre) values ('RLS T37 Uni'), ('RLS T37 Otra');
insert into public.campus (universidad_id, nombre, ciudad)
select id, 'RLS T37 Campus Otra', 'Ciudad T37' from public.universidades where nombre = 'RLS T37 Otra';
insert into public.universidad_dominios (dominio, universidad_id)
select 'rls-t37b.mx', id from public.universidades where nombre = 'RLS T37 Otra';
-- Un dominio ya DESACTIVADO de Uni (para "existe inactivo" en (h)).
insert into public.universidad_dominios (dominio, universidad_id, activo)
select 'rls-t37c.mx', id, false from public.universidades where nombre = 'RLS T37 Uni';

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select u::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       e, '', now(), now(), now()
  from (values (:E37, 'rls-t37-e@rls-t37.test'), (:N37, 'rls-t37-n@rls-t37.test'),
               (:U37, 'rls-t37-u@rls-t37b.mx')) as v(u, e);
insert into private.admins (user_id, nombre, activado_at) values (:E37::uuid, 'Admin T37', now());
update public.users
   set campus_id = (select id from public.campus where nombre = 'RLS T37 Campus Otra')
 where id = :U37::uuid;

create temp table t37 as
select
  (select id from public.universidades where nombre = 'RLS T37 Uni')  as uni,
  (select id from public.universidades where nombre = 'RLS T37 Otra') as otra,
  (select id from public.campus where nombre = 'RLS T37 Campus Otra') as campus_otra;
grant select on t37 to authenticated;

-- Escalar de p_sql como `authenticated` con aal y TOTP de hace p_horas, o
-- `ERR:<sqlstate>:<mensaje>`. Una función `void` da '' (cadena vacía).
create or replace function pg_temp.t37(
  p_sql text, p_uid uuid default '37373737-0000-0000-0000-0000000000e1',
  p_aal text default 'aal2', p_horas int default 1)
returns text language plpgsql as $$
declare v_out text;
begin
  perform set_config('request.jwt.claims',
    pg_temp.claims_aal(p_uid, p_aal, pg_temp.amr_totp(p_horas)), true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v_out;
  perform set_config('role', 'postgres', true);
  return coalesce(v_out, '');
exception when others then
  perform set_config('role', 'postgres', true);
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

create or replace function pg_temp.hook37(p_email text) returns jsonb language sql as $$
  select public.hook_before_user_created(
    jsonb_build_object('user', jsonb_build_object('email', p_email)))
$$;

-- La última fila de auditoría de una acción, como la ve un revisor.
create or replace function pg_temp.t37_audit(p_accion text)
returns private.admin_acciones language sql as $$
  select * from private.admin_acciones where accion = p_accion order by id desc limit 1
$$;

-- Regresión de admins (n): huella de `private.admins` y `auth.mfa_factors`
-- ANTES de cualquier llamada de T37.
select md5(coalesce((select string_agg(user_id::text || ':' || coalesce(activado_at::text, '-') || ':' || nombre, ',' order by user_id) from private.admins), '')) as t37_adm,
       md5(coalesce((select string_agg(id::text || ':' || status::text, ',' order by id) from auth.mfa_factors), '')) as t37_mfa
\gset

-- pre ---------------------------------------------------------------------------
select pg_temp.assert(
  (select uni is not null and otra is not null and campus_otra is not null and uni <> otra from t37)
  and not exists (select 1 from public.campus c, t37 where c.universidad_id = t37.uni)
  and (select universidad_id from public.users where id = :U37::uuid) = (select otra from t37),
  'T37 fixtures: Uni sin campus, Otra con campus y dominio, :U37 nació en Otra');

-- (a) La columna --------------------------------------------------------------
select pg_temp.assert(
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'universidad_dominios'
             and column_name = 'activo' and is_nullable = 'NO' and column_default = 'true'),
  'T37 (a1) universidad_dominios.activo es NOT NULL con default true');
select pg_temp.assert(
  (select activo from public.universidad_dominios where dominio = 'rls-t37b.mx')
  and (select activo from public.universidad_dominios where dominio = 'tec.mx'),
  'T37 (a2) un dominio dado de alta sin `activo` (la semilla, los fixtures) nace activo');

-- (b) Hook y trigger: LÓGICA (como postgres) -----------------------------------
select pg_temp.hook37('x@rls-t37b.mx')::text as t37_b1a \gset
update public.universidad_dominios set activo = false where dominio = 'rls-t37b.mx';
select pg_temp.hook37('x@rls-t37b.mx')::text as t37_b1b \gset
update public.universidad_dominios set activo = true where dominio = 'rls-t37b.mx';
select pg_temp.hook37('X@RLS-T37B.MX')::text as t37_b1c \gset
select pg_temp.assert(:'t37_b1a' = '{}', 'T37 (b1) hook: dominio activo → {}');
select pg_temp.assert(
  :'t37_b1b' = '{"error": {"message": "dominio_no_participante", "http_code": 403}}',
  'T37 (b2) hook: el MISMO dominio desactivado → dominio_no_participante');
select pg_temp.assert(:'t37_b1c' = '{}', 'T37 (b3) hook: reactivado (y en mayúsculas) → {}');

update public.universidad_dominios set activo = false where dominio = 'rls-t37b.mx';
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('37373737-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'rls-t37-d1@rls-t37b.mx', '', now(), now(), now());
update public.universidad_dominios set activo = true where dominio = 'rls-t37b.mx';
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('37373737-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'rls-t37-d2@rls-t37b.mx', '', now(), now(), now());
select pg_temp.assert(
  (select universidad_id from public.users where id = '37373737-0000-0000-0000-0000000000d1') is null,
  'T37 (b4) trigger: un alta con dominio DESACTIVADO nace sin universidad (y el alta no aborta)');
select pg_temp.assert(
  (select universidad_id from public.users where id = '37373737-0000-0000-0000-0000000000d2') = (select otra from t37),
  'T37 (b5) trigger: un alta con dominio activo nace con su universidad');

insert into public.correos_bloqueados (correo_hash)
values (sha256(convert_to('rls-t37-bloq@rls-t37b.mx', 'UTF8')));
select pg_temp.assert(
  pg_temp.hook37('rls-t37-bloq@rls-t37b.mx') = '{"error": {"message": "correo_bloqueado", "http_code": 403}}'::jsonb,
  'T37 (b6) correo_bloqueado se sigue evaluando ANTES que el dominio (activo)');

select pg_temp.assert(
  (select proacl::text from pg_proc where oid = 'public.hook_before_user_created(jsonb)'::regprocedure)
    = '{postgres=X/postgres,service_role=X/postgres,supabase_auth_admin=X/postgres}'
  and (select proacl::text from pg_proc where oid = 'private.handle_new_user()'::regprocedure)
    = '{postgres=X/postgres}',
  'T37 (b7) el ACL del hook y del trigger de alta no cambió');

-- (c) Autorización ------------------------------------------------------------
select
  pg_temp.t37('select admin.catalogo()::text', :N37) as t37_c1,
  pg_temp.t37('select admin.crear_universidad(''RLS T37 X'', ''motivo c'')::text', :N37) as t37_c2,
  pg_temp.t37(format('select admin.editar_universidad(%s, ''RLS T37 X'', ''motivo c'')::text', (select uni from t37)), :N37) as t37_c3,
  pg_temp.t37(format('select admin.crear_campus(%s, ''RLS T37 X'', ''Ciudad'', null, null, ''motivo c'')::text', (select uni from t37)), :N37) as t37_c4,
  pg_temp.t37(format('select admin.editar_campus(%s, ''RLS T37 X'', ''Ciudad'', null, null, ''motivo c'')::text', (select campus_otra from t37)), :N37) as t37_c5,
  pg_temp.t37(format('select admin.agregar_dominio(%s, ''rls-t37x.mx'', ''motivo c'')::text', (select otra from t37)), :N37) as t37_c6,
  pg_temp.t37('select admin.desactivar_dominio(''rls-t37b.mx'', ''motivo c'')::text', :N37) as t37_c7,
  pg_temp.t37('select admin.reactivar_dominio(''rls-t37c.mx'', ''motivo c'')::text', :N37) as t37_c8,
  pg_temp.t37('select admin.catalogo()::text', :E37, 'aal1') as t37_c9,
  pg_temp.t37(format('select admin.agregar_dominio(%s, ''rls-t37x.mx'', ''motivo c'')::text', (select otra from t37)), :E37, 'aal1') as t37_c10,
  pg_temp.t37('select admin.catalogo()::text', :E37, 'aal2', 13) as t37_c11,
  pg_temp.t37(format('select admin.agregar_dominio(%s, ''rls-t37x.mx'', ''motivo c'')::text', (select otra from t37)), :E37, 'aal2', 13) as t37_c12,
  pg_temp.t37('select admin.catalogo()::text') as t37_c13
\gset
select pg_temp.assert(:'t37_c1' = 'ERR:42501:no_admin', 'T37 (c1) no admin → catalogo 42501:no_admin');
select pg_temp.assert(:'t37_c2' = 'ERR:42501:no_admin', 'T37 (c2) no admin → crear_universidad 42501:no_admin');
select pg_temp.assert(:'t37_c3' = 'ERR:42501:no_admin', 'T37 (c3) no admin → editar_universidad 42501:no_admin');
select pg_temp.assert(:'t37_c4' = 'ERR:42501:no_admin', 'T37 (c4) no admin → crear_campus 42501:no_admin');
select pg_temp.assert(:'t37_c5' = 'ERR:42501:no_admin', 'T37 (c5) no admin → editar_campus 42501:no_admin');
select pg_temp.assert(:'t37_c6' = 'ERR:42501:no_admin', 'T37 (c6) no admin → agregar_dominio 42501:no_admin');
select pg_temp.assert(:'t37_c7' = 'ERR:42501:no_admin', 'T37 (c7) no admin → desactivar_dominio 42501:no_admin');
select pg_temp.assert(:'t37_c8' = 'ERR:42501:no_admin', 'T37 (c8) no admin → reactivar_dominio 42501:no_admin');
select pg_temp.assert(:'t37_c9' = 'ERR:42501:mfa_requerido', 'T37 (c9) admin aal1 → catalogo 42501:mfa_requerido');
select pg_temp.assert(:'t37_c10' = 'ERR:42501:mfa_requerido', 'T37 (c10) admin aal1 → agregar_dominio 42501:mfa_requerido');
select pg_temp.assert(:'t37_c11' = 'ERR:42501:totp_vencido', 'T37 (c11) TOTP de hace 13 h → catalogo 42501:totp_vencido');
select pg_temp.assert(:'t37_c12' = 'ERR:42501:totp_vencido', 'T37 (c12) TOTP de hace 13 h → agregar_dominio 42501:totp_vencido');
select pg_temp.assert(
  :'t37_c13' not like 'ERR:%'
  and (:'t37_c13')::jsonb @? '$.universidades[*] ? (@.nombre == "RLS T37 Otra")'
  and :'t37_c13' not like '%@%',
  'T37 (c13) un admin válido lee catalogo(): trae el catálogo y ningún correo ni admin');

-- (d) crear_universidad -------------------------------------------------------
select pg_temp.t37('select admin.crear_universidad(''  RLS   T37  Nueva '', ''  alta de prueba  '')::text') as t37_d1 \gset
select pg_temp.assert(
  :'t37_d1' ~ '^[0-9]+$'
  -- id::text contra el texto, NO `(:'t37_d1')::bigint`: con un literal, el
  -- cast se resuelve al planear y un `ERR:…` moriría crudo antes del assert.
  and (select nombre from public.universidades where id::text = :'t37_d1') = 'RLS T37 Nueva',
  'T37 (d1) crear_universidad normaliza el nombre y devuelve el id');
select pg_temp.assert(
  (select a.objetivo_tipo = 'universidad' and a.objetivo_id = :'t37_d1' and a.antes is null
          and a.despues = '{"nombre": "RLS T37 Nueva"}'::jsonb and a.motivo = 'alta de prueba'
          and a.admin_id = :E37::uuid
     from pg_temp.t37_audit('crear_universidad') a),
  'T37 (d2) auditoría de crear_universidad: universidad, id, null → {nombre}, motivo con btrim');
select pg_temp.assert(
  pg_temp.t37('select admin.crear_universidad(''RLS T37 Y'', '' ok '')::text') = 'ERR:22023:motivo_invalido',
  'T37 (d3) motivo de 2 caracteres tras btrim → 22023:motivo_invalido');
select pg_temp.assert(
  pg_temp.t37('select admin.crear_universidad('''', ''motivo d'')::text') = 'ERR:22023:nombre_invalido'
  and pg_temp.t37('select admin.crear_universidad(''   '', ''motivo d'')::text') = 'ERR:22023:nombre_invalido'
  and pg_temp.t37('select admin.crear_universidad(''X'', ''motivo d'')::text') = 'ERR:22023:nombre_invalido'
  and pg_temp.t37(format('select admin.crear_universidad(%L, ''motivo d'')::text', repeat('a', 101))) = 'ERR:22023:nombre_invalido',
  'T37 (d4) nombre vacío, en blanco, de 1 o de 101 caracteres → 22023:nombre_invalido');
select pg_temp.assert(
  pg_temp.t37('select admin.crear_universidad(''rls t37 NUEVA'', ''motivo d'')::text') = 'ERR:23505:nombre_duplicado',
  'T37 (d5) el mismo nombre en otras mayúsculas → 23505:nombre_duplicado (sin 23505 crudo)');

-- (e) editar_universidad ------------------------------------------------------
select pg_temp.t37(format('select admin.editar_universidad(%s, ''RLS T37 Nueva Dos'', ''renombre'')::text', :'t37_d1')) as t37_e1 \gset
select pg_temp.assert(
  :'t37_e1' = ''
  and (select nombre from public.universidades where id = (:'t37_d1')::bigint) = 'RLS T37 Nueva Dos',
  'T37 (e1) editar_universidad cambia el nombre');
select pg_temp.assert(
  (select a.objetivo_id = :'t37_d1' and a.antes = '{"nombre": "RLS T37 Nueva"}'::jsonb
          and a.despues = '{"nombre": "RLS T37 Nueva Dos"}'::jsonb
     from pg_temp.t37_audit('editar_universidad') a),
  'T37 (e2) auditoría de editar_universidad: {nombre} → {nombre}');
select pg_temp.assert(
  pg_temp.t37(format('select admin.editar_universidad(%s, '' RLS T37  Nueva Dos '', ''renombre'')::text', :'t37_d1')) = 'ERR:55000:sin_cambios',
  'T37 (e3) el mismo nombre tras normalizar → 55000:sin_cambios');
select pg_temp.assert(
  pg_temp.t37('select admin.editar_universidad(999999999, ''RLS T37 Z'', ''renombre'')::text') = 'ERR:P0002:universidad_no_existe'
  and pg_temp.t37(format('select admin.editar_universidad(%s, ''rls t37 otra'', ''renombre'')::text', :'t37_d1')) = 'ERR:23505:nombre_duplicado',
  'T37 (e4) universidad inexistente → P0002; el nombre de OTRA universidad → 23505:nombre_duplicado');
select pg_temp.t37(format('select admin.editar_universidad(%s, ''RLS T37 NUEVA DOS'', ''solo mayúsculas'')::text', :'t37_d1')) as t37_e5 \gset
select pg_temp.assert(
  :'t37_e5' = ''
  and (select nombre from public.universidades where id = (:'t37_d1')::bigint) = 'RLS T37 NUEVA DOS',
  'T37 (e5) cambiar solo las mayúsculas sobre la MISMA universidad se permite (excluye su propio id)');

-- (f) crear_campus --------------------------------------------------------------
select
  pg_temp.t37(format('select admin.crear_campus(%s, '' RLS T37  Campus Uno '', '' Monterrey '', 25.6, -100.3, ''alta campus'')::text', (select uni from t37))) as t37_f1,
  pg_temp.t37(format('select admin.crear_campus(%s, ''RLS T37 Campus Dos'', ''Monterrey'', null, null, ''alta campus'')::text', (select uni from t37))) as t37_f2
\gset
select pg_temp.assert(
  :'t37_f1' ~ '^[0-9]+$'
  and coalesce((select nombre = 'RLS T37 Campus Uno' and ciudad = 'Monterrey' and latitud = 25.6 and longitud = -100.3
                  and universidad_id = (select uni from t37)
                  from public.campus where id::text = :'t37_f1'), false),
  'T37 (f1) crear_campus con coordenadas: normaliza nombre y ciudad');
select pg_temp.assert(
  :'t37_f2' ~ '^[0-9]+$'
  and coalesce((select latitud is null and longitud is null from public.campus where id::text = :'t37_f2'), false),
  'T37 (f2) crear_campus sin coordenadas');
select pg_temp.assert(
  pg_temp.t37(format('select admin.crear_campus(%s, ''RLS T37 C3'', ''Monterrey'', 25, null, ''alta campus'')::text', (select uni from t37))) = 'ERR:22023:coordenadas_invalidas'
  and pg_temp.t37(format('select admin.crear_campus(%s, ''RLS T37 C3'', ''Monterrey'', null, 10, ''alta campus'')::text', (select uni from t37))) = 'ERR:22023:coordenadas_invalidas',
  'T37 (f3) una sola coordenada → 22023:coordenadas_invalidas');
select pg_temp.assert(
  pg_temp.t37(format('select admin.crear_campus(%s, ''RLS T37 C4'', ''Monterrey'', 95, 0, ''alta campus'')::text', (select uni from t37))) = 'ERR:22023:coordenadas_invalidas'
  and pg_temp.t37(format('select admin.crear_campus(%s, ''RLS T37 C4'', ''Monterrey'', 0, -181, ''alta campus'')::text', (select uni from t37))) = 'ERR:22023:coordenadas_invalidas'
  and pg_temp.t37(format('select admin.crear_campus(%s, ''RLS T37 C4'', ''Monterrey'', ''NaN'', 0, ''alta campus'')::text', (select uni from t37))) = 'ERR:22023:coordenadas_invalidas'
  and pg_temp.t37(format('select admin.crear_campus(%s, ''RLS T37 C4'', ''M'', null, null, ''alta campus'')::text', (select uni from t37))) = 'ERR:22023:ciudad_invalida',
  'T37 (f4) latitud 95, longitud -181 o NaN → coordenadas_invalidas; ciudad de 1 → ciudad_invalida');
select pg_temp.assert(
  pg_temp.t37('select admin.crear_campus(999999999, ''RLS T37 C5'', ''Monterrey'', null, null, ''alta campus'')::text') = 'ERR:P0002:universidad_no_existe',
  'T37 (f5) universidad inexistente → P0002:universidad_no_existe');
select pg_temp.assert(
  pg_temp.t37(format('select admin.crear_campus(%s, ''rls t37 campus UNO'', ''Monterrey'', null, null, ''alta campus'')::text', (select uni from t37))) = 'ERR:23505:nombre_duplicado',
  'T37 (f6) el mismo campus en otras mayúsculas, en la misma universidad → 23505:nombre_duplicado');
select pg_temp.assert(
  pg_temp.t37(format('select admin.crear_campus(%s, ''RLS T37 Campus Uno'', ''Monterrey'', null, null, ''alta campus'')::text', (select otra from t37))) ~ '^[0-9]+$',
  'T37 (f7) el mismo nombre de campus en OTRA universidad se permite');
select pg_temp.assert(
  (select a.objetivo_tipo = 'campus' and a.objetivo_id = :'t37_f2' and a.antes is null
          and a.despues = jsonb_build_object('nombre', 'RLS T37 Campus Dos', 'ciudad', 'Monterrey',
                                             'latitud', null, 'longitud', null,
                                             'universidad_id', (select uni from t37))
     from private.admin_acciones a
    where a.accion = 'crear_campus' and a.objetivo_id = :'t37_f2'),
  'T37 (f8) auditoría de crear_campus: las 5 claves, con coordenadas null');

-- (g) editar_campus -------------------------------------------------------------
select pg_temp.assert(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'admin' and p.proname = 'editar_campus') = 1
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'admin' and p.proname = 'editar_campus'
                     and 'p_universidad_id' = any (p.proargnames)),
  'T37 (g1) editar_campus es UNA sola firma y no recibe universidad_id');
select pg_temp.t37(format('select admin.editar_campus(%s, ''RLS T37 Campus Uno'', ''Monterrey'', null, null, ''quita coordenadas'')::text', :'t37_f1')) as t37_g2 \gset
select pg_temp.assert(
  :'t37_g2' = ''
  and (select latitud is null and longitud is null and universidad_id = (select uni from t37)
         from public.campus where id = (:'t37_f1')::bigint),
  'T37 (g2) null/null borra las coordenadas y el campus sigue en su universidad');
select pg_temp.assert(
  pg_temp.t37(format('select admin.editar_campus(%s, ''RLS T37 Campus Uno'', ''Monterrey'', null, null, ''otra vez'')::text', :'t37_f1')) = 'ERR:55000:sin_cambios',
  'T37 (g3) sin ningún cambio → 55000:sin_cambios');
select pg_temp.assert(
  (select a.antes = '{"latitud": 25.6, "longitud": -100.3}'::jsonb
          and a.despues = '{"latitud": null, "longitud": null}'::jsonb
     from pg_temp.t37_audit('editar_campus') a),
  'T37 (g4) auditoría de editar_campus: SOLO las claves que cambiaron');
select pg_temp.assert(
  pg_temp.t37('select admin.editar_campus(999999999, ''RLS T37 X'', ''Monterrey'', null, null, ''motivo g'')::text') = 'ERR:P0002:campus_no_existe',
  'T37 (g5) campus inexistente → P0002:campus_no_existe');

-- (h) agregar_dominio -----------------------------------------------------------
select pg_temp.t37(format('select admin.agregar_dominio(%s, ''  @RLS-T37.MX '', ''alta dominio'')::text', (select uni from t37))) as t37_h1 \gset
select pg_temp.assert(
  :'t37_h1' = ''
  and (select activo and universidad_id = (select uni from t37)
         from public.universidad_dominios where dominio = 'rls-t37.mx'),
  'T37 (h1) agregar_dominio normaliza (minúsculas, sin espacios ni @ inicial) y nace activo');
select pg_temp.assert(
  (select a.objetivo_tipo = 'dominio' and a.objetivo_id = 'rls-t37.mx' and a.antes is null
          and a.despues = jsonb_build_object('dominio', 'rls-t37.mx',
                                             'universidad_id', (select uni from t37), 'activo', true)
     from pg_temp.t37_audit('agregar_dominio') a),
  'T37 (h2) auditoría de agregar_dominio: null → {dominio, universidad_id, activo}');
select pg_temp.assert(
  pg_temp.t37(format('select admin.agregar_dominio(%s, ''a@b.mx'', ''motivo h'')::text', (select uni from t37))) = 'ERR:22023:dominio_invalido'
  and pg_temp.t37(format('select admin.agregar_dominio(%s, ''sinpunto'', ''motivo h'')::text', (select uni from t37))) = 'ERR:22023:dominio_invalido'
  and pg_temp.t37(format('select admin.agregar_dominio(%s, ''a b.mx'', ''motivo h'')::text', (select uni from t37))) = 'ERR:22023:dominio_invalido'
  and pg_temp.t37(format('select admin.agregar_dominio(%s, ''-x.mx'', ''motivo h'')::text', (select uni from t37))) = 'ERR:22023:dominio_invalido',
  'T37 (h3) dominio con @, sin punto, con espacio o que empieza con guion → 22023:dominio_invalido');
select pg_temp.assert(
  pg_temp.t37(format('select admin.agregar_dominio(%s, ''gmail.com'', ''motivo h'')::text', (select uni from t37))) = 'ERR:22023:dominio_no_permitido'
  and pg_temp.t37(format('select admin.agregar_dominio(%s, ''Proton.ME'', ''motivo h'')::text', (select uni from t37))) = 'ERR:22023:dominio_no_permitido',
  'T37 (h4) un proveedor de correo público → 22023:dominio_no_permitido');
select pg_temp.assert(
  pg_temp.t37(format('select admin.agregar_dominio(%s, ''rls-t37n.mx'', ''motivo h'')::text', :'t37_d1')) = 'ERR:55000:universidad_sin_campus',
  'T37 (h5) una universidad sin campus → 55000:universidad_sin_campus');
select pg_temp.assert(
  pg_temp.t37(format('select admin.agregar_dominio(%s, ''rls-t37.mx'', ''motivo h'')::text', (select uni from t37))) = 'ERR:55000:dominio_existe_activo',
  'T37 (h6) un dominio que ya existe y está activo → 55000:dominio_existe_activo');
select pg_temp.assert(
  pg_temp.t37(format('select admin.agregar_dominio(%s, ''rls-t37c.mx'', ''motivo h'')::text', (select uni from t37))) = 'ERR:55000:dominio_existe_inactivo',
  'T37 (h7) un dominio que ya existe desactivado → 55000:dominio_existe_inactivo');
select pg_temp.assert(
  not (select activo from public.universidad_dominios where dominio = 'rls-t37c.mx')
  and not exists (select 1 from private.admin_acciones where objetivo_id = 'rls-t37c.mx'),
  'T37 (h8) agregar NUNCA reactiva: rls-t37c.mx sigue desactivado y sin auditoría');
select pg_temp.assert(
  pg_temp.t37(format('select admin.agregar_dominio(%s, ''rls-t37b.mx'', ''motivo h'')::text', (select uni from t37))) = 'ERR:55000:dominio_de_otra_universidad',
  'T37 (h9) un dominio de otra universidad → 55000:dominio_de_otra_universidad');

-- (i) desactivar / reactivar ----------------------------------------------------
select pg_temp.t37('select admin.desactivar_dominio('' RLS-T37.MX '', ''baja temporal'')::text') as t37_i1 \gset
select pg_temp.assert(
  :'t37_i1' = '' and not (select activo from public.universidad_dominios where dominio = 'rls-t37.mx'),
  'T37 (i1) desactivar_dominio lo deja inactivo');
select pg_temp.assert(
  (select a.objetivo_id = 'rls-t37.mx' and a.antes = '{"activo": true}'::jsonb
          and a.despues = '{"activo": false}'::jsonb
     from pg_temp.t37_audit('desactivar_dominio') a),
  'T37 (i2) auditoría de desactivar: {activo: true} → {activo: false}');
select pg_temp.assert(
  pg_temp.t37('select admin.desactivar_dominio(''rls-t37.mx'', ''otra vez'')::text') = 'ERR:55000:dominio_ya_inactivo'
  and (select count(*) from private.admin_acciones where accion = 'desactivar_dominio' and objetivo_id = 'rls-t37.mx') = 1,
  'T37 (i3) desactivar uno ya inactivo → 55000:dominio_ya_inactivo, sin auditoría doble');
select pg_temp.assert(
  pg_temp.t37('select admin.desactivar_dominio(''noexiste-t37.mx'', ''motivo i'')::text') = 'ERR:P0002:dominio_no_existe',
  'T37 (i4) un dominio inexistente → P0002:dominio_no_existe');
select pg_temp.t37('select admin.reactivar_dominio(''rls-t37.mx'', ''vuelve'')::text') as t37_i5 \gset
select pg_temp.assert(
  :'t37_i5' = '' and (select activo from public.universidad_dominios where dominio = 'rls-t37.mx'),
  'T37 (i5) reactivar_dominio lo deja activo');
select pg_temp.assert(
  (select a.antes = '{"activo": false}'::jsonb and a.despues = '{"activo": true}'::jsonb
     from pg_temp.t37_audit('reactivar_dominio') a),
  'T37 (i6) auditoría de reactivar: {activo: false} → {activo: true}');
select pg_temp.assert(
  pg_temp.t37('select admin.reactivar_dominio(''rls-t37.mx'', ''otra vez'')::text') = 'ERR:55000:dominio_ya_activo',
  'T37 (i7) reactivar uno ya activo → 55000:dominio_ya_activo');
insert into public.universidad_dominios (dominio, universidad_id, activo)
values ('rls-t37d.mx', (:'t37_d1')::bigint, false);
select pg_temp.assert(
  pg_temp.t37('select admin.reactivar_dominio(''rls-t37d.mx'', ''motivo i'')::text') = 'ERR:55000:universidad_sin_campus'
  and not (select activo from public.universidad_dominios where dominio = 'rls-t37d.mx'),
  'T37 (i8) reactivar el dominio de una universidad sin campus → 55000:universidad_sin_campus');

-- (j) Desactivar no toca a quien ya está registrado -----------------------------
select pg_temp.t37('select admin.desactivar_dominio(''rls-t37b.mx'', ''prueba j'')::text') as t37_j \gset
select pg_temp.assert(
  :'t37_j' = ''
  and (select universidad_id from public.users where id = :U37::uuid) = (select otra from t37)
  and (select campus_id from public.users where id = :U37::uuid) = (select campus_otra from t37),
  'T37 (j1) desactivar el dominio no cambia la universidad ni el campus de una cuenta existente');
select pg_temp.t37('select admin.reactivar_dominio(''rls-t37b.mx'', ''fin prueba j'')::text') as t37_j2 \gset

-- (k) El CHECK de auditoría -----------------------------------------------------
select pg_temp.assert(
  (select count(*) from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g')
    where c.conname = 'admin_acciones_accion_check') = 16
  and (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'admin_acciones_accion_check')
      ~ 'crear_universidad.*editar_universidad.*crear_campus.*editar_campus.*agregar_dominio.*desactivar_dominio.*reactivar_dominio',
  'T37 (k1) admin_acciones_accion_check admite exactamente 16 acciones, con las 7 del catálogo');
select pg_temp.assert(
  pg_temp.rechazo_de(null, format($q$insert into private.admin_acciones
    (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, antes, despues, motivo)
    values (%L, 'x', 'borrar_universidad', 'universidad', '1', null, null, 'motivo')$q$, :E37))
    = '23514:admin_acciones_accion_check',
  'T37 (k2) una acción inventada (borrar_universidad) → 23514');

-- (l) Un campus con referencias no se borra -------------------------------------
select pg_temp.assert(
  pg_temp.rechazo_de(null, format('delete from public.campus where id = %s', (select campus_otra from t37)))
    = '23503:users_campus_universidad_fkey',
  'T37 (l1) un campus con usuarios no se borra ni siendo postgres → 23503');

-- (m) Forma de los nombres, en la base ------------------------------------------
select pg_temp.assert(
  pg_temp.rechazo_de(null, 'insert into public.universidades (nombre) values ('' RLS T37 M1 '')')
    = '23514:universidades_nombre_normalizado',
  'T37 (m1) universidades: espacios al borde → 23514');
select pg_temp.assert(
  pg_temp.rechazo_de(null, format('insert into public.campus (universidad_id, nombre, ciudad) values (%s, ''RLS  T37 M2'', ''Monterrey'')', (select otra from t37)))
    = '23514:campus_nombre_normalizado',
  'T37 (m2) campus: espacios repetidos en el nombre → 23514');
select pg_temp.assert(
  pg_temp.rechazo_de(null, format('insert into public.campus (universidad_id, nombre, ciudad) values (%s, ''RLS T37 M3'', ''M'')', (select otra from t37)))
    = '23514:campus_ciudad_normalizada',
  'T37 (m3) campus: ciudad de 1 carácter → 23514');
select pg_temp.assert(
  pg_temp.rechazo_de(null, 'insert into public.universidades (nombre) values (''rls t37 otra'')')
    = '23505:universidades_nombre_lower_key',
  'T37 (m4) universidades: el mismo nombre en otras mayúsculas → 23505 del índice lower()');
select pg_temp.assert(
  pg_temp.rechazo_de(null, format('insert into public.campus (universidad_id, nombre, ciudad) values (%s, ''rls t37 campus otra'', ''Monterrey'')', (select otra from t37)))
    = '23505:campus_universidad_nombre_lower_key',
  'T37 (m5) campus: el mismo nombre en otras mayúsculas en la misma universidad → 23505');
select pg_temp.assert(
  pg_temp.rechazo_de(null, format('insert into public.universidades (nombre) values (%L)', 'RLS' || chr(160) || 'T37 M6'))
    = '23514:universidades_nombre_normalizado',
  'T37 (m6) un NBSP en el nombre → 23514 (cuenta como espacio)');
select pg_temp.assert(
  pg_temp.rechazo_de(null, format('insert into public.universidades (nombre) values (%L)', 'RLS' || chr(9) || 'T37 M7'))
    = '23514:universidades_nombre_normalizado',
  'T37 (m7) un tabulador en el nombre → 23514');
select pg_temp.assert(
  (select bool_and(pg_temp.rechazo_de(null, format('insert into public.universidades (nombre) values (%L)',
                     private.normaliza_texto(x))) = 'ok')
     from unnest(array['  RLS T37 M8a  ', 'RLS' || chr(160) || 'T37 M8b', 'RLS' || chr(9) || chr(9) || 'T37 M8c',
                       'RLS   T37' || chr(10) || 'M8d']) as x),
  'T37 (m8) lo que produce normaliza_texto() siempre cumple el check');

-- (n) Regresión de admins -------------------------------------------------------
select pg_temp.assert(
  md5(coalesce((select string_agg(user_id::text || ':' || coalesce(activado_at::text, '-') || ':' || nombre, ',' order by user_id) from private.admins), '')) = :'t37_adm'
  and md5(coalesce((select string_agg(id::text || ':' || status::text, ',' order by id) from auth.mfa_factors), '')) = :'t37_mfa',
  'T37 (n1) ninguna RPC del catálogo escribió private.admins ni auth.mfa_factors');

-- (o) Ventana hook → trigger (riesgo aceptado, L-D) -------------------------------
-- El hook ya dejó pasar el correo; el dominio se desactiva antes del INSERT
-- de GoTrue. Resultado: la cuenta EXISTE y nace sin universidad ("sin
-- universidad asignada" en Completar perfil). Diagnóstico y escalamiento en
-- docs/admin-runbook.md.
select pg_temp.hook37('rls-t37-o@rls-t37b.mx')::text as t37_o_hook \gset
update public.universidad_dominios set activo = false where dominio = 'rls-t37b.mx';
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('37373737-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'rls-t37-o@rls-t37b.mx', '', now(), now(), now());
update public.universidad_dominios set activo = true where dominio = 'rls-t37b.mx';
select pg_temp.assert(
  :'t37_o_hook' = '{}'
  and exists (select 1 from public.users where id = '37373737-0000-0000-0000-0000000000d3' and universidad_id is null),
  'T37 (o1) ventana hook→trigger: el hook permitió, el dominio se desactivó y la cuenta nace sin universidad');

\echo ''
\echo '==========================================='
\echo '   TODAS LAS PRUEBAS PASARON'
\echo '==========================================='

-- Nada de esto queda escrito: la suite no ensucia la base.
rollback;
