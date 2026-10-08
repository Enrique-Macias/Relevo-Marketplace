@AGENTS.md

# Relevo — Contexto del proyecto

Marketplace móvil de compra-venta entre estudiantes universitarios, verificado por
correo institucional. Fase 1 (MVP): solo productos — sin pagos integrados, sin
mensajería interna, sin logística de envíos. El contacto entre comprador y
vendedor ocurre por WhatsApp; la transacción se acuerda y ejecuta en persona.

Diseñado para escalar de un solo campus a **nacional, multi-universidad**, desde
el día uno del modelo de datos.

---

## 0. Fuentes de verdad del proyecto

**El diseño definitivo vive en `/design/relevo-app.html`.**
**Los requerimientos de negocio viven en `/docs/product-spec.md`** (el
documento original de producto, en texto plano).
**Los gotchas de infraestructura viven en `/supabase/KNOWN_ISSUES.md`** — bugs
de Postgres/Supabase local ya diagnosticados, para no re-investigarlos desde
cero si vuelven a aparecer.

Es un prototipo HTML/CSS/JS autocontenido con las 73 pantallas de la app
renderizadas como frames de teléfono, más un panel de "Editor de estilo" con
controles en vivo (colores primario/secundario/fondo/tarjetas/texto y
tipografía de títulos/cuerpo) para experimentar con la identidad visual sin
tocar código.

Reglas para cualquier IA o desarrollador que trabaje en este repo:

1. **Toda pantalla nueva debe machear ese archivo pixel por pixel** en layout,
   spacing, tipografía y color antes de conectarse a datos reales. Si una
   pantalla no existe todavía en el HTML, avisa antes de inventar el diseño.
2. **No inventes tokens de diseño nuevos.** Extrae colores, tipografía, radios
   y spacing directamente de las variables CSS (`:root` y overrides) del
   archivo — ver sección 2.
3. Si el diseño cambia, el cambio se hace primero en
   `/design/relevo-app.html`, y **después** se propaga al código — nunca al
   revés. El HTML es la especificación, no una referencia opcional.
4. Cuando falte una pantalla o un estado (ej. un caso borde nuevo), constrúyelo
   primero como frame dentro de `relevo-app.html` siguiendo el sistema de
   diseño existente, antes de escribir el componente real.

   **Aclaración — los toasts son la excepción, y solo ellos.** El copy de
   mensajes efímeros (toasts) NO requiere representación 1:1 en
   `relevo-app.html`: el HTML documenta el **patrón visual** (los frames "Toast
   de éxito" y "Toast de error"), y el texto específico de cada evento se
   escribe en código. Esto **NO aplica** a copy persistente en pantalla
   —botones, títulos, estados vacíos, avisos `.notice`—, que sigue bajo la regla
   original: si el usuario puede leerlo con calma y volver a él, va al frame
   primero.

   Se documenta porque estaba ambiguo y el repo lo reflejaba: "No pudimos
   registrar el contacto" SÍ está en el HTML, mientras que "Publicación
   pausada", "reactivada" y "eliminada" nunca estuvieron. La regla es esta, no
   aquel precedente mixto.
5. **Antes de implementar cualquier funcionalidad de negocio** (qué campos
   lleva una publicación, qué estados existen, qué puede hacer un usuario
   suspendido, etc.), consulta `/docs/product-spec.md` — los RF-01 a RF-18 y
   RNF-01 a RNF-10 ahí definidos son el contrato, no una sugerencia. Si el
   código necesita hacer algo que el spec no cubre, avisa antes de improvisar
   el comportamiento.
6. **Sobre el skill `expo-native-ui`** (u otros skills de patrones
   nativos/UI genéricos que se instalen en este repo): úsalos para
   *cómo* implementar — navegación con Expo Router, gestos, animaciones,
   convenciones de plataforma — nunca para decidir *qué* se ve en pantalla.
   Layout, spacing, jerarquía visual y cualquier decisión de diseño siempre
   las gana `/design/relevo-app.html`, incluso cuando el skill sugiera un
   patrón "estándar" distinto (ejemplo: nuestro tab bar tiene 4 ítems sin
   botón "+" central — el de publicar vive como FAB en Perfil — así que
   ignora cualquier sugerencia de un tab bar de 5 con acción central).
7. **Nada de lógica de autorización duplicada en el cliente.** Si una regla
   se puede expresar como policy RLS o constraint de base de datos, va en la
   base — no en un `if` de React. Ver sección 3 para el porqué esto ya mordió
   una vez (pg_default_acl, sección 9).

`admin/` no está bajo las reglas 1-4 ni 6; sus reglas viven en `admin/CLAUDE.md`
(D1 de `docs/rf17-plan-admin.md`: el panel de RF-17 tiene su propia fuente de
diseño, `design/admin-panel.html`, desde la Ola 2).

### Privacidad, datos y requisitos legales del producto

Para cualquier trabajo relacionado con privacidad, datos personales,
moderación, eliminación de cuenta, retención de datos, contenido,
proveedores externos o requisitos de lanzamiento, consulta también:

- `/docs/LEGAL_FACTS.md`
- `/docs/PRIVACY_SPEC.md`
- `/docs/TERMS_SPEC.md`
- `/docs/ACCOUNT_DELETION.md`
- `/docs/CONTENT_POLICY.md`
- `/docs/DATA_RETENTION.md`
- `/docs/LEGAL_LAUNCH_CHECKLIST.md`

`/docs/LEGAL_FACTS.md` es la fuente factual principal para el
comportamiento esperado en estas áreas.

Estos documentos describen comportamiento esperado y requisitos del
producto. Su existencia NO demuestra que dicho comportamiento esté
implementado.

Cuando código y documentación discrepen:

1. No asumas que la documentación refleja la implementación real.
2. Verifica la implementación en código, migraciones, RLS, Storage,
   Edge Functions y configuración relevante.
3. Reporta explícitamente la discrepancia.
4. No cambies silenciosamente código o documentación para hacerlos coincidir.

---

## 1. Stack tecnológico

| Capa | Tecnología | Por qué |
|---|---|---|
| App móvil | React Native + Expo (Router, SDK 57) | Un solo código para iOS/Android, builds sin Mac vía EAS Build |
| Backend / BD | Supabase (Postgres), proyecto remoto `ukxfnydfhmryrzhdqkvj`, región us-east-1 (leída en el Dashboard durante el paso 2 de la Ola 3 y coherente con el session pooler `aws-0-us-east-1`; este archivo decía Ohio, us-east-2) | Auth + BD relacional + Storage + Row Level Security, sin backend custom |
| Cliente BD | `@supabase/supabase-js` (versión fijada, sin `^`) | Ver sección 8 para el wrapper (`src/lib/supabase.ts`) y por qué usa `expo-crypto` en vez de `react-native-get-random-values` |
| Fotos | `expo-image-picker` + `expo-image-manipulator` | El picker elige; el manipulator **normaliza a JPEG comprimido antes de subir**. No es opcional: el bucket corta en 5 MiB y el `quality` del picker no comprime PNG (§9), así que sin esto cualquier screenshot falla siempre |
| Notificaciones | `expo-notifications` + tabla `notifications` como outbox | Integración directa, disparadas desde la Edge Function `send-push` vía un trigger propio con `net.http_post` — **no** el Database Webhook del Dashboard, aunque la migración se llame `..._notifications_webhook` (§3). El inbox in-app NO es un espejo del push: es lo que hace que un aviso sobreviva a un push que no llegó (§3, `notificaciones-push.md`) |
| Moderación de imagen | Google Cloud Vision (SafeSearch + OCR) **+ Amazon Rekognition** (`DetectModerationLabels`) | Dos proveedores porque cubren cosas distintas: SafeSearch no mira drogas/alcohol/gambling y Rekognition no hace OCR. Rekognition **no batchea** (una llamada por imagen) y acepta **solo JPEG/PNG**, al revés de Vision — ver §3 |
| Admin / moderación | Panel web propio en `admin/` (RF-17, Vite + React + TS, solo publishable key) **EN PRODUCCIÓN desde el 2026-10-02** en `https://admin.rlvo.com.mx` (Cloudflare Pages, despliegue manual): las Olas 1 (login con MFA, alta de admins y suspender/reactivar), 2 (reportes, detalle de publicación y bloqueo) y 3 (despliegue y alta de los 3 admins). Supabase Studio para lo que el panel aún no cubre | Studio no lo pueden usar 2 de los 3 admins (ni SQL), de ahí el panel. Plan por olas en §8, pendiente 0k. **A 2026-10-05, la cola de moderación, aprobar publicaciones, el catálogo y las métricas (Olas 4-6) siguen en Studio** |
| Distribución | EAS Build / Submit | Publicar a ambas tiendas sin infraestructura nativa propia |

**Nomenclatura de API keys (Supabase renombró su sistema en 2026):** usamos las
**Publishable/Secret keys** modernas (`sb_publishable_...`), no el esquema
legado `anon`/`service_role` JWT. La variable de entorno en el cliente se
llama `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, no `..._ANON_KEY` — si ves
código o docs viejas que dicen "anon key", es el concepto equivalente pero el
nombre técnico correcto en este proyecto es "publishable".

**Correo transaccional:** Resend, con dominio propio verificado (SPF/DKIM/DMARC
en `p=reject`, el nivel más estricto). Conectado como SMTP custom de Supabase
Auth — el mailer default de Supabase es solo para pruebas (límite muy bajo).
**Aviso conocido, no bloqueante:** correos institucionales con filtrado
agresivo (confirmado con Microsoft 365 / Tec de Monterrey) pueden retener el
correo en **Cuarentena** (`security.microsoft.com/quarantine`), sin que llegue
ni a "Correo no deseado" — no es un problema de DNS/autenticación de nuestro
lado (ya está en el nivel más estricto posible), es política del lado del
destinatario. Se resuelve por usuario liberando el mensaje y marcando el
remitente como confiable; a nivel institucional requeriría whitelisting por
TI de cada universidad.

**Principios no negociables:**
- Row Level Security en todas las tablas — un usuario solo edita sus propias
  publicaciones y datos, sin lógica de autorización duplicada en el cliente.
- `universidad_id` y `campus_id` presentes en `users` y `listings` desde el
  esquema inicial, aunque hoy solo exista una universidad/campus activo —
  esto es lo que permite escalar a más universidades sin migración mayor.
- Sin comisiones, sin pagos integrados, sin chat interno en esta fase.
- **Todo grant a `authenticated`/`anon` debe ir precedido de un `revoke all`
  explícito en la misma migración.** Supabase otorga privilegios por default
  vía `pg_default_acl` sobre cada tabla nueva — un `grant select (columnas)`
  "acotado" no retira nada que ya esté concedido. Ver sección 9.

---

## 2. Design tokens (extraídos de `relevo-app.html`)

Colores base (variables CSS `:root`, con tintes derivados vía `color-mix`):

```
--ink:        #221F1C   /* texto principal */
--ink-soft:   #6B6660   /* texto secundario */
--paper:      #F3F0EA   /* fondo de app */
--card:       #FFFFFF   /* superficie de tarjetas */
--brick:      #C1440E   /* primario / marca / CTAs */
--forest:     #2F6B4F   /* secundario / confianza / verificado */
--gold:       #D9A441   /* acento decorativo (categorías) */
--slate:      #5B6B78   /* acento decorativo (categorías) */
```

Tipografía — dos familias, uso deliberado y separado:
- **Fraunces** (serif, display) — wordmark, precios, headlines de onboarding/auth.
- **Inter** (sans) — todo el resto: UI, cuerpo, títulos de sección.

Ya implementado en `src/constants/theme.ts`: `Colors`, `Fonts`, `FontWeights`
(400/500/600, todos sí se usan — no asumas que la UI evita el regular),
`Radii` (8/12/14/16/20/9999, más el 10px de `.menu-icon`/`.status-row-icon`
que quedó fuera del token original), `Typography` (49 roles por nombre
semántico — medido con `awk` sobre el objeto en `theme.ts`, no de memoria: si
este número discrepa del archivo, gana el archivo, y ganó: decía "47" cuando
el archivo ya tenía 48, antes de que `fieldError` lo llevara a 49 — cada uno citando la clase
CSS exacta de origen — incluye `.avatar`/`.seller-avatar` en weight 600, ojo si
agregas un rol parecido, es fácil confundirlo con 500), y `ScreenPadding = 20`.

Hay un tercer par fácil de confundir, y este coincide en TODO: `rateAvatarInitials`
(`.rate-avatar` de Calificar) tiene los mismos valores que `logoMark`
(`.auth-logo span`), display/600/22. Son roles distintos a propósito — si el
avatar de Calificar cambia de escala, se cambia ahí y no en el cuadro de la "R"
de auth.

Y un CUARTO valor cercano a ese par, con "Perfil público": `profileAvatarInitials`
(`.profile-avatar`) es display/600/**24**, no 22 — un punto de tamaño más que
`rateAvatarInitials`/`logoMark`, y el más fácil de los tres de confundir porque
"parece" el mismo valor a simple vista. Si el avatar de Perfil público cambia de
escala, se cambia ahí y en ningún otro rol de este grupo.

Y un QUINTO, el peor de todos, con "Editar perfil": `editAvatarInitials` es
**body**/600/22. Comparte la CLASE con `sellerAvatarInitials` —los dos son
`.seller-avatar`, pero el frame de Editar perfil le pone un `font-size:22px`
inline encima de los 14 de la clase— y comparte el TAMAÑO con
`rateAvatarInitials`/`logoMark`, que son 22 pero en fuente **display**. O sea que
se confunde por los dos lados a la vez y no coincide del todo con ninguno: es el
único del racimo en body a 22.

Dos de esos roles son de la fila de notificación y se parecen a otros que ya
existían, así que conviene no confundirlos: `notifTime` es 10.5 **regular**
(`cardBadge` es 10.5 semibold) y `notifDesc` es 12 **regular con line-height
propio** (`activeChip` es 12 medium, sin line-height). No hay escala formal de
spacing — los paddings del prototipo son ad-hoc por componente; se leen
directo del HTML pantalla por pantalla, no se inventa una escala genérica.

---

## 3. Modelo de datos — esquema implementado

Definido en 43 migraciones (`supabase/migrations/`, medido con
`ls supabase/migrations | wc -l` el 2026-10-01; decía "42", "40", "39", "38", "37", "35", "34", "33", "32", y antes "30" con 31 en el repo), con RLS activo y probado en las 19 tablas más
los DOS buckets de Storage. Este es el esquema **real**, no solo la intención
original.

**Ese 19 son 16 con policies más `listing_moderacion`,
`listing_moderacion_reclamos` y `avatar_moderacion`, que tienen RLS habilitado
y CERO policies a propósito** (sus bloques propios, más abajo) — no son tablas
a medio configurar. Medido en local con `pg_class.relrowsecurity` (15 antes de
`20260928000471`, igual que decía la prosa; 16 con ella, 17 con
`20260928000473`, 18 con `20260929000474`, 19 con `20260930000475`, que suma
`user_intereses` a las "con policies"). **`universidad_dominios` y
`correos_bloqueados` cuentan entre las 16 "con policies", pero su única policy
es para `supabase_auth_admin`, no para el cliente** (sus bloques, más abajo). El número venía diciendo "12" desde antes de esta tanda, cuando ya
eran 13: otra confirmación de la moraleja del párrafo siguiente, esta vez
encontrada al medir para otra cosa.

**Repo y remoto: 43 y 43 (medido el 2026-10-05) — a la par.** `ls
supabase/migrations | wc -l` da **43**; `mcp__supabase__list_migrations` también
da **43**, con `20260930000477`, `…478` y `…479` incluidas: el runbook de la
Ola 3 (§8, pendiente 0k) ya corrió completo, evidencia en "Hecho". La historia
de antes, tal como estaba:

**Repo y remoto: 43 y 40 (medido el 2026-10-01).** `ls supabase/migrations |
wc -l` da **43**; `mcp__supabase__list_migrations` da **40**. Faltan en remoto
las de la Ola 1 (`…477`, `…478`) y la de la Ola 2 (`20260930000479`, reportes
y bloqueo); las tres van en el runbook de la Ola 3 (§8, pendiente 0k). La
historia de antes, tal como estaba:

**Repo y remoto: 42 y 40 (medido el 2026-09-29).** `ls supabase/migrations |
wc -l` da **42**; `mcp__supabase__list_migrations` da **40**. Las que faltan en
remoto son `20260930000477` (admins, MFA y auditoría) y `20260930000478`
(suspender/reactivar), la Ola 1 de RF-17, que no se pushean en su propia tarea:
van en el runbook de la Ola 3 (§8, pendiente 0k), con un paso 0 bloqueante. La
historia de antes, tal como estaba:

**Repo y remoto: 40 y 40 (medido el 2026-09-29) — a la par.** `ls
supabase/migrations | wc -l` da **40**; `mcp__supabase__list_migrations`
también da **40**, con `20260930000476` incluida, y `pg_get_triggerdef` de
`reports_notify_resolved` en remoto trae `(new.reporter_id IS NOT NULL)` en su
`WHEN`. El runbook de la Ola 0 de RF-17 (§8, pendiente 0k) ya corrió. La
historia de antes, tal como estaba:

**Repo y remoto: 40 y 39 (medido el 2026-09-29).** `ls supabase/migrations |
wc -l` da **40**; `select count(*), max(version) from
supabase_migrations.schema_migrations` en remoto da **39** y `20260930000475`.
La que falta en remoto es `20260930000476` (reportes de cuentas eliminadas), que
no se pushea en su propia tarea: es el runbook de la Ola 0 de RF-17, pendiente
0k de §8. La historia de antes, tal como estaba:

**Repo y remoto: 39 y 39 (medido el 2026-09-27) — a la par.** `ls
supabase/migrations | wc -l` da **39**; `mcp__supabase__list_migrations`
también da **39**, con `20260930000475` incluida. El runbook de §8 (antes
pendiente 0j) ya corrió completo, evidencia en "Hecho". La historia de antes,
tal como estaba:

**Repo y remoto: 39 y 38 (medido el 2026-09-27).** `ls supabase/migrations |
wc -l` da **39**; `mcp__supabase__list_migrations` da **38**. La que falta en
remoto es `20260930000475` (intereses y "Recomendados para ti"), que no se
pushea en su propia tarea: es el runbook pendiente 0j de §8. La historia de
antes, tal como estaba:

**Repo y remoto: 38 y 38 (medido el 2026-09-27) — a la par.** `ls
supabase/migrations | wc -l` da **38**; `mcp__supabase__list_migrations`
también da **38**, con `20260929000474` incluida. El runbook de §8 (antes
pendiente 0h) ya corrió completo, evidencia en "Hecho".

**Por DECIMOQUINTA vez, y esta vez sin sorpresa:** el párrafo de abajo decía
"38 y 37" y el usuario avisó del push antes de remedir; el comando lo
confirmó. La historia de antes, tal como estaba:

**Repo y remoto: 38 y 37 (medido el 2026-09-26).** `ls supabase/migrations |
wc -l` da **38**; `mcp__supabase__list_migrations` da **37**. La que falta en
remoto es `20260929000474` (eliminar cuenta), que no se pushea en su propia
tarea: es el runbook pendiente 0h de §8, junto con el deploy de la Edge
Function `eliminar-cuenta`, y en ese orden. La historia de antes, tal como
estaba:

**Repo y remoto: 37 y 37 (medido el 2026-09-25) — a la par.** `ls
supabase/migrations | wc -l` da **37**; `mcp__supabase__list_migrations`
también da **37**, con `20260928000471`, `…472` y `…473` incluidas. El runbook
de §8 (antes pendiente 0g) ya corrió completo, evidencia en "Hecho".

**Por DECIMOCUARTA vez.** Este párrafo decía "37 y 34, faltan la 471/472/473",
y al remedirlo el remoto YA las tenía las tres. La historia de antes, tal como
estaba:

**Repo y remoto: 37 y 34 (medido el 2026-09-24).** `ls supabase/migrations |
wc -l` da **37**; `mcp__supabase__list_migrations` da **34**. Las que faltan
en remoto son `20260928000471` (el reclamo de moderación), `…472` (el enum de
los avisos nuevos) y `…473` (sus productores), que no se pushean en su propia
tarea: es el runbook pendiente 0g de §8, en ese orden.

**Por DECIMOTERCERA vez.** Este párrafo decía "34 y 32, faltan la 469 y la
470", y al remedirlo el remoto YA las tenía (`list_migrations` lista las dos):
el paso 1 del pendiente 0f corrió fuera de la sesión que lo escribió. La
historia de antes, tal como estaba:

**Repo y remoto: 34 y 32 (medido el 2026-09-24).** `ls supabase/migrations |
wc -l` da **34**; `mcp__supabase__list_migrations` da **32**. Las que faltan en
remoto son `20260927000469` (nombre válido) y `20260927000470` (teléfono de
cualquier país), que no se pushean en su propia tarea: es el runbook pendiente
0f de §8, con un paso 0 bloqueante.

**Por DUODÉCIMA vez.** Este párrafo decía "32 y 31, falta
`20260926000468`", y al remedirlo el remoto YA la tenía (`list_migrations` la
lista). O sea que el paso 1 del pendiente 0e de §8 corrió fuera de la sesión que
lo escribió, como la 467 antes que ella. La historia de antes, tal como estaba:

**Repo y remoto: 32 y 31 (medido el 2026-09-24).** `ls supabase/migrations |
wc -l` da **32**; `mcp__supabase__list_migrations` da **31**. La que falta en
remoto es `20260926000468` (búsqueda por prefijo), que no se pushea en su
propia tarea: es el runbook pendiente de §8.

**Por UNDÉCIMA vez, y el párrafo anterior mentía en el sentido contrario al
que él mismo advertía.** Decía "31 y 30, la 467 no se pusheó a propósito", y al
remedirlo con `list_migrations` antes de esta tarea el remoto YA tenía **31**,
`20260925000467` incluida, con `campus.latitud`/`longitud` presentes en
`information_schema.columns`. O sea que alguien corrió el `db push` fuera de la
sesión que escribió el párrafo, y el paso 1 del pendiente 0d de §8 ya estaba
hecho. (La décima fue el plan de esta misma tarea: escribió "32 en el repo, 30
en remoto" SUMANDO a partir de ese párrafo, sin correr ningún comando; lo cazó
la revisión del plan antes de que llegara a este archivo.) La historia de
antes, tal como estaba:

**Por NOVENA vez, y esta vez la discrepancia es del signo contrario:** las
ocho veces anteriores el párrafo decía "a la par" y dejaba de serlo por un
`db push` que YA había corrido. Esta vez es al revés — se escribe "no están a
la par" mientras el estado es real, no obsoleto — precisamente porque
pushear no era parte de esta tarea. La historia de antes, tal como estaba:

**Por OCTAVA vez:** este párrafo decía "30 y 29", con `20260924000466` marcada
como "sin pushear" — y en la MISMA sesión que lo escribió, un runbook
explícito corrió el `db push` que la llevó a remoto; quedó obsoleto antes de
que la tarea terminara, exactamente como ya le pasó a "23 y 21" más abajo. La
historia de antes, tal como estaba:

**Por SÉPTIMA vez:** este párrafo decía "28 y 27", con `20260922000464`
marcada como "sin pushear", y al remedirlo contra remoto ya había viajado: el
remoto tiene 28 con ella incluida. La historia de antes, tal como estaba:

**Este número acaba de volver a demostrar su propia moraleja, por SEXTA
vez.** Este párrafo decía "27 y 26", con `20260919000463` marcada como "sin
pushear" — y al remedirlo contra remoto resultó que **ya había viajado**: el
remoto tiene **27**, no 26, con `20260919000463` incluida
(`list_migrations` la lista tal cual). Antes decía "26 y 25", con
`20260918000462` marcada como "sin
pushear" — y al remedirlo contra remoto resultó que **ya había viajado**: el
remoto tiene 26, no 25, y `pg_trigger` allá ya tiene
`objects_notify_moderacion_insert`/`_update`. (Siguen INERTES, eso sí:
`select count(*) from vault.secrets where name like 'moderar_contenido_%'` da 0.)
Antes decía "25 y 23", con `20260917000460` y `20260918000461` marcadas como sin
pushear, y las dos ya habían viajado. Antes de eso, "23 y 21", que quedó
obsoleto por un `db push` corrido FUERA de la sesión que lo escribió, antes
siquiera de que se terminara el párrafo. Y antes, "en remoto hay 19, falta
pushear la de `avatars`", también falso al medirlo.

**La moraleja, ya sin matices:** que repo y remoto estén a la par es un **estado
transitorio, no una propiedad del código**. No se documenta como hecho fijo: se
REMIDE con su comando cada vez que alguien vaya a confiar en el número, y cuando
la prosa y el comando discrepan **gana el comando** — incluso cuando la prosa es
una advertencia que suena prudente, y especialmente cuando es esta misma.

```
-- Enums
user_status        : activo | suspendido
listing_status     : activa | pausada | vendida | pendiente | bloqueada
listing_condition  : nuevo | como_nuevo | buen_estado | usado
report_reason      : spam_publicidad | sospecha_fraude | contenido_inapropiado
                      | no_es_estudiante | otro
report_status      : pendiente | resuelto | descartado
notification_type  : precio_favorito | reporte_resuelto | compra_calificable
                      | publicacion_aprobada | publicacion_bloqueada
                      | calificacion_recibida | favorito_vendido | avatar_eliminado

-- Catálogos (solo lectura para authenticated; altas vía Studio/service_role)
universidades   (id, nombre único)
campus          (id, universidad_id → universidades, nombre, ciudad,
                 latitud/longitud double precision NULLABLES, único por
                 (universidad_id, nombre))
categories      (id, nombre único) — 12 filas sembradas, ver seed.sql
universidad_dominios (dominio text PK, universidad_id → universidades on delete
                 cascade, created_at) — con qué dominios de correo se puede
                 REGISTRAR una cuenta. Check: minúsculas, sin espacios, sin '@'.
                 NO es legible por el cliente (ni anon ni authenticated): la lee
                 solo el Auth Hook. Ver abajo.
correos_bloqueados (correo_hash bytea PK — sha256 de lower(btrim(correo)),
                 check de 32 bytes —, created_at) — correos de cuentas que se
                 ELIMINARON estando suspendidas; el Auth Hook rechaza volver a
                 registrarlos. Mismo acceso que universidad_dominios: solo
                 supabase_auth_admin. Ver "Eliminar cuenta", abajo.
user_intereses  (user_id → users on delete cascade, categoria_id → categories
                 on delete cascade, created_at, PK (user_id, categoria_id)) —
                 las categorías que el usuario ELIGE. Cada quien lee y escribe
                 solo las suyas; sin UPDATE. Ver "Intereses y recomendados".

**`campus.latitud`/`longitud` son para "Detectar campus más cercano" (fase
2C, `20260925000467`).** Nullables a propósito: un campus sin coordenadas
capturadas todavía simplemente no participa en la detección de cercanía
(`campusMasCercano()`, `src/lib/ubicacion.ts`, las filtra) — no es un estado
inválido. Tres checks: `latitud` entre -90 y 90, `longitud` entre -180 y 180,
y las dos juntas o ninguna (`(latitud is null) = (longitud is null)`).

- **Único consumidor: `campusMasCercano()` vía `src/lib/geolocalizacion.ts` en
  `src/app/selector-campus.tsx`**, sobre el catálogo COMPLETO que ya trae
  `fetchCatalogoCampus()` en memoria — nada nuevo del lado de la red, solo dos
  columnas más en un `select` que ya existía.
- **Sin `grant`/`revoke`, y medido, no solo argumentado.** `campus` tiene
  `grant select` a nivel de TABLA (`20260906000437:96`), y en Postgres eso
  cubre columnas que se agreguen después — mismo caso que `listings.busqueda`.
  El diff de `scripts/grants-users-listings.sql` adaptado a `campus`
  (antes/después de la migración) no salió vacío como se esperaba al planear:
  salieron **2 filas nuevas**, las dos `columna|authenticated|campus.{latitud,longitud}|SELECT`
  — heredadas del grant de tabla, sin que la migración escribiera ningún
  `grant` propio, y **sin ningún INSERT/UPDATE/DELETE**. Es la confirmación
  medida, no la ausencia de diferencia.
- **Aserciones en `supabase/tests/rls.sql`: T29, autocontenida** (su propia
  universidad y usuario, no reusa fixtures de T28) — rechaza cada rango, la
  combinación incompleta, acepta ambas NULL y los bordes exactos ±90/±180,
  `authenticated` lee pero no escribe. Los 4 controles negativos (quitar cada
  check, dar un grant de más) corridos uno a la vez, cada uno cayendo en su
  aserción exacta.
- **La ubicación del dispositivo nunca llega a estas columnas ni a ningún
  otro sitio de red** — verificado por grep, no solo por diseño:
  `src/lib/ubicacion.ts` (donde vive `campusMasCercano()`) tiene CERO imports,
  así que es estructuralmente incapaz de hacer red o I/O; en
  `src/lib/geolocalizacion.ts` las coordenadas solo se construyen en las
  líneas 105 y 122 (`coords: {...}`, tomadas de la respuesta del módulo
  nativo) y viajan sin tocar nada más hasta `selector-campus.tsx:145`
  (`campusMasCercano(resultado.coords, …)`), su único consumidor. El único
  `console.*` de esos tres archivos es el aviso de módulo nativo faltante
  (`geolocalizacion.ts:40`), que imprime el mensaje del error, no coordenadas.
  Nunca se llama a `supabase.*` ni a `fetch` con ellas, y no hay ninguna
  escritura a `AsyncStorage`/`SecureStore` en ninguno de los tres archivos.

-- Perfil (provisto automáticamente por trigger al verificar correo)
users
  id uuid (= auth.users.id), correo (NO expuesto al cliente, ver abajo),
  universidad_id (la ASIGNA el trigger de alta desde el dominio del correo;
  el cliente no la escribe; null solo en cuentas creadas por llave secreta
  con dominio no registrado — ver abajo),
  nombre, foto_url, campus_id, carrera (nullable hasta
  "Completar perfil"; campus_id atado a universidad_id por FK compuesta;
  nombre con check `users_nombre_valido` — nombre de persona, 2-50, ver abajo),
  rating_promedio (solo triggers escriben),
  estado (solo triggers/service_role escriben),
  telefono (E.164 de cualquier país; +52 exige 10 dígitos; check
    `users_telefono_e164`; NO expuesto al cliente — ver abajo),
  tiene_telefono (generada: `telefono is not null`; ESTA sí es legible)

-- Publicaciones
listings
  id, user_id, categoria_id, universidad_id, campus_id, titulo, descripcion,
  precio numeric(10,2) entero 0-100000 (check, ver abajo), condicion, estado default 'activa',
  vistas_count (solo vía RPC, ver abajo), created_at, updated_at,
  veredicto_en_pantalla boolean (¿el usuario vio en pantalla el veredicto de
    moderación que la sacó de `pendiente`? Solo la pone en true la Edge
    Function; una limpieza la baja al entrar a `pendiente`. Ver "Avisos nuevos
    del inbox", abajo),
  busqueda tsvector generated always as
    (to_tsvector('spanish', titulo || ' ' || coalesce(descripcion,''))) stored
    -- columna generada + índice GIN `listings_busqueda_idx` sobre ELLA. Ver abajo.
listing_photos
  id, listing_id, storage_path, orden (0-4, único por listing — tope de 5 fotos
  enforced con trigger). `storage_path` es una RUTA dentro del bucket privado
  `listing-photos` (`{listing_id}/{uuid}.jpg`), NO una URL — ver abajo.

-- Interacción
favorites        (user_id, listing_id) — privados, nadie ve favoritos ajenos
listing_contacts (user_id, listing_id, created_at) — log append-only de cada
                 tap en "Contactar por WhatsApp"; alimenta el flujo
                 "¿A quién le vendiste?" (sección 5)
listing_sales    (listing_id PK → listings, comprador_id → users, created_at)
                 quién compró (RF-07/RF-12). PK sobre listing_id: una venta o
                 ninguna. Solo la ven las DOS PARTES, ni los otros contactos.
                 Sin DELETE; su UPDATE es solo sobre `comprador_id`. NO es una
                 columna de `listings` — ver abajo.
ratings
  from_user_id, to_user_id, listing_id, estrellas (1-5), comentario nullable.
  from_user_id y listing_id son NULLABLES y `on delete set null` desde
  20260929000474: la reseña de una cuenta eliminada sobrevive anónima, y la de
  una publicación borrada sobrevive sin publicación (ver "Eliminar cuenta").
  Solo se puede calificar si hubo contacto real (función can_rate()).
  to_user_id/listing_id NO son editables tras crear la fila (protegido por
  grant de columna, no solo por policy — un UPDATE no puede reapuntar una
  reseña a otra persona). Sin DELETE: una calificación no se borra, es parte
  del historial de confianza.
reports
  reporter_id (nullable, on delete SET NULL desde 20260929000474 — antes era
  cascade; el reporte de una cuenta eliminada se conserva para moderación, sin
  su identidad), listing_id / reported_user_id
  (mutuamente excluyentes al crear, pero on delete SET NULL — un reporte
  sobrevive al borrado de su objetivo, con snapshot en listing_titulo /
  reported_user_correo para seguir siendo legible). reported_user_correo
  NUNCA es legible por el cliente (mismo criterio que users.correo) — solo
  service_role lo ve, y un trigger lo BORRA cuando la cuenta reportada se
  elimina (20260929000474). NADIE puede reportarse a sí mismo, y son DOS
  mecanismos distintos, no uno — ver abajo.

-- Notificaciones (RF-16)
push_tokens
  token text PRIMARY KEY (¡sobre el TOKEN, no sobre (user_id, token)!),
  user_id → users on delete cascade, platform ('ios'|'android'), created_at.
  Sin grant NI policy de UPDATE — no es un olvido, ver abajo.
notifications
  id, user_id → users, tipo notification_type, titulo, cuerpo (AMBOS
  materializados por el trigger), listing_id → listings on delete SET NULL
  (null en las de reporte a propósito), leida_at, push_enviado_at (lo sella la
  Edge Function), created_at.
  El cliente solo escribe `leida_at` (grant de columna). Sin insert ni delete:
  las filas solo nacen de triggers.

-- Moderación pre-publicación (RF-18)
listing_moderacion
  id, listing_id → listings on delete cascade, veredicto text + check
  ('limpio'|'revisar'|'bloquear'), estado_resultante listing_status,
  detalle jsonb, created_at. Una fila por EVALUACIÓN, no por publicación:
  es historial, no estado actual. CERO grants y CERO policies — la escribe
  la Edge Function con `supabaseAdmin` y la lee Studio. Ver abajo.
listing_moderacion_reclamos
  listing_id PK → listings on delete cascade, reclamada_at, completada_at
  nullable. El reclamo del camino CLIENTE: mutex mientras `completada_at` es
  null, marca permanente de "el alta ya se evaluó" cuando no. CERO grants y
  CERO policies, igual que `listing_moderacion`. Ver el bloque de RF-18.
avatar_moderacion
  id, user_id → users on delete cascade, storage_path, foto_url_nulificado,
  created_at. Una fila por avatar BORRADO por moderación (la escribe
  moderarAvatar()); de ella nace el aviso `avatar_eliminado`. CERO grants y
  CERO policies. Ver "Avisos nuevos del inbox", abajo.
```

**`listings.precio` es un ENTERO de pesos, 0-100000 inclusive (RF-05,
`20260922000464`).** El 0 se permite: regalar un artículo es un caso válido.
No se cambió el tipo de columna (`numeric(10,2)` se queda) — un
`check (precio >= 0 and precio <= 100000 and precio = trunc(precio))`
reemplaza al original (`precio >= 0` a secas, mismo nombre de constraint,
`listings_precio_check`) y basta: reescribir la tabla no aporta nada que el
check no dé. `precio = trunc(precio)` es la forma correcta de exigir "sin
decimales" sobre un `numeric` — puede guardar 100.00 (SÍ es entero) pero no
100.50. De paso, `private.formato_precio()` perdió su rama de centavos: ya no
hace falta distinguir, y la aserción de T18 que la vigilaba ("$99.50, no
redondeado a $100") se quitó porque escribir 99.50 ahora es un error de
`check`, no un caso de formateo. El amarre entre `formatPrecio` (cliente) y
`private.formato_precio()` (base) pasó de esa aserción al check mismo: los
dos asumen "siempre entero" porque la base ya no permite otra cosa. Cubierto
por T26 (10 aserciones: acepta 0 y 100000, rechaza negativo/sobre-tope/decimal,
en INSERT y en UPDATE), con control negativo corrido a mano. Detalle del
campo del formulario (formateo en vivo, heurístico miles-vs-decimal) en
`publicar-fotos.md`.

**Protección de `correo` (RNF-05):** RLS filtra filas, no columnas — la
protección real es un `grant select` de columna que excluye `correo`
explícitamente. El propio usuario ya tiene su correo en la sesión de Auth, no
necesita leerlo de `public.users`.

**Protección de `telefono` (RNF-05, RF-13):** mismo criterio que `correo` —
fuera del `grant select`, con una diferencia: `telefono` SÍ tiene `grant update`
(su dueño lo escribe). Se lee **solo** por `public.seller_whatsapp(uuid)`.
Ponerlo en el select lo volvería enumerable en bloque: `users_select` es
`using (true)`, así que un autenticado se bajaría el directorio entero de
teléfonos en un request. **Alcance honesto:** la RPC lo hace no-enumerable-en-
bloque, no inaccesible — `users.id` sí es legible, así que iterarlos y llamar N
veces es posible; son N requests observables contra 1 invisible. Junto a él vive
`tiene_telefono`, columna **generada** (mismo truco que `listings.busqueda`:
materializar para poder referenciarla por nombre desde PostgREST) que responde
"¿es contactable?" sin revelar el número — la usa el gate de Publicar para
decidir en el render si mostrar el campo, sin round trip ni parpadeo.

**El teléfono admite cualquier país (`20260927000470`, check
`users_telefono_e164`), sin perder la regla estricta de México.** E.164
genérico (`+`, lada que no empieza con 0, de 8 a 15 dígitos EN TOTAL) y, si la
lada es `+52`, exactamente 10 después. Los códigos de país son prefix-free, así
que `^\+52` es México y nada más. Cierra la deuda "la lada está fija en +52".

- **Se renombró** de `users_telefono_e164_mx` a `users_telefono_e164`: con el
  sufijo `_mx` el nombre mentiría. Ningún código dependía de él (grep sobre
  `src`, `scripts` y `supabase/functions`); drop + add en la misma migración,
  así que no hay ventana sin check.
- **La validación POR PAÍS no es de la base**: son cientos de reglas que
  cambian. La hace el cliente con **libphonenumber-js, metadata `min`**
  (`src/lib/validacion-perfil.ts`, versión fijada 1.13.14). Medido sobre esa
  versión:
  - Cero dependencias, JS puro, sin módulo nativo (no hace falta rebuild).
  - Metadata: `min` 84 KB crudo / 19.6 KB gz; `mobile` 99 / 24; `max` 157 / 40.
  - El bundle prebuilt `min` completo pesa 179 KB minificado (~44 KB gz).
  - `min` **sí valida por país, no solo longitud**: `+520012345678` y
    `+5215512345678` dan false.
  - `mobile` se descartó porque rechaza fijos (`+34912345678`): con metadata
    atrasada, bloquearía a un usuario real. `max` casi duplica el peso sin
    ganancia para WhatsApp.
- **Lo que acepta el cliente es SUBCONJUNTO de lo que acepta la base**, y lo
  garantiza `formaE164Valida()`, gemelo del check que `telefonoValido()` exige
  además de libphonenumber. **No es teórico:** el probe corre el número de
  ejemplo de los 245 países de la metadata, y **TA y TK** (Tristan da Cunha
  `+290`, Tokelau `+690`) tienen números VÁLIDOS de 7 dígitos en total, que el
  mínimo de 8 de la base rechaza. Sin el gemelo, el cliente los aceptaría y
  el guardado fallaría crudo. **Consecuencia aceptada, a decisión del
  usuario:** un número de esos dos territorios no se puede guardar, y el
  cliente dice "no es válido para Tokelau", que es técnicamente falso. Bajar
  el mínimo a 7 lo resolvería; es una decisión de la regla, no del código.
- **Ladas COMPARTIDAS (+1, +44, +7…):** al reabrir "Editar perfil" el país que
  se pinta es el que la metadata le asigna al número (`separarE164()`), que
  puede no ser el que el usuario eligió: `07911 123456` guardado con Reino
  Unido vuelve como Guernsey. No se pierde nada, porque el E.164 es el mismo y
  la base no guarda el país.
- **`urlWhatsapp()` y `seller_whatsapp` no cambiaron**: ya eran agnósticos al
  país (`slice(1)` del E.164 y la columna tal cual).
- **SIN bandera emoji: el país es el código ISO en texto** ("MX +52 ⌄", filas
  "México" / "MX · +52"). Medido en el emulador Android del proyecto
  (`Medium_Phone_API_36.1`: Android 16, imagen Google `sdk_gphone64_arm64`,
  que trae `NotoColorEmojiFlags.ttf` aparte): las cinco banderas probadas
  (🇲🇽 🇪🇸 🇺🇸 🇩🇪 🇧🇷) **sí se renderizan**, en una notificación, o sea
  en un `TextView` del sistema. **Alcance honesto de esa medición**, mismo
  formato que el permiso de ubicación en `explorar.md`: **el proyecto no tiene
  build de Android** (`android/` no existe), así que es un proxy de la fuente
  del sistema, no la app. Sobre todo, **una sola imagen Google no representa a
  los fabricantes** (Samsung, Xiaomi, versiones viejas), que es justo donde
  fallan: ahí se ven las dos letras sueltas o un cuadro vacío. Por eso la
  decisión no dependió del resultado. Y "junto al emoji" tampoco, porque su
  propio modo de falla es "MX MX +52". **Revisar cuando:** exista un dev
  build de Android, o alguien proponga volver al emoji. En ese caso, medir en
  al menos un dispositivo físico de otro fabricante antes.
- **La lista de países es estática** (`src/lib/paises.ts`, 245, GENERADA por
  `scripts/generate-paises.mjs` desde la misma metadata + `Intl.DisplayNames`
  de Node) para no depender del soporte de `Intl.DisplayNames` en Hermes.

**`users.nombre` es un nombre de persona, no un username
(`20260927000469`, check `users_nombre_valido`).** Letras y un separador
(espacio, `'`, `’`, `-`) solo ENTRE letras, de 2 a 50 caracteres
(`char_length`, no bytes), NULL permitido (la fila nace sin nombre). La forma
`^L+([ '’-]L+)*$` cubre de una vez "sin espacios al borde ni dobles, sin
separadores sueltos". Antes era `text` a secas y el cliente solo exigía "no
vacío tras el trim".

- **"Letra" es un conjunto EXPLÍCITO de rangos, no `[[:alpha:]]`, y NO porque
  falle hoy.** Medido en remoto y en local: la base es `en_US.UTF-8` con
  provider ICU, y ahí `[[:alpha:]]` SÍ reconoce José/Nuñez/Müller (la sospecha
  de "ctype C" no se sostuvo). Los motivos son otros dos. Su significado
  depende del ctype, así que cambiaría con la configuración sin que la
  migración cambiara. Y no equivale al `\p{L}` de JS, así que cliente y base no
  podrían compartir la definición. Los rangos: ASCII, Latin-1 (salta `×` y `÷`)
  y Latin Extended-A entero (polaco, checo, turco… estudiantes de intercambio).
  Fuera quedan Extended-B (`ș`), griego, cirílico y CJK: se escriben
  romanizados.
- **Va escrito con escapes `\uXXXX`, y eso es lo que hace posible el amarre
  TEXTUAL.** El ARE de Postgres los entiende y `pg_get_constraintdef` los
  devuelve tal cual (medido), así que `scripts/probe-perfil.mjs` busca el string
  `CLASE_LETRA` de `src/lib/validacion-perfil.ts` literal dentro de la
  definición viva. Del lado JS ese string es `String.raw`, y no es estilo: un
  literal normal decodifica los escapes al parsear, el valor en runtime sería
  `À-Ö…` y el amarre caería siempre (lo cazó el primer smoke test).
- **La base no normaliza: rechaza.** El cliente manda `normalizarNombre()` (NFC,
  trim, colapsar espacios). El NFC no es cosmético: una "é" en NFD (e + acento
  combinante) la rechaza el check, porque la marca combinante no es letra del
  conjunto. T31 (m) lo documenta.
- **El `.field-error` de las dos pantallas no es autorización duplicada**: el
  candado es el check. `nombreValido()` solo adelanta su veredicto para pintar
  el error del frame en vez de un rechazo crudo al guardar.

**Usuario suspendido — tabla de decisión (no implícita):** puede leer catálogo,
perfiles y reseñas; puede editar su propio perfil (**incluido su teléfono**) y
usar favoritos. NO puede publicar, editar/pausar/borrar sus publicaciones
existentes, tocar sus fotos, contactar por WhatsApp **ni ser contactado**,
calificar, ni reportar. Y además, **todas sus publicaciones `activa` pasan a
`pausada` en el acto de suspenderlo** — al reactivar la cuenta NO se despausan
solas (ver el bloque del trigger más abajo). Casi todo vía el helper
`private.is_active_user()` — las excepciones son "ni ser contactado" y ese
pausado automático, que no pueden usarlo y se explican abajo.

**Tres escrituras que un suspendido CONSERVA, decididas como "permitido,
inofensivo"** (medidas en local el 2026-09-29 con `pg_policies` y `pg_proc`,
al planear la Ola 1 de RF-17; antes no tenían decisión escrita): sumar vistas a
publicaciones ajenas (`public.increment_listing_view`, definer, no mira
`is_active_user()`), registrar o borrar sus `push_tokens`, y marcar como
leídas sus notificaciones (`notifications.leida_at`). Ninguna afecta a otra
persona ni a lo que ve el catálogo.

**Suspender exige motivo, también desde Studio** (`20260930000478`, D15):
`users.suspendido_at` y `users.suspension_motivo` (3-500 caracteres tras
`btrim`) van juntas con `estado = 'suspendido'` y en NULL con `'activo'`
(`users_suspension_coherente`, en los dos sentidos). Así que desde Studio,
**suspender** exige escribir las dos, y **reactivar** exige dejar las dos en
NULL; un UPDATE a mano que no lo haga falla con **23514**. El panel lo hace con `admin.suspender_usuario`, que
además audita. Ninguna de las dos es legible por el cliente (T12). El detalle,
en el bloque del panel de admin, más abajo.

Las tres primeras **sí tienen policy real detrás**, por si alguien lo duda:
`listings_insert_own`, `listings_update_own` y `listings_delete_own`
(`20260906000439:61-74`) llevan `is_active_user()` en su `with check` / `using`,
y T10 las vigila con `:B` suspendido. No son intención documentada.

**Dónde se hace cumplir "no puede contactar por WhatsApp", que no era donde
parecía.** `listing_contacts_insert_own` exige `is_active_user()`, así que la
base sí le rechaza al suspendido el registro del contacto — pero el cliente se
traga ese rechazo **a propósito**: negarle el contacto a alguien por un fallo de
log sería peor que perder la fila, así que abre `wa.me` igual y solo avisa con un
toast. Correcto para un fallo de red, y con el efecto colateral de que **el único
efecto real de estar suspendido era no quedar registrado**. Desde que el número
vive detrás de `seller_whatsapp`, esa función es lo único que hace cumplir la
regla.

**Y la hace cumplir en las DOS direcciones, con dos mecanismos distintos**
(`20260911000449`) — lo segundo lo destapó una prueba en dispositivo, donde un
comprador activo sí llegaba a WhatsApp de un vendedor suspendido:

- **el llamante**, con el `case ... when private.is_active_user()`;
- **el objetivo**, con un `and u.estado = 'activo'` inline en el subselect. Va
  inline y NO con el helper porque `is_active_user()` resuelve `auth.uid()` por
  definición: no acepta parámetro, así que no hay forma de preguntarle por un
  tercero.

No quites ninguno de los dos "por simplificar": T16 tiene una aserción por cada
dirección, y cada una pide el número de alguien cuyo estado NO esté en juego,
justo para que un `null` no pueda pasar por la razón equivocada.

Consecuencia en la UI: `seller_whatsapp` devuelve `null` por **tres** causas —el
vendedor no tiene número, quien llama está suspendido, o el vendedor lo está— y
no dice cuál. El toast las separa con datos que el cliente ya tiene: `estado` de
la propia sesión (`profile.estado`, en `PROFILE_COLUMNS`) y `estado` del vendedor
(en el embed `VENDEDOR` de `src/lib/listings.ts`, que lo trae para esto). El
mensaje del vendedor suspendido es **neutro** ("Esta cuenta no está disponible
para contacto"): el dato es consultable, pero anunciar en pantalla que una cuenta
está sancionada es otra cosa. Nada de esto es autorización duplicada: la RPC ya
negó el número mire el cliente lo que mire, y lo único que se elige aquí es el
texto.

**Suspender una cuenta PAUSA sus publicaciones activas, y el trigger es lo
contrario de lo que hizo el precedente más parecido** (`20260917000457`, RF-17).
Cerrarlo era lo que faltaba para que la regla de arriba tuviera sentido de punta
a punta: `listings_select` no mira el estado del DUEÑO —solo esconde las
`pausada` a quien no es su dueño—, así que el catálogo seguía ofreciendo
publicaciones que nadie podía contactar. El comprador tocaba "Contactar por
WhatsApp" y recibía el toast neutro de arriba, sin haber podido saberlo antes.
`private.pause_listings_on_suspend()` pasa a `pausada` todas las `activa` de esa
cuenta en la misma transacción que la suspensión.

- **SÍ un trigger, cuando para `vendida` se descartó DELIBERADAMENTE uno**
  (`20260913000454`, arriba): allá el problema era que un trigger alcanza también
  a `service_role` y eso habría cerrado Studio, la única vía de corrección. Aquí
  esa misma propiedad es el requisito: `estado` no está en el `grant update` de
  `authenticated` (`20260906000438:110`), así que la ÚNICA vía por la que hoy
  alguien se suspende ES `service_role`/Studio. Un mecanismo que no lo alcanzara
  no se dispararía nunca. **No copies el precedente por analogía: son el mismo
  argumento con el signo cambiado.**
- **Tampoco una policy.** `listings_select` tendría que mirar el estado del dueño
  (un join por fila en el camino caliente del feed) y, sobre todo, la fila
  seguiría `activa` en la base: "Mis publicaciones" le seguiría mintiendo al
  vendedor sobre en qué estado está su catálogo.
- **`SECURITY DEFINER`, y la decisión está MEDIDA, no deducida.** Hoy `invoker`
  alcanzaría: el único rol que escribe `estado` es `service_role`/`postgres` y
  los dos tienen `bypassrls`. Lo que compra `definer` es que la regla no dependa
  de eso — con un rol de moderación con `grant update` sobre las dos tablas pero
  SIN `bypassrls` (el escenario de RF-17 con plataforma propia), medido en local:
  **invoker → 0 filas afectadas, la publicación sigue `activa`, SIN ERROR**;
  definer → 1 fila, `pausada`. O sea que el invoker cae en la familia de fallos
  silenciosos de §9. De paso coincide con el criterio que el repo ya tenía
  escrito en `20260906000439:31`: `set_updated_at()` es la ÚNICA función de
  `private` que no es definer, y lo es "porque no lee ni escribe otras filas".
- **El `when` son DOS candados, no uno**, y cada mitad tiene su propia aserción
  porque cada una deja pasar lo que la otra caza: sin `old.estado is distinct
  from new.estado`, CADA guardado de "Editar perfil" de una cuenta suspendida
  —ruta que un suspendido conserva abierta— volvería a pausarle todo (T23 (e));
  sin `new.estado = 'suspendido'`, levantar la suspensión pausaría lo que el
  vendedor tuviera activo en ese momento (T23 (g)).
- **El update va acotado a `estado = 'activa'`**, y no es prolijidad: este código
  corre ELEVADO, así que la policy que hace terminal a `vendida` no lo frena —
  sin el filtro, suspender resucitaría una venta a `pausada` por la puerta de
  atrás (T23 (c)). Y una `pausada` ni se toca, o se le movería el `updated_at` y
  el vendedor vería "modificada hoy" algo que nadie modificó (T23 (b)).
- **Al REACTIVAR no se despausan solas**, y es decisión de producto, no una
  simplificación: el vendedor las reactiva a mano desde "Mis publicaciones", que
  ya exige al menos una foto. Tampoco se distingue en la UI "pausada por
  suspensión" de "pausada por el usuario" — mismo estado, y diferenciarlo pediría
  frame nuevo (§0 regla 4) y casi seguro una columna.
- **Solo cubre UPDATE**, igual que el trigger de fotos y con el mismo matiz de
  siempre: un insert directo de `users` con `estado='suspendido'` no lo dispara
  (inofensivo por sí solo — esa fila aún no puede tener publicaciones), pero una
  publicación creada `activa` para una cuenta YA suspendida se queda `activa`.
  Deuda consciente documentada en la migración, con su disparador y su fix.
- **Consecuencia de segundo orden, medida:** en remoto hay **20** publicaciones
  (medido el 2026-09-29, de 2 dueños; decía "26") `activa` sin una sola foto (filas viejas, anteriores a que existiera la
  subida). Hoy nadie las valida, porque `listings_enforce_activation_has_photos`
  solo mira la TRANSICIÓN hacia `activa`. En cuanto una de ellas se pause por
  suspensión, su dueño no podrá reactivarla sin subirle una foto primero. Es el
  estado que el modelo atómico existe para imponer y tiene salida dentro de la
  app, así que no es deuda — pero no se ve en el diff.

**Quién compró NO es una columna de `listings`, y la razón no es de estilo**
(`20260912000453`). `listings` tiene `grant select` **a nivel tabla**
(`20260906000439:86`), así que toda columna nueva queda legible por cualquier
autenticado que pueda ver la fila — y `listings_select` solo esconde las
`pausada`: una publicación vendida la ve el campus entero. El truco de
`correo`/`telefono` (sacarla del grant) **no se puede aplicar aquí**: exigiría
convertir ese grant a lista de columnas, que es justo lo que hoy hace funcionar
a `listings.busqueda` sin grant propio y lo que T13 vigila. Y comprar es más
revelador que preguntar: `favorites` es privado hasta para el dueño de la
publicación, y `listing_contacts` solo lo ven las dos partes. `listing_sales`
hereda esa postura. De regalo, el trigger de notificación cuelga de esa tabla y
su rama de insert **no necesita cláusula `when`** — colgado de `listings`
tendría que esquivar a `increment_listing_view()` y `set_updated_at`, que
disparan en TODOS los updates.

**`vendida` es TERMINAL, y lo hace cumplir la policy — no un trigger, y el
detalle importa** (`20260913000454`). `listings_update_own` lleva
`and estado <> 'vendida'` en su **`using`**, nunca en el `with check`: el `using`
se evalúa contra la fila VIEJA (el gotcha de §9, otra vez a favor), así que la
transición activa/pausada → vendida pasa y todo update posterior queda fuera.
En el `with check` bloquearía el marcado de venta, que es justo lo contrario — lo
caza el control negativo, que muere en la transición misma.

- **Por qué NO un trigger, que es lo que hizo el precedente de forma idéntica**
  (`20260909000447`): `increment_listing_view()` es `SECURITY DEFINER` sobre una
  tabla sin `force row level security`, así que **bypasea RLS pero no triggers**,
  y su filtro es `estado <> 'pausada'` — o sea que sí cuenta vistas de vendidas.
  **Medido**: con la regla puesta como trigger, la suite muere en la aserción (i)
  de T20 con la excepción del trigger. Un trigger haría reventar **abrir el
  Detalle** de cualquier publicación vendida. Segundo motivo: un trigger alcanza
  también a `service_role`, cerrando Studio, que es donde vive la moderación
  (RF-17) y la única salida para arreglar una venta marcada por error.
- **El rechazo NO lanza**, mismo gotcha que `listing_sales_update_seller`: el
  `using` filtra y el update afecta 0 filas sin error. Por eso
  `cambiarEstadoListing` y `actualizarListing` piden `{count:'exact'}` y lanzan
  `ListingNoEditableError` — sin eso el usuario veía "Cambios guardados" sobre un
  update que no escribió nada. **Ojo al leer ese 0: tiene DOS causas** (vendida, o
  el usuario suspendido) y la respuesta no dice cuál, así que el copy es neutro.
- **Lo que esto cerró no era el caso obvio.** No era "editar el título de algo
  vendido": era que el toggle de pausa de `editar/[id].tsx` **resucitaba una
  venta**, porque su estado local arranca en `listing.estado === 'pausada'` —o
  sea `false` sobre una vendida—, el control se veía "Activa" y tocarlo la
  despausaba. Por eso T20 tiene dos aserciones y no una para las dos ramas del
  mismo toggle.
- **Queda vivo sobre una vendida:** verla, corregir el comprador (`listing_sales`,
  otra tabla con su propia policy) y eliminarla (`listings_delete_own`, intacta).

**Se puede corregir al comprador mal elegido, y el congelamiento es
DIRECCIONAL.** `listing_sales_update_seller` deja al vendedor reapuntar
`comprador_id` —a otro de sus contactos, nunca a sí mismo— **hasta que ÉL haya
calificado a ese comprador**. Una reseña del comprador hacia el vendedor NO
cierra la ventana, y eso es deliberado: las dos direcciones no son simétricas en
consecuencia. Si el vendedor ya calificó, existe una reseña *suya* sobre alguien
que quizá nunca le compró y moverla sería lavarla; si calificó el otro, esa
reseña se sostiene sola (sí hubo contacto real) y congelar por ella castigaría
al vendedor **y al comprador real** por el acto de un tercero — el comprador
real no podría ser acreditado ni calificar nunca. "Simplificarlo" a las dos
direcciones no rompe nada visible: solo vuelve incorregible un error ajeno. Lo
caza T19 (l2), y el `using` se evalúa contra la fila VIEJA (el gotcha de §9, esta
vez a favor), así que `listing_sales.comprador_id` ahí dentro es el comprador
**original**.

- **Esa condición está escrita DOS VECES** — en el `using` de la policy y en
  `congelada()` de `src/lib/confianza.ts`. Cambiar una sin la otra no produce
  ningún error: solo una fila de menú que desaparece de más, dejando al vendedor
  sin salida. Es el mismo acoplamiento que `formatPrecio` ↔
  `private.formato_precio()`, **pero el amarre NO puede ser una aserción de la
  suite**, y por eso vive en `scripts/probe-venta.mjs`: allá las dos
  implementaciones producen el mismo STRING y T18 lo compara carácter por
  carácter; aquí un lado es una query del cliente y el otro una cláusula `using`,
  así que no hay salida común observable desde SQL. El amarre tiene que ser un
  script que ejecute los DOS lados contra el mismo estado. Ver §6.
- **Y ese amarre son DOS MECANISMOS con responsabilidades distintas, no uno.**
  Conviene saberlo antes de "simplificar" borrando alguno, porque cada uno deja
  pasar exactamente lo que el otro caza:
  - **El escenario 3 de `probe-venta.mjs`** vigila la **lógica**: ejecuta la
    condición contra la base por la ruta del COMPRADOR y comprueba las dos
    polaridades. Caza que la condición esté mal *pensada* (la variante
    bidireccional, una dirección invertida).
  - **El tripwire sobre el fuente** vigila la **firma y el cableado** de
    `congelada()`. Caza que la condición esté bien pensada pero mal *conectada*.
  - Por qué hacen falta los dos: `congeladaSegunCliente()` del probe **transcribe**
    la query, no importa a `congelada()` — `src/lib/confianza.ts` no es cargable
    desde Node (arrastra `expo-secure-store`, `expo-crypto`, AsyncStorage). O sea
    que el escenario 3 prueba la semántica, pero **no** prueba que la app use esa
    semántica. **Medido, no deducido:** al reintroducir a propósito el bug de
    derivar el vendedor de la sesión, el escenario 3 pasó en verde y lo cazó
    ÚNICAMENTE el tripwire. Borrarlo "porque el escenario 3 ya cubre todo" deja
    ese bug sin red.
- **El rechazo NO lanza**: el `using` filtra, así que el update afecta 0 filas.
  `corregirComprador()` compara el conteo — sin eso, "ya calificaste" se vería
  igual que un éxito.
- **Dos triggers sobre la misma función, no uno**: el `WHEN` de un trigger
  declarado sobre INSERT y UPDATE a la vez no puede referenciar `old`.

**`can_rate()` mira ahora también `listing_sales`, en las DOS ramas.** Antes,
cualquiera de los que contactó podía calificar al vendedor (haya comprado o no) y
el vendedor podía calificar a cualquiera de sus contactos. Registrada la venta,
la única pareja que puede calificarse es vendedor ↔ comprador. Cada rama suma un
`not exists` sobre una venta de OTRA persona — y como la PK es `listing_id`, eso
dice exactamente "no hay venta registrada, o la venta es de quien toca", así que
el caso viejo (sin venta, o "No fue a través de Relevo") sigue intacto. Se hizo
con `create or replace` para conservar el OID: un `drop` obligaría a recrear
`ratings_insert_own`/`ratings_update_own` y su `grant execute`.

**Nadie se reporta a sí mismo, pero son DOS mecanismos distintos y conviene no
confundirlos** (`20260914000455`, el segundo cambio a una policy del repo). El
autorreporte de USUARIO lo cierra un `check` de tabla desde el principio
(`20260906000441:22`, `reported_user_id <> reporter_id`): compara dos columnas de
la misma fila, así que cabe en la tabla. El de PUBLICACIÓN no podía ir ahí —el
dueño vive en `listings` y un `check` con subconsulta no es legal en Postgres—,
así que se sumó al `with check` de `reports_insert_own` como
`not exists (select 1 from public.listings l where l.id = listing_id and
l.user_id = reporter_id)`. Tres cosas que no se ven en el diff:

- **Faltaba de verdad, no era teórico.** `reports` nació en la Fase 2, antes de
  que existiera una UI que reportara publicaciones, y el hueco solo apareció al
  construir la hoja de RF-14. Hoy la app no lo alcanza (la bandera solo se pinta
  con `isOwner` false), pero la ruta `/reportar/[id]` sí, por deep link.
- **El subselect corre bajo la RLS del invocante y aun así es correcto**, que es
  lo primero que da ganas de "endurecer" con un `SECURITY DEFINER`: el `exists`
  solo puede ser verdadero cuando el listing es MÍO, y `listings_select` siempre
  le muestra al dueño los suyos —activos o pausados—. Si es de otra persona y
  está pausado (invisible para mí), el `exists` da false igual, porque su
  condición exige `l.user_id = reporter_id`. El único caso que puede dar true es
  también el único garantizadamente visible.
- **El rechazo SÍ lanza**, al revés que los dos precedentes que más se le
  parecen (`listings_update_own` y `listing_sales_update_seller`): un `with
  check` de INSERT aborta con `42501`, no filtra en silencio como un `using` de
  UPDATE. Por eso `crearReporte()` no necesita `{count:'exact'}` ni un error
  propio — le llega la excepción.
- **Va `not exists` y NO el `<>` contra el subselect, que es más corto y está
  mal.** `reporter_id <> (select l.user_id … where l.id = listing_id)` cierra el
  autorreporte igual, pero con `listing_id` en NULL —el reporte de USUARIO— el
  escalar es NULL, la comparación es NULL, y un `with check` que evalúa a NULL
  rechaza: rompe esa rama entera en silencio. Con `not exists`, ese caso no
  machea nada y la cláusula da true.

**Las TRES primeras aserciones de T21 son las tres ramas de esa cláusula — la
sección se sostiene sola a propósito.** (Son las tres de ESA cláusula, no las
tres de la sección: T21 tiene una cuarta, (d), que prueba el otro candado —ver
abajo—.) Autocontenida con sus propios `:M`/`:N`. Cada una es la ÚNICA que caza
su fallo, medido corriendo T21 aislada contra las tres variantes rotas:

| Variante de la cláusula | T21 sola cae en |
|---|---|
| sin la cláusula (permisiva) | **(a)** el dueño reporta lo suyo |
| sin el `l.user_id = reporter_id` (rechaza TODO reporte de publicación) | **(b)** el tercero ya no puede reportar |
| el `<>` contra el subselect (rompe el reporte de usuario) | **(c)** `listing_id is null` |

**(c) nació de un hueco medido, no de prolijidad.** La primera versión de T21
tenía solo (a) y (b) y delegaba la rama `listing_id is null` a T8 —"ya lo cubre,
no se repite aquí"—: contra la variante del `<>`, T21 entera daba **verde** y la
cazaba únicamente T8, o sea que la protección de esta migración dependía de una
sección que no sabe que T21 existe. Hoy T8 la sigue cazando primero por orden de
archivo (inserta un reporte de publicación en su línea ~296), pero eso es
redundancia, no la red. Lección hermana de la de `:C` en T11b: una aserción que
pasa porque otra sección hizo el trabajo no está probando lo que dice.

**(d) prueba el OTRO candado, y por eso no entra en esa tabla.** Las tres de
arriba son variantes del `with check` de `20260914000455`; (d) ejercita el
`check` de tabla de `20260906000441:22` —el autorreporte de USUARIO—, que existe
desde la Fase 2 y **no tenía control negativo propio**: (c) probaba el camino
feliz de esa rama y el de rechazo no lo probaba nadie, porque ninguna pantalla
podía alcanzarlo. RF-14 lo volvió alcanzable desde la bandera de "Perfil
público" (`cuenta-perfil.md`), así que dejó de ser teórico. **Medido con el control negativo**:
quitando ese `check`, la suite entera llega hasta T21 sin inmutarse —incluida
(c), que pasa justo antes— y la única que cae es (d). Y el motivo del rechazo se
distingue solo con leerlo: (a) dice "rechazado: permiso" (es una policy) y (d)
dice `violates check constraint "reports_check1"` (es una restricción de tabla).
Son dos mecanismos distintos porque tienen que serlo — el de usuario compara dos
columnas de la misma fila y cabe en un `check`; el de publicación necesita mirar
`listings`, y un `check` con subconsulta no es legal en Postgres.

**`vistas_count` se incrementa solo vía `public.increment_listing_view(id)`**
(`SECURITY DEFINER`, excluye al dueño para que no infle sus propias vistas).
La columna en sí no es editable directo por el cliente (grant de columna) —
sin eso, la RPC sería decorativa y cualquiera podría hacer
`update listings set vistas_count = 99999`.

**`favorites` no es contable ni por el dueño de la publicación** — su RLS es
`user_id = auth.uid()`, así que el vendedor no puede hacer un `count` de los
favoritos de su propia publicación (el stat que pide el frame "Detalle (vista
vendedor)"). Ese número llega por `public.listing_favorites_count(id)`:

- **Esquema `public`, no `private`** — y es la excepción, no la regla. Toda
  función `SECURITY DEFINER` del proyecto vive en `private`; las únicas dos que
  no son las que el cliente tiene que poder invocar por RPC vía PostgREST, y
  esta es una (la otra es `increment_listing_view`).
- **`SECURITY DEFINER`** porque tiene que ver filas de `favorites` que la RLS le
  esconde al invocador — mismo motivo que `private.can_rate()`.
- **Valida que el llamante SÍ sea el dueño** de la publicación, simétrica a
  `increment_listing_view`, que valida que NO lo sea. Sin ese `exists`,
  cualquier autenticado podría contar los favoritos de publicaciones ajenas.
- **Devuelve `null` a quien no es el dueño**, no un error: así se mantiene como
  función `sql` pura —`stable`, sin `plpgsql` ni bloque `EXCEPTION`— por la
  cautela que impone `supabase/KNOWN_ISSUES.md`. `null` no se confunde con `0`
  porque la UI solo pinta esa tarjeta al dueño.
- Devuelve el conteo, **nunca quién**: los favoritos siguen siendo privados.

**Búsqueda de texto (RF-10): columna generada, no índice de expresión.** El
esquema original indexaba la *expresión*
`to_tsvector('spanish', titulo || ' ' || coalesce(descripcion,''))`, pero el
planner solo usa un índice de expresión cuando la consulta la REPITE, y
PostgREST no sabe emitirla (`titulo=fts(spanish).x` produce
`to_tsvector('spanish', titulo)`, que no machea). O sea: se pagaba en cada
escritura y no lo usaba nadie. Materializando la misma expresión en la columna
`busqueda`, el índice pasó a ser USABLE por el planner. **De paso arregla los
acentos**: el diccionario snowball reduce `Cálculo` y `calculo` al mismo lexema
`calcul` — con `ilike`, buscar "calculo" devolvía 0 sobre "Cálculo de Larson".
No se usa la extensión `unaccent`; el diccionario ya lo hace.

**Pero como `authenticated` el índice GIN NO SE USA, y este archivo afirmó lo
contrario durante meses.** Aquí y en `explorar.md` se leía "el índice GIN por fin
se usa (medido con `explain analyze` a 80 000 filas: Bitmap Index Scan, 0.9 ms)".
Se creía medido con RLS aplicado; **era bypassrls**. Medido de nuevo el
2026-09-24, con 80 000 filas y 35 coincidencias, imprimiendo el rol antes de
cada corrida: como `postgres` (bypassrls) sale Bitmap Index Scan en 1.1 ms, y
como `authenticated` sale **Seq Scan en 8.4 ms**, con el mismo SQL. La causa es
general y está en §9: el `@@` no es LEAKPROOF, así que la RLS obliga a evaluarlo
después de la qual de `listings_select`. **El rol de la medición original no se
puede rastrear**: la cifra entró como prosa en `0fb744f` (2026-09-08) y ningún
script con esas 80 000 filas llegó nunca al historial (`git log --all -S "80000"`
no devuelve nada). A 80 000 filas el seq scan sigue muy dentro de RNF-01; la
deuda, con su disparador, está en `explorar.md`.

**El texto pasa por `public.buscar_listings(q text) returns setof listings`**
(`20260926000468`, búsqueda por PREFIJO en el último término: "calc" encuentra
"Cálculo"). El cliente hace `.rpc('buscar_listings', {q}, {get:true}).select(…)`
y encadena encima sus filtros, alcance, orden, cursor y embeds, medido por HTTP
en los 4 órdenes × 3 alcances. Sin texto, la consulta es la de siempre. Las
decisiones de la función, cada una vigilada por T30:

- **Es `SECURITY INVOKER`, y esto es lo que la separa de las otras tres RPC de
  `public`, que sí son definer.** Devuelve filas de `listings`, así que como
  definer saltaría `listings_select` y entregaría las pausadas, pendientes y
  bloqueadas ajenas que casen con el texto. Como invoker, la RLS aplica igual que
  en un `from('listings')`. Si la vuelves definer, cae T30 (h).
- **No lleva `set search_path`, a propósito, y eran la ÚNICA del repo sin él
  hasta que `recomendar_listings` (abajo) repitió la decisión por la misma
  razón.** Una cláusula SET impide que Postgres inlinee una función SQL que
  devuelve un set. Inlineada, el filtro de texto y los filtros del cliente se
  planean como una sola consulta; sin inlinear, sería un Function Scan que
  materializa todas las coincidencias antes de filtrar. Para compensar, todo va
  calificado por esquema. Lo vigila T30 (i2) con `proconfig is null`.
- **Nunca lanza, por construcción.** El texto del usuario nunca se concatena a
  sintaxis de tsquery: lo crudo pasa por `websearch_to_tsquery`/`to_tsvector`, y
  `to_tsquery` solo recibe un lexema que pasó `^[[:alnum:]]+$`. T30 (j)/(j2) lo
  fuzzean. (j2), con un término pegado a sintaxis (`calc)`), es la que caza la
  concatenación cruda. La basura sola de (j) no llega a ese camino.
- **Grant:** `revoke all` y después `execute` solo a `authenticated`. Anon no
  gana nada.
- `busqueda` sigue sin grant propio y T13 sigue valiendo: una función invoker lee
  la columna con los privilegios de quien la llama.

`busqueda` **no lleva grant propio y no es un olvido**: a diferencia de
`update`, que en esta tabla sí está acotado por columna, `select` se otorgó a
nivel tabla, y en Postgres eso cubre las columnas que se agreguen después.
Filtrar por una columna exige SELECT sobre ella, así que ese grant heredado es
lo que hace que la búsqueda funcione — la suite lo vigila (T13), porque
"endurecerlo" a una lista explícita rompería la búsqueda sin ningún error
visible en la app. Escribirla es imposible por definición: Postgres rechaza
cualquier escritura sobre una columna generada, sin importar los grants.

**Intereses y "Recomendados para ti" (`20260930000475`, 2026-09-27).** El
estado sin texto de Búsqueda dejó de ser "las 4 más recientes" y pasó a un
ranking personalizado con scroll infinito. Sin ML: un puntaje por categoría en
SQL (RNF-09). El Feed no cambia. Decisión de producto sin RF numerado, anotada
en `docs/product-spec.md` (Descubrimiento).

- **`public.user_intereses`** guarda las categorías que el usuario ELIGE: paso
  opcional "Intereses" del alta, y después Perfil → "Mis intereses". Tiene PK
  `(user_id, categoria_id)`, una fila por categoría y no un arreglo en `users`.
  - Las dos FKs son `on delete cascade`. Borrar la cuenta se lleva los
    intereses sin ningún trigger de `20260929000474`, porque un interés no
    menciona a nadie más. T33 (h) cazaría una FK equivocada, y T34 (k) lo prueba.
  - RLS con tres policies (select/insert/delete), todas
    `user_id = auth.uid()` y sin `is_active_user()`: es el mismo criterio que
    `favorites`.
  - `revoke all` y después `grant select, insert, delete`, **sin UPDATE**:
    cambiar de interés es borrar una fila y crear otra.
  - **Sin índice sobre `categoria_id`, a propósito.** Todo lo que lee la tabla
    filtra por `user_id`, que es la columna líder de la PK. El único que lo
    aprovecharía es el cascade al borrar una categoría desde Studio. Se agrega
    cuando exista una consulta que lo use.
- **`public.recomendar_listings(p_campus_id, p_universidad_id, p_cursor_puntaje,
  p_cursor_created_at, p_cursor_id, p_limit)`** devuelve solo
  `(id, puntaje, created_at)`, ya ordenado y paginado.
  - **Son DOS PASOS y no `setof listings`.** El puntaje no es columna de
    `listings`, así que el patrón de `buscar_listings` (el cliente encadena
    orden y cursor encima) no podría ordenar ni hacer keyset por él. El
    cliente trae las tarjetas con `from('listings').in('id', ids)` y pinta en
    el orden de la RPC (`fetchRecomendados()`, `explorar.md`).
  - **Puntaje por categoría:** `4·interés + 2·contacto + 1·favorito`, con cada
    señal en 0/1 (el `union` deduplica).
    - Son potencias de 2 sobre señales binarias, así que el orden es
      lexicográfico y cumple "explícito > contactos > favoritos" siempre: un
      interés solo (4) le gana a contacto + favorito juntos (3).
    - **No se cuentan repeticiones, a propósito:** con conteo, diez favoritos le
      ganarían a una categoría elegida a mano.
    - Se explica en una frase: primero lo que elegiste, luego lo que
      contactaste, luego lo que guardaste.
  - **Ventana de 90 días** (≈ un periodo escolar) para contactos y favoritos,
    sobre `listing_contacts.created_at` y `favorites.created_at`. Los intereses
    explícitos no caducan.
  - **Cold start:** sin señales todo puntaje es 0 y el orden se reduce a
    `created_at desc, id desc`. O sea, lo más reciente del alcance: la sección
    nunca queda vacía por falta de intereses (T34 (f)).
  - **Orden total y estable entre páginas:** `(puntaje, created_at, id)` desc,
    con `id` único como último desempate, y un keyset por comparación de fila.
    Sin el `id`, las publicaciones empatadas se saltan al paginar (T34 (h)).
  - **Excluye las propias en la función** (`user_id <> auth.uid()`), no en el
    cliente: es regla del ranking, y así se prueba (T34 (g)).
  - **SECURITY INVOKER.** Hoy la salida de un definer sería idéntica, porque el
    `estado = 'activa'` de la propia función ya descarta las ocultas: (d) tiene
    dos candados. **Lo que cambiaría con definer son las SEÑALES:** leería
    favoritos y contactos sobre publicaciones que la RLS le esconde (T34 (d3)).
    Y para las **vendidas**, que son públicas por RLS, el único candado es ese
    `estado = 'activa'` (T34 (d4)).
  - **Matiz heredado por ser invoker, aceptado:** el favorito o contacto de una
    publicación ajena que HOY está pausada, pendiente o bloqueada no da señal.
    Las vendidas sí cuentan, y las borradas ya no existen, por el cascade.
  - **Sin `set search_path`**, igual que `buscar_listings` y por la misma razón,
    que aquí está MEDIDA. Inlineada, el plan trae
    `Index Cond: (campus_id = '1'::bigint)`: los parámetros entran como
    constantes y el `p_campus_id is null or …` se resuelve al planear. Todo va
    calificado por esquema, y T34 (j1) vigila `proconfig is null`.
  - **Grant:** `revoke all` y después `execute` solo a `authenticated`.
- **Costo, medido como `authenticated`** con `supabase/seeds-local/volumen.sql`
  (80 000 activas y 4 000 pausadas), página 1:

  | Alcance | Recencia de hoy (la deuda que ya existía) | `recomendar_listings` |
  |---|---|---|
  | campus (20k) | 6.1 ms | 5.6 ms |
  | universidad (60k) | 13.8 ms | 15.1 ms |
  | todo (80k) | 12.1 ms | 21.2 ms |

  - La página 2 cuesta lo mismo que la 1: el puntaje sale de un join, así que
    el keyset no puede saltarse filas.
  - Leer el alcance es la deuda de `explorar.md` ("Alcance del catálogo").
  - Lo nuevo es el join con las señales más el top-N sobre el puntaje. Calcular
    las señales cuesta 0.1-0.3 ms, y la segunda consulta por id, 0.03 ms.
  - **Los índices que propone aquella deuda NO abaratan esta función**, porque
    ordenan por `created_at` y aquí manda el puntaje. Deuda propia, con
    disparador, en `explorar.md`.
- **El cliente no filtra nada.** `interesesVersion`, en `explorar-state.tsx`,
  solo existe para reiniciar la lista tras guardar intereses. La base decide
  qué se ve y en qué orden (§0 regla 7).
- **No se guarda historial de búsquedas** (decisión explícita). Queda como
  deuda con disparador en `explorar.md`.

**El bucket `listing-photos` es privado, y eso NO es una preferencia.** Es lo
único que hace real la regla de que las fotos de una publicación pausada solo las
vea su dueño: un bucket público salta el control de acceso en lectura y las
policies solo gobernarían la escritura. Cuatro policies sobre `storage.objects`
(`20260908000446`) espejean a las de la tabla: lectura con el criterio de
`listings_select`, escritura con el de `listing_photos_write_own` más
`is_active_user()`. **La carpeta del objeto es la llave de autorización** —
`private.listing_id_from_object_name()` la traduce a un `listing_id` con un
`case` (no un `and`, que el planner puede reordenar y haría reventar el cast con
`22P02` ante una ruta arbitraria).

Matiz que conviene saber antes de "limpiar" esa policy: en la de lectura, la
condición `estado <> 'pausada'` es **redundante** — las expresiones de policy se
evalúan como el rol invocante, así que el `exists` sobre `public.listings` ya
viene filtrado por `listings_select`. Medido: quitarla no cambia el
comportamiento. Lo portante es el `exists`. Se conserva por legibilidad y por si
algún día alguien afloja `listings_select`, pero no es el candado.

**El bucket `avatars` es PÚBLICO, y eso tampoco es una preferencia — es la
decisión opuesta a la de arriba, por la razón opuesta** (`20260916000456`,
RF-03). El motivo por el que `listing-photos` es privado NO se traslada: allá el
criterio de SELECT es **variable** (`estado <> 'pausada' or eres el dueño`), y es
justo lo que un bucket público saltaría. Para un avatar no existe estado
equivalente —`users_select` es `using (true)` y `fetchPerfilPublico()` ni filtra
por `estado`, así que el perfil de un suspendido se abre igual—, de modo que la
policy de SELECT de un `avatars` privado sería `bucket_id = 'avatars'` y nada
más: una constante. Eso no es un candado, es ceremonia, y se paga con el header
`Authorization` en las 9 superficies que pintan un avatar (dos de ellas LISTAS) y
con un parpadeo a iniciales en cada arranque en frío, mientras la sesión resuelve.
**Alcance honesto:** el objeto se sirve sin autenticación a quien tenga la URL; no
es descubrible ni enumerable (`list` como `anon` devuelve `[]`, medido), pero
tampoco es revocable salvo borrándolo.

Son **tres** policies, no cuatro, y las tres diferencias con `listing-photos` son
deliberadas: sin `is_active_user()` (un suspendido SÍ edita su propio perfil, §3
arriba), sin función de parsing de ruta (la carpeta se compara como TEXTO contra
`auth.uid()::text`, sin cast que pueda reventar) y sin policy de UPDATE (nada
mueve ni sobrescribe un avatar: cada subida estrena uuid y borra el anterior, que
es lo que le da consumidor a la de DELETE). La de SELECT existe aunque el bucket
sea público, y no por simetría: es lo que hace que el borrado funcione — ver §9.

**Una publicación no pasa a `activa` sin al menos una foto** — trigger
`listings_enforce_activation_has_photos` (`20260909000447`), que llama a
`private.enforce_activation_has_photos()`. Existe porque el alta atómica (`publicar-fotos.md`)
deja publicaciones `pausada` con 0 fotos cuando la subida falla, y las dos rutas
de reactivación ("Mis publicaciones" y el toggle de "Editar publicación") las
volvían `activa` sin validar nada — justo el estado que el modelo atómico existe
para impedir. Tres cosas que conviene saber antes de tocarlo:

- **El `when (old.estado is distinct from new.estado and new.estado = 'activa')`
  no es una optimización, es lo que lo hace viable.** Medido quitándolo: la suite
  ni llega a T15, revienta en T5 porque `increment_listing_view()` hace un
  `update listings set vistas_count = …` y el trigger se le dispara encima. O
  sea que sin el `when`, **abrir el Detalle** de cualquier publicación sin fotos
  fallaría. Además protege las filas viejas de remoto (`activa` con 0 fotos,
  creadas antes de que existiera la subida o desde Studio), que si no serían
  ineditables.
- **Solo cubre UPDATE.** Un insert directo con `estado='activa'` y 0 fotos sigue
  siendo posible — deuda consciente documentada en `publicar-fotos.md`, con su disparador y su
  fix. No es que no se pueda: es que cerrarlo cuesta reescribir 4 bloques de
  fixtures de la suite y voltear el default de la columna.
- El guard equivalente en el cliente (`publicar-fotos.md`, `cuenta-perfil.md`) **no es lógica de autorización
  duplicada**: el candado es este trigger, el cliente solo traduce su
  `raise exception` a un toast con salida.

**Funciones `SECURITY DEFINER`** viven en el esquema `private` (nunca en
`public`) excepto TRES, que sí deben ser invocables por PostgREST desde el
cliente: `increment_listing_view`, `listing_favorites_count` y
`seller_whatsapp` (eran una sola hasta que Detalle necesitó el conteo de
favoritos, y dos hasta que el botón de WhatsApp necesitó el número real; si
algún día hay una cuarta, revisa primero si de verdad la invoca el cliente o si
va en `private`). **`public.buscar_listings` y `public.recomendar_listings` NO son la
cuarta**: también son RPC de `public`, pero INVOKER a propósito (sus bloques,
más arriba), y volverlas definer sería una fuga. `authenticated` tiene `USAGE` sobre `private` + `EXECUTE`
acotado a las CUATRO que se invocan desde policies — `is_active_user()`,
`can_rate()`, `listing_id_from_object_name()` y, desde `20260930000477`,
`is_admin()` (la usará la policy de Storage del admin en la Ola 2 de RF-17, y
lleva el workaround del SIGSEGV desde que existe; desde `20260930000479` la
invoca la policy `listing_photos_objects_select_admin`) — mientras las **20** que solo
disparan por trigger siguen revocadas (decía "las otras cinco", un número de la
Fase 2 que nadie actualizó, y después 12, 16, 18 y 19; medido con `pg_trigger` ⋈ `pg_proc`
en local el 2026-10-01: **24** funciones de `private` cuelgan de un trigger, 20
sin EXECUTE para `authenticated` y 4 con él. Las
cuatro que no están revocadas son INVOKER y solo reescriben NEW:
`set_updated_at()`, `limpia_veredicto_en_pantalla()`, `anonimiza_rating()` y
`anonimiza_report()`, que conservan su `EXECUTE` porque Postgres lo verifica al
crear el trigger, no al dispararlo. **`sella_resolved_at()` (`…479`) es la
excepción**: también INVOKER y solo reescribe NEW, pero va revocada por
decisión del usuario, así que cuenta entre las 20. T12 vigila las dos listas, y
desde la Ola 2 también una invariante GENÉRICA por `pg_depend`: toda función de
`private` que una policy referencie tiene EXECUTE para `authenticated`.
**`pg_depend` solo ve dependencias DIRECTAS policy → función**: lo que una
función llama por dentro (`is_admin()` → `totp_timestamp()`, revocada) no
aparece, y no hace falta, porque corre como el dueño de la definer). Ver sección 9 sobre por qué ese `USAGE` existe (no
es lo que originalmente se pensó).

**Una función `SECURITY DEFINER` de `public` llamando a una de `private` no
necesita ningún grant extra** — patrón estrenado por `seller_whatsapp`, que
invoca a `private.is_active_user()`. No es el caso de §9 (una *policy* llamando
a una función, donde Postgres sí exige el privilegio al rol que dispara la
policy): el cuerpo corre como el dueño de la función, así que el chequeo se hace
contra él y los privilegios de `authenticated` sobre `private` son irrelevantes
para ese camino. **Verificado corriendo la suite**, no deducido: la aserción de
T16 en la que `:B` (suspendido) recibe `null` pasa en verde, y con un grant
faltante habría reventado con `42501`.

**Un upsert NO puede reasignar el dueño de una fila, y por eso `push_tokens`
tiene un trigger.** Cuando alguien cierra sesión y otra cuenta entra en el MISMO
teléfono, Expo entrega el mismo token y esa fila tiene que cambiar de dueño —
de ahí la PK sobre `token`. Lo obvio sería
`on conflict (token) do update set user_id = excluded.user_id`, y **falla**:
en un `ON CONFLICT DO UPDATE` Postgres evalúa el `USING` de la policy de UPDATE
contra la fila **existente**, que es del dueño anterior. Medido contra el stack
local con estas policias exactas:

| Intento | Resultado real |
|---|---|
| `do update` | `ERROR: new row violates row-level security policy (USING expression)` |
| `do nothing` a secas | `INSERT 0 0` — **silencioso**: el token sigue siendo del otro y el usuario nuevo nunca recibe un push |
| `before insert` que libera el token + `do nothing` | una sola fila, del dueño nuevo |

Por eso el cliente hace un **INSERT plano con `ignoreDuplicates`** (igual que
`favorites`, `explorar.md`) y `private.claim_push_token()` borra la fila perdedora. Va
como trigger y NO como RPC `SECURITY DEFINER` de `public` deliberadamente: sería
la cuarta de esas, y sobre todo **movería el punto de enforcement** — con el
trigger, la policy `with check (user_id = auth.uid())` sigue siendo quien decide
de quién puede ser la fila, y el código elevado solo puede BORRAR, nunca
fabricar una fila a nombre de otro. Alcance honesto: quien conozca el token de
alguien más puede reasignárselo y dejarlo sin push; la precondición no es
alcanzable desde el API (el token solo lo lee su dueño y no aparece en ninguna
otra respuesta).

**`notifications.titulo`/`cuerpo` se materializan en el trigger, y no es
duplicación evitable.** El mensaje del diseño dice "ahora cuesta $2,900, **antes
$3,200**" — y el precio anterior **no existe en ningún lado después del UPDATE**
que dispara el trigger. Mismo criterio de snapshot que `reports.listing_titulo`.
Efecto secundario bueno: la Edge Function recibe el texto resuelto y no tiene ni
una línea de lógica de negocio.

Eso obliga a formatear el precio en SQL, duplicando a `formatPrecio`
(`src/lib/format.ts`). **La versión ingenua no cuadra:** `to_char(p,
'FM999,999,999')` REDONDEA — medido, `99.50 → "100"` y `0.50 → "1"`. Por eso
`private.formato_precio()` lleva un `case` sobre `p = trunc(p)`, y por eso T18
verifica el cuerpo de una baja a `99.50` carácter por carácter: es el único
amarre entre las dos implementaciones.

**Por qué el disparador del reporte es `estado` y no un campo de respuesta.**
RF-16 dice "hay respuesta a un reporte" y `reports` no tiene ningún campo de
texto para eso. No hace falta: el copy del diseño
(`design/relevo-app.html`, fila "Respuesta a tu reporte") es genérico y se
deriva entero de `estado`. Y un campo de texto libre **no tendría quién lo
escribiera** — hoy la moderación vive en Studio, que es un editor de celdas, y
el panel de RF-17 (§8, pendiente 0k) tampoco lo cambia. Si algún día el copy
debe ser por caso, el orden correcto es un frame primero (§0 regla 4).

**Resolver el reporte de una cuenta ya eliminada no avisa a nadie, y ya no
aborta** (`20260930000476`). Desde `20260929000474`, `reports.reporter_id` puede
ser NULL, pero `notify_report_resolved()` lo insertaba en `notifications.user_id`
(NOT NULL): el UPDATE moría con 23502 (medido en local antes de corregir). El
trigger `reports_notify_resolved` lleva ahora `and new.reporter_id is not null`
en su `WHEN`; la función no cambió. Lo vigilan T36 (a) y (a2).

**El webhook es UNO, sobre `notifications`, no uno por tabla de origen.** Como
el inbox del diseño exige que la fila exista de todos modos, esa tabla es
también el outbox: `private.notify_push()` dispara `net.http_post` a la Edge
Function `send-push` con **solo el id** en el body. Tres consecuencias: un punto
de integración en vez de dos, la función no sabe nada del esquema de negocio, y
**si el push falla el aviso sigue en el inbox** — el mismo fallo suave de
`listing_contacts` (`explorar.md`) pero esta vez con recuperación. Ver §9 sobre el header
`apikey` y el esquema real de `pg_net`, que son dos trampas distintas.

**Y "webhook" aquí es un apodo, no el mecanismo de Supabase que lleva ese
nombre.** Un *Database Webhook* del Dashboard es un trigger que llama a
`supabase_functions.http_request()`, y este proyecto **no tiene ninguno**:
`20260911000452_notifications_webhook.sql` declara un trigger propio que invoca
`net.http_post` directo. La distinción no es de vocabulario, y conviene tenerla
antes de agregar el siguiente disparador HTTP:

- **El payload lo eliges tú.** `http_request()` manda siempre
  `{type, table, schema, record, old_record}` con la fila entera;
  `private.notify_push()` manda **solo el id**, que es justo lo que le permite a
  `send-push` no saber nada del esquema.
- **La condición se puede escribir.** El UI del Dashboard crea el trigger para la
  tabla completa, sin cláusula `WHEN`; a mano sí hay `WHEN`, que es lo que haría
  viable filtrar por `bucket_id` un disparador sobre `storage.objects`.
- **La autorización es la de §9**, no la del Dashboard: header `apikey` con la
  secret key (no `Bearer`) y `verify_jwt = false` en `config.toml`.

**Avisos nuevos del inbox (RF-16, tanda 2, `20260928000472` +
`20260928000473`): cuatro disparadores y cinco `tipo`s.** Mismo patrón que los
tres anteriores: funciones en `private`, SECURITY DEFINER, EXECUTE revocado,
triggers AFTER y el texto materializado, palabra por palabra el del frame
"Notificaciones". El enum va en su propio archivo por el motivo de
`20260917000458`: aquí los `WHEN` y las aserciones SÍ nombran los valores
nuevos. (`compra_calificable` pudo ir junto a su función solo porque nada lo
usaba al crearse.)

| `tipo` | Nace cuando | Le llega a | Tap |
|---|---|---|---|
| `publicacion_aprobada` | `pendiente → activa` que el usuario NO vio en pantalla | el dueño | Detalle |
| `publicacion_bloqueada` | `pendiente → bloqueada` no vista ("no fue aprobada"), o cualquier otro estado → `bloqueada` ("Retiramos tu publicación") | el dueño | Detalle |
| `calificacion_recibida` | se CREA una reseña (AFTER INSERT; editarla no avisa) | el calificado | su Perfil público |
| `favorito_vendido` | una publicación pasa a `vendida` | quien la tenía en favoritos, menos el dueño y el comprador registrado | Detalle |
| `avatar_eliminado` | `moderarAvatar()` borra el avatar Y nulifica `foto_url` | el dueño del avatar | Editar perfil |

- **"No visto en pantalla" es la columna `listings.veredicto_en_pantalla`.** El
  veredicto del ALTA lo ve el usuario en "Publicación creada"/"no aprobada".
  Medido en remoto: de 23 evaluaciones, 12 sacan la publicación de `pendiente`
  en el acto, así que notificar siempre duplicaría el aviso en la mitad de las
  altas. La Edge Function pone la columna en true en el MISMO update con el que
  su camino CLIENTE sale de `pendiente`. Un trigger BEFORE
  (`listings_limpia_veredicto_en_pantalla`, INVOKER) la baja a false siempre
  que la fila esté en `pendiente`. **Esa limpieza es la que garantiza la
  invariante, no la función.** Medido: con la función escribiendo `true`
  siempre, la escalada del trigger sigue dejando false. Se descartó un filtro
  por historial de `listing_moderacion`: fallaba en silencio si la auditoría no
  se escribía, o si Studio mandaba a `pendiente` a mano.
- **Consecuencia que sí cambió:** un alta abandonada (nunca llamó a la función)
  que Studio aprueba **SÍ avisa**. El usuario nunca vio ese veredicto.
- **Tres ediciones de fotos dan como máximo un aviso.** El trigger de Storage
  solo escala, ignora `pendiente`, `bloqueada` es terminal y el `WHEN` exige un
  cambio real de estado. `activa → pendiente` no avisa: avisa su resolución.
- **`favorito_vendido` excluye al comprador leyendo `listing_sales`**, que ya
  existe cuando el trigger corre, porque `registrarVenta()` inserta la venta
  ANTES del estado (orden obligatorio). Corregir al comprador no vuelve a
  avisar: solo toca `listing_sales`. Efecto aceptado: si el comprador nuevo
  tenía el favorito, ya recibió "se vendió" y ahora recibe "Califica tu
  compra".
- **El aviso de calificación nunca lleva el comentario**, solo nombre y
  estrellas (las reseñas ya son públicas). Singular con 1 estrella.
- **`avatar_moderacion` existe porque `foto_url = null` no distingue** "lo quitó
  la moderación" de "lo quitó el usuario". El cliente nunca escribe null, pero
  el `grant update (foto_url)` se lo permite por API. La escribe
  `moderarAvatar()` en cada borrado. El `WHEN (new.foto_url_nulificado)` omite
  el caso en que el guard de la carrera dejó intacto el avatar vigente.
  Mantiene "las notificaciones solo nacen de triggers". El toast de Perfil se
  conserva: aviso inmediato más aviso persistente.
- **El push no rutea por tipo**: `destino()` (`src/lib/push.ts`) solo recibe
  `listing_id`, así que los tipos sin publicación abren el inbox. El inbox sí
  rutea por tipo (`rutaDeNotificacion()`, `src/lib/notificaciones.ts`). Mandar
  el tipo exige redesplegar `send-push`.
- **Un build viejo pinta un `tipo` desconocido con un estilo neutro**
  (`ESTILO_DESCONOCIDO` en `NotifRow`), en vez de reventar el inbox. El enum
  vive en la base, y un build viejo contra el remoto nuevo lee filas de tipos
  que no conoce.

**`listing_moderacion` es la PRIMERA tabla del proyecto con RLS habilitado y
cero policies, y las dos mitades son deliberadas** (`20260918000461`, RF-18).
Guarda por qué la Edge Function dictó cada veredicto — sin ella, el revisor abre
Studio, ve una publicación en `pendiente` y no tiene forma de saber la razón, y
el valor que `coincidencias()` devuelve (CUÁLES palabras machearon) no tendría a
dónde ir. Cuatro cosas que no se ven en el diff:

- **No es columna de `listings` por el mismo argumento exacto que
  `listing_sales`**, y aquí muerde más fuerte: `listings` tiene `grant select` a
  nivel TABLA (`20260906000439:86`), así que una columna nueva la leería
  cualquier autenticado que pueda ver la fila — o sea que el motivo por el que
  se bloqueó a alguien sería público. Acotarlo exigiría convertir ese grant a
  lista de columnas, que es justo lo que hoy hace funcionar a `listings.busqueda`
  sin grant propio y lo que T13 vigila.
- **El `revoke all` NO es el preámbulo de ningún grant — ES el control de acceso
  entero.** Es el único caso del repo donde ese revoke queda solo, y por eso vale
  releer §9: los grants son aditivos sobre el `pg_default_acl`, así que sin esa
  línea la tabla nacería legible para `anon` y `authenticated`. Medido:
  `information_schema.table_privileges` y `column_privileges` dan 0 filas para
  los dos roles.
- **El RLS se habilita igual sin una sola policy, y no es ceremonia.** T12 tiene
  una aserción literal de que TODAS las tablas de `public` lo tienen, así que sin
  esa línea la suite se pone roja; y es defensa real, porque si algún día alguien
  agrega un `grant select` sin pensarlo, RLS sin policies sigue negando todo en
  vez de abrir la tabla entera.
- **Una fila por EVALUACIÓN, no por publicación.** Deja leer "se marcó, se
  limpió, se volvió a marcar" —lo que un revisor necesita ante una reincidente—
  y evita un upsert. `estado_resultante` no es derivable de `veredicto`:
  `bloquear` siempre da `bloqueada`, pero `revisar` sobre una `pausada` la deja
  en `pausada` y sobre una `activa` la manda a `pendiente`. **Los avatares NO
  escriben aquí** — no tienen `listing_id` y su enforcement es inmediato (borrar
  o nada), sin cola que revisar; su rastro es el `console.error`.

**El registro solo admite correos de dominios dados de alta en
`universidad_dominios`, y el candado es el Auth Hook "Before User Created"**
(`20260923000465`, implementado como función de Postgres:
`public.hook_before_user_created(jsonb)`). GoTrue lo invoca ANTES de insertar
en `auth.users`, así que un rechazo no deja fila ni manda el correo del OTP. Las
altas de dominios se hacen desde Studio/`service_role`, igual que los demás
catálogos. Todo lo que sigue está **medido** contra GoTrue v2.196.0 local con
`scripts/probe-registro.mjs`, no leído de la doc: la doc del hook no enumera qué
flujos lo disparan ni qué pasa si falla.

**EN PRODUCCIÓN desde el 2026-09-23** (ver §8, "Hecho"). Dominios dados de alta
en remoto, medidos el 2026-10-05: `exatec.tec.mx`, `tec.mx`, `tecmilenio.mx`,
`u-erre.mx`, `uanl.edu.mx` y `udem.edu` (los dos de Tec de Monterrey fueron los
de la puesta en producción; los otros cuatro se agregaron después). Ninguno es
personal: `gmail.com` y compañía NO están, y por eso un correo así no se puede
registrar por OTP. `exatec.tec.mx` es un ejemplo real de por qué el match es
exacto: un subdominio no hereda del dominio padre, así que necesita su propia
fila.

- **Desde `20260929000474` tiene un SEGUNDO rechazo, que se evalúa primero:**
  `403 correo_bloqueado` si el hash del correo normalizado está en
  `public.correos_bloqueados` (una cuenta que se eliminó estando suspendida;
  bloque "Eliminar cuenta", arriba). Se cambió con `create or replace`, así que
  conserva OID y grants. El cliente lo reconoce con `esCorreoBloqueado()`
  (`src/lib/registro.ts`) y pinta la variante "correo bloqueado" del frame, con
  copy neutro.
- **La regla:** el dominio es lo que sigue al ÚLTIMO `@`, en minúsculas y sin
  espacios, con coincidencia EXACTA. `estudiante.tec.mx` no hereda de `tec.mx`,
  y `eviltec.mx` o `tec.mx.evil.com` tampoco machean. Solo un match explícito
  permite; todo lo demás rechaza, incluido un email NULL. El rechazo es
  `{"error":{"http_code":403,"message":"dominio_no_participante"}}`, y GoTrue lo
  entrega como `403` con `msg` = ese código. El copy lo pone el cliente.
- **Falla CERRADO, medido:** una función que lanza da `500` y cero filas; una que
  tarda de más da `504 request_timeout` a los **10 s** en local (la doc dice 2 s;
  el corte remoto está sin medir, ver el pendiente 0b de §8) y tampoco crea fila.
  **Con la tabla vacía rechaza TODO**, y por eso en producción los dominios se
  dieron de alta ANTES de activar el hook (§8, "Hecho").
- **Solo afecta el ALTA.** Login con contraseña, `resetPasswordForEmail`,
  `verifyOtp({type:'recovery'})` y un `signInWithOtp` sobre una cuenta que ya
  existe no pasan por él: las cuentas previas de cualquier dominio (en remoto hay
  gmail/hotmail/outlook) siguen entrando. Tampoco pasa por él el **admin API**
  (`POST /admin/users` con la secret key crea una cuenta gmail sin problema): el
  corte es por LLAVE, el mismo patrón que `minimum_password_length` (§9).
- **La policy para `supabase_auth_admin` es portante, y quitarla falla en
  silencio.** Ese rol NO tiene `bypassrls` (medido), así que sin su policy la
  tabla se le ve vacía y el hook rechaza a todo el mundo con el MISMO 403 que a
  un gmail: indistinguible de "tu dominio no está dado de alta". T27 no lo puede
  ver (corre como `postgres`, que salta la RLS); lo caza el probe.
- **Va en `public`, no en `private`**, al revés que el resto de funciones
  internas: `supabase_auth_admin` tiene `USAGE` sobre `public` y no sobre
  `private` (medido), y el Dashboard la busca ahí. No queda expuesta por
  PostgREST porque solo `supabase_auth_admin` tiene `EXECUTE`: se revocó a
  `public`, `anon` y `authenticated`. `service_role` conserva el `EXECUTE` que le da
  `pg_default_acl`, sin consecuencia. Es `sql`, no `plpgsql`, y **no** es
  `SECURITY DEFINER`: corre como `supabase_auth_admin` con su grant y su policy.
- **El cliente no valida nada.** `src/lib/registro.ts` solo reconoce el 403 con
  ese código y lo traduce al `.notice` del frame "Verificación (correo no
  participante)". No hay lista de dominios del lado del cliente (§0 regla 7).
  El probe importa ese módulo y lo compara contra lo que devuelve GoTrue: ese es
  el amarre entre el string de SQL y el de TypeScript.

**La universidad de un usuario la asigna el SERVIDOR desde el dominio de su
correo, y la base ata a ella su campus y sus publicaciones** (`20260924000466`,
fase 2A). Antes la elegía el cliente en "Selector de universidad" y la base no
ataba nada: `users.campus_id`/`universidad_id` y `listings.universidad_id`/
`campus_id` eran FKs sueltas. Lo que viene detrás es mostrar la universidad de
cada publicación en las tarjetas, y esa etiqueta solo da confianza si nadie la
puede falsificar, así que el candado entero vive aquí. Son cuatro piezas:

- **El trigger de alta** (`private.handle_new_user()`, `create or replace`, así
  que conserva OID, trigger y revoke) inserta también `universidad_id`, que saca
  de `universidad_dominios` con la MISMA normalización que el Auth Hook: lo que
  sigue al último `@`, en minúsculas, sin espacios y con match exacto.
  `split_part(…, -1)` exige Postgres 16+; remoto corre 17.6 (medido).
  **Las dos copias de esa normalización no pueden compartir helper**: el hook
  corre como `supabase_auth_admin`, que no tiene `USAGE` sobre `private`. El
  amarre es T28 (a3). **Nunca lanza**: sin match da NULL. Pasa con una cuenta
  creada por llave secreta (Studio, admin API), que no pasa por el hook. Que
  el alta reventara sería peor, porque esa cuenta ni existiría para corregirla
  en Studio.
- **Grants, con `revoke all` y re-grant de las listas MEDIDAS** (no de
  memoria). `authenticated` pierde UPDATE sobre `users.universidad_id`,
  `listings.universidad_id` y `listings.campus_id`, y nada más. Lo prueba un
  diff antes/después con `scripts/grants-users-listings.sql` (mira
  `table_privileges` **y** `column_privileges`): da exactamente esas 3 filas
  menos y ninguna más, en local. **Una publicación conserva la universidad y el
  campus con los que nació.** Antes eso lo decía `explorar.md` y el código lo
  contradecía: Editar publicación mandaba el campus ACTUAL del perfil y movía la
  publicación en silencio (corregido en el cliente en su propio commit; este
  grant es el candado).
- **FK compuesta campus ↔ universidad**, en `users` y en `listings`, contra
  `campus(universidad_id, id)` (que ganó ese `unique`). **REEMPLAZA a las FKs
  sueltas, no se suma**: con dos FKs hacia `campus`, los embeds
  `campus:campus(...)` sin hint morirían con PGRST201. Medido por HTTP como
  authenticated después de aplicarla: feed, favoritos, perfil editable, perfil
  público, contactos y universidades+campus dan 200. En `users` va con
  **`check (campus_id is null or universidad_id is not null)`**
  (`users_campus_requiere_universidad`), que es portante: la FK es MATCH
  SIMPLE y NO se evalúa si una de las dos columnas es NULL. MATCH FULL tampoco
  sirve, porque rechazaría el estado normal de "universidad asignada, campus
  todavía no".
- **FK compuesta publicación ↔ dueño**: `listings(user_id, universidad_id)` →
  `users(id, universidad_id)`, `on update cascade on delete cascade` (con
  `unique (id, universidad_id)` en `users`). Se eligió sobre las dos
  alternativas por razones concretas:
  - Un trigger que FIJARA la universidad desde el perfil reescribiría en
    silencio: el cliente manda X y se guarda Y, sin error.
  - Un `with check` solo alcanza a `authenticated`, y Studio podría dejar una
    publicación incoherente.
  - La FK aplica a todos los roles y rechaza con 23503. Un dueño sin
    universidad no puede publicar, porque `(id, NULL)` nunca machea.
  - `listings_user_id_fkey` SE QUEDA: es el hint `users!listings_user_id_fkey`.
    Con esta segunda FK hacia `users`, un embed `users(...)` desde `listings`
    sin hint sería ambiguo (hoy no hay ninguno).

Tres consecuencias que no se ven en el diff:

- **Mover a un usuario con publicaciones a otra universidad ABORTA, también
  desde Studio** (T28 (d6)). El cascade lleva la universidad nueva a sus
  publicaciones, que conservan el campus viejo, y la FK campus ↔ universidad
  las rechaza. Falla cerrado. Si alguna vez hace falta, primero se resuelven
  sus publicaciones.
- **Cuentas sin dominio registrado**: en remoto hay 5 (gmail/hotmail/outlook,
  anteriores al candado). Conservan la universidad que ya tenían (la 1) y su
  campus. No la pueden cambiar; sí el campus dentro de ella. Una cuenta NUEVA
  sin dominio (solo por llave secreta) nace con universidad NULL: no puede
  fijar campus ni publicar, y la app le pinta la variante "sin universidad
  asignada" de Completar perfil, con salida "Usar otro correo".
- **Depende de la fase 1 con dominios reales.** Con `universidad_dominios`
  vacía, todo alta nacería sin universidad. Por eso el runbook (§8, pendiente
  0) tiene un paso 0 bloqueante.

**Eliminar cuenta (Apple 5.1.1(v), Google Play) — `20260929000474` + la Edge
Function `eliminar-cuenta`.** Borrar la cuenta es `auth.admin.deleteUser`, y lo
demás son cascadas desde `auth.users`. La migración ajusta lo que esas cascadas
hacían MAL según seis decisiones de producto, tomadas antes de construir. Todo lo
de anonimizar vive en la BASE (una FK `set null` + un trigger que limpia lo que
el `set null` no alcanza), no en el cliente ni en la función: aplica igual si la
cuenta se borra desde Studio.

| FK (medida en `pg_constraint`, local = remoto) | Antes | Ahora | Decisión |
|---|---|---|---|
| `ratings.from_user_id → users` | cascade | **set null** + trigger borra `comentario` | 1. Las reseñas que ESCRIBIÓ se conservan: estrellas sí, autor y comentario no |
| `ratings.to_user_id → users` | cascade | cascade | 2. Las que RECIBIÓ se borran con él |
| `ratings.listing_id → listings` | cascade | **set null** | 1, otra vez: las que escribió COMO VENDEDOR cuelgan de SUS publicaciones |
| `listing_sales.comprador_id → users` | cascade | cascade | 3. Su compra se borra; la publicación sigue `vendida` (= "No fue a través de Relevo") |
| `listings.user_id` (y la compuesta) | cascade | cascade | 4. Sus publicaciones se borran; sus objetos de Storage los borra la función |
| `reports.reporter_id → users` | cascade | **set null** | 5. Los reportes que HIZO se conservan para moderación, sin su identidad |
| `reports.reported_user_id → users` | set null | set null + trigger borra `reported_user_correo` | 5. Los reportes EN SU CONTRA también, sin el snapshot de su correo |

Lo que no se ve en la tabla:

- **`ratings.listing_id` en `set null` es GLOBAL, y cambia el borrado NORMAL de
  una publicación (decidido, no colateral).** Antes, borrar una publicación
  vendida borraba las reseñas de las dos partes y movía los dos promedios, o sea
  que un vendedor podía borrar una mala reseña borrando la publicación. Ahora
  sobreviven. **Costo aceptado:** la reseña de una publicación borrada ya no la
  puede editar su autor, porque `ratings_update_own` exige `can_rate(to_user_id,
  listing_id)` y con `listing_id` NULL da false.
- **Nada de esto rompe lo que mira `ratings` (medido en local, `begin …
  rollback`, antes de escribir la migración):** el unique `(from_user_id,
  to_user_id, listing_id)` es NULLS DISTINCT, así que las filas anónimas no
  chocan; las dos acciones RI sobre la MISMA fila (autor y publicación anulados
  en un solo borrado) no dan "tuple already modified"; el recálculo de
  `rating_promedio` sobre la fila de un usuario que se está borrando no truena;
  `notify_calificacion` es AFTER INSERT y no dispara; ningún embed de `ratings`
  del cliente lleva `!inner`. `fetchReviews` marca `autorEliminado` cuando el
  embed `from_user` viene NULL (no cuando `nombre` es null, que también pasa en
  una cuenta viva sin perfil completo).
- **`rating_promedio` no se mueve para quien él calificó**: es una columna que
  mantiene un trigger con `avg(estrellas)` por `to_user_id`, y la fila anónima
  conserva los dos. No existe `rating_count`: el conteo es el `count:'exact'` de
  `fetchReviews`, que tampoco cambia.
- **Los avisos de OTROS con su identidad se BORRAN** (trigger BEFORE DELETE en
  `users`, `private.borra_avisos_de_cuenta()`). De los 7 productores de
  `notifications` —medidos en migraciones y en `pg_proc.prosrc`, iguales en
  local y remoto—, `compra_calificable` y `calificacion_recibida` materializan
  el NOMBRE de otro usuario, y `precio_favorito`/`favorito_vendido` el TÍTULO de
  sus publicaciones. Alcance: todo aviso ajeno con `listing_id` en sus
  publicaciones, más los `calificacion_recibida` que ÉL generó en publicaciones
  ajenas. **Efecto aceptado:** ese segundo caso empareja por (destinatario,
  publicación, tipo), así que si otra persona calificó al mismo vendedor por la
  misma publicación, su aviso también se va. Su reseña no.
- **Evasión de suspensión cerrada: `public.correos_bloqueados`.** Si la cuenta
  está `suspendida` al borrarse, `private.bloquea_correo_suspendido()` guarda el
  `sha256` del correo normalizado igual que el Auth Hook (`lower(btrim(...))`),
  y el hook lo rechaza con `403 correo_bloqueado` ANTES de mirar el dominio.
  `sha256(bytea)` es core (PG 17.6 en local y remoto, medido); `supabase_auth_admin`
  la puede ejecutar. **Alcance honesto:** un hash sin sal de un correo es un
  seudónimo, no un dato anónimo (probar correos candidatos lo revierte), por eso
  no es legible por el cliente y va al aviso de privacidad; un alias o un correo
  distinto lo evaden; se guarda indefinidamente; desbloquear es borrar la fila
  en Studio. **La policy de `supabase_auth_admin` es portante, y quitarla falla
  ABIERTO en silencio** (medido, `probe-registro.mjs` caso 9): ese rol no tiene
  bypassrls, la tabla se le ve vacía y la cuenta vetada se registra sin error.
- **Lo que se borra y es correcto con las FKs de antes:** `favorites`,
  `listing_contacts`, `push_tokens`, sus `notifications`, `avatar_moderacion`, y
  `listing_moderacion(_reclamos)` de sus publicaciones (se pierde su historial de
  moderación: consecuencia de la decisión 4). Sus `listing_sales` como vendedor
  se van con sus publicaciones. `reports.listing_titulo` de los reportes contra
  sus publicaciones se conserva: es contenido, no identidad.
- **El orden de la Edge Function es load-bearing:** Storage PRIMERO y
  `deleteUser` después, porque las carpetas `listing-photos/{id}/` se enumeran
  desde `listings`, que el borrado se lleva. Detalle de la función (auth,
  reautenticación por `amr`, idempotencia) en §8 y en §9.

**Panel de admin, Olas 1 a 3 de RF-17 (`20260930000477` + `20260930000478`
+ `20260930000479`, EN PRODUCCIÓN desde el 2026-10-02).** Plan en `docs/rf17-plan-admin.md`; las reglas
del código del panel, en `admin/CLAUDE.md`. Lo que vive en la base:

- **Quién es admin: `private.admins`**, una fila con `activado_at` puesto. No
  `app_metadata`: viaja en el JWT y revocar no surtiría efecto hasta el `exp`.
  **Revocar es poner `activado_at = null`**: `crear-admin.mjs desactivar` lo hace
  y lo audita como `desactivar_admin` en la misma sentencia, con efecto en la
  request siguiente. Borrar la fila también revoca, pero pierde nombre y fechas y
  no deja rastro. Suspender a un admin en `users` NO lo revoca: `is_admin()` no
  mira `users.estado`.
- **`private.is_admin()`** (sql, definer, EXECUTE para `authenticated` por el
  SIGSEGV) exige, a la vez: la fila activada, `aal = aal2` y un TOTP de las
  últimas 12 h en `amr`. El parseo de `amr` vive UNA vez, en
  `private.totp_timestamp()`, con la forma de D18 (`jsonb_typeof`, no
  `coalesce`) y el cast dentro de un `CASE` (Postgres no garantiza el orden de
  un `AND` en un `WHERE`). Medido contra GoTrue: un refresh CONSERVA el
  timestamp del TOTP y re-verificarlo lo RENUEVA.
- **`private.exigir_admin()`**, primera línea de toda RPC de `admin.*` que
  actúa: 42501 con `no_admin`, `mfa_requerido` o `totp_vencido`. Solo esos tres
  mensajes cambian la sesión del panel (`admin/src/lib/rechazos.ts`).
- **`private.admin_acciones`**: auditoría append-only (triggers de fila y de
  TRUNCATE), sin FK en `admin_id` (sobrevive al borrado del admin), con CHECK
  de claves permitidas POR TIPO de objetivo (`private.claves_auditoria_ok`,
  D20) y de motivo (3-500 tras btrim). Se escribe solo por
  `private.auditar()`, que saca el actor de `auth.uid()` (`admin_correo` guarda
  su correo tal cual: a 2026-10-05 dos de los tres admins usan correo personal,
  que queda ahí para siempre; los cofundadores lo aceptaron) o, para las filas que escribe el
  script (`activar_admin` y `desactivar_admin`), el actor centinela
  `00000000-0000-0000-0000-000000000000` con `admin_correo =
  'script:crear-admin.mjs'`.
- **Schema `admin`** (D3): USAGE solo para `authenticated`; sus funciones son
  definer con `search_path` fijo y sin EXECUTE para `anon`/PUBLIC. No cuentan
  entre "las TRES definer de `public`": viven en otro schema. Hoy son 9
  (medido en `pg_proc` el 2026-10-01 y, en remoto, el 2026-10-05 con un md5 de
  la lista de funciones, ACL y privilegios idéntico al de local): `sesion` (la única que no lanza: gating
  de UX), `buscar_usuarios`, `detalle_usuario`, `suspender_usuario` y
  `reactivar_usuario` (Ola 1), y `listar_reportes`, `resolver_reporte`,
  `detalle_listing` y `bloquear_listing` (Ola 2).
- **Reportes y bloqueo (`20260930000479`, Ola 2).** `listar_reportes` usa solo
  left joins y nunca esconde un reporte: los 4 `objetivo_tipo`
  (`publicacion`, `usuario`, `publicacion_eliminada`, `cuenta_eliminada`).
  `p_estado` es TEXT, null-safe, y NULL = todos; un valor ajeno da
  `22023 estado_invalido` (con el enum habría dado 22P02 antes de entrar).
  `resolver_reporte` hace CAS desde `pendiente` y NO escribe `resolved_at`: lo
  sella el trigger BEFORE `reports_sella_resolved_at`, también para un reporte
  sin reportante y desde Studio (no copia la cláusula `reporter_id is not null`
  del aviso). `bloquear_listing` va desde `pendiente`, `activa`, `pausada` o
  `vendida`, nunca desde `bloqueada`, audita solo `estado` y no toca
  `listing_sales`; el dueño recibe UN aviso desde los 4 orígenes
  (`listings_notify_moderacion`). Las dos llevan las guardas "no sobre sí
  mismo / otro admin" (D-B2), hoy inalcanzables desde el producto pero
  construibles en la base. En `resolver_reporte`, "sí mismo" son TRES
  personas: quien reportó, el reportado y el dueño de la publicación reportada
  (un reporte de publicación tiene `reported_user_id` NULL). `admin_acciones_accion_check` admite 6
  acciones: las 3 de la Ola 1 (`suspender_usuario`, `reactivar_usuario`,
  `activar_admin`), `resolver_reporte` y `bloquear_listing` (Ola 2) y
  `desactivar_admin`, sumada a la 479 antes de su push (T35 (j3)).
- **Propiedad conocida: Studio SÍ puede sacar una publicación de `bloqueada`,
  y es a propósito.** `bloqueada` es terminal para la app, el panel y la
  moderación (medido el 2026-10-01: `decidirListing` devuelve `bloqueada` con
  los tres veredictos, `decision.ts:346-356`; el dueño recibe `UPDATE 0` por
  `listings_update_own`; `bloquear_listing` da `estado_inesperado`;
  `pause_listings_on_suspend` e `increment_listing_view` no la tocan), pero un
  UPDATE con privilegios elevados la mueve sin ninguna guarda. No se agrega
  trigger (decisión del usuario): es la vía de recuperación de un bloqueo
  equivocado, porque el panel no desbloquea (D10). Dos efectos, medidos en
  `begin … rollback`: **no deja rastro en `admin_acciones`** (ahí solo escribe
  `private.auditar()`, desde las RPCs de `admin.*`) y **el dueño no recibe
  aviso** (`listings_notify_moderacion` solo avisa al pasar A `bloqueada`, o al
  salir de `pendiente`). Y un límite: a `activa` solo pasa si tiene al menos una
  foto (`listings_enforce_activation_has_photos`); a `pausada`, sin condición.
- **Las fotos para el admin: policy `listing_photos_objects_select_admin`**
  (`bucket_id = 'listing-photos' and (select private.is_admin())`). El panel
  las baja con `storage.download()` (`/object/{bucket}/…`) y las pinta como
  object URL. **Medido por HTTP** (`probe-storage.mjs`): un admin aal1, un
  admin con el TOTP vencido y un no-admin reciben el MISMO rechazo, así que el
  panel le pregunta a `admin.sesion()` (§9).
- **Deuda aceptada: bloquear una `vendida` deja a su COMPRADOR sin camino en la
  UI para calificar.** La base todavía acepta la reseña (`can_rate()` es
  definer y no mira `estado`), pero el embed de `fetchComprasPendientesDeCalificar`
  (`src/lib/confianza.ts:267-291`) pasa por `listings_select` y la salta, y el
  aviso `compra_calificable` abre un Detalle que el comprador ya no ve
  (`src/lib/notificaciones.ts:62`). Medido en remoto el 2026-10-01: ninguna de
  las 2 `bloqueada` venía de `vendida`. **Revisar cuando:** el primer bloqueo
  de una vendida con calificación pendiente. **Fix:** una RPC de solo lectura
  que le dé al comprador el vendedor de sus compras sin pasar por
  `listings_select`.
- **Guardas de suspender/reactivar, en orden, cada una con su mensaje**: G1
  `exigir_admin`; G2 motivo 3-500 (`22023 motivo_invalido`); G3 no sobre sí
  mismo; G4 el objetivo no es admin (SOLO al suspender: otro admin puede
  reactivar a uno que Studio suspendió); G5 existe (`P0002`); G6 CAS sobre
  `estado` (`55000 estado_inesperado`). Suspender devuelve y audita SOLO las
  publicaciones que esa acción pasó de `activa` a `pausada`. **Reactivar NO
  despausa** (decisión de `20260917000457`).
- **Las cuentas de admin se crean con `scripts/crear-admin.mjs`, no con
  `inviteUserByEmail`**: medido, `/invite` pasa por el Auth Hook de dominios y
  `@rlvo.com.mx` sale 403 (ver §9). Nacen por `admin/users`, fijan contraseña
  con el código de recuperación y se activan en un segundo paso que exige un
  TOTP verificado y confirmación por otro canal. Con `--remoto` corre contra
  producción (prompt sin eco para la secret key temporal y la contraseña de la
  base, session pooler porque la conexión directa es solo IPv6, preflight y
  compensación si falla a medias). **El correo es `@rlvo.com.mx` por defecto;
  uno externo (p. ej. personal) exige `--correo-externo` y teclear el correo de
  nuevo, y el preflight rechaza un dominio de `universidad_dominios` o una
  cuenta que ya exista: una cuenta del marketplace NO se convierte en admin**
  (D4, modificada en la Ola 3). `activar` exige un TOTP posterior a la última
  desactivación. A 2026-10-05 hay 3 admins: uno `@rlvo.com.mx` y dos con correo
  personal.
  Nada de esto toca el registro de usuarios normales (`admin/CLAUDE.md`).
- **[CERRADA el 2026-10-07 por `20261007000480`, en producción, con
  `moderar-contenido` v9 desplegada antes]** Los triggers
  `listings_exige_dueno_activo_ins`/`_upd` lanzan `55000 dueno_no_activo` ante
  cualquier paso a `activa` de un dueño no activo, para todos los roles; la
  función lo traduce a `pendiente` (auditoría con
  `descartado_por_dueno_no_activo`). La regla A1b del runbook se retiró. Lo
  vigila T35b. El texto de antes, tal como estaba:
- **Deuda que el panel vuelve más alcanzable**: una `pendiente` de un dueño ya
  suspendido se puede activar (camino de usuario de `moderar-contenido`, o
  Studio). `detalle_usuario` la hace visible y el fix es la Ola 4 (trigger
  `dueno_no_activo`). **Aceptada en la Ola 3** (decisión del usuario, tomada antes del push)
  como riesgo conocido, con una regla de runbook (`docs/admin-runbook.md`) y
  sin ningún guard hasta la Ola 4. Alcance medido: un suspendido NO puede
  insertar publicaciones nuevas (`listings_insert_own` exige `is_active_user()`,
  `20260919000463:71-75`) ni subir fotos, pero una `pendiente` que ya existía
  puede pasar a `activa` por tres vías: Studio; una `pendiente` sin fila de
  reclamo (eran las 4 heredadas, anteriores a `…471`, ya resueltas; hoy también
  lo sería un alta abandonada antes de invocar la función); o un reclamo
  incompleto o liberado, que el camino de usuario retoma pasados 60 s
  (`moderar-contenido/index.ts:289-310`). Para activarse necesita al menos una
  foto (`listings_enforce_activation_has_photos`). La suspensión solo pausa las
  `activa` (`20260917000457:86-89`): una `pendiente` se queda `pendiente`.

**Regresión de RLS:** `supabase/tests/rls.sql`, 455 aserciones (medido con el
`grep` de §8 el 2026-10-05; antes decía 454, 453, 407, 406, 362, 358, 335, 317, 284, 282, 273, 259, y antes "212", que ya era viejo: la
cronología de abajo llegaba a 223), corre dentro de
una transacción con rollback (no deja estado, repetible sin `db reset`).

Cómo llegó a 53, porque el número se movió en dos rondas y conviene saber por
qué: las 42 originales de la Fase 2 subieron a 47 con las de
`listing_favorites_count` (T11b), y **bajaron a 46** al corregir esa misma
sección — una de sus aserciones usaba la cuenta `:C`, que T8 borra a propósito
al probar que un reporte sobrevive al borrado de su objetivo, así que pasaba por
la razón equivocada. Ese mismo hallazgo obligó a que T11b sembrara su propia
publicación en vez de reutilizar `t_ids`, que T8 también borra. De ahí a **53**
con las 7 de la búsqueda por tsvector (T13), sembrada igual de autocontenida, y a
**64** con las 11 del bucket de Storage (T14, también autocontenida: siembra su
propio bucket y usa a `:A`, el único que sigue activo y sin publicaciones a esa
altura del archivo). Y a **67** con las 3 del trigger de activación (T15, que
siembra sus propias dos publicaciones y también usa a `:A`) — la cuarta que iba
a tener, la del EXECUTE revocado, terminó sumada a la invariante de grants de
T12, que es donde vive ese tipo de aserción, así que ahí se pasó de 4 funciones
vigiladas a 5 sin cambiar la cuenta. Y a **80** con el teléfono: 11 de T16 más
**2** en T12, no una: la del EXECUTE de `seller_whatsapp` y la de que `telefono`
nunca tenga `SELECT` — hermana de la de `correo`, con la diferencia de que este
sí tiene `UPDATE`. Y a **81** al hacer que `seller_whatsapp` valide también al
objetivo.

**Ese último cambio no solo sumó: reestructuró T16, y ahí hay una lección.** El
camino feliz era "`:A` (activo) recibe el número de `:B`" — con `:B` suspendido
desde T10, porque era el único otro usuario disponible a esa altura. En cuanto
la RPC miró al objetivo, esa aserción **empezó a fallar**, y otra ("un vendedor
sin número devuelve null", también contra `:B`) habría **pasado por la razón
equivocada**: dos motivos distintos produciendo el mismo `null`. Es el error que
esta misma sección documenta con la cuenta `:C` de T11b, reaparecido. La salida
fue que **T16 siembre su propio `:D`** —vendedor activo con teléfono, la primera
sección del archivo que siembra un usuario— para que cada aserción tenga un solo
motivo posible: el camino feliz contra `:D`, la negativa del objetivo contra
`:B`, y la del llamante pidiendo el número de `:D`.
**Moraleja para secciones nuevas: no reutilices fixtures de secciones
anteriores** — a media suite hay filas y cuentas ya borradas a propósito, y un
estado que hoy es incidental (quién está suspendido) puede volverse
load-bearing.

Y a **108** con las de RF-16: T17 (`push_tokens`) y T18 (`notifications` y sus
dos disparadores), que siembran sus propios `:E` y `:F` siguiendo esa misma
moraleja, más 4 en T12 (`notifications` sin INSERT/DELETE, su UPDATE solo por
columna, `push_tokens` sin UPDATE por ningún lado, y `vault` inaccesible para
`authenticated`/`anon`). La aserción de las funciones-solo-trigger pasó de 5 a
**9** sin cambiar la cuenta, que es donde vive ese tipo de invariante.

Y a **128** con las de RF-07/RF-12: 19 de T19 (`listing_sales`, su corrección y
el apriete de `can_rate()`) más 1 en T12 (sin DELETE, y UPDATE solo sobre
`comprador_id`); la de funciones-solo-trigger pasó de 9 a **10** sin cambiar la
cuenta (y a **11** con la de T23, más abajo). T19 siembra sus propios `:G`/`:H`/`:I` —vendedor, comprador real y un
tercer contacto que preguntó y no compró—, y ese tercero no es adorno: es el que
prueba las dos ramas apretadas de `can_rate()`.
**Y aquí hay una lección nueva, hermana de la de `:C` en T11b: el ORDEN de las
aserciones puede hacer que una pase por la razón equivocada.** La primera versión
de (l2) tenía a `:I` calificando al vendedor mientras `:H` seguía registrada como
compradora — y con el congelamiento evaluándose contra
`listing_sales.comprador_id`, esa reseña no lo disparaba **en ninguna de las dos
variantes**, así que la aserción pasaba igual con la implementación correcta y con
la descartada. Medido con el control negativo, que caía en (j) en vez de en (l2).
El arreglo fue que califique **el comprador REGISTRADO EN ESE MOMENTO**. Moraleja:
en una sección con estado que avanza, verifica también *cuándo* corre cada
aserción, no solo contra quién.
**Dos aserciones de T17 van juntas o ninguna sirve:** "un token que cambia de
cuenta deja UNA sola fila, del dueño nuevo" y "el mismo usuario re-registrando su
token no duplica ni pierde el otro". Sin la segunda, un trigger que borrara
incondicionalmente también pasaría la primera.

Y a **138** con las 10 de T20 (vendida es terminal, RF-08), autocontenida con sus
propios `:J`/`:K`/`:L` y TRES publicaciones. Nada en T12: los grants no cambian, y
una aserción textual sobre `pg_policies.qual` sería frágil al lado de las de 0
filas, que prueban comportamiento.
**La tercera publicación no es relleno, es el control (h):** el mismo dueño
editando una NO vendida en la misma sesión. Sin ella, estas aserciones no
distinguirían "bloqueado por vendida" de "bloqueado por grant o por suspensión".
**Y una foto que parece decorado sí es load-bearing.** La publicación de (d) lleva
una fila en `listing_photos` porque sin ella el control negativo falló con «Una
publicación no puede activarse sin fotos»: quien bloqueaba la reactivación era el
trigger `listings_enforce_activation_has_photos` y no la policy, o sea que la
aserción no probaba lo que dice. Es la misma familia de errores que `:C` en T11b,
detectada esta vez por correr el control en vez de razonarlo.
**Las listas COMPLETAS de los tres controles de T20, medidas — y ninguna coincide
con lo que el plan había predicho.** Enumerarlas exige instrumentar el harness:
`pg_temp.assert` hace `raise exception` y la suite corre con `ON_ERROR_STOP`, así
que **una corrida normal solo muestra la PRIMERA caída**. Para la lista real hay
que (1) volver `assert` no-abortante y (2) envolver en `expect_error` los
statements que lanzan error crudo de Postgres, que no son aserciones y abortan
igual. Con eso:

| Control | Aserciones de T20 que caen |
|---|---|
| Quitar la condición del `using` | (d)(e)(f) por el bloqueo, (g) porque los updates dejaron rastro, e (i) en cascada |
| Moverla al `with check` | (a)(b) —la transición queda prohibida— y, en cascada, (d)(e)(f)(g)(i) |
| La regla como trigger | **solo** (i) |

Tres cosas que conviene no volver a suponer: **(h) sobrevive a los tres**, que es
exactamente su trabajo —si cayera, el bloqueo no sería por estado—; **(i) es
cascada en los dos primeros** (los updates dejan la fila en `pausada` y
`increment_listing_view` excluye ese estado) pero **causa directa en el tercero**;
y **T5 NO cae con el trigger**, contra lo que se había predicho. La predicción
confundía dos cosas distintas: lo que tumba T5 es quitarle el `when` al trigger de
fotos (`20260909000447`), que dispara en TODOS los updates; un trigger que
pregunta `old.estado = 'vendida'` en su cuerpo nunca toca las filas `activa` de
T5. Fuera de T20 no cae nada en ninguno de los tres.

Y a **141** con las 3 de T21 (nadie reporta su propia publicación, RF-14),
autocontenida con sus propios `:M`/`:N`. Nada en T12: la migración no toca ningún
grant, solo el `with check` de una policy que ya existía. Las tres aserciones son
las tres ramas de la cláusula nueva y ninguna es intercambiable — la tabla de qué
variante rota caza cada una está arriba, en el bloque de `reports`, medida
corriendo T21 AISLADA y no dentro de la suite. **Esa distinción importa y es la
lección de esta sección:** dentro de la suite, T8 llega antes y caza dos de las
tres, así que una corrida completa en rojo no dice cuál es la red de verdad.
Correr una sección sola contra cada variante rota es lo que destapó que T21 tenía
un hueco (le faltaba (c)) mientras la suite entera seguía en verde donde debía.

Y a **142** con la cuarta de T21, (d), que llegó **sin migración**: al abrir
"Reportar usuario" desde Perfil público (RF-14, `confianza-ventas.md`) se volvió alcanzable el
`check` de tabla de `20260906000441:22` —nadie se reporta a sí mismo— que hasta
entonces no tenía control negativo propio. Nada en T12 tampoco: esa tarea no
toca ningún grant ni ninguna policy, solo cliente, diseño y spec. Es el caso
inverso del resto de esta lista, donde la aserción llega detrás de una migración:
aquí la regla ya estaba en la base y lo que cambió fue que por fin hay una
pantalla que puede chocar con ella.

Y a **148** con las 6 de T22 (bucket `avatars`, RF-03), autocontenida con sus
propios `:O`/`:P`. Nada en T12: la tarea no crea ninguna función, no toca ningún
grant —`foto_url` ya estaba en los dos grants desde `20260906000438:104` y
`:110`— y no agrega ningún `EXECUTE`. **La aserción que justifica la sección es
(e), y es POSITIVA**: un suspendido SÍ sube su avatar. Es la única sin gemela en
T14, donde la equivalente dice lo contrario — sin ella, copiar el
`is_active_user()` de aquellas policies (que es exactamente lo que invita a hacer
la simetría entre las dos migraciones) sería una regresión silenciosa. Los seis
controles negativos se corrieron **uno a la vez**, y cada uno cae en un solo
sitio:

| Variante rota | Cae en |
|---|---|
| sin el chequeo de carpeta en el INSERT | T22 (b) |
| con `is_active_user()` en el INSERT | T22 **(e)**, y en ningún otro lado |
| sin el guard `bucket_id` | T22 (d) |
| sin `avatars_objects_delete_own` | el probe: "el dueño SÍ borra su avatar" |
| sin `avatars_objects_select` | el probe: la MISMA, con `0 objeto(s)` |
| el bucket puesto en privado | el probe: "se sirve SIN autenticación" |

Dos cosas de esa tabla que conviene no suponer. **(e) muere con el error CRUDO de
Postgres**, no con el texto de su aserción: el `as_user` que siembra la foto
aborta antes de llegar al `assert` — mismo patrón que T14, pero no busques el
mensaje bonito. Y **las dos últimas del probe caen en aserciones distintas por
motivos distintos**, pero las dos primeras del probe caen en la MISMA: quitar la
policy de DELETE y quitar la de SELECT se ven igual desde ahí, porque las dos
dejan el borrado sin efecto. Lo que las distingue es el cuerpo — con SELECT
borrada el status sigue siendo 200 y el array viene vacío (§9).

Y a **156** con las 8 de T23 (suspender pausa las publicaciones activas, RF-17),
autocontenida con sus propios `:Q`/`:R` y cuatro publicaciones. Nada en T12: la
migración no toca ningún grant ni ninguna policy; la función entra en la
invariante de las que solo disparan por trigger, que pasó de 10 a **11** sin
cambiar la cuenta. Las NUEVE variantes rotas se corrieron una a la vez, cada una
contra la suite completa **y** contra T23 aislada.

| Variante rota | Cae en |
|---|---|
| sin trigger (el repo antes de la tarea) | T23 (a) |
| `listings_select` aflojada a `using (true)` | T23 (a2) **aislada**; en la suite, T2 |
| sin el `and estado = 'activa'` | T23 (b) |
| `estado <> 'pausada'` en vez de `= 'activa'` | T23 (c) |
| sin el `where user_id = new.id` | T23 (d) |
| sin `old.estado is distinct from new.estado` | T23 (e) |
| sin el `when` ENTERO | T23 (e) |
| sin `new.estado = 'suspendido'` | T23 **(g)** |
| cuerpo simétrico: despausa al reactivar | T23 **(f)** |

**Esa tabla contradice en dos puntos lo que el plan había predicho, y las dos
correcciones son la lección de la sección.** La primera: se predijo que (f)
—"reactivar NO despausa"— cazaría la variante sin `new.estado = 'suspendido'`.
**No la caza**: esa variante no despausa nada, pausa de MÁS otra fila, así que
(f) seguía en verde y la suite ENTERA daba verde. Es la lección de `:C` en T11b
otra vez, y obligó a agregar (g), que mira una publicación distinta —una que el
vendedor tenía activa al momento de reactivarse— en vez de la que ya estaba
pausada. La segunda: el control de (f) —el cuerpo simétrico— al principio moría
con el error CRUDO «Una publicación no puede activarse sin fotos», o sea que
quien bloqueaba la reactivación era `listings_enforce_activation_has_photos` y no
la ausencia de esa rama. Es **exactamente** el caso de la foto load-bearing de
T20 (d), reencontrado midiendo: por eso T23 siembra dos filas en
`listing_photos` que parecen decorado y no lo son.

**Y una tercera corrección, de la propia prosa de arriba:** esta sección llegó a
afirmar que las dos columnas de la medición coincidían siempre —"ninguna sección
anterior adelanta ninguna variante"—, y dejó de ser cierto en cuanto se agregó
(a2), la única aserción de T23 que lee el catálogo COMO OTRO USUARIO en vez de
mirar la columna `estado` como `postgres`. Su control negativo es aflojar
`listings_select`, y ahí sí manda T2. (a2) existe porque **nadie probaba la
transitividad completa** que introduce esta migración: dueño suspendido → el
trigger la pasa a `pausada` → desaparece del catálogo ajeno. T2 prueba la
segunda flecha sobre una fila SEMBRADA `pausada`; componer dos aserciones de
secciones distintas para dar por probada una tercera es justo lo que la lección
de (c) en T21 desaconseja.

Y a **167** con las 11 de T24 (`pendiente`/`bloqueada` no son públicos ni los
levanta su dueño, moderación pre-publicación), autocontenida con sus propios
`:S`/`:U`. Nada en T12: la migración no toca ningún grant, solo dos policies ya
existentes y el cuerpo de una función que ya tenía su `grant execute`. Cubre
TRES guardias con un solo universo de filas (`t_mod`, 5 publicaciones — una por
valor del enum), y cada una se corrió rota, contra la suite completa **y**
contra T24 aislada:

| Guardia rota | Cae en |
|---|---|
| `listings_select` sin la condición nueva | T24 (b), en ningún otro lado |
| `listings_update_own` sin `pendiente`/`bloqueada` en el `not in` | T24 (f) |
| `increment_listing_view()` sin su fix | T24 (j) |

**La primera versión reutilizaba las mismas filas para lectura, escritura y
vistas, y eso rompió (3) por la razón exacta que ya documenta la sección de
`listing_sales` más arriba: el ORDEN importa cuando el estado avanza.** Las
aserciones de escritura (2) mutan `estado` en dos de sus filas (pausar y
reactivar son el flujo normal, y SÍ escriben) — reutilizar esas mismas filas en
(3) hacía que "la publicación activa" ya no lo fuera para cuando (3) leía su
`vistas_count`. Medido: (3) fallaba con la RPC devolviendo 0 vistas sobre una
fila que (1) y (3) seguían llamando "activa" pero que (2) ya había pausado. El
fix es el mismo que en `listing_sales`: las filas que se leen y las que se
escriben no pueden ser las mismas — de ahí `t_mod` (solo lectura, para (1) y
(3)) y `t_mod_ctrl` (dos filas dedicadas, solo para los dos controles de (2)
que sí mutan `estado`).

Y a **169** con las 2 de `listing_moderacion` (`20260918000461`), que van
ENTERAS en T12 y en ninguna sección propia — es el caso inverso del resto de
esta lista. Una tabla sin policies no tiene comportamiento que ejercitar: no hay
"este rol sí ve y este no", solo "nadie ve". Lo único verificable es la
invariante de acceso, y ese tipo de aserción vive en T12 por definición. Las
dos, y por qué son dos y no una:

- **Sin un solo privilegio para `authenticated` ni `anon`**, mirando
  `table_privileges` **y** `column_privileges`. Las dos, y **medido**, no
  deducido: con un `grant select (veredicto)` puesto a mano,
  `table_privileges` devuelve **0** y `column_privileges` **1** — o sea que
  mirar solo la primera dejaría pasar exactamente el tipo de grant acotado que
  este repo usa en `users` y `listings`, que es el más probable de todos.
- **Sin ninguna policy.** Es la que caza el "arreglo" bienintencionado: alguien
  ve una tabla con RLS y cero policies, la lee como inacabada y le agrega una
  permisiva. La primera aserción no lo detectaría, porque sin grants esa policy
  no cambia nada… hasta que alguien agregue el grant.

Los tres controles se corrieron **uno a la vez** y cada uno cae en una sola
aserción: grant de tabla → la primera; grant solo de columna → la primera;
policy permisiva sin tocar grants → la segunda. Ninguno cae fuera de T12.

Y a **177** con las 8 de T25 (toda publicación de cliente nace `pendiente`,
`20260919000463`), autocontenida con sus propios `:V`/`:W`. Nada en T12: la
migración no crea funciones, no toca ningún grant y no agrega ningún `EXECUTE` —
solo reescribe el `with check` de una policy que ya existía. Las cuatro variantes
rotas se corrieron una a la vez, cada una imprimiendo el `pg_get_expr` de la
policy viva ANTES del resultado:

| Variante rota | Cae en |
|---|---|
| sin la migración (el `with check` de `20260906000439`) | T25 (b) |
| `with check (estado = 'pendiente')` a secas (drop+create mal hecho) | T25 **(e)** aislada; en la suite, **T3** |
| voltear el DEFAULT de la columna en vez de la policy | T25 (b) |
| `estado <> 'activa'` en vez de `= 'pendiente'` | T25 (d) |

**La segunda fila vuelve a ser el caso de T21, y esta vez arregló una aserción
vieja en vez de agregar una nueva.** T3 ("A no puede insertar un listing con
`user_id` de B") y la de T10 ("un suspendido no puede publicar") **omitían
`estado`**, o sea que caían en el default `'activa'` — y desde esta migración eso
las habría dejado pasando por el motivo equivocado. **Medido, no deducido:**
contra la variante del `with check` a secas, T3 SIN el arreglo pasa en verde y la
suite muere mucho después (en T10); T3 CON `estado = 'pendiente'` explícito la
caza en el acto. Las dos mandan ahora el estado bueno, para que el único motivo
de rechazo posible sea el que su mensaje dice.

**(c) es la aserción que parece de más y no lo es:** omitir la columna NO es lo
mismo que no mandarla. El default de `listings.estado` sigue en `'activa'` a
propósito —voltearlo obligaría a reescribir los 4 bloques de fixtures de la suite
y los cuatro `probe-*.mjs`—, así que un insert de cliente sin `estado` cae ahí y
tiene que ser rechazado igual. Y **(f) vigila justo esa premisa**: que
`postgres`/`service_role` sigan sembrando cualquier estado. Si alguien
"endureciera" esto con un trigger o un `check` de tabla —que sí alcanzan a
`service_role`, a diferencia de una policy— la suite entera se caería en cascada;
con (f), cae una sola aserción y lo dice con todas sus letras.

Y a **186** con las 10 de T26 (precio es un entero entre 0 y 100000, RF-05,
`20260922000464`), autocontenida con su propio `:X`. Nada en T12: la migración
no crea ninguna función ni toca ningún grant, solo reemplaza un `check` de
tabla que ya existía. (a)-(e) prueban el INSERT (con `estado` explícito en
`'pendiente'`, mismo criterio que T25 para que el único motivo de rechazo
posible sea el precio); (f)-(j) prueban el UPDATE, sobre una fila sembrada
DIRECTO como `postgres` en `'activa'` —no vía `as_user`, y no en `'pendiente'`—
porque `listings_update_own` excluye `pendiente`/`bloqueada` de su `using`
desde T24, así que una fila pendiente no la puede tocar ni su propio dueño (el
primer intento de esta sección sembró la fila de UPDATE en `'pendiente'` y (f)
cayó por eso, no por el check — corregido antes de comitear). Control negativo
corrido a mano: aflojar el check a `precio >= 0` (el original) deja pasar
100001 y 10.50 tanto en INSERT como en UPDATE, medido fila por fila; `-1` lo
sigue cazando el check base, que es el resultado esperado y no una falla del
control. Esta tarea también quitó una aserción de T18 (el bloque "CENTAVOS"
que probaba `$99.50, antes $2,900`): escribir un precio con decimales ya es un
error de `check`, no algo que valga la pena probar en el trigger de
notificaciones — de ahí que el total neto sea +9 (177 - 1 + 10) y no +10.

Y a **196** con las 10 de T27 (dominios de registro y el Auth Hook,
`20260923000465`), autocontenida con su propia universidad, su dominio
`rls-t27.mx` y su usuario `:Y`. Nada en T12: la aserción universal de RLS ya
cubre la tabla nueva, y la invariante de acceso vive en T27 porque va junto con
la lógica de la función. **Su alcance es la mitad del candado, y lo dice en su
cabecera:** prueba los grants y la función llamada directo como `postgres`, que
tiene bypassrls y no es miembro de `supabase_auth_admin`. O sea que la policy de
ese rol nunca se evalúa aquí, y la otra mitad —que GoTrue invoque el hook, que
la policy deje leer, que un rechazo no deje fila ni correo— vive en
`scripts/probe-registro.mjs`. Los nueve controles de T27 se corrieron uno a la
vez contra la suite completa, cada uno imprimiendo primero lo aplicado:

| Variante rota | Cae en |
|---|---|
| `grant select` de tabla a `authenticated` | T27 (a) |
| `grant select (dominio)` a `authenticated` | T27 (a) |
| `grant execute` a `anon` | T27 (c) |
| `grant execute` a `public` | T27 (c) |
| `revoke select` a `supabase_auth_admin` | T27 (e) |
| una policy permisiva extra para `authenticated` | T27 (e) |
| match por sufijo (`like '%' \|\| dominio`) | T27 (g) |
| el PRIMER `@` en vez del último | T27 (h) |
| sin el `check` del dominio | T27 (j) |

Y los seis del probe, contra el Auth local:

| Variante rota | Cae en |
|---|---|
| hook `enabled = false` en config.toml | casos 2 y 4 (gmail y las imitaciones pasan) |
| tabla vacía | casos 1 y 3 (se rechaza también `tec.mx`) |
| sin la policy de `supabase_auth_admin` | casos 1 y 3: el MISMO rechazo silencioso |
| match por sufijo | caso 4 (`estudiante.tec.mx`, `eviltec.mx`) |
| la función lanza `raise exception` | todos los de alta: 500, **sin fila** (fail-closed) |
| la función tarda 3 s y luego permite | casos 2 y 4: pasan, porque en local no hay timeout de 2 s |

La última fila es la sorpresa de la tarea, y por eso se midió aparte con
`pg_sleep(40)`: GoTrue local corta a los **10 s** con `504` y no crea la fila. O
sea que el timeout también falla cerrado, pero con un techo de 10 s y no de 2.

Y a **212** con las de la fase 2A (`20260924000466`): 14 de T28, una en T12
(sin UPDATE sobre `users.universidad_id` ni sobre la universidad/campus de una
publicación) y una en T0. T28 es autocontenida, con su propia universidad, su
dominio `rls-t28.mx`, dos campus propios y sus propios `:Z`/`:Z2`. **Estrena
dos cosas que conviene conocer antes de escribir la siguiente sección:**

- **`pg_temp.rechazo_de()` en vez de `expect_error`**: devuelve
  `<sqlstate>:<constraint>`, y la aserción compara las dos partes. Aquí hay
  cuatro candados que se confunden (grant 42501, dos FKs 23503 distintas y un
  check 23514), y `expect_error` acepta CUALQUIER error, así que un rechazo por
  el candado equivocado habría pasado.
- **La acción y la comprobación del estado van en SENTENCIAS DISTINTAS**
  (`\gset`). Una subconsulta dentro del mismo `select pg_temp.assert(...)` corre
  con el snapshot de ESA sentencia y no ve lo que la función escribió. Medido:
  (c2) caía aunque el update sí había escrito. En (d4)/(d6), que comprueban que
  algo NO cambió, el mismo error las habría dejado pasando sin probar nada.

La de T0 no es relleno: las publicaciones sembradas en T0 exigen que el dueño
tenga la universidad de su dominio (FK publicación ↔ dueño). Sin esa
aserción, la variante "trigger sin lookup" tumbaba la suite con un error crudo
de FK en el insert de fixtures, lejos de su causa. Los diez controles se
corrieron uno a la vez, contra la suite completa **y** contra T28 aislada,
imprimiendo antes lo que quedó aplicado:

| Variante rota | Suite | T28 aislada |
|---|---|---|
| trigger sin el lookup | T0 (la nueva) | (a) |
| trigger que lanza sin dominio | (a2) | (a2) |
| trigger con el PRIMER `@` | (a3) | (a3) |
| `grant update (universidad_id)` en `users` | T12 | (b) |
| FK suelta de `users` hacia `campus` | (c) | (c) |
| sin el check `users_campus_requiere_universidad` | (c3) | (c3) |
| sin `listings_user_universidad_fkey` | (d) | (d) |
| FK suelta de `listings` hacia `campus` | (d2) | (d2) |
| `grant update (universidad_id, campus_id)` en `listings` | T12 | (d4) |
| `listings_user_universidad_fkey` sin `on update cascade` | (d6) | (d6) |

Dos matices. **(d5) no tiene control propio**: es la misma FK que (d), que cae
antes; documenta el caso "sin universidad no publica". **La variante "lanza"
tampoco la caza el caso 8 de `probe-registro.mjs`**: el probe aborta antes, en
el caso 5, con "no se pudo sembrar la cuenta existente: 500" y salida 1. Se
detecta, pero la red con nombre es (a2), que da de alta a `:Z2` capturando el
error en vez de con un insert suelto. Con un insert suelto, esa variante moría
con el error crudo antes de llegar a (a2).

Y a **223** con las 11 de T29 (`campus.latitud`/`longitud`, fase 2C,
`20260925000467`): 10 aserciones (los 3 checks + grant de lectura/escritura,
cada una con su control negativo) más 1 precondición de fixtures. **Nada en
T12**: la migración no toca ningún grant (el `select` de las columnas nuevas
se hereda del grant de TABLA que `campus` ya tenía, medido con el diff de
`scripts/grants-users-listings.sql` — ver el bloque de `campus` más arriba en
esta sección). T29 es autocontenida (su propia universidad "RLS T29
Universidad" y su propio usuario `:W`, sin reusar fixtures de T28) y los 4
controles negativos —quitar cada uno de los 3 checks, dar un `grant update`
de más— se corrieron uno a la vez, cada uno cayendo exactamente en su
aserción:

| Variante rota | Cae en |
|---|---|
| sin `campus_latitud_check` | (a) |
| sin `campus_longitud_check` | (b) |
| sin `campus_coordenadas_completas_check` | (c) |
| `grant update (latitud, longitud)` a `authenticated` | (g) |

Y a **259** con las 36 de T30 (`public.buscar_listings`, búsqueda por prefijo,
`20260926000468`): 1 precondición de fixtures, 13 de comportamiento
((a)-(h2), incluidas las invariantes (i1)-(i3) de la función) y 22 de fuzz
((j) y (j2), una por entrada). **Nada en T12**: las invariantes de la función
(invoker, STABLE, sin SET, EXECUTE solo para authenticated) viven en T30 junto a
la lógica que protegen. T30 siembra sus propios `:V30`/`:C30` y sus publicaciones
con el prefijo "RLS T30", y cada aserción cuenta SOLO filas con el título
esperado, porque T0 sembró otro "RLS Cálculo de Larson" que también casa con
`calc`. Las acciones corren como `authenticated`: como postgres (bypassrls), la
aserción de RLS pasaría por la razón equivocada. Los seis controles se corrieron
uno a la vez contra la suite completa. Antes de cada uno se imprimía el estado
vivo de la función (`prosecdef`, `proconfig`, EXECUTE de anon y marcas en
`prosrc`), y al final se restauró y se verificó:

| Variante rota | Cae en |
|---|---|
| `security definer` | (h) — un tercero ve la pausada ajena |
| la rama de prefijo concatena el tail crudo (`to_tsquery(tail \|\| ':*')`) | (j2) `calc)`, con `syntax error in tsquery: "calc):*"` |
| stopword como ausente (sin la rama `simple`) | (e) |
| mínimo de 1 letra en vez de 3 | (g) |
| `set search_path = ''` | (i2) |
| `grant execute … to anon` | (i3) |

**(j2) nació de un hueco del plan, no de prolijidad.** El fuzz original solo
tenía basura suelta (`'`, `&`, `:*`, emojis…), que no produce lexemas y por lo
tanto nunca llega a la rama que arma `to_tsquery`. Contra la variante de la
concatenación cruda, ese fuzz habría dado verde. La entrada que la caza es un
término REAL pegado a sintaxis. Ojo al leer la tabla: `calc'` NO revienta la
variante rota y `calc)` sí, así que el orden de (j2) no es intercambiable por
uno más corto.

Y a **273** con las 14 de T31 (nombre válido, `20260927000469`): 4 que
aceptan, 2 de NULL, 7 que rechazan y la de NFD. Nada en T12: la migración no
toca ningún grant, solo agrega un check. T31 es autocontenida con su propio
`:N31` y cada caso es un UPDATE del propio nombre COMO `authenticated`, con
`rechazo_de()` comparando `23514:users_nombre_valido`. Los diez controles se
corrieron uno a la vez contra la suite completa, imprimiendo antes
`pg_get_constraintdef`:

| Variante rota | Cae en |
|---|---|
| sin la cota inferior | (j) "J" |
| sin la cota superior | (k) 51 caracteres |
| clase + `0-9` | (f) "Juan123" |
| clase + `_` | (g) "Juan_" |
| `^ *` (espacio inicial permitido) | (h) "  Juan" |
| separador `( +\|['’-])` | (i) "Juan  Pérez" |
| clase + rango de emoji | (l) |
| clase sin Latin-1 | (a) "José Ñúñez" |
| clase + marcas combinantes (U+0300-036F) | (m) NFD |
| `nombre is not null and …` (rechaza NULL) | **(e)** aislada; en la suite, el error CRUDO al crear los fixtures globales |

**La última fila es estructural, no un hueco de la sección.** Un check que
rechace NULL rompe TODA alta de cuenta (el trigger crea la fila sin nombre), así
que en la suite completa muere al sembrar `:A`/`:B`/`:C`, antes de T0. Por eso
el alta de `:N31` va CAPTURADA con `rechazo_de()` —el recurso de `:Z2` en T28—
y es la propia aserción (e): contra T31 aislada (helpers sin fixtures globales +
T31), esa variante cae ahí con su nombre. La primera versión sembraba `:N31` con
un insert suelto y moría con el error crudo también aislada.

Y a **282** con las 9 de T31 para el teléfono (`20260927000470`): 3 que
aceptan (`+52`/10, `+1`/10, `+34`/9) y 6 que rechazan (México con 8 y con 11,
lada con 0, letras, sin `+`, 16 dígitos). Dos cosas cambiaron fuera de T31:

- **T16 tenía dos aserciones del check viejo y se REESCRIBIERON, no se
  borraron.** Las dos siguen siendo rechazos (`8111234567`, `+521234`), pero el
  mensaje "un número sin +52 lo rechaza el check" dejó de describir la causa:
  hoy falla por no llevar `+`. Pasaron de `expect_error` a `rechazo_de()` con
  el nombre nuevo del constraint, así que el conteo no cambió.
- **`pg_temp.rechazo_de()` subió de T28 a los helpers del principio del
  archivo**, para que T16 (que corre antes) la pueda usar.

Controles, uno a la vez contra la suite completa **y** contra T31 aislada:

| Variante rota | Suite | T31 aislada |
|---|---|---|
| sin la regla de México | (q) | (q) |
| México `{10,11}` | (r) | (r) |
| `[0-9]` en vez de `[1-9]` en la lada | (s) | (s) |
| `{7,15}` | (v) | (v) |
| `+` opcional | **T16** "sin + (sin lada)" | (u) |
| letras permitidas | (t) | (t) |
| el check VIEJO (solo +52) | (o) | (o) |

**La fila de `{10,11}` es la lección de la sección.** La primera versión de (r)
usaba `+52811234567890`, que tiene **12** dígitos después del 52 y no 11, y esa
variante daba la suite ENTERA en verde. La aserción rechazaba por la razón
equivocada; lo destapó su propio control (la moraleja de siempre: si no cae,
no prueba). Ahora es `+5281123456789`.

Y a **284** con las 2 de T12 para `listing_moderacion_reclamos`
(`20260928000471`): sin privilegios (tabla y columna) y sin policies, gemelas de
las de `listing_moderacion`. Sus dos controles, corridos uno a la vez con un
script de bash que imprime el estado vivo antes de la suite (la primera
corrida, con la orden en una variable de zsh, no aplicó NADA: el gotcha de §9,
reencontrado): `grant delete` a authenticated cae en la primera; una policy
permisiva, en la segunda.

Y a **317** con las de RF-16 tanda 2 (`20260928000472`/`473`): 29 de T32 más
4 en T12. Las de T12 son: `avatar_moderacion` sin privilegios y sin policies
(2); `veredicto_en_pantalla` sin UPDATE para authenticated (1); y la NUEVA de
las dos funciones de trigger INVOKER, `set_updated_at()` y
`limpia_veredicto_en_pantalla()` (1). **No existía ninguna aserción sobre
`set_updated_at()`:** se pidió una "gemela" de la suya y no había original; ésta
las cubre a las dos por primera vez. La lista de funciones solo-trigger
revocadas pasó de 12 a **16** sin cambiar la cuenta. T32 es autocontenida, con
sus propios `:D32`/`:F32a`/`:F32b`/`:F32c` y 15 publicaciones con foto (la
foto es load-bearing: sin ella, pasar a `activa` lo rechaza
`listings_enforce_activation_has_photos`). Los 17 controles se corrieron uno a
la vez con un runner que imprime el estado vivo antes de cada corrida y verifica
al final que triggers y funciones quedaron IDÉNTICOS a su definición original,
contra la suite completa **y** contra T32 aislada:

| Variante rota | Suite | T32 aislada |
|---|---|---|
| moderación sin `old.estado is distinct from new.estado` | (h) | (h) |
| moderación, rama 1 sin `old.estado = 'pendiente'` | (f) | (f) |
| moderación sin `not new.veredicto_en_pantalla` | (a) | (a) |
| moderación, rama 2 sin `old.estado <> 'pendiente'` | (d) | (d) |
| sin el trigger de limpieza | (a4) | (a4) |
| vendido sin `old.estado is distinct from new.estado` | (r) | (r) |
| vendido también en `pausada` | (q) | (q) |
| vendido sin excluir al comprador | (m) | (m) |
| vendido sin excluir al dueño | (n) | (n) |
| trigger de ratings en `insert or update` | (j) | (j) |
| el cuerpo de la calificación con el comentario | **(i)** | **(i)** |
| avatar sin `WHEN (new.foto_url_nulificado)` | (t) | (t) |
| `grant update (veredicto_en_pantalla)` | T12 | pasa |
| `grant insert` en `avatar_moderacion` | T12 | pasa |
| una policy en `avatar_moderacion` | T12 | pasa |
| `limpia_veredicto_en_pantalla` como DEFINER | T12 | pasa |
| `grant execute` de `notify_calificacion` | T12 | pasa |

Dos lecturas de esa tabla. **El comentario cae en (i) y no en (k)**, porque
(i) compara el cuerpo EXACTO y corre antes. (k) queda como red por si alguien
afloja (i) a un `like`. **Las cinco de T12 "pasan" aisladas**, y es lo
esperado: esas invariantes viven en T12, que no está en T32. Sin el trigger de
limpieza también caería (x1), después de (a4). La suite corta en la primera
caída.

Y a **335** con las de "Eliminar cuenta" (`20260929000474`): 16 de T33 más 2
en T12 (`correos_bloqueados` sin privilegios para el cliente, y con la ÚNICA
policy para `supabase_auth_admin`). La lista de funciones solo-trigger revocadas
pasó de 16 a **18** (`borra_avisos_de_cuenta`, `bloquea_correo_suspendido`) y la
de las INVOKER de 2 a **4** (`anonimiza_rating`, `anonimiza_report`), sin
cambiar la cuenta. Además se CORRIGIÓ una aserción de T8, que afirmaba la regla
vieja ("borrar la cuenta reportada conserva el correo"): la decisión 5 la
invierte. T33 es autocontenida, con sus propios `:K33` (la cuenta que se borra),
`:V33`, `:C33`, `:R33` y `:S33`/`:A33`, y siembra ventas, reseñas en los dos
sentidos, reportes en las dos direcciones y avisos disparando los triggers
REALES (baja de precio, venta). Guarda todo con `\gset` ANTES del borrado y
compara después, en sentencias distintas (lección de T28). Su (h) es un barrido
genérico: ninguna columna `uuid` de ninguna tabla de `public` guarda el id
borrado, así que una tabla nueva con la FK equivocada cae ahí sin que nadie la
agregue a una lista. Los 15 controles se corrieron uno a la vez dentro de la
MISMA transacción que la suite (`begin; <variante>; <suite>; rollback`, así que
nunca se persistieron), imprimiendo antes el estado vivo, contra la suite
completa **y** contra T33 aislada:

| Variante rota | Suite | T33 aislada |
|---|---|---|
| `ratings.from_user_id` de vuelta a cascade | (a) | (a) |
| `ratings.listing_id` de vuelta a cascade | (a) | (a) |
| `reports.reporter_id` de vuelta a cascade | (f) | (f) |
| sin el trigger que borra el comentario | (a) | (a) |
| sin el trigger que borra el correo del reporte | **T8** | (g) |
| sin `users_borra_avisos_de_cuenta` | (g2) | (g2) |
| borrado de avisos solo de los dos tipos con nombre | (g2) | (g2) |
| borrado de avisos sin la rama de publicaciones ajenas | (g2c) | (g2c) |
| borrado de avisos sin filtrar por dueño | (g3) | (g3) |
| sin `users_bloquea_correo_suspendido` | (k) | (k) |
| el hook sin la comprobación de `correos_bloqueados` | (k2) | (k2) |
| `grant update (from_user_id)` en `ratings` | **(i)** | **(i)** |
| `grant update (reporter_id)` en `reports` | (i) | (i) |
| `grant select` de `correos_bloqueados` a authenticated | T12 | pasa |
| sin la policy de `correos_bloqueados` | T12 | pasa |

**La fila del `grant update (from_user_id)` es la lección de la sección.** La
primera versión de (i) solo miraba el COMPORTAMIENTO (el update da 42501), y
con ese grant puesto a mano siguió en verde: el `with check (from_user_id =
auth.uid())` de `ratings_update_own` también rechaza. La aserción pasaba por la
policy y no por el grant que decía vigilar. Ahora mira también
`has_column_privilege`. **Y otra, del plan:** (a) esperaba `listing_id` NULL en
TODAS las reseñas que escribió, y era falso: la que escribió sobre una
publicación AJENA la conserva, porque esa publicación no se borra. Lo destapó la
primera corrida, no el control.

Y a **358** con las 23 de T34 (intereses y `recomendar_listings`,
`20260930000475`), autocontenida con sus propios `:A34`/`:B34`/`:N34`/`:X34`,
su universidad `rls-t34.mx`, dos campus propios y 16 publicaciones. Nada en
T12: la aserción universal de RLS ya cubre la tabla nueva, y las invariantes de
la función (invoker, STABLE, sin SET, EXECUTE solo a authenticated) viven en
T34 (j), junto a la lógica que protegen, igual que las de T30. Las 17 variantes
rotas se corrieron una a la vez dentro de la misma transacción que la suite
(`begin; <variante>; <suite>; rollback`, así que nunca se persistieron). Antes
de cada corrida se imprimió el estado vivo, y cada una se corrió contra la
suite completa **y** contra T34 aislada:

| Variante rota | Suite | T34 aislada |
|---|---|---|
| policy select `using (true)` | (a) | (a) |
| policy insert `with check (true)` | (b) | (b) |
| policy delete `using (true)` | (c) | (c) |
| `grant update` a authenticated | (c2) | (c2) |
| `grant select` a anon | **T12** | (c2) |
| la función DEFINER | **(d3)** | **(d3)** |
| sin `estado = 'activa'` | (d4) | (d4) |
| sin el término de interés | (e) | (e) |
| contacto pesa igual que favorito | (e2) | (e2) |
| sin la ventana de 90 días | (e3) | (e3) |
| orden sin `created_at` | (f) | (f) |
| sin excluir las propias | (g) | (g) |
| cursor sin `id` | (h) | (h) |
| sin el filtro de alcance | (i1) | (i1) |
| con `set search_path` | (j1) | (j1) |
| `grant execute` a anon | (j2) | (j2) |
| sin la FK hacia `users` | (k) | (k) |

**Cuatro aserciones de la primera versión pasaban por la razón equivocada**, y
las destapó correr los controles, no razonarlos:

- **(c) borraba con `where user_id = B`**, y un DELETE con `WHERE` aplica
  también la policy de SELECT a las filas que filtra. Afectaba 0 filas aunque
  la de DELETE fuera `using (true)`, o sea que (c) probaba la de SELECT. Ahora
  borra SIN filtro. Medido: con filtro, 0 filas; sin filtro, 2. El caso general
  está en §9.
- **El helper reordenaba** con su propio `string_agg(... order by puntaje, …)`,
  así que (f) y (e2) probaban los puntajes pero no el ORDER BY de la función:
  quitarle `created_at` no lo cazaba ninguna de las dos. Ahora el helper lee
  el orden de emisión (`with ordinality`).
- **(d) miraba títulos a través de un join con `listings`** hecho como
  authenticated, y ese join escondía por su cuenta lo que la función
  devolviera. Ahora cuenta ids crudos de la función. Aun así, la variante
  definer no la tumba, por los dos candados de (d). Por eso nacieron (d3) (las
  señales) y (d4) (las vendidas, con un solo candado).
- **El orden de las aserciones:** la propia, la del campus B y la de la otra
  universidad son de c1 y más nuevas que X. Una variante que las dejara pasar
  tumbaba primero a (e) y la aserción con su nombre nunca corría. Por eso (i)
  va primero, y (g) y (d) van antes que las de orden.

**Y el fixture tenía un bug propio:** un `insert … select … join users` NO
asigna los ids en el orden del `values`, porque el join reordena. T1-T3
salieron al revés, así que (e2) esperaba un orden que no existía. Ahora va
`order by v.n`, y la precondición de T34 verifica los ids.

Y a **362** con las 4 de T36 (resolver el reporte de una cuenta eliminada,
`20260930000476`): 2 precondiciones de fixtures y 2 de comportamiento,
autocontenida con sus propios `:R36`/`:V36`/`:T36`. **T35 queda reservada** para
la Ola 1 de RF-17 (identidad y MFA del panel), y T36 se abrió antes a propósito
para no mezclar esta corrección con el panel. Nada en T12: la migración no crea
funciones ni toca grants, solo el `WHEN` de un trigger. El UPDATE corre como
`postgres` (lo que hará una RPC definer del panel) y su rechazo se captura con
`rechazo_de(null, …)`, en sentencia aparte de la comprobación (`\gset`,
lección de T28). Los dos controles se corrieron uno a la vez dentro de la misma
transacción que la suite (`begin; <variante>; <suite>; rollback`), imprimiendo
antes el trigger vivo, contra la suite completa **y** contra T36 aislada:

| Variante rota | Suite | T36 aislada |
|---|---|---|
| el `WHEN` de antes (sin `reporter_id is not null`) | (a), con `23502` | (a) |
| `when (false)` (apaga el aviso también para cuentas vivas) | **T18** "resolver un reporte notifica a quien lo levantó" | (a2) |

**La segunda fila es la razón de (a2).** En la suite completa esa variante la
caza T18 primero, o sea que sin (a2) T36 dejaría pasar `when (false)` en cuanto
alguien sacara T18 o la reordenara. (a) sola no la distingue: el fix "correcto"
y `when (false)` dan las dos `ok` y sin aviso.

Y a **406** con la Ola 1 de RF-17 (`20260930000477`/`478`): 7 en T12 y 37
de T35. T35 es autocontenida, con su propia universidad `rls-t35.mx`, ocho
cuentas de prueba (cinco admins, uno sin activar) y siete publicaciones de `:S35`. Estrena dos
helpers: `pg_temp.claims_aal()`, que fabrica claims con `aal` y `amr` (la
clave ausente, JSON `null` o un arreglo), y `pg_temp.rechazo_aal()`, que
devuelve `sqlstate:mensaje`, porque todas las guardas comparten 42501 y solo el
mensaje dice cuál rechazó. **Los 48 controles se corrieron uno a la vez** (19 de identidad y auditoría, 28 de suspender/reactivar y 1 de (g0b); decía 47 antes de (g0b))
(`begin; <variante>; <suite>; rollback`, imprimiendo antes el hash de `prosrc`
o la constraint viva), contra la suite completa **y** contra T35 aislada. Cada
uno cayó en su aserción; los de T12, como se espera, dan verde en T35 aislada.
Los que merecen nota:

| Variante rota | Suite | T35 aislada |
|---|---|---|
| la forma con `coalesce` (D18) | (d2), con 22023 | (d2) |
| sin el regex del timestamp | (d3), con 22P02 | (d3) |
| `users_suspension_coherente` con la forma del plan (un solo sentido) | (g0) | (g0) |
| quitar G2 de la función | (g1), porque llega 23514 | (g1) |
| quitar G3 al suspender | (h1), porque llega `objetivo_es_admin` | (h1) |
| contar TODAS las pausadas en vez de las de esta acción | (e) | (e) |
| quitar `is_active_user()` de `listings_insert_own` | **T10** | (m) |
| quitar `is_active_user()` de `listing_contacts_insert_own` | (m) | (m) |
| reactivar CON G4 | (r4) | (r4) |
| `admin_id` con FK en cascade | (k) | (k) |

Dos lecciones de la sección. **Un TRUNCATE en la misma sentencia que un
`count(*)` de la misma tabla no llega al trigger**: choca con la tabla abierta
(55006). La primera versión de (i) lo hacía y caía por eso; ahora cada acción va
en su sentencia (`\gset`), la lección de T28 otra vez. **Y los cinco fixtures
que suspendían sin motivo** (T10, T22, T23 y T33 en `rls.sql`, el caso 9 de
`probe-registro.mjs`) escriben ahora `suspendido_at` y un motivo; sus
controles se re-corrieron (T22 (e), los siete de T23 y T33 (k)) y caen donde
caían.

Y a **407** con (g0b) (T35 pasa a 38; T12 sigue en 38, medidos con el mismo
`grep` acotado a cada sección), que cierra un hueco medido: "activo con UNA sola
columna" tiene dos variantes y (g0) solo cubría la del motivo. La de
`suspendido_at` sin motivo no la probaba nadie. Hay dos controles, y su diferencia es
la lección:

| Variante rota | Suite | T35 aislada |
|---|---|---|
| la forma del plan en un solo sentido | **(g0)** | **(g0)** |
| rama `activo` sin la condición de `suspendido_at` | (g0b) | (g0b) |

La forma del plan rompe LAS DOS mitades, así que la caza (g0), que corre
primero. Ningún orden de las aserciones haría que esa variante cayera solo en
(g0b). La que abre únicamente la mitad de `suspendido_at` cae solo en (g0b), y
eso es lo que prueba que (g0b) es la red de su mitad.

Y a **453** con la Ola 2 de RF-17 (`20260930000479`): 2 en T12, 5 de T35c y
39 de T36 (Ola 2), medidos con el `grep` acotado a cada sección. T12 suma la
invariante genérica por `pg_depend` y su "no vacía" (tiene que ver la policy
de admin ligada a `is_admin()`), y la lista de funciones solo-trigger revocadas
pasa de 19 a **20**. T35c y T36 (Ola 2) son autocontenidas, cada una con su
universidad (`rls-t35c.mx`, `rls-t36b.mx`). Los **48** controles (decía "49":
el runner tenía 50 bloques, y 2 son la línea base sin variante; contado con
`grep -c '^### '` sobre su salida) se corrieron
uno a la vez con un runner que arma cada variante desde el SQL REAL de la
migración (reemplazo que tiene que machear una vez), imprime el estado vivo
antes y corre dentro de `begin; <variante>; <suite>` sin commit, contra la
suite completa **y** contra la sección aislada. Los que merecen nota:

| Variante rota | Suite | Aislada |
|---|---|---|
| sin la policy de admin | **T12** (el enlace a `is_admin()`) | T35c (a) |
| `is_admin()` sin la cláusula de `amr` | **T35 (d)** | T35c (a2) |
| `is_admin()` sin la cláusula `aal` | **T35 (b)** | T35c (b) |
| trigger que solo sella llamadas del panel (`role = authenticated`) | (c1b) | (c1b) |
| `reporter_id is not null` copiado al trigger | (c2) | (c2) |
| validación con `not in` a secas (no null-safe) | (d3) | (d3) |
| `bloquear_listing` restringido a `pendiente` | (h2) | (h2) |
| auditoría de resolver con `comentario` | **(c1)**: la RPC revienta con 23514 | (c1) |
| `admin_acciones_accion_check` sin las 2 acciones nuevas | (c1) | (c1) |
| aviso sin la rama 1 / sin la limpieza de `veredicto_en_pantalla` | **T32** | (j1) |

Tres lecciones de la sección. **La primera versión de la variante "policy de
admin sin `is_admin()`" abría el bucket a todos** (`using (bucket_id = …)`), y
la cazaba T14 ("un ajeno NO ve la foto…"), no el enlace: no probaba lo que decía.
La que sí prueba el enlace no le abre nada a nadie (`… and false`). **(j1)
depende de la limpieza solo porque su fixture se marca a propósito con
`veredicto_en_pantalla = true`**: sin esa línea, (j1) pasaría aunque la
limpieza no existiera. **Y el control del (c1b) no puede ser "la RPC escribe
`resolved_at`"** (lo prohíbe la decisión D-B1): es un trigger que solo sella
cuando el GUC `role` es `authenticated`. Medido en B0: dentro de una RPC
`security definer` el GUC sigue en `authenticated` (cambia `current_user`, no
el GUC), y en un UPDATE directo es `postgres` (`none` en una sesión nueva).

Y a **454** con (g3r2): G3 de `resolver_reporte` no cubría al DUEÑO de la
publicación reportada. `listing_id` y `reported_user_id` son excluyentes
(`reports_check`, `num_nonnulls(…) <= 1`, `20260906000441:21`), así que un
reporte de publicación tiene `reported_user_id` NULL y la rama "reportado" de
G3 nunca lo alcanzaba: un admin podía resolver un reporte sobre su propia
publicación. G3 suma `exists (… listings l where l.id = v_reporte.listing_id
and l.user_id = auth.uid())`, corregido en la 479 misma (no estaba en
remoto). Su control, "G3 sin la rama del dueño", cae solo en (g3r2), en la
suite y aislada, y el de (g3r) ("sin G3") sigue cayendo en (g3r). Con él son
**49** controles, y los 49 caen en la suite completa.

Y a **455** con (j3), que llegó con un cambio a `…479` ANTES de su push (sin
migración nueva): `admin_acciones_accion_check` admite `desactivar_admin` (6
acciones). T35 pasa a 39 aserciones y T12 sigue en 40 (medidos con el `grep`
acotado a cada sección el 2026-10-05; T35c 5, T36 4 y T36 de la Ola 2 40).
(j3) tiene dos mitades que cazan cosas distintas: `desactivar_admin` con las
claves del tipo `admin` entra, y una acción fuera de la lista da
`23514:admin_acciones_accion_check`. Los controles, uno a la vez dentro de la
misma transacción que la suite, contra la suite completa **y** contra T35
aislada, imprimiendo antes `pg_get_constraintdef`:

| Variante rota | Cae en |
|---|---|
| el CHECK de la Ola 2 (5 acciones, sin `desactivar_admin`) | (j3), primera mitad |
| `check (true)` | (j3), segunda mitad |

El control de la Ola 2 "sin `resolver_reporte` ni `bloquear_listing`"
(conservando `desactivar_admin`) sigue cayendo en T36 (c1).

**Gotcha: la suite espera 3 usuarios en local.** Una cuenta de prueba (la del
admin de la prueba manual del panel) la rompe en T1; se arregla con
`supabase db reset`.

Incluye controles negativos (el esquema se rompió a propósito para confirmar
que la suite sí falla cuando debe). Cualquier cambio a policies/grants debe
correr esta suite antes de comitear.

**RF-18 (moderación de contenido pre-publicación): las decisiones de umbral,
documentadas ANTES de construirse.** Nada de este flujo existe en código
todavía — la base es la de arriba: el enum ya tiene `pendiente`/`bloqueada` y
su RLS ya los trata como no públicos (T24) — pero las decisiones que van a
gobernar cómo se usa ese enum ya están tomadas, y quedan aquí para que no
sigan viviendo solo en una conversación:

- **Son DOS umbrales, no uno: `LIKELY → pendiente`, `VERY_LIKELY →
  bloqueada`. ESTO ES DE VISION Y SOLO DE VISION** — el eje de Rekognition, más
  abajo, NO sigue esta forma (tiene techo y nunca bloquea), así que no leas este
  párrafo como si aplicara a todos los ejes de imagen. Una publicación que
  Google Cloud Vision marque `LIKELY` en
  alguna de las categorías que miramos queda en `pendiente`, a la espera de
  revisión humana; `VERY_LIKELY` la bloquea **automáticamente**, sin pasar por
  una persona. `LIKELY` como umbral de revisión es deliberadamente sensible —
  manda a la cola más publicaciones legítimas de las que haría falta— y esa es
  la concesión que se eligió a cambio de que pase menos contenido dudoso sin
  mirar. **Ojo si lees una versión anterior de este bloque:** llegó a decir que
  `bloqueada` solo la pone una persona y nunca el pipeline. Eso es falso desde
  que existen los dos umbrales.
- **Las categorías de SafeSearch que se miran son `adult`, `violence` y
  `racy`.** `spoof` queda fuera porque no es una señal de seguridad —mide si la
  imagen es una versión alterada de una canónica—, y `medical` porque en ESTE
  catálogo es una fábrica de falsos positivos: libros de anatomía, batas,
  estetoscopios, muletas, botiquines.
- **Amazon Rekognition es un QUINTO eje, junto a Vision y OpenAI, NO en
  reemplazo de ninguno.** Cubre lo que ni SafeSearch ni GPT miran: **drogas,
  tabaco, alcohol y gambling en la IMAGEN**. Son tres categorías de nivel 1 del
  taxonomy v7, con el nombre exacto de AWS: `Drugs & Tobacco`, `Alcohol` y
  `Gambling`. Solo L1 (es lo que la propia doc de AWS recomienda), y **solo
  publicaciones: los avatares no pasan por este eje** —drogas/alcohol es señal
  de catálogo, no de foto de perfil, y `decidirAvatar()` borra de forma
  irreversible, sin cola donde caer un falso positivo—.
- **El eje ENTERO tiene techo en `revisar`: Rekognition NUNCA bloquea solo.**
  Es la diferencia con Vision, y es deliberada, no una etapa a medio hacer. Dos
  razones: (a) **cero datos medidos de falsos positivos** sobre este catálogo —
  mismo argumento que dejó `medical` fuera de Vision, y las definiciones de AWS
  lo hacen concreto: `Alcoholic Beverages` es "close up of bottles, glasses or
  mugs" (un juego de copas), `Gambling` es "playing cards, blackjack" (una
  baraja) y `Drugs & Tobacco → Products → Pills` es "pills in a bottle" (**un
  frasco de vitaminas o de proteína**, venta legítima entre estudiantes); y (b)
  **`bloqueada` no tiene recurso hoy** — ni edición ni apelación, solo eliminar,
  y RF-17 no existe. El techo se aplica al EJE y no por categoría justamente
  para que no se pueda romper agregando una categoría y olvidándole el suyo. **Primera
  evidencia real (2026-09-22):** una `Silla gamer` recibió `Alcohol` @95.7 — el
  techo hizo que quedara en `pendiente` y no bloqueada. En cambio el caso de las
  vitaminas que este párrafo cita **no se materializó**: un frasco real dio cero
  etiquetas de Rekognition y lo escaló el eje de TEXTO. Detalle en
  `.claude/rules/moderacion.md` §9.
- **Falsos NEGATIVOS: limitación conocida y distinta de lo anterior.** El mismo
  contenido da resultados dispares porque cae encima de la frontera del modelo —
  medido: una cajetilla de cigarros da 99.9, pero cuatro fotos de plumas de vape
  dan 98.1 / 60.8 / 51.6 / nada. En una prueba deliberada con contenido
  disfrazado, **3 de 6 (n=6) evadieron el eje de imagen por completo, y solo 2
  de 6 se atraparon de forma fiable** —la tercera la escaló GPT sobre un texto
  cuyo veredicto es una moneda al aire, medido—. **Bajar el umbral no lo
  arregla** (los que escaparon no fueron "casi", fueron ausencia total) y
  **bajar `MinConfidence` a 20 es un no-op medido**. No hay disparador numérico
  posible porque un falso negativo no deja fila que contar: la vía realista es
  el reporte de usuario (RF-14). Completo, con todas las mediciones, en
  `.claude/rules/moderacion.md` §8b.
- **Se le piden a AWS las etiquetas desde `MinConfidence: 50`, pero se ACTÚA
  desde 70**, y esa diferencia es el diseño entero: la banda 50-70 **se registra
  en `listing_moderacion.detalle` y no hace nada**. Es el dataset con el que se
  decidirá si subir el umbral a `bloquear`, y se acumula solo desde la primera
  publicación en vez de exigir re-moderar nada. Registrar por debajo del umbral
  de acción, actuar por encima. La deuda de subir el umbral tiene **número y
  comando** (50 publicaciones por categoría, con su SQL) en
  `.claude/rules/moderacion.md` §9 — no dice "cuando haya suficientes".
- **`vendida` y `pausada` SÍ escalan a `bloqueada`, pero el pipeline NUNCA las
  promueve a `activa`.** Es la regla menos obvia de todo esto y es asimétrica a
  propósito. Escalan porque si no, `pausada` sería un escondite —pausar, cambiar
  la foto, reactivar, con contenido sin moderar— y porque una `vendida` la ve el
  campus entero (arriba), o sea que el contenido sucio sigue expuesto; escalar
  una `vendida` **no toca `listing_sales`**, que es otra tabla con su propia
  policy. Y no se promueven porque `pausada` y `vendida` no son estados de
  moderación sino decisiones del vendedor: una moderación limpia que
  "promoviera" despausaría la publicación de alguien que la pausó a propósito, o
  resucitaría una venta. **`bloqueada → activa` no ocurre por ningún camino.**
- **El texto sacado por OCR de una foto tiene TECHO en `pendiente`: nunca
  bloquea solo.** Pasa por la MISMA lista de palabras prohibidas que el título y
  la descripción —una sola lista, no dos que se desincronicen— pero con
  consecuencia distinta, porque la intención no es la misma: teclear una palabra
  en la descripción es deliberado, que Vision la lea de la portada de un libro o
  de un póster de fondo es incidental. El techo no abre un hueco: el caso de
  evasión —escribir el texto dentro de la imagen— sigue cayendo en `pendiente`,
  que no es "publicado" sino "no se publica hasta que alguien lo mire".
- **Los datos de contacto en el texto también tienen techo en `pendiente`.** Un
  vendedor que escriba su WhatsApp en la descripción salta entero el control de
  `seller_whatsapp()` (arriba), así que se detecta — pero no bloquea, porque un
  número de modelo, un año o una talla lo disparan igual.
- **Avatares: enforcement binario, y solo `VERY_LIKELY` borra.** Un avatar
  `LIKELY` **no hace nada**. No es descuido: no hay dónde encolarlo —`users` no
  tiene columna de estado para la foto y el bucket es público, así que no existe
  un "subido pero no visible"— y se prefiere el riesgo de un avatar dudoso sin
  resolver antes que borrar contenido legítimo sin poder revertirlo. Cuando sí
  borra, borra el objeto y pone `foto_url` en null: el usuario vuelve a sus
  iniciales.
- **Hoy —y hasta que el panel de RF-17 esté desplegado (§8, pendiente
  0k)— la cola de `pendiente` la revisa el desarrollador único vía Supabase
  Studio.** No hay otro mecanismo todavía — ni notificación a un equipo de
  moderación, ni SLA, ni flujo automatizado de aprobación/rechazo. Es manual,
  por diseño, hasta que el panel exista. Y **"la cola" no es una tabla
  nueva ni un mecanismo aparte: es literalmente el filtro
  `estado = 'pendiente'` sobre `listings`** — el mismo enum, la misma RLS, sin
  infraestructura adicional.

**Ese párrafo decía "nada de esto tiene todavía un punto de enforcement en
código", y dejó de ser cierto.** Hoy existen la Edge Function
(`moderar-contenido`, que llama de verdad a Vision y OpenAI), los dos triggers de
Storage, y —desde la Ola 3— el alta pasa por `pendiente`: `publicar.ts` crea con
ese estado (obligado por el `with_check` de `20260919000463`) y el veredicto lo
escribe la función, no el cliente. (Este párrafo terminaba diciendo que "lo
único que sigue apagado en PRODUCCIÓN son los dos secretos de Vault de los
triggers": falso desde el 2026-09-19, cuando se crearon — §8, "Hecho".)

**El camino CLIENTE de `moderar-contenido` evalúa UNA vez en la vida de cada
publicación, y nunca dos a la vez** (`20260928000471`,
`listing_moderacion_reclamos`, fix preexistente). El hueco era real, no
teórico: `functions.invoke` va sin timeout, así que un "Reintentar" después de
un fallo EN EL CLIENTE podía correr mientras la primera evaluación seguía viva
en el servidor. Medido en producción (`function_edge_logs`, 2026-09-22, n=13):
cada evaluación tarda de **1.6 a 5.0 s** (p50 2.8 s). En esa ventana pasaban
tres cosas: se pagaba Vision + GPT + Rekognition dos veces, las dos escrituras
competían sin condición (**una `bloqueada` podía quedar pisada por `activa`**,
medido en local con el control negativo del CAS), y un dueño podía llamar la
función por API para re-tirar GPT sobre una publicación que el trigger había
mandado a `pendiente` al editar fotos, auto-aprobándose sin Studio.

- **Compare-and-set en la escritura, en los DOS caminos:** el update de
  `moderarListing()` lleva `.eq('estado', estadoActual)`. Si afecta 0 filas,
  alguien movió el estado durante la evaluación: gana lo ya escrito, y la
  auditoría lo anota (`detalle.descartado_por_carrera`, `estado_propuesto`).
- **El reclamo es UNA fila con DOS estados, y los separa `completada_at`:**
  - `completada_at is null` es un **mutex**. Si la evaluación falla de forma
    manejada (un 500, o algún eje sin evaluar por infraestructura —
    `evaluacionIncompleta()` en `decision.ts`), la función **borra su propio
    reclamo** y el reintento evalúa de inmediato. Si el worker muere sin
    borrarlo, la siguiente llamada lo libera pasados **60 s** (12 veces el
    máximo medido).
  - `completada_at is not null` es la **marca permanente** de que el alta ya se
    evaluó. **Nadie la borra**: el TTL exige `completada_at is null` (sin esa
    condición, a los 60 s se re-evaluaría cualquier alta; es el control
    negativo (d) del probe) y la función no la toca. Solo muere con la
    publicación.
- **Consecuencia operativa:** una publicación que vuelve a `pendiente` por una
  edición de fotos **solo la resuelve Studio**. Ninguna re-evaluación por el
  camino cliente vuelve a estar disponible para ella. Las fotos nuevas SÍ se
  siguen evaluando, por el camino del TRIGGER, que no pasa por el reclamo. Y un
  alta que sale `revisar` por su CONTENIDO también se queda para Studio: un
  reintento ya no re-tira GPT.
- **Por qué no un advisory lock:** la función habla por PostgREST, una
  transacción por request; el lock se soltaría antes de la evaluación. **Por qué
  no un unique en `listing_moderacion`:** es historial por evaluación.
- Cubierto en `probe-moderacion-http.mjs` §8 (concurrencia, marca permanente,
  huérfano, en vuelo, fallo manejado y la carrera del CAS), con cuatro controles
  negativos: sin `completada_at is null` en el TTL → (d); el reclamo que nunca
  bloquea → (a)(b)(d)(e); nunca liberar → (f); sin el CAS → (g). Detalle en
  `.claude/rules/moderacion.md` §5.1c.

---

## 4. Inventario completo de pantallas (73)

Cada pantalla corresponde 1:1 a un `<div class="phone-block" data-cat="...">`
dentro de `relevo-app.html` — el atributo `data-cat` es el mismo agrupador que
usa el filtro visual del prototipo. Para el estado de qué grupo ya existe
como código real (vs. solo diseño), ver §8 y las reglas de `.claude/rules/`.

### Onboarding (17)
Splash · Onboarding 1/3 · Onboarding 2/3 · Onboarding 3/3 · Verificación ·
**Verificación (correo no participante)** ·
Código de verificación · Completar perfil ·
Completar perfil (estado inicial) · Completar perfil (selector de campus) ·
**Intereses** · Permiso de notificaciones ·
Iniciar sesión · Recuperar contraseña · **Código de recuperación** ·
**Nueva contraseña** · **Cuenta eliminada**

**Eran 16: "Selector de universidad" salió con la fase 2A** (`20260924000466`).
La universidad ya no se elige: la asigna el servidor desde el dominio del
correo, y los cuatro frames que la mostraban la pintan fija
(`.select-field.disabled` **sin chevron**, porque no abre nada). Esos cuatro son
Completar perfil, su estado inicial, su selector de campus y Editar perfil. No
se reemplazó por una pantalla de confirmación: sería una pantalla que no decide
nada. De paso, "Completar perfil (estado inicial)" dejó de tener el campus
deshabilitado, porque ya no espera a la universidad. Lo único que falta en ese
estado es lo que el usuario teclea. Y "Completar perfil" ganó una **variante
etiquetada, "sin universidad asignada"**, que no cuenta aparte: la cuenta
creada por llave secreta con un dominio no registrado, con un `.notice` y la
salida "Usar otro correo". Los conteos se midieron sobre el HTML
(`grep -o 'class="phone-block" data-cat="…"' | sort | uniq -c`): 59 en total, 15
de onboarding (al cerrar la fase 2A; hoy son 60, ver Explorar).

Las dos últimas llegaron con RF-04, y son el segundo y tercer paso del reset por
OTP. "Código de recuperación" es casi gemela de "Código de verificación" —misma
`.otp-row`— con una diferencia deliberada: su `.auth-logo` es el candado en
`--forest`, no la "R" en `--ink`. **La identidad visual la marca el FLUJO**, así
que las tres pantallas del reset comparten el candado; quien viera la "R" del alta
a mitad de una recuperación no sabría en cuál de los dos está. Por eso son frames
distintos y no una variante etiquetada.

"Verificación (correo no participante)" llegó con el candado de dominios
(`20260923000465`). Es el mismo frame de "Verificación" con un `.notice` de error
entre el campo y el botón, y es frame y no toast porque es copy persistente (§0
regla 4): el usuario lo lee mientras corrige el correo. Lo pinta el cliente solo
cuando el Auth Hook rechaza el alta; el cliente no decide nada, solo traduce ese
rechazo. En la misma tarea, el placeholder de los tres campos "Correo
institucional" (Verificación, Iniciar sesión, Recuperar contraseña) pasó de
`nombre@estudiante.tec.mx` a `estudiante@institución.mx`: el viejo sugería un
subdominio que el hook rechaza.

### Explorar (21)
Feed · **Feed (sin publicaciones)** · Selector de campus ·
**Selector de campus (detectando ubicación)** ·
**Selector de campus (sin campus cercano)** ·
**Selector de campus (permiso denegado)** ·
**Selector de campus (permiso denegado permanentemente)** ·
**Selector de campus (ubicación desactivada)** ·
**Selector de campus (error de ubicación)** ·
Categoría ·
Categoría sin resultados ·
Ver todas (categorías) · Búsqueda (recomendados) · Búsqueda ·
Búsqueda sin resultados · Filtros · Detalle de publicación ·
**Detalle (vendida)** · Detalle (vista vendedor) ·
Detalle (foto a pantalla completa) · Detalle (foto — cerrando)

"Detalle (vendida)" es el Detalle de una publicación ya vendida vista por quien
NO es su dueño, y cubre **dos espectadores en un solo frame** con el recurso de
variante etiquetada de `.photo-add.is-busy`: el comprador acreditado ve
"Calificar al vendedor"; cualquier otro autenticado ve un `.notice` de "ya se
vendió" en lugar del `.whatsapp-btn` (contactar por algo vendido no tiene
sentido). El dueño no entra aquí — sigue en "Detalle (vista vendedor)", cuyo
`.ghost-btn` cambia de label según el estado de la venta. Vive en `explorar` y
no en `confianza` porque **todos** los estados de Detalle lo hacen, incluido
"vista vendedor": el agrupador sigue a la pantalla, no al tema.

"Detalle (foto — cerrando)" es el gesto de cierre del visor congelado a media
altura — un frame estático no puede animarlo. **Es documentación de un estado
transitorio, no una pantalla en la que la app se quede**, igual que
`.photo-add.is-busy` dentro de "Publicar (procesando fotos)"; se cuenta porque
es un `phone-block` propio y el filtro del prototipo lo cuenta.

**"Feed (sin publicaciones)" llegó con la fase 2B** (navegar el catálogo de
otras universidades), y es el único frame nuevo de esa tarea. Antes, un
alcance vacío pintaba "Recomendado para ti" con el grid en blanco y sin decir
nada; con campus de otras universidades (y campus recién dados de alta) es un
caso del primer día. Su copy **no** dice "sé el primero en publicar": si el
alcance es de otra universidad, ahí no se puede publicar. Todo lo demás de la
fase 2B son cambios o variantes etiquetadas de frames que ya existían, así que
no cuentan aparte:
- el Selector de campus, reescrito y agrupado por universidad, con una variante
  de búsqueda;
- las cuatro lecturas del chip del Feed, en una variante;
- la universidad en la tarjeta (en `.meta`, con la fecha en su propia línea) y
  en Detalle;
- la variante vacía de "Búsqueda (recomendados)";
- el botón de "Categoría sin resultados", que pasó a "Buscar en todas las
  categorías".

**Los seis "Selector de campus (…)" llegaron con la fase 2C** ("Detectar
campus más cercano"): 66 en total, 21 de Explorar, medido con el mismo
`grep | uniq -c`. Son seis y no uno porque cada uno es copy PERSISTENTE que el
usuario puede leer con calma (§0 regla 4) — el único estado del flujo que NO
tiene frame es "campus encontrado", que va por TOAST (la excepción explícita
de esa misma regla): el sheet se cierra de inmediato al elegir un campus,
igual que al tocar una fila a mano, así que un mensaje "leído con calma"
dentro del sheet no tendría tiempo de leerse. Los seis reusan el cuerpo
completo de "Selector de campus" (la lista sigue disponible en todos: nunca se
bloquea al usuario mientras detecta) y componen `.notice`/`.ghost-btn`/
`.splash-dots`, ya existentes — ningún CSS nuevo. Detalle de qué dice cada uno
y por qué, en `explorar.md`.

### Publicar (10)
Publicar · Publicar (procesando fotos) · Publicar (subiendo imágenes) ·
**Publicar (revisando)** · Publicar (error de subida) ·
Publicar (falta teléfono) · Editar publicación · Publicación creada ·
Publicación en revisión · Publicación no aprobada

"Publicar (falta teléfono)" es el quinto estado del MISMO componente, y el único
que se ve ANTES de tocar nada: el campo de WhatsApp aparece solo mientras el
perfil no tenga número guardado (RF-13), y en cuanto se guarda la pantalla
vuelve a ser "Publicar" tal cual. Ver `publicar-fotos.md`.

Las dos últimas llegaron con RF-18 y son **hermanas de "Publicación creada", no
estados suyos**: el cliente ESPERA el veredicto de moderación, así que al
terminar de publicar se navega a UNA de las tres según el estado que devuelve la
Edge Function —aprobada, `pendiente`, `bloqueada`— y ninguna cambia en vivo. Son
frames y no una variante etiquetada porque el usuario se queda en ellas y las lee
con calma; la excepción de los toasts (§0 regla 4) no aplica.

**"Publicación no aprobada" NO ofrece "Editar publicación", y es un límite de la
base, no una elección de copy:** `listings_update_own` excluye `bloqueada` de su
`using`, o sea que ese botón afectaría 0 filas y fallaría sin lanzar. Sobre una
bloqueada al dueño solo le quedan verla y eliminarla.

**"Publicar (revisando)" es un CUARTO estado del MISMO componente de "Publicar
(subiendo imágenes)", decidido después y por separado** —no en la misma tarea
que las dos pantallas de arriba, porque hasta entonces no se había resuelto la
concurrencia de la Edge Function—. Con el cliente esperando el veredicto (RF-18),
para cuando se llama a moderación la subida a Storage YA TERMINÓ, así que dejar
el botón en "Subiendo imágenes" sería literalmente falso — el tipo de etiqueta
que un usuario reporta como "se quedó pegado". Mismo `.primary-btn.is-busy`,
mismo `.splash-dots`, sin CSS nuevo: solo cambia el texto a "Revisando tu
publicación…", elegido para compartir vocabulario con "Publicación en revisión"
(la pantalla a la que puede llegar después) en vez de con un verbo distinto como
"analizando" o "verificando".

**La llamada a moderación puede fallar por su cuenta (4xx/timeout), y ESO no
necesita frame nuevo.** Reusa el patrón visual ya existente de "Publicar (error
de subida)" —que ya representaba una FAMILIA de avisos con textos distintos
según la causa (tamaño, formato) antes de que existiera RF-18—, con un tercer
MOTIVO y su propio copy (`publicar-fotos.md`), no un cuarto frame.

**Ojo con la palabra "determinista", que este párrafo llegó a usar aquí y era
falso.** En este repo `esDeterminista()` no significa "es una causa concreta":
significa **"no vale reintentar"**, y es lo que APAGA el botón (`nueva.tsx`:
`hayDeterminista && !hayTransitorio`). El fallo de moderación es justo lo
contrario —reintentar es la salida—, así que `esDeterminista()` **no cambió** y
el motivo nuevo vive en `falloGeneral`. Son **tres motivos y dos baldes**; el
párrafo viejo hacía leer que eran tres baldes.

### Cuenta (12)
Perfil · **Perfil (ayuda y soporte)** · Editar perfil · **Selector de país** ·
Perfil público · Favoritos · Favoritos vacío · Mis publicaciones ·
Mis publicaciones vacío · Mis publicaciones (acciones) · **Configuración** ·
**Editar intereses**

**"Perfil (ayuda y soporte)" es la hoja de la fila "Ayuda y soporte"**: 73 en
total, 12 de Cuenta, medido con el mismo `grep | uniq -c`. Es Perfil atenuado
con un `.sheet-card` encima (mismo cascarón que "Mis publicaciones (acciones)"):
WhatsApp y Correo, con la dirección de correo como texto debajo de la fila.
Lleva dos variantes etiquetadas que no cuentan aparte, "un solo canal" y
"correo sin app". Detalle en `cuenta-perfil.md`.

**"Intereses" (Onboarding) y "Editar intereses" (Cuenta) llegaron con
`20260930000475`**: 72 en total, 17 de Onboarding y 11 de Cuenta, medido con el
mismo `grep | uniq -c`.
- **"Intereses"** va entre "Completar perfil" y "Permiso de notificaciones", y
  se ve UNA sola vez. Tiene "Continuar" (deshabilitado sin ninguna elegida,
  variante etiquetada) y "Omitir".
- **"Editar intereses"** se abre desde una fila nueva de "Perfil", **"Mis
  intereses"**, entre "Mis publicaciones" y "Editar perfil" (el menú pasó a 6
  filas). No se abre desde Editar perfil: a decisión del usuario, una sola
  puerta.
- Las dos usan la rejilla de 3 de "Ver todas" con un estado nuevo,
  `.cat-item.selected`: el `active` de siempre (--ink / --paper), sin tokens
  nuevos.
- **"Búsqueda (recomendados)" no ganó frame**, solo cambió el título a
  "Recomendados para ti".
  - **Sin texto que explique el orden y sin botón de intereses**, a decisión
    del usuario: tiene que sentirse natural.
  - Sin intereses, es lo más reciente del alcance: no hay estado vacío especial
    ni invitación.

**"Configuración" es la décima, y le da destino al engrane de `.profile-top`
de Perfil, inerte desde que existe la pantalla.** 68 en total, 10 de Cuenta,
medido con el mismo `grep | uniq -c`. Agrupa notificaciones (con sus tres
estados anotados como variantes: concedido/denegado/nunca solicitado),
General (calificar/compartir la app), Legal (privacidad/términos), Soporte
(contacto/versión) y, al final, Eliminar cuenta con el
tratamiento destructivo ya existente (`.status-row-text.danger`) — sin
separador punteado nuevo: esa línea en el archivo se usa solo para anotar
variantes de documentación, nunca como zona real de UI, así que la separación
de "Soporte"/"Eliminar cuenta" es de espaciado, no de una línea. **"Cerrar
sesión" NO está aquí: se mudó en `3752e7b` y se revirtió al `.menu-list` de
"Perfil", que volvió a sus 5 filas** (Mis publicaciones, Editar perfil,
Verificación, Ayuda y soporte, Cerrar sesión; hoy 6, con "Mis intereses" desde
`20260930000475`). El motivo de la reversión —el
`<Redirect>` de `(tabs)/_layout.tsx` no redirige mientras `(tabs)` está
tapado— ya lo cerró el guard global de "Eliminar cuenta" (§9); "Cerrar sesión"
se queda en Perfil porque ahí es donde vive en el frame, no por el guard.
"Eliminar cuenta" SÍ funciona desde aquí: abre "Confirmar eliminar cuenta"
(Sistema).
El FRAME muestra todas las filas; el código solo pinta las que funcionan hoy
(`filaVisible()`, `src/lib/configuracion.ts`) — detalle completo en
`cuenta-perfil.md`.

**"Selector de país" llegó con `20260927000470`** (WhatsApp de cualquier país):
67 en total, 9 de Cuenta, medido con el mismo `grep | uniq -c`. Es el bottom
sheet que abre `.phone-country` desde "Editar perfil" y desde "Publicar (falta
teléfono)"; vive en Cuenta porque el teléfono es dato del perfil. Mismo
esqueleto que "Completar perfil (selector de campus)", sin CSS nuevo. El campo
cambió en los dos frames que lo tienen (el `+52` inerte pasó a botón "MX +52 ⌄",
sin bandera emoji; ver §3), y ganó la variante etiquetada "número no válido",
que no cuenta aparte. La variante "nombre no válido" de "Completar perfil" y
"Editar perfil" (`20260927000469`) tampoco cuenta.

**RF-18 no agregó ninguna aquí, y el avatar rechazado es el caso que parece que
debería.** No lleva frame porque su estado resultante YA existe: el enforcement
de avatares es binario —solo `VERY_LIKELY` borra— y borrar significa objeto
fuera y `foto_url` en null, o sea el fallback a iniciales que `Avatar` ya pinta.
No hay estado intermedio que dibujar porque no hay dónde guardarlo (§3).
**El aviso YA EXISTE desde RF-18 Ola 4 (2026-09-21), y SIGUE sin agregar
pantalla.** Este párrafo decía que quedaba abierto: el borrado ocurre después,
por el trigger de Storage, cuando el usuario ya vio su foto puesta, así que se
enteraba solo porque en algún momento volvía a ver sus iniciales. Hoy Perfil
detecta la transición —`foto_url` a `null` solo lo produce `moderarAvatar()`, el
cliente jamás la nulifica— y avisa con un **toast**, que es la excepción
explícita de §0 regla 4 y por eso no pidió frame. **Lo que sigue abierto es más
chico y es el límite del toast:** si el usuario no abre Perfil, o no lo ve, no
queda rastro. Eso sí exigiría un aviso persistente —frame primero, más dónde
guardar el "ya se lo dijimos"—, y está como deuda con disparador en
`cuenta-perfil.md`.

### Confianza (4)
Reportar publicación · Calificar · ¿A quién le vendiste? ·
¿A quién le vendiste? (sin contactos)

El vacío NO es un caso borde: nadie está obligado a tocar "Contactar por
WhatsApp" antes de que el vendedor marque la venta —pudo acordarse en persona, o
el registro del contacto pudo fallar (`confianza-ventas.md`, la deuda del log perdido)—, así que se
alcanza el primer día. Como "Notificaciones vacío", no lleva `.empty-actions`:
la única acción posible ya está en el `.sticky-cta`, que se conserva intacto —
la publicación SÍ se marca como vendida desde ahí; lo único que no ocurre es la
calificación, porque no hay a quién calificar.

**El modo corrección ("Cambiar comprador") NO es una pantalla más**: es el mismo
frame "¿A quién le vendiste?" con el comprador actual preseleccionado, el CTA
diciendo "Guardar cambio" y la salida "No fue a través de Relevo" escondida
(deshacer una venta registrada no está soportado). Va como variante etiquetada
dentro de ese frame, no cuenta aparte.

### Notificaciones (2)
Notificaciones · Notificaciones vacío

"Notificaciones vacío" se agregó al construir RF-16 y **no es un caso borde**:
toda cuenta nueva abre el inbox así el día uno, porque las notificaciones solo
nacen de eventos que todavía no ocurrieron. A diferencia de "Favoritos vacío" y
"Mis publicaciones vacío" no lleva `.empty-actions`: no hay nada que el usuario
pueda hacer para llenarlo —depende de terceros— y la única acción posible sería
volver, que ya es el chevron del header.

**RF-16 tanda 2 no agregó frames: agregó FILAS al frame "Notificaciones"**
(`20260928000472`/`473`), así que los 67 siguen siendo 67 (medido con el mismo
`grep | uniq -c`). Son seis filas nuevas para cinco tipos: la de
`publicacion_bloqueada` tiene dos variantes de copy, "no fue aprobada" y
"Retiramos tu publicación". Tinte e ícono por tipo, y el copy exacto que
materializa la base. El `sub` de "Notificaciones vacío" pasó a resumir por
familia ("de tus favoritos, de la revisión de tus publicaciones, de las
calificaciones que recibas y de tus reportes") en vez de nombrar solo precio y
reporte. Los íconos de las filas nuevas reusan los componentes existentes
(`IconCheckCircle`, `IconStar`, `IconTag`) y suman `IconBan` e `IconUser`: el
path de la etiqueta y de la estrella del frame se alinearon a los de esos
componentes, para no tener dos formas del mismo ícono.

### Sistema (7)
Confirmar eliminar · Confirmar cerrar sesión · **Confirmar eliminar cuenta** ·
Error de conexión · Toast de éxito · Toast de error · Loading / skeleton

**"Confirmar eliminar cuenta" y "Cuenta eliminada" (Onboarding) llegaron con
"Eliminar cuenta" (`20260929000474`)**: 70 en total, 7 de Sistema y 16 de
Onboarding, medido con el mismo `grep | uniq -c`. La confirmación es el MISMO
shell que "Confirmar eliminar"/"Confirmar cerrar sesión" (`.modal-card`) con una
sola pieza más, el campo de contraseña, que ES la confirmación. Se probó primero
como pantalla completa con la lista de qué se borra y qué se conserva, y se
descartó a decisión del usuario: eso lo explica el aviso de privacidad, no el
modal. Sus errores (contraseña incorrecta, sin conexión, fallo del servidor) son
variantes etiquetadas DENTRO del modal, porque son copy persistente (§0 regla
4). "Cuenta eliminada" vive en Onboarding porque ya no hay sesión. Dos variantes
más, que no cuentan aparte: la reseña "Usuario eliminado" en "Perfil público"
(ícono de persona, nombre en `--ink-soft`, sin comentario) y "correo bloqueado"
en "Verificación (correo no participante)".

---

## 5. Flujos que no son obvios solo viendo las pantallas

- **Verificación → acceso**: correo institucional (OTP passwordless) →
  código → completar perfil (nombre y campus, y aquí se fija la contraseña;
  la universidad ya viene puesta, ver abajo) → permiso de notificaciones →
  Feed. La sesión ya existe desde
  que se verifica el OTP — es el equivalente de
  `supabase.auth.signInWithOtp({ email })` seguido de la verificación del
  código — y no depende de la contraseña. Esa contraseña, fijada después en
  "Completar perfil", no autentica el registro: habilita el login posterior
  por correo/contraseña (RF-02) para cuando el usuario vuelva a abrir la app.
  La universidad NO se elige: la asigna el servidor al crear la cuenta, a
  partir del dominio del correo (`20260924000466`, §3), y Completar perfil solo
  la muestra fija. El campus sí se elige, y solo entre los de esa universidad.
  Los dos determinan qué catálogo ve el usuario de ahí en adelante.
- **Marcar como vendida → calificación**: como no hay chat interno, el vendedor
  no sabe automáticamente quién compró. Se resuelve con la tabla
  `listing_contacts`: al tocar "Marcar como vendida", se le muestra al
  vendedor la lista de usuarios que tocaron "Contactar por WhatsApp" en esa
  publicación, para que elija quién se la llevó (o "No fue a través de
  Relevo"). Esa selección dispara la pantalla de Calificar con el nombre real
  de esa persona. **El COMPRADOR ya no depende de llegar ahí por su cuenta: la
  próxima vez que abre o retoma la app, si tiene una compra pendiente de
  calificar, "Calificar" se le abre sola — una sola vez por sesión, y solo la
  más reciente si hay varias (detalle completo y la regla exacta de
  "pendiente" en `confianza-ventas.md`).**
- **El único selector que queda es el de campus, y tiene dos usos distintos.**
  "Selector de universidad" ya no existe: salió del flujo y del HTML cuando la
  universidad pasó a asignarla el servidor desde el dominio del correo
  (`20260924000466`).
  - En Completar perfil y Editar perfil, el bottom sheet de campus FIJA el
    campus del perfil, dentro de su universidad.
  - En el Feed, "Selector de campus" (bottom sheet, ligero) cambia qué catálogo
    se MIRA sin tocar el perfil. Desde la fase 2B navega TODO el catálogo, en
    tres niveles de alcance: un campus (de cualquier universidad), una
    universidad entera o todas. Lo siguen el Feed, Búsqueda y Categoría; no lo
    siguen Favoritos ni Mis publicaciones. Arranca en el campus del perfil y la
    elección dura la sesión. Publicar sigue naciendo en el campus del perfil.
    Detalle en `explorar.md`.
- **El buscador de Feed y el de Búsqueda se ven idénticos pero se comportan
  distinto — no es un bug, es la intención.** En Feed es un punto de entrada,
  **no editable**: tocar en cualquier parte navega directo a Búsqueda en su
  estado "recomendados" (Pressable, no TextInput). En Búsqueda sí es un
  TextInput real que abre teclado y filtra. Ya se intentó "arreglar" esto una
  vez convirtiendo el de Feed en editable — era un regreso a un estado
  incorrecto, no una mejora; si algo similar se propone de nuevo, es la señal
  de que se está confundiendo con Búsqueda.
- **Búsqueda tiene tres estados, no tres pantallas separadas en producción**:
  "recomendados" (sin query — lo que ves al tocar el tab Buscar o "Ver todo"
  desde el Feed), "con resultados" (chips de filtro activo + contador), y
  "sin resultados" (mismo componente, otro estado). Mismo patrón para
  Categoría: 2 estados (con resultados / sin resultados), un solo componente.
- **`anon` no tiene ni un solo grant en el proyecto remoto** — todo está
  concedido a `authenticated`. Esto significa que el Feed no puede renderizar
  nada antes del login: el auth gating decide qué pantalla se muestra según
  haya o no sesión activa (ya implementado, ver `onboarding-auth.md`).

---

## 6. Cómo pedirle trabajo a la IA en este repo

- Pide **tokens antes que pantallas**: extraer `theme.ts` del CSS antes de
  construir el primer componente.
- Ve **pantalla por pantalla, por grupo (`data-cat`)**, no "constrúyeme la
  app" — con 73 pantallas, pedir todo junto es la forma más segura de que
  algo se desvíe del diseño.
- Separa **UI de datos en dos pasos**: primero el componente con datos de
  prueba fiel al frame del HTML, después la conexión a Supabase con RLS. Es
  el patrón que ya siguieron Onboarding y Explorar — antes de empezar el
  siguiente grupo, revisa el **inventario de componentes de §8** para no
  reconstruir los que ya existen (`ProductCard`, `SheetScreen`, `Field`,
  `ConfirmModal`, etc.), y la regla de ese grupo en `.claude/rules/` para el
  porqué de cada uno. Ese inventario está en la raíz a propósito: las reglas
  por feature no cargan hasta que tocas sus archivos, así que no sirven para
  saber qué existe ANTES de empezar.
- Si vas a agregar una pantalla o estado que no existe en `relevo-app.html`
  (por ejemplo, un caso borde nuevo), constrúyelo ahí primero.
- **Para cualquier trabajo de esquema/RLS/backend, usa Plan Mode y aprueba
  por fases chicas**, no un plan que cubra varias tablas o varios flujos a la
  vez. El esquema actual pasó por 5 rondas de revisión de plan antes de
  ejecutarse — cada ronda encontró un hueco de seguridad real. Ninguno era
  visible con solo "que compile" — se necesitó revisión deliberada.
- **Los nombres de migración (`YYYYMMDDNNNNNN_…`) NO son timestamps reales de
  generación.** Son un CONSECUTIVO con formato de fecha: la fecha más un número
  de seis dígitos que sube de uno en uno (`…000466`, `…000467`, `…000468`).
  `000467` leído como hora serían 00:04 con 67 segundos, que no existe. Por eso
  un archivo nuevo se crea con `supabase migration new <nombre>` y **se renombra
  al siguiente consecutivo**, con una fecha mayor o igual que la última. El
  nombre que da el comando (la hora real) puede ordenar ANTES de una migración ya
  aplicada en remoto. Pasó el 2026-09-24: generó `20260924065508_…`, que
  quedaba detrás de `20260925000467`.
- Para tareas de backend en particular: **valida en local con Docker antes de
  aplicar a remoto**, y prueba como el rol `authenticated` real, no como
  `postgres`/superusuario. Son DOCE pasos, no uno (decía "ONCE" antes de la
  Ola 2 del panel, "DIEZ" antes del panel de admin, "NUEVE" antes de eliminar cuenta, y "SIETE" con ocho en la
  lista):
  1. `psql -f supabase/tests/rls.sql` — las policies, por SQL.
     **`psql` puede no estar instalado en la máquina** (no lo está en la de
     desarrollo actual, aunque este comando lo dé por supuesto). El contenedor
     de Postgres sí lo trae, y es la forma que de verdad funciona:
     `docker exec -i supabase_db_relevo-marketplace psql -v ON_ERROR_STOP=1
     -U postgres -d postgres < supabase/tests/rls.sql` — que es, además, lo que
     ya dice la cabecera de `rls.sql`.
  2. `node scripts/probe-storage.mjs` — lo que la suite SQL no puede ver de los
     buckets: `DELETE` (el trigger `storage.protect_delete` aborta antes que la
     RLS), `move` (el `with_check` de UPDATE en `listing-photos`; la ausencia de
     policy de UPDATE en `avatars`) y, para el bucket público, que se sirva sin
     autenticación y que `anon` NO pueda enumerarlo.
  3. `node scripts/probe-venta.mjs` — el amarre entre `congelada()`
     (`src/lib/confianza.ts`) y el `using` de `listing_sales_update_seller`: la
     MISMA condición escrita en dos runtimes, que al desincronizarse no da
     ningún error y solo esconde la única salida del vendedor (§3). Ejecuta los
     dos lados contra el mismo estado, en tres escenarios (califica el comprador
     → sigue corregible; califica el vendedor → congelado; y la misma condición
     por la ruta del COMPRADOR, en las dos polaridades), más un tripwire que lee
     el fuente de `congelada()`. **El tripwire y el escenario 3 NO son
     redundantes** — uno vigila el cableado y el otro la lógica, y §3 explica
     por qué borrar cualquiera deja un hueco medido.
  4. `node scripts/probe-moderacion.mjs` — todo lo PURO de RF-18: los umbrales
     (la función de decisión y la lista de palabras), el particionado de fotos
     para Vision, el schema/parseo de OpenAI, y el eje de **Rekognition**: su
     techo, la banda 50-70 que se registra sin actuar, y **la firma SigV4
     contra los vectores oficiales de AWS**. **No necesita el stack local**
     (el paso 5 tampoco): las piezas que prueba son puras a propósito, sin red
     ni Supabase, y por eso corre en menos de un segundo.
     Y es el único que importa la implementación **REAL** en vez de
     transcribirla: los cinco módulos que cubre
     (`supabase/functions/moderar-contenido/{decision,palabras-prohibidas,vision,openai,rekognition}.ts`)
     no importan nada fuera de `decision.ts`, así que Node los carga directo
     (type stripping, v22.6+).
     **El firmador SigV4 es la excepción deliberada a "el `fetch` vive en
     `index.ts`"**: no usa `fetch` ni nada Deno-only, solo `crypto.subtle`, que
     Node también tiene — y ponerlo del lado puro es lo ÚNICO que permite
     verificarlo contra los vectores de AWS. Se descartó `npm:aws4fetch` por
     eso: con una librería la firma no tiene cobertura a ningún precio, y un
     bug de firma se manifiesta como un **403 opaco**, indistinguible de una
     credencial mal puesta o una región equivocada. **Ese "no importan nada" es la precondición, no
     una casualidad:** `vision.ts` y `openai.ts` existen separados de `index.ts`
     justamente para que el `fetch`, la descarga de Storage y el `encodeBase64`
     —lo Deno-only— queden del otro lado de la línea y no arrastren el resto a
     ser inverificable.
     Es justo lo que `probe-venta.mjs` NO puede hacer con `congelada()`, y por
     eso aquel necesita además un tripwire sobre el fuente y este no. Si alguien
     le mete un import de Supabase a `decision.ts`, este script deja de arrancar
     — esa es la señal, no un inconveniente.
  5. `npm run check:functions` — los TIPOS de `supabase/functions`, que el
     `npx tsc --noEmit` de la app **no mira**: el `tsconfig.json` de la raíz
     excluye esa carpeta porque es Deno, y eso la dejaba sin ningún compilador
     (el caso general, con su medición, está en §9). No sustituye al paso 4 ni
     al revés: el compilador mira formas, el probe mira decisiones —
     `decidirListing({…todo limpio}, 'pausada')` typechea perfecto y devolver
     `'activa'` sería el bug—. Tampoco necesita el stack local.
  6. `node scripts/probe-moderacion-http.mjs` — la Edge Function
     `moderar-contenido` por HTTP: las CINCO credenciales (las cuatro de
     `send-push` más el JWT de usuario, que es la razón de ser de
     `auth: ['secret','user']`), el ownership del camino de usuario, y que la
     escritura de estado + auditoría esté cableada. **Es el único que necesita
     DOS procesos**: además del stack, `supabase functions serve --env-file
     supabase/functions/.env` en otra terminal. No confundirlo con el paso 4:
     aquel prueba DECISIONES sin red, éste prueba CABLEADO contra la función de
     verdad, y ninguno sustituye al otro. Su primera corrida encontró un bug
     real (§9, `userClaims.id` vs `.sub`), que es la mejor justificación de por
     qué el paso 4 no bastaba.
     **Desde la Ola 1.5 (`evaluarListing()` llama de verdad a Vision/OpenAI)
     este paso YA NO ES GRATIS**: no hay modo "seco" en `index.ts`, así que
     cada corrida dispara requests reales a las dos APIs, aunque el objetivo
     del test sea solo autorización. Necesita los DOS secretos puestos en
     `supabase/functions/.env` y el contenido de prueba tiene que ser
     genuinamente limpio y VERIFICADO —no texto al azar: un título sin sentido
     le dio a GPT un veredicto no determinista entre corridas, medido
     (`.claude/rules/moderacion.md` §6.3).
  7. `node scripts/probe-registro.mjs`: el Auth Hook de dominios contra GoTrue
     local. Cubre lo que T27 no puede ver: que el hook esté cableado, que la
     policy de `supabase_auth_admin` deje leer, que un rechazo no deje fila ni
     correo (lo lee de Mailpit, `:54324`), que login y recuperación de una cuenta
     existente de dominio no permitido sigan funcionando, y que el admin API NO
     pasa por el hook. Importa `src/lib/registro.ts`, que es el amarre entre el
     código de rechazo de SQL y el que reconoce el cliente.
     **Necesita el hook ACTIVO en `config.toml`**: cambiarlo exige
     `supabase stop && supabase start`, porque `db reset` no recarga la config de
     Auth. Imprime al arrancar los dominios, las policies y las variables
     `GOTRUE_HOOK_*` del contenedor, para que se vea contra qué estado corre.
  8. `node scripts/probe-ubicacion.mjs`: TODO lo puro de "Detectar campus más
     cercano" (fase 2C) — haversine y `campusMasCercano()`
     (`src/lib/ubicacion.ts`). Mismo criterio que el paso 4: no necesita el
     stack local, ni red, ni credenciales, porque el módulo es puro a
     propósito (sin imports). Lo que NO cubre —permisos, servicios de
     ubicación, el `require()` protegido— vive en `src/lib/geolocalizacion.ts`
     y no tiene probe: depende del módulo nativo real, así que se verifica a
     mano en dispositivo (§6 de este mismo bloque, "para bugs de UI...").
  9. `node scripts/probe-perfil.mjs`: el amarre entre `src/lib/validacion-perfil.ts`
     y los checks `users_nombre_valido` y `users_telefono_e164` (y, del
     teléfono, la inclusión cliente ⊆ base con el ejemplo de los 245 países y
     que `src/lib/paises.ts` coincida con la metadata). La regla está escrita dos veces (SQL y
     TS), y desincronizada no falla nada: el usuario ve un botón habilitado y
     un rechazo crudo, o un error sobre un nombre que la base aceptaba. Corre los
     casos de T31 y más contra el check real, compara el veredicto del cliente
     con el de la base sobre lo que el cliente MANDARÍA (el normalizado), y
     busca `CLASE_LETRA` y las cotas literales en la definición viva. Del
     teléfono, sus controles —quitar la regla de México del gemelo TS, quitarle
     el gemelo a `telefonoValido()`, cambiar una lada de `paises.ts`— caen cada
     uno en su check. Importa la
     implementación REAL (el módulo no tiene imports). Todo en un
     `begin … rollback`, así que no deja estado. Sus controles —desincronizar la
     clase, la cota, quitar el NFC o el colapso de espacios— caen cada uno en
     su caso.
  10. `node scripts/probe-eliminar-cuenta.mjs`: la Edge Function
     `eliminar-cuenta` por HTTP. Igual que el paso 6, **necesita DOS procesos**
     (stack + `supabase functions serve --env-file supabase/functions/.env`),
     pero es gratis: sin llamadas a terceros, y los triggers de Storage no
     llaman a nada en local mientras Vault no tenga los secretos de moderación
     (el probe lo imprime al arrancar). Importa la decisión PURA de la ventana
     de reautenticación (`reautenticacion.ts`, sin imports) para probar los
     bordes de 5 minutos sin esperarlos, y por HTTP: quién entra, que el body no
     elige a quién se borra, 0 objetos en Storage y 0 filas en `auth.users`
     tras el borrado, la reseña anónima con sus estrellas y el promedio
     intacto, y que reintentar da 200. Sus cuatro controles (sin chequeo de
     `amr`, uid del body, sin Storage, 404 como error) caen cada uno en su caso.
     No repite la semántica de la base: eso es T33.
  11. `node scripts/probe-admin.mjs`: el panel de admin (RF-17) contra GoTrue,
     PostgREST y Mailpit locales. Lo que T35 no puede ver porque allá los claims
     se fabrican: el `aal`/`amr` REAL que emite GoTrue (el refresh conserva el
     timestamp del TOTP y re-verificar lo renueva), que `/invite` pasa por el
     hook y `/admin/users` no, el alta, la activación y la desactivación de
     `crear-admin.mjs` (importado REAL, también por el camino `--remoto` con la
     conexión apuntada al stack local), el reset de contraseña de un admin, que `admin` esté
     expuesto por PostgREST, y el amarre del clasificador de rechazos del
     panel (`admin/src/lib/rechazos.ts`) con los mensajes de la base. Necesita
     TOTP encendido y `admin` en `[api] schemas`. Tarda unos minutos por las
     esperas de ventana TOTP. Del lado del código, `npm run check:admin` hace
     el typecheck y el lint del panel, que el `tsc` y el `lint` de la raíz no
     miran. **83 pruebas** (47 en la Ola 2): el caso 7c exige que todo `raise`
     de `admin.*` (leído del `pg_proc` vivo) tenga un texto decidido en
     `rechazos.ts`, propio o el genérico a propósito. El caso 8 cubre el camino
     `--remoto` (ref equivocado, preflight que falla, compensación con
     `correos_bloqueados` intacta, `desactivar`, `activar` posterior a la
     desactivación, fuga de credenciales con centinelas, correo en MAYÚSCULAS
     con `lower()` en las 6 comparaciones) y el 9, los correos externos
     (`--correo-externo`, confirmación, dominio universitario, cuenta
     existente, formato). Sus controles negativos caen cada uno en su caso.
  12. `node scripts/probe-puerta-totp.mjs`: la puerta única del modal de TOTP
     del panel (`admin/src/lib/puerta-totp.ts`, importada REAL). Reproduce el
     bug que corrigió (el patrón viejo de `App.tsx`: dos llamadas concurrentes
     dejaban la primera colgada) y prueba que con la puerta N llamadas abren
     un modal y terminan todas (11 pruebas). No necesita nada. (Y `probe-storage.mjs`, el
     paso 2, cubre desde la Ola 2 la policy de Storage del admin por HTTP, con
     un token ES256 forjado con la llave local de GoTrue para el TOTP
     vencido; por eso se niega a correr fuera de localhost.)
  Los probes 2, 3, 6, 7, 9, 10 y 11 necesitan el stack local arriba y limpian lo suyo (el
  9, con un rollback); si una corrida muere de golpe, `supabase db reset` borra la basura.
  Los pasos 4, 5, 8 y 12 no necesitan nada: ni stack, ni red, ni credenciales.

  **`scripts/probe-moderacion-red.mjs` NO es un séptimo paso rutinario** —
  cubre particionado real (>6 MB), descarga fallida de una foto suelta y el
  no-op write, y se corre a mano cuando se toca `vision.ts`, `openai.ts` o
  `evaluarListing()`, no en cada cambio de schema/RLS. Detalle completo,
  incluidos los casos de falla real de Vision/OpenAI que se verificaron a
  mano (sin script permanente, por qué), en `.claude/rules/moderacion.md` §6.3.
  **`scripts/probe-moderacion-avatares.mjs`, mismo criterio, para
  `moderarAvatar()`** — pero con un requisito extra: necesita `ENDPOINT_VISION`
  apuntado temporalmente a un mock local (mismo motivo que declinar imágenes
  reales para el umbral `LIKELY`/`VERY_LIKELY`, ver `.claude/rules/moderacion.md`
  §6.3), así que no corre contra un `functions serve` normal sin editar el
  fuente primero. Procedimiento exacto y los tres casos, en §6.4 del mismo
  archivo.
- **Para bugs de UI que dependen de interacción real (teclado, gestos, touch),
  el simulador headless de Claude Code no siempre puede confirmarlos** — no
  dispara `keyboardDidShow` ni simula touch. Cuando reporte "no pude
  verificarlo, pero el patrón es el estándar", trátalo como pendiente real de
  que tú lo confirmes con tus propios dedos, no como hecho.
- **Ojo con navegación anidada y `presentation` de Stack** (ver sección 9):
  una ruta con `presentation:'transparentModal'` declarada en un Stack
  anidado no funciona si el Stack padre ya presenta esa ruta como card
  opaca — la presentación se declara en el Stack que de verdad ejecuta la
  transición, no en el que "parece" dueño de la ruta.

---

## 7. Skills de IA instalados en este repo

Skills a nivel de proyecto en `.agents/skills/` (symlinked a `.claude/skills/`
y `.cursor/`, según el agente). Se instalan con la CLI genérica `npx skills`,
así que funcionan igual en Claude Code y en Cursor.

| Skill | Cubre | Por qué está aquí |
|---|---|---|
| `expo-native-ui` | HIG de Apple, SF Symbols, animaciones, layout nativo con Expo Router | Traduce el diseño de `relevo-app.html` a componentes que se sientan nativos, no solo "web dentro de un WebView" |
| `supabase` | Database, Auth, Edge Functions, Realtime, Storage, CLI/MCP, debugging de RLS | Todo el backend vive en Supabase — sin esto, Claude no conoce los patrones correctos de Auth/RLS/Edge Functions |
| `supabase-postgres-best-practices` | Diseño de esquema, migraciones, RLS, índices, tuning de queries | RLS en todas las tablas es un principio no negociable (sección 1) — este skill enseña a implementarlo bien, no solo a que exista |
| `vercel-react-native-skills` | Performance de listas, animaciones, navegación, módulos nativos | El feed usa scroll infinito (RNF-01, <2s en 4G) — este skill cubre la arquitectura de performance que `expo-native-ui` no toca |

**Cómo se instalaron** (para reproducir en otra máquina o documentar el porqué
si cambia el set):

```bash
npx skills add expo/skills --skill expo-native-ui
npx skills add supabase/agent-skills
npx skills add sudokoi/vercel-react-native-skills
```

**MCP de Supabase** también conectado (`claude mcp add supabase`, autenticado
vía Personal Access Token) — permite crear/administrar el proyecto remoto y
ejecutar SQL directo desde el chat. Usarlo con la misma cautela que cualquier
acceso de escritura a producción: SQL de solo lectura (`select`) se puede
aprobar con confianza, cualquier `insert`/`update`/`delete` fuera de una
migración versionada debe revisarse antes de aprobar.

**Regla de precedencia entre skills** (ver también sección 0, regla 6):
cuando dos skills sugieran patrones distintos para lo mismo (ej. un patrón de
navegación), gana primero `/design/relevo-app.html`, luego `/docs/product-spec.md`,
y solo al final las convenciones genéricas de los skills.

---

## 8. Estado de implementación — y dónde vive el detalle

**El detalle por feature ya no vive en este archivo.** Se movió íntegro (sin
resumir ni recortar) a `.claude/rules/`, donde cada regla declara un `paths:` y
**carga sola cuando la sesión lee alguno de esos archivos**. Lo transversal se
quedó aquí: tokens (§2), esquema y RLS (§3), inventario de pantallas (§4),
cómo pedir trabajo (§6) y los gotchas (§9) — este archivo carga siempre.

**Ojo con los `paths:`:** un patrón que no machea **no da ningún error**, la
regla simplemente no carga nunca. Valida cualquier `paths:` nuevo contra un
archivo real antes de darlo por bueno (ver el gotcha de §9 sobre los paréntesis
de los route groups).

| Regla | Cubre | Dispara al tocar |
|---|---|---|
| `onboarding-auth.md` | Onboarding, OTP, gating de sesión, RF-04, registro por dominio | `src/app/(onboarding)/**`, `src/lib/session.tsx`, `src/lib/supabase.ts`, `src/lib/registro.ts`, `scripts/probe-registro.mjs` |
| `explorar.md` | Feed, Búsqueda, Categoría, Detalle, favoritos | `src/app/(explorar)/**`, `(tabs)/index.tsx`, `(tabs)/buscar.tsx`, `src/lib/listings.ts` |
| `publicar-fotos.md` | Publicar atómico, fotos, bucket de Storage | `src/app/(publicar)/**`, `src/lib/{publicar,storage,foto-picker,listing-form}.ts` |
| `cuenta-perfil.md` | Mis publicaciones, Favoritos, Perfil, Editar perfil, Perfil público, RF-13 | `src/app/(cuenta)/**`, `(tabs)/perfil.tsx`, `(tabs)/favoritos.tsx`, `src/lib/perfil*.ts` |
| `confianza-ventas.md` | Venta, ¿a quién le vendiste?, Calificar, Reportar | `src/app/(confianza)/**`, `src/app/reportar/**`, `src/lib/confianza.ts` |
| `notificaciones-push.md` | Inbox, push, Edge Function `send-push` | `src/app/(notificaciones)/**`, `src/lib/{notificaciones,push}.ts`, `supabase/functions/**` |
| `moderacion.md` | Moderación pre-publicación (RF-18): Edge Function `moderar-contenido`, los dos triggers de Storage, rework de `publicar.ts`, Realtime | `supabase/functions/moderar-contenido/**`, `scripts/probe-moderacion*.mjs`, `src/lib/{publicar,storage}.ts`, `src/app/(publicar)/**` |
| `componentes-compartidos.md` | Qué componente existe ya y qué NO unificar | `src/components/**` |
| `compartir-deeplinks.md` | Compartir sin link (las dos pantallas) | `detalle/**`, `perfil-publico/**`, `app.json` |

**Hecho:**
- Esquema aplicado al proyecto remoto (`ukxfnydfhmryrzhdqkvj`, us-east-1) con RLS y la
  suite de regresión pasando.
  **Esta línea ya NO lleva números, y es a propósito.** Llevaba "8 migraciones /
  53 aserciones", luego "10 / 64", luego "16 / 108" — siempre desincronizada, y
  siempre descubierta tarde. Los conteos se MIDEN, no se recuerdan:
  `ls supabase/migrations | wc -l` para las migraciones del repo,
  `mcp__supabase__list_migrations` para las que de verdad están en remoto (que
  pueden ser menos: una recién escrita no viaja hasta el `db push`), y
  `grep -cE '^\s*select pg_temp\.(assert|expect_error)\('` sobre
  `supabase/tests/rls.sql` para las aserciones. Si un número de la prosa discrepa
  del comando, **gana el comando** y se corrige la prosa en el mismo cambio.
- Seed de datos de referencia (12 categorías, Tec de Monterrey / campus
  Monterrey) aplicado en remoto vía `db push --include-seed`. `seed.sql` es
  idempotente (`on conflict do nothing`).
- Cliente conectado: `@supabase/supabase-js` con sesión cifrada
  (`src/lib/supabase.ts`, patrón `LargeSecureStore` — AES-256 vía
  `expo-crypto`, llave en `expo-secure-store`, ciphertext en AsyncStorage
  porque `SecureStore` rechaza payloads >~2KB). `detectSessionInUrl: false`
  porque no hay URL de navegador que parsear en React Native.
- Tipos de TypeScript generados del esquema real (`src/lib/database.types.ts`,
  `npm run gen:types`) — solo `schema public`, `private` queda fuera a
  propósito.
- Variables de entorno: `.env.local` (real, ignorado) + `.env.example`
  (commiteado, vacío).
- **RF-18 (moderación pre-publicación) EN PRODUCCIÓN (2026-09-19).** Los cuatro
  pasos manuales del runbook —Edge Function desplegada, sus dos credenciales,
  la migración del `with_check`, los dos secretos de Vault— están dados, y los
  cuatro se remidieron contra remoto en vez de darse por hechos de memoria:
  - `mcp__supabase__list_edge_functions` → `moderar-contenido` **ACTIVE**,
    `version: 1` *(ese número es de ESA fecha; hoy va en `version: 5` — ver la
    entrada de Rekognition más abajo. La versión se remide, no se cita de aquí)*.
  - `mcp__supabase__list_migrations` da **27**, igual que
    `ls supabase/migrations | wc -l` en el repo (**27**) — a la par, incluida
    `20260919000463`.
  - `select count(*) from vault.secrets where name like 'moderar_contenido_%'`
    → **2** (`moderar_contenido_function_url`, `moderar_contenido_secret_key`).
  - **Probado end-to-end en remoto desde el dev build, los DOS veredictos**:
    una publicación de contenido limpio quedó `activa`; una con una palabra de
    la lista quedó `bloqueada`. Confirmado en Studio.
  Con esto, `private.notify_moderacion()` deja de levantar el `warning` que
  documentaba §8 más abajo: los triggers de Storage disparan de verdad contra
  la función real. La deuda de costo (Editar sigue pagando 10 requests por 5
  fotos reemplazadas, `.claude/rules/moderacion.md` §7/§9) sigue abierta, sin
  relación con que esto ya esté en producción.

- **Rekognition EN PRODUCCIÓN (2026-09-22), el quinto eje de RF-18.** Desplegado
  con `supabase functions deploy moderar-contenido` —paso manual, porque **este
  repo no tiene CI/CD** (ni `.github/workflows` ni nada: el push a `main` no
  despliega nunca)— y remedido contra remoto en vez de darse por hecho:
  - `mcp__supabase__list_edge_functions` → `moderar-contenido` **ACTIVE**,
    **`version: 5`**, actualizada el 2026-09-22.
  - El fuente DESPLEGADO sí trae el eje: `DetectModerationLabels`,
    `firmarSigV4`, `evaluarRekognition`, "Los cinco ejes" — y **cero**
    marcadores del código anterior (`evaluarFotos(db, config`, "Los cuatro
    ejes"). Bajado y grepeado, no inspeccionado de config.
  - `list_migrations` da **27**, igual que `ls supabase/migrations | wc -l`
    (**27**): esta tarea no agregó ninguna migración, como estaba previsto.
  - **Probado a mano en producción**, y las pruebas dieron más de lo que
    buscaban: una foto de alcohol escaló a `pendiente` con `Alcohol` @99.9 sin
    bloquear (el techo, contra dato real), apareció el primer falso positivo
    medido (`Silla gamer` → `Alcohol` @95.7) y, sobre todo, salió la
    **limitación de falsos negativos** que documenta
    `.claude/rules/moderacion.md` §8b: 3 de 6 (n=6) evadieron el eje de imagen.

- **Registro restringido a dominios institucionales EN PRODUCCIÓN (2026-09-23).**
  Migración `20260923000465` + Auth Hook "Before User Created". Los cuatro pasos
  del runbook están dados, en su orden, y se remidieron contra remoto en vez de
  darse por hechos:
  - `mcp__supabase__list_migrations` da **29**, igual que
    `ls supabase/migrations | wc -l` (**29**), incluida `20260923000465`.
  - Dominios dados de alta (`select … from public.universidad_dominios`):
    `tec.mx` y `exatec.tec.mx`, los dos de Tec de Monterrey.
  - Grants como en local: `EXECUTE` de la función solo para `postgres`,
    `service_role` y `supabase_auth_admin`; una sola policy en la tabla; cero
    privilegios de tabla para `anon`/`authenticated`.
  - **Hook activo, medido en los logs de Auth** (`mcp__supabase__query_logs`,
    `source = 'auth_logs'`): `run_hook` sobre
    `pg-functions://postgres/public/hook_before_user_created`, con altas
    permitidas (`Hook ran successfully`) y rechazos `403: dominio_no_participante`
    en `/otp`, el 2026-09-23 entre las 06:26 y las 06:28 UTC. El hook tardó de 1 a
    10 ms, lejos de cualquier timeout.
  - **Los rechazos no dejaron cuenta**: ese día solo se creó una cuenta, de
    `exatec.tec.mx`; ninguna de un dominio no permitido. Las 5 cuentas previas
    de gmail/hotmail/outlook siguen existiendo y pueden entrar (el hook solo
    toca el ALTA).
  - `src/lib/database.types.ts` ya se regeneró desde remoto e incluye
    `universidad_dominios`.
  **Para dar de alta otra universidad**, el orden sigue importando: primero la
  fila en `universidades`, después sus dominios en `universidad_dominios` (en
  minúsculas, sin espacios ni `@`, y cada subdominio con su propia fila), y
  hasta entonces nadie de ahí se puede registrar. El hook ya está activo, así
  que no hay que tocar nada en el Dashboard. **No se hace con `db push
  --include-seed`**: eso también sembraría lo que traiga `seed.sql`.

- **Fase 2A (universidad derivada del dominio, `20260924000466`) EN REMOTO
  (2026-09-23).** Los pasos 0-5 del runbook (CLAUDE.md §8, antes pendiente 0)
  corrieron en orden, cada uno remedido en vez de darse por hecho — **falta
  solo el paso 6** (una alta real de un dispositivo), que queda como prueba
  manual pendiente:
  - **Paso 0, bloqueante:** fase 1 viva — `list_migrations` con `20260923000465`
    (29 migraciones), `universidad_dominios` con 2 filas
    (`exatec.tec.mx→1, tec.mx→1`), `run_hook` reciente en los logs de Auth. Los
    conteos a/c/d en 0 (7 usuarios, 76 publicaciones, ninguno incoherente).
  - **Diff de grants, antes y después del push**: exactamente 3 filas menos
    (`UPDATE` sobre `users.universidad_id`, `listings.universidad_id` y
    `listings.campus_id`) y **ninguna nueva** — medido con
    `scripts/grants-users-listings.sql` vía `execute_sql`, guardando las dos
    salidas.
  - **`supabase db push`** aplicó `20260924000466`. `list_migrations` pasó a
    **30**, igual que `ls supabase/migrations | wc -l` (**30**).
  - **`prosrc` de `private.handle_new_user()`** confirmado con el lookup a
    `universidad_dominios` vía `split_part(…, -1)`, igual que el fuente.
  - **Los seis constraints nuevos, confirmados en `pg_constraint`**:
    `campus_universidad_id_id_key`, `users_campus_universidad_fkey` (reemplazó
    a `users_campus_id_fkey`), `listings_campus_universidad_fkey` (reemplazó a
    `listings_campus_id_fkey`), `users_campus_requiere_universidad`,
    `users_id_universidad_id_key`, `listings_user_universidad_fkey` (`on
    update/delete cascade`).
  - **`npm run gen:types`** cambió `database.types.ts`: reemplaza las dos FKs
    sueltas por las compuestas y agrega la relación nueva — exactamente lo que
    predecía la migración, nada más. Commiteado aparte
    (`chore: regenerar tipos tras 20260924000466`), con `tsc`/lint en verde.
  - **El build nuevo se instaló de inmediato** después del push (paso 5 del
    runbook), para no dejar abierta la ventana de incompatibilidad en ningún
    sentido.
  **Falta:** paso 6, una alta real `tec.mx`/`exatec.tec.mx` desde un
  dispositivo, con su `universidad_id` confirmado — es la única prueba que
  exige un teléfono de verdad y por eso queda para el usuario (ver Pendiente).

- **Reclamo de moderación (`20260928000471`) y avisos nuevos del inbox
  (`20260928000472`/`473`) EN REMOTO, los 6 pasos, CERRADOS (2026-09-25).**
  Cada uno remedido con evidencia, no dado por bueno de memoria (era el
  pendiente 0g):
  - **Paso 1 (push):** `list_migrations` lista `20260928000471`, `…472` y
    `…473` — remoto en 37, igual que el repo.
  - **Paso 2 (verificación en remoto), las CUATRO comprobaciones:**
    `enum_range(null::notification_type)` con los 8 valores; `pg_get_triggerdef`
    de los 5 triggers, con el `WHEN` **idéntico** al de la migración
    (`listings_notify_moderacion` con las dos ramas y el `not
    veredicto_en_pantalla`; `listings_limpia_veredicto_en_pantalla` BEFORE con
    su `WHEN`; `listings_notify_vendido`; `ratings_notify_insert` sin `WHEN`;
    `avatar_moderacion_notify` con `WHEN (new.foto_url_nulificado)`); las 4
    funciones `notify_*` nuevas con `has_function_privilege('authenticated', …,
    'execute')` en `false`; y `listing_moderacion_reclamos`/`avatar_moderacion`
    con 0 filas en `table_privileges` para `anon`/`authenticated` y 0 en
    `pg_policies`.
  - **Paso 3 (deploy):** `list_edge_functions` → `moderar-contenido`
    **ACTIVE**, `version: 6`, `updated_at` = 2026-09-24 17:47:46 -06:00 —
    **posterior** al commit `50df2c3` (17:42:18 -06:00) que cerró el código de
    esta tanda, por ~5 min. El fuente desplegado (bajado con
    `get_edge_function` y grepeado) trae los cuatro marcadores:
    `listing_moderacion_reclamos` (6, una de ellas en el docblock de
    `decision.ts`, que viaja empaquetado junto con `index.ts` — el `index.ts`
    local solo tiene 5, porque ese docblock vive en otro archivo),
    `descartado_por_carrera` (1), `veredicto_en_pantalla` (2) y
    `avatar_moderacion` (3) — mismas cuentas que el fuente local.
  - **Paso 4 (gen:types):** `git show 5b61009 -- src/lib/database.types.ts`
    muestra el diff exacto (62 inserciones, 1 borrado): las dos tablas nuevas
    y `listings.veredicto_en_pantalla` aparecen ahí por primera vez, y no
    estaban en el commit anterior (`50df2c3`). Reforzado con una regeneración
    EN VIVO contra remoto (`generate_typescript_types`), que coincide con lo
    commiteado — `git diff HEAD -- src/lib/database.types.ts` da vacío.
  - **Paso 5 (build): no hizo falta uno nuevo.** Esta tanda no tocó ningún
    módulo nativo ni dependencia (`git diff` de `package.json`/`ios/`/`android/`
    contra el commit anterior da vacío). Confirmado con el usuario: basta con
    que el dev build ya instalado corra contra un Metro que sirva este JS
    (reload, no rebuild) — no aplica el gotcha de CLAUDE.md §9 sobre módulos
    nativos, porque no se agregó ninguno.
  - **Paso 6 (pruebas manuales del inbox): CONFIRMADO POR EL USUARIO
    (2026-09-25), sin desglose por caso** — el simulador headless no cuenta
    como prueba (§6), así que esta confirmación es la que cierra el runbook.
    Cubre lo listado en `notificaciones-push.md` "Tanda 2" (los 6 escenarios
    del inbox) y la verificación del reclamo en Studio.

- **Eliminar cuenta (`20260929000474` + Edge Function `eliminar-cuenta`) EN
  REMOTO, los 6 pasos, CERRADOS (2026-09-27).** El runbook lo corrió el
  usuario; la evidencia de los pasos 1-4 se REMIDIÓ contra remoto después, no se
  dio por buena de memoria (era el pendiente 0h):
  - **Paso 1 (push):** `list_migrations` lista `20260929000474`
    (`eliminar_cuenta`) — remoto en 38, igual que el repo.
  - **Paso 2 (verificación en remoto):** `pg_constraint` con
    `ratings_from_user_id_fkey`, `ratings_listing_id_fkey` y
    `reports_reporter_id_fkey` en `confdeltype = 'n'`; `pg_get_triggerdef` de
    `ratings_anonimiza`, `reports_anonimiza`, `users_borra_avisos_de_cuenta` y
    `users_bloquea_correo_suspendido` idéntico a la migración, con sus `WHEN`;
    `has_function_privilege('authenticated', …, 'execute')` en `false` para
    `borra_avisos_de_cuenta`/`bloquea_correo_suspendido` y en `true` para las dos
    INVOKER; `correos_bloqueados` con 0 filas en `table_privileges` y en
    `column_privileges` para `anon`/`authenticated` y una sola policy
    (`correos_bloqueados_select_auth_admin`, rol `supabase_auth_admin`); `prosrc`
    del hook con `correos_bloqueados`.
  - **Paso 3 (deploy):** `list_edge_functions` → `eliminar-cuenta` **ACTIVE**,
    `version: 1`, `verify_jwt: false`, desplegada el 2026-09-27 22:49 UTC. El
    fuente desplegado (`get_edge_function`) trae `index.ts` y
    `reautenticacion.ts` con `reautenticacionReciente`, `vaciarCarpeta` y el
    import pineado a `@supabase/server@1.7.0`.
  - **Paso 4 (gen:types):** una regeneración EN VIVO contra remoto
    (`generate_typescript_types`) coincide con lo commiteado en `1ed1407` en las
    piezas de esta tarea: `correos_bloqueados`, `ratings.from_user_id`/
    `listing_id` nullable y `reports.reporter_id` nullable. Comparado pieza por
    pieza, no con un `diff` del archivo entero.
  - **Pasos 5 y 6 (build y pruebas manuales): CONFIRMADOS POR EL USUARIO
    (2026-09-27)**, las 7 pruebas de `cuenta-perfil.md` en dispositivo, sin
    desglose por caso. Incluye la del guard global con sesión vencida.
  - **Dato al remedir, que no cuadra solo:** `public.correos_bloqueados` tiene
    **0 filas** en remoto. La prueba 7 (borrar una cuenta SUSPENDIDA e intentar
    registrar su correo) deja un hash ahí si corre contra remoto, así que o se
    corrió en local, o el hash se borró después a mano. No se decide aquí cuál.

- **Intereses y "Recomendados para ti" (`20260930000475`) EN REMOTO, los 6
  pasos, CERRADOS (2026-09-27).** El runbook lo corrió el usuario; los pasos
  1, 2 y 4 se REMIDIERON contra remoto después, no se dieron por buenos de
  memoria (era el pendiente 0j):
  - **Paso 1 (push):** `list_migrations` lista `20260930000475`
    (`user_intereses_recomendados`), así que remoto está en 39, igual que el repo.
  - **Paso 2 (verificación en remoto), una sola consulta:**
    - `recomendar_listings` da `prosecdef/provolatile/proconfig` =
      `false | s | null`;
    - su `EXECUTE` es true para `authenticated` y false para `anon`;
    - `user_intereses` tiene solo `DELETE, INSERT, SELECT` para
      `authenticated`, 0 privilegios de tabla o columna para `anon`, las 3
      policies (`…_select_own`, `…_insert_own`, `…_delete_own`), RLS activo y
      las dos FKs en `confdeltype = 'c'`.
  - **Paso 3 (`explain analyze` como authenticated):** lo corrió el usuario. No
    se remidió aquí, porque la cifra no se puede reconstruir desde un `select`.
  - **Paso 4 (gen:types):** una regeneración EN VIVO contra remoto
    (`generate_typescript_types`) coincide campo por campo con lo commiteado en
    `1e1c26e`, en las dos entradas de esta tarea (`user_intereses` y
    `recomendar_listings`). Las dos se habían copiado de un `gen types --local`.
  - **Pasos 5 y 6 (build y pruebas manuales): CONFIRMADOS POR EL USUARIO
    (2026-09-27)**, sin desglose por caso. Son las pruebas de `explorar.md`
    ("Recomendados para ti"), `onboarding-auth.md` ("Intereses") y
    `cuenta-perfil.md` ("Mis intereses"). No hizo falta build nativo nuevo.
  - **Dato al remedir:** `user_intereses` tiene **1** fila en remoto, que
    encaja con lo que dejan las pruebas manuales.

- **Panel de admin (RF-17), Olas 1 a 3 EN PRODUCCIÓN (2026-10-02 al
  2026-10-05).** Migraciones `20260930000477`, `…478` y `…479` en remoto, panel
  en `https://admin.rlvo.com.mx` y los 3 admins creados y activados. Cada paso se
  REMIDIÓ, no se dio por bueno de memoria. **Fechas y horas en UTC** (Monterrey
  es UTC−6), salvo donde se diga: el push cayó a las ~05:00 del 2026-10-02 UTC,
  o sea la noche del 2026-10-01 en Monterrey, y la copia cifrada se llama
  `2026-10-01` por su fecha local (22:33 en Monterrey, ya 2026-10-02 en UTC).
  Lo que corrió el usuario (push,
  despliegue, Dashboard, `crear-admin.mjs --remoto`) y lo que midió Claude (`select`
  y peticiones HTTP públicas; una de ellas, un intento de alta con un dominio no
  participante, que el hook rechazó sin crear nada) quedaron separados a propósito:
  - **Antes del push:** remoto en 40 y repo en 43; 0 usuarios suspendidos (el
    bloqueante de `users_suspension_coherente`); schema `admin` y `private.admins`
    inexistentes. Las 4 `pendiente` heredadas (ids 67, 73, 75 y 78, **sin fila en
    `listing_moderacion_reclamos`** porque se evaluaron antes de `…471`) las
    resolvió el usuario en Studio el 2026-10-02: las 4 quedaron `bloqueada`, con
    sus 4 avisos `publicacion_bloqueada` en el inbox. **Ningún aviso de ese
    inbox ha salido como push, no solo esos 4:** medido en remoto el 2026-10-06
    (UTC), las 32 filas de `notifications` tienen `push_enviado_at` NULL (6 de
    ellas `publicacion_bloqueada`) y `push_tokens` tiene 0 filas. Los secretos de
    Vault de `send-push` siguen sin ponerse (pendiente 1) y no hay tokens de
    dispositivo reales. **Decidido el 2026-10-06: los avisos viejos NO se
    reenvían.** No hay mecanismo (el trigger `notifications_notify_push` es solo
    AFTER INSERT, migración `…452:92-94`, y no hay barrido ni cron), el inbox ya
    los muestra y no hay a quién mandárselos. Se reabre cuando existan tokens de
    dispositivos reales.
  - **Push (lo corrió el usuario):** `list_migrations` pasó de 40 a 43, la última
    `…479`.
  - **Verificación en remoto (sección D del plan), comparada contra local con un
    md5 de la misma consulta:** funciones, ACL y privilegios de `admin` y
    `private` (9 + 33 funciones; PUBLIC con EXECUTE solo en las 4 INVOKER
    conocidas) `6c544e55…`; grants de `users` y `listings` (54 filas) `681aaf99…`;
    policies, trigger de `resolved_at`, constraints, policy de Storage del admin y
    Realtime `9cedcf4c…`. `suspendido_at` y `suspension_motivo` sin privilegios
    para `anon` ni `authenticated`, y `authenticated` actualiza exactamente 5
    columnas de `users`. El 2026-10-05 los tres md5 siguen idénticos.
  - **Exposición del schema `admin` (Dashboard, DESPUÉS del push):** `rpc/sesion`
    sin sesión pasó de `406 PGRST106` a `401 42501`; `private` sigue sin exponerse
    (`406`); `categories` sigue en 401. Los advisors habían sumado, tras el push,
    2 INFO de RLS sin policies en `private.admins` y `private.admin_acciones`
    (intencionales: RLS sin policies es el control de acceso), y al exponer
    `admin` sumaron los 9 WARN de definer de `admin.*` (el lint solo mira
    schemas expuestos, §9).
  - **Tipos (`gen types --linked`):** `public` solo suma `users.suspendido_at` y
    `users.suspension_motivo`; `admin` no cambia de contenido, solo de formato
    (§9). Commit `d8a4c75`.
  - **Despliegue:** Cloudflare Pages, proyecto `rlvo-admin`, Direct Upload con
    `wrangler pages deploy` (sin Git ni CI/CD), dominio `admin.rlvo.com.mx`. El
    `_headers` lo genera el mismo plugin de Vite que la `<meta>` de la CSP. Medido
    en el dominio propio, en `rlvo-admin.pages.dev` y en el deployment
    `5345fbc4`: los 6 headers idénticos a `dist/_headers` en `/`, en una ruta
    profunda, el JS, el CSS y las fuentes; JS, CSS y fuentes byte-idénticos a
    `admin/dist`; el fallback de SPA da 200. **Incidente:** Cloudflare Web
    Analytics inyectaba su beacon en el HTML del panel desde el borde, porque la
    inyección automática es de la ZONA `rlvo.com.mx` y no del proyecto de Pages
    (§9); la CSP lo bloqueaba (consola con violaciones, nada salía). Se resolvió
    cambiando la zona a "Enable with JS Snippet installation" y poniendo el snippet
    solo en la landing (otro repo). **La CSP no se amplió**: el panel sigue sin
    Web Analytics, con 0 coincidencias en las 4 variantes de petición por host.
  - **Admins:** 3 creados con `crear-admin.mjs --remoto`, activados con `activar`
    y auditados (3 filas `activar_admin` con el actor centinela): uno
    `@rlvo.com.mx` y dos con correo personal (`--correo-externo`, decisión del
    usuario; su correo queda en `admin_correo` para siempre). Medido: el hook de
    registro NO se consultó en `/admin/users` en remoto (GoTrue v2.197.0): la
    cuenta `@rlvo.com.mx` se creó sin estar el dominio en `universidad_dominios`.
  - **E6, TOTP vencido, en producción (2026-10-02):** con la pestaña abierta
    desde el login, pasadas las 12 h, los logs de la API muestran `POST
    listar_reportes` → 403 y Postgres `42501 totp_vencido` (el clic y el
    "Reintentar", una llamada rechazada por intento), después `challenge` y
    `verify` en 200 y `listar_reportes` en 200. El refresh del token a las
    20:00:10 NO renovó el TOTP: es la prueba real de D16 (el token seguía
    vigente y aun así se rechazó por la antigüedad del TOTP). `last_challenged_at`
    quedó posterior a la caducidad y `admin_acciones` sin filas nuevas. **Alcance
    acordado:** solo el camino de las RPC; la ruta de fotos con TOTP vencido no se
    puede provocar esperando (todas las fotos se montan después de que la RPC
    responde) y queda cubierta por `probe-storage.mjs` y `probe-puerta-totp.mjs`.
  - **Cierre (E8), 2026-10-05:** 3 factores TOTP verificados (0 de cuentas que
    no son admin), 3 admins activados, 3 filas `activar_admin` con el centinela
    y `public.users` = 10 (7 de marketplace + 3 admins); funciones, ACL, policies
    y hook sin deriva. La secret key temporal `crear-admin-ola3` se eliminó y
    quedan solo la `default` y la publishable; el historial del shell dio 0, 0 y 0
    (`sb_secret_…` pegada, asignaciones con valor de la contraseña y
    `--password`/`-p`); portapapeles limpio. La contraseña de la base no se rotó:
    solo se tecleó en prompts.
  - **Límites de evidencia, registrados a propósito:** (1) el E4 de los otros dos
    admins (login con contraseña y TOTP, y navegar el panel) lo **confirmó
    manualmente el usuario**; no es demostrable en la base: su
    `last_challenged_at` es anterior a su `activado_at` y uno no tiene sesión.
    (2) La **revocación** de la llave `crear-admin-ola3` no se probó con la llave
    vieja (ya no existía); la evidencia es que su fila desapareció del Dashboard,
    porque desde SQL no se ven las secret keys. (3) El texto de la UI en E6 (modal
    único, "No pudimos cargar los reportes") lo reportó el usuario; los logs
    confirman una sola llamada rechazada por intento. (4) La revisión del historial
    cubre `~/.zsh_history`; lo tecleado en prompts sin eco no se guarda en ningún
    archivo y eso no se puede comprobar.
  - **Respaldo:** el proyecto NO tiene backups ni PITR (Dashboard, paso 2 de la
    Ola 3, antes del push). Hay una copia cifrada (imagen de disco AES-256,
    234,496 B) de esquema y datos tomada la noche del 2026-10-01 (hora de
    Monterrey), **antes de A1a y de los 3 admins**: una fotografía que
    envejece, no una estrategia. Los `.sql` en claro se borraron después de abrir
    la imagen y comprobar los tres archivos por SHA-256. Cubre `public`, `private`,
    `auth` y `storage` (solo las filas de `storage.objects`: no los archivos), y
    deja fuera Vault y `supabase_migrations`.
    **Hechos verificados por el usuario en su equipo, puntuales y NO garantías
    permanentes** (FileVault, Time Machine, ubicación y estado del respaldo se
    comprobaron en ese momento y pueden cambiar): FileVault activado; sin destinos
    de Time Machine configurados ni snapshots locales de APFS al momento de la
    comprobación; la copia está fuera de iCloud Drive y de las carpetas
    sincronizadas comprobadas (la ruta no se documenta); la frase de paso está en
    un gestor de contraseñas (ni la frase ni su ubicación exacta se documentan);
    la imagen AES-256 se montó y verificó, contiene los tres `.sql` originales y
    sus SHA-256 coinciden; después se eliminaron los tres `.sql` en claro.
    **Ciclo de vida: decisión pendiente.** No hay fecha límite ni política de
    borrado o reemplazo; se define junto con la estrategia de backups/PITR y la
    retención aplicable. **Pendiente aparte, sin resolver aquí:** comprobar si
    esta copia, y la retención de datos de cuentas eliminadas que implica
    (contiene filas anteriores a cualquier borrado posterior), obliga a actualizar
    el aviso de privacidad o la política de retención (`docs/auditoria-lanzamiento-2026-09-22.md`,
    §6). El aviso de privacidad no se modificó.

**Pendiente, en este orden de prioridad:**
0. **Fase 2A en remoto: falta solo la prueba manual (paso 6 del runbook,
   CLAUDE.md §8 arriba).** Los pasos 0-5 ya corrieron y están en "Hecho"
   (2026-09-23), con la migración `20260924000466` aplicada. Lo único que
   queda: una alta real `tec.mx`/`exatec.tec.mx` desde un dispositivo
   (Verificación → código → Completar perfil), confirmando que la Universidad
   aparece fija y correcta y que el usuario puede elegir campus y entrar al
   Feed. Necesita un teléfono de verdad — por §6 el simulador headless no
   cuenta como prueba. Cuando se confirme, este punto se borra.
0b. **(No bloqueante) Medir en remoto el timeout del hook de registro.** En local
   GoTrue corta a los **10 s** con `504`; la doc dice 2 s. Los dos casos fallan
   cerrado, pero con un corte de 2 s una función lenta rechazaría en remoto
   registros que en local pasan. Hoy el hook tarda de 1 a 10 ms en producción,
   así que no hay urgencia. **Revisar cuando:** el hook haga algo más que una
   búsqueda por PK, o los logs de Auth muestren `request_timeout` en `/otp`.
**(El pendiente 0c — borrar los datos de prueba de la fase 2B — se cerró. Había
quedado a medias el 2026-09-29: solo faltaba la fila de `auth.users` de
`prueba-2b`, sin contraseña ni identidades. Remedido el 2026-10-02 (UTC), esa
cuenta ya no existe y `auth.users` y `public.users` coincidían, 7 y 7; a
2026-10-05 son 10 y 10, o sea 7 de marketplace más los 3 admins. Se deja este hueco para no romper las referencias cruzadas a
"pendiente 0c". **Las métricas de RF-17 (Ola 6) cuentan sobre `public.users` y
excluyen a los admins.**)**
0d. **Fase 2C ("Detectar campus más cercano"): la migración YA está en
   remoto; faltan los pasos 2-4.** Requiere, en este orden:
   1. ~~`supabase db push` de `20260925000467_campus_coordenadas.sql`~~
      **HECHO, fuera de la sesión que escribió este punto.** Este paso decía
      "remoto se queda en 30 hasta este paso", y el 2026-09-24
      `mcp__supabase__list_migrations` ya listaba `20260925000467`, con
      `campus.latitud`/`longitud` presentes en `information_schema.columns` de
      remoto. Es la undécima vez del patrón prosa-contra-comando de §3.
   2. Capturar las coordenadas REALES de cada campus en Studio (`latitud`/
      `longitud` de `public.campus`) — el seed solo trae coordenadas de
      PRUEBA para desarrollo local, y nunca se pushea a un campus que ya
      tenga fila en remoto (`on conflict do nothing`).
   3. **Instalar un dev build NUEVO, explícitamente — `expo-location` es un
      módulo NATIVO y ningún build existente lo tiene compilado.** Mismo
      gotcha que ya mordió con `expo-notifications` (§9): agregar el módulo a
      `package.json` no alcanza sin reconstruir. `ubicacionDisponible()`
      (`src/lib/geolocalizacion.ts`) hace que el botón se OCULTE con gracia
      contra un build viejo — no crashea, pero tampoco hace nada— así que la
      ausencia del build nuevo no se nota sola: hay que instalarlo a
      propósito.
   4. `npm run gen:types` contra remoto, DESPUÉS del push — hoy
      `database.types.ts` tiene `campus.latitud`/`longitud` escritas a mano
      (el CLI local, 2.116.0, genera en un formato distinto al que produjo el
      resto del archivo, así que regenerar todo ahora habría metido ruido
      ajeno a esta tarea); la regeneración contra remoto es la que deja el
      archivo canónico otra vez.
   Nada de esto es alcanzable sin un teléfono real (§6): el simulador
   headless no puede probar permisos del sistema ni GPS.
0e. **Búsqueda por prefijo (`20260926000468`, `public.buscar_listings`): la
   migración YA está en remoto; faltan los pasos 2-5.** Al remedir el
   2026-09-24, `list_migrations` ya listaba `20260926000468`: el paso 1 corrió
   fuera de la sesión que escribió este punto. Los pasos 2-5 no se
   verificaron en esa medición. Texto original:
   **Construida y probada en LOCAL, sin pushear.** El cliente YA llama a la RPC,
   así que **un build con este código contra un remoto sin la función rompe
   Búsqueda y Categoría con texto** (PGRST202). Por eso el push va ANTES de
   distribuir un build con este cambio. En este orden:
   1. `supabase db push`, y confirmar con `list_migrations` que
      `20260926000468` aparece (remoto pasa de 31 a 32).
   2. Verificar en remoto, con `execute_sql`:
      - `select prosecdef, provolatile, proconfig from pg_proc where oid =
        'public.buscar_listings(text)'::regprocedure` → debe dar `f | s | null`;
      - `has_function_privilege('authenticated', …, 'execute')` → true;
      - `has_function_privilege('anon', …, 'execute')` → false.
   3. `explain analyze` en remoto COMO `authenticated`, con `set local role` y
      `request.jwt.claims`, dentro de un `begin … rollback`, sobre
      `buscar_listings('calc')` con los filtros del feed. Hay que confirmar que
      se inlinea (sin `Function Scan`) y anotar el tiempo. Se espera Seq Scan
      (deuda en `explorar.md`), así que la cifra se imprime con el rol.
   4. `npm run gen:types` contra remoto. Hoy la entrada `buscar_listings` de
      `database.types.ts` está escrita a mano, con `SetofOptions`, por el
      mismo motivo que `campus.latitud` en el pendiente 0d.
   5. Prueba manual en dispositivo: ver `explorar.md`, "Búsqueda por prefijo".
0f. **Nombre válido (`20260927000469`, check `users_nombre_valido`) y
   teléfono de cualquier país (`20260927000470`, check `users_telefono_e164`):
   construidas y probadas en LOCAL, sin pushear.** En este orden:
   0. **Bloqueante: el dato.** Al planear había **1** nombre en remoto que la
      regla rechaza (motivo, medido solo por conteo: un dígito). Se corrige a
      mano en Studio, y ANTES del push se remide que dé **0**:
      `select count(*) from public.users where nombre is not null and not
      (char_length(nombre) between 2 and 50 and nombre ~ '<el regex de la
      migración>')`. El check entra VALIDADO (sin `NOT VALID`): si este paso se
      salta, el push falla con 23514 en vez de dejar la fila incoherente.
   1. `supabase db push`, y `list_migrations` con `20260927000469` y
      `20260927000470` (remoto pasa de 32 a 34). No hace falta volver a medir
      los teléfonos: al planear eran 4, todos `+52` con 10 dígitos, y para
      `+52` el check nuevo es idéntico al viejo.
   2. `pg_get_constraintdef` en remoto:
      - `users_nombre_valido`, con los escapes `\uXXXX` iguales a `CLASE_LETRA`;
      - `users_telefono_e164`, igual al de la migración;
      - y que `users_telefono_e164_mx` YA NO exista.
   3. `npm run gen:types` contra remoto: un check no cambia tipos, así que el
      diff debe salir vacío.
   4. Distribuir el build DESPUÉS del push. Del nombre, el orden sería
      flexible: un build viejo manda `nombre.trim()`, que con un nombre válido
      pasa. Del teléfono NO: un build nuevo contra un remoto sin la 470 manda
      `+34…`, que el check viejo rechaza crudo ("No pudimos guardar"). Un
      build viejo contra el remoto nuevo no tiene problema, porque solo manda
      `+52` con 10.
      `libphonenumber-js` es JS puro: no hace falta dev build nativo nuevo.
   5. Pruebas manuales en dispositivo: ver `cuenta-perfil.md`,
      `onboarding-auth.md` ("Nombre válido") y `publicar-fotos.md` (teléfono).
   **Paso 1 HECHO, fuera de la sesión que escribió este punto:** el
   2026-09-24, `list_migrations` ya listaba la 469 y la 470 (34 en remoto).
   Los pasos 2-5 no se verificaron en esa medición.
**(El pendiente 0g — reclamo de moderación `20260928000471` y avisos nuevos del
inbox `20260928000472`/`473` — se cerró completo el 2026-09-25, los 6 pasos.
Evidencia en "Hecho", abajo. Se deja este hueco para no romper las referencias
cruzadas a "pendiente 0g" de `CLAUDE.md` §3 y `notificaciones-push.md`, que
ahora apuntan a "Hecho".)**
**(El pendiente 0h — eliminar cuenta, `20260929000474` + Edge Function
`eliminar-cuenta` — se cerró completo el 2026-09-27, los 6 pasos. Evidencia en
"Hecho", arriba. Se deja este hueco para no romper las referencias cruzadas a
"pendiente 0h" de `CLAUDE.md` §3 y `cuenta-perfil.md`.)**
**(El pendiente 0j — intereses y "Recomendados para ti", `20260930000475` —
se cerró completo el 2026-09-27, los 6 pasos. Evidencia en "Hecho", arriba. Se
deja este hueco para no romper las referencias cruzadas a "pendiente 0j" de
`CLAUDE.md` §3 y `explorar.md`.)**
0k. **RF-17: panel de administración web (`admin/`), por olas.** Plan aprobado
   el 2026-09-29 tras dos rondas de revisión (D1-D20). **El plan completo vive en
   `docs/rf17-plan-admin.md`** (consolida v2 y v2.1; donde chocan, gana v2.1);
   lo que sigue es el resumen operativo.
   Somos 3 admins y 2 no pueden usar Studio ni SQL (`docs/product-spec.md`,
   RF-17). Decisiones ya tomadas: `admin/` en este repo con `package.json` propio
   y sin workspaces (D1); SPA Vite + React + TS, sin servidor (D2); schema
   `admin` con RPCs `security definer`, cada una con `exigir_admin()` adentro y
   auditoría (D3); admins con cuentas separadas del marketplace (`@rlvo.com.mx` o,
   desde la Ola 3, correo personal con `--correo-externo`) creadas por
   `/admin/users`, primera contraseña fijada con el código de recuperación
   (opción A: `/invite` pasa por el Auth Hook, medido) y activadas en dos pasos, identidad en `private.admins` y no en
   `app_metadata` (D4); una sola `is_admin()` que exige aal2 y un TOTP de las
   últimas 12 h leído de `amr`, forma con `jsonb_typeof(...) = 'array'` porque
   `coalesce` no atrapa un `"amr": null` (D16, D18); `claves_auditoria_ok()`
   IMMUTABLE con lista de claves POR tipo de objetivo (D20); cuentas de admin
   sin datos personales en `antes`/`despues` (el correo del actor sí queda en
   `admin_correo`). **D5 (cómo borra el dueño una
   `bloqueada` cuando ya no ve sus fotos) se decide al entrar a la Ola 4.**
   - **Ola 0 — EN PRODUCCIÓN** (`7574b01`, migración `20260930000476` + T36):
     resolver el reporte de una cuenta eliminada ya no aborta (§3, "Resolver el
     reporte…"). Remedido el 2026-09-29, no dado por bueno: `list_migrations`
     en remoto da **40** con `20260930000476`, y `pg_get_triggerdef` de
     `reports_notify_resolved` en remoto trae `(new.reporter_id IS NOT NULL)`.
     `gen:types` no cambia (es un trigger).
   - **Ola 1 — EN PRODUCCIÓN desde 2026-10-02** (commits `6278a0a` a `b11865c`):
     migraciones `20260930000477` (admins, MFA, auditoría, schema `admin`) y
     `…478` (suspender/reactivar); T12 y T35 (rls.sql en 407, con (g0b));
     `scripts/crear-admin.mjs` y `scripts/probe-admin.mjs` (46 pruebas entonces, 83
     hoy); el
     panel `admin/` sin frame (D14). **Cambió respecto al plan:** las cuentas
     no se INVITAN, se CREAN por `/admin/users` y fijan contraseña con el
     código de recuperación, porque medido `/invite` pasa por el Auth Hook y
     rechaza `@rlvo.com.mx` (§9). Decisión del usuario, 2026-09-29. **Prueba
     manual en local, en navegador y con un TOTP real: HECHA por el usuario el
     2026-10-01, sin hallazgos** (`admin/CLAUDE.md`, "Desarrollo local").
   - **Runbook de la Ola 3 para `…477`/`…478`/`…479` — CORRIDO, cerrado el
     2026-10-05** (evidencia en "Hecho"; se conserva como registro). Diferencias
     con lo que dice abajo: el paso 1 se decidió aceptando la ventana, con la
     regla del runbook para los cofundadores (`docs/admin-runbook.md`) y las 4
     `pendiente` heredadas resueltas en Studio; el paso 6 fue `crear-admin.mjs
     --remoto`; el paso 7 usó `--linked`; y `desactivar_admin` entró en `…479`
     antes del push, así que el CHECK del paso 8 tiene **6** acciones, no 5:
     0. **Bloqueante:** `select count(*) from public.users where estado =
        'suspendido'` en remoto debe dar 0 (el 2026-09-29 dio 0 de 7). Si no,
        NO se hace push: se trae como decisión (backfill con motivo, o
        `NOT VALID` + `VALIDATE`), porque `users_suspension_coherente` entra
        validado.
     1. **Decisión explícita antes del push:** aceptar la ventana "`pendiente`
        de un dueño suspendido se puede activar" hasta la Ola 4, o adelantar
        `dueno_no_activo` (`…480` + el cambio a `moderar-contenido`). Medido
        el 2026-10-01 para decidirlo: hoy no hay ningún dueño suspendido en
        remoto, y las 4 `pendiente` llevan 9-10 días esperando Studio
        (`revisar`), no son transitorias. Opción anotada, sin implementar: un
        guard de `users.estado` en `moderarListing()` (`moderar-contenido/
        index.ts:445-455`) que no promueva a `activa` si el dueño no está
        activo; cubre esa salida, no la de Studio.
     2. `supabase db push`; `list_migrations` con las tres.
     3. **DESPUÉS del push, nunca antes:** agregar `admin` a los exposed
        schemas del Dashboard (con el schema inexistente, TODO el API da 503;
        §9).
     4. Verificar en remoto: `has_function_privilege`, `prosecdef` y
        `proconfig` de `admin.*` y de las funciones de `private` (las mismas
        invariantes de T12).
     5. Desde ese push, **suspender por Studio exige `suspendido_at` y
        `suspension_motivo`** (3-500 tras btrim) o falla con 23514 (D15).
     6. Decidir cómo corre `crear-admin.mjs` contra remoto (entonces se negaba:
        solo local; resuelto en la Ola 3 con `--remoto`).
     7. `npm --prefix admin run gen:types` contra remoto, y comparar.
     8. (`…479`) Verificar en remoto `pg_get_triggerdef` de
        `reports_sella_resolved_at`, `pg_get_constraintdef` de
        `admin_acciones_accion_check` (5 acciones) y la policy
        `listing_photos_objects_select_admin` con `(select private.is_admin())`.
        **Desde ese push, resolver un reporte desde Studio también sella
        `resolved_at`.** El reporte `resuelto` que hoy está en remoto con
        `resolved_at` NULL se queda así (sin backfill: decisión del usuario);
        el panel lo pinta "—".
     9. Si se desbloquea una publicación por Studio (la única vía: D10), deja
        el motivo anotado fuera de la base —quién, cuándo y por qué— y avísale
        al dueño por el canal de soporte: Studio no escribe en
        `admin_acciones` y la base no le manda ningún aviso.
   - **Ola 2 — EN PRODUCCIÓN desde 2026-10-02** (frames `5466752`/`2e3ab12`,
     aprobados el 2026-10-01; código `3f49263` a `f7ee579`): 24 frames en
     `design/admin-panel.html`; migración `20260930000479` (`listar_reportes`,
     `resolver_reporte`, `detalle_listing`, `bloquear_listing`, el trigger de
     `resolved_at` y la policy de Storage del admin); rls.sql en 454 (455 hoy; T12, T35c
     y T36 Ola 2, con 49 controles, incluido el de G3 sobre el dueño); `probe-storage.mjs` en 34 y
     `probe-admin.mjs` en 47 (83 hoy); `scripts/totp.mjs` y
     `scripts/probe-puerta-totp.mjs`; el panel con reportes, detalle de
     publicación con fotos (blob) y las pantallas de la Ola 1 alineadas a los
     frames, con fuentes autoalojadas. **Prueba manual en local, en navegador y
     con un TOTP real: HECHA por el usuario el 2026-10-01, sin hallazgos** (lista
     y detalle de reportes, resolver y descartar, bloquear desde el reporte y
     desde la publicación, las fotos y el modal de TOTP), con datos sembrados
     por un script local fuera de git, ya borrados.
     **Pendiente de diseño:** el detalle de un reporte resuelto no muestra su
     auditoría (el frame sí): no hay RPC que la devuelva para el tipo
     `reporte` hasta `admin.auditoria` (Ola 6).
   - **Ola 3 — HECHA, EN PRODUCCIÓN (2026-10-02 al 2026-10-05):** push de las 3
     migraciones, schema `admin` expuesto, tipos regenerados, panel desplegado en
     Cloudflare Pages (`admin.rlvo.com.mx`) y los 3 admins activados. Detalle,
     evidencia y límites en "Hecho".
   - **Ola 3b — PENDIENTE: Edge Function `admin-reset-mfa`.** Salió de la Ola 3
     porque no tiene frame (`design/admin-panel.html`) y `admin/CLAUDE.md` exige
     frame primero. Mientras tanto, perder el teléfono se resuelve con
     `desactivar` → borrar el factor en el Dashboard → enrolar de nuevo →
     `activar` (`docs/admin-runbook.md`).
   - **Ola 4:** moderación, incluido el trigger "una publicación no pasa a
     `activa` si su dueño no está activo" (`cuenta-perfil.md`, deuda del pausado
     al suspender). Medido en local antes de escribirlo: cae en **4 fixtures**
     de `rls.sql` (T11b, T13, T14 y T23), no en aserciones, y todas siembran una
     publicación `activa` de un dueño suspendido; hay que sembrarlas de otra
     forma en el mismo cambio. `moderar-contenido` se despliega ANTES, con el
     manejo del rechazo.
   - **Ola 5:** catálogo. **Ola 6:** métricas y `actividad_diaria`.
   **Notas que las olas heredan:** las dos de la Ola 1 ya están hechas (T35
   (d3), "timestamp basura", con su control; y el aviso del `DETAIL` del CHECK
   de `admin_acciones` en `admin/CLAUDE.md`). Las de la Ola 2 también están
   hechas (T36 (g)-(i) y el trigger de `resolved_at`). Siguen las de las Olas 4
   y 6 de `docs/rf17-plan-admin.md`.
   Pendientes: la Ola 3b, una estrategia de respaldos (índice de deuda, abajo) y
   los secretos de Vault de `send-push` (pendiente 1). Ninguno de los de la Ola 3 queda abierto.
0i. **Publicación en tiendas: lo que falta para someter la app.** El
   inventario completo es `docs/auditoria-lanzamiento-2026-09-22.md` (eas.json,
   versiones, íconos, permisos, aviso de privacidad). Se anota aquí lo que
   sale de tareas cerradas:
   - **Enlace WEB para pedir el borrado de la cuenta.** Google Play lo exige
     además del flujo dentro de la app (que ya existe). Quedó fuera de alcance
     de "Eliminar cuenta" a propósito. **Fix:** una página en el mismo dominio
     que el aviso de privacidad, que explique el borrado desde la app y ofrezca
     un correo de soporte (`CORREO_CONTACTO`) para quien ya no la tenga.
   - **El aviso de privacidad tiene contenido pendiente**: la lista vive en la
     auditoría, §6. Incluye, sin resolver: los correos de admin en
     `admin_correo`/ARCO, si la copia cifrada del 2026-10-01 exige actualizar el
     aviso o la retención, y qué hace la landing con Cloudflare Web Analytics.
   - **`.easignore` existe desde la Ola 1 de RF-17** (para dejar fuera
     `admin/`), y en cuanto existe EAS deja de leer `.gitignore`. Es copia
     literal de `.gitignore` (verificado con `diff`), pero **no se ha
     verificado contra el tarball de un build real**: antes del primer build
     de EAS, confirmar que no sube `.env.local` ni `admin/`. Si `.gitignore`
     cambia, `.easignore` también.
1. **Credenciales de push y prueba en dispositivo REAL (RF-16).** El código está
   completo y probado hasta el borde de la red de Expo, pero nada de esto ha
   entregado todavía una notificación a un teléfono:
   - **Android:** subir el service account JSON de **FCM V1** a las credenciales
     de EAS. Sin eso Android no entrega, y **sin error visible en la app**.
   - **iOS:** llave **APNs** y un dispositivo físico — el simulador de iOS no
     recibe push en absoluto.
   - **Los dos secretos de Vault en remoto**, que son paso manual a propósito
     (una credencial no se comitea):
     `select vault.create_secret('sb_secret_…', 'send_push_secret_key');` y
     `select vault.create_secret('https://ukxfnydfhmryrzhdqkvj.supabase.co/functions/v1/send-push', 'send_push_function_url');`
     Sin ellos el trigger no revienta: levanta un `warning`, la fila queda en el
     inbox con `push_enviado_at is null` y no sale ningún push.
   - **Estado medido el 2026-10-06 (UTC):** las 32 notificaciones de remoto tienen
     `push_enviado_at` NULL y `push_tokens` tiene 0 filas. **Los avisos viejos no
     se reenvían (decidido el 2026-10-06):** no hay mecanismo y el inbox ya los
     muestra. Se reabre cuando existan tokens de dispositivos reales.
   - Por §6 el simulador headless no cuenta como prueba. Es hermano del pendiente
     del header `Authorization` de `expo-image`.
2. ~~Poner RF-18 en producción (los cuatro pasos manuales del runbook).~~
   **HECHO (2026-09-19)** — ver el bloque de arriba, en "Hecho:". Sigue viva la
   deuda de COSTO (no de despliegue): Editar sigue pagando 10 requests por 5
   fotos reemplazadas, documentado con su disparador y su fix en
   `.claude/rules/moderacion.md` §7/§9 — decisión aparte, sin tocar.
3. ~~Las DOS verificaciones manuales de RF-18 Ola 4.~~ **HECHAS (2026-09-21),
   las dos en verde — con esto RF-18 queda cerrado de punta a punta.** Se
   registran aquí porque son de las que §6 dice que el simulador headless no
   puede dar por buenas, y porque cada una tiene un detalle que la hace valer:
   - **El runbook de Realtime** (`.claude/rules/moderacion.md` §4.2), **los tres
     casos**, incluido el piso con la publicación apagada a propósito en LOCAL.
     Ese es el que importa: antes de sumarle observabilidad al hook, esta corrida
     no era concluyente —con el refetch funcionando, un canal muerto se ve igual
     que uno sano—, así que el orden fue observabilidad primero y corrida
     después.
   - **El aviso del avatar borrado, con DOS eventos seguidos, fotos distintas y
     sin reiniciar la app**, más el control negativo del avatar limpio. No era
     formalidad: esa misma prueba fue la que cazó el bug del guard booleano que,
     en un tab que no se desmonta, era un pestillo permanente y solo avisaba del
     PRIMER avatar moderado de cada sesión. Corregido guardando el path avisado
     —el criterio que `Avatar` ya usaba para `pathFallido`— y re-corrido después
     del fix.

**Deuda consciente — con disparador de revisión, no "algún día":** cada entrada
vive COMPLETA —con su "Revisar cuando" y su "Fix"— en la regla de su feature, y
aparece sola al tocar esos archivos. Índice para verlas todas de un vistazo:

- Cambiar el avatar puede dejar el anterior huérfano en Storage → `cuenta-perfil.md`
- ~~La base no ata `users.campus_id` a `users.universidad_id`~~ **[CERRADA]** por `20260924000466` (FK compuesta + check) → `cuenta-perfil.md`
- La universidad se fija en el ALTA: cambiar el correo de una cuenta no la re-deriva → `onboarding-auth.md`
- `ErrorState` promete "Reintentar" aunque no haya nada que reintentar → `componentes-compartidos.md`
- "Omitir por ahora" en Calificar es DEFINITIVO → `confianza-ventas.md`
- La reseña del mal asignado sobrevive y queda inmutable → `confianza-ventas.md`
- El vendedor puede reasignar la venta varias veces antes de calificar, y cada cambio dispara una notificación → `confianza-ventas.md`
- El amarre cliente ↔ RLS se sostiene con dos mecanismos parciales en vez de uno fuerte → `confianza-ventas.md`
- No se puede deshacer una venta entera → `confianza-ventas.md`
- Una recuperación de contraseña abandonada a media deja la sesión abierta con la contraseña VIEJA → `onboarding-auth.md`
- Compartir comparte solo texto plano, sin ningún link — en LAS DOS pantallas que lo tienen → `compartir-deeplinks.md`
- ~~`reports.resolved_at` existe y NADIE la escribe~~ **[CERRADA]** por `20260930000479` (trigger `reports_sella_resolved_at`, en producción desde 2026-10-02) → `notificaciones-push.md`
- Bloquear una `vendida` deja a su comprador sin camino en la UI para calificar (`listings_select` esconde la `bloqueada`) → CLAUDE.md §3, "Panel de admin"
- **El proyecto NO tiene backups ni PITR**: el único respaldo es una copia cifrada del 2026-10-01 (anterior a A1a y a los 3 admins), con ciclo de vida sin decidir y su efecto en el aviso de privacidad sin comprobar → CLAUDE.md §8, "Hecho", Panel de admin
- Los correos personales de 2 admins quedan en `admin_acciones.admin_correo`, una tabla append-only; falta reflejarlo en el aviso de privacidad y en el trámite ARCO → `docs/auditoria-lanzamiento-2026-09-22.md`, §6
- `listing_photos` con `storage_path` en forma de URL completa (publicaciones 1 y 2, pausadas, anteriores a `…445`) y objetos de Storage sin fila: Storage responde "Object not found" a esas rutas (medido en local) y, por el código, el panel mostraría "La foto no está disponible"; hoy ningún reporte apunta a esas publicaciones → `publicar-fotos.md` y `docs/admin-runbook.md`
- La landing (otro repo) podría cargar el snippet de Cloudflare Web Analytics: sin verificar si lo hace, y el aviso de privacidad no lo menciona → `docs/auditoria-lanzamiento-2026-09-22.md`, §6
- El panel se despliega a mano (`wrangler pages deploy`, sin CI/CD) y Cloudflare le agrega `access-control-allow-origin: *`, `nel` y `report-to`, que no se quitan desde `_headers`; las fuentes `.woff2` se sirven sin `content-type` → `admin/CLAUDE.md`, "Producción"
- Leaked password protection de Auth desactivado (advisor de seguridad); se decide en el Dashboard → CLAUDE.md §8, "Hecho", Panel de admin
- Sin receipts de Expo → `notificaciones-push.md`
- `pg_net` es fire-and-forget → `notificaciones-push.md`
- El inbox no pagina → `notificaciones-push.md`
- Sin "categoría seguida" → `notificaciones-push.md`
- El token de push es no-enumerable, pero robable si se conoce → `notificaciones-push.md`
- ~~La lada del teléfono está fija en `+52`~~ **[CERRADA]** por `20260927000470` (selector de país) → `cuenta-perfil.md`
- Un número válido de 7 dígitos en total (Tokelau, Tristan da Cunha) no se puede guardar: el mínimo del check es 8 → CLAUDE.md §3 (bloque del teléfono)
- El teléfono es no-enumerable-en-bloque, no inaccesible → `cuenta-perfil.md`
- Un insert directo con `estado='activa'` y 0 fotos sigue siendo posible → `publicar-fotos.md`
- ~~`listings_insert_own` no restringe `estado`~~ **[CERRADA]** por `20260919000463` → `publicar-fotos.md`
- Editar el TEXTO de una publicación ya aprobada no la vuelve a moderar → `publicar-fotos.md`
- El trigger de Storage evalúa el set ANTERIOR de fotos y nunca la que lo disparó → `moderacion.md`
- Toda re-evaluación vuelve a tirar el dado de GPT sobre texto que no cambió → `moderacion.md`
- La cola de `pendiente` mezcla lo marcado por moderación con lo abandonado a media subida → `moderacion.md`
- La promoción de `moderarListing()` puede reventar con 500 si intenta activar una publicación con 0 fotos → `moderacion.md`
- ~~El pausado al suspender solo cubre UPDATE: una publicación creada para una cuenta YA suspendida nace `activa`~~ **[CERRADA]** por `20261007000480` (`listings_exige_dueno_activo_ins`) → `cuenta-perfil.md`
- "Calificar la app"/"Compartir la app" ocultas hasta que la app esté publicada (`APP_PUBLICADA`); "Calificar" además exige la URL de la tienda de esa plataforma → `cuenta-perfil.md`
- "Aviso de privacidad"/"Términos de uso" ocultas hasta que exista una URL real (`URL_PRIVACIDAD`/`URL_TERMINOS`) → `cuenta-perfil.md`
- ~~"Eliminar cuenta" existe en el frame y en el código (oculta) pero su flujo todavía no existe~~ **[CERRADA]** por `20260929000474` + `eliminar-cuenta` → `cuenta-perfil.md`
- ~~El guard de sesión de `(tabs)/_layout.tsx` no actúa fuera de foco~~ **[CERRADA]** por el guard global del layout raíz (`src/lib/salida-sesion.ts`), confirmado en dispositivo el 2026-09-27 → `cuenta-perfil.md`
- La reseña de una publicación BORRADA ya no la puede editar su autor (`can_rate(to, NULL)` da false), efecto del `ratings.listing_id` en set null → CLAUDE.md §3, "Eliminar cuenta"
- Al eliminar una cuenta se borra también el aviso de calificación de un TERCERO si calificó al mismo usuario por la misma publicación (el aviso no guarda quién lo causó) → CLAUDE.md §3, "Eliminar cuenta"
- `correos_bloqueados` guarda un hash SIN sal (seudónimo, no anónimo), para siempre, y un alias lo evade → CLAUDE.md §3, "Eliminar cuenta"
- Eliminar cuenta no borra los huérfanos de Storage que YA existían de publicaciones borradas antes (no están bajo una carpeta enumerable) → `publicar-fotos.md` (la deuda del barrido)
- Falta el enlace WEB para pedir el borrado de la cuenta (Google Play) → CLAUDE.md §8, pendiente 0i
- ~~El aviso del avatar borrado por moderación se pierde si el usuario no abre Perfil o no ve el toast~~ **[CERRADA]** por `20260928000473` (`avatar_moderacion` + aviso `avatar_eliminado` en el inbox) → `cuenta-perfil.md`
- Los builds viejos ya instalados crashean el inbox al leer un `tipo` de notificación nuevo (el fallback `ESTILO_DESCONOCIDO` solo existe desde RF-16 tanda 2) → CLAUDE.md §8, "Hecho", paso 5 del runbook de `20260928000471`/`472`/`473`
- El push no rutea por `tipo`: los avisos sin publicación abren el inbox, no su destino → `notificaciones-push.md`
- El reintento solo distingue DOS errores deterministas → `publicar-fotos.md`
- `publicandoRef` (`nueva.tsx`) solo cubre el doble-tap dentro de la misma sesión: un crash/reinicio de la app entre que `crearListing()` resuelve en el servidor y el cliente recibe la confirmación puede seguir creando una publicación duplicada — eso necesita idempotencia del lado del servidor → `publicar-fotos.md`
- Si falla `guardarFotos()` —no la subida— los objetos quedan sin fila → `publicar-fotos.md`
- El tope de 5 fotos SIGUE sin aplicar en Storage → `publicar-fotos.md`
- Borrar una publicación no borra sus fotos de Storage **[CERRADA]** → `publicar-fotos.md`
- Ningún índice cubre los alcances "toda una universidad" y "todas las universidades" (seq scan + sort, medido) → `explorar.md`
- ~~La búsqueda de texto es por palabra completa, no por prefijo~~ **[CERRADA]** por `20260926000468` → `explorar.md`
- El índice GIN de `busqueda` no se usa como `authenticated` (el `@@` no es leakproof): toda búsqueda es seq scan → `explorar.md`
- El prefijo no casa cuando lo tecleado rebasa la raíz del stemmer (`universi`, `diferencia`) → `explorar.md`
- Un `/` pega dos palabras en un solo token (`depa/dorm`) y ninguna de las dos lo encuentra → `explorar.md`
- El mínimo de 3 letras del prefijo se midió con 76 publicaciones: la amplitud crece con el catálogo → `explorar.md`
- Scroll infinito sin virtualización → `explorar.md`
- El log de contactos que falla se pierde → `confianza-ventas.md`
- No se guarda historial de búsquedas: "Recomendados para ti" solo usa intereses, contactos y favoritos → `explorar.md`
- El cursor de "Recomendados para ti" es un puntaje: quitar un favorito o un contacto a media lista puede saltar tarjetas hasta el siguiente refresh → `explorar.md`
- "Recomendados para ti" ordena TODO el alcance por puntaje en cada página (sin índice posible; 21 ms en "todo" con 80k) → `explorar.md`
- Un favorito o contacto sobre una publicación ajena hoy oculta no da señal al ranking (efecto de ser INVOKER) → CLAUDE.md §3, "Intereses y recomendados"
- ~~Una `pendiente` de un dueño ya suspendido se puede activar~~ **[CERRADA]** por `20261007000480` (trigger `dueno_no_activo`, en producción desde 2026-10-07) → `cuenta-perfil.md`
- `.easignore` es copia literal de `.gitignore` y no se ha verificado contra el tarball de un build real de EAS → CLAUDE.md §8, pendiente 0i

**Inventario de componentes reutilizables (`src/components/`) — no los
reconstruyas.** El porqué de cada uno vive en la regla de su feature; lo que es
del componente y no de la pantalla está en `componentes-compartidos.md`.

| Archivo | Exporta | Rol |
|---|---|---|
| `ActiveFilterChip` | `ActiveFilterChip` | Chip de filtro activo, con la ✕ para quitarlo |
| `AuthBody` | `AuthBody`, `AuthLogo`, `AuthHeadline`, `AuthSub`, `AuthLink`, `AuthLinkStrong`, `AuthTerms` | Las piezas de las pantallas de auth (`.auth-body`) |
| `Avatar` | `Avatar` | Punto ÚNICO de contacto con el bucket PÚBLICO `avatars`. **No** es `ListingPhoto` con otro nombre: sin token, por diseño |
| `BlinkingDots` | `BlinkingDots` | EL indicador de espera del sistema de diseño (`.splash-dots`) |
| `Buttons` | `PrimaryButton`, `GhostButton`, `DangerButton` | Los tres botones; `PrimaryButton` tiene `busy` ≠ `disabled` |
| `BuyerRow` | `BuyerRow`, `BuyerRowAvatarNeutro` | Fila de comprador con avatar y radio |
| `CampusBottomSheet` | `CampusBottomSheet` | `Modal` de RN real — **no** es `SheetScreen` |
| `CategoryTile` | `CategoryTile` | Tile de categoría con su tinte. `selected` opcional = `.cat-item.selected` (checkbox); sin la prop, navega como siempre |
| `CategoriasSelector` | `CategoriasSelector`, `alternar` | Rejilla de 3 de selección múltiple ("Intereses" y "Editar intereses"). **No** unificar con "Ver todas": esa navega, esta elige |
| `Chip` | `Chip` | Chip genérico |
| `ConfirmModal` | `ConfirmModal` | "Confirmar eliminar" / "Confirmar cerrar sesión" / "Confirmar eliminar cuenta". `children` es el único hueco (entre el cuerpo y los botones) y `confirmDisabled` apaga solo el confirm; sin hijos se ve igual que siempre |
| `EmptyState` | `EmptyState` | Estado vacío, con `.empty-actions` opcional |
| `ErrorState` | `ErrorState` | Estado de fallo con "Reintentar" (label hardcodeado — ver deuda) |
| `Field` | `Field`, `PhoneField`, `SelectField`, `FixedField` | Campos de formulario. **`PhoneField` vive aquí**, no en archivo propio. `FixedField` = valor que se muestra y no se elige (sin chevron, no es botón). `PhoneField` recibe `pais`/`onPaisPress`/`error` (el país es un botón). `Field` tiene `error` (`.field-error` + borde `--brick`), copy persistente: frame primero |
| `HojaAccionesListing` | `HojaAccionesListing` | Hoja de acciones de una publicación (pausar/reactivar, editar, marcar vendida/cambiar comprador, eliminar). `Modal` de RN, no `SheetScreen` — mismo criterio que `CampusBottomSheet`. Calcula internamente `puedeAlternarPausa()`/`puedeEditarListing()`/`accionVenta()`; consumida por "Mis publicaciones" y por el kebab de Detalle (vista vendedor) |
| `HojaSoporte` | `HojaSoporte` | Hoja de "Ayuda y soporte" de Perfil (WhatsApp y Correo). `Modal` de RN con el cascarón de `HojaAccionesListing`, sin ser su consumidor. Encapsulada: recibe solo `visible`, `onCerrar` y `correoUsuario`. Hoy es el único componente de `src/components` que llama `useToast` |
| `ListRow` | `FormHeader`, `SearchField`, `ListRow`, `RadioCircle` | Fila de lista, header de formulario y el radio que reusan 3 pantallas |
| `ListingFormFields` | `ListingFormFields` | EL formulario de publicación, compartido por Publicar y Editar |
| `ListingPhoto` | `ListingPhoto` | Punto ÚNICO de contacto con el bucket privado (header `Authorization`) |
| `Notice` | `Notice` | Aviso persistente (`.notice`) — hermano del `Toast`, no una variante |
| `NotifRow` | `NotifRow` | Fila del inbox de notificaciones |
| `OtpInput` | `OtpInput`, `OTP_LENGTH` | Los 6 dígitos; puramente presentacional |
| `PageHeader` | `PageHeader` | Header con chevron — **no** para pantallas raíz de tab |
| `PaisBottomSheet` | `PaisBottomSheet` | "Selector de país" del WhatsApp: `Modal` de RN con `FlatList` (245 filas estáticas). Hermano de `CampusBottomSheet`, no una variante |
| `PhotoCarousel` | `PhotoCarousel`, `PhotoDots` | Carrusel del hero y sus puntos; no guarda índice propio |
| `PhotoRow` | `PhotoRow`, `idFoto` | Fila de fotos con sus 4 estados y el contador `N/5` |
| `PhotoViewer` | `PhotoViewer` | Visor a pantalla completa (`Modal`, montado condicionalmente) |
| `ProductCard` | `ProductCard` | Tarjeta de grid — sin estado "vendida", a propósito |
| `PublicarFab` | `PublicarFab` | El FAB de Perfil; vive como hermano de `NativeTabs` (§9) |
| `RoundIconButton` | `RoundIconButton` | Botón circular de los headers sobre foto |
| `Screen` | `Screen`, `useScreenScrollViewRef` | Contenedor de pantalla con su `ScrollView` |
| `SectionHead` | `SectionHead` | Encabezado de sección con "Ver todo" |
| `SegmentedControl` | `SegmentedControl` | Control segmentado |
| `SheetScreen` | `SheetScreen` | Hoja de Stack `transparentModal` **declarada en el Stack raíz** |
| `Skeleton` | `SkeletonPiece`, `SkeletonGrid`, `SkeletonCatGrid`, `SkeletonRows`, `SkeletonNotifRows`, `SkeletonPerfilForm`, `SkeletonPerfil` | Un esqueleto por FORMA de lo que viene |
| `StarRating` | `StarRating` | Estrellas de Calificar |
| `StatusRow` | `StatusRow` | La `.status-section` fuera de Editar publicación. `sub` opcional: segunda línea seleccionable, hermana del `Pressable` (la usa `HojaSoporte`); sin `sub`, render idéntico |
| `Toast` | `ToastProvider`, `useToast` | Avisos efímeros; montado en el `_layout.tsx` raíz |
| `icons/` | `index.tsx`, `categories.tsx` | Todos los íconos del set |

---

## 9. Gotchas de infraestructura (para no re-descubrirlos)

- **`pg_default_acl` hace que los `grant` de columna sean inútiles sin un
  `revoke all` explícito primero.** Supabase otorga privilegios por default
  sobre cada tabla nueva de `public` a `anon`/`authenticated`/`service_role`.
  Un `grant select (columnas_seguras)` es puramente aditivo — no retira nada
  ya concedido. Cada bloque de grants en las migraciones lleva ahora un
  comentario explicando esto — **cualquier tabla nueva necesita el mismo
  patrón: revocar primero, otorgar después.**
- **`ON CONFLICT DO UPDATE` evalúa el `USING` de la policy contra la fila
  VIEJA.** O sea que un upsert que pretende cambiarle el DUEÑO a una fila falla
  siempre —`new row violates row-level security policy (USING expression)`—
  justo en el caso que pretende resolver. Y degradarlo a `DO NOTHING` no lo
  arregla: lo vuelve **silencioso** (`INSERT 0 0`, la fila ajena intacta, cero
  errores), que es peor. Cuando una fila debe cambiar de dueño, el patrón es un
  `before insert` `SECURITY DEFINER` que libere la fila perdedora, más un insert
  plano con `ignoreDuplicates` del lado del cliente. Medido en local; es lo que
  hace `push_tokens` (§3).
- **`pg_net` NO deja sus funciones donde dice su extensión.** La extensión queda
  en `extensions` (`create extension pg_net with schema extensions` funciona y
  `pg_extension` lo confirma), pero `http_post` y compañía viven en un esquema
  `net` propio que ella misma crea. La llamada correcta es **`net.http_post`**,
  no `extensions.net.http_post`. Con `search_path = ''` en el cuerpo —como exige
  el estilo de este repo— equivocarse ahí **no falla al crear la función**
  (plpgsql no resuelve nombres hasta ejecutarla): falla en runtime, con la fila
  ya insertada y el push perdido en silencio.
- **Las secret keys modernas no son JWT, así que NO van en
  `Authorization: Bearer`.** Este proyecto usa `sb_secret_…` (§1), y mandarla
  como Bearer desde `pg_net` hace que la plataforma intente parsearla como JWT y
  rechace con "Invalid JWT". Va en el header **`apikey`**, y la función tiene que
  llevar **`verify_jwt = false`** en `config.toml` —porque esa verificación
  integrada solo entiende las llaves legadas— autorizando en su propio código
  (`withSupabase({ auth: 'secret' })`). Verificado en local con los cuatro casos:
  sin llave → 401, llave inventada → 401, **publishable → 401**, secret → pasa.
  `verify_jwt = false` NO significa "función abierta"; significa que la
  autorización la hace la función.
- **Un `policy` no puede invocar una función `SECURITY DEFINER` sin que el rol
  invocante tenga `USAGE`/`EXECUTE` sobre ella** — aunque la función "corra
  con privilegios elevados", Postgres exige el permiso de invocación al rol
  que dispara la policy, no solo al dueño de la función.
- **Segfault reproducible y ya diagnosticado** (ver `supabase/KNOWN_ISSUES.md`
  para el detalle completo): una policy que referencia una función
  `SECURITY DEFINER` sin privilegio de ejecución, cuyo rechazo se captura
  dentro de un bloque `EXCEPTION` de PL/pgSQL, tumba el engine de Postgres
  local con `SIGSEGV`. Es la razón por la que `authenticated` tiene
  `USAGE`/`EXECUTE` sobre `is_active_user()` y `can_rate()` — no lo
  "endurezcas" quitando esos grants sin releer `KNOWN_ISSUES.md` primero.
- **Desde el 30 de mayo de 2026, Supabase ya no expone tablas nuevas al Data
  API por defecto.** Cualquier tabla que se agregue después necesita su
  `grant` propio o será invisible para el cliente aunque RLS esté bien
  configurado.
- **`supabase db push` no aplica `seed.sql`.** Solo `db start`/`db reset`
  locales lo corren. Para sembrar datos de referencia en remoto, usa
  `db push --include-seed` explícitamente.
- **Reemplazar un carácter especial por uno "inocente" no es lo mismo que
  quitarlo.** Si el reemplazo es un carácter común en los datos reales, el bug
  sobrevive con el mismo síntoma exacto y parece que el arreglo no se aplicó.
  Pasó con un comodín de búsqueda sustituido por un espacio: como
  prácticamente todo texto contiene un espacio, el patrón seguía casando con
  todo el catálogo — idéntico al problema original. La forma de detectarlo es
  preguntarse *"¿qué tan frecuente es el carácter de reemplazo en los datos?"*,
  no *"¿queda el carácter peligroso?"*. Y cuando no existe reemplazo seguro
  —el vacío suele ser igual de malo—, la respuesta correcta no es maquillar la
  entrada sino no construir la consulta.
- **Un índice de expresión solo lo usa el planner si la consulta repite esa
  expresión literalmente.** No basta con que sea "equivalente": si el cliente
  —PostgREST, un ORM, quien sea— no puede emitir esa expresión exacta, el
  índice nunca se elige y queda como peso muerto que se paga en cada
  `insert`/`update` sin dar nada a cambio. Y no avisa: las consultas siguen
  devolviendo resultados correctos, solo que por seq scan. La solución es
  materializar la expresión en una **columna generada** (`generated always as
  (…) stored`) e indexar la columna, que sí es referenciable por nombre desde
  cualquier cliente. Antes de dar un índice por bueno, confírmalo con
  `explain (analyze)` **y con suficientes filas**: con pocos datos el planner
  elige seq scan por costo y el plan no prueba nada en ninguna dirección.
  **Y con el ROL real, no como `postgres`** (el punto siguiente).
- **Bajo RLS, un operador que no es LEAKPROOF no puede usar su índice, así que
  un `explain` corrido como `postgres` MIENTE sobre el plan de la app.** Postgres
  evalúa las quals de una policy ANTES que cualquier condición del usuario que
  no sea leakproof. Así impide que una función filtre, por sus errores o efectos
  secundarios, datos de filas que la policy iba a esconder. Una condición
  obligada a ir después de la policy no puede ser condición de índice, porque el
  índice va primero. `@@` (`ts_match_vq`) tiene `proleakproof = f` (medido en
  `pg_proc`). Por eso, con 80 000 filas, la misma búsqueda sale **Bitmap Index
  Scan, 1.1 ms** como `postgres` (que es `bypassrls`) y **Seq Scan, 8.4 ms**
  como `authenticated`. Declarar un operador `LEAKPROOF` exige superusuario, y
  `postgres` no lo es en Supabase (medido en `pg_roles`: `rolsuper = f`), así que
  no hay salida por ahí. Tres consecuencias:
  - Mide los planes COMO `authenticated`, con `set local role authenticated` y
    `request.jwt.claims` dentro de un `begin … rollback`, e **imprime
    `current_user` y `rolbypassrls` antes de cada corrida**. Si no, no se sabe
    qué rol midió: es exactamente lo que dejó en este archivo durante meses un
    "0.9 ms con Bitmap Index Scan" que nadie puede rastrear (§3, búsqueda de
    texto).
  - No es exclusivo de `@@`. Pasa con cualquier operador o función no
    leakproof: `ilike`/`~~*` y los de arreglos o jsonb suelen no serlo. Antes de
    prometer un índice sobre una tabla con RLS, revisa
    `select proleakproof from pg_proc` de la función del operador.
  - La salida que queda es un `SECURITY DEFINER` que haga el match sin RLS y
    devuelva solo ids, con la RLS aplicada después. Es exactamente el tipo de
    fuga que `buscar_listings` evita siendo invoker, así que no se toma sin
    decisión explícita (deuda con disparador en `explorar.md`).
- **`order`/`limit` por `referencedTable` SÍ soportan una ruta punteada a DOS
  niveles de embed, no solo al nivel que ya usaba `fetchListings` (`fotos`
  directo sobre `listings`).** Hacía falta para `fetchFavoritos()` (`cuenta-perfil.md`,
  grupo Cuenta): la query parte de `favorites`, embebe
  `listing:listings!inner(...)`, y dentro de ese embed va otro,
  `fotos:listing_photos(...)` — o sea que acotar la portada a la de menor
  `orden` exige `referencedTable: 'listing.fotos'`, dos segmentos, no uno.
  El código fuente de `@supabase/postgrest-js`
  (`PostgrestTransformBuilder.order()`/`.limit()`) arma la clave del query
  param con una interpolación de string sin validar
  (`` `${referencedTable}.order` ``), así que el cliente no impone ningún
  límite de profundidad — pero eso no dice nada sobre si el SERVIDOR
  (PostgREST) la acepta. Se verificó con una prueba diferencial por HTTP
  directo contra el proyecto remoto, sin sesión (rol `anon`, sobre
  `/rest/v1/favorites`):
  - Con una ruta de dos niveles **inválida** (`listing.fotosxyz.order=…`,
    alias que no existe) → `400 PGRST108 "'fotosxyz' is not an embedded
    resource in this request"`. O sea que SÍ camina el path segmento por
    segmento y valida cada uno contra los embeds reales de la request.
  - Con la ruta real (`listing.fotos.order=orden.asc` +
    `listing.fotos.limit=1`) → deja de aparecer ese error y la respuesta pasa
    a `42501 permission denied for table favorites` (esperado: `anon` no
    tiene grant sobre `favorites`, y no tiene nada que ver con la sintaxis).
  - La diferencia entre ambas pruebas ES la prueba: un path de dos niveles
    sintácticamente inválido se detecta y rechaza distinto (400, antes de
    tocar la base) de uno válido que solo tropieza después, en la
    autorización (42501). Con `authenticated` (el rol real del cliente) ese
    42501 no ocurre —`favorites` sí tiene `grant select` para
    `authenticated`—, así que la consulta completa corre hasta el final.
- **`postgres` no es dueño de `storage.objects` y aun así puede politiquearla
  — Y TAMBIÉN ponerle triggers.** La dueña es `supabase_storage_admin` y
  `postgres` ni siquiera es miembro de ese rol, así que `create policy` debería
  fallar con 42501 "must be owner of table objects". No falla porque
  `supautils.policy_grants` lista `storage.objects` para `postgres` — verificado
  en `pg_settings` en local **y** en remoto. Por eso las policies de Storage
  viven en una migración versionada normal y no hay que crearlas a mano en el
  Dashboard. Si algún día una migración de Storage sí revienta con 42501, ese
  ajuste es lo primero que hay que mirar.
  **El nombre del setting engaña: no se limita a las policies.** Medido en local,
  `postgres` crea sin error un trigger sobre `storage.objects`, incluso con
  cláusula `WHEN` filtrando por `bucket_id` — que es lo que haría viable un
  disparador HTTP por bucket sin pasar por el Dashboard. Eso NO está medido en
  remoto (crearlo ahí es una escritura, no una consulta); lo único verificado en
  remoto es que el `supautils.policy_grants` es idéntico, así que la expectativa
  es razonable pero no comprobada. Si una migración de trigger sobre Storage
  revienta con 42501 en remoto, esta es la diferencia que hay que mirar primero.
- **Un bucket no viaja por `supabase db push`.** Buckets y objetos son FILAS de
  las tablas de `storage`, no esquema. Se declaran en `config.toml` y se aplican a
  remoto con `supabase seed buckets --linked`. En local los crea `supabase start`
  y también `db reset` (lo imprime: "Creating Storage bucket: …"), así que ahí no
  hay paso extra.
- **Las fotos se leen por el endpoint autenticado, NO por signed URLs, y no es
  una preferencia de estilo.** Una signed URL evalúa la RLS **al firmar, no al
  servir**: el token lleva el permiso adentro. O sea que una URL firmada antes de
  que el vendedor pausara su publicación **sigue entregando la foto** hasta que
  caduque, y los propios docs de Supabase lo dicen sin rodeos — *"revoking or
  expiring a token does not purge its CDN cache entry… if you need to cut off
  access, delete the object"*. Eso rompe exactamente la regla que motivó hacer el
  bucket privado. Con
  `GET /storage/v1/object/authenticated/listing-photos/<path>` + `Authorization:
  Bearer <access_token>`, la policy se re-evalúa en **cada** request y pausar
  surte efecto de inmediato.
  Migrar a signed URLs se ve como una simplificación —los docs incluso las llaman
  *"the primary way"* para buckets privados— y **no es equivalente**: es un cambio
  de semántica de seguridad disfrazado de refactor, del mismo tipo que el
  reemplazo del comodín de búsqueda de más arriba. Si alguien lo propone, la
  pregunta no es "¿se ve igual?" sino "¿cuándo se evalúa el permiso?".
  Consecuencia obligatoria: **el componente de imagen tiene que ser `expo-image`**
  (ya es dependencia), no el `<Image>` de React Native — ese documenta `headers`
  pero arrastra bugs abiertos en Android/Fresco, varios reportando que funcionan
  en la arquitectura vieja y no en la nueva, y este proyecto corre RN 0.86 con New
  Architecture.
- **`remove()` de Storage no falla: devuelve 200 con una lista vacía.** El
  endpoint que usa `supabase.storage.from(b).remove(paths)` —`DELETE
  /storage/v1/object/{bucket}` con `{prefixes}`— resuelve primero qué objetos
  **VE** el invocante y borra esos. Si la RLS de **SELECT** no se los muestra, la
  lista sale vacía, responde **HTTP 200 con `[]`** y `error` llega **null**: el
  objeto sigue ahí y el cliente no tiene de qué enterarse. No es el
  comportamiento del endpoint de un solo objeto (`DELETE
  /object/{bucket}/{ruta}`), que sí contesta **400 `AccessDenied`** — medidos los
  dos, en local, contra el mismo estado. Dos consecuencias que ya aplican hoy:
  - **La policy de SELECT de un bucket es parte del camino de BORRADO**, no solo
    de lectura. "Endurecerla" o quitarla convierte cada borrado en un huérfano
    silencioso. Es la razón por la que `avatars_objects_select` existe en un
    bucket que ni siquiera necesita RLS para leerse (es público), y por la que su
    aserción en `probe-storage.mjs` cuenta objetos en vez de mirar el status:
    medido, un `permitido(res)` pasa en verde con la policy borrada.
  - **En `listing-photos` ya pasa**, sin cambiarle nada. El orden invertido que
    `src/lib/storage.ts` prohíbe —borrar el listing ANTES que sus objetos, lo que
    rompe el `exists` de `listing_photos_objects_select`— falla exactamente así:
    medido con las policies intactas, `200 []`, el objeto en su sitio, cero
    avisos. La nota de `publicar-fotos.md` decía que quedaban huérfanos; lo que
    le faltaba es que además **no avisa**.

  Corolario para cualquier borrado nuevo: **revisar el ARRAY devuelto, no solo
  `error`**. Es la misma familia que el `ON CONFLICT DO NOTHING → INSERT 0 0` de
  `push_tokens`, el `using` de UPDATE que filtra en vez de lanzar
  (`listings_update_own`, `listing_sales_update_seller`) y el `expect_error` que
  acepta cualquier error: en este repo, *lo que no lanza* es lo que hay que mirar
  dos veces.

  **Y `borrarFotos()` (`src/lib/storage.ts`) sigue sin revisar ese array a
  propósito — el corolario no se aplicó ahí, y no es un descuido.** Al cerrar el
  bug de "Eliminar" en "Mis publicaciones" (una cuenta suspendida veía un falso
  éxito, `cuenta-perfil.md`), la primera versión del fix sí volvía estricta a
  `borrarFotos()` — y se descartó, porque la lista vacía que devuelve `.remove()`
  es AMBIGUA entre dos causas indistinguibles desde esa respuesta: un objeto que
  la RLS esconde (rechazo real) y un objeto que YA NO EXISTE porque un intento
  anterior sí lo borró. Como el orden `borrarFotos()` → `borrarListing()` es
  obligatorio (`listing_photos_objects_delete_own` exige que la fila de
  `listings` exista todavía) y no se puede invertir para resolver la ambigüedad
  desde el otro lado, una `borrarFotos()` estricta lanzaría sobre un REINTENTO
  legítimo — fotos ya borradas en el intento anterior, `borrarListing()` falló
  solo esa vez por una razón de red — y dejaría la publicación imposible de
  eliminar desde la app para siempre. El candado se puso solo en
  `borrarListing()` (`{count:'exact'}`, lanza `ListingNoBorrableError` si
  `count === 0`), que no tiene este problema: borra por `id`, no por un conjunto
  de rutas que cambia de significado entre reintentos.

  **Y ese `count === 0` de `borrarListing()` tiene la MISMA ambigüedad de dos
  causas, sin poder distinguirlas sin una consulta aparte**: un rechazo real
  (la fila no es tuya, o estás suspendido) o la publicación YA se había borrado
  antes (doble toque con la respuesta perdida, otro dispositivo, un reintento
  justo después de que el borrado del servidor sí se hubiera completado). Las
  dos dan el mismo toast genérico de error, y eso se documenta, no se resuelve.
  **Mitigación, sin consulta extra**: `mis-publicaciones.tsx` y
  `detalle/[id].tsx` reconcilian la UI con el servidor cuando cae
  `ListingNoBorrableError` — un refetch silencioso (`refrescar()`/
  `cargarDetalle(id,{silent:true})`) sin quitar el toast de error, para que un
  reintento sobre algo ya borrado haga desaparecer la tarjeta en vez de quedar
  atorado repitiendo el mismo error. `editar/[id].tsx` se queda SIN esa
  reconciliación — límite conocido, no un hueco escondido.
- **No se puede borrar de `storage.objects` por SQL, ni siquiera como
  `postgres`.** El trigger `storage.protect_delete` aborta con *"Direct deletion
  from storage tables is not allowed. Use the Storage API instead."* y se dispara
  **antes** que la RLS. Consecuencia para las pruebas: una aserción de DELETE
  escrita en SQL pasaría con la policy borrada — por la razón equivocada. Esa
  cobertura tiene que vivir en `scripts/probe-storage.mjs`, contra el API HTTP.
- **`expo-image-picker` entrega HEIC crudo por default, y su propio JSDoc dice
  lo contrario.** Las fotos de la cámara del iPhone son HEIC; el bucket solo
  acepta jpeg/png/webp. Sin `preferredAssetRepresentationMode: 'compatible'`,
  elegir una foto tomada con el teléfono falla de dos formas (vistas en
  dispositivo real): `FailedToReadImageException: Cannot load representation of
  type public.heic` al leerla, o —si sí se lee— llega con `mimeType:
  image/heic` y Storage la rechaza. **Corregido** (`publicar-fotos.md`, deja de ser el motivo
  dominante de fallos de subida — ver pendiente 1).
  Lo que hay que saber antes de "simplificar" esto:
  · El default REAL es `.current` (`ios/ImagePickerOptions.swift:44`), que
    significa literalmente "evita transcodificar". El JSDoc de
    `ImagePicker.types.d.ts` afirma que es `Automatic`: **está mal, y gana el
    código**.
  · **`quality` NO convierte el formato.** `ios/ImageUtils.swift`,
    `readDataAndFileExtension()`, tiene una rama explícita
    `case UTType.heic.identifier: return (rawData, ".heic")` — el HEIC sale tal
    cual sin importar el `quality`, que solo actúa en la rama `default`. Si ves
    un comentario diciendo que `quality` fuerza JPEG, es falso: ya estuvo
    escrito aquí y este bug es lo que lo desmintió.
  Con `.compatible`, iOS entrega una representación JPEG,
  `registeredTypeIdentifiers.first` pasa a `public.jpeg`, cae en el `default` y
  sale `.jpg`. Es iOS-only; en Android se ignora.
- **`quality` tampoco comprime un PNG — hermano del punto anterior, otra rama
  del mismo `switch`.** El `quality: 0.8` del picker llevaba un comentario
  afirmando que servía "para no acercarse al tope de 5 MiB". Es falso para
  cualquier PNG, y por eso **todo screenshot de iPhone fallaba siempre** con
  `EntityTooLarge` (medido en producción: 6,598,919 bytes contra un tope de
  5 MiB). En `ios/ImageUtils.swift:130-132`:

  ```swift
  case UTType.png.identifier:
    let data = image.pngData()   // sin parámetro de compresión
    return (data, ".png")
  ```

  `options.quality` solo se aplica en la rama `default`, vía
  `image.jpegData(compressionQuality:)`. Un PNG sale sin tocar, a resolución
  completa.
  El corolario que importa más allá de este bug: **`allowed_mime_types` protege
  el TIPO, pero el TAMAÑO no lo protege nadie del lado del cliente** — el
  servicio de Storage lo rechaza y punto. Por eso la normalización a JPEG de
  `normalizar()` (`src/lib/foto-picker.ts`) no es una optimización: es lo único
  que hace publicable un screenshot. Y por eso el picker ahora va con
  `quality: 1` — comprimir dos veces la misma foto no gana nada, y con
  `quality >= 1.0` esa rama `default` devuelve `rawData` sin re-codificar.
- **El bucket valida el `content-type` DECLARADO, no los bytes.** Medido contra
  el Storage API local con bytes HEIC reales: declarados `image/heic` →
  **HTTP 400**; los MISMOS bytes declarados `image/jpeg` → **HTTP 200**. O sea
  que `allowed_mime_types` protege contra un cliente honesto que manda un
  formato no soportado, pero no detecta uno que se equivoque de etiqueta. Por
  eso `mimeDe()` en `src/lib/storage.ts` nombra explícitamente las extensiones
  que conoce y no soporta (`heic`, `heif`, `tiff`, `avif`, `gif`, `bmp`) en vez
  de caer a `image/jpeg` para todo lo desconocido: ese fallback "inocente"
  guardaría bytes HEIC bajo un tipo que miente, Android no los podría pintar, y
  el error aparecería lejísimos de su causa.
- **`Cannot find native module 'X'` no siempre significa "estás en Expo Go"** —
  tiene DOS causas posibles, y las dos aplicaron a este proyecto en la misma
  tarea (RF-16, push), aunque solo una quedó confirmada con el mensaje exacto
  en pantalla (`Cannot find native module 'ExpoPushTokenManager'`; la otra es
  la causa obvia y documentada de Expo Go, no algo que se haya visto reventar
  aquí). No asumas cuál es sin mirar:
  - **Expo Go.** Nunca lleva módulos nativos de terceros (los quitó desde el
    SDK 53), así que importar `expo-notifications` ahí explota siempre.
  - **Un dev build STALE.** Confirmado en este proyecto: el proceso en
    foreground SÍ era el dev build (`launchctl list` mostraba
    `com.enrique-macias.enrique-macias`, no `host.exp.Exponent`) y aun así
    explotaba con el mismo mensaje. Causa: el simulador booteado era uno de
    los **tres** "iPhone 17 Pro" que Xcode tiene creados, cada uno en un
    runtime de iOS distinto (26.1/26.2/26.5), y el que estaba abierto tenía un
    `relevomarketplace.app` instalado **antes** de que `expo-notifications`
    existiera en el proyecto — Metro le servía el JS nuevo sobre un binario
    nativo viejo. Mismo síntoma que Expo Go, causa opuesta: no "abriste la app
    equivocada", sino "el simulador correcto tiene el binario equivocado".
  **Cómo distinguirlas antes de asumir**: `xcrun simctl list devices booted`
  para ver CUÁL simulador está activo, y
  `xcrun simctl spawn <udid> launchctl list | grep UIKitApplication` para ver
  qué bundle id está en foreground — `host.exp.Exponent` es Expo Go,
  `com.enrique-macias.enrique-macias` es el dev build. Si es el dev build y
  aun así falta el módulo, el fix no es "cambiar de app" sino reconstruir:
  `npx expo run:ios --device <udid>` (recompila con el pod ya resuelto en
  `ios/Podfile.lock` si `expo install` ya corrió, sin volver a bajar nada).
  **La regla general**: agregar cualquier módulo nativo o config plugin
  invalida TODOS los binarios ya instalados, en todos los simuladores/
  dispositivos — Fast Refresh actualiza el JS, nunca el nativo.
- **Un elemento visualmente sobre `NativeTabs` puede no recibir touch si vive
  dentro del contenido de una pantalla del Tabs en vez de como hermano del
  navegador.** Pasó con el FAB de "Publicar": se pintaba perfectamente sobre el
  tab bar y no respondía a un solo toque. No es un problema de `zIndex` ni de
  `elevation`, y **subir el `bottom` no lo arregla** — solo aleja el botón de la
  zona muerta sin explicar nada.
  El mecanismo, leído en el código y no deducido: `NativeTabs` monta un
  `Tabs.Host` de react-native-screens, cuyo contenedor nativo en Android
  (`TabsContainer.kt`) es un `FrameLayout` que hace, en este orden,
  `addView(contentView)` y `addView(bottomNavigationView)`. El hit-testing de un
  `FrameLayout` recorre sus hijos en orden INVERSO, así que todo toque dentro
  del rectángulo del tab bar lo reclama el tab bar antes de que el contenido lo
  vea. `elevation`/`zIndex` de RN solo ordenan hermanos DENTRO del subárbol de
  RN, y el tab bar nativo no es uno de ellos — por eso se puede ganar el dibujo
  y perder el toque a la vez. En iOS el reparto es equivalente
  (`UITabBarController` con la barra como hermana de la vista del hijo).
  **La solución es dónde vive el componente, no cuánto mide su offset**: va como
  hermano del navegador en `(tabs)/_layout.tsx`
  (`<View><NativeTabs/>{...}<Fab/></View>`), que sí lo deja en la misma
  jerarquía de RN que el host y después de él. Envolver el navegador en un
  `View` no le molesta a Expo Router: la ruta se arma desde el sistema de
  archivos y los `Trigger`, no desde la posición del navegador en el JSX.
  Dos cosas que se investigaron y NO sirven aquí: `NativeTabs.BottomAccessory`
  es **iOS 26+** y es la barra accesoria de `UITabBarController` (un mini
  reproductor), no un FAB ni algo multiplataforma; y `useBottomTabBarHeight()`
  existe pero es del navegador de tabs en JS de react-navigation, no de
  `NativeTabs` — este no expone su altura a JS, así que despejar la barra exige
  constantes por plataforma (ver `src/components/PublicarFab.tsx`). La doc
  oficial de Expo no cubre el caso.
- **`NativeTabs.Trigger.Icon` no acepta un componente SVG de
  `react-native-svg` como `src` — solo `VectorIcon` o una imagen estática.**
  `node_modules/expo-router/build/native-tabs/utils/icon.js:50-67`
  (`convertComponentSrcToImageSource`) solo reconoce dos tipos de elemento
  React en `src`: `NativeTabs.Trigger.VectorIcon` (wrapper de
  `@expo/vector-icons`) o un `PromiseIcon` interno que **no está exportado
  públicamente** desde `expo-router/unstable-native-tabs` (verificado con
  grep sobre los `.d.ts` públicos). Cualquier otro elemento —incluido un
  `<Svg>` propio— cae al `else` y produce
  `console.warn('Only VectorIcon is supported as a React element in
  Icon.src')`, con el ícono quedando `undefined` en silencio (sin error, sin
  crash — otro más de los fallos silenciosos que este proyecto ya viene
  coleccionando). La única vía soportada para un ícono custom es `src` como
  `ImageSourcePropType` (`require(...)` de un PNG), en la forma
  `{ default, selected }` que documenta el tipo `SrcIcon`
  (`node_modules/expo-router/build/native-tabs/common/elements.d.ts:19-47`).
  Por eso los 4 íconos del tab bar (`scripts/generate-tab-icons.mjs`) se
  generan como bitmaps con `sharp` en vez de reusar los componentes `Icon*`
  de `src/components/icons/index.tsx` directamente.

  **Esas formas viven ahora en TRES lugares que pueden desincronizarse, sin
  ningún import que los conecte:** `design/relevo-app.html` (fuente de
  verdad del diseño), `src/components/icons/index.tsx`
  (`IconSearch`/`IconHeart`, que sirven a otro frame — el search field y el
  botón de favorito, no el tab bar) y `scripts/generate-tab-icons.mjs` (copia
  inline de las mismas shapes, con `stroke-linecap`/`stroke-linejoin`
  agregados a propósito porque el `.tabbar` del HTML los lleva y esos dos
  componentes no). Un cambio futuro al `d` de `IconSearch` o `IconHeart` —o
  al HTML del `.tabbar`— **no se propaga solo** a los otros dos lugares:
  **revisar los tres a mano** si el diseño de Buscar/Favoritos cambia.

  **Segundo hallazgo, medido en simulador y no en el código: un PNG local sin
  sufijo de densidad (`@2x`/`@3x`) lo trata Metro como la versión `@1x` sin
  importar sus píxeles reales.** El primer intento generó un solo archivo de
  84×84 por ícono (pensando que el tab bar nativo iba a decidir el tamaño
  final igual que decide el de un SF Symbol) y el resultado en el simulador
  fue un ícono de **84 puntos**, no de 21 — desbordó la tab bar entera y
  empujó el contenido de arriba. Este proyecto no tenía, hasta esta tarea,
  ningún precedente de imagen local embebida en el bundle de JS (las fotos y
  avatares son remotos, vía Supabase Storage — ver §3), así que no había
  ningún caso ya resuelto para copiar. El fix es generar el trío
  `nombre.png`/`nombre@2x.png`/`nombre@3x.png` (21/42/63px para el tamaño de
  21px del HTML) — `scripts/generate-tab-icons.mjs` ya lo hace así. Si algún
  día se agrega OTRO ícono/imagen local al bundle (no remota), este es el
  primer punto a revisar: un solo archivo sin sufijo de densidad **no falla
  ni avisa**, simplemente se renderiza al tamaño equivocado.
- **`presentation:'transparentModal'` de un Stack anidado no funciona si el
  Stack padre ya presenta esa ruta como card opaca.** El navegador que de
  verdad ejecuta el `push` (a menudo el Stack raíz, no el Stack del grupo
  donde vive el archivo) es el que decide cómo se presenta la transición.
  Una hoja/modal transparente debe declararse en el Stack que realmente
  monta esa ruta — moverla de un grupo anidado a una ruta de nivel raíz
  (como se hizo con `selector-campus.tsx`/`filtros.tsx`) resuelve esto sin
  tener que migrar a un `Modal` de RN.
- **`supabase config push` empuja el `config.toml` ENTERO, y en este repo eso
  puede tumbar el correo de producción.** La config de Auth no viaja con
  `db push` (eso son solo migraciones); el comando que la lleva a remoto es
  `supabase config push`, y **no se usa aquí**. El motivo no es genérico: nuestro
  `config.toml` es un archivo de desarrollo local, así que empujarlo se llevaría
  `[auth.email.smtp]` **comentado** —y remoto usa **Resend** como SMTP custom
  (§1), o sea que un push podría dejar al proyecto sin mailer y romper el OTP de
  RF-01 y el de RF-04 a la vez—, más `email_sent = 2` (2 correos por HORA),
  `site_url = "http://127.0.0.1:3000"` y la plantilla de magic link que está puesta
  a mano en el dashboard. Lo que haya que cambiar en remoto se cambia en el
  dashboard, misma categoría que los secretos de Vault de push: Auth → Email
  Templates para las plantillas, Auth → Sign In / Providers → Email para el mínimo
  de contraseña.
- **`minimum_password_length` NO se aplica en el admin API de GoTrue — el corte es
  por LLAVE, no por endpoint.** Medido contra el stack local con el mínimo en 8, con
  una contraseña de 7 caracteres:

  | Endpoint | Llave | Resultado |
  |---|---|---|
  | `POST /auth/v1/signup` | publishable | **422** `weak_password` |
  | `PUT /auth/v1/user` (`updateUser`) | bearer de sesión | **422** `weak_password` |
  | `POST /auth/v1/admin/users` | **secret** | **200** — la crea |

  Todo lo alcanzable con la publishable o con una sesión valida; lo que exige la
  secret key está exento. Es coherente —quien tiene esa llave ya puede crear
  usuarios, cambiar correos y borrar cuentas— pero **es comportamiento medido, no
  intención documentada**: los docs de Supabase no mencionan la exención.

  Dos consecuencias prácticas. La primera: subir el mínimo **no impide** crear una
  cuenta con una contraseña débil desde Studio o `service_role`, así que no es un
  candado contra un admin descuidado, solo contra los usuarios. La segunda:
  `scripts/probe-{storage,venta}.mjs` crean sus usuarios por ese admin API, así que
  son **inmunes** a este valor — y el comentario que decía que los salvaban los 10
  caracteres de `'probe-1234'` era falso; está corregido en los dos archivos. Lo que
  sí importa es que `PUT /user` valide, porque es el ÚNICO camino donde la app fija
  una contraseña ("Completar perfil" y "Nueva contraseña"): ahí el `MIN_PASSWORD`
  del cliente traduce la regla, no la sustituye.

  **El Auth Hook "Before User Created" sigue el MISMO corte por llave** (medido,
  `probe-registro.mjs` caso 7): `POST /admin/users` con la secret key crea una
  cuenta `@gmail.com` aunque el hook rechace ese dominio en `/otp`. Studio,
  `service_role` y los `probe-*.mjs` que crean usuarios por `/admin/users` quedan
  fuera de las reglas de alta de GoTrue: la de fortaleza de contraseña y la de
  dominio.

  **Pero NO todo lo que usa la secret key salta el hook: `/invite` NO lo salta.**
  Medido el 2026-09-29 (Paso 0 de la Ola 1 de RF-17), con la misma secret key:
  `POST /auth/v1/invite` (`auth.admin.inviteUserByEmail`) de `@rlvo.com.mx` →
  **403 `dominio_no_participante`**, sin fila ni correo; de `@tec.mx` → 200;
  `POST /auth/v1/admin/users` de `@rlvo.com.mx` → 200. O sea que el corte no es
  "secret key sí o no" sino **por endpoint**, y la invitación cuenta como alta.
  Por eso las cuentas de admin nacen por `/admin/users` y fijan su contraseña
  con el código de recuperación (`scripts/crear-admin.mjs`). Antes de asumir que
  un endpoint de admin salta el hook, se mide ESE endpoint. **En REMOTO** (GoTrue
  v2.197.0, 2026-10-02) `POST /admin/users` también salta el hook: la cuenta
  `@rlvo.com.mx` del primer admin se creó sin que `rlvo.com.mx` esté en
  `universidad_dominios`. Lo mismo vale para un correo personal de admin: los dos
  admins con correo personal se crearon por ese endpoint (2026-10-02 y
  2026-10-03).
- **Un Auth Hook de Postgres que lanza una excepción le manda su TEXTO al
  cliente.** Medido con un `raise exception 'CONTROL ROTO'`: GoTrue responde
  `500` y `msg: "CONTROL ROTO"`, y auth-js lo pone en `error.message`. Nada que
  no deba leer el usuario (nombres de tabla, datos de otra fila) va en un
  `raise` dentro de un hook, porque termina en pantalla. Mismo medido: la
  excepción falla CERRADO (no se crea el usuario), así que no hay que
  atraparla por seguridad. El hook de dominios no lanza nunca: devuelve el
  objeto `error` que pide la doc.
- **La regla `react-hooks/set-state-in-effect` no detecta el patrón cuando el
  guard lee un ref antes del `setState`.** Verificado con 4 variantes mínimas
  linteadas una por una: un `if (!valor) return` sobre un `useState`/prop normal
  SÍ se marca, y el mismo guard SÍ se marca si en cambio no hay ningún guard —
  pero en cuanto el guard es `if (!miRef.current) return`, la regla deja de
  reportar el `setState` que sigue, sin importar que el código sea
  funcionalmente idéntico. El análisis estático no puede probar que una lectura
  de ref sea determinista, así que renuncia a inferir que ese `setState` es
  alcanzable, y no reporta nada — no es que el patrón esté bien, es que dejó de
  poder verlo. Así pasó con `useListings` (`src/lib/listings.ts`): su guard leía
  `paramsRef.current`, y por eso nunca se marcó a pesar de tener el mismo
  reseteo-dentro-del-efecto que si se hubiera escrito `useMisListings` sin la
  corrección. **No asumas que un hook que no marca la regla está libre de
  esto** — pruébalo aislado (un archivo con variantes mínimas, linteado y
  borrado) antes de concluir que hay una diferencia real de fondo.

- **Un `exclude` de `tsconfig.json` no manda el código a otro compilador: lo
  manda a NINGUNO, y no avisa nunca.** `supabase/functions` está excluida del
  tsconfig de la app por una razón correcta —es código Deno con specifiers
  `npm:` que el tsconfig de Expo no resuelve, y sin el exclude `npx tsc
  --noEmit` falla con 4 errores que no son errores—, y de ahí es facilísimo
  concluir que "Deno ya la typecheará". **No la typechea nadie**: `deno` no está
  instalado en esta máquina, y `supabase functions deploy` empaqueta sin
  verificar tipos. Medido: al correr `tsc` a mano sobre esa carpeta por primera
  vez apareció un error REAL y preexistente (`env.ts`, un predicado `n is
  string` no asignable al tipo de su parámetro) que llevaba ahí desde que se
  escribió el archivo. **Fix aplicado:** `supabase/functions/tsconfig.json` +
  `shims.d.ts`, corridos con `npm run check:functions`. El alcance es honesto y
  está escrito en `shims.d.ts`: caza typos, nombres inexistentes y argumentos
  que no cuadran; **no** verifica el contrato de `@supabase/server`, que se
  declara sin tipar a propósito —transcribir las firmas de un paquete que no
  está en disco es el mismo patrón de dos-copias-que-se-desincronizan que este
  repo ya documenta en `probe-venta.mjs`, y una firma transcrita mal daría luz
  verde con apariencia de verificado—. **La regla general:** cada vez que
  excluyas una carpeta de un compilador o un linter, la pregunta no es "¿por qué
  la excluyo?" sino "¿quién la mira ahora?". Si la respuesta es "otra
  herramienta", confirma que esa herramienta existe en la máquina y que alguien
  la corre.

- **El gemelo del gotcha de arriba, pero para ESLint: `npm run lint` no
  excluye `supabase/functions` por config — lo excluye por SCOPE por default,
  que es el mismo efecto con una causa distinta y más fácil de pasar por
  alto.** `expo lint` sin argumentos solo escanea `/src`, `/app`, `/components`
  (lo dice su propio `--help`, no un archivo de config visible), así que
  "corre `npm run lint`, sale limpio" nunca fue evidencia sobre esa carpeta —
  ni siquiera la tocaba. Se destapó respondiendo a una pregunta directa del
  usuario ("¿lint y typecheck ESTÁNDAR pasan sobre lo tocado?"): correr
  `npx eslint` directo sobre la carpeta encontró un `import/no-unresolved`
  sobre `npm:@supabase/server` (falso positivo — el resolver de TypeScript no
  entiende specifiers `npm:`, que sí resuelve Deno) y un
  `@typescript-eslint/no-unused-vars` real sobre un `const config =` que
  todavía no se consumía en ningún lado. **Fix:** `"lint": "expo lint src
  supabase/functions"` en `package.json`, más un override en `eslint.config.js`
  con `"import/no-unresolved": ["error", { ignore: ["^npm:"] }]` — la opción
  `ignore` acota el perdón al patrón `npm:`, no apaga la regla entera para la
  carpeta. **Ese matiz importa y casi se pierde:** la primera versión del
  override sí apagaba la regla completa (`"off"`), y un control negativo lo
  delató — un import relativo roto de verdad (`./archivo-que-no-existe.ts`)
  dejaba de reportarse ahí. Con `ignore: ['^npm:']` ese mismo control vuelve a
  caer. **La lección no es solo "revisa el scope del linter":** es que un
  override "para silenciar un falso positivo" necesita su propio control
  negativo, con la misma disciplina que una policy de RLS — de otro modo
  apaga más de lo que dice apagar.

- **Un `DELETE` (o `UPDATE`) con `WHERE` aplica TAMBIÉN la policy de SELECT a
  las filas que filtra, así que una aserción de borrado "con filtro" no prueba
  la policy de DELETE.** Medido con la policy de DELETE aflojada a
  `using (true)` (T34 (c), 2026-09-27):
  `delete from user_intereses where user_id = <ajeno>` → **`DELETE 0`**;
  `delete from user_intereses` sin `where` → **`DELETE 2`**, las ajenas
  incluidas. La de SELECT (`user_id = auth.uid()`) escondía las filas ajenas
  del `WHERE`, así que la aserción pasaba por la policy equivocada. Es la
  familia de "lo que no falla es lo que hay que mirar dos veces", ahora del
  lado de las pruebas. **Cómo aplicarlo:** para probar SOLO la policy de
  DELETE/UPDATE, la sentencia va sin `WHERE` sobre columnas (y sin
  `RETURNING`), y la comprobación se hace después como `postgres`. Y cuando
  una tabla tiene la misma condición en SELECT y DELETE, un control negativo
  que afloje una sola de las dos no dice nada hasta que la aserción deje de
  depender de la otra.
- **`iat` NO prueba que el usuario escribió su contraseña hace poco; `amr` sí.**
  Medido contra GoTrue local (B0 de "Eliminar cuenta", 2026-09-26): un refresh
  de sesión emite un access token con `iat` NUEVO sin pedir nada, y conserva el
  `amr` intacto — `login: iat …353, amr password @…353` → `refresh: iat …356,
  amr password @…353` → `relogin: iat …358, amr password @…358`; una sesión por
  OTP trae `amr: [{method: 'otp'}]`. O sea que exigir "token reciente" para una
  acción sensible lo pasa cualquier app abierta con solo esperar al refresh. Lo
  que hay que exigir es una entrada `password` de `amr` con `timestamp` reciente
  (`supabase/functions/eliminar-cuenta/reautenticacion.ts`). Y el corolario: un
  JWT sigue verificando por firma hasta su `exp` aunque la cuenta ya no exista —
  `withSupabase({ auth: 'user' })` no pregunta a Auth (medido: un segundo
  `invoke` con el mismo token tras `deleteUser` da 200).
- **Confirmar que un campo EXISTE no es confirmar su FORMA, y con un shim sin
  tipar la diferencia sale como un 401.** El E-spike de `@supabase/server` leyó
  los `.d.mts` publicados y confirmó correctamente que `ctx.userClaims` existe;
  de ahí se escribió `ctx.userClaims?.sub`, por convención de JWT. **Está mal:**
  `userClaims` es el usuario YA NORMALIZADO (`{ id, role, email, appMetadata,
  userMetadata }`) y el `sub` vive en `ctx.jwtClaims`, que es otro objeto.
  Medido contra el runtime local. Dos cosas que lo hacen peor que un typo
  normal: `npm run check:functions` **no lo caza** —el shim deja `ctx` sin tipar
  a propósito (`supabase/functions/shims.d.ts`), y esa es justamente la parte
  del alcance que ese archivo declara no cubrir—, y el síntoma es un
  `401 "sin identidad en el JWT"`, que se lee como problema de credenciales y
  manda a revisar llaves y headers en vez del nombre de un campo. **La regla:**
  de un paquete que no está en disco, los tipos publicados te dicen qué existe;
  la FORMA se mide llamándolo. Un endpoint de debug que imprima el contexto
  cuesta dos minutos y es lo que lo destapó.

- **Un `grep` sobre salida con colores ANSI puede no machear aunque el texto
  esté ahí — y el falso negativo se lee como "el control pasó".** `tsc` imprime
  `error TS2677` con códigos de escape EN MEDIO (`\e[91merror\e[0m\e[90m TS…`),
  así que `grep -E "error TS"` no encuentra nada sobre una salida que sí trae el
  error. Pasó al correr el control negativo de `check:functions`: el control se
  vio verde y la conclusión natural —"el chequeo nuevo no sirve"— era justo la
  contraria de la verdad. Es la misma familia que el comodín de búsqueda
  reemplazado por un espacio, unos puntos más arriba: el patrón seguía pareciendo
  razonable y el resultado seguía siendo mentira. **Cómo evitarlo:** cuando un
  control negativo dé verde, mira la salida COMPLETA antes de concluir nada — o
  grepea una sola palabra (`error`, `FALLÓ`) en vez de una frase que los códigos
  puedan partir.

- **Una verificación que sale sospechosamente limpia suele estar midiendo otra
  cosa — y el síntoma es siempre el mismo: NADA falla.** Es la forma general de
  un error que en esta tanda apareció con tres disfraces distintos en una sola
  tarea (RF-18 Ola 2). En los tres, el comando devolvió 0, el script imprimió su
  resumen feliz, y el resultado era coherente y plausible; lo único falso era
  CONTRA QUÉ se había comparado. Por eso no se reconoce por el resultado, hay
  que reconocerlo por la forma.

  **Disfraz (a): una variable de shell que no se expandió, y el comando
  SIGUIENTE corrió igual sobre el estado viejo.** El `docker exec psql` que
  instalaba cada variante rota vivía en una variable (`$PSQL -c "…"`) y zsh la
  trató como el NOMBRE de un comando, no como una línea a expandir:
  `command not found`. El DDL nunca se aplicó — pero el `node
  scripts/probe-storage.mjs` de la línea siguiente corrió perfectamente, contra
  el esquema BUENO, y dijo "las 21 pruebas pasaron". Leído sin cuidado eso
  parece el hallazgo más valioso posible ("¡esta aserción no tiene control
  negativo!") cuando no se había probado absolutamente nada. Ojo con el reparto
  de culpas: el paso que falló SÍ gritó, pero su grito no detuvo al que
  importaba.

  **Disfraz (b): el baseline ya contenía el cambio, así que el "antes vs
  después" era "después vs después".** Para medir cuántas aserciones tenía
  `probe-storage.mjs` ANTES del cambio se corrió
  `git show HEAD:scripts/probe-storage.mjs`. Devolvió **21**, el mismo número
  que la versión nueva. No era que el cambio no hiciera nada: era que el trabajo
  ya se había comiteado desde fuera de la sesión, así que `HEAD` ERA la versión
  nueva. El baseline real estaba un commit más atrás y daba 17. Nada falló:
  `git show` funcionó, el script corrió, el número salió. (La misma mordida, en
  su versión de conteos de migraciones, está en §3 — allá como moraleja de que
  repo y remoto son un estado transitorio; aquí como lo que es en general.)

  **Disfraz (c): el comprobante de la comprobación.** Al verificar que la
  redacción corregida había entrado al commit, un `grep -cF` sobre cinco frases
  devolvió `[0]` para una de ellas — y la frase SÍ estaba, solo que partida por
  un salto de línea, que un patrón de una sola línea no puede machear. Hermano
  directo del gotcha del `grep` sobre colores ANSI de aquí arriba: el patrón
  seguía pareciendo razonable y el resultado seguía siendo mentira.

  **La regla, y no es "verifica la referencia" en abstracto — es esta:** cuando
  un número de verificación **te sorprenda por lo limpio que sale** (nada falla,
  el antes y el después coinciden, el control negativo no caza nada), **imprime
  explícitamente QUÉ estás comparando contra QUÉ antes de confiar en él**. Dos
  líneas bastan y convierten "salió verde" en un dato en vez de una esperanza:

  ```
  select tgname from pg_trigger where tgname like '…';        -- ¿se aplicó?
  select prosrc like '%VARIANTE ROTA%' from pg_proc …;        -- ¿ESTA variante?
  pg_get_triggerdef(oid)                                      -- ¿qué quedó?
  wc -l / grep -c "marca_del_cambio" <archivo-baseline>       -- ¿es el de antes?
  ```

  Es exactamente lo que la SEGUNDA tanda de controles negativos de esa tarea
  hizo bien —cada uno imprimía `triggers vivos: …` o `variante APLICADA` antes
  de correr el probe— y lo que le faltó a la primera. La diferencia de costo
  entre las dos tandas fue de segundos; la diferencia de valor, todo.

  **Y ojo con la asimetría que hace esto tan traicionero:** un control negativo
  que no se aplicó falla hacia el lado que CONFIRMA lo que uno esperaba
  («ninguna aserción lo caza»), mientras que uno bien aplicado suele
  contradecirte. O sea que este error se siente como un descubrimiento, no como
  un tropiezo. Es la misma familia del resto de esta sección: **en este repo, lo
  que no falla ruidosamente es lo que hay que mirar dos veces.**

- **`127.0.0.1` desde dentro de CUALQUIER contenedor del stack local NO es el
  host de desarrollo — es el contenedor mismo.** El título de este gotcha decía
  "desde dentro del edge runtime", y eso hacía leerlo como una rareza de Deno.
  **No lo es: es Docker.** Medido también desde el contenedor de **Postgres**,
  vía `pg_net` (2026-09-18, al construir los triggers de Storage de RF-18):
  `net.http_post` a `http://host.docker.internal:<puerto>/…` llega —200 en
  `net._http_response`, con el body y el header `apikey` recibidos por un
  listener del host— mientras que `127.0.0.1` no alcanzaría nada. Aplica igual
  a cualquier otro contenedor del stack que salga a la red.

  Vale la pena saberlo porque **habilita una técnica de prueba, no solo evita un
  bug**: cualquier endpoint configurable —la URL de una Edge Function guardada en
  Vault, `ENDPOINT_VISION`, `ENDPOINT_OPENAI`— se puede interceptar
  temporalmente con un `node:http` de veinte líneas en el host. Es lo que hace
  que `probe-storage.mjs` pruebe los triggers de moderación **gratis y sin
  `functions serve`** (`.claude/rules/moderacion.md` §6.5), y lo que permitió
  forzar un *refusal* real de OpenAI (§6.3, caso 8). Cuando el endpoint vive en
  una FILA (Vault) en vez de en una constante de un `.ts`, la intercepción ni
  siquiera necesita editar fuente ni reiniciar el servidor.

  El caso original, que es donde se descubrió: El runtime local
  corre como su propio contenedor Docker (`supabase_edge_runtime_…`, verlo
  con `docker ps`), así que un `fetch` que la función Deno hace hacia
  `http://127.0.0.1:<puerto>` desde su código resuelve al loopback DEL
  CONTENEDOR, no al de la máquina que lo lanzó. Mordió al montar un servidor
  mock local (`node:http`, sin dependencias) para forzar un *refusal* de
  OpenAI de verdad (RF-18, caso 8 de `.claude/rules/moderacion.md` §6.3): el
  servidor escuchaba en el host y `127.0.0.1` desde la función simplemente no
  lo alcanzaba — connection refused, indistinguible a primera vista de "el
  mock no arrancó". El fix en macOS (Docker Desktop) es
  **`host.docker.internal`**, el nombre que Docker Desktop resuelve al host
  desde dentro de cualquier contenedor. Aplica a cualquier endpoint que se
  quiera interceptar temporalmente para pruebas (Vision, OpenAI, un mock
  propio) — no solo a este caso.

- **Los `paths:` de `.claude/rules/` toleran los paréntesis de los route groups
  hoy, pero picomatch crudo NO — y si eso cambia, las reglas dejan de cargar en
  silencio.** Medido con cuatro reglas-sonda: `src/app/(onboarding)/**` sin
  escapar, `src/app/\(onboarding\)/**` escapada y `src/app/*onboarding*/**`
  paren-free **las tres cargaron** al leer `src/app/(onboarding)/splash.tsx`,
  mientras que una sonda con `paths: ["supabase/tests/**"]` no cargó hasta leer
  `rls.sql` — o sea que la carga condicional es real y Claude Code no pasa el
  patrón crudo a picomatch. **Pero picomatch 4.0.7 sí lo rompe**: compila
  `(onboarding)` como grupo de captura, así que `src/app/(onboarding)/**` genera
  `^(?:src\/app\/(onboarding)…)$` y machea `src/app/onboarding/…`, una ruta que
  no existe. Y falla de forma **inconsistente**: un path exacto sin comodín sí
  machea, porque `is-glob` devuelve false y picomatch cae a comparación literal.
  Importa porque la doc del propio binario dice que los patrones de exclusión de
  memoria SÍ se matchean con picomatch, y el changelog registra haber tenido que
  arreglar paréntesis en reglas de permisos: la semántica no es uniforme entre
  subsistemas. **Revisar cuando:** una regla de feature deje de aparecer en
  `/context` al abrir su pantalla. **Detectar:** con las mismas sondas — una
  regla con un `paths:` que no machea **no da ningún error**, simplemente no
  carga nunca. **Fix:** escapar los paréntesis o pasar a `*grupo*`.

  **Segundo dato, medido en 2026-09-19 al agregarle `paths:` a
  `moderacion.md`, y refuerza lo de arriba con un caso concreto del repo:**
  `src/app/(explorar)/detalle/**` —el patrón que ya usa
  `compartir-deeplinks.md`— **carga de verdad en Claude Code** (observado en esa
  sesión: la regla apareció al leer `detalle/[id].tsx`) y **NO machea bajo
  picomatch 4.0.7**, que compila `(explorar)` como grupo de captura:
  `^(?:src\/app\/(explorar)\/detalle…)$`, o sea contra `src/app/explorar/…`
  sin paréntesis. En cambio el path EXACTO con sus corchetes
  (`src/app/(explorar)/detalle/[id].tsx`) machea en los DOS, porque picomatch
  tiene un atajo de igualdad literal — ojo, no por `is-glob`: `[id]` sí es un
  glob (una clase de caracteres), así que un `detalle/[id]*.tsx` cualquiera
  compilaría como "i o d" y NO mancharía el archivo real. Si algún día hay que
  migrar estos patrones, el path exacto es la forma que sobrevive a los dos
  motores; el `**` con paréntesis es la que depende de que Claude Code siga sin
  pasar el patrón crudo.

- **`<Redirect>` de Expo Router NO navega al renderizarse: navega en
  `useFocusEffect`. Un guard de sesión en un layout, por lo tanto, no hace
  nada mientras ese layout esté TAPADO por un `Stack.Screen` hermano.**
  Leído en el fuente: `node_modules/expo-router/build/link/Redirect.js`
  envuelve el `router.replace(href)` en `useFocusEffect`. El único guard de
  `if (!session) return <Redirect href="/splash" />` vive en
  `(tabs)/_layout.tsx`, y `(tabs)`/`(cuenta)`/etc. son `Stack.Screen`
  HERMANOS del stack raíz (`src/app/_layout.tsx`). Un `router.push` a otro
  grupo no desmonta `(tabs)`, solo le quita el foco. Si la sesión pasa a
  `null` en ese momento, el guard renderiza el `<Redirect>`, que no navega, y
  el usuario se queda en una pantalla viva sin sesión. El salto a `/splash`
  llega cuando vuelve a `(tabs)`, y se atribuye al "atrás". **Esto ya mordió:**
  un primer diagnóstico escrito aquí mismo afirmaba lo contrario ("dispara el
  redirect desde abajo del stack, sin que importe qué pantalla esté visible")
  y era falso. Mover "Cerrar sesión" a Configuración (`3752e7b`) lo destapó, y
  se revirtió a Perfil (`cuenta-perfil.md`). **El hueco se cerró con
  "Eliminar cuenta"** (la primera acción que termina la sesión fuera de
  `(tabs)`): un guard GLOBAL en el layout raíz, que nunca pierde el foco,
  detecta la transición con sesión → sin sesión con un `useEffect` (no de foco)
  y reinicia el navegador raíz (`src/lib/salida-sesion.ts`). No actúa si la
  sesión muere en `(tabs)` (su `<Redirect>` ya navega) ni en `(onboarding)`
  (esos flujos cierran sesión a propósito), salvo que se haya pedido un destino
  con `salirHacia()`. **La regla que queda:** no asumas que un `<Redirect>`
  "vigila" desde abajo del stack; si hace falta vigilar, es un efecto en el
  layout raíz. **Confirmado en dispositivo por el usuario (2026-09-27)**, con
  sesión vencida en "Mis publicaciones"/"Editar perfil" y con "Cerrar sesión"
  desde Perfil (`cuenta-perfil.md`, prueba manual 6).

  **Y reiniciar, no `dismissAll()`.** `router.dismissAll()` cierra solo el
  stack MÁS CERCANO (`expo-router/build/global-state/router.d.ts`): llamado
  desde una pantalla de `(cuenta)`, vacía el stack de `(cuenta)` y deja `(tabs)`
  vivo debajo, con su `<Redirect>` esperando el foco. Para aterrizar en una
  pantalla sin nada con sesión debajo hace falta `navigationRef.reset(...)` del
  contenedor raíz (`useNavigationContainerRef()`).

  **Hermano, y este sí sigue siendo válido: "Cancelar" en un modal de
  confirmación no cancela nada si la acción ya está en curso, solo esconde el
  resultado, que llega de todos modos.** No hay `AbortController` en la
  cadena, así que cerrar el modal deja la promesa corriendo. El fix es del
  lado del control y no depende de la pantalla. Primero, deshabilitar el
  botón de escape mientras la acción está en curso (`Buttons.tsx`:
  `GhostButton` ganó `disabled`, mismo patrón que `DangerButton`, y
  `ConfirmModal` se lo pasa con `confirming`). Segundo, que la función que
  dispara la acción tenga `try/catch` con reseteo de su propio estado de "en
  curso", y que lo resetee también al ABRIR el modal. Sin eso, un fallo real,
  o un valor que Fast Refresh preserva, deja el modal sin ninguna salida en
  cuanto el botón de escape también queda deshabilitado.

- **Exponer en `[api] schemas` un schema que todavía no existe tumba TODO el
  API, no solo ese schema.** Medido el 2026-09-29 en local (Paso 0 de la Ola 1
  de RF-17): con `admin` en `schemas` y sin `create schema admin`, PostgREST no
  carga el schema cache (`3F000 schema "admin" does not exist`), reintenta en
  bucle, `supabase start` aborta por health check (503) y `/rest/v1/` de
  `public` tampoco responde. **Regla:** el schema se crea (migración) ANTES de
  exponerlo. En local van en el mismo commit, en ese orden (`db reset`, después
  `stop && start`); en remoto, el Dashboard (Settings → API → Exposed schemas)
  se toca DESPUÉS del `db push`, nunca antes: al revés deja caída la app en
  producción.
- **`psql -At` imprime también la etiqueta del comando, y un script que lea su
  salida la confunde con un resultado.** Con `insert … returning` que afecta 0
  filas, la salida no es vacía: es `INSERT 0 0`. Así `scripts/crear-admin.mjs
  activar` daba por activada una cuenta sin TOTP (lo cazó `probe-admin.mjs`,
  caso 2, en su primera corrida). **Fix:** `-q` (quiet), que suprime las
  etiquetas. Es la familia de "lo que no falla ruidosamente": un 0 filas que se
  lee como éxito.
- **psql NO sustituye `:'var'` dentro de un dollar-quote.** Un `DO` (o el cuerpo
  de una función) que use `:'nombre'` lo recibe literal, como texto `:'nombre'`
  o como error de sintaxis. Para pasar valores del usuario a psql sin
  interpolar, las sentencias van planas (un CTE en vez de un bloque `DO`), con
  `-v var=valor` por `execFileSync` y sin shell (`scripts/crear-admin.mjs`, y
  su control en el caso 6 de `probe-admin.mjs`).
- **Storage no dice POR QUÉ rechaza una lectura: el rechazo de "no tienes
  permiso" es idéntico al de "no existe".** Medido el 2026-10-01
  (`probe-storage.mjs`, Ola 2 de RF-17), en `/object/{bucket}/…` y en
  `/object/authenticated/{bucket}/…`: un admin aal1, un admin con el TOTP
  vencido y un no-admin reciben exactamente `HTTP 400
  {"statusCode":"404","error":"not_found","message":"Object not found","code":"NoSuchKey"}`.
  O sea que ningún cliente puede decidir por el status si debe pedir otro
  factor, refrescar la sesión o rendirse: tiene que preguntarle a la base por
  otro camino (el panel llama a `admin.sesion()`, `admin/src/lib/fotos.ts`).
  Mismo diseño que el `200 []` de `remove()` (arriba): Storage no filtra la
  existencia de un objeto que la RLS te esconde.
- **GoTrue local firma los tokens de usuario con ES256, no con
  `JWT_SECRET`.** Medido el 2026-10-01: `GOTRUE_JWT_KEYS` del contenedor de
  Auth trae una llave EC `alg=ES256` con `key_ops [sign, verify]` (y
  `VALID_METHODS` es `HS256,RS256,ES256`); el header de un access token real
  dice `alg=ES256`. Para fabricar un token con claims a la medida por HTTP
  (p. ej. un TOTP de hace 13 h), se firma con ESA llave, leída del entorno del
  contenedor y solo en memoria, y solo contra un stack local
  (`probe-storage.mjs` se niega con cualquier otro hostname). Un control
  positivo (el mismo token re-firmado con claims válidos → 200) es lo que
  separa "rechazado por los claims" de "rechazado por la firma".
- **`security definer` cambia `current_user`, NO el GUC `role`.** Medido en
  `begin … rollback` el 2026-10-01: dentro de una RPC definer llamada como
  `authenticated` (con `SET LOCAL ROLE` o con `set_config('role', …)`), y en
  los triggers que esa RPC dispara, `current_user` es `postgres` pero
  `current_setting('role', true)` sigue en `authenticated`; en un UPDATE
  directo es `postgres` dentro de la suite y `none` en una sesión nueva. Sirve
  para distinguir "vino del panel" de "vino de Studio" en un control negativo
  (T36 (c1b)); **no** lo uses como candado: es un GUC que cualquier sesión
  puede poner.

- **Cloudflare Web Analytics inyecta su beacon en el HTML desde el borde, y solo
  si la petición pide HTML.** Medido el 2026-10-02 sobre `admin.rlvo.com.mx`: con
  `curl` simple o con `Accept: */*` el HTML sale limpio (1041 B), y con
  `Accept: text/html` sale con un `<script … beacon.min.js>` antes de `</body>`
  (1408 B). Era la inyección AUTOMÁTICA de la ZONA (`rlvo.com.mx`, "Enable,
  excluding visitor data in the EU") y alcanzaba a todos sus subdominios
  proxeados, aunque el proyecto de Pages dijera "Web analytics is disabled": `rlvo-admin.
  pages.dev`, que no pasa por la zona, nunca lo tuvo. La CSP del panel lo
  bloquea (`blocked:csp`, nada sale), así que el síntoma es ruido en la consola, y
  un `curl` normal NO lo ve: la primera verificación de F4, con `curl` simple, dio
  0 y se leyó como "apagado" (error de método, no de configuración). **Para verificar, 4 variantes de petición** (curl simple, UA de
  navegador con `*/*`, UA con `Accept: text/html` y UA con `Accept` más
  `Sec-Fetch-Dest: document`). La salida sin tocar la CSP fue cambiar la zona a
  "Enable with JS Snippet installation" (así está a 2026-10-05) y poner el
  snippet solo donde se quiere medir; las reglas para excluir tráfico exigen plan
  Pro.
- **`supabase gen types --local` y `--linked` producen el MISMO contenido con
  distinto formato.** Medido el 2026-10-02: `--linked` agrega el bloque
  `__InternalSupabase { PostgrestVersion }`, pone paréntesis en los genéricos de
  los helpers (5 sitios) y quita una línea en blanco final. Compila igual. El
  `gen:types` de la raíz usa `--linked` y se corre después de cada push; el del
  panel usa `--local` a propósito, porque las RPC nuevas se prueban en local
  ANTES del push y `--linked` no las vería. Quien commitee un archivo generado
  con `--local` vuelve al formato viejo: es ruido en el diff, no un error. Tras
  cada push, `admin/src/db/admin.types.ts` se regenera con `--linked` y ese es el
  que se commitea.
- **El advisor `authenticated_security_definer_function_executable` solo cuenta
  las funciones de los schemas EXPUESTOS por la API.** Antes de exponer `admin`
  los advisors mostraban 3 definer (las de `public`) aunque las 9 RPC de `admin.*`
  ya existían; al exponerlo pasaron a 12. No es una regresión: es el lint
  empezando a ver lo que ya estaba. Esos 9 WARN son intencionales (cada RPC
  llama `exigir_admin()` primero). El 12 es la cifra de 2026-10-05 (9 de
  `admin.*` y 3 de `public`): un número distinto sin una función nueva es la
  señal.
- **Una fila de `auth.users` sembrada por SQL con las columnas de token en NULL
  rompe `auth.admin.listUsers`** (`500 Database error finding users`). GoTrue lee
  esas columnas como texto; las que crea él mismo van en cadena vacía. Mordió al
  sembrar una cuenta de prueba en `probe-admin.mjs` (caso 8g) y se arregló
  sembrándolas con `''`. En remoto no aplica: todas las filas las crea GoTrue.
- **Pages sirve 200 con `index.html` para CUALQUIER ruta inexistente, también las
  de recursos, y cachea en el borde el JS anterior.** Medido tras el redespliegue:
  `/assets/no-existe.js` da 200 `text/html` (el navegador no lo ejecuta, por
  `nosniff`), y la ruta del JS viejo (`index-BXRSgDOV.js`) seguía respondiendo su
  contenido en el dominio propio (`max-age=14400`) y en `pages.dev`
  (`s-maxage=604800`), pero no en el deployment nuevo. No hace falta purgar: el
  `index.html` ya apunta al JS nuevo y se sirve con `max-age=0, must-revalidate`.
