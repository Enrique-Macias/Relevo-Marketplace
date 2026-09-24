# Marketplace de estudiantes en Monterrey — MVP (Fase 1)

Definición del problema, requerimientos, stack tecnológico y arquitectura para
el MVP — arrancando únicamente con productos.

- **Preparado por:** Enrique Macías
- **Alcance:** Fase 1 — Productos
- **Plataforma objetivo:** iOS & Android
- **Nombre de producto:** Relevo (definido posteriormente; el documento
  original usaba "Marketplace MTY")

---

## 01. Definición del problema

Los estudiantes y jóvenes de Monterrey no tienen un espacio de compra-venta
enfocado en su comunidad. Hoy recurren a canales genéricos y fragmentados —
Facebook Marketplace, grupos de WhatsApp por generación o facultad,
publicaciones sueltas en grupos de "compra-venta" por universidad — donde:

- No hay verificación de que el otro usuario sea estudiante, lo que reduce la
  confianza (riesgo de fraude, gente ajena a la comunidad).
- La oferta está dispersa en decenas de grupos distintos según universidad,
  generación o campus, sin catálogo centralizado ni búsqueda real.
- No existe continuidad: los grupos de "venta de libros" de una generación
  desaparecen o se vuelven inactivos en cuanto esa generación egresa.
- Falta contexto de proximidad real (mismo campus, misma zona) que facilite la
  entrega en persona, clave para estudiantes sin muchos recursos para envíos.

### Hipótesis central

Si se ofrece un marketplace enfocado exclusivamente en estudiantes
(verificados por correo institucional o universidad), con catálogo persistente
y búsqueda por campus/categoría, se reduce la fricción de confianza y
descubrimiento que hoy exige usar 5–6 canales distintos.

**A validar en el MVP:** ¿hay suficiente densidad de oferta y demanda dentro de
una sola universidad/campus como para sostener un catálogo vivo, sin necesitar
masa crítica citywide desde el día uno?

> **Nota de escala (post-documento original):** el producto se posiciona para
> escalar a nacional, multi-universidad, desde el modelo de datos — no solo
> Monterrey. Ver `CLAUDE.md` sección 3 (modelo de datos: `universidades` y
> `campus` como entidades separadas).

---

## 02. Qué se va a construir

**Fase 1 (MVP — este documento):** solo productos. Marketplace de
compra-venta de artículos entre estudiantes: libros, apuntes, electrónica,
muebles, ropa, artículos deportivos, etc. Sin pagos integrados ni logística de
envío — el intercambio se acuerda y ejecuta directamente entre comprador y
vendedor (efectivo o transferencia, entrega en persona).

**En esta fase:**
- Catálogo de productos entre estudiantes
- Verificación por correo institucional
- Búsqueda, filtros y favoritos
- Contacto directo vía WhatsApp
- Calificaciones y reportes básicos

**Fuera de alcance (después):**
- Servicios y tutorías — Fase 2
- Pagos integrados / escrow
- Logística de envíos
- Mensajería interna en la app
- Expansión multi-ciudad

**Alcance geográfico inicial:** una universidad o campus específico para
concentrar densidad de usuarios, con posibilidad de expandir a más campus una
vez validado.

---

## 03. Requerimientos funcionales

### Gestión de usuarios
- **RF-01** Registro con correo institucional (o verificación alternativa)
  para confirmar que el usuario es estudiante. Flujo de dos pasos: correo →
  código de verificación de 6 dígitos (ver pantallas "Verificación" y
  "Código de verificación"). El registro en sí es passwordless — no pide
  contraseña en este paso. La contraseña se establece después, en "Completar
  perfil" (ver RF-03), una vez que ya existe sesión activa; no es lo que
  autentica el registro.
- **RF-02** Inicio de sesión por correo/contraseña — la contraseña fijada en
  "Completar perfil" (RF-01) — para cuando el usuario vuelve a abrir la app
  tras terminar el onboarding, y opcionalmente Google Sign-In si el correo
  institucional corre sobre Google Workspace.
- **RF-03** Perfil básico: nombre, universidad/campus, carrera, foto opcional,
  calificación promedio. Este es también el paso donde se fija la contraseña
  (ver RF-01/RF-02) — no es un campo de perfil visible para otros usuarios,
  pero se establece en la misma pantalla ("Completar perfil").
  **✅ Implementado** — incluida la **foto**, que era lo último que faltaba: se
  sube desde "Completar perfil" y "Editar perfil" al bucket `avatars`, se guarda
  en `users.foto_url` (la RUTA del objeto, no una URL) y se ve en las 9
  superficies que dibujan un avatar. Sigue siendo **opcional**: sin foto, el
  fallback de iniciales es el de siempre.
- **RF-04** Recuperación de contraseña. **✅ Implementado** — "Recuperar
  contraseña" → "Código de recuperación" → "Nueva contraseña", en tres pasos
  dentro de la app.
  **Va por OTP de 6 dígitos, NO por el enlace de correo** que describía el diseño
  original, y es una decisión de alcance: un enlace exige deep linking (dominio
  propio + `apple-app-site-association`/`assetlinks.json` + una página de respaldo
  para quien no tiene la app instalada), que sigue sin montarse y es su propio
  proyecto — el mismo bloqueo que hoy deja a "Compartir" sin link. Un código que se
  teclea no necesita nada de eso, y reusa el mecanismo de RF-01.
  Al guardar la contraseña nueva se cierra sesión y se vuelve a "Iniciar sesión":
  obliga a estrenarla, así que el usuario comprueba que funciona antes de salir del
  flujo.

### Publicaciones (listings)
- **RF-05** Crear publicación con título, descripción, categoría, precio,
  condición, hasta 5 fotos y zona de entrega. **✅ Implementado** — pantalla
  "Publicar". La app exige al menos 1 foto (decisión de producto; el esquema no
  la obliga). La zona de entrega sale del campus del perfil, no se elige.
  El precio es un **entero de pesos, $0-$100,000 inclusive** (el 0 permite
  regalar el artículo) — exigido por un `check` de base, no solo por el
  formulario (CLAUDE.md §3).
- **RF-06** Editar y eliminar publicación propia. **✅ Implementado** —
  "Editar publicación", incluidos agregar/quitar fotos dentro del tope de 5 y
  el borrado con confirmación (que borra también los archivos de Storage).
  **Editar aplica solo mientras la publicación NO esté vendida** (ver RF-08);
  eliminar, en cambio, sigue disponible en cualquier estado.
- **RF-07** Marcar publicación como "vendida" sin borrar el historial.
  **✅ Implementado** — desde las tres entradas (Editar publicación, Detalle
  vista vendedor y la hoja de acciones de Mis publicaciones), pasando siempre
  por "¿A quién le vendiste?" para no romper RF-12. Quién compró se guarda en
  `listing_sales`, tabla aparte y privada entre las dos partes: NO es una
  columna de `listings`, que es legible por todo el campus.
  El vendedor puede **corregir** al comprador mal elegido mientras no lo haya
  calificado — sin eso, al pasar a vendida desaparece la única entrada y el
  error sería permanente.
- **RF-08** Estados de publicación: activa, pausada, vendida.
  **✅ Implementado** — activa/pausada se alternan desde "Editar publicación" y
  desde "Mis publicaciones"; vendida llega por RF-07 y es **terminal**.
  Terminal significa que NINGÚN campo de la publicación se modifica ya: no se
  pausa, no se reactiva y **tampoco se edita** su contenido (título, precio,
  descripción, categoría, condición ni fotos). Lo hace cumplir la base —el
  `using` de `listings_update_own` exige `estado <> 'vendida'`—, no el cliente,
  así que tampoco se puede por API directa; las pantallas solo esconden las
  acciones para no ofrecer algo que va a ser rechazado.
  Lo único que sigue disponible sobre una vendida es **ver** la publicación,
  **cambiar el comprador** mientras la ventana de RF-07 siga abierta (eso vive en
  `listing_sales`, otra tabla con su propia policy) y **eliminarla**.

### Descubrimiento
- **RF-09** Catálogo/feed principal, ordenado por más reciente.
- **RF-10** Búsqueda por texto (título/descripción).
- **RF-11** Filtros por categoría, precio, condición y campus/zona.

### Confianza y contacto
- **RF-12** Calificación post-transacción entre comprador y vendedor
  (1–5 estrellas + comentario opcional). Como no hay chat interno (RF-13), el
  vendedor no sabe automáticamente quién compró: al marcar una publicación
  como vendida, se le muestra la lista de usuarios que tocaron "Contactar por
  WhatsApp" en esa publicación (ver RF-13) para que elija a quién calificar,
  con opción de salida "No fue a través de Relevo". Ver
  `/design/relevo-app.html` → pantallas "¿A quién le vendiste?" y "Calificar".
  **✅ Implementado, en las dos direcciones.** El vendedor califica desde el
  flujo de la venta; el comprador, desde el Detalle de la publicación vendida,
  al que llega por la notificación "Califica tu compra".
  Registrada la venta, **la única pareja que puede calificarse es vendedor ↔
  comprador**: `private.can_rate()` dejó de bastar con "hubo contacto". Sin ese
  apriete, cualquiera de los que solo preguntó podía dejar reseña.
  **⏳ Fuera de alcance:** "Omitir por ahora" es definitivo para el vendedor (no
  hay segunda entrada), y una reseña ya escrita no se retira. Ver `CLAUDE.md` §8.
- **RF-13** Botón de contacto que abre WhatsApp con el vendedor — sin chat
  interno en el MVP. Cada tap se registra (usuario, publicación, fecha) para
  habilitar RF-12; la conversación en sí ocurre fuera de la app.
  **✅ Implementado** — el número es real, se captura al publicar (no se puede
  publicar sin él) y se lee de a uno por RPC para no exponerlo en el perfil
  público (RNF-05). Ver el bloque de `users` en §Modelo de datos.
- **RF-14** Reporte de publicaciones **y de usuarios** hacia moderación, con
  motivo seleccionable: spam o publicidad, sospecha de fraude, contenido
  inapropiado, no es un estudiante, u otro (con comentario libre).
  **✅ Implementado, DOS objetivos** — el de publicación se dispara desde la
  bandera del header de "Detalle de publicación"; el de usuario, desde la
  bandera de "Perfil público". Comparten hoja y motivos (el enum
  `report_reason` no distingue objetivo); lo único que cambia es el título.
  Son **mutuamente excluyentes por esquema** —`reports.listing_id` /
  `reports.reported_user_id`, con `num_nonnulls(...) = 1` en el `with check`
  de `reports_insert_own`—, nunca los dos a la vez. Nadie puede reportarse a
  sí mismo por ninguno de los dos caminos, y son dos candados distintos: un
  `check` de tabla para el de usuario, una cláusula en la policy para el de
  publicación (ver `CLAUDE.md` §3).

### Favoritos y notificaciones
- **RF-15** Guardar publicaciones como favoritas. **✅ Implementado** — el
  toggle de guardar/quitar (optimistic update + rollback) ya existía desde el
  grupo Explorar, en Feed/Búsqueda/Detalle. Lo que faltaba era dónde
  consultarlos de vuelta: la pantalla "Favoritos" (grupo Cuenta) los lista y
  permite quitarlos desde ahí mismo.
- **RF-16** Push cuando baja el precio de un favorito, hay respuesta a un
  reporte, o (opcional) nueva publicación en categoría seguida.
  **✅ Implementado, TRES disparadores** — baja de precio de un favorito,
  resolución de un reporte, y **"Califica tu compra"**, que se dispara cuando un
  vendedor acredita a alguien como comprador al marcar la venta (RF-07/RF-12) y
  también cuando corrige a quién. Ese tercero **no** es el opcional de "categoría
  seguida", que sigue fuera de alcance (abajo). Además de push, cada aviso queda en un
  **inbox in-app** (pantalla "Notificaciones", con hora relativa y punto de no
  leído), que es lo que hace que un aviso sobreviva a un push que no llegó.
  "Respuesta a un reporte" NO necesitó un campo de texto nuevo: el copy del
  diseño es genérico y se deriva de `reports.estado`, y un campo libre no
  tendría quién lo escribiera (RF-17 pone la moderación en Studio).
  **⏳ Fuera de alcance:** el tercer disparador, marcado opcional aquí — no
  existe modelo de "seguir una categoría", y es el único fan-out 1→N de todo el
  campus, o sea el único con riesgo real de volverse spam.
  **⚠️ Pendiente operativo, no de código:** credenciales FCM V1 / APNs y la
  prueba en un teléfono real. Ver `CLAUDE.md` §8.

### Administración
- **RF-17** Panel interno para revisar reportes, suspender
  usuarios/publicaciones y ver métricas básicas de uso. (Vive en Supabase
  Studio — no requiere pantallas propias en la app móvil.)
- **RF-18** Moderación automática de contenido antes de publicarse: fotos de
  publicaciones y de perfil analizadas con Google Cloud Vision (SafeSearch +
  detección de texto en imagen); título y descripción analizados con OpenAI
  GPT-4o-mini. **✅ Implementado, de punta a punta y EN PRODUCCIÓN** (cerrado
  2026-09-21): publicaciones y avatares se moderan con las APIs reales, la app
  ya invoca el flujo desde el alta, y los dos triggers de Storage están
  activos en remoto — no solo cableados en el esquema.
  **El flujo, tal como corre hoy:** `publicar.ts` crea la publicación en
  `pendiente` (ya no en `pausada` ni `activa` directo — el `with_check` de
  `listings_insert_own` se lo exige al cliente), sube las fotos, y al terminar
  pide el veredicto a la Edge Function `moderar-contenido`, que rutea por
  `ctx.authMode` (el cliente puede promover a `activa`; el trigger de Storage
  solo puede escalar), valida ownership, descarga las fotos de Storage, **llama
  de verdad a Vision y a OpenAI**, arma los cuatro ejes, decide, y escribe el
  estado más su auditoría (`listing_moderacion`, RLS habilitado, cero
  policies — los avatares no escriben ahí, por diseño: su enforcement es
  inmediato, sin cola que revisar). Según el veredicto, el usuario aterriza en
  una de TRES pantallas — "Publicación creada" (`activa`), "Publicación en
  revisión" (`pendiente`, con Realtime: si el veredicto llega mientras el
  usuario sigue ahí, la pantalla avanza sola) o "Publicación no aprobada"
  (`bloqueada`) — y "Mis publicaciones"/"Editar publicación"/Detalle ya
  conocen los dos estados nuevos (chip propio, guard que reemplaza el
  formulario, el `.sticky-cta` sin acciones editables).
  Los cuatro caminos de falla segura de una publicación (Vision caído, OpenAI
  caído, refusal de OpenAI, falla la descarga de una foto suelta) están
  cableados y verificados contra la función viva, cada uno con su control
  negativo: ninguno propaga una excepción, los cuatro degradan a `pendiente`
  en vez de publicar sin mirar. El particionado por tamaño (varias fotos que
  sumen más de 6 MB) también se verificó con fotos reales.
  **El camino de avatares está completo:** mismo pipeline de imagen que una
  publicación (`evaluarFotos()` se parametrizó por bucket para reusarlo, no
  duplicarlo), enforcement binario (`VERY_LIKELY` borra el objeto y nulifica
  `foto_url`; `LIKELY` no toca nada), y un guard contra la condición de
  carrera —el usuario sube un avatar nuevo mientras el viejo sigue
  evaluándose— verificado disparándola de verdad.
  **Los dos triggers de Storage disparan solos al subir un objeto**, y desde
  2026-09-19 evalúan también la foto que los disparó aunque su fila en
  `listing_photos` todavía no exista (`unirFotoDisparadora()`, en `vision.ts`)
  — antes, esa foto quedaba evaluada por NADIE, porque el objeto se sube
  antes de que exista su fila. Verificado con OCR real: una foto genuina
  (subida como lo hace la app, sin sobrescribir nada) con una palabra
  prohibida impresa como texto escala la publicación de `activa` a
  `pendiente`, con esa foto específica —no una vieja— en el detalle de
  auditoría.
  173 aserciones propias de RF-18, todas en verde: 124 puras
  (`scripts/probe-moderacion.mjs`, sin red ni credenciales), 23 de
  autorización/cableado de publicaciones (`scripts/probe-moderacion-http.mjs`),
  10 de particionado/descarga fallida/no-op (`scripts/probe-moderacion-red.mjs`)
  y 16 del camino de avatares (`scripts/probe-moderacion-avatares.mjs`) contra
  la función corriendo de verdad — más 2 propias en `rls.sql` (T12, sobre
  `listing_moderacion`) dentro de las 177 de la suite completa de RLS.
  **Declinado a propósito, en las dos rondas:** forzar los umbrales
  `LIKELY`/`VERY_LIKELY` de Vision —para publicaciones o para avatares— con
  imágenes reales exigiría sourcear o generar contenido sexual o gráficamente
  violento, algo que este repo no hace ni para pruebas; la lógica de esos
  umbrales sí está cubierta, de forma determinista y sin necesitar ninguna
  imagen real, y el CABLEADO alrededor de ella se verificó con un mock que
  devuelve la forma real de la respuesta de Vision
  (`.claude/rules/moderacion.md` §6.3 y §6.4).
  **Probado de punta a punta en PRODUCCIÓN, los dos veredictos**: una
  publicación de contenido limpio quedó `activa`; una con una palabra de la
  lista quedó `bloqueada`. Confirmado en Studio, 2026-09-21.
  **Deuda consciente, no bloqueante:** cada evento de Editar sigue pagando una
  evaluación completa (Vision + OpenAI) sobre el set de fotos VIEJO además de
  la que dispara — reemplazar 5 fotos cuesta 10 requests reales, uno por
  evento, aunque cada uno ya incluya la foto correcta. Es costo, no
  incorrección, y se dejó fuera de alcance a propósito (debounce o mover el
  disparador, sin tocar por ahora). Detalle, disparador de revisión y fix
  propuesto en `.claude/rules/moderacion.md` §7/§9.
  Las decisiones de umbral están en `CLAUDE.md` §3; el diseño de
  implementación completo, en `.claude/rules/moderacion.md`.

---

## 04. Requerimientos no funcionales

- **RNF-01** Rendimiento: feed principal en <2s en 4G típica; paginación /
  infinite scroll.
- **RNF-02** Disponibilidad: objetivo razonable de MVP, ~99%.
- **RNF-03** Escalabilidad: soportar crecer de 1 a varios campus sin
  rediseño mayor (particionar por `campus_id` desde el modelo de datos).
- **RNF-04** Seguridad: contraseñas hasheadas, tokens de sesión con
  expiración, HTTPS en todo, reglas de acceso a nivel de base de datos.
- **RNF-05** Privacidad: no exponer correo/teléfono públicamente sin
  consentimiento explícito del usuario.
- **RNF-06** Usabilidad: publicar un artículo en menos de 5 pasos / bajo 2
  minutos.
- **RNF-07** Multiplataforma: una sola base de código para Android e iOS.
- **RNF-08** Mantenibilidad: stack con curva de aprendizaje razonable para un
  solo developer, con buena documentación y comunidad activa.
- **RNF-09** Costo: operar con capa gratuita o de muy bajo costo mientras no
  haya validación de tracción.
- **RNF-10** Observabilidad: logs de errores y métricas básicas
  (publicaciones creadas, usuarios activos, contactos generados) desde el día
  uno.

---

## 05. Stack tecnológico recomendado

Con un solo desarrollador, sin preferencia de stack previa y necesitando
Android + iOS sin presupuesto claro, la prioridad es una sola base de código,
servicios administrados que reduzcan trabajo de backend, y capa gratuita
generosa.

| Capa | Tecnología | Por qué |
|---|---|---|
| App móvil | React Native + Expo | Un solo código Android/iOS, builds sin Mac (EAS Build) |
| Backend/BD | Supabase (Postgres) | Auth + BD relacional + Storage + RLS incluidos |
| Notificaciones | Expo Notifications | Integración directa, sin servicio adicional |
| Admin | Supabase Studio | Cero desarrollo adicional para arrancar |
| Distribución | EAS Build/Submit | Publicar a ambas tiendas sin infraestructura nativa propia |

**Alternativas consideradas y descartadas:**
- *Flutter* — igual de válido técnicamente, pero exige aprender Dart;
  React Native reutiliza JavaScript/TypeScript en más partes del stack.
- *Firebase/Firestore* — comparable como BaaS, pero su modelo NoSQL hace más
  incómodas las consultas con filtros combinados (categoría + precio + campus
  + condición), el corazón de la búsqueda de un marketplace.

---

## 06. Arquitectura

```
App móvil (cliente)
React Native + Expo · iOS / Android
        │  HTTPS · SDK de Supabase
        ▼
┌─────────────────────────────────────────┐
│                 SUPABASE                 │
│  Auth (verificación correo)              │
│  Postgres + RLS (listings, users…)       │
│  Storage (fotos)                         │
│  Edge Functions (validación, push)       │
└─────────────────────────────────────────┘
        │
        ▼
Expo Push Notification Service

Contacto comprador ↔ vendedor: deep link wa.me — fuera del backend
Moderación: Supabase Studio, uso directo del equipo
```

### Modelo de datos — entidades principales

> **Actualizado post-diseño** respecto al documento original: se separó
> "universidad/campus" en dos entidades (una universidad puede tener varios
> campus — ver pantallas "Selector de universidad" y "Selector de campus"), y
> se agregó `listing_contacts` para habilitar RF-12 sin chat interno. El
> modelo original solo tenía un campo plano `campus/zona`.

```
users
  id, correo, nombre, foto_url, universidad_id, campus_id,
  carrera, rating_promedio, estado (activo/suspendido),
  telefono, tiene_telefono
  -- HUECO CERRADO (antes: "falta el teléfono"). RF-13 pedía un botón que
  --   abriera WhatsApp "con el vendedor" y ninguna entidad guardaba un número,
  --   así que el deep link usaba un placeholder. Resuelto con las tres cosas a
  --   la vez: la columna `telefono` (E.164; desde 20260927000470 de cualquier
  --   país, con +52 exigiendo 10 dígitos, y selector de país), el frame de
  --   captura en el diseño, y el campo en la app.
  --
  --   DÓNDE SE CAPTURA, y por qué no es el onboarding: exigirlo en "Completar
  --   perfil" le cerraría el Feed a quien solo quiere comprar. El número no
  --   hace falta para navegar, hace falta para vender, así que se pide en
  --   "Publicar" — no se puede publicar sin él (frame "Publicar (falta
  --   teléfono)"), y el campo aparece ahí mismo para que el bloqueo se
  --   resuelva sin ir a otro lado. "Editar perfil" es la otra puerta.
  --
  --   PRIVACIDAD (RNF-05): `telefono` NO es legible por la Data API — mismo
  --   trato que `correo`. Solo sale por la RPC public.seller_whatsapp(uuid),
  --   una fila a la vez, así que el número viaja al abrir WhatsApp y no en el
  --   select del perfil público, que era la condición que este documento
  --   ponía. Junto a él va `tiene_telefono`, columna generada que solo dice si
  --   el usuario es contactable, sin revelar el número.
  --
  --   Esa misma RPC es donde se hace cumplir que una cuenta SUSPENDIDA quede
  --   fuera del contacto por WhatsApp (RF-17), y en las DOS direcciones: no
  --   puede contactar (se valida quién llama) ni ser contactada (se valida el
  --   dueño del número). Devuelve null en ambos casos.
  --
  --   RESUELTO (20260917000457): las publicaciones de una cuenta suspendida ya
  --   no se quedan visibles en el catálogo. Un trigger sobre `users` pasa a
  --   `pausada` todas sus publicaciones `activa` en la misma transacción que la
  --   suspensión, así que el comprador deja de poder llegar a una publicación
  --   que no va a poder contactar. Las decisiones de producto quedaron así:
  --
  --     · AUTOMÁTICO, no revisión manual de un admin, y se dispara sin importar
  --       CÓMO se escriba `estado` (hoy edición de celda en Studio; mañana, la
  --       plataforma de RF-17 si llega a existir).
  --     · Al REACTIVAR la cuenta NO se despausan solas: el vendedor las
  --       reactiva a mano desde "Mis publicaciones", que ya exige al menos una
  --       foto. Despausarlas automáticamente saltaría esa validación justo en
  --       las publicaciones viejas que no tienen ninguna.
  --     · NO se distingue "pausada por suspensión" de "pausada por el usuario":
  --       es el mismo estado `pausada`. Ese distingo exigiría una pantalla nueva
  --       y casi seguro una columna, y no hace falta para cerrar esto.
  --     · Las `vendida` no se tocan: siguen siendo un estado terminal.

universidades
  id, nombre           -- Tec de Monterrey, UANL, UDEM, U-ERRE, UVM…

campus
  id, universidad_id, nombre, ciudad   -- ej. campus "Monterrey" de Tec

listings
  id, user_id → users, categoria_id → categories,
  universidad_id, campus_id,
  título, descripción, precio, condición,
  estado (activa/pausada/vendida), vistas_count

listing_photos
  id, listing_id → listings, storage_path, orden

categories
  id, nombre           -- Libros, Electrónica, Muebles, Ropa, Deportes,
                          Apuntes, Hogar, Papelería, Instrumentos,
                          Arte y manualidades, Boletos y eventos, Otros

favorites
  user_id → users, listing_id → listings

listing_contacts
  user_id → users, listing_id → listings, created_at
  -- se registra cada tap en "Contactar por WhatsApp" (RF-13); es la fuente
  -- de candidatos para el flujo "¿A quién le vendiste?" que habilita RF-12

listing_sales
  listing_id → listings (PK), comprador_id → users, created_at
  -- quién compró (RF-07). Una venta o ninguna por publicación. Tabla aparte y
  -- NO columna de `listings`: el catálogo es legible por todo el campus, y
  -- quién compró solo lo ven las dos partes. Es lo que acota la calificación
  -- de RF-12 a la pareja vendedor ↔ comprador.

ratings
  from_user_id, to_user_id → users, listing_id → listings,
  estrellas, comentario

reports
  listing_id / user_id reportado, reporter_id → users,
  motivo, estado
```

> Diseñar `listings` y `users` con `campus_id` (vía `universidad_id`) desde el
> inicio — aunque el filtro no se use activamente en la fase de un solo
> campus — facilita expandir a más universidades sin migración mayor.

### Flujo principal (camino feliz)

1. Usuario se registra con correo institucional → verificación → perfil
   creado.
2. Usuario publica un artículo (título, fotos, precio, categoría, campus) →
   aparece en el feed.
3. Otro usuario navega/busca/filtra → encuentra el artículo → lo guarda como
   favorito o contacta por WhatsApp.
4. Transacción ocurre fuera de la app (efectivo/transferencia, entrega en
   persona).
5. Vendedor marca la publicación como "vendida" y elige, de la lista de
   quienes lo contactaron, quién se la llevó (o "No fue a través de Relevo").
6. Esa persona recibe la pantalla de Calificar; ambas partes se califican
   mutuamente (opcional pero incentivado).

---

## 07. Próximos pasos sugeridos (del documento original)

- Definir la universidad/campus piloto y confirmar el mecanismo de
  verificación de correo institucional disponible ahí.
- Priorizar el backlog de RF-05 a RF-11 (publicar + descubrir) como el
  corazón del MVP; RF-12 a RF-17 en una iteración muy cercana.
- Diseñar wireframes de las pantallas clave: feed, detalle de publicación,
  publicar artículo, perfil. **✅ Hecho — ver `/design/relevo-app.html`,
  42 pantallas cubriendo el flujo completo más estados de sistema.**
- Configurar proyecto Supabase (Auth + esquema de BD + políticas RLS) y
  proyecto Expo en paralelo.
- Reclutar manualmente los primeros 20–30 vendedores del campus piloto antes
  del lanzamiento público.