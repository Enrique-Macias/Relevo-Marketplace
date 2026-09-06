-- ===========================================================================
-- Relevo — suite de regresión de RLS, grants y triggers.
--
-- Cómo correrla:
--     supabase db reset && supabase test db
--   o directamente:
--     psql "$DATABASE_URL" -f supabase/tests/rls.sql
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
select pg_temp.expect_error(:A::uuid,
  format('insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                                       titulo, precio, condicion)
          values (%L, 1, 1, 1, ''RLS Suplantado'', 1, ''nuevo'')', :B::uuid),
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

delete from auth.users where id = :C::uuid;
select pg_temp.assert(
  exists (select 1 from public.reports
          where reported_user_id is null and reported_user_correo = 'rls-c@tec.mx'),
  'borrar la cuenta reportada no borra el reporte y conserva el correo');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T9 — tope de 5 fotos por publicación =='
select pg_temp.as_user(:B::uuid,
  format('insert into public.listing_photos (listing_id, storage_url, orden) values
          (%1$s,''u0'',0),(%1$s,''u1'',1),(%1$s,''u2'',2),(%1$s,''u3'',3),(%1$s,''u4'',4)',
         (select pausada from t_ids)));

select pg_temp.expect_error(:B::uuid,
  format('insert into public.listing_photos (listing_id, storage_url, orden)
          values (%s, ''u5'', 5)', (select pausada from t_ids)),
  'la sexta foto es rechazada por el trigger');

-- ---------------------------------------------------------------------------
\echo ''
\echo '== T10 — usuario suspendido =='
update public.users set estado = 'suspendido' where id = :B::uuid;

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

select pg_temp.expect_error(:B::uuid,
  format('insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                                       titulo, precio, condicion)
          values (%L, 1, 1, 1, ''RLS Nueva'', 10, ''nuevo'')', :B::uuid),
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
  and has_function_privilege('authenticated', 'private.can_rate(uuid,bigint)', 'execute'),
  'authenticated puede ejecutar las 2 funciones invocadas desde policies');

-- Estas cuatro sí son de seguridad: solo disparan por trigger y nadie debe poder
-- invocarlas. Postgres verifica EXECUTE al crear el trigger, no al dispararlo.
select pg_temp.assert(
  not has_function_privilege('authenticated', 'private.handle_new_user()', 'execute')
  and not has_function_privilege('authenticated', 'private.enforce_photo_limit()', 'execute')
  and not has_function_privilege('authenticated', 'private.recalc_rating_promedio()', 'execute')
  and not has_function_privilege('authenticated', 'private.capture_report_snapshot()', 'execute'),
  'las 4 funciones que solo disparan por trigger siguen revocadas');

select pg_temp.assert(
  not has_schema_privilege('anon', 'private', 'usage'),
  'anon no tiene acceso a private');

select pg_temp.assert(
  has_function_privilege('authenticated', 'public.increment_listing_view(bigint)', 'execute')
  and not has_function_privilege('anon', 'public.increment_listing_view(bigint)', 'execute'),
  'la RPC de vistas es ejecutable por authenticated y no por anon');

select pg_temp.assert(
  not exists (select 1 from information_schema.column_privileges
              where grantee = 'authenticated' and table_schema = 'public'
                and table_name = 'users' and column_name = 'correo'),
  'authenticated no tiene ningún privilegio sobre users.correo');

select pg_temp.assert(
  not exists (select 1 from information_schema.column_privileges
              where grantee = 'authenticated' and table_schema = 'public'
                and table_name = 'listings' and column_name = 'vistas_count'
                and privilege_type = 'UPDATE'),
  'authenticated no puede escribir listings.vistas_count');

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
\echo '==========================================='
\echo '   TODAS LAS PRUEBAS PASARON'
\echo '==========================================='

-- Nada de esto queda escrito: la suite no ensucia la base.
rollback;
