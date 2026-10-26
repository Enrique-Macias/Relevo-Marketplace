# PL-001 — PROD-BOOTSTRAP: runbook

Estado: **BORRADOR, NO EJECUTADO (2026-10-26).** Todavía no se empieza: antes
van más funcionalidades de la app. Este archivo junta, en orden de ejecución,
lo que pide PL-001, para no tener que reconstruirlo cuando llegue el momento.

**Qué está en este archivo y qué está en otros:**
- `docs/PRE_LAUNCH_DEBT.md`:
  - la entrada PL-001 (origen, dependencias y titularidad);
  - la sección PROD-BOOTSTRAP: los principios, el inventario de la
    configuración que vive solo en el Dashboard y los 16 criterios de cierre.
    Esa sección manda, y este runbook no la sustituye: si los dos discrepan,
    gana ella y aquí se corrige.
- Este archivo: el ORDEN, las trampas de orden que ya mordieron en STAGING y lo
  que hay que remedir antes de empezar.
- Cada paso remoto se ejecuta con autorización explícita, como en las olas de
  RF-17. El usuario corre los comandos del CLI contra remoto (`db push`,
  `gen types --linked`, `seed buckets`, scripts que usan llave). Claude solo
  corre `SELECT` y GET públicos, salvo que se le autorice el paso concreto.

---

## 0. Antes de empezar: remedir, no confiar en este archivo

Este borrador se escribió con el repo en `87125e4`, y la app va a cambiar antes
del bootstrap. Todo número de aquí es una foto de esa fecha. Al arrancar se
REMIDE con su comando, y si no coincide gana el comando (CLAUDE.md §3, "la
moraleja").

| Dato | Valor al escribir | Comando |
|---|---|---|
| Migraciones en el repo | 53 (última `20261025000489`) | `ls supabase/migrations \| wc -l` |
| Edge Functions | 5: `send-push`, `moderar-contenido`, `eliminar-cuenta`, `eliminar-publicacion`, `admin-reset-mfa` (todas `verify_jwt = false`) | `ls supabase/functions`; `grep -n '^\[functions' supabase/config.toml` |
| Secretos de Edge Functions | `GOOGLE_CLOUD_VISION_API_KEY`, `OPENAI_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | `supabase/functions/.env.example` |
| Secretos de Vault | `moderar_contenido_function_url`, `moderar_contenido_secret_key`, `send_push_function_url`, `send_push_secret_key` | `grep -rn "vault.decrypted_secrets" supabase/migrations` |
| Jobs de pg_cron | 2: `purga-moderacion-retenida` (`17 4 * * *`), `purga-actividad-diaria` (`23 6 * * *`) | `grep -rn "cron.schedule(" supabase/migrations` |
| Buckets | `listing-photos` (privado), `avatars` (público) | `grep -n 'storage.buckets' supabase/config.toml` |
| Aserciones de `rls.sql` | 736 | el `grep` de CLAUDE.md §8 |
| Proyectos de Supabase | solo STAGING (`ukxfnydfhmryrzhdqkvj`) | Dashboard |

Para cada migración, Edge Function, secreto o job NUEVO que llegue antes del
bootstrap, revisar:
- **¿Necesita configuración fuera del repo?** (Dashboard, Vault, un secreto,
  una credencial de un tercero). Si sí, se agrega al inventario de
  PRE_LAUNCH_DEBT.md en el mismo cambio, no al llegar aquí.
- **¿Funciona sobre una base VACÍA?** Las migraciones se probaron siempre
  encima de datos (STAGING) o del `seed.sql` (local). Ejemplo ya conocido:
  `20261025000489` solo inserta `Alimentos` si existe "Otros"; en una base
  vacía no inserta ninguna categoría (punto 3.2).

**Prueba previa obligatoria:** aplicar las migraciones desde cero SIN seed, en
local (`supabase db reset --no-seed` o equivalente), y correr la verificación
del paso 3. Es el ensayo más barato de lo que va a pasar en PROD.

## 1. Decisiones previas (bloquean crear el proyecto)

| Decisión | Dónde se decide | Nota |
|---|---|---|
| Titularidad de la cuenta, la organización y la facturación | PL-014 | Bloquea crear el proyecto |
| Plan y región | PL-001 | STAGING está en us-east-1. PITR exige plan de pago |
| Backups/PITR y simulacro de restauración | PL-002 (D-17) | Activos ANTES de cargar datos reales |
| A qué backend apunta cada build | PL-003, PL-023 | `eas.json` hoy solo tiene `development` y `testflight-staging` |
| Catálogo inicial (universidades, campus, dominios) | PL-012, PL-029 | Coordenadas reales de campus |
| Admins de PROD y scripts | PL-025 | `REF_REMOTO` está fijo en STAGING (`scripts/crear-admin.mjs:81`) |
| Leaked password protection | PL-021 (D-18) | Se activa en el Dashboard |
| Dominio del panel de PROD | PL-025 | Hoy `admin.rlvo.com.mx` apunta a STAGING |

**Riesgo del CLI que hay que resolver antes del paso 2:** `npm run gen:types`
usa `--linked`, y el repo hoy está enlazado a STAGING. Con dos proyectos, un
`db push` o un `gen types` corridos con el enlace equivocado escriben en el
proyecto equivocado. Hay que decidir cómo se separan los dos (`supabase link`
explícito antes de cada paso, `--project-ref` o directorios distintos) e
imprimir el ref al inicio de cada comando remoto.

## 2. Proyecto y respaldo

1. Crear el proyecto PROD con el plan y la región decididos.
2. Activar backups/PITR (PL-002) antes de cualquier dato.
3. Anotar el ref, la URL y las llaves (publishable y una secret dedicada)
   en el gestor de contraseñas. Nunca en el repo.

## 3. Esquema

1. `supabase db push --dry-run` contra PROD: debe listar las N migraciones del
   punto 0, y ninguna más.
2. `supabase db push` (**sin** `--include-seed`, salvo decisión explícita).
   - `seed.sql` trae las 13 categorías, Tec de Monterrey, el campus Monterrey
     con coordenadas de desarrollo y el dominio `tec.mx`.
   - Las migraciones NO siembran categorías en una base vacía. Las 13 tienen
     que llegar por el seed o por el panel (Categorías).
   - **Decisión pendiente:** sembrar solo las categorías (un SQL derivado del
     bloque de `seed.sql`) o cargar todo desde el panel.
3. Verificar en PROD, con la misma consulta que en STAGING y comparando md5:
   - las funciones de `admin`, `private` y `public`;
   - las policies, CHECKs, constraints, índices y triggers;
   - los grants de tabla y de columna;
   - los 2 jobs de `cron.job`;
   - `supabase_realtime`.

   La referencia son las verificaciones F13/F18 de la Ola 6 y la del push de
   la fase 4 (CLAUDE.md §8, "Hecho"). Cualquier diferencia con STAGING se
   clasifica antes de seguir: de plataforma, o real.
4. **Exponer el schema `admin`** en el Dashboard (Settings → API) **DESPUÉS**
   del push, nunca antes: con el schema inexistente se cae TODO el API
   (CLAUDE.md §9).
5. Tipos: `gen types --linked` contra PROD. El contenido debe ser igual al de
   STAGING (solo puede cambiar `PostgrestVersion`).

## 4. Auth (Dashboard: `config push` NO se usa)

En este orden:
1. SMTP custom con Resend, y verificar que los registros de correo del dominio
   cubren el envío desde PROD.
2. Plantillas de correo (OTP con `{{ .Token }}`, `supabase/templates/`).
3. Site URL y Redirect URLs (las del panel de PROD).
4. Contraseña mínima de 8, MFA/TOTP activado y leaked password protection.
5. **Catálogo de dominios ANTES de activar el hook.** Con
   `universidad_dominios` vacía, el hook "Before User Created" rechaza TODA
   alta (CLAUDE.md §3). El orden es:
   1. universidades;
   2. campus (`agregar_dominio` exige que haya al menos un campus,
      `universidad_sin_campus`);
   3. dominios.

   Si el catálogo se carga desde el panel, hacen falta antes los admins
   (paso 7). Ellos no dependen del hook: `/admin/users` no pasa por él.
6. Activar el hook "Before User Created" →
   `pg-functions://postgres/public/hook_before_user_created`.

## 5. Storage

1. `supabase seed buckets --linked` contra PROD (un bucket no viaja con
   `db push`).
2. Verificar que `listing-photos` es privado, que `avatars` es público y que
   las policies de `storage.objects` son iguales a las de STAGING.

## 6. Edge Functions, secretos y Vault

1. Secretos de las funciones (`supabase secrets set`), con credenciales de
   PROD:
   - Vision, OpenAI y AWS;
   - un usuario de IAM con SOLO `rekognition:DetectModerationLabels`.
2. Desplegar las 5 funciones.
3. Vault: los 4 secretos, con la URL de PROD y una secret key de PROD.
   - Sin los de moderación, los triggers de Storage solo levantan un
     `warning`.
   - Sin los de push, los avisos se quedan en el inbox sin salir.
4. Verificar el perímetro de cada función: sin credencial → 401.

## 7. Admins y panel

1. Resolver PL-025 (`crear-admin.mjs` contra PROD).
2. Crear y activar los admins de PROD, cada uno con su TOTP.
3. Panel de PROD:
   - un build con `admin/.env.production.local` de PROD;
   - desplegado separado del de STAGING (otro proyecto de Pages u otro
     dominio, según PL-025);
   - preflight y la batería de 4 variantes de `admin/CLAUDE.md`
     ("Producción").
4. Cargar el catálogo (punto 4.5) y las categorías (punto 3.2), si van por el
   panel.

## 8. App

1. EAS: un perfil y un entorno de producción con
   `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` de
   PROD (PL-003, PL-023).
   - Ojo con el gotcha de `.env.local` (índice de deuda de CLAUDE.md §8): en
     dev se empaqueta y prevalece sobre las variables del proceso.
2. Push: APNs (la key ya cubre production) y FCM V1 (ya en EAS para
   `mx.com.rlvo.app`); prueba física contra PROD con un build de release
   (PL-020).
3. El build público apunta SOLO a PROD. Se comprueba en el binario, no en la
   config.

## 9. Smoke tests y cierre

Los criterios 14 a 16 de PROD-BOOTSTRAP. En corto:
1. Una alta real con el hook, comprobada con un `run_hook` en los logs de Auth.
2. Publicar, con la moderación de los dos veredictos.
3. Un push en iOS y otro en Android.
4. Eliminar una cuenta.
5. El panel: login con TOTP, métricas y auditoría.
6. Conteos de `auth.users`, `public.users`, `listings` y `admin_acciones` que
   solo tengan lo creado en el bootstrap. Cero filas de STAGING.
7. Un simulacro de restauración (PL-002).
8. Actualizar la documentación (PL-027):
   - CLAUDE.md §1 (proyecto y región);
   - §3 ("repo y remoto", ahora contra PROD);
   - §8;
   - los runbooks que hoy dicen "remoto" y quieren decir STAGING.
