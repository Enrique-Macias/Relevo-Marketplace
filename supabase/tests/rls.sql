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
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
values (:B::uuid, 1, 1, 1, 'RLS Favoritos contables', 99, 'nuevo', 'activa');

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
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, descripcion, precio, condicion, estado)
values (:B::uuid, 1, 1, 1, 'RLS Cálculo de Larson, 9a edición',
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
  (:B::uuid, 1, 1, 1, 'RLS Fotos suspendido',  50, 'nuevo', 'activa');

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
select pg_temp.expect_error(:A::uuid,
  format('update public.users set telefono = ''8111234567'' where id = %L', :A::uuid),
  'un número sin +52 lo rechaza el check');
select pg_temp.expect_error(:A::uuid,
  format('update public.users set telefono = ''+521234'' where id = %L', :A::uuid),
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

-- CENTAVOS. `to_char(p,'FM999,999,999')` a secas redondea 99.50 a "100": esta es
-- la aserción que impide que alguien "simplifique" el `case` de
-- private.formato_precio y le mienta al usuario sobre el precio.
select pg_temp.as_user(:E::uuid,
  format('update public.listings set precio = 99.50 where id = %s',
         (select activa from t_notif)));
select pg_temp.assert(
  (select cuerpo from public.notifications
    where user_id = :F::uuid order by id desc limit 1)
    = '"RLS Monitor" ahora cuesta $99.50, antes $2,900.',
  'un precio con centavos sale como $99.50, no redondeado a $100');

-- Las dos condiciones del `when`, cada una con su aserción.
select pg_temp.as_user(:E::uuid,
  format('update public.listings set precio = 5000 where id = %s',
         (select activa from t_notif)));
select pg_temp.assert(
  (select count(*) from public.notifications where user_id = :F::uuid) = 2,
  'SUBIR el precio no notifica a nadie');

select pg_temp.as_user(:E::uuid,
  format('update public.listings set precio = 100 where id = %s',
         (select pausada from t_notif)));
select pg_temp.assert(
  (select count(*) from public.notifications where user_id = :F::uuid) = 2,
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
        'private.listing_id_from_object_name(text)', 'execute'),
  'authenticated puede ejecutar las 3 funciones invocadas desde policies');

-- Estas nueve sí son de seguridad: solo disparan por trigger y nadie debe poder
-- invocarlas. Postgres verifica EXECUTE al crear el trigger, no al dispararlo.
-- Dos de las nuevas importan más que el resto: `claim_push_token`, que invocable
-- a mano sería un borrado arbitrario de la fila de cualquiera cuyo token se
-- conozca, y `notify_push`, que lee la secret key de Vault.
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
        'private.notify_compra_calificable()', 'execute'),
  'las 10 funciones que solo disparan por trigger siguen revocadas');

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
