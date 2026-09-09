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

Es un prototipo HTML/CSS/JS autocontenido con las 47 pantallas de la app
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

Aplicado en 11 migraciones (`supabase/migrations/`) contra el proyecto remoto,
con RLS activo y probado en las 10 tablas más el bucket de Storage. Este es el esquema **real**, no
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
  id, listing_id, storage_path, orden (0-4, único por listing — tope de 5 fotos
  enforced con trigger). `storage_path` es una RUTA dentro del bucket privado
  `listing-photos` (`{listing_id}/{uuid}.jpg`), NO una URL — ver abajo.

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

**Una publicación no pasa a `activa` sin al menos una foto** — trigger
`listings_enforce_activation_has_photos` (`20260909000447`), que llama a
`private.enforce_activation_has_photos()`. Existe porque el alta atómica (§8b)
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
  siendo posible — deuda consciente documentada en §8, con su disparador y su
  fix. No es que no se pueda: es que cerrarlo cuesta reescribir 4 bloques de
  fixtures de la suite y voltear el default de la columna.
- El guard equivalente en el cliente (§8b) **no es lógica de autorización
  duplicada**: el candado es este trigger, el cliente solo traduce su
  `raise exception` a un toast con salida.

**Funciones `SECURITY DEFINER`** viven en el esquema `private` (nunca en
`public`) excepto DOS, que sí deben ser invocables por PostgREST desde el
cliente: `increment_listing_view` y `listing_favorites_count` (eran una sola
hasta que Detalle necesitó el conteo de favoritos; si algún día hay una
tercera, revisa primero si de verdad la invoca el cliente o si va en `private`).
`authenticated` tiene `USAGE` sobre `private` + `EXECUTE` acotado
a las TRES que se invocan desde policies — `is_active_user()`, `can_rate()` y
`listing_id_from_object_name()` — mientras las otras cinco, que solo disparan
por trigger, siguen revocadas. Ver sección 9 sobre por qué ese `USAGE` existe (no es lo que
originalmente se pensó).

**Regresión de RLS:** `supabase/tests/rls.sql`, 67 aserciones, corre dentro de
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
vigiladas a 5 sin cambiar la cuenta.
**Moraleja para secciones nuevas: no reutilices fixtures de secciones
anteriores** — a media suite hay filas y cuentas ya borradas a propósito.
Incluye controles negativos (el esquema se rompió a propósito para confirmar
que la suite sí falla cuando debe). Cualquier cambio a policies/grants debe
correr esta suite antes de comitear.

---

## 4. Inventario completo de pantallas (47)

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

### Publicar (5)
Publicar · Publicar (subiendo imágenes) · Publicar (error de subida) ·
Editar publicación · Publicación creada

### Cuenta (8)
Perfil · Editar perfil · Perfil público · Favoritos · Favoritos vacío ·
Mis publicaciones · Mis publicaciones vacío · Mis publicaciones (acciones)

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
  app" — con 47 pantallas, pedir todo junto es la forma más segura de que
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
- 11 migraciones aplicadas al proyecto remoto (`ukxfnydfhmryrzhdqkvj`, Ohio),
  con RLS + regresión de 67 aserciones pasando. (§3 es la cuenta buena: esta
  línea ya se quedó atrás dos veces —en 8/53 y en 10/64—, así que si no
  coinciden, la de §3 gana.)
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
- **Bucket de Storage `listing-photos` con RLS** (migraciones `20260908000445`
  y `20260908000446`). Cuatro piezas:
  - **El bucket**: `listing-photos`, **privado**, `file_size_limit` de **5 MiB**,
    `allowed_mime_types` `image/jpeg`, `image/png`, `image/webp`. Declarado en
    `config.toml` y aplicado a remoto con `supabase seed buckets --linked`. El
    límite y los mime types los aplica el servicio de Storage antes de escribir,
    no el cliente: son defensa real, no validación cosmética.
  - **La columna**: `storage_url` → **`storage_path`**, porque en un bucket
    privado se guarda la ruta del objeto (`{listing_id}/{uuid}.ext`), no una URL.
  - **El helper**: `private.listing_id_from_object_name(text)`, que traduce la
    carpeta del objeto a un `listing_id` — la carpeta es la llave de
    autorización, y esa función es lo único que las policies leen del nombre.
  - **Las 4 policies sobre `storage.objects`**, espejo de las de la tabla:
    `listing_photos_objects_select` con el mismo criterio que **`listings_select`**
    (todas salvo las pausadas, que solo ve su dueño), y las de
    `insert`/`update`/`delete` con el de **`listing_photos_write_own`** (solo el
    dueño del listing) más `is_active_user()`, porque un suspendido no puede
    tocar sus fotos.

  Verificado con 11 aserciones nuevas en la suite (T14) **y** con
  `scripts/probe-storage.mjs`, que ejercita el Storage API sobre HTTP. Los dos
  con control negativo: se rompieron las policies a propósito y ambos fallaron
  donde debían.
  - **`scripts/probe-storage.mjs` no es un script desechable.** Cubre lo que la
    suite SQL no puede: `DELETE` (el trigger `storage.protect_delete` de Supabase
    aborta todo borrado por SQL antes de que la RLS opine, así que una aserción
    ahí pasaría con la policy borrada) y `move` (el `with_check` de UPDATE, sin el
    cual un dueño puede renombrar su objeto hacia la carpeta de otro — medido:
    devuelve **HTTP 200**).
  - **Ya se sube y se pinta.** El grupo Publicar escribe en `listing_photos` y
    `ListingPhoto` las lee por el endpoint autenticado — ver §8b.
- **Grupo Explorar conectado a datos reales** (7ª migración incluida:
  `listing_favorites_count`). Los mocks `src/constants/mock/{listings,campus,
  categorias}.ts` ya no existen; la capa de datos vive en `src/lib/listings.ts`,
  `src/lib/categorias.ts` y `src/lib/favoritos.ts`. Ver §8b.

- **"Mis publicaciones" construida y conectada** — cierra el callejón sin salida
  que había creado conectar Publicar (se podía pausar desde Editar y después la
  publicación no era alcanzable desde ninguna parte). `fetchMisListings()` /
  `useMisListings()` en `src/lib/listings.ts`, pantalla en
  `(cuenta)/mis-publicaciones.tsx`, entrada por un `.menu-row` en Perfil. Ver
  §8b. Es también lo que desbloqueó el modelo atómico de publicación.

- **"Publicar" migrado al modelo ATÓMICO** — la publicación se crea `pausada`,
  suben todas sus fotos, y solo si TODAS suben pasa a `activa`. Reemplaza al
  modelo de "publica ya, recupera fotos después", en el que un fallo parcial
  dejaba la publicación visible con menos fotos de las que el usuario eligió.
  Cuatro consecuencias que no son opcionales:
  - **El aviso persistente de "Publicación creada (fotos faltantes)" se
    ELIMINÓ**, no se dejó apagado: el camino que lo justificaba —activa con
    fotos incompletas— ya no existe. Se fueron con él su frame en
    `relevo-app.html`, el segundo estado de `creada.tsx`, sus params de ruta
    (`fallidas`/`total`) y las props `belowSub`/`subStyle` de `EmptyState`, que
    quedaban sin ningún consumidor. El `.notice` no se borró: se mudó al
    `.sticky-cta` de Publicar, que es donde ahora hay una acción que lo
    resuelve.
  - **El fallo se resuelve SIN salir de Publicar**, con "Reintentar", que sube
    solo lo que faltó. Dos frames nuevos en el diseño: "Publicar (subiendo
    imágenes)" y "Publicar (error de subida)".
  - **`guardarFotos()` corre también cuando alguna foto falló**, y eso no es
    prolijidad: sin esas filas, los objetos que sí subieron quedarían
    invisibles para "Mis publicaciones" —que lee `listing_photos` para saber
    qué borrar— y abandonar la pantalla dejaría huérfanos permanentes.
  - **Lo respalda un trigger en la base**, no solo el cliente: ver §3
    (`listings_enforce_activation_has_photos`).

**Pendiente, en este orden de prioridad:**
1. Edge Functions para el push de RF-16 (Expo Notifications) — el esquema
   deja los datos listos (`listing_contacts`, `favorites`), pero no hay
   función que dispare la notificación todavía.
2. **Columna `telefono` en `public.users` + su captura.** El botón "Contactar
   por WhatsApp" abre un `wa.me` con un número placeholder, porque no hay de
   dónde sacar el real: no existe la columna
   (`20260906000438_users_profiles.sql`), `docs/product-spec.md` §Modelo de
   datos no la lista, y ningún frame de `relevo-app.html` la captura —
   RF-13 y RF-05 la asumen sin definirla nunca. Resolverlo es migración +
   frame nuevo en el diseño + campo en "Completar perfil" y "Editar perfil",
   no una línea de código. El insert a `listing_contacts` (lo que de verdad
   habilita RF-12) SÍ es real desde ya.

**Deuda consciente — con disparador de revisión, no "algún día":**

- **Un insert directo con `estado='activa'` y 0 fotos sigue siendo posible.** El
  trigger `listings_enforce_activation_has_photos` (§3) solo cubre UPDATE. Es
  hermano exacto del punto de abajo: el cliente ya no toma ese camino (toda
  publicación nace `pausada`), así que lo expuesto es Studio, `service_role` o
  quien pegue al API directo — y es calidad de dato, no seguridad: un
  autenticado que lo haga solo se ensucia su propia publicación.
  **No es que no se pueda** —un `before insert` con el mismo
  `when (new.estado = 'activa')` sería viable y no tocaría el flujo real—, es
  que hoy no se paga: la suite siembra 6 listings `activa` directo en 4 bloques
  de fixtures load-bearing (T11b, T13, T14 y las del inicio), y rehacerlos las
  acopla a `listing_photos` sin relación con lo que prueban; además `estado` es
  `not null default 'activa'`, así que el trigger reventaría cualquier insert
  que omita la columna, Studio incluido. **Revisar cuando:** se abra la API a
  terceros, o aparezca en el feed una publicación sin fotos que no vino de la
  app. **Fix:** ese trigger + voltear el default a `'pausada'` + reescribir las
  4 fixtures.
- **Si falla `guardarFotos()` —no la subida— los objetos quedan sin fila.** El
  alta atómica escribe las filas de un golpe al final, así que entre las subidas
  y ese insert hay una ventana. El reintento la cierra (el formulario conserva
  los paths), pero si el usuario abandona ahí, los archivos quedan huérfanos.
  Es el caso raro del caso raro: `guardarFotos` fallando, no una foto. **Es el
  mismo cron de barrido del punto de abajo**, no una deuda aparte.
- **El tope de 5 fotos SIGUE sin aplicar en Storage** — el disparador se cumplió
  (se conectó Publicar) y esto es lo que quedó. Lo impone el trigger
  `enforce_photo_limit()` sobre `listing_photos`; las policies de
  `storage.objects` solo validan de quién es la carpeta. Lo que sí cambió: el
  cliente es hoy el único camino de subida y respeta el tope en tres puntos
  (`elegirFotos()` recorta a los disponibles, `PhotoRow` esconde el `.photo-add`
  al llegar a 5, `agregarFotos()` hace `slice(0, MAX_FOTOS)`). O sea que la app
  no genera huérfanos por este camino — salvo la ventana del punto de arriba,
  que antes se cerraba borrando el objeto cuando fallaba su fila, y dejó de
  poder hacerse cuando las filas pasaron a escribirse todas juntas al final
  (ver `subirPendientes()`). Lo que queda expuesto es un cliente hostil
  llamando al Storage API directo: puede llenar su propia carpeta sin filas.
  **Revisar cuando:** el costo de almacenamiento aparezca en la factura, o se
  abra la API a terceros. **Fix:** contar objetos en la policy de insert, o un
  cron de barrido.
- ~~**Borrar una publicación no borra sus fotos de Storage.**~~ **CERRADA** al
  construir "Confirmar eliminar" en Editar publicación. No hizo falta la Edge
  Function que se había previsto: el cliente borra los objetos **antes** de
  borrar el listing, y ese orden es obligatorio, no una preferencia —
  `listing_photos_objects_delete_own` exige que el listing EXISTA para autorizar
  el borrado del objeto, así que al revés los archivos quedan huérfanos *y* sin
  forma de borrarlos. Mismo criterio en Editar al quitar una foto. **Lo que
  sigue abierto:** si el `borrarFotos()` falla (es best-effort, para no dejar al
  usuario sin poder borrar su publicación) los archivos quedan huérfanos igual;
  eso sí necesitaría un barrido, y es el mismo cron del punto anterior.
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

Del grupo Publicar se sumaron: **`ListingPhoto`** (arriba), **`PhotoRow`**
(`.photo-row`/`.photo-thumb`/`.photo-add`/`.photo-remove`, con el contador
`N/5`) y **`ListingFormFields`**, que es EL formulario de publicación —
"Publicar" y "Editar publicación" lo comparten porque, tras actualizar el
diseño, tienen los mismos campos en el mismo orden. `FormHeader` creció con
`leading` (`'back'`/`'close'`) y `trailing` (la acción "Guardar" en `--brick`).

Al migrar al modelo atómico se sumaron dos más, ambos por EXTRACCIÓN y no
escritos de cero:
- **`Notice`** (`.notice`) — el aviso persistente, sacado tal cual de
  `creada.tsx`. Es hermano del `Toast`, no una variante: el toast se va a los 4s
  y este trae una acción, así que irse mientras se lee es justo lo que no debe
  hacer.
- **`BlinkingDots`** (`.splash-dots`) — los 3 puntos que ya vivían dentro de
  `(onboarding)/splash.tsx`. Son el ÚNICO indicador de espera del sistema de
  diseño, así que el botón "Subiendo imágenes" los reusa en vez de estrenar un
  spinner. Que funcionen sobre `--brick` no es suerte: `.splash-dot` es
  `--paper` al 50%, el mismo color del texto de `.primary-btn`.

Y **`PrimaryButton` creció con `busy`**, que NO es `disabled` con otro nombre:
`disabled` (0.45) dice "todavía no puedes", `busy` dice "está pasando" y va a
color pleno — bajarlo apagaría los puntos que comunican el avance.

Botones inertes a propósito (llevan a grupos sin construir): Compartir,
Reportar, menú kebab y "Marcar como vendida". **"Editar publicación" en
Detalle ya NO es inerte** — navega a `(publicar)/editar/[id]`. El botón de
WhatsApp sí registra de verdad en `listing_contacts` antes de abrir el deep
link; lo único mock que le queda es el número, y por la razón documentada en §8
(pendiente 2), no por descuido.

**Fotos: construidas, con UN pendiente de dispositivo real.**
`src/components/ListingPhoto.tsx` es el punto ÚNICO de contacto con el bucket
privado — envoltura de `expo-image` que arma
`GET /storage/v1/object/authenticated/listing-photos/<path>` con
`Authorization: Bearer <access_token>` leído de `useSession()`. Todo lo que
pinte una foto pasa por ahí (`ProductCard`, Detalle, `PhotoRow`).

**Ojo con lo que esto cambió en Explorar, que estaba dado por cerrado:**
`ProductCard` y Detalle **ya no usan el ícono de categoría tintado como imagen
principal** — pasó a ser el `fallback` de `ListingPhoto`, y solo se ve cuando la
publicación no tiene `storage_path` (las creadas antes de que existiera la
subida, o dadas de alta desde Studio). No lo "restaures" creyendo que la foto
sobra.

**PENDIENTE REAL, no un extra:** confirmar que el header `Authorization` de
`expo-image` llegue en un **Android real**. Por la regla de la sección 6 el
simulador headless no cuenta como prueba, y todo el patrón de lectura depende de
ese header. Si no llegara, la respuesta NO es migrar a signed URLs: eso es un
cambio de semántica de seguridad disfrazado de refactor (§9).

**Publicar — construido, conectado y ATÓMICO.** Las 5 pantallas viven en 3
archivos de ruta: `nueva.tsx` cubre los 3 estados de Publicar (formulario,
subiendo, error de subida), más `creada.tsx` —hoy de un solo estado— y
`editar/[id].tsx`. La capa de datos: `src/lib/storage.ts` (subida, borrado y URL
autenticada), `src/lib/publicar.ts` (la orquestación y su orden de llamadas),
`src/lib/listing-form.ts` (estado + validación compartida) y
`src/lib/foto-picker.ts`.

Detalles que no se ven en el diff:

- **No se puede subir una foto antes de crear el listing, y no es una decisión
  de UX.** La carpeta del objeto ES `{listing_id}/`, y
  `listing_photos_objects_insert_own` exige que ese listing exista y sea del
  invocante. Cualquier diseño de "subo mientras el usuario llena el formulario"
  choca con la policy. Por simetría, Editar también difiere al Guardar: subir al
  elegir y salir sin guardar dejaría objetos huérfanos que nadie ve ni limpia.
  Esto sigue aplicando igual bajo el modelo atómico.
- **Un fallo de fotos NO hace rollback del listing, y tampoco lo activa.** La
  publicación se queda `pausada` con lo que sí subió, y el usuario reintenta
  desde la misma pantalla. Borrarla sería peor de las dos maneras: perdería lo
  que escribió y ni siquiera limpiaría los archivos ya subidos (el cascade se
  lleva las filas, no los objetos). Si abandona en ese estado, la recupera desde
  "Mis publicaciones" — esa pantalla es la que hizo viable este modelo.
- **Publicar y Reintentar son la MISMA función**, y lo único que las distingue
  es si `nueva.tsx` ya tiene un `listingId` en estado. Por eso
  `publicarListing()` avisa el id por `onListingCreado` ANTES de subir y no al
  devolver: al devolver ya sería tarde justo en el caso que lo necesita, y cada
  reintento crearía una publicación `pausada` huérfana más.
- **`finalizarPublicacion()` es idempotente a propósito.** Reintentar no es un
  camino aparte: es volver a llamarla. Las fotos ya subidas se saltan solas
  (`subirPendientes` ignora las de origen `'storage'`), el delete+insert de
  `guardarFotos` se repite sin daño y activar dos veces da lo mismo. Eso cubre
  también los fallos que NO son de subida — si revienta `guardarFotos` o la
  activación, el mismo botón los resuelve.
- **El alta ya no inserta las filas de `listing_photos` de a una**, y no es un
  refactor cosmético: numerar `orden` por foto colisiona en cuanto hay un
  reintento parcial. Si de 3 fotos falla la 2ª, las que quedaron toman `orden` 0
  y 1; al reintentar, la foto 2 se insertaría con `orden = 1`, ya tomado, y
  revienta contra `unique (listing_id, orden)`. La única numeración correcta es
  la del set final completo, así que las escribe `guardarFotos()` de un golpe.
  Se fue con eso `insertarFoto()`, que quedó sin usar. Si vuelves a ver un
  insert por foto en `subirPendientes()`, es esa regresión.
- **El formulario se congela también en el estado de ERROR**, no solo mientras
  sube: la publicación ya existe en la base, así que seguir editando el texto en
  pantalla lo desincronizaría de lo guardado.
- **`guardarFotos()` hace delete + insert, nunca un upsert.**
  `enforce_photo_limit()` es un trigger BEFORE INSERT y dispara también en la
  rama `ON CONFLICT DO UPDATE`, así que un upsert sobre una publicación con 5
  fotos reventaría al EDITARLA. Solo corre si el set de fotos cambió: esa
  reescritura deja la publicación sin fotos entre el delete y el insert, y
  editar solo el precio no debe pagar ese riesgo.
- **El cuerpo del upload es un `ArrayBuffer` con `contentType` explícito.**
  Verificado contra `node_modules`: el `File` de `expo-file-system` declara
  `implements Blob` pero no pasa el `instanceof Blob` de storage-js
  (`dist/index.cjs:622`), y el `contentType` por default de esa librería es
  `text/plain;charset=UTF-8`, que el bucket rechaza. Sin esa línea no funciona
  ninguna subida.
- **La entrada a Publicar es el FAB de Perfil**, la única que define el diseño
  (§0.6: el tab bar tiene 4 ítems, sin "+" central). **Vive en
  `(tabs)/_layout.tsx` como hermano de `<NativeTabs>`, NO dentro de
  `perfil.tsx`** — ahí se pintaba pero no recibía el toque; ver el gotcha de §9
  antes de "acercarlo a su pantalla". El layout decide mostrarlo solo cuando
  `usePathname() === '/perfil'`. El resto de la pantalla Perfil sigue siendo
  placeholder.
- **"Marcar como vendida" sigue inerte** en Editar: dispara "¿A quién le
  vendiste?" del grupo Confianza. Cablearla como un update suelto a `'vendida'`
  saltándose ese paso rompería RF-12.

**Cuenta — 3 de 8 pantallas, las de "Mis publicaciones", construidas y
conectadas.** Se hicieron por necesidad, no por avanzar el grupo: conectar
Publicar dejó la app en un estado donde pausar una publicación la volvía
inalcanzable (el Feed filtra `estado = 'activa'`), y lo mismo pasaba con una que
quedaba sin fotos por un fallo de subida. Eso último dejó de ser un accidente y
pasó a ser el diseño: el modelo atómico DEPENDE de esta pantalla, porque una
publicación que se queda `pausada` por un fallo de subida se recupera aquí.

- **`(cuenta)/mis-publicaciones.tsx`** cubre los 3 frames: la lista, su vacío y
  la hoja de acciones. Lee con `useMisListings()` (`src/lib/listings.ts`), que es
  hermano de `useListings` pero con su propia query: **sin embed de vendedor**
  —todas las filas son mías, así que el `PGRST201` de la doble relación ni se
  plantea— y con **todas** las fotos, no solo la portada.
- **Ese `fotos: string[]` completo no es de más.** Eliminar tiene que borrar los
  objetos ANTES que el listing (`listing_photos_objects_delete_own` exige que el
  listing exista para autorizar el borrado), y para entonces ya no hay de dónde
  leer las rutas. Es la misma secuencia de `editar/[id].tsx`.
- **La hoja de acciones es un `Modal` de RN, no un `SheetScreen`**, y por la
  misma razón: necesita el objeto de la fila en la mano, no params
  serializables. Es el caso de `CampusBottomSheet`, no el de `filtros.tsx`.
- **`useMisListings` resetea su estado en RENDER, no dentro del efecto**
  (compara una `key` contra la anterior) — mismo patrón que ya trae
  `useListings`, alineado a este cuando se detectó la inconsistencia (ver
  CLAUDE.md §9 sobre `set-state-in-effect`). Resetear en la primera línea del
  efecto de carga es equivalente en el resultado final, pero deja pasar un
  render con la lista VIEJA todavía pintada bajo el filtro/orden nuevo; hacerlo
  en render lo evita.
- **`StatusRow` dejó de ser local de `editar/[id].tsx`** y vive en
  `src/components/StatusRow.tsx`: la hoja es literalmente la `.status-section`
  de ese frame en otro contenedor. `Toggle` sí se quedó allá.
- **Reactivar valida que haya al menos una foto, en las DOS rutas** (la hoja de
  acciones aquí y el toggle de `editar/[id].tsx`). El candado real es el trigger
  de §3; estos `if` no lo duplican, traducen su `raise exception` a un toast con
  salida — en "Mis publicaciones", además, abre Editar, que es donde se arregla.
  El caso es real desde el modelo atómico: una subida que falla entera deja la
  publicación `pausada` con 0 fotos. El guard sale ANTES del optimistic update,
  o la fila parpadearía a "Activa" y volvería.
- **En Editar, ese guard lee `fotosGuardadas`, un estado que se sincroniza tras
  cada guardado** — no `listing.fotos` (el prop, congelado al abrir la
  pantalla) ni `form.fotos` (lo que hay en el formulario sin guardar todavía).
  El toggle escribe directo a la base sin pasar por "Guardar", así que una foto
  recién elegida no existe todavía para el trigger; y tras un guardado con
  éxito parcial la pantalla no navega, así que `listing.fotos` deja de
  reflejar lo que hay en la base mientras la sesión de edición sigue abierta.
- `SkeletonRows` (nuevo, en `Skeleton.tsx`) es el esqueleto de una lista plana —
  `SkeletonGrid` habría anticipado una forma que no es la que llega.

Lo que sigue siendo placeholder de Perfil: avatar, stats y el resto del
`.menu-list`. Hoy tiene dos afordances reales (cerrar sesión y "Mis
publicaciones") más el FAB de publicar.

**Confianza y Notificaciones — no construidos todavía.** Del grupo Cuenta
tampoco lo están *Favoritos* (sigue siendo placeholder aunque el toggle de
favorito ya funcione en todo Explorar), *Editar perfil* ni *Perfil público*.
**Sistema** tiene las 3 piezas que Explorar necesitó (arriba) más "Confirmar
eliminar", cableado con `ConfirmModal` + `DangerButton` tanto en Editar
publicación como en Mis publicaciones.

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
- **`postgres` no es dueño de `storage.objects` y aun así puede politiquearla.**
  La dueña es `supabase_storage_admin` y `postgres` ni siquiera es miembro de ese
  rol, así que `create policy` debería fallar con 42501 "must be owner of table
  objects". No falla porque `supautils.policy_grants` lista `storage.objects` para
  `postgres` — verificado en `pg_settings` en local **y** en remoto. Por eso las
  policies de Storage viven en una migración versionada normal y no hay que
  crearlas a mano en el Dashboard. Si algún día una migración de Storage sí
  revienta con 42501, ese ajuste es lo primero que hay que mirar.
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
  image/heic` y Storage la rechaza. **Corregido** (§8, deja de ser el motivo
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
- **`presentation:'transparentModal'` de un Stack anidado no funciona si el
  Stack padre ya presenta esa ruta como card opaca.** El navegador que de
  verdad ejecuta el `push` (a menudo el Stack raíz, no el Stack del grupo
  donde vive el archivo) es el que decide cómo se presenta la transición.
  Una hoja/modal transparente debe declararse en el Stack que realmente
  monta esa ruta — moverla de un grupo anidado a una ruta de nivel raíz
  (como se hizo con `selector-campus.tsx`/`filtros.tsx`) resuelve esto sin
  tener que migrar a un `Modal` de RN.
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