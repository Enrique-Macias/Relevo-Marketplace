# Auditoría de preparación para las tiendas (solo lectura)

## Contexto
El usuario pidió una auditoría de SOLO LECTURA de 7 puntos antes de publicar en App Store y Google Play. Las respuestas se basan en evidencia del repo, en el stack local y en el proyecto remoto. No se proponen implementaciones. No se editó ningún archivo del repo. La única escritura fue una transacción en el stack local que terminó en ROLLBACK (punto 3), y después se comprobó que quedaron 0 filas.

## 1. Eliminación de cuenta: NO existe
- Un grep de `deleteUser|eliminar cuenta|borrar cuenta|delete account|auth.admin.delete` en `src/`, `supabase/functions`, las migraciones, el diseño y el spec solo encuentra `supabase/migrations/20260906000438_users_profiles.sql:87`: "ni de delete (borrar cuenta no está en el MVP)". No hay pantalla, RPC ni Edge Function para esto, y el diseño no tiene ningún frame.
- Las FK de abajo salen de `pg_constraint` en **remoto** y coinciden con las migraciones:

| Tabla.columna | → | ON DELETE |
|---|---|---|
| users.id | auth.users | CASCADE |
| listings.user_id | users | CASCADE |
| favorites.user_id | users | CASCADE |
| listing_contacts.user_id | users | CASCADE |
| ratings.from_user_id / to_user_id | users | CASCADE / CASCADE |
| reports.reporter_id | users | CASCADE |
| reports.reported_user_id | users | SET NULL (con snapshot `reported_user_correo`) |
| push_tokens.user_id | users | CASCADE |
| notifications.user_id | users | CASCADE |
| listing_sales.comprador_id | users | CASCADE |
| listing_photos, favorites, listing_contacts, ratings, listing_sales, listing_moderacion .listing_id | listings | CASCADE |
| reports.listing_id, notifications.listing_id | listings | SET NULL |

- Tablas que son "historia inmutable" por diseño, sin DELETE para el cliente: `listing_sales` (sin DELETE, UPDATE solo de `comprador_id`), `ratings` (sin DELETE), `reports` (sobreviven al objetivo mediante SET NULL + snapshot) y `notifications` (sin insert ni delete del cliente). Sin embargo, las FK hacen que un `delete from auth.users` **borre en cascada** `ratings` en las dos direcciones, las `listing_sales` del comprador, las del vendedor (a través de listings) y los reportes que hizo el usuario. La inmutabilidad protege solo frente al cliente, no frente al borrado de la cuenta.
- `storage.objects` no tiene FK hacia users ni hacia listings. Borrar la cuenta dejaría huérfanos los objetos de `avatars` y de `listing-photos`.

## 2. Bloqueo entre usuarios: NO existe
El grep de `block_users|user_blocks|bloquear usuario|blocked_user` no encuentra nada en src, supabase, el diseño ni el spec. Los únicos resultados son otros usos de la palabra "bloqueo" (`decision.ts:147` y `rls.sql:1405`, que hablan de moderación y de estados). No hay tabla, policy ni UI para esto. Lo que sí existe es "Reportar usuario/publicación" (RF-14).

## 3. Fotos de una publicación `bloqueada`: el DUEÑO SÍ puede leerlas
Las definiciones actuales se leyeron de `pg_policy` en **remoto** y en local, y son idénticas en los dos:
- `listings_select` (última versión en `20260917000459:44-46`): `estado <> ALL('{pausada,pendiente,bloqueada}') OR user_id = auth.uid()`
- `listing_photos_objects_select` (`20260908000446:100-108`, no se ha redefinido desde entonces): `bucket_id='listing-photos' AND EXISTS(select 1 from listings l where l.id = private.listing_id_from_object_name(name) AND (l.estado <> 'pausada' OR l.user_id = auth.uid()))`
- Por la definición: para el dueño, el `exists` pasa `listings_select` gracias a la rama `user_id = auth.uid()`, y el filtro inline `estado <> 'pausada'` es verdadero para una `bloqueada`. Resultado: el dueño lee sus fotos. Para cualquier otro usuario, el `exists` ya llega vacío desde `listings_select`.
- **Lectura real** en el stack local: una transacción con ROLLBACK que sembró una publicación `bloqueada`, un objeto y una fila en `listing_photos`, y leyó con `role authenticated` + `request.jwt.claims`:
  - DUEÑO: listings 1 · listing_photos 1 · storage.objects 1
  - OTRO usuario: 0 · 0 · 0
- **Alcance honesto:** la prueba se hizo por SQL sobre `storage.objects`. No se hizo por `GET /storage/v1/object/authenticated/...`, que es el endpoint que usa `ListingPhoto`. La policy es la misma, pero no se midió por HTTP.

## 4. Observabilidad (RNF-10): NO hay nada
- `package.json` no incluye ningún SDK de errores ni de analítica. El grep de `sentry|bugsnag|crashlytics|datadog|posthog|amplitude|mixpanel` da 0 resultados.
- Tampoco hay captura global de errores: `ErrorUtils|setGlobalHandler|ErrorBoundary|onunhandledrejection` da 0 resultados en `src/`, y `src/app/_layout.tsx` no exporta `ErrorBoundary`.
- Métricas: no hay nada aparte de lo que se puede consultar en Studio (tablas, logs de Edge Functions y de la plataforma). RNF-10 (`docs/product-spec.md:305-307`) pide "logs de errores y métricas básicas (publicaciones creadas, usuarios activos, contactos generados) desde el día uno", así que **no se cumple**.

## 5. Configuración de release
- No existe `app.config.*`. `app.json`:
  - `name: "relevo-marketplace"`, `slug: "enrique-macias"`, `version: "1.0.0"`, `owner: enrique-maciass-team`, EAS `projectId 920c85e0-…`.
  - iOS: `bundleIdentifier: com.enrique-macias.relevo-marketplace`, `icon: ./assets/expo.icon`. No hay `buildNumber`.
  - Android: `package: com.enriquemacias.enriquemacias` (el nombre sale del slug y no coincide con el de iOS). No hay `versionCode`. Declara el permiso `android.permission.RECORD_AUDIO`, que ningún código usa.
  - **No hay `runtimeVersion`**, y `expo-updates` no está instalado.
  - Splash: `#208AEF` + `splash-icon.png`. Fondo del adaptive icon de Android: `#E6F4FE`. **Ninguno de los dos es un token de la marca** (`--paper #F3F0EA`, `--brick #C1440E`), así que casi seguro son los valores del template de create-expo-app.
- **`eas.json` NO existe**, así que no hay perfiles de build ni de submit.
- **`android/` NO existe.** `ios/` sí existe localmente, pero `.gitignore:43-44` ignora `/ios` y `/android` (prebuild/CNG). El `ios/` local tiene `PRODUCT_BUNDLE_IDENTIFIER = com.enrique-macias.relevo-marketplace`, `CFBundleShortVersionString 1.0.0`, `CFBundleVersion 1` y `PrivacyInfo.xcprivacy`.
- **Hallazgo lateral importante:** `package.json` tiene `expo.autolinking.exclude: ["expo-notifications"]` (commit 3f847b4, "Apple personal teams"), e `ios/Podfile.lock` no contiene expo-notifications. Mientras esa exclusión exista, **ningún build lleva el módulo nativo de push**. `src/lib/push.ts:19-30` lo carga con un `require` dentro de un try y falla sin avisar.

## 6. Privacidad: NO hay ningún enlace
- `src/app/(onboarding)/verificacion.tsx:88-90`: "Al continuar aceptas los Términos de uso y el Aviso de privacidad de Relevo." Es texto plano dentro de `<AuthTerms>`, sin `onPress` ni URL. En toda la app, `Linking.openURL` solo se usa para WhatsApp (`detalle/[id].tsx:337`, `perfil-publico/[id].tsx:116`), y no hay ningún `openBrowserAsync`.
- `app.json` no tiene ninguna URL de privacidad ni de términos. El diseño (`relevo-app.html:2062`) tiene el mismo texto, también sin enlace.
- **Pendiente de contenido para cuando exista el Aviso de privacidad real (fase 2C, "Detectar campus más cercano"):** debe declarar el uso de ubicación aproximada, obtenida y usada SOLO en el dispositivo (`src/lib/geolocalizacion.ts` + `src/lib/ubicacion.ts`), nunca enviada a Supabase ni a ningún tercero, y nunca guardada — ni en la base ni en almacenamiento local. Verificado por grep en CLAUDE.md §3 (bloque de `campus.latitud`/`longitud`). Esto no crea el documento —sigue sin existir, ver el punto de arriba—, solo anota qué debe decir cuando se escriba.

## 7. Push en remoto: los secretos NO están
`select name from vault.secrets where name like 'send_push_%'` en remoto devuelve **0 filas**. Como referencia, `moderar_contenido_function_url` y `moderar_contenido_secret_key` sí están.

## Discrepancias entre la prosa de CLAUDE.md y el código
- En §9 ("Cannot find native module") el bundle id del dev build aparece como `com.enrique-macias.enrique-macias`. Desde el commit 3f847b4 el bundle id es `com.enrique-macias.relevo-marketplace` (app.json y pbxproj:401,436).
- CLAUDE.md no menciona en ninguna parte la exclusión de `expo-notifications` del autolinking. Pendiente 1 de §8 dice que "el código está completo" y que solo faltan credenciales y Vault, pero además el módulo nativo no se enlaza en ningún build.

## Tabla resumen

| Punto | Estado real | ¿Bloquea App Store / Google Play? | Evidencia |
|---|---|---|---|
| 1. Borrar cuenta | No existe. Las FK en CASCADE borrarían la "historia inmutable", y Storage queda huérfano | **Sí / Sí** (Apple 5.1.1(v); Play exige borrado en la app y por web) | `20260906000438:87`; `pg_constraint` remoto |
| 2. Bloquear usuarios | No existe | **Sí en App Store** (1.2 UGC exige bloqueo). En Play es riesgo, no requisito explícito | grep sin resultados |
| 3. Fotos de `bloqueada` | El dueño las lee, los demás no | No | `pg_policy` remoto+local; lectura local 1/1/1 contra 0/0/0 (SQL, no HTTP) |
| 4. Observabilidad | Sin SDK, sin handler global, sin métricas | No (pero incumple RNF-10) | package.json; grep en src |
| 5. Release | Sin eas.json, sin runtimeVersion/buildNumber/versionCode, splash e ícono Android del template, RECORD_AUDIO sin usar, push excluido del autolinking | **Sí en la práctica** (sin eas.json no hay EAS Build/Submit). RECORD_AUDIO es riesgo de revisión en Play | app.json; `ls eas.json android`; package.json `autolinking` |
| 6. Privacidad | Solo texto, ningún enlace | **Sí / Sí** (las dos tiendas exigen URL de política y acceso a ella en la app) | `verificacion.tsx:88-90`; app.json |
| 7. Secretos de push | 0 secretos `send_push_%` | No bloquea la publicación. Push no funciona (también por el punto 5) | query de vault en remoto |
