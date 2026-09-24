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
update public.users set nombre = 'Pablo', estado = 'suspendido' where id = :P::uuid;

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
update public.users set estado = 'suspendido' where id = :Q::uuid;

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
insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
                             titulo, precio, condicion, estado)
values (:Q::uuid, 1, 1, 1, 'RLS Susp posterior', 500, 'nuevo', 'activa');

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
update public.users set estado = 'activo' where id = :Q::uuid;

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
        'private.listing_id_from_object_name(text)', 'execute'),
  'authenticated puede ejecutar las 3 funciones invocadas desde policies');

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
        'private.notify_moderacion()', 'execute'),
  'las 12 funciones que solo disparan por trigger siguen revocadas');

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
  and pg_temp.hook('Mayus@RLS-T28.MX') = '{}'::jsonb
  and pg_temp.hook('x@sub.rls-t28.mx') = pg_temp.rechazo(),
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
-- volverse load-bearing sin querer). `pg_temp.rechazo_de()` ya está definida
-- por T28, en la misma sesión/transacción; no hace falta redefinirla.
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
\echo '==========================================='
\echo '   TODAS LAS PRUEBAS PASARON'
\echo '==========================================='

-- Nada de esto queda escrito: la suite no ensucia la base.
rollback;
