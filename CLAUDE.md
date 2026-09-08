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

Es un prototipo HTML/CSS/JS autocontenido con las 42 pantallas de la app
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
5. **Antes de implementar cualquier funcionalidad de negocio** (qué campos
   lleva una publicación, qué estados existen, qué puede hacer un usuario
   suspendido, etc.), consulta `/docs/product-spec.md` — los RF-01 a RF-17 y
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

---

## 1. Stack tecnológico

| Capa | Tecnología | Por qué |
|---|---|---|
| App móvil | React Native + Expo (Router, SDK 57) | Un solo código para iOS/Android, builds sin Mac vía EAS Build |
| Backend / BD | Supabase (Postgres), proyecto remoto `ukxfnydfhmryrzhdqkvj`, región Ohio (us-east-2) | Auth + BD relacional + Storage + Row Level Security, sin backend custom |
| Cliente BD | `@supabase/supabase-js` (versión fijada, sin `^`) | Ver sección 8 para el wrapper (`src/lib/supabase.ts`) y por qué usa `expo-crypto` en vez de `react-native-get-random-values` |
| Notificaciones | Expo Notifications | Integración directa, disparadas desde Supabase Edge Functions (pendiente, sección 8) |
| Admin / moderación | Supabase Studio | Panel de reportes y suspensión de usuarios/publicaciones, sin desarrollo adicional |
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
que quedó fuera del token original), `Typography` (27 roles por nombre
semántico, cada uno citando la clase CSS exacta de origen — incluye
`.avatar`/`.seller-avatar` en weight 600, ojo si agregas un rol parecido, es
fácil confundirlo con 500), y `ScreenPadding = 20`. No hay escala formal de
spacing — los paddings del prototipo son ad-hoc por componente; se leen
directo del HTML pantalla por pantalla, no se inventa una escala genérica.

---

## 3. Modelo de datos — esquema implementado

Aplicado en 8 migraciones (`supabase/migrations/`) contra el proyecto remoto,
con RLS activo y probado en las 10 tablas. Este es el esquema **real**, no
solo la intención original.

```
-- Enums
user_status        : activo | suspendido
listing_status     : activa | pausada | vendida
listing_condition  : nuevo | como_nuevo | buen_estado | usado
report_reason      : spam_publicidad | sospecha_fraude | contenido_inapropiado
                      | no_es_estudiante | otro
report_status      : pendiente | resuelto | descartado

-- Catálogos (solo lectura para authenticated; altas vía Studio/service_role)
universidades   (id, nombre único)
campus          (id, universidad_id → universidades, nombre, ciudad,
                 único por (universidad_id, nombre))
categories      (id, nombre único) — 12 filas sembradas, ver seed.sql

-- Perfil (provisto automáticamente por trigger al verificar correo)
users
  id uuid (= auth.users.id), correo (NO expuesto al cliente, ver abajo),
  nombre, foto_url, universidad_id, campus_id, carrera (nullable hasta
  "Completar perfil"), rating_promedio (solo triggers escriben),
  estado (solo triggers/service_role escriben)

-- Publicaciones
listings
  id, user_id, categoria_id, universidad_id, campus_id, titulo, descripcion,
  precio numeric(10,2) >= 0, condicion, estado default 'activa',
  vistas_count (solo vía RPC, ver abajo), created_at, updated_at,
  busqueda tsvector generated always as
    (to_tsvector('spanish', titulo || ' ' || coalesce(descripcion,''))) stored
    -- columna generada + índice GIN `listings_busqueda_idx` sobre ELLA. Ver abajo.
listing_photos
  id, listing_id, storage_url, orden (0-4, único por listing — tope de 5 fotos
  enforced con trigger)

-- Interacción
favorites        (user_id, listing_id) — privados, nadie ve favoritos ajenos
listing_contacts (user_id, listing_id, created_at) — log append-only de cada
                 tap en "Contactar por WhatsApp"; alimenta el flujo
                 "¿A quién le vendiste?" (sección 5)
ratings
  from_user_id, to_user_id, listing_id, estrellas (1-5), comentario nullable.
  Solo se puede calificar si hubo contacto real (función can_rate()).
  to_user_id/listing_id NO son editables tras crear la fila (protegido por
  grant de columna, no solo por policy — un UPDATE no puede reapuntar una
  reseña a otra persona). Sin DELETE: una calificación no se borra, es parte
  del historial de confianza.
reports
  reporter_id (not null, on delete cascade — si el reportante borra su
  cuenta, el reporte pierde sentido), listing_id / reported_user_id
  (mutuamente excluyentes al crear, pero on delete SET NULL — un reporte
  sobrevive al borrado de su objetivo, con snapshot en listing_titulo /
  reported_user_correo para seguir siendo legible). reported_user_correo
  NUNCA es legible por el cliente (mismo criterio que users.correo) — solo
  service_role lo ve.
```

**Protección de `correo` (RNF-05):** RLS filtra filas, no columnas — la
protección real es un `grant select` de columna que excluye `correo`
explícitamente. El propio usuario ya tiene su correo en la sesión de Auth, no
necesita leerlo de `public.users`.

**Usuario suspendido — tabla de decisión (no implícita):** puede leer catálogo,
perfiles y reseñas; puede editar su propio perfil y usar favoritos. NO puede
publicar, editar/pausar/borrar sus publicaciones existentes, tocar sus fotos,
contactar por WhatsApp, calificar, ni reportar — todo vía el helper
`private.is_active_user()`.

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
`busqueda`, el cliente filtra con `.textSearch('busqueda', q, {type:'websearch',
config:'spanish'})` y el índice por fin sirve. **De paso arregla los acentos**:
el diccionario snowball reduce `Cálculo` y `calculo` al mismo lexema `calcul`
— con `ilike`, buscar "calculo" devolvía 0 sobre "Cálculo de Larson". No se
usa la extensión `unaccent`; el diccionario ya lo hace.

`busqueda` **no lleva grant propio y no es un olvido**: a diferencia de
`update`, que en esta tabla sí está acotado por columna, `select` se otorgó a
nivel tabla, y en Postgres eso cubre las columnas que se agreguen después.
Filtrar por una columna exige SELECT sobre ella, así que ese grant heredado es
lo que hace que la búsqueda funcione — la suite lo vigila (T13), porque
"endurecerlo" a una lista explícita rompería la búsqueda sin ningún error
visible en la app. Escribirla es imposible por definición: Postgres rechaza
cualquier escritura sobre una columna generada, sin importar los grants.

**Funciones `SECURITY DEFINER`** viven en el esquema `private` (nunca en
`public`) excepto DOS, que sí deben ser invocables por PostgREST desde el
cliente: `increment_listing_view` y `listing_favorites_count` (eran una sola
hasta que Detalle necesitó el conteo de favoritos; si algún día hay una
tercera, revisa primero si de verdad la invoca el cliente o si va en `private`).
`authenticated` tiene `USAGE` sobre `private` + `EXECUTE` acotado
solo a `is_active_user()` y `can_rate()` — las otras cuatro funciones internas
siguen revocadas. Ver sección 9 sobre por qué ese `USAGE` existe (no es lo que
originalmente se pensó).

**Regresión de RLS:** `supabase/tests/rls.sql`, 53 aserciones, corre dentro de
una transacción con rollback (no deja estado, repetible sin `db reset`).

Cómo llegó a 53, porque el número se movió en dos rondas y conviene saber por
qué: las 42 originales de la Fase 2 subieron a 47 con las de
`listing_favorites_count` (T11b), y **bajaron a 46** al corregir esa misma
sección — una de sus aserciones usaba la cuenta `:C`, que T8 borra a propósito
al probar que un reporte sobrevive al borrado de su objetivo, así que pasaba por
la razón equivocada. Ese mismo hallazgo obligó a que T11b sembrara su propia
publicación en vez de reutilizar `t_ids`, que T8 también borra. De ahí a **53**
con las 7 de la búsqueda por tsvector (T13), sembrada igual de autocontenida.
**Moraleja para secciones nuevas: no reutilices fixtures de secciones
anteriores** — a media suite hay filas y cuentas ya borradas a propósito.
Incluye controles negativos (el esquema se rompió a propósito para confirmar
que la suite sí falla cuando debe). Cualquier cambio a policies/grants debe
correr esta suite antes de comitear.

---

## 4. Inventario completo de pantallas (42)

Cada pantalla corresponde 1:1 a un `<div class="phone-block" data-cat="...">`
dentro de `relevo-app.html` — el atributo `data-cat` es el mismo agrupador que
usa el filtro visual del prototipo. Para el estado de qué grupo ya existe
como código real (vs. solo diseño), ver sección 8b.

### Onboarding (13)
Splash · Onboarding 1/3 · Onboarding 2/3 · Onboarding 3/3 · Verificación ·
Código de verificación · Completar perfil ·
Completar perfil (estado inicial) · Completar perfil (selector de campus) ·
Selector de universidad · Permiso de notificaciones ·
Iniciar sesión · Recuperar contraseña

### Explorar (11)
Feed · Selector de campus · Categoría · Categoría sin resultados ·
Ver todas (categorías) · Búsqueda (recomendados) · Búsqueda ·
Búsqueda sin resultados · Filtros · Detalle de publicación ·
Detalle (vista vendedor)

### Publicar (3)
Publicar · Editar publicación · Publicación creada

### Cuenta (5)
Perfil · Editar perfil · Perfil público · Favoritos · Favoritos vacío

### Confianza (3)
Reportar publicación · Calificar · ¿A quién le vendiste?

### Notificaciones (1)
Notificaciones

### Sistema (6)
Confirmar eliminar · Confirmar cerrar sesión · Error de conexión ·
Toast de éxito · Toast de error · Loading / skeleton

---

## 5. Flujos que no son obvios solo viendo las pantallas

- **Verificación → acceso**: correo institucional (OTP passwordless) →
  código → completar perfil (nombre, universidad, campus, y aquí se fija la
  contraseña) → permiso de notificaciones → Feed. La sesión ya existe desde
  que se verifica el OTP — es el equivalente de
  `supabase.auth.signInWithOtp({ email })` seguido de la verificación del
  código — y no depende de la contraseña. Esa contraseña, fijada después en
  "Completar perfil", no autentica el registro: habilita el login posterior
  por correo/contraseña (RF-02) para cuando el usuario vuelva a abrir la app.
  La universidad y el campus elegidos aquí determinan qué catálogo ve el
  usuario de ahí en adelante.
- **Marcar como vendida → calificación**: como no hay chat interno, el vendedor
  no sabe automáticamente quién compró. Se resuelve con la tabla
  `listing_contacts`: al tocar "Marcar como vendida", se le muestra al
  vendedor la lista de usuarios que tocaron "Contactar por WhatsApp" en esa
  publicación, para que elija quién se la llevó (o "No fue a través de
  Relevo"). Esa selección dispara la pantalla de Calificar con el nombre real
  de esa persona.
- **Selector de campus vs. selector de universidad**: son dos entradas
  distintas al mismo dato. "Selector de universidad" (pantalla completa, con
  buscador) se usa una sola vez en onboarding. "Selector de campus" (bottom
  sheet, ligero) vive en el Feed para cambiar de contexto rápido sin salir del
  catálogo — pensado para cuando una universidad tenga varios campus.
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
  haya o no sesión activa (ya implementado, ver sección 8).

---

## 6. Cómo pedirle trabajo a la IA en este repo

- Pide **tokens antes que pantallas**: extraer `theme.ts` del CSS antes de
  construir el primer componente.
- Ve **pantalla por pantalla, por grupo (`data-cat`)**, no "constrúyeme la
  app" — con 42 pantallas, pedir todo junto es la forma más segura de que
  algo se desvíe del diseño.
- Separa **UI de datos en dos pasos**: primero el componente con datos de
  prueba fiel al frame del HTML, después la conexión a Supabase con RLS. Es
  el patrón que ya siguieron Onboarding y Explorar (sección 8b) — antes de
  empezar el siguiente grupo, revisa esa sección para no reconstruir
  componentes que ya existen (`ProductCard`, `SheetScreen`, `Field`,
  `ConfirmModal`, etc.).
- Si vas a agregar una pantalla o estado que no existe en `relevo-app.html`
  (por ejemplo, un caso borde nuevo), constrúyelo ahí primero.
- **Para cualquier trabajo de esquema/RLS/backend, usa Plan Mode y aprueba
  por fases chicas**, no un plan que cubra varias tablas o varios flujos a la
  vez. El esquema actual pasó por 5 rondas de revisión de plan antes de
  ejecutarse — cada ronda encontró un hueco de seguridad real. Ninguno era
  visible con solo "que compile" — se necesitó revisión deliberada.
- Para tareas de backend en particular: **valida en local con Docker antes de
  aplicar a remoto**, y prueba como el rol `authenticated` real, no como
  `postgres`/superusuario.
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

## 8. Estado de implementación del backend

**Hecho:**
- 8 migraciones aplicadas al proyecto remoto (`ukxfnydfhmryrzhdqkvj`, Ohio),
  con RLS + regresión de 53 aserciones pasando.
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
- **Auth gating cableado end-to-end y confirmado con una cuenta real de Tec
  de Monterrey**: `SessionProvider` (`src/lib/session.tsx`) escucha
  `onAuthStateChange` y lee el perfil de `public.users`; el splash decide
  entre carrusel / login / completar perfil / Feed; `(tabs)/_layout.tsx`
  impide entrar al Feed con el perfil a medias. Registro passwordless por
  OTP, contraseña fijada en "Completar perfil". Probado de punta a punta:
  correo institucional real → código de 6 dígitos → perfil → cerrar sesión →
  volver a entrar con `signInWithPassword`.
  - **Ojo con `onAuthStateChange`**: su callback es síncrono a propósito.
    Cualquier llamada async ahí dentro provoca un deadlock conocido de
    supabase-js que cuelga la siguiente llamada del cliente. La lectura del
    perfil vive en un efecto aparte, fuera del lock.
  - **Nunca `select('*')` sobre `public.users`**: `correo` está fuera del
    grant de select, y pedir `*` hace fallar la query entera con `42501` en
    vez de devolverla sin esa columna. Lista las columnas.
- **Plantilla de correo OTP aplicada y confirmada funcional** en el dashboard
  remoto (Auth → Email Templates → Magic Link, con `{{ .Token }}`) y
  versionada en `supabase/templates/magic_link.html` para que `supabase
  start` local también la use. Ver la nota de SMTP/cuarentena en sección 1.
- **Búsqueda de texto por tsvector** (migración `20260908000444`). Resolvió de
  una sola vez las dos cosas: el índice GIN por fin se usa (medido con
  `explain analyze` a 80 000 filas: Bitmap Index Scan, 0.9 ms, contra Seq Scan
  de 67 ms con el `ilike` anterior) y desapareció el bug de acentos —
  buscar "calculo" sobre "Cálculo de Larson" devolvía **0** resultados y ahora
  devuelve los 3 esperados. De regalo, `websearch_to_tsquery` convierte `*` en
  una tsquery vacía, así que el bug de "buscar `*` te devuelve el catálogo
  entero" quedó cerrado por el motor y se pudieron borrar del cliente el
  `escapaBusqueda()` de dos capas y su corto circuito.
- **Grupo Explorar conectado a datos reales** (7ª migración incluida:
  `listing_favorites_count`). Los mocks `src/constants/mock/{listings,campus,
  categorias}.ts` ya no existen; la capa de datos vive en `src/lib/listings.ts`,
  `src/lib/categorias.ts` y `src/lib/favoritos.ts`. Ver §8b.

**Pendiente, en este orden de prioridad:**
1. Bucket de Storage + políticas para `listing_photos.storage_url` — el
   esquema ya asume su existencia, pero `config.toml` no lo tiene configurado.
   Mientras tanto `listing_photos` viene vacío y Detalle/ProductCard pintan el
   placeholder de ícono de categoría tintado que el frame ya define.
2. Edge Functions para el push de RF-16 (Expo Notifications) — el esquema
   deja los datos listos (`listing_contacts`, `favorites`), pero no hay
   función que dispare la notificación todavía.
3. **Columna `telefono` en `public.users` + su captura.** El botón "Contactar
   por WhatsApp" abre un `wa.me` con un número placeholder, porque no hay de
   dónde sacar el real: no existe la columna
   (`20260906000438_users_profiles.sql`), `docs/product-spec.md` §Modelo de
   datos no la lista, y ningún frame de `relevo-app.html` la captura —
   RF-13 y RF-05 la asumen sin definirla nunca. Resolverlo es migración +
   frame nuevo en el diseño + campo en "Completar perfil" y "Editar perfil",
   no una línea de código. El insert a `listing_contacts` (lo que de verdad
   habilita RF-12) SÍ es real desde ya.

**Deuda consciente — con disparador de revisión, no "algún día":**

- **La búsqueda de texto es por palabra completa (websearch/tsvector), no por
  prefijo** — teclear parcialmente puede mostrar "No encontramos" brevemente
  antes de completar la palabra (medido: `calc` no encuentra "Cálculo";
  `calcul` sí). Resolver con RPC dedicada (evaluada: una función que arme la
  tsquery con `:*` en el último término, ya que `websearch_to_tsquery` no
  soporta prefijos y `to_tsquery` crudo revienta con input arbitrario) **si se
  vuelve un problema real de UX medido, no solo teórico**. **Disparador:** que
  en pruebas con usuarios reales alguien se queje de esto, o abandone una
  búsqueda a medio escribir.
- **Scroll infinito sin virtualización.** Búsqueda y Categoría paginan dentro
  del `ScrollView` de `Screen` (prop `onEndReached`), con el grid armado por
  `chunkRows()`: todas las filas cargadas quedan montadas, sin el reciclaje de
  vistas de `FlatList`/`FlashList`. **Revisar cuando:** una sesión típica pase
  de ~5 páginas cargadas (≈100 tarjetas montadas), o antes si aparece jank
  medible al hacer scroll en gama media — lo que llegue primero. **Fix:**
  `FlatList` con `numColumns={2}` (o `FlashList`, cubierto por el skill
  `vercel-react-native-skills`); cambia el contenedor, no el diseño —
  `chunkRows()` desaparece a favor de `numColumns` y `Screen` deja de envolver
  el grid en su `ScrollView` para esas dos pantallas.
- **El log de contactos que falla se pierde.** Si el insert a
  `listing_contacts` falla, WhatsApp se abre igual (no se le niega el contacto
  al usuario por un fallo de log) y el usuario ve un toast de error, pero no
  hay reintento: falta una cola de escrituras pendientes con persistencia
  local que se vacíe al recuperar conexión. **Revisar cuando:** se construya
  el grupo Confianza — es ahí, en "¿A quién le vendiste?", donde una fila
  faltante deja de ser invisible y se vuelve un candidato ausente de la lista
  que rompe RF-12.

---

## 8b. Estado de implementación del frontend (por grupo)

**Onboarding — construido y conectado a Supabase real.** Las 13 pantallas
existen como código, con auth gating real (ver sección 8). Sin conectar
todavía, fuera de alcance por decisión explícita: `recuperar-password.tsx`
(necesita deep linking), `expo-notifications` real (el botón solo navega),
`expo-image-picker` para la foto de perfil, íconos nativos de los 4 triggers
de `NativeTabs` (siguen siendo solo texto).

**Explorar — construido y conectado a Supabase real.** Las 11 pantallas
existen como código (7 archivos de ruta, algunos cubren varios estados:
Categoría 2 estados, Búsqueda 3 estados, Detalle 2 estados comprador/vendedor)
y leen del proyecto remoto. `src/lib/explorar-state.tsx` sigue siendo el estado
compartido, pero ahora guarda solo los *valores* (campus elegido, filtros,
catálogo de categorías, set de favoritos): el filtrado dejó de recorrer un
arreglo y es una query en `src/lib/listings.ts`.

**Qué quedó conectado:** el catálogo de `listings` (con su join a `categories`,
`campus` y `listing_photos`), las `categories` reales, el catálogo de `campus`
filtrado por la universidad del perfil, `favorites` con optimistic update y
rollback por id, el insert a `listing_contacts` en el botón de WhatsApp, la RPC
`increment_listing_view` al abrir Detalle, `listing_favorites_count` para el
stat del vendedor, y la búsqueda de texto completa por tsvector.

**Mocks borrados:** `src/constants/mock/listings.ts` y
`src/constants/mock/campus.ts` ya no existen. `src/constants/mock/categorias.ts`
se disolvió en `src/lib/categorias.ts`: el slug y el ciclo de tintes no eran
datos de prueba sino presentación derivada (la tabla real solo tiene
`id, nombre`), así que sobrevivieron a la migración de mock a real.

Detalles que no se ven en el diff:
- **Los ids de Explorar son `number`**, no `string` — `listings.id` y
  `categories.id` son `bigint`. Los params de `/detalle/[id]` y
  `/categoria/[id]` llegan como string desde la ruta y se parsean con
  `Number()`.
- **Toda query que embeba el vendedor debe desambiguar la relación:**
  `users!listings_user_id_fkey`. Hay dos caminos entre `listings` y `users` (la
  FK directa y un many-to-many vía `favorites`), así que sin nombrarla PostgREST
  responde `PGRST201` y la query entera falla. El `!inner` que va después no es
  decorativo: habilita ordenar el resultado por `rating_promedio` del vendedor
  ("Mejor calificados").
- **Paginación híbrida, encapsulada en `fetchListings()`:** keyset con cursor
  compuesto `(created_at, id)` para el orden "recientes" —que es append-heavy y
  con `offset` mostraría tarjetas repetidas al entrar publicaciones nuevas
  durante el scroll, además de caminar sobre `listings_feed_idx`— y `.range()`
  para precio/rating, donde la llave de orden cambia y no hay índice compuesto
  que la soporte. Las pantallas manejan un cursor opaco y no saben cuál corrió.
- **El Feed no es lista infinita**: el frame es un grid de 6 con "Ver todo".
  La paginación de RNF-01 vive en Búsqueda y Categoría.
- **Favoritos con optimistic update y rollback por id.** La RLS de `favorites`
  no tiene `is_active_user()` y solo compara `user_id = auth.uid()`, así que no
  existe un rechazo por política para una escritura bien formada sobre la
  propia fila: los únicos fallos son de transporte. Esperar confirmación en un
  corazón que se toca desde un grid en scroll no compra nada. El insert va con
  `ignoreDuplicates: true` porque `favorites` no tiene grant de UPDATE — un
  upsert normal (`ON CONFLICT DO UPDATE`) fallaría con `42501`.
- **La búsqueda NO escapa el término, y es deliberado.** Va por
  `.textSearch('busqueda', q, {type:'websearch', config:'spanish'})` contra la
  columna generada: `websearch_to_tsquery` está hecho para input crudo (nunca
  lanza error de sintaxis), la coma ya no delimita nada porque es un filtro
  suelto y no un `or=(...)`, y `*` se vuelve una tsquery vacía. Aquí vivió un
  `escapaBusqueda()` de dos capas más un corto circuito para el asterisco;
  ambos se borraron al migrar a tsvector. Si vuelves a ver un `replace` sobre
  el término de búsqueda, es una regresión.

Componentes reusables ya construidos aquí (no los reconstruyas):
`ProductCard`, `CategoryTile`, `PageHeader`, `EmptyState`,
`SegmentedControl`, `Chip`, `ActiveFilterChip`, `SheetScreen`,
`RoundIconButton`, más los íconos de categorías. Al conectar datos reales se
sumaron tres del grupo Sistema, transcritos de sus frames: `SkeletonGrid` /
`SkeletonCatGrid`, `ErrorState` (con "Reintentar") y `Toast` (`ToastProvider`
montado en el `_layout.tsx` raíz, con variantes de éxito y error). Se
construyeron ahora porque conectar la red hace alcanzables por primera vez los
estados de carga, fallo y aviso no bloqueante. `SheetScreen` es una
pantalla de Stack con `presentation:'transparentModal'` **declarada en el
Stack raíz** (`src/app/selector-campus.tsx`, `src/app/filtros.tsx` — no
dentro de `(explorar)/`, ver el gotcha de sección 9) — es distinto de
`CampusBottomSheet.tsx` (un `Modal` de RN real, usado solo por Completar
perfil en Onboarding); no unificar ambos, sirven casos de uso distintos ya
documentados en sección 5.

Botones inertes a propósito (llevan a grupos sin construir): Compartir,
Reportar, menú kebab, "Marcar como vendida", "Editar publicación" en
Detalle. El botón de WhatsApp sí registra de verdad en `listing_contacts`
antes de abrir el deep link; lo único mock que le queda es el número, y por la
razón documentada en §8 (pendiente 3), no por descuido.

**Cuenta, Confianza, Publicar, Notificaciones — no construidos todavía**
(ojo: la pantalla *Favoritos* es del grupo Cuenta, así que sigue siendo un
placeholder aunque el *toggle* de favorito ya funcione en todo Explorar).
**Sistema** solo tiene las 3 piezas que Explorar necesitó (arriba); le faltan
"Confirmar eliminar" y "Confirmar cerrar sesión" cableados. Salvo piezas
puntuales ya hechas de paso: `ConfirmModal` (genérico,
usado hoy solo por "Confirmar cerrar sesión") y `DangerButton` ya existen en
`src/components/`, listos para reusarse cuando se conecte "Confirmar
eliminar" en Editar publicación. El placeholder de `(tabs)/perfil.tsx` solo
tiene el afordance de cerrar sesión — el resto de la pantalla Perfil
(avatar, stats, menú) no se ha construido.

---

## 9. Gotchas de infraestructura (para no re-descubrirlos)

- **`pg_default_acl` hace que los `grant` de columna sean inútiles sin un
  `revoke all` explícito primero.** Supabase otorga privilegios por default
  sobre cada tabla nueva de `public` a `anon`/`authenticated`/`service_role`.
  Un `grant select (columnas_seguras)` es puramente aditivo — no retira nada
  ya concedido. Cada bloque de grants en las migraciones lleva ahora un
  comentario explicando esto — **cualquier tabla nueva necesita el mismo
  patrón: revocar primero, otorgar después.**
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
- **`presentation:'transparentModal'` de un Stack anidado no funciona si el
  Stack padre ya presenta esa ruta como card opaca.** El navegador que de
  verdad ejecuta el `push` (a menudo el Stack raíz, no el Stack del grupo
  donde vive el archivo) es el que decide cómo se presenta la transición.
  Una hoja/modal transparente debe declararse en el Stack que realmente
  monta esa ruta — moverla de un grupo anidado a una ruta de nivel raíz
  (como se hizo con `selector-campus.tsx`/`filtros.tsx`) resuelve esto sin
  tener que migrar a un `Modal` de RN.