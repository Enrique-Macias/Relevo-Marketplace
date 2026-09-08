-- Relevo — RLS del bucket `listing-photos` (RF-05, RF-06).
--
-- El bucket vive en config.toml (es una fila, no esquema). Esta migración pone
-- las reglas de acceso a sus objetos, espejo exacto de las que ya gobiernan la
-- tabla public.listing_photos:
--   lectura   -> mismo criterio que listings_select (todas salvo las pausadas,
--                que solo ve su dueño)
--   escritura -> mismo criterio que listing_photos_{insert,update,delete}_own
--                (solo el dueño del listing, y solo si no está suspendido)
--
-- POR QUÉ ESTO SE PUEDE HACER DESDE UNA MIGRACIÓN:
-- storage.objects NO es de `postgres` — su dueño es supabase_storage_admin, y
-- `postgres` ni siquiera es miembro de ese rol, así que un `create policy` debería
-- fallar con 42501 "must be owner of table objects". No falla porque supautils
-- expone `supautils.policy_grants`, que lista storage.objects para `postgres`.
-- Verificado en pg_settings tanto en local como en el proyecto remoto. Si algún
-- día una migración de Storage sí revienta con 42501, ahí es donde hay que mirar
-- antes de mover nada al Dashboard.
--
-- LAYOUT DE RUTA: `{listing_id}/{uuid}.{ext}`
-- La carpeta es la llave de autorización: es lo único del nombre del objeto que
-- las policies leen. El `orden` de la foto NO va en la ruta, vive en su columna de
-- listing_photos — así reordenar las fotos de una publicación no obliga a mover
-- archivos en Storage.

-- ---------------------------------------------------------------------------
-- Ruta -> listing_id
-- ---------------------------------------------------------------------------

-- POR QUÉ UN `case` Y NO UN `and` SUELTO:
-- el nombre del objeto es entrada arbitraria del usuario. Un
-- `(storage.foldername(name))[1]::bigint` pelado revienta con 22P02 en cuanto
-- alguien sube `basura/x.jpg`. Guardarlo con `... ~ '^[0-9]+$' and ...::bigint`
-- tampoco sirve: el planner puede reordenar los operandos de un AND, así que el
-- cast llegaría a correr igual. `case` sí garantiza no evaluar la rama `then`
-- cuando el `when` es falso, y devolver null es exactamente lo que se quiere: una
-- ruta mal formada no casa con ningún listing y la policy la rechaza.
--
-- Y sobre todo: resuelve el caso feo SIN un bloque EXCEPTION de plpgsql, que es
-- el patrón que tumba el engine con SIGSEGV según supabase/KNOWN_ISSUES.md.
-- Mismo criterio que listing_favorites_count(), que devuelve null en vez de
-- `raise exception` por esta misma cautela.
--
-- `{1,18}` y no `+`: 18 dígitos siempre caben en bigint, así que tampoco hay
-- camino a un 22003 por desbordamiento con una carpeta de 40 dígitos.
--
-- Devuelve bigint y no se compara `l.id::text` con la carpeta (que también sería
-- seguro) para que el `exists` de las policies entre por la PK de listings en vez
-- de hacer un seq scan por cada objeto leído.
--
-- storage.foldername() ya es IMMUTABLE, así que esta también puede serlo.
create function private.listing_id_from_object_name(p_name text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9]{1,18}$'
    then ((storage.foldername(p_name))[1])::bigint
  end;
$$;

-- No es SECURITY DEFINER (es parsing de texto puro), así que no le aplica la regla
-- de CLAUDE.md §3 sobre qué vive en `public` y qué en `private`: va en private por
-- ser un detalle interno, no porque necesite privilegios.
--
-- El EXECUTE a authenticated SÍ es obligatorio: se invoca desde policies, y
-- Postgres exige el permiso de invocación al rol que dispara la policy aunque la
-- función corriera con privilegios elevados. Es la misma condición que dispara el
-- SIGSEGV de KNOWN_ISSUES.md cuando falta. La suite lo vigila (T12).
revoke execute on function private.listing_id_from_object_name(text) from public, anon;
grant  execute on function private.listing_id_from_object_name(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies sobre storage.objects
-- ---------------------------------------------------------------------------
--
-- Los nombres van prefijados con listing_photos_objects_ porque el namespace de
-- policies es TODA la tabla storage.objects, compartida con cualquier bucket que
-- se agregue después. `listing_photos_select` ya existe, pero sobre otra tabla.
--
-- Toda policy empieza por `bucket_id = 'listing-photos'`: sin ese guard estaría
-- concediendo acceso a los objetos de cualquier bucket futuro del proyecto.

-- Espejo de listings_select. Las vendidas siguen visibles (RF-07 pide conservar el
-- historial); solo las pausadas se esconden, y solo a quien no es su dueño.
--
-- CUÁL DE LAS DOS CONDICIONES ES LA PORTANTE, porque no es la que parece:
-- las expresiones de policy se evalúan como el ROL INVOCANTE, así que este
-- `exists` sobre public.listings pasa a su vez por listings_select y ya viene
-- filtrado. O sea que el `(l.estado <> 'pausada' or ...)` explícito es
-- REDUNDANTE — medido: quitarlo no cambia el comportamiento y la suite sigue
-- pasando. Lo portante es el `exists` mismo; sin él, cualquiera lee las fotos de
-- una pausada (eso sí lo caza T14).
-- Se conserva igual, por dos razones: hace legible la regla sin obligar a ir a
-- leer listings_select, y deja la policy correcta aunque algún día alguien
-- afloje listings_select. Pero no lo tomes como el candado: el candado es que
-- ambas reglas salen del mismo motor.
create policy listing_photos_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'listing-photos'
    and exists (
      select 1 from public.listings l
      where l.id = private.listing_id_from_object_name(name)
        and (l.estado <> 'pausada' or l.user_id = (select auth.uid()))
    )
  );

-- Una policy por acción de escritura y no un `for all`, por el mismo motivo que en
-- public.listing_photos: `for all` incluiría SELECT y dejaría dos policies
-- permisivas de lectura que Postgres evaluaría en cada objeto leído.
--
-- is_active_user() va en las tres: la tabla de decisión de CLAUDE.md §3 dice que un
-- usuario suspendido NO puede tocar las fotos de sus publicaciones. Sin esto, el
-- suspendido quedaría bloqueado en la tabla pero podría seguir escribiendo en
-- Storage, que es la mitad que de verdad cuesta dinero.
create policy listing_photos_objects_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'listing-photos'
    and exists (
      select 1 from public.listings l
      where l.id = private.listing_id_from_object_name(name)
        and l.user_id = (select auth.uid())
    )
    and (select private.is_active_user())
  );

-- UPDATE necesita using Y with check, y no es simetría decorativa: `using` decide
-- qué objeto puedo tocar, `with check` cómo puede quedar. Sin el with_check, un
-- dueño podría renombrar su propio objeto hacia la carpeta de un listing ajeno y
-- plantarle una foto a otro. Mismo razonamiento que listing_photos_update_own.
create policy listing_photos_objects_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'listing-photos'
    and exists (
      select 1 from public.listings l
      where l.id = private.listing_id_from_object_name(name)
        and l.user_id = (select auth.uid())
    )
    and (select private.is_active_user())
  )
  with check (
    bucket_id = 'listing-photos'
    and exists (
      select 1 from public.listings l
      where l.id = private.listing_id_from_object_name(name)
        and l.user_id = (select auth.uid())
    )
    and (select private.is_active_user())
  );

create policy listing_photos_objects_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'listing-photos'
    and exists (
      select 1 from public.listings l
      where l.id = private.listing_id_from_object_name(name)
        and l.user_id = (select auth.uid())
    )
    and (select private.is_active_user())
  );

-- AQUÍ NO VA EL `revoke all ... from anon, authenticated`, Y NO ES UN OLVIDO.
-- Ese patrón (CLAUDE.md §1 y §9) existe porque el pg_default_acl de Supabase
-- concede de más sobre cada tabla NUEVA de `public`, que son nuestras. Esta tabla
-- no lo es: storage.objects es de supabase_storage_admin y sus grants a
-- authenticated son los que el propio servicio de Storage necesita para funcionar.
-- Revocarlos rompería Storage entero, no solo este bucket. Aquí el control de
-- acceso son las policies de arriba, no los grants.
