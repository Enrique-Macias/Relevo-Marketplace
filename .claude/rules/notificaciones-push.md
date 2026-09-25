---
paths:
  - "src/app/(notificaciones)/**"
  - "src/lib/notificaciones.ts"
  - "src/lib/push.ts"
  - "src/components/NotifRow.tsx"
  - "supabase/functions/**"
---

# Notificaciones e inbox + push (RF-16)

> Movido verbatim desde `CLAUDE.md` (§8 / §8b). Esta regla carga sola cuando la
> sesión lee alguno de los archivos de `paths:`. Las reglas transversales —
> tokens de diseño (§2), esquema y RLS (§3), inventario de pantallas (§4) y los
> gotchas de infraestructura (§9) — siguen en `CLAUDE.md`, que carga siempre.

**Notificaciones — construido y conectado (RF-16).** Las 2 pantallas del grupo
(el inbox y su vacío) viven en `src/app/(notificaciones)/notificaciones.tsx`, con
`src/lib/notificaciones.ts` como capa de datos y `src/lib/push.ts` como el único
punto de contacto con `expo-notifications`.

Detalles que no se ven en el diff:

- **Dos rutas se renombraron, y NO es cosmético: `(notificaciones)/index.tsx`
  colisionaba con `(tabs)/index.tsx`.** Un `index.tsx` dentro de un grupo de
  primer nivel resuelve a `/` con el nombre del grupo eliminado, así que había
  DOS rutas reclamando la raíz de la app — verificado leyendo
  `.expo/types/router.d.ts`, que generaba `` `/(tabs)` | `/` `` **y**
  `` `/(notificaciones)` | `/` ``. Funcionaba de milagro, porque la campana
  navegaba con el prefijo explícito del grupo y `/` caía en `(tabs)` por orden
  de declaración. Arreglo, que además alinea las rutas con los nombres de los
  frames del diseño:
  - `(onboarding)/notificaciones.tsx` → **`permiso-notificaciones.tsx`**
    (`/permiso-notificaciones`) — el frame se llama "Permiso de notificaciones".
  - `(notificaciones)/index.tsx` → **`notificaciones.tsx`** (`/notificaciones`),
    que quedó libre — el frame se llama "Notificaciones".
  Ahora una sola ruta reclama `/`, y el inbox tiene URL propia, que es lo que
  hace posible el deep link del tap sobre un push. Si alguien "simplifica"
  cualquiera de los dos a `index.tsx`, vuelve la ambigüedad.
- **La campana del Feed dejó de ser inerte** (`(tabs)/index.tsx`) y **su `.dot`
  pasó a ser condicional** al conteo de no leídas — antes se pintaba siempre. El
  conteo se recuenta al ENFOCAR (`useFocusEffect`) y no solo al montar: el Feed
  es un tab, así que vuelve del inbox sin desmontarse, y ese regreso es
  justamente cuando el número cambió. Nada de Realtime: sería una suscripción
  abierta toda la sesión para un dato que cambia un puñado de veces al día.
- **El tap sobre un push navega desde `(tabs)/_layout.tsx`, NO desde el layout
  raíz**, por dos razones de orden: ese layout solo se monta cuando el gating ya
  pasó (que es cuando `/detalle/<id>` es alcanzable), y el raíz devuelve `null`
  mientras cargan las fuentes, así que una navegación disparada ahí podría
  ejecutarse antes de que exista el navegador y perderse sin rastro.
  `useRespuestaANotificacion()` cubre los DOS caminos —`addNotificationResponse…`
  (app viva) y `getLastNotificationResponseAsync` (el tap ABRIÓ la app)—; sin el
  segundo, el caso más común de todos aterriza en el Feed como si nada.
- **`borrarPushToken()` corre ANTES de `supabase.auth.signOut()`**, y el orden no
  es estético: la policy de delete es `user_id = auth.uid()`, así que sin sesión
  ya no hay quién autorice el borrado y el teléfono seguiría mostrando en su
  pantalla de bloqueo los avisos de la cuenta que acaba de salir.
- **`formatRelativo` (`src/lib/format.ts`) ganó una rama de minutos, y eso
  CORRIGE a sus tres consumidores viejos** (`ProductCard`, Detalle, Mis
  publicaciones), no solo sirve al inbox. Antes todo lo de menos de una hora
  decía "hace un momento" — una cadena que **no aparece ni una vez** en
  `relevo-app.html`, o sea una invención del código; el diseño usa minutos
  explícitos ("hace 12m").
- **`SkeletonNotifRows` es hermano de `SkeletonRows`, no una variante suya**, por
  el mismo motivo por el que aquella no reusó `SkeletonGrid`: la forma que
  anticipa es distinta (círculo de 36 y dos líneas, contra thumb de 76 y tres).
- **Las notificaciones de reporte no llevan `listing_id`** aunque el reporte sí
  apunte a una publicación: el tap devolvería al reportante al contenido que
  denunció. Sin `listing_id`, `NotifRow` no recibe `onPress` y **ni siquiera se
  anuncia como botón**.
- El inbox **marca todo como leído al terminar de cargar**, con update optimista
  sin rollback — mismo criterio que el corazón de favoritos: la policy solo
  compara `user_id = auth.uid()` sobre filas propias, así que no hay rechazo por
  política posible y el costo de equivocarse es que el punto reaparezca.
- **`useNotificaciones` ganó `refrescar()` (pull-to-refresh), gemela de
  `useListings.refrescar()`: pide `fetchNotificaciones()` de nuevo y reemplaza
  `items` sin pasar por `'loading'` ni vaciar la lista.** `recargar()` (la que
  vacía y muestra skeleton) se queda solo para `ErrorState.onRetry`. El efecto
  de `marcarLeidas()` (depende de `items`) se re-dispara solo cuando el
  refresh trae notificaciones nuevas — comportamiento DESEADO, no un efecto
  colateral: una notificación que llegó vía pull-to-refresh debe marcarse leída
  igual que cualquier otra recién cargada, verificado leyendo el `useCallback`
  de `marcarLeidas`.

- **El tercer tipo, `compra_calificable`, NO cambió ni `destino()`
  (`src/lib/push.ts`) ni el `onPress` del inbox.** Trae `listing_id`, así que el
  tap ya cae en `/detalle/<id>`, que es donde vive "Calificar al vendedor". La
  notificación es el *descubrimiento*; Detalle es la *afordancia*. Su tinte es
  `--gold` porque es el color de `.rate-stars`; lo comparte con la fila de
  "categoría seguida" del frame, que no tiene disparador y está ahí solo como
  documentación.

- **Tanda 2 (2026-09-24, `20260928000472`/`473`): cuatro avisos nuevos, cinco
  `tipo`s.** Veredicto de moderación de MI publicación (`publicacion_aprobada` /
  `publicacion_bloqueada`), me calificaron (`calificacion_recibida`), se vendió
  un favorito (`favorito_vendido`) y la moderación borró mi foto
  (`avatar_eliminado`). La tabla de qué nace cuándo, y por qué, está en
  CLAUDE.md §3, "Avisos nuevos del inbox". Lo que es de ESTE grupo:
  - **El `onPress` del inbox dejó de rutear solo por `listing_id`**: hoy lo
    decide `rutaDeNotificacion()` (`src/lib/notificaciones.ts`), por `tipo`.
    `calificacion_recibida` guarda la publicación de la reseña, pero el tap va
    a TU Perfil público, porque el Perfil propio no lista reseñas, solo el
    promedio (`perfil.tsx`). `avatar_eliminado` va a Editar perfil. Los demás
    van a Detalle, y el reporte sigue sin tap.
  - **`destino()` del push NO cambió**, a propósito: `send-push` manda solo
    `listing_id` en `data`, así que un push de calificación o de avatar abre el
    inbox, no su destino. Mandar el `tipo` exige redesplegar `send-push`, y eso
    dispara su pendiente de pinear `@supabase/server` (`moderacion.md` §2). Como
    hoy el push no llega (credenciales pendientes), no tiene costo visible.
    **Revisar cuando:** el push entregue en un aparato real. **Fix:** `tipo` en
    el `data` de `send-push` y que `destino()` reuse `rutaDeNotificacion()`.
  - **`NotifRow` tiene un estilo para un `tipo` que no conoce**
    (`ESTILO_DESCONOCIDO`, campana en --slate). Un build viejo sin ese fallback
    CRASHEA el inbox al leer un tipo nuevo; ver CLAUDE.md §8, "Hecho", paso 5
    del runbook de `20260928000471`/`472`/`473` (2026-09-25, cerrado).
  - **El `sub` de "Notificaciones vacío"** pasó a resumir por familia; va igual
    en el frame.
  - **Pruebas manuales que tocan en el INBOX**, no en el push (el push no llega
    hoy; `expo-notifications` sigue excluido del autolinking):
    1. Publicar algo que caiga en revisión y resolverlo en Studio a `activa` y,
       con otra, a `bloqueada` → aparece "Tu publicación ya está publicada" /
       "no fue aprobada". Publicar algo limpio → llega a "Publicación creada" y
       el inbox NO gana fila.
    2. Editar las fotos de una publicación activa hasta que la bloqueen (o
       bloquearla en Studio desde `activa`) → "Retiramos tu publicación".
    3. Calificar desde otra cuenta → "Recibiste una calificación" con nombre y
       estrellas, sin el comentario; el tap abre TU Perfil público con la
       lista de reseñas.
    4. Dos cuentas con la publicación en favoritos; marcar la venta a una →
       solo la otra recibe "Se vendió un favorito", y la compradora recibe
       "Califica tu compra". Repetir con "No fue a través de Relevo" → les
       llega a las dos.
    5. Avatar borrado por moderación (en LOCAL, con el mock de
       `moderacion.md` §6.4) → la fila "Quitamos tu foto de perfil" persiste,
       y el tap abre Editar perfil. El toast de Perfil sigue saliendo.
    6. Cada fila con su tinte, su ícono y su tap; la del reporte sigue sin
       tap.

Componentes nuevos: `NotifRow`, `SkeletonNotifRows`, `IconMail`, y dos roles de
`Typography` (`notifTime`, `notifDesc` — ver §2, se confunden fácil con
`cardBadge` y `activeChip`).

- **RF-16 completo: inbox persistido + push.** Tres migraciones
  (`20260911000450` push_tokens, `...451` notifications y sus dos triggers,
  `...452` el webhook), la primera Edge Function del proyecto (`send-push`), y
  el grupo Notificaciones construido en el cliente. Lo que no se ve en el diff:
  - **La tarea no era "una Edge Function".** La pantalla del diseño es un inbox
    persistido (hora relativa + punto de no leído), o sea que la tabla tenía que
    existir igual — y al existir, ES el outbox del push. Eso eliminó los
    webhooks colgados de `listings` y `reports`.
  - **Dos disparadores, no tres.** "Nueva publicación en categoría seguida" es
    opcional en RF-16 y no tiene modelo (ni tabla ni afordance en el diseño);
    además es el único fan-out 1→N del campus entero, o sea el único con riesgo
    real de spam. Queda fuera, documentado abajo.
  - **El enum nace con dos valores** aunque el frame tenga cuatro filas: "Tu
    correo fue verificado" no tiene disparador (ocurre en el alta) y la de
    categoría seguida no tiene modelo. Un valor de enum sin productor solo
    genera ramas muertas en el cliente.
  - **El registro del token NO puede vivir solo en el onboarding**, por la misma
    razón que el gate del teléfono de RF-13: toda cuenta existente ya pasó por
    esa pantalla. Hay un efecto de re-registro en `SessionProvider`, fuera del
    callback de `onAuthStateChange` (el deadlock de supabase-js).
  - **`tsconfig.json` ahora excluye `supabase/functions`**, y no es cosmético:
    esa carpeta es código **Deno**, con specifiers `npm:` que el tsconfig de
    Expo no resuelve. Sin el exclude, `npx tsc --noEmit` de la app falla con 4
    errores que no son errores. Si alguien lo quita "para typechear todo", lo
    correcto es darle a esa carpeta su propia config de Deno, no devolverla al
    tsconfig de React Native.
    **Hecho el 2026-09-18** (RF-18): `supabase/functions/tsconfig.json` +
    `shims.d.ts`, que se corren con `npm run check:functions`. Vale saber por
    qué tardó y qué costó: mientras no existió, esa carpeta no la miraba NINGÚN
    compilador —el exclude no la mandaba a Deno, `deno` no está instalado— y en
    la primera corrida apareció un error de tipos real y preexistente en
    `moderar-contenido/env.ts`. El caso general quedó en CLAUDE.md §9. Lo único
    que este archivo tocó de `send-push` es una anotación de genérico en la
    llamada a `lotes()`, sin efecto en runtime: el shim deja `ctx` sin tipar a
    propósito, y TypeScript infiere `T = unknown` (no `any`) cuando un genérico
    `T[]` recibe un `any`.
  - Probado de punta a punta en local: baja de precio → fila con el copy exacto
    del diseño → webhook (HTTP 200) → la función llamó a Expo, recibió el ticket
    de error del token falso y **borró ese token** (`limpiados: 1`). Lo único que
    falta es un aparato de verdad — ver el pendiente de abajo.

- **`reports.resolved_at` existe y NADIE la escribe.** Está en el esquema desde
  `20260906000441:16` y ningún trigger ni camino de código la llena, así que hoy
  es siempre `null`. Se detectó al construir RF-16 y **se dejó fuera a
  propósito**: el primer impulso fue llenarla con el mismo trigger que notifica
  la resolución del reporte, pero esa notificación toma su hora de
  `notifications.created_at` —escrito en el mismo instante—, así que
  `resolved_at` no tenía ningún consumidor y habría sido una columna escrita
  para nadie. **Revisar cuando:** se trabaje la moderación de RF-17, que es
  donde "¿cuándo se resolvió esto?" empieza a ser una pregunta real. **Fix:** un
  `before update` con el mismo `when` que `reports_notify_resolved`, modelado
  sobre `private.set_updated_at()` (`20260906000439:33-46`).
- **Sin receipts de Expo.** `send-push` maneja los errores a nivel *ticket*, que
  es donde llega `DeviceNotRegistered` para un token inválido, pero no hace el
  segundo round-trip a `/push/getReceipts` — donde Expo reporta fallos que solo
  se conocen después de intentar la entrega. **Revisar cuando:** aparezcan
  usuarios que no reciben push y cuyo token sigue vivo en la tabla. **Fix:**
  guardar el `ticket.id` y un job que consulte recibos.
- **`pg_net` es fire-and-forget.** Si el webhook falla (función caída, secreto de
  Vault mal puesto, 5xx), la notificación queda en el inbox con
  `push_enviado_at is null` y el error solo se ve en `net._http_response`. Nadie
  reintenta. **Revisar cuando:** alguien reporte no haber recibido un push que sí
  está en su inbox. **Fix:** un barrido de
  `notifications where push_enviado_at is null and created_at > now() - interval '1 day'`.
- **El inbox no pagina:** `fetchNotificaciones()` trae las últimas 100 y ya.
  **Revisar cuando:** una cuenta real pase de ~100 notificaciones — hoy se
  acumulan de a una por baja de precio de un favorito, o sea decenas al año.
  **Fix:** el mismo cursor `(created_at, id)` que ya usa `fetchListings`.
- **Sin "categoría seguida"**, el tercer disparador (opcional) de RF-16. No
  existe modelo ni afordance en el diseño, y es el único fan-out 1→N del campus
  entero. **Revisar cuando:** se pida de verdad. **Fix:** tabla
  `category_follows` + su RLS + su bloque en la suite + la UI de seguir, y
  **scoping por campus más throttling** antes de encender el disparador — si no,
  es una notificación por cada publicación nueva del campus.
- **El token de push es no-enumerable, pero robable si se conoce.** Cualquiera
  que sepa el token de otra persona puede reasignárselo (el trigger
  `claim_push_token` no distingue) y dejarla sin push. La precondición no es
  alcanzable desde el API —el token solo lo lee su dueño y no aparece en ninguna
  otra respuesta—, así que hoy no hay camino. **Revisar cuando:** un token de
  push llegue a viajar en alguna respuesta o log accesible. **Fix:** exigir que
  el insert traiga también algo que solo el aparato tenga.
