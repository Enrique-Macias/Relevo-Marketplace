-- Relevo — RLS del bucket `avatars` (RF-03, foto de perfil).
--
-- El bucket vive en config.toml (es una fila, no esquema). Esta migración pone
-- las reglas de acceso a sus objetos. Es hermana de 20260908000446, pero NO su
-- copia: tres diferencias son deliberadas y están explicadas abajo una por una,
-- porque las tres se "arreglan" solas si alguien las lee como omisiones.
--
-- LAYOUT DE RUTA: `{user_id}/{uuid}.jpg`
-- La carpeta es la llave de autorización, igual que allá — solo que aquí es el
-- uuid del dueño y no el id de una publicación.
--
-- POR QUÉ ESTO SE PUEDE HACER DESDE UNA MIGRACIÓN: mismo motivo que
-- 20260908000446 — `storage.objects` es de `supabase_storage_admin`, pero
-- `supautils.policy_grants` la lista para `postgres`. Si algún día revienta con
-- 42501, ahí es donde hay que mirar.

-- ---------------------------------------------------------------------------
-- DIFERENCIA 1 — aquí NO hay función de parsing de la ruta, y no es un olvido.
-- ---------------------------------------------------------------------------
-- `private.listing_id_from_object_name()` existe allá porque la carpeta hay que
-- CASTEARLA a bigint y el nombre del objeto es entrada arbitraria: de ahí el
-- `case` que evita el 22P02 sin un bloque EXCEPTION (que es lo que tumba el
-- engine con SIGSEGV, ver supabase/KNOWN_ISSUES.md).
-- Aquí la carpeta se compara como TEXTO contra `auth.uid()::text`. No hay cast
-- que pueda fallar, así que no hay nada que envolver. Si alguien propone
-- agregar un helper "por simetría con listing-photos", esta es la respuesta.

-- ---------------------------------------------------------------------------
-- Policies sobre storage.objects
-- ---------------------------------------------------------------------------
--
-- Prefijadas con avatars_objects_ porque el namespace de policies es TODA la
-- tabla storage.objects, compartida con cualquier bucket del proyecto. Y todas
-- empiezan por `bucket_id = 'avatars'`: sin ese guard estarían concediendo
-- acceso a los objetos de cualquier bucket futuro.

-- SELECT constante, y NO es el control de acceso en lectura — eso lo hace
-- `public = true` sobre /object/public/, que ni pasa por RLS.
--
-- ESTA POLICY ES LO QUE HACE QUE EL BORRADO FUNCIONE. Medido contra el stack
-- local, con estas mismas policies: SIN ella, el `remove()` de supabase-js
-- (DELETE /storage/v1/object/{bucket} con `{prefixes}`, que es el que usa el
-- cliente) devuelve **HTTP 200 con un array VACÍO** y deja el objeto intacto —
-- sin `error`, así que ni el `console.warn` de `borrarAvatar()` se entera. Un
-- borrado que falla en silencio, no un 403. El endpoint de un solo objeto sí
-- contesta 400 AccessDenied, pero el cliente no usa ese. Ver CLAUDE.md §9.
-- O sea: si alguien la borra "porque el bucket es público y no hace falta
-- leer", cada cambio de avatar deja un huérfano y nada lo dice.
--
-- Va SOLO `to authenticated`. Con `anon` el bucket pasaría a ser ENUMERABLE
-- (`list` devolvería las carpetas, o sea qué user_id tiene foto), que es lo
-- único que invalidaría la decisión de hacerlo público. Medido: como anon
-- devuelve `[]` con esta policy puesta, justamente porque no lo incluye.
--
-- Matiz honesto: un `authenticated` SÍ puede listar las carpetas y saber quién
-- tiene foto. No agrega exposición — `users.id` y `foto_url` ya están los dos
-- en el grant de select de 20260906000438.
create policy avatars_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

-- ---------------------------------------------------------------------------
-- DIFERENCIA 2 — SIN `private.is_active_user()`, y ESE es el punto.
-- ---------------------------------------------------------------------------
-- Las tres policies de escritura de `listing-photos` lo llevan porque un
-- suspendido no puede tocar sus publicaciones. Aquí sería una REGRESIÓN: la
-- tabla de decisión de CLAUDE.md §3 dice que un usuario suspendido SÍ puede
-- editar su propio perfil, incluido su teléfono, y `users_update_own` tampoco
-- lo lleva. Copiarlo de allá le quitaría en Storage un permiso que la base ya
-- le concede en la tabla.
-- La suite lo vigila con una aserción POSITIVA (T22-e): un suspendido sube su
-- avatar. Si alguien "endurece" esto, se pone en rojo ahí y solo ahí.
create policy avatars_objects_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- DIFERENCIA 3 — NO hay policy de UPDATE, y tampoco es un olvido.
-- ---------------------------------------------------------------------------
-- Ninguna ruta del cliente actualiza ni mueve un objeto de este bucket: cada
-- subida estrena un uuid (`upsert: false`) y el anterior se borra, porque en un
-- bucket público una ruta estable con `upsert: true` se quedaría servida desde
-- el caché del CDN y la foto nueva no se vería. Una policy `for update` con
-- `using` + `with check` idénticos no tendría consumidor.
-- Consecuencia: mover un objeto está denegado por AUSENCIA de policy, no por un
-- with_check — `scripts/probe-storage.mjs` lo asevera y lo dice con esas
-- palabras. SI ALGÚN DÍA alguien mete `upsert: true`, tiene que agregar la
-- policy de UPDATE **con** su `with_check` de carpeta, o abre exactamente el
-- agujero que `listing_photos_objects_update_own` cierra (un dueño renombrando
-- su objeto hacia la carpeta de otra persona).

-- Su consumidor real es el reemplazo: subir la foto nueva, escribir `foto_url`,
-- borrar la anterior. Ese es el único borrado que hace la app — no existe
-- ninguna acción de "quitar foto" en el diseño.
create policy avatars_objects_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- AQUÍ NO VA EL `revoke all ... from anon, authenticated`, Y NO ES UN OLVIDO.
-- Mismo motivo que 20260908000446: ese patrón (CLAUDE.md §1 y §9) existe por el
-- pg_default_acl sobre las tablas NUEVAS de `public`, que son nuestras. Esta no
-- lo es, y sus grants a authenticated son los que el servicio de Storage
-- necesita para funcionar. Revocarlos rompería Storage entero.
