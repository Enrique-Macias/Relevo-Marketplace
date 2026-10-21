# RLVO — Pre-Launch Debt

Documento vivo con todo lo que se sabe pendiente antes del **lanzamiento
público** de RLVO (App Store / Google Play con usuarios reales). Creado el
2026-10-12 (checkpoint PRE-LAUNCH-1) a partir de una auditoría del repo, del
historial de git y de los checkpoints de RF-17 (Olas 1-6, F0-F28), C3, AUTH-1,
AUTH-2 y DEV-1A/B.

> **Ambientes — leer primero**
>
> | Ambiente | Proyecto Supabase | Uso |
> |---|---|---|
> | **STAGING** | `ukxfnydfhmryrzhdqkvj` (us-east-1) | Desarrollo compartido, pruebas, socios y **TestFlight**. Solo contiene cuentas y datos de prueba. Seguirá existiendo después del lanzamiento. |
> | **PROD** | **No existe todavía.** | Se creará **limpio** con [PROD-BOOTSTRAP](#prod-bootstrap) antes del lanzamiento público. |
>
> **Frontera operacional:**
> desarrollo / socios / TestFlight → **STAGING** ·
> App Store / Google Play pública + usuarios reales → **PROD**.
>
> **Nomenclatura de EAS (decidida en TESTFLIGHT-1C.2, 2026-10-16):** el
> environment de EAS **`preview` = STAGING**, y solo STAGING; el build profile
> **`testflight-staging`** (`eas.json`) es TestFlight contra STAGING y usa ese
> environment. **`production`** (environment y profile) queda reservado para
> PROD y no se configura hasta que PROD exista. Se usa `preview` y no un
> environment `staging` porque la cuenta de Expo está en el plan Free, y los
> environments personalizados exigen el plan Production o Enterprise.
>
> **Nunca se copia íntegramente STAGING → PROD.** PROD se construye desde lo
> reproducible (migraciones, funciones, configuración inventariada); las cuentas
> y los datos de STAGING no se transportan.

---

## Cómo usar este documento

- **Cada deuda tiene un ID estable `PL-xxx`** que no se reutiliza ni se
  renumera. Las referencias históricas (D-17, D-18, F21-C, L6…) se conservan
  junto al ID para poder rastrear el origen.
- **Plantilla de cada entrada:** origen · estado · prioridad · momento
  recomendado · por qué existe · evidencia actual · qué falta · criterio de
  cierre · dependencias.
- **Estados** (los únicos válidos):
  - `ABIERTO`: hay trabajo definido por hacer.
  - `DECISIÓN PENDIENTE`: no se puede diseñar ni cerrar hasta decidir algo
    (producto, legal o tienda). El criterio de cierre final se fija después de
    la decisión.
  - `EVIDENCIA PENDIENTE`: lo implementado existe y está aceptado; falta una
    prueba adicional (no reabre la funcionalidad).
  - `CONDICIONAL`: solo se actúa si se cumple el disparador indicado.
  - `POSPUESTO`: decidido explícitamente para después del lanzamiento.
  - `CERRADO`: solo con evidencia citada (commit, checkpoint o medición).
- **Cerrar una deuda** = cambiar su estado a `CERRADO`, añadir la evidencia y
  moverla a [Cerrado — referencia](#cerrado--referencia). No se borra.
- **"Cerrado" en STAGING no es "cerrado" en PROD.** Lo implementado y probado
  en STAGING se vuelve a comprobar en los smoke tests de PROD-BOOTSTRAP.
- **Antes del primer TestFlight** (aunque no bloquea el desarrollo con Metro):
  PL-023 (fase PRE-TESTFLIGHT), PL-011 (bundle id de iOS, que App Store
  Connect fija) y la cuenta de Apple Developer de pago (dependencia de PL-020).

---

## Estado de ambientes

- **STAGING (`ukxfnydfhmryrzhdqkvj`)**: 52 migraciones aplicadas (a la par con
  el repo al 2026-10-16; las dos últimas, `…487` y `…488`, son UGC-1, PL-006),
  5 Edge Functions, panel de admin desplegado en
  `https://admin.rlvo.com.mx` (Cloudflare Pages) **apuntando a STAGING**, 3
  admins activos con TOTP, el Auth Hook de dominios activo (evidencia nueva de
  `run_hook`: 2026-10-12 02:15:05 UTC, C3). La app de desarrollo (Metro +
  `.env.local`) apunta a STAGING. **Push iOS validado de punta a punta en
  STAGING** (2026-10-12, PL-020): `send-push` v13 y los dos secretos
  `send_push_*` en Vault, así que cada INSERT en `notifications` envía un push
  real a quien tenga token (hoy, solo el usuario de prueba).
- **Documentación histórica:** `CLAUDE.md`, `admin/CLAUDE.md`,
  `docs/admin-runbook.md` y los planes de RF-17 llaman "producción" / "EN
  PRODUCCIÓN" a lo que hoy es STAGING. Se lee como "STAGING" hasta que PL-027
  lo corrija.
- **PROD:** no existe. Ver PROD-BOOTSTRAP.

---

## P0 — Bloqueadores antes de usuarios reales

### PL-001 — PROD-BOOTSTRAP: Supabase PROD limpio
- **Origen:** decisión operativa del 2026-10-12 · **Estado:** ABIERTO · **Prioridad:** P0
- **Momento:** antes del lanzamiento público. **No** es requisito del desarrollo
  ni de TestFlight (que usan STAGING).
- **Por qué existe:** STAGING contiene cuentas y datos de prueba y configuración
  que en parte vive solo en el Dashboard; el lanzamiento necesita un proyecto
  limpio y reproducible.
- **Evidencia actual:** solo existe STAGING.
- **Qué falta / criterio de cierre:** la sección [PROD-BOOTSTRAP](#prod-bootstrap) completa.
- **Dependencias:** PL-002, PL-003, PL-012, PL-020 (Vault de push), PL-021, PL-025, PL-029.

### PL-002 — Respaldos, PITR y restauración en PROD (D-17)
- **Origen:** D-17 (Ola 3 paso 2; Ola 6 F14) · **Estado:** ABIERTO · **Prioridad:** P0
- **Momento:** activo desde el primer día de PROD (parte de PROD-BOOTSTRAP).
- **Por qué existe:** el proyecto actual no tiene backups ni PITR; los únicos
  respaldos son tres copias cifradas manuales de STAGING (2026-10-01,
  2026-10-09 y 2026-10-10), fotografías puntuales sin estrategia. Storage (los
  archivos) no está respaldado en ninguna.
- **Evidencia actual:** `CLAUDE.md` §8 ("Hecho", Panel de admin, "Respaldo");
  `docs/admin-runbook.md` §8.
- **Qué falta:** elegir plan de Supabase de PROD (backups diarios y/o PITR),
  estrategia para Storage, y un **simulacro de restauración** documentado.
- **Criterio de cierre:** en PROD, backups/PITR visibles como activos en el
  Dashboard; una restauración de prueba (a un proyecto aparte) ejecutada y
  verificada con conteos; procedimiento escrito en el runbook.
- **Dependencias:** PL-001; decisión de plan (costo).

### PL-003 — La build pública apunta exclusivamente a PROD
- **Origen:** DEV-1A/B · **Estado:** ABIERTO · **Prioridad:** P0
- **Momento:** antes de la primera build pública.
- **Por qué existe:** hoy no hay `eas.json` ni separación de ambientes; la
  configuración de Supabase sale de `.env.local`, que apunta a STAGING.
- **Evidencia actual:** DEV-1B M4 (medido): un export de producción inlinea
  `.env.production.local` e ignora `.env.development.local`; M1: en desarrollo
  los archivos `.env*` ganan sobre el proceso.
- **Qué falta:** perfiles de build con la configuración de PROD y una
  verificación fail-fast "release nunca apunta a localhost, red privada ni a
  STAGING" (diseño DEV-1A).
- **Criterio de cierre:** una build release generada por el perfil público
  contiene la URL de PROD y no la de STAGING ni localhost (grep del bundle), y
  una build release forzada contra STAGING/localhost **falla** en la
  verificación.
- **Dependencias:** PL-001, PL-023, PL-024.

### PL-004 — Confirmación de mayoría de edad (18+)
- **Origen:** `docs/LEGAL_FACTS.md` §3 · **Estado:** DECISIÓN PENDIENTE · **Prioridad:** P0
- **Por qué existe:** RLVO está definido como servicio exclusivamente 18+;
  la app no muestra ninguna confirmación (0 resultados en `src/`).
- **Decisiones pendientes:** UX exacta de la confirmación; en qué momento se
  solicita; si debe persistirse y dónde; validación legal y de tienda del
  mecanismo elegido. **No está decidido** que deba ser una aceptación
  persistida en el servidor.
- **Criterio de cierre:** se define después de la decisión (frame primero,
  `CLAUDE.md` §0 regla 4).
- **Dependencias:** PL-008 (Términos), PL-010 (clasificación de edad en tiendas).

### PL-005 — Proveedores externos de moderación (OpenAI, Google Cloud Vision, Amazon Rekognition)
- **Origen:** `docs/LEGAL_FACTS.md` §22; RF-18 · **Prioridad:** P0
- **A. Transparencia / privacidad** · **Estado:** ABIERTO
  - Documentar en el aviso de privacidad (y en las tiendas) que texto e
    imágenes se envían a esos tres proveedores, con qué fin y retención.
  - **Criterio de cierre:** el aviso publicado y los cuestionarios de tiendas
    los mencionan, revisado por el abogado (forma parte de PL-008/PL-010).
- **B. Consentimiento o aceptación específica** · **Estado:** DECISIÓN PENDIENTE
  - `LEGAL_FACTS.md` §22 describe una aceptación previa comprobada en el
    servidor, pero **no está validado** que sea necesaria. Determinarlo con
    revisión legal y de políticas de tienda antes de diseñar nada.
  - **Criterio de cierre:** se define después de esa validación.
- **Dependencias:** PL-008, PL-010.

### PL-006 — Bloqueo entre usuarios (contenido generado por usuarios)
- **Origen:** `docs/auditoria-lanzamiento-2026-09-22.md` §2 · **Estado:** IMPLEMENTADO Y VALIDADO EN STAGING; PROD PENDIENTE · **Prioridad:** P0 (potencial)
- **Por qué existe:** la auditoría lo identificó como posible requisito de
  UGC (App Store 1.2). Antes de UGC-1 solo existía "Reportar" (RF-14).
- **Qué se hizo (UGC-1, 2026-10-12 al 2026-10-16):**
  - **Semántica aprobada en UGC-1A** (detalle en `CLAUDE.md` §3, "Bloqueo
    entre usuarios"): híbrida. Descubrimiento y contacto se cortan en las DOS
    direcciones; cada quien ve y deshace SOLO su propio bloqueo; las reseñas,
    los contactos, las ventas, los avisos y los reportes anteriores se
    conservan. Dos decisiones quedaron como deuda: PL-087 (O-2) y PL-052 (O-5).
  - **Diseño:** 8 frames nuevos en `design/relevo-app.html` (73 → 81).
  - **Base:** `20261013000487_user_bloqueos.sql` y
    `20261015000488_increment_listing_view_bloqueo.sql`.
  - **Cliente:** Perfil público, Detalle, Reportar, Configuración → Usuarios
    bloqueados.
- **Validación:**
  - **LOCAL:** `rls.sql` 715/715 (T40), `scripts/probe-bloqueos.mjs` 24/24 y
    el resto de los probes en verde; controles negativos uno por uno (20/20
    para `…487`, 6/6 para `…488`).
  - **STAGING:** preflight read-only, copia cifrada previa (2026-10-15),
    `db push` de `…487` y luego de `…488`, cada uno con su verificación de
    superficie (solo cambió lo esperado) y sin efectos sobre datos.
  - **iPhone físico contra STAGING:** bloquear y desbloquear, el estado
    bloqueado y el neutro, "Usuarios bloqueados", y el fix de vistas (con el
    bloqueo vigente no suma; sin él, +1 exacto).
- **Qué falta:**
  - **PROD:** no existe. Las dos migraciones viajan con PL-001 (PROD-BOOTSTRAP);
    la validación de STAGING no la sustituye.
  - **La cita de la política sigue PENDIENTE.** El criterio de cierre original
    pedía documentar la regla de App Store / Google Play que lo exige y su
    alcance, y esa cita no está registrada en ningún documento del repo. Se
    implementó por decisión de producto (UGC-1A), no con una cita verificada.
- **Criterio de cierre:** las dos migraciones aplicadas y verificadas en PROD
  (PL-001) **y** la cita de la política documentada (o, si la revisión concluye
  que no es requisito, esa conclusión documentada con su fuente).
- **Dependencias:** PL-001, PL-010.

### PL-007 — Enlaces al aviso de privacidad y a los términos dentro de la app
- **Origen:** auditoría §6 · **Estado:** ABIERTO · **Prioridad:** P0
- **Por qué existe:** las dos tiendas exigen acceso a la política desde la app.
- **Evidencia actual:** `src/app/(onboarding)/verificacion.tsx:119-121` es texto
  plano ("Al continuar aceptas…") sin enlace. En
  `src/lib/configuracion.ts:37-38,100-103` la URL real es **igual** al valor
  centinela que oculta las filas "Aviso de privacidad" y "Términos de uso", así
  que en release nunca se muestran.
- **Criterio de cierre:** en una build release, Verificación y Configuración
  abren las páginas publicadas; probado en dispositivo.
- **Dependencias:** PL-008 (páginas finales).

### PL-008 — Aviso de privacidad y términos finales (entidad, responsable, revisión legal)
- **Origen:** `docs/LEGAL_LAUNCH_CHECKLIST.md` (Corporate, Privacy Notice, Terms); auditoría §6 · **Estado:** ABIERTO · **Prioridad:** P0
- **Por qué existe:** las páginas existen como borradores (`noindex`) y falta la
  base legal.
- **Qué falta:**
  - entidad legal, nombre, RFC, domicilio y representante; responsable y
    flujo interno de solicitudes ARCO;
  - contenidos pendientes del aviso: señal diaria de actividad (90 días) y
    métricas agregadas; hash sin sal e indefinido de correos de cuentas
    eliminadas estando suspendidas; `admin_correo` (append-only) y su trato en
    ARCO; respaldos y su retención; ubicación usada solo en el dispositivo;
    intereses y "Recomendados para ti"; qué se borra y qué se conserva sin
    identidad al eliminar la cuenta; proveedores de moderación (PL-005 A);
    Web Analytics y Sentry **solo si se adoptan**;
  - validación con abogado mexicano de finalidades, bases, transferencias,
    ARCO, retención del hash, limitación de responsabilidad, consumo,
    jurisdicción y procedimiento de PI;
  - versión final, fechas de vigencia y retirar `noindex`.
- **Criterio de cierre:** aviso y términos finales publicados en las URLs
  definitivas, con fecha de vigencia, sin `noindex`, aprobados por el abogado,
  y cada contenido de la lista anterior presente o descartado por escrito.
- **Dependencias:** PL-005, PL-028.

### PL-009 — URL web para solicitar la eliminación de la cuenta (Google Play)
- **Origen:** pendiente 0i de `CLAUDE.md` §8 · **Estado:** ABIERTO · **Prioridad:** P0 (Google Play)
- **Evidencia actual:** el flujo dentro de la app existe (`eliminar-cuenta`);
  la página `/eliminar-cuenta` existe pero no refleja el procedimiento final.
- **Criterio de cierre:** página pública con el procedimiento desde la app y
  la vía externa verificada (correo de soporte), enlazada en la ficha de Play.
- **Dependencias:** PL-008.

### PL-010 — Cuestionarios y declaraciones de las tiendas
- **Origen:** checklist (App Store / Google Play) · **Estado:** ABIERTO · **Prioridad:** P0
- **Qué falta:** privacidad de Apple, Data Safety de Google Play, declaraciones
  de SDK, clasificación 18+, requisitos de contenido generado por usuarios
  (PL-006) y URLs públicas (PL-007/PL-009).
- **Criterio de cierre:** cuestionarios enviados con los flujos de datos de la
  build de PROD y revisados contra el comportamiento real.
- **Dependencias:** PL-004, PL-005, PL-006, PL-008, PL-009, PL-011, PL-022.

### PL-011 — Identidad y configuración de la app para tiendas
- **Origen:** auditoría §5 · **Estado:** DECISIÓN PENDIENTE · **Prioridad:** P0
- **Momento:** el bundle id de iOS, **antes del primer TestFlight**; el paquete
  de Android, antes de la primera subida a Play. Los dos son inmutables una vez
  registrados.
- **Evidencia actual (`app.json`):** iOS `mx.com.rlvo.app` (desde `f5a2648`;
  App ID registrado en Apple en PUSH-2 y app creada en App Store Connect en
  TESTFLIGHT-1A, así que ya es inmutable); Android `mx.com.rlvo.app` (desde
  ANDROID-1B, antes del primer build de Android: el package definitivo, igual
  que el bundle id de iOS a propósito; antes era
  `com.enriquemacias.enriquemacias`). Todavía no hay ningún build de Android
  validado ni app en Google Play, así que el package aún no está registrado.
  `src/lib/configuracion.ts` sigue esperando `com.enriquemacias.relevo` (no
  coincide); sin `buildNumber`/`versionCode`; splash `#208AEF` y fondo del ícono adaptativo
  `#E6F4FE` (valores del template, no tokens de marca); permiso
  `android.permission.RECORD_AUDIO` sin uso; `name: RLVO`,
  `slug: enrique-macias`.
- **Criterio de cierre:** identificadores definitivos decididos y aplicados,
  versionado definido, íconos y splash con la marca, permisos sin uso
  eliminados; `configuracion.ts` coherente con los identificadores.

### PL-012 — `exatec.tec.mx` en el catálogo de dominios
- **Origen:** discrepancia `docs/LEGAL_FACTS.md` (sección de dominios: "no
  deberá aceptarse") vs STAGING (activo) · **Estado:** DECISIÓN PENDIENTE · **Prioridad:** P0
- **Qué falta:** decidir si exalumnos pueden registrarse. **No se cambia el
  catálogo ni el código** hasta decidir.
- **Criterio de cierre:** decisión escrita; `LEGAL_FACTS.md` y el catálogo
  inicial de PROD coherentes con ella. Hasta entonces, no entra al catálogo de
  PROD.

---

## PROD-BOOTSTRAP

Checkpoint **futuro**, no ejecutado. Crea el proyecto Supabase PROD limpio para
el lanzamiento público. Se ejecuta por pasos con autorización, igual que las
olas de RF-17.

### Principios
- PROD se construye desde lo reproducible, **nunca** clonando STAGING.
- Lo que no está versionado se reconstruye desde el inventario de abajo y se
  verifica uno por uno.
- STAGING sigue existiendo para desarrollo y pruebas.

### Configuración no completamente versionada
Crear PROD solo con las migraciones daría una **falsa sensación de
reproducibilidad**: parte de la configuración actual vive en el Dashboard de
STAGING (`supabase config push` no se usa en este repo, `CLAUDE.md` §9). Hay que
reconstruir y verificar:

| Elemento | Dónde vive hoy | Referencia en el repo |
|---|---|---|
| SMTP custom (Resend, dominio verificado) | Dashboard | `CLAUDE.md` §1 (correo transaccional); `config.toml` lo tiene comentado |
| Plantillas de correo (OTP con `{{ .Token }}`) | Dashboard | `supabase/templates/magic_link.html` |
| Site URL | Dashboard | `config.toml` trae un valor local (`http://127.0.0.1:3000`) |
| Redirect URLs (p. ej. `https://admin.rlvo.com.mx/**`) | Dashboard | `docs/rf17-plan-admin.md` §11 |
| Auth Hook "Before User Created" | Dashboard | `config.toml` `[auth.hook.before_user_created]`; función en migraciones |
| MFA / TOTP habilitado | Dashboard | `config.toml` `[auth.mfa.totp]` |
| Contraseña mínima (8) | Dashboard | `config.toml` `minimum_password_length = 8` |
| Esquema `admin` expuesto (**después** del push) | Dashboard | `config.toml` `schemas`; `CLAUDE.md` §9 |
| Otros ajustes de Auth (rate limits, leaked password protection, expiración de JWT) | Dashboard | D-18 (PL-021); la expiración real de STAGING no está medida |
| Vault: `moderar_contenido_function_url`, `moderar_contenido_secret_key`, `send_push_function_url`, `send_push_secret_key` | Vault (SQL manual) | migraciones que los leen; `CLAUDE.md` §8 pendiente 1 |
| Secretos de Edge Functions: `GOOGLE_CLOUD_VISION_API_KEY`, `OPENAI_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` | Dashboard / CLI | `supabase/functions/.env.example` |
| Buckets `listing-photos` y `avatars` | `supabase seed buckets --linked` | `config.toml` `[storage.buckets.*]` |
| Catálogo inicial (universidades, campus con coordenadas, dominios) | Hoy creado desde el panel en STAGING | `seed.sql` solo trae Tec; PL-012, PL-029 |
| Admins (cuentas, TOTP, activación) | `scripts/crear-admin.mjs --remoto` | `REF_REMOTO` fijo en STAGING (PL-025) |
| Panel de admin para PROD | Cloudflare Pages + `admin/.env.production.local` | hoy `admin.rlvo.com.mx` apunta a STAGING |
| Credenciales de push (FCM V1, APNs) | EAS / consolas | PL-020 |

### Criterio de cierre
1. Proyecto PROD nuevo, con plan y región decididos, y backups/PITR activos (PL-002).
2. Las migraciones del repo aplicadas desde cero; `db push --dry-run` limpio; tipos generados desde PROD.
3. Auth configurado según el inventario: SMTP, plantillas, Site URL, redirects, contraseña mínima, MFA/TOTP, leaked password protection (PL-021).
4. Hook "Before User Created" activo y verificado con un `run_hook` real en los logs.
5. Esquema `admin` expuesto después del push.
6. Buckets creados y sus policies verificadas.
7. Las 5 Edge Functions desplegadas con sus secretos.
8. Vault completo (moderación y push).
9. Los 2 jobs de pg_cron activos (`purga-moderacion-retenida`, `purga-actividad-diaria`).
10. Catálogo inicial cargado según PL-012 y PL-029.
11. Admins de PROD creados y activados con TOTP (PL-025).
12. Panel de admin de PROD desplegado contra PROD y claramente separado del de STAGING.
13. Build pública de la app apuntando exclusivamente a PROD (PL-003).
14. Smoke tests en PROD: alta con hook, moderación, push, eliminación de cuenta, panel (login, métricas, auditoría).
15. **Cero cuentas o filas de STAGING en PROD**, comprobado con conteos (`auth.users`, `public.users`, `listings`, `admin_acciones` solo con lo creado en el bootstrap).
16. Un simulacro de restauración ejecutado (PL-002) y la documentación actualizada (PL-027).

---

## P1 — Requerido antes del lanzamiento público

### PL-020 — Push real (RF-16)
- **Origen:** pendiente 1 de `CLAUDE.md` §8; auditoría §5 y §7 · **Estado:** ABIERTO (iOS validado de punta a punta **en STAGING**; falta PROD y Android) · **Prioridad:** P1
- **Por qué existe:** hasta el 2026-10-12 ningún push había llegado a un
  teléfono: `expo-notifications` estaba excluido del autolinking (cuenta
  personal de Apple) y no había APNs ni secretos `send_push_*`.
- **Evidencia actual — STAGING, iOS (checkpoints PUSH-2 a PUSH-8, 2026-10-12):**
  - PUSH-2: App ID `mx.com.rlvo.app` con Push (sin Broadcast), APNs Auth Key
    (Sandbox & Production, Team Scoped) asociada en EAS.
  - PUSH-3: `expo-notifications` habilitado (plugin y autolinking),
    `expo-dev-client`, `eas.json` (`development`), SDK 57 alineado (`f5a2648`).
  - PUSH-4: primer development build de EAS (Ad Hoc) instalado en un iPhone
    físico; contexto del upload reducido (`76d3137`); cifrado exento
    declarado (`d4e8d18`); CNG puro, sin `ios/` local.
  - PUSH-5: permiso de iOS concedido, Expo Push Token en `push_tokens` (1 fila,
    idempotente al reabrir), cierre/inicio de sesión: el token se borra y se
    vuelve a registrar.
  - PUSH-6: envío directo Expo → APNs → iPhone, ticket y receipt `ok`.
  - PUSH-7: `@supabase/server@1.7.0` fijado en `send-push` (`564bedd`, v13);
    `send_push_secret_key`/`send_push_function_url` en Vault; sin credencial →
    401; autenticado con un `notification_id` inexistente → 404, cero pushes.
  - PUSH-8: INSERT en `notifications` → trigger → Vault → `send-push` →
    `push_tokens` → Expo → APNs → iPhone: **una** notificación visible
    (fila 39, request de `pg_net` 47, `enviados: 1`), `push_enviado_at` sellado
    solo en esa fila; las 35 históricas intactas.
- **Qué falta:**
  - **PROD (bloquea el lanzamiento):** desplegar `send-push`, crear los dos
    secretos `send_push_*` en el Vault de PROD y repetir en PROD la prueba
    física (PROD-BOOTSTRAP criterios 8 y 14). La build de tienda/TestFlight
    registra tokens de APNs production; la key ya cubre los dos entornos.
  - **Android:** service account de FCM V1 en EAS, build de Android y prueba
    física — solo si el lanzamiento incluye Android (PL-011).
  - **Android — hardening de la API key de cliente de Firebase** (después del
    push E2E en Android y antes de PROD/lanzamiento público; ANDROID-PUSH-SEC-1
    a SEC-3, 2026-10-20):
    - `google-services.json` está versionado a propósito (`386a8cd`): es
      configuración de cliente con identificadores públicos (docs de Firebase
      y de Expo), y su API key viaja de todos modos dentro de cada APK. GitHub
      Secret Scanning la detecta como "Google API Key" (alerta #1); se resuelve
      como exposición intencional, no como fuga.
    - Una **service account JSON / private key** (la de FCM V1) es otra cosa:
      **nunca** entra al repo.
    - Estado revisado en Google Cloud: la key "Android key (auto created by
      Firebase)" tiene API restrictions con las 25 APIs que Firebase pone por
      default (ninguna ajena a Firebase) y Application restrictions = None.
      Firebase AI Logic, Generative Language y Vertex AI están deshabilitadas
      en el proyecto. No se rota ni se reescribe el historial.
    - Pendiente (A): reducir las API restrictions al conjunto que RLVO use de
      verdad (como mínimo FCM Registration e Installations) y repetir el push
      E2E después de recortarlas.
    - Pendiente (B): evaluar y aplicar la restricción "Android apps" con el
      package `mx.com.rlvo.app` y su SHA-1.
    - Pendiente (C): al poner SHA-1, incluir el de **cada** certificado que
      firme la app: el de EAS y, si Android se publica en Google Play, el de
      Play App Signing. Un SHA-1 faltante puede romper el registro del token,
      así que se verifica con un push real después del cambio.
  - Hardening de `send-push` y del ciclo de vida del token: PL-049 a PL-051
    (P2) y PL-064/PL-068 (condicionales). No bloquean.
- **Criterio de cierre:** en PROD, un aviso real llega como push a un iPhone
  (y a un Android si se lanza en Android) y `push_enviado_at` queda sellado.
  Si se lanza en Android, además: la API key de cliente de Firebase con las
  API restrictions reducidas y la restricción de app (package + SHA-1)
  aplicada, con un push real verificado después.
- **Dependencias:** PL-011, PL-023; PL-001 para PROD.

### PL-021 — Leaked password protection (D-18)
- **Origen:** D-18 (advisor) · **Estado:** ABIERTO · **Prioridad:** P1
- **Criterio de cierre:** activado en PROD (y opcionalmente en STAGING) y el
  advisor deja de reportarlo. Depende del plan de Supabase.

### PL-022 — Registro de errores (RNF-10)
- **Origen:** auditoría §4; L18 · **Estado:** DECISIÓN PENDIENTE · **Prioridad:** P1
- **Por qué existe:** `product-spec.md` pide logs de errores desde el día uno;
  no hay SDK ni manejador global de errores. Las métricas de producto ya
  existen en el panel (Ola 6).
- **Qué falta:** elegir herramienta; si es un proveedor externo (p. ej. Sentry),
  declararlo en el aviso, la retención y las tiendas.
- **Criterio de cierre:** un error provocado en una build release aparece en la
  herramienta elegida, y el aviso/las tiendas lo reflejan.

### PL-023 — Configuración de EAS (dos momentos)
- **Origen:** Ola 1 (A5), DEV-1A · **Estado:** ABIERTO · **Prioridad:** P1
- **PRE-TESTFLIGHT** (resolver **antes del primer TestFlight**, aunque no bloquea
  el desarrollo con Metro):
  - verificar contra el tarball de un build real de EAS que `.easignore`
    excluye `.env*.local` y `admin/`;
  - proporcionar de forma segura a ese build las variables de STAGING (sin
    `.env*.local` en el tarball, `src/lib/env.ts` hace fallar el arranque).
  - **Estado (TESTFLIGHT-1B a 1E, 2026-10-16), todavía sin validar con un build
    real:** el cliente consume solo `EXPO_PUBLIC_SUPABASE_URL` y
    `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`src/lib/env.ts:17-18`); las dos
    existen como variables de EAS en `development` y `preview` (= STAGING; ver
    "Ambientes", arriba), no en `production` (TESTFLIGHT-1D.1, Dashboard). El
    profile `testflight-staging` está en `eas.json`. `eas build:inspect
    --stage archive` del profile (TESTFLIGHT-1D.2, eas-cli 24.14.0) dio un
    archive sin ningún `.env*` y con `admin/` vacío. Falta comprobar en un build
    real que las variables llegan al binario.
- **PRE-LAUNCH:** garantizar que el build público recibe **exclusivamente** la
  configuración de PROD (enlaza con PL-003).
- **Criterio de cierre:** las dos fases verificadas con su build real.

### PL-024 — DEV-1: separación local / STAGING en desarrollo
- **Origen:** DEV-1A/B (pausado el 2026-10-12) · **Estado:** ABIERTO · **Prioridad:** P1
- **Por qué existe:** en desarrollo `.env.local` va dentro de cada bundle y gana
  sobre las variables del proceso (medido, M1); hoy el JS de desarrollo siempre
  habla con STAGING.
- **Diseño ya medido:** opción B para iPhone (`http://<host>.local:54321` en un
  archivo local no versionado; `hostUri` no existe en este build, M2); sacar de
  la raíz el archivo de PROD (M1: el `require.context` mete todos los `.env*` de
  la raíz en el bundle de desarrollo); verificación fail-fast; scripts
  `start:local`/`start:prod-js`; probe sin red.
- **Criterio de cierre:** `start:local` en simulador e iPhone habla solo con el
  stack local (logs de Kong) y una ejecución de desarrollo contra STAGING sin el
  modo explícito falla.

### PL-025 — Admins y scripts de PROD
- **Origen:** Ola 3; `scripts/crear-admin.mjs:81` · **Estado:** DECISIÓN PENDIENTE · **Prioridad:** P1
- **Evidencia actual:** `REF_REMOTO = 'ukxfnydfhmryrzhdqkvj'` está fijo; el
  script lee la publishable de `.env.local`. En STAGING, 2 de 3 admins usan
  correo personal, que queda en `admin_acciones.admin_correo` para siempre.
- **Qué falta:** parametrizar el destino del script; decidir si los admins de
  PROD usan solo `@rlvo.com.mx` (reduce el problema ARCO de PL-008).
- **Criterio de cierre:** script apuntado a PROD por parámetro explícito y
  probado (incluido `probe-admin` caso 8); decisión de correos documentada.

### PL-026 — Reconciliar `docs/LEGAL_LAUNCH_CHECKLIST.md`
- **Origen:** discrepancias halladas · **Estado:** ABIERTO · **Prioridad:** P1
- **Qué falta:** marcar como hechas (en STAGING) las casillas que el repo
  demuestra: implementación y pruebas de la eliminación de cuenta
  (`20260929000474`, `eliminar-cuenta`, T33, `probe-eliminar-cuenta`, pruebas en
  dispositivo del 2026-09-27); validación de dominios en el servidor (hook desde
  el 2026-09-23); verificación de `purga-actividad-diaria` (F26); flujo de
  eliminación en la app. Revisar "Verify Sentry retention" (Sentry no está
  instalado; ver PL-022).
- **Criterio de cierre:** cada casilla cambiada cita su evidencia; ninguna se
  marca sin ella.

### PL-027 — Documentación STAGING ↔ PROD y registros pendientes
- **Origen:** decisión del 2026-10-12 · **Estado:** ABIERTO · **Prioridad:** P1
- **Qué falta:** `CLAUDE.md`, `admin/CLAUDE.md`, `docs/admin-runbook.md` y los
  planes llaman "producción" a STAGING; registrar en `CLAUDE.md` §8 los cierres
  de C3, AUTH-1 y AUTH-2 y el cierre del pendiente 0 (Fase 2A, paso 6); añadir
  `scripts/probe-sesion-huerfana.mjs` a la lista de §6.
- **Criterio de cierre:** ninguna mención a "producción" que se refiera a
  STAGING sin aclararlo; registros añadidos.

### PL-028 — Landing pública (repo `rlvo-public-web`)
- **Origen:** auditoría §6; checklist (Website) · **Estado:** ABIERTO · **Prioridad:** P1
- **Sin evidencia en este repo.** Falta verificar que no cargue Cloudflare Web
  Analytics ni cookies inesperadas (o alinear el aviso con lo que haga), fechas
  de vigencia y retirar `noindex` tras la aprobación legal.
- **Criterio de cierre:** las cuatro variantes de petición de la landing
  verificadas sin beacon (o el aviso actualizado); páginas legales finales.

### PL-029 — Coordenadas reales de campus y "Detectar campus" (pendiente 0d)
- **Origen:** fase 2C · **Estado:** ABIERTO · **Prioridad:** P1
- **Qué falta:** capturar las coordenadas reales de cada campus (en el catálogo
  de PROD); un dev build con `expo-location` para probar en dispositivo;
  regenerar tipos.
- **Criterio de cierre:** "Detectar campus" encuentra el campus correcto en un
  iPhone real; catálogo de PROD con coordenadas.

---

## P2 — Hardening / evidencia recomendada

| ID | Tema | Origen | Estado | Criterio de cierre |
|---|---|---|---|---|
| PL-040 | Prueba sin red de `actividad_diaria` en dispositivo | F21-C | EVIDENCIA PENDIENTE | Intento sin red no marca el día, el reintento al recuperar red da 201 y el siguiente primer plano no hace POST (diseño en esta sesión; mejor tras PL-024). F21 histórico sigue PASS PARCIAL |
| PL-041 | AUTH-2 caso C: error real de red en dispositivo | AUTH-2 | EVIDENCIA PENDIENTE | Sin red, la app muestra "No pudimos cargar tu perfil" y la sesión sigue intacta. **AUTH-2 está cerrado**; esto es solo evidencia adicional (el clasificador ya lo cubre `probe-sesion-huerfana`) |
| PL-042 | Auditoría del panel con filas reales y "Ver más" con más de 50 filas | F25 | EVIDENCIA PENDIENTE | Revisión de la primera auditoría real y de una paginación real (en STAGING o PROD) |
| PL-043 | Alertas de los jobs de pg_cron | Ola 4/6 | ABIERTO | Un fallo de `purga-*` genera aviso, no solo una fila en `cron.job_run_details` |
| PL-044 | Consulta de logs saneada y guardada | F26 | ABIERTO | Consulta en el runbook que quita id de factor MFA, UUID y correos antes de agrupar, con tripwire |
| PL-045 | `PGRST303 JWT issued at future` | Hallazgo 2026-10-11/12 | ABIERTO | Causa entendida (desfase de reloj) y, si afecta a la lectura del perfil, mitigación |
| PL-046 | Cloudflare Access y CI de despliegue del panel; encabezados que añade Cloudflare | D13, L6, L8 | ABIERTO | Panel de PROD detrás de Access (o decisión de no hacerlo) y despliegue reproducible |
| PL-047 | Ciclo de vida de las copias cifradas de STAGING | D-17 | DECISIÓN PENDIENTE | Decidir conservar/borrar las 3 copias (contienen correos personales de admins) |
| PL-048 | Repetir en PROD lo que solo se vio en STAGING | 0b, F25, K-7B | EVIDENCIA PENDIENTE | En PROD: primer `run_hook`, TOTP vencido y, si aplica, timeout real del hook |
| PL-049 | Observabilidad de `send-push` | PUSH-7A/8 | ABIERTO | Guarda el id de cada ticket (hoy no lo registra cuando sale `ok`); un HTTP no-2xx de Expo no sella `push_enviado_at` en silencio; los errores de ticket distintos de `DeviceNotRegistered` quedan visibles para alguien |
| PL-050 | Ciclo de vida del token al cerrar sesión | PUSH-5A/5C | ABIERTO | `borrarPushToken()` revisa el `{ error }` del DELETE; si `getExpoPushTokenAsync` falla al cerrar sesión, la fila no se queda con el usuario anterior; una sesión vencida o un cierre forzado también limpian el token; probado en un dispositivo compartido (cambio de cuenta) |
| PL-051 | El permiso de push se pide antes de la pantalla que lo explica | PUSH-5A | ABIERTO | `session.tsx` registra el token en cuanto hay sesión, así que el aviso de iOS sale antes de "Permiso de notificaciones". Decidir y aplicar cuándo se pide (UX; no viola reglas de tienda) |
| PL-052 | `listing_contacts` se puede registrar por id sin ver la publicación | UGC-1A (O-5), 2026-10-12 | ABIERTO | `listing_contacts_insert_own` solo exige `user_id = auth.uid()` e `is_active_user()`: un contacto se registra por id sobre una publicación que la RLS le esconde (pausada, pendiente, bloqueada) y eso habilita `private.can_rate` ("yo contacté y esa persona es el vendedor"). UGC-1 lo cierra SOLO para parejas bloqueadas. Cierre: decidir si el insert exige visibilidad (`exists` contra `listings` bajo la RLS del invocante) y, si sí, aplicarlo con su aserción y control negativo |

---

## Condicionales por volumen o producto

| ID | Tema | Disparador |
|---|---|---|
| PL-060 | Índices de `actividad_diaria` y de las RPC de métricas (F4) | `admin.metricas` de 90 días tarda de forma apreciable o la tabla crece mucho |
| PL-061 | Seq scans de Explorar (alcances universidad/todas; búsqueda por `@@`) | Latencia del feed o de la búsqueda fuera de RNF-01 |
| PL-062 | Costo de `recomendar_listings` | Latencia de "Recomendados para ti" fuera de RNF-01 |
| PL-063 | Paginación del inbox | Una cuenta real supera ~100 notificaciones |
| PL-064 | Receipts de Expo push | Reportes de avisos que no llegaron |
| PL-065 | Timeout del hook de registro (0b) | El hook hace más que una búsqueda por PK o aparece `request_timeout` en `/otp` |
| PL-066 | Snapshot diario de métricas (D11) | Se necesitan cifras históricas inmutables |
| PL-067 | Umbral de Rekognition para bloquear | 50 publicaciones por categoría con su SQL (`.claude/rules/moderacion.md` §9) |
| PL-068 | Tokens viejos de push (permiso revocado, rotación, reinstalación) y reintento de envíos | Se acumulan tokens sin `DeviceNotRegistered` o se reportan avisos perdidos por un fallo transitorio de Expo |

---

## Deuda explícitamente pospuesta

| ID | Tema | Origen |
|---|---|---|
| PL-080 | Aviso de suspensión dentro de la app | L17 |
| PL-081 | Mostrar el motivo de "no aprobada" al dueño | `docs/rf17-plan-admin.md` §8 |
| PL-082 | Desbloquear desde el panel | D10 |
| PL-083 | RPC para que el comprador califique una vendida que luego se bloqueó | Ola 2 |
| PL-084 | Números válidos de 7 dígitos (Tokelau, Tristan da Cunha) | `CLAUDE.md` §3 |
| PL-085 | Compartir con enlace (deep links) | `compartir-deeplinks.md` |
| PL-086 | Historial de búsquedas | `explorar.md` |
| PL-087 | Calificar una transacción registrada antes de un bloqueo | UGC-1A (O-2), 2026-10-12; relacionada con PL-083 |

---

## No aplica a PROD (datos de STAGING)

Estos datos existen solo en STAGING y **no se transportan**; no se invierte
tiempo en limpiarlos como si fueran deuda de lanzamiento:

- carpeta `57/` de fotos huérfanas en `listing-photos`;
- filas 1 y 2 de `listing_photos` con una URL completa como `storage_path`;
- las ~20 publicaciones `activa` sin foto, anteriores a la subida;
- las 5 cuentas gmail/hotmail/outlook anteriores al hook;
- las 35 notificaciones con `push_enviado_at` NULL, anteriores a activar Vault (decisión del 2026-10-06: no se reenvían; el trigger solo envía en INSERT);
- la notificación 39, fixture de PUSH-8 creada a mano (no por un trigger) en el inbox del usuario de prueba, y su fila de `push_tokens`: se pueden limpiar junto con otros fixtures de STAGING, con autorización aparte;
- cuentas y sesiones de prueba de C3 y AUTH-2 (ya eliminadas).

**Sí permanece** como operación futura en PROD: el procedimiento de barrido
periódico de fotos huérfanas (`docs/admin-runbook.md` §7).

---

## Cerrado — referencia

| Elemento | Estado | Evidencia |
|---|---|---|
| AUTH-1 — routing correcto tras verificar el código | CERRADO | `72b7862`; tsc/lint, `probe-registro` 55/55; T1a/T1b en dispositivo |
| AUTH-2 — cuenta borrada (D) y perfil inexistente (E) ≠ perfil incompleto | CERRADO | `61d1d74`; `probe-sesion-huerfana` 21/21; A, B, D y E en dispositivo contra STAGING (C queda como PL-041) |
| C3 — evidencia remota de `run_hook` tras la Ola 6 | CERRADO (PASS PARCIAL) | `run_hook` "Hook ran successfully" 2026-10-12 02:15:05 UTC; snapshot 10/10 no medible post-hoc por borrado manual |
| Pendiente 0 — alta real `tec.mx` (Fase 2A, paso 6) | CERRADO | Altas reales de C3 y AUTH-2D/E con universidad fija y campus (registro documental en PL-027) |
| Eliminación de cuenta (backend y app) | CERRADO en STAGING | `20260929000474` + `eliminar-cuenta`, 2026-09-27 |
| Validación de dominios en el servidor | CERRADO en STAGING | Auth Hook desde 2026-09-23 |
| Purga de `actividad_diaria` en ejecución | CERRADO en STAGING | F26: `succeeded` 2026-10-11 06:23 UTC |
| Fotos de una `bloqueada` legibles por su dueño | CERRADO | D5 = (a), Ola 4 (`…481`) |
| Admin (RF-17 fase 1) | CERRADO | F28, `af2d862` |
| Push iOS de punta a punta (PUSH-2 a PUSH-8) | CERRADO en STAGING (PL-020 sigue abierto para PROD) | `f5a2648`, `76d3137`, `d4e8d18`, `564bedd`; `send-push` v13; PUSH-6 ticket y receipt `ok`; PUSH-8 fila 39 / request 47, una notificación en el iPhone |

---

## Discrepancias documentales abiertas

- `docs/LEGAL_LAUNCH_CHECKLIST.md` tiene casillas sin marcar ya demostradas en
  el repo → PL-026.
- `docs/LEGAL_FACTS.md` dice que `exatec.tec.mx` no deberá aceptarse; STAGING
  lo tiene activo → PL-012 (decisión pendiente).
- `CLAUDE.md` y documentos relacionados llaman "producción" al proyecto que hoy
  es STAGING → PL-027.

---

## Checklist final de lanzamiento

Antes de abrir RLVO a usuarios reales, todo lo siguiente debe estar `CERRADO`
(o `POSPUESTO`/`CONDICIONAL` por decisión escrita):

- [ ] P0: PL-001 a PL-012.
- [ ] PROD-BOOTSTRAP: los 16 criterios.
- [ ] P1: PL-020 a PL-029.
- [ ] Cada `DECISIÓN PENDIENTE` resuelta y con su criterio de cierre fijado.
- [ ] P2 revisados: cerrados o aceptados por escrito.
- [ ] Build pública verificada contra PROD (PL-003) y fichas de tienda enviadas (PL-010).
