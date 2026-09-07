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
- **RF-04** Recuperación de contraseña.

### Publicaciones (listings)
- **RF-05** Crear publicación con título, descripción, categoría, precio,
  condición, hasta N fotos y zona de entrega.
- **RF-06** Editar y eliminar publicación propia.
- **RF-07** Marcar publicación como "vendida" sin borrar el historial.
- **RF-08** Estados de publicación: activa, pausada, vendida.

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
- **RF-13** Botón de contacto que abre WhatsApp con el vendedor — sin chat
  interno en el MVP. Cada tap se registra (usuario, publicación, fecha) para
  habilitar RF-12; la conversación en sí ocurre fuera de la app.
- **RF-14** Reporte de publicaciones hacia moderación, con motivo
  seleccionable: spam o publicidad, sospecha de fraude, contenido
  inapropiado, no es un estudiante, u otro (con comentario libre).

### Favoritos y notificaciones
- **RF-15** Guardar publicaciones como favoritas.
- **RF-16** Push cuando baja el precio de un favorito, hay respuesta a un
  reporte, o (opcional) nueva publicación en categoría seguida.

### Administración
- **RF-17** Panel interno para revisar reportes, suspender
  usuarios/publicaciones y ver métricas básicas de uso. (Vive en Supabase
  Studio — no requiere pantallas propias en la app móvil.)

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
  carrera, rating_promedio, estado (activo/suspendido)

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
  id, listing_id → listings, storage_url, orden

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
  39 pantallas cubriendo el flujo completo más estados de sistema.**
- Configurar proyecto Supabase (Auth + esquema de BD + políticas RLS) y
  proyecto Expo en paralelo.
- Reclutar manualmente los primeros 20–30 vendedores del campus piloto antes
  del lanzamiento público.