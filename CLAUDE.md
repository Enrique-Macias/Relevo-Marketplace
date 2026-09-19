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

Es un prototipo HTML/CSS/JS autocontenido con las 59 pantallas de la app
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

---

## 1. Stack tecnológico

| Capa | Tecnología | Por qué |
|---|---|---|
| App móvil | React Native + Expo (Router, SDK 57) | Un solo código para iOS/Android, builds sin Mac vía EAS Build |
| Backend / BD | Supabase (Postgres), proyecto remoto `ukxfnydfhmryrzhdqkvj`, región Ohio (us-east-2) | Auth + BD relacional + Storage + Row Level Security, sin backend custom |
| Cliente BD | `@supabase/supabase-js` (versión fijada, sin `^`) | Ver sección 8 para el wrapper (`src/lib/supabase.ts`) y por qué usa `expo-crypto` en vez de `react-native-get-random-values` |
| Fotos | `expo-image-picker` + `expo-image-manipulator` | El picker elige; el manipulator **normaliza a JPEG comprimido antes de subir**. No es opcional: el bucket corta en 5 MiB y el `quality` del picker no comprime PNG (§9), así que sin esto cualquier screenshot falla siempre |
| Notificaciones | `expo-notifications` + tabla `notifications` como outbox | Integración directa, disparadas desde la Edge Function `send-push` vía un trigger propio con `net.http_post` — **no** el Database Webhook del Dashboard, aunque la migración se llame `..._notifications_webhook` (§3). El inbox in-app NO es un espejo del push: es lo que hace que un aviso sobreviva a un push que no llegó (§3, `notificaciones-push.md`) |
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
que quedó fuera del token original), `Typography` (47 roles por nombre
semántico — medido con `awk` sobre el objeto en `theme.ts`, no de memoria: si
este número discrepa del archivo, gana el archivo — cada uno citando la clase
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

Definido en 26 migraciones (`supabase/migrations/`), con RLS activo y probado en
las 14 tablas más los DOS buckets de Storage. Este es el esquema **real**, no
solo la intención original.

**Ese 14 son 13 con policies más `listing_moderacion`, que tiene RLS habilitado
y CERO policies a propósito** (su bloque propio, más abajo) — no es una tabla a medio
configurar. El número venía diciendo "12" desde antes de esta tanda, cuando ya
eran 13: otra confirmación de la moraleja del párrafo siguiente, esta vez
encontrada al medir para otra cosa.

**Repo y remoto NO están a la par: 27 y 26**, medido con
`ls supabase/migrations | wc -l` y `mcp__supabase__list_migrations`. La única de
más es `20260919000463` (el `with_check` que obliga a toda publicación de
cliente a nacer `pendiente`, RF-18 Ola 3), escrita y validada en local y **sin
pushear** — y no debe pushearse sola: ver §8, pendiente 2, porque llegar a
remoto antes de que la Edge Function esté desplegada allá rompe publicar.

**Y este número acaba de volver a demostrar su propia moraleja, por QUINTA
vez.** Este párrafo decía "26 y 25", con `20260918000462` marcada como "sin
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
  estado (solo triggers/service_role escriben),
  telefono (E.164 `+52` + 10 dígitos, NO expuesto al cliente — ver abajo),
  tiene_telefono (generada: `telefono is not null`; ESTA sí es legible)

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
listing_sales    (listing_id PK → listings, comprador_id → users, created_at)
                 quién compró (RF-07/RF-12). PK sobre listing_id: una venta o
                 ninguna. Solo la ven las DOS PARTES, ni los otros contactos.
                 Sin DELETE; su UPDATE es solo sobre `comprador_id`. NO es una
                 columna de `listings` — ver abajo.
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
  service_role lo ve. NADIE puede reportarse a sí mismo, y son DOS
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
```

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

**Usuario suspendido — tabla de decisión (no implícita):** puede leer catálogo,
perfiles y reseñas; puede editar su propio perfil (**incluido su teléfono**) y
usar favoritos. NO puede publicar, editar/pausar/borrar sus publicaciones
existentes, tocar sus fotos, contactar por WhatsApp **ni ser contactado**,
calificar, ni reportar. Y además, **todas sus publicaciones `activa` pasan a
`pausada` en el acto de suspenderlo** — al reactivar la cuenta NO se despausan
solas (ver el bloque del trigger más abajo). Casi todo vía el helper
`private.is_active_user()` — las excepciones son "ni ser contactado" y ese
pausado automático, que no pueden usarlo y se explican abajo.

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
- **Consecuencia de segundo orden, medida:** en remoto hay **26** publicaciones
  `activa` sin una sola foto (filas viejas, anteriores a que existiera la
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
va en `private`). `authenticated` tiene `USAGE` sobre `private` + `EXECUTE`
acotado a las TRES que se invocan desde policies — `is_active_user()`,
`can_rate()` y `listing_id_from_object_name()` — mientras las otras cinco, que
solo disparan por trigger, siguen revocadas. Ver sección 9 sobre por qué ese
`USAGE` existe (no es lo que originalmente se pensó).

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
escribiera** — RF-17 pone la moderación en Studio, que es un editor de celdas.
Si algún día el copy debe ser por caso, el orden correcto es un frame primero
(§0 regla 4).

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

**Regresión de RLS:** `supabase/tests/rls.sql`, 177 aserciones, corre dentro de
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
  bloqueada`.** Una publicación que Google Cloud Vision marque `LIKELY` en
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
- **Mientras no exista RF-17 (panel de administración), la cola de
  `pendiente` la revisa el desarrollador único vía Supabase Studio.** No hay
  otro mecanismo todavía — ni notificación a un equipo de moderación (no
  existe ese equipo), ni SLA, ni flujo automatizado de aprobación/rechazo. Es
  manual, por diseño, hasta que RF-17 exista. Y **"la cola" no es una tabla
  nueva ni un mecanismo aparte: es literalmente el filtro
  `estado = 'pendiente'` sobre `listings`** — el mismo enum, la misma RLS, sin
  infraestructura adicional.

**Ese párrafo decía "nada de esto tiene todavía un punto de enforcement en
código", y dejó de ser cierto.** Hoy existen la Edge Function
(`moderar-contenido`, que llama de verdad a Vision y OpenAI), los dos triggers de
Storage, y —desde la Ola 3— el alta pasa por `pendiente`: `publicar.ts` crea con
ese estado (obligado por el `with_check` de `20260919000463`) y el veredicto lo
escribe la función, no el cliente. Lo único que sigue apagado en PRODUCCIÓN son
los dos secretos de Vault de los triggers (§8, pendiente 2).

---

## 4. Inventario completo de pantallas (59)

Cada pantalla corresponde 1:1 a un `<div class="phone-block" data-cat="...">`
dentro de `relevo-app.html` — el atributo `data-cat` es el mismo agrupador que
usa el filtro visual del prototipo. Para el estado de qué grupo ya existe
como código real (vs. solo diseño), ver §8 y las reglas de `.claude/rules/`.

### Onboarding (15)
Splash · Onboarding 1/3 · Onboarding 2/3 · Onboarding 3/3 · Verificación ·
Código de verificación · Completar perfil ·
Completar perfil (estado inicial) · Completar perfil (selector de campus) ·
Selector de universidad · Permiso de notificaciones ·
Iniciar sesión · Recuperar contraseña · **Código de recuperación** ·
**Nueva contraseña**

Las dos últimas llegaron con RF-04, y son el segundo y tercer paso del reset por
OTP. "Código de recuperación" es casi gemela de "Código de verificación" —misma
`.otp-row`— con una diferencia deliberada: su `.auth-logo` es el candado en
`--forest`, no la "R" en `--ink`. **La identidad visual la marca el FLUJO**, así
que las tres pantallas del reset comparten el candado; quien viera la "R" del alta
a mitad de una recuperación no sabría en cuál de los dos está. Por eso son frames
distintos y no una variante etiquetada.

### Explorar (14)
Feed · Selector de campus · Categoría · Categoría sin resultados ·
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

### Cuenta (8)
Perfil · Editar perfil · Perfil público · Favoritos · Favoritos vacío ·
Mis publicaciones · Mis publicaciones vacío · Mis publicaciones (acciones)

**RF-18 no agregó ninguna aquí, y el avatar rechazado es el caso que parece que
debería.** No lleva frame porque su estado resultante YA existe: el enforcement
de avatares es binario —solo `VERY_LIKELY` borra— y borrar significa objeto
fuera y `foto_url` en null, o sea el fallback a iniciales que `Avatar` ya pinta.
No hay estado intermedio que dibujar porque no hay dónde guardarlo (§3).
**Lo que sí queda abierto es el aviso:** el borrado ocurre después, por el
trigger de Storage, cuando el usuario ya vio su foto puesta; hoy se entera
porque en algún momento vuelve a ver sus iniciales. Cerrarlo pide decidir por
dónde avisa, y si el aviso es persistente exige frame primero (§0 regla 4).

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
  haya o no sesión activa (ya implementado, ver `onboarding-auth.md`).

---

## 6. Cómo pedirle trabajo a la IA en este repo

- Pide **tokens antes que pantallas**: extraer `theme.ts` del CSS antes de
  construir el primer componente.
- Ve **pantalla por pantalla, por grupo (`data-cat`)**, no "constrúyeme la
  app" — con 59 pantallas, pedir todo junto es la forma más segura de que
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
- Para tareas de backend en particular: **valida en local con Docker antes de
  aplicar a remoto**, y prueba como el rol `authenticated` real, no como
  `postgres`/superusuario. Son SEIS pasos, no uno:
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
     para Vision, y el schema/parseo de OpenAI. **No necesita el stack local**
     (el paso 5 tampoco): las piezas que prueba son puras a propósito, sin red
     ni Supabase, y por eso corre en menos de un segundo.
     Y es el único que importa la implementación **REAL** en vez de
     transcribirla: los cuatro módulos que cubre
     (`supabase/functions/moderar-contenido/{decision,palabras-prohibidas,vision,openai}.ts`)
     no importan nada fuera de `decision.ts`, así que Node los carga directo
     (type stripping, v22.6+). **Ese "no importan nada" es la precondición, no
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
  Los probes 2, 3 y 6 necesitan el stack local arriba y limpian lo suyo en un
  `finally`; si una corrida muere de golpe, `supabase db reset` borra la basura.
  Los pasos 4 y 5 no necesitan nada: ni stack, ni red, ni credenciales.

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
| `onboarding-auth.md` | Onboarding, OTP, gating de sesión, RF-04 | `src/app/(onboarding)/**`, `src/lib/session.tsx`, `src/lib/supabase.ts` |
| `explorar.md` | Feed, Búsqueda, Categoría, Detalle, favoritos | `src/app/(explorar)/**`, `(tabs)/index.tsx`, `(tabs)/buscar.tsx`, `src/lib/listings.ts` |
| `publicar-fotos.md` | Publicar atómico, fotos, bucket de Storage | `src/app/(publicar)/**`, `src/lib/{publicar,storage,foto-picker,listing-form}.ts` |
| `cuenta-perfil.md` | Mis publicaciones, Favoritos, Perfil, Editar perfil, Perfil público, RF-13 | `src/app/(cuenta)/**`, `(tabs)/perfil.tsx`, `(tabs)/favoritos.tsx`, `src/lib/perfil*.ts` |
| `confianza-ventas.md` | Venta, ¿a quién le vendiste?, Calificar, Reportar | `src/app/(confianza)/**`, `src/app/reportar/**`, `src/lib/confianza.ts` |
| `notificaciones-push.md` | Inbox, push, Edge Function `send-push` | `src/app/(notificaciones)/**`, `src/lib/{notificaciones,push}.ts`, `supabase/functions/**` |
| `moderacion.md` | Moderación pre-publicación (RF-18): Edge Function `moderar-contenido`, los dos triggers de Storage, rework de `publicar.ts`, Realtime | `supabase/functions/moderar-contenido/**`, `scripts/probe-moderacion*.mjs`, `src/lib/{publicar,storage}.ts`, `src/app/(publicar)/**` |
| `componentes-compartidos.md` | Qué componente existe ya y qué NO unificar | `src/components/**` |
| `compartir-deeplinks.md` | Compartir sin link (las dos pantallas) | `detalle/**`, `perfil-publico/**`, `app.json` |

**Hecho:**
- Esquema aplicado al proyecto remoto (`ukxfnydfhmryrzhdqkvj`, Ohio) con RLS y la
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
    `version: 1`.
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

**Pendiente, en este orden de prioridad:**
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
   - Por §6 el simulador headless no cuenta como prueba. Es hermano del pendiente
     del header `Authorization` de `expo-image`.
2. ~~Poner RF-18 en producción (los cuatro pasos manuales del runbook).~~
   **HECHO (2026-09-19)** — ver el bloque de arriba, en "Hecho:". Sigue viva la
   deuda de COSTO (no de despliegue): Editar sigue pagando 10 requests por 5
   fotos reemplazadas, documentado con su disparador y su fix en
   `.claude/rules/moderacion.md` §7/§9 — decisión aparte, sin tocar.

**Deuda consciente — con disparador de revisión, no "algún día":** cada entrada
vive COMPLETA —con su "Revisar cuando" y su "Fix"— en la regla de su feature, y
aparece sola al tocar esos archivos. Índice para verlas todas de un vistazo:

- Cambiar el avatar puede dejar el anterior huérfano en Storage → `cuenta-perfil.md`
- La base no ata `users.campus_id` a `users.universidad_id`, y quien sostiene esa coherencia es el cliente — ahora en DOS lugares → `cuenta-perfil.md`
- `ErrorState` promete "Reintentar" aunque no haya nada que reintentar → `componentes-compartidos.md`
- "Omitir por ahora" en Calificar es DEFINITIVO → `confianza-ventas.md`
- La reseña del mal asignado sobrevive y queda inmutable → `confianza-ventas.md`
- El vendedor puede reasignar la venta varias veces antes de calificar, y cada cambio dispara una notificación → `confianza-ventas.md`
- El amarre cliente ↔ RLS se sostiene con dos mecanismos parciales en vez de uno fuerte → `confianza-ventas.md`
- No se puede deshacer una venta entera → `confianza-ventas.md`
- Una recuperación de contraseña abandonada a media deja la sesión abierta con la contraseña VIEJA → `onboarding-auth.md`
- Compartir comparte solo texto plano, sin ningún link — en LAS DOS pantallas que lo tienen → `compartir-deeplinks.md`
- `reports.resolved_at` existe y NADIE la escribe → `notificaciones-push.md`
- Sin receipts de Expo → `notificaciones-push.md`
- `pg_net` es fire-and-forget → `notificaciones-push.md`
- El inbox no pagina → `notificaciones-push.md`
- Sin "categoría seguida" → `notificaciones-push.md`
- El token de push es no-enumerable, pero robable si se conoce → `notificaciones-push.md`
- La lada del teléfono está fija en `+52` → `cuenta-perfil.md`
- El teléfono es no-enumerable-en-bloque, no inaccesible → `cuenta-perfil.md`
- Un insert directo con `estado='activa'` y 0 fotos sigue siendo posible → `publicar-fotos.md`
- ~~`listings_insert_own` no restringe `estado`~~ **[CERRADA]** por `20260919000463` → `publicar-fotos.md`
- Editar el TEXTO de una publicación ya aprobada no la vuelve a moderar → `publicar-fotos.md`
- El trigger de Storage evalúa el set ANTERIOR de fotos y nunca la que lo disparó → `moderacion.md`
- Toda re-evaluación vuelve a tirar el dado de GPT sobre texto que no cambió → `moderacion.md`
- La cola de `pendiente` mezcla lo marcado por moderación con lo abandonado a media subida → `moderacion.md`
- La promoción de `moderarListing()` puede reventar con 500 si intenta activar una publicación con 0 fotos → `moderacion.md`
- El pausado al suspender solo cubre UPDATE: una publicación creada para una cuenta YA suspendida nace `activa` → `cuenta-perfil.md`
- El reintento solo distingue DOS errores deterministas → `publicar-fotos.md`
- Si falla `guardarFotos()` —no la subida— los objetos quedan sin fila → `publicar-fotos.md`
- El tope de 5 fotos SIGUE sin aplicar en Storage → `publicar-fotos.md`
- Borrar una publicación no borra sus fotos de Storage **[CERRADA]** → `publicar-fotos.md`
- La búsqueda de texto es por palabra completa (websearch/tsvector), no por prefijo → `explorar.md`
- Scroll infinito sin virtualización → `explorar.md`
- El log de contactos que falla se pierde → `confianza-ventas.md`

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
| `CategoryTile` | `CategoryTile` | Tile de categoría con su tinte |
| `Chip` | `Chip` | Chip genérico |
| `ConfirmModal` | `ConfirmModal` | "Confirmar eliminar" / "Confirmar cerrar sesión" |
| `EmptyState` | `EmptyState` | Estado vacío, con `.empty-actions` opcional |
| `ErrorState` | `ErrorState` | Estado de fallo con "Reintentar" (label hardcodeado — ver deuda) |
| `Field` | `Field`, `PhoneField`, `SelectField` | Campos de formulario. **`PhoneField` vive aquí**, no en archivo propio |
| `ListRow` | `FormHeader`, `SearchField`, `ListRow`, `RadioCircle` | Fila de lista, header de formulario y el radio que reusan 3 pantallas |
| `ListingFormFields` | `ListingFormFields` | EL formulario de publicación, compartido por Publicar y Editar |
| `ListingPhoto` | `ListingPhoto` | Punto ÚNICO de contacto con el bucket privado (header `Authorization`) |
| `Notice` | `Notice` | Aviso persistente (`.notice`) — hermano del `Toast`, no una variante |
| `NotifRow` | `NotifRow` | Fila del inbox de notificaciones |
| `OtpInput` | `OtpInput`, `OTP_LENGTH` | Los 6 dígitos; puramente presentacional |
| `PageHeader` | `PageHeader` | Header con chevron — **no** para pantallas raíz de tab |
| `PhotoCarousel` | `PhotoCarousel`, `PhotoDots` | Carrusel del hero y sus puntos; no guarda índice propio |
| `PhotoRow` | `PhotoRow`, `idFoto` | Fila de fotos con sus 4 estados y el contador `N/5` |
| `PhotoViewer` | `PhotoViewer` | Visor a pantalla completa (`Modal`, montado condicionalmente) |
| `ProductCard` | `ProductCard` | Tarjeta de grid — sin estado "vendida", a propósito |
| `PublicarFab` | `PublicarFab` | El FAB de Perfil; vive como hermano de `NativeTabs` (§9) |
| `RoundIconButton` | `RoundIconButton` | Botón circular de los headers sobre foto |
| `Screen` | `Screen`, `useScreenScrollViewRef` | Contenedor de pantalla con su `ScrollView` |
| `SectionHead` | `SectionHead` | Encabezado de sección con "Ver todo" |
| `SegmentedControl` | `SegmentedControl` | Control segmentado |
| `SelectorCatalogo` | `SelectorCatalogo` | Selector de pantalla completa con buscador |
| `SheetScreen` | `SheetScreen` | Hoja de Stack `transparentModal` **declarada en el Stack raíz** |
| `Skeleton` | `SkeletonPiece`, `SkeletonGrid`, `SkeletonCatGrid`, `SkeletonRows`, `SkeletonNotifRows`, `SkeletonPerfilForm`, `SkeletonPerfil` | Un esqueleto por FORMA de lo que viene |
| `StarRating` | `StarRating` | Estrellas de Calificar |
| `StatusRow` | `StatusRow` | La `.status-section` fuera de Editar publicación |
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
