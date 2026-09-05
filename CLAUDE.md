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

---

## 1. Stack tecnológico

| Capa | Tecnología | Por qué |
|---|---|---|
| App móvil | React Native + Expo | Un solo código para iOS/Android, builds sin Mac vía EAS Build |
| Backend / BD | Supabase (Postgres) | Auth + BD relacional + Storage + Row Level Security, sin backend custom |
| Notificaciones | Expo Notifications | Integración directa, disparadas desde Supabase Edge Functions |
| Admin / moderación | Supabase Studio | Panel de reportes y suspensión de usuarios/publicaciones, sin desarrollo adicional |
| Distribución | EAS Build / Submit | Publicar a ambas tiendas sin infraestructura nativa propia |

**Principios no negociables:**
- Row Level Security en todas las tablas — un usuario solo edita sus propias
  publicaciones y datos, sin lógica de autorización duplicada en el cliente.
- `universidad_id` y `campus_id` presentes en `users` y `listings` desde el
  esquema inicial, aunque hoy solo exista una universidad/campus activo —
  esto es lo que permite escalar a más universidades sin migración mayor.
- Sin comisiones, sin pagos integrados, sin chat interno en esta fase.

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

Antes de escribir `theme.ts` / `tailwind.config`, pide a la IA que lea el
`<style>` de `relevo-app.html` completo — border-radius, spacing y sombras
también están ahí, no solo el color.

---

## 3. Modelo de datos (entidades principales)

```
users
  id, correo, nombre, foto_url, universidad_id, campus_id,
  carrera, rating_promedio, estado (activo/suspendido)

universidades
  id, nombre           -- Tec de Monterrey, UANL, UDEM, U-ERRE, UVM…

campus
  id, universidad_id, nombre, ciudad   -- ej. campus "Monterrey" de Tec

categories
  id, nombre           -- Libros, Electrónica, Muebles, Ropa, Deportes,
                          Apuntes, Hogar, Papelería, Instrumentos,
                          Arte y manualidades, Boletos y eventos, Otros

listings
  id, user_id → users, categoria_id → categories,
  universidad_id, campus_id,
  título, descripción, precio, condición,
  estado (activa/pausada/vendida), vistas_count

listing_photos
  id, listing_id → listings, storage_url, orden

favorites
  user_id → users, listing_id → listings

listing_contacts
  user_id → users, listing_id → listings, created_at
  -- se registra cada tap en "Contactar por WhatsApp"; es la fuente de
  -- candidatos para el flujo "¿A quién le vendiste?" (ver sección 5)

ratings
  from_user_id, to_user_id → users, listing_id → listings,
  estrellas, comentario

reports
  listing_id / user_id reportado, reporter_id → users,
  motivo, estado
```

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

**Regla de precedencia entre skills** (ver también sección 0, regla 6):
cuando dos skills sugieran patrones distintos para lo mismo (ej. un patrón de
navegación), gana primero `/design/relevo-app.html`, luego `/docs/product-spec.md`,
y solo al final las convenciones genéricas de los skills.
