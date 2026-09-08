-- Relevo — la foto guarda una RUTA de Storage, no una URL.
--
-- POR QUÉ EL RENOMBRE:
-- el bucket `listing-photos` es PRIVADO (config.toml), que es lo único que hace
-- real la regla "las fotos de una publicación pausada solo las ve su dueño". En
-- un bucket privado no existe una URL pública que guardar: lo que se persiste es
-- la ruta del objeto dentro del bucket (`{listing_id}/{uuid}.jpg`), y el cliente
-- la convierte en una petición autenticada. Con el nombre viejo, cualquiera que
-- leyera el esquema asumiría que ahí cabe un `https://…` y guardaría eso.
--
-- POR QUÉ AHORA Y NO DESPUÉS: la tabla tiene 0 filas. El bucket nunca existió
-- (storage.buckets estaba vacío en local y en remoto), así que no hay ni una foto
-- que migrar. Después del primer upload, el mismo cambio ya no es gratis.

alter table public.listing_photos rename column storage_url to storage_path;

-- SIN TOCAR LOS GRANTS, Y NO ES UN OLVIDO: el
-- `grant update (storage_url, orden)` de 20260906000439 sigue vigente sobre la
-- columna renombrada. Postgres guarda los privilegios de columna por número de
-- columna (pg_attribute.attnum), no por nombre, así que un `rename` los arrastra
-- solo. Re-otorgarlos aquí sería ruido, y revocarlos para "rehacerlos" abriría
-- una ventana de error sin ganar nada.
