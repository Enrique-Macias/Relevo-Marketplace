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

Es un prototipo HTML/CSS/JS autocontenido con las 39 pantallas de la app
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
que quedó fuera del token original), `Typography` (25 roles por nombre
semántico, cada uno citando la clase CSS exacta de origen), y
`ScreenPadding = 20`. No hay escala formal de spacing — los paddings del
prototipo son ad-hoc por componente; se leen directo del HTML pantalla por
pantalla, no se inventa una escala genérica.

---

## 3. Modelo de datos — esquema implementado

Aplicado en 6 migraciones (`supabase/migrations/`) contra el proyecto remoto,
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
  vistas_count (solo vía RPC, ver abajo), created_at, updated_at
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

**Funciones `SECURITY DEFINER`** viven en el esquema `private` (nunca en
`public`) excepto `increment_listing_view`, que sí debe ser invocable por
PostgREST. `authenticated` tiene `USAGE` sobre `private` + `EXECUTE` acotado
solo a `is_active_user()` y `can_rate()` — las otras cuatro funciones internas
siguen revocadas. Ver sección 9 sobre por qué ese `USAGE` existe (no es lo que
originalmente se pensó).

**Regresión de RLS:** `supabase/tests/rls.sql`, 42 aserciones, corre dentro de
una transacción con rollback (no deja estado, repetible sin `db reset`).
Incluye controles negativos (el esquema se rompió a propósito para confirmar
que la suite sí falla cuando debe). Cualquier cambio a policies/grants debe
correr esta suite antes de comitear.

---

## 4. Inventario completo de pantallas (39)

Cada pantalla abajo corresponde 1:1 a un `<div class="phone-block" data-cat="...">`
dentro de `relevo-app.html` — el atributo `data-cat` es el mismo agrupador que
usa el filtro visual del prototipo (Onboarding / Explorar / Publicar / Cuenta /
Confianza / Notificaciones / Sistema). Úsalo también para organizar carpetas de
rutas en el código (ej. `app/(onboarding)/`, `app/(explorar)/`, etc.).

### Onboarding (11)
Splash · Onboarding 1/3 · Onboarding 2/3 · Onboarding 3/3 · Verificación ·
Código de verificación · Completar perfil · Selector de universidad ·
Permiso de notificaciones · Iniciar sesión · Recuperar contraseña

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

### Sistema (5)
Confirmar eliminar · Confirmar cerrar sesión · Error de conexión ·
Toast de éxito · Loading / skeleton

---

## 5. Flujos que no son obvios solo viendo las pantallas

- **Verificación → acceso**: correo institucional → código OTP de 6 dígitos →
  completar perfil (nombre, universidad, campus) → permiso de notificaciones →
  Feed. La universidad y el campus elegidos aquí determinan qué catálogo ve el
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
- **Búsqueda tiene dos estados, no dos pantallas separadas en producción**:
  "Búsqueda (recomendados)" es el estado sin query (lo que ves al tocar el tab
  Buscar o "Ver todo" desde el Feed); en cuanto el usuario escribe algo, pasa
  al estado con chips de filtro activo y contador de resultados.
- **`anon` no tiene ni un solo grant en el proyecto remoto** — todo está
  concedido a `authenticated`. Esto significa que el Feed no puede renderizar
  nada antes del login: el auth gating (qué pantalla se muestra según haya o
  no sesión activa) es el siguiente trabajo pendiente, no un detalle
  posterior. Ver sección 8.

---

## 6. Cómo pedirle trabajo a la IA en este repo

- Pide **tokens antes que pantallas**: extraer `theme.ts` del CSS antes de
  construir el primer componente.
- Ve **pantalla por pantalla**, no "constrúyeme la app" — con 39 pantallas,
  pedir todo junto es la forma más segura de que algo se desvíe del diseño.
- Separa **UI de datos en dos pasos**: primero el componente con datos de
  prueba fiel al frame del HTML, después la conexión a Supabase con RLS.
- Si vas a agregar una pantalla que no existe en `relevo-app.html`
  (por ejemplo, para un caso de uso nuevo), constrúyela ahí primero.
- **Para cualquier trabajo de esquema/RLS/backend, usa Plan Mode y aprueba
  por fases chicas**, no un plan que cubra varias tablas o varios flujos a la
  vez. El esquema actual pasó por 5 rondas de revisión de plan antes de
  ejecutarse — cada ronda encontró un hueco de seguridad real (grants sin
  policy que los respalde, `ON DELETE CASCADE` borrando evidencia de
  moderación, un `UPDATE` que podía reapuntar una calificación). Ninguno de
  esos huecos era visible con solo "que compile" — se necesitó revisión
  deliberada antes de aprobar.
- Para tareas de backend en particular: **valida en local con Docker antes de
  aplicar a remoto**, y prueba como el rol `authenticated` real, no como
  `postgres`/superusuario — varios bugs de esta fase (grants inútiles por
  `pg_default_acl`, un `permission denied` en un trigger, un segfault
  reproducible) solo aparecieron corriendo la suite con privilegios reales.

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
- 6 migraciones aplicadas al proyecto remoto (`ukxfnydfhmryrzhdqkvj`, Ohio),
  con RLS + regresión de 42 aserciones pasando.
- Seed de datos de referencia (12 categorías, Tec de Monterrey / campus
  Monterrey) aplicado en remoto vía `db push --include-seed` (el CLI no lo
  hace automático — `db push` empuja migraciones, no datos; los seeds solo
  corren en `db start`/`db reset` locales). `seed.sql` es idempotente
  (`on conflict do nothing`) porque un seed remoto sí se puede volver a
  correr, a diferencia del local que siempre parte de una base limpia.
- Cliente conectado: `@supabase/supabase-js` con sesión cifrada
  (`src/lib/supabase.ts`, patrón `LargeSecureStore` — AES-256 vía
  `expo-crypto`, llave en `expo-secure-store`, ciphertext en AsyncStorage
  porque `SecureStore` rechaza payloads >~2KB y una sesión completa los
  excede). `detectSessionInUrl: false` porque no hay URL de navegador que
  parsear en React Native.
- Tipos de TypeScript generados del esquema real (`src/lib/database.types.ts`,
  `npm run gen:types`) — solo `schema public`, `private` queda fuera a
  propósito.
- Variables de entorno: `.env.local` (real, ignorado) + `.env.example`
  (commiteado, vacío) — `EXPO_PUBLIC_SUPABASE_URL` y
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

**Pendiente, en este orden de prioridad:**
1. **Auth gating** — el root layout todavía no decide a qué grupo de rutas
   mandar según haya o no sesión activa. Sin esto, ninguna pantalla puede
   mostrar datos reales (confirmado: `anon` no tiene grants).
2. Bucket de Storage + políticas para `listing_photos.storage_url` — el
   esquema ya asume su existencia, pero `config.toml` no lo tiene configurado.
3. Edge Functions para el push de RF-16 (Expo Notifications) — el esquema
   deja los datos listos (`listing_contacts`, `favorites`), pero no hay
   función que dispare la notificación todavía.

---

## 9. Gotchas de infraestructura (para no re-descubrirlos)

- **`pg_default_acl` hace que los `grant` de columna sean inútiles sin un
  `revoke all` explícito primero.** Supabase otorga privilegios por default
  sobre cada tabla nueva de `public` a `anon`/`authenticated`/`service_role`.
  Un `grant select (columnas_seguras)` es puramente aditivo — no retira nada
  ya concedido. La primera corrida de la suite de RLS confirmó esto en carne
  propia: `correo` se leyó sin problema pese al grant "restringido". Cada
  bloque de grants en las migraciones lleva ahora un comentario explicando
  esto — **cualquier tabla nueva necesita el mismo patrón: revocar primero,
  otorgar después.**
- **Un `policy` no puede invocar una función `SECURITY DEFINER` sin que el rol
  invocante tenga `USAGE`/`EXECUTE` sobre ella** — aunque la función "corra
  con privilegios elevados", Postgres exige el permiso de invocación al rol
  que dispara la policy, no solo al dueño de la función.
- **Segfault reproducible y ya diagnosticado** (ver `supabase/KNOWN_ISSUES.md`
  para el detalle completo): una policy que referencia una función
  `SECURITY DEFINER` sin privilegio de ejecución, cuyo rechazo se captura
  dentro de un bloque `EXCEPTION` de PL/pgSQL, tumba el engine de Postgres
  local con `SIGSEGV` — no da un `permission denied` limpio. Es la razón por
  la que `authenticated` tiene `USAGE`/`EXECUTE` sobre `is_active_user()` y
  `can_rate()`: no por necesidad funcional del camino feliz (se probó que las
  escrituras legítimas funcionan sin ese grant), sino porque sin él, cualquier
  función futura en plpgsql que envuelva un insert/update en un bloque
  `EXCEPTION` (el patrón normal de manejo de errores) puede volver a
  dispararlo. **No lo "endurezcas" quitando esos grants sin releer
  `KNOWN_ISSUES.md` primero** — la suite de regresión tiene aserciones
  dedicadas que fallan con mensaje legible si alguien lo intenta.
- **Desde el 30 de mayo de 2026, Supabase ya no expone tablas nuevas al Data
  API por defecto.** Las tablas actuales ya tienen sus `grant` explícitos en
  las migraciones; cualquier tabla que se agregue después necesita el suyo
  propio o será invisible para el cliente aunque RLS esté bien configurado.
- **`supabase db push` no aplica `seed.sql`.** Solo `db start` (primera vez) y
  `db reset` lo corren, y ambos son locales. Para sembrar datos de referencia
  en remoto, usa `db push --include-seed` explícitamente.