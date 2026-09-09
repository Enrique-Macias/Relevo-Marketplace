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

-- Estas cinco sí son de seguridad: solo disparan por trigger y nadie debe poder
-- invocarlas. Postgres verifica EXECUTE al crear el trigger, no al dispararlo.
select pg_temp.assert(
  not has_function_privilege('authenticated', 'private.handle_new_user()', 'execute')
  and not has_function_privilege('authenticated', 'private.enforce_photo_limit()', 'execute')
  and not has_function_privilege('authenticated', 'private.recalc_rating_promedio()', 'execute')
  and not has_function_privilege('authenticated', 'private.capture_report_snapshot()', 'execute')
  and not has_function_privilege('authenticated',
        'private.enforce_activation_has_photos()', 'execute'),
  'las 5 funciones que solo disparan por trigger siguen revocadas');

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
