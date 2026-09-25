---
paths:
  - "src/app/(confianza)/**"
  - "src/app/reportar/**"
  - "src/lib/confianza.ts"
  - "src/components/BuyerRow.tsx"
  - "src/components/StarRating.tsx"
  - "scripts/probe-venta.mjs"
---

# Confianza: venta, calificación y reportes (RF-07, RF-08, RF-12, RF-14)

> Movido verbatim desde `CLAUDE.md` (§8 / §8b). Esta regla carga sola cuando la
> sesión lee alguno de los archivos de `paths:`. Las reglas transversales —
> tokens de diseño (§2), esquema y RLS (§3), inventario de pantallas (§4) y los
> gotchas de infraestructura (§9) — siguen en `CLAUDE.md`, que carga siempre.

**Confianza — 4 de 4 pantallas construidas y conectadas: grupo completo
(RF-07, RF-12, RF-14).** "¿A quién le vendiste?" (con su vacío y su modo
corrección) vive en `src/app/(confianza)/vendida/[id].tsx`, "Calificar" en
`(confianza)/calificar.tsx`, "Reportar publicación" en **`src/app/reportar/[id].tsx`**
(ojo: fuera del grupo, ver abajo), y la capa de datos en `src/lib/confianza.ts`.

**Esa cuarta pantalla sirve DOS objetivos, no uno, y sigue siendo UNA pantalla.**
`reportar/[id].tsx` reporta una publicación (bandera de Detalle) o a una persona
(bandera de "Perfil público"), según un param `tipo`. No son dos frames: lo único
que cambia en toda la hoja es el `.sheet-title` —los cinco motivos salen del
mismo enum `report_reason`, que no distingue objetivo—, así que va como variante
etiquetada dentro del frame "Reportar publicación" y **el inventario sigue en
54** (§4). Cinco cosas que conviene saber antes de tocarla:

- **`tipo` es opcional y cae a `'listing'`.** Es lo que deja intacta la llamada
  de Detalle, que era el único call site cuando la hoja solo sabía de
  publicaciones. El `id` de la ruta se REINTERPRETA según el modo: es un
  `listings.id` (bigint, de ahí el `Number(id)`) en uno y un `users.id` (uuid,
  sin parsear) en el otro.
- **El modo usuario no necesita el `sellerId`** que sí usa el otro: el `id` de
  la ruta ES la persona reportada, así que el guard compara contra él
  directamente y no hay dos fuentes que puedan desincronizarse.
- **Los candados son DOS y distintos**, ver §3: el `with check` de
  `reports_insert_own` para la publicación propia, y el `check` de tabla de
  `20260906000441:22` para la persona propia. Se notan distinto en la respuesta
  — el primero llega como `42501` y el segundo como `23514`
  (`reports_check1`)—, y por eso el autorreporte de usuario cae al toast
  genérico y no al de suspensión: ese `if` solo mira `42501`. Es correcto, es un
  caso que la UI ya no ofrece.
- **`crearReporte()` toma una unión discriminada**, no dos campos opcionales:
  `{ listingId } | { reportedUserId }` con `?: never` en la rama contraria. La
  base ya exige el mutuo-excluyente (`num_nonnulls(...) = 1`); el tipo solo lo
  sube a compilación para que pasar ambos o ninguno no llegue nunca al 42501.
  **Verificado con las cuatro combinaciones**, no supuesto: ambos y ninguno no
  compilan, cada uno solo sí.
- **`nombre` viaja por param solo para el título**, desde una pantalla que ya lo
  tiene pintado — no se vuelve a pedir a la base. Sin nombre (`users.nombre` es
  nullable) cae a "Reportar usuario", que es preferible a un "Reportar a "
  colgando.

**"Reportar publicación" es la única del grupo que NO vive en `(confianza)/`, y
no es un descuido.** Es una HOJA (`transparentModal`) y se abre desde Detalle,
que está en `(explorar)`: la transición la ejecuta el Stack RAÍZ, así que la
presentación tiene que declararse ahí (el gotcha de §9). Es el caso de
`filtros.tsx`/`selector-campus.tsx`, no el de sus dos hermanas, que son pantallas
completas empujadas por el stack de su grupo. Si alguien la "ordena" moviéndola a
`(confianza)/`, deja de verse como hoja y se convierte en una card opaca.

Detalles que no se ven en el diff:

- **El motivo es obligatorio y no nace preseleccionado**, aunque el frame pinte
  la primera opción marcada: ese marcado documenta el estado seleccionado, y
  copiarlo haría indistinguibles "no elegí" y "elegí spam". Mismo criterio que
  las estrellas de Calificar, y por eso "Enviar reporte" arranca `disabled`.
  El comentario sí es opcional **para cualquier motivo, incluido "Otro"** — el
  frame pone "(opcional)" en el `.field-label`, no en el placeholder.
- **La fila de motivo es un componente LOCAL, no `ListRow` ni `BuyerRow`.** Los
  tres comparten `RadioCircle` —que por eso se exporta desde `ListRow.tsx`— pero
  ninguno de los dos calza: `ListRow` exige un `sub` que aquí no existe y
  `BuyerRow` lleva avatar. `.radio-row` es su propia forma (gap 11, padding 13,
  sin borde en la última).
- **El guard de autorreporte NO hace fetch**: recibe `sellerId` por param desde
  Detalle, que ya tiene el dato al decidir si pinta la bandera. Y lee
  `listing.userId`, el MISMO campo con el que se calcula `isOwner` —no
  `listing.vendedor.id`, que hoy trae el mismo valor—: dos fuentes para la misma
  pregunta se desincronizan sin dar ningún error. Cierra la hoja desde un
  `useEffect` y no desde el cuerpo del render, porque `router.back()` mueve el
  estado del navegador. **No es el candado**: ese es el `with check` de §3, y el
  guard solo evita ofrecer un formulario condenado.
- **El toast del `42501` distingue sus dos causas con `profile.estado`**, que la
  sesión ya trae — el mismo recurso que el toast de WhatsApp. Sin ese `&&`, el
  caso adversarial (param manipulado) recibiría un "tu cuenta está suspendida"
  que sería mentira. Su copy dice "enviar reportes" y no "reportar
  publicaciones" desde que la hoja sirve los dos objetivos; los toasts son la
  excepción de §0 regla 4, así que ese texto vive en código y no en el frame.
- **La bandera solo existe para quien NO es el dueño** (el frame la cambia por el
  kebab en "Detalle (vista vendedor)"), y **el kebab sigue inerte**: es otra
  tarea. Compartir, en cambio, se pinta en las TRES variantes y nunca dependió de
  `isOwner`. **En "Perfil público" rige el mismo reparto**: la bandera se esconde
  en el perfil propio (`profile?.id === id`), compartir se pinta siempre. Hoy no
  se llega a la propia —el `.seller-card` que navega ahí ya está gateado por
  `!isOwner`, y es el único call site—, pero la ruta es alcanzable por deep link
  y el guard cuesta una línea.

- **`accionVenta()` es el derivado de TRES estados de la fila de venta, y vive en
  un solo lugar a propósito.** Lo consumen las tres entradas —"Editar
  publicación", "Detalle (vista vendedor)" y la hoja de "Mis publicaciones"—:
  calcularlo tres veces es la forma de que se desincronicen. Los estados son
  "Marcar como vendida" / "Cambiar comprador" / ausente.
  **RF-18 le agregó una cuarta razón para devolver `null`, y ese cambio NO es de
  tipos sino de comportamiento**: hasta entonces devolvía `'marcar'` para TODO
  estado distinto de `vendida`, así que con `pendiente`/`bloqueada` en el enum
  habría ofrecido "Marcar como vendida" sobre una publicación que la base no deja
  tocar — `listings_update_own` excluye los dos de su `using` (20260917000459),
  o sea que el update afecta 0 filas SIN LANZAR y el vendedor habría llegado
  hasta "¿A quién le vendiste?" para recibir un error al final. El `if` nuevo va
  ANTES del `!== 'vendida'`, o la primera línea se lo come. Que el helper viva en
  un solo lugar es lo que hizo que esto fuera una línea y no tres.
  **Ojo: desde que vendida es terminal (RF-08), "Cambiar comprador" perdió una de
  esas tres entradas.** La de "Editar publicación" quedó inalcanzable sobre una
  vendida —esa pantalla ahora rebota con su guard— y eso es correcto, no una
  regresión: las otras dos siguen ofreciéndola. `accionVenta()` no cambió.
- **"Editar publicación" se esconde sobre una vendida en las DOS entradas que la
  ofrecen** (`mis-publicaciones.tsx`, con `puedeEditar` hermano de
  `puedeAlternar`; y `detalle/[id].tsx`, en la rama `isOwner`), más un guard
  dentro de la propia pantalla para el deep link. Ninguno es el candado: lo es el
  `using` de `listings_update_own` (§3). Dos consecuencias que no se ven:
  - **En Detalle el reparto del `.sticky-cta` pasó de cuatro a seis**, y el del
    dueño ahora tiene tres: ghost+primary, solo el ghost ("Cambiar comprador", a
    ancho completo por su propio `flex:1`), o el `.notice` de "ya se vendió"
    —extraído a `VendidoNotice`, local del archivo, porque pasó a tener dos
    consumidores—. Sin ese tercero el contenedor quedaría **vacío**.
  - **El estilo `editBtnSolo` dejó de aplicarse al botón del dueño**, y no por
    gusto: `accionVenta()` devuelve `'marcar'` para todo estado distinto de
    vendida, así que cuando ese botón se pinta el ghost está siempre al lado. La
    rama era inalcanzable; el estilo sigue vivo para las ramas del comprador.
- **Detalle y Editar recargan al recuperar el foco** (`useFocusEffect` + el ref
  que salta el primer foco, el patrón de `mis-publicaciones.tsx`), y no es
  frescura general: es lo único que hace que esconder el botón sirva. El flujo de
  venta se lanza DESDE esas pantallas y vuelve con `router.back()`, así que nunca
  se desmontan — sin el refetch seguirían ofreciendo "Editar publicación" sobre
  algo que acaba de venderse. En Editar además no destruye trabajo:
  `FormularioCargado` está keyed por `listing.id`, no por `recargas`.
  **`useVentaDetalle` recibe ese mismo contador** (§ su firma ganó un cuarto
  parámetro): con el listing fresco y la venta vieja, `accionVenta()` vería
  `estado='vendida'` + `venta=null` y pintaría el aviso en vez de "Cambiar
  comprador" justo después de registrar al comprador.
- **El congelamiento que lee el cliente (`congelada()`) es DIRECCIONAL**, y tiene
  que ser la misma condición que el `using` de `listing_sales_update_seller`:
  `listing_id` de la venta, `from_user_id` = el dueño del listing,
  `to_user_id` = el `comprador_id` de la fila. **NO** "existe reseña entre las dos
  partes". Si el único rating es el del comprador mal asignado hacia el vendedor,
  la policy **sí** deja corregir — y un cliente que lo leyera bidireccional
  escondería "Cambiar comprador" por completo, dejando al vendedor sin camino de
  vuelta. **El cliente no puede ser más estricto que la base.** El filtro por
  vendedor va explícito porque `ratings_select` es `using (true)`: la RLS no
  acota nada ahí, y un `count` sin ese `eq` contaría justo la reseña que NO debe
  congelar.
- **"Soy el comprador" no se deduce del estado sino de la fila de venta.** La RLS
  de `listing_sales` solo se la devuelve a las dos partes, así que esa pregunta
  ya la contestó la base — el cliente no vuelve a decidirla.
- **`useVentaDetalle` es hermano de `useVenta`, no el mismo.** Aquel trae también
  los contactos, que en Detalle no se usan (no se ofrece elegir comprador) y que
  el comprador además solo vería a medias. Su fallo es SUAVE: si revienta, el
  Detalle se pinta sin el botón de calificar en vez de romperse entero — lo único
  que se pierde es una afordancia que el inbox vuelve a ofrecer.
- **La selección no se preselecciona en el alta, pero sí en la corrección.** El
  frame pinta la primera fila marcada para documentar el estado seleccionado;
  sin elección explícita, "nada" y "No fue a través de Relevo" serían
  indistinguibles. En corrección nace en el comprador ya registrado, y se
  **deriva** en vez de sembrarse con un efecto: `venta` llega asíncrona, así que
  un `setElegido` en un efecto pintaría un render con todo sin marcar.
- **En modo corrección NO se navega a Calificar**, y se esconde "No fue a través
  de Relevo": deshacer la venta es el DELETE que quedó fuera de alcance (ver la deuda "No se puede deshacer una
venta entera", en este mismo archivo).
- **`BuyerRow` reusa `RadioCircle`** de `ListRow.tsx` pero **no** `ListRow`:
  `.list-row` no tiene avatar y su padding es 14, no 13.
- **`IconStar` es el único icono del set con dos anchos de trazo** (1 rellena,
  1.3 vacía), y sale del prototipo: el trazo más grueso es lo que hace que la
  estrella vacía pese lo mismo que la llena.
- **La pantalla Calificar no lleva `.form-header`**: es un `.auth-body` centrado,
  la misma forma que las pantallas de auth. Y el botón se deshabilita sin
  estrellas: lo opcional es el comentario, no el puntaje (`estrellas` es
  `not null check (between 1 and 5)`).

El grupo Cuenta está completo (8/8).
**Sistema** tiene las 3 piezas que Explorar necesitó (arriba) más "Confirmar
eliminar", cableado con `ConfirmModal` + `DangerButton` tanto en Editar
publicación como en Mis publicaciones.

- **RF-07 + RF-12 completos: "Marcar como vendida → ¿A quién le vendiste? →
  Calificar".** Una migración (`20260912000453`), el grupo Confianza construido,
  y el cuarto disparador de RF-16. Lo que no se ve en el diff:
  - **La premisa de la tarea estaba mal en dos puntos, y verificarlo antes de
    planear ahorró rehacer.** El trigger de `rating_promedio` YA existía
    (`20260906000440:136-158`) y el `unique` de `ratings` también (`:93`), así
    que ninguno hizo falta. En cambio, la fila "Marcar como vendida" **no
    estaba** en la hoja de acciones de "Mis publicaciones" —ni en el código ni
    en el frame—, así que hubo que construirla en el HTML primero.
  - **El comprador es una tabla, no una columna** (§3). Esa decisión de
    privacidad cambió la forma de la migración entera.
  - **Sin el modo corrección, la policy de UPDATE habría sido inalcanzable desde
    la UI**: al pasar a `vendida` desaparece la entrada "Marcar como vendida" de
    las tres pantallas. Por eso esa fila tiene **tres** estados derivados de un
    solo helper (`accionVenta`), no dos.
  - **El orden de escritura es insert-antes-de-update y no es cosmético.** Al
    revés, un fallo entre los dos statements deja la publicación `vendida` sin
    comprador registrado y sin salida. Con este orden el fallo deja una venta
    sobre una publicación todavía activa: la entrada sigue visible y el
    reintento es idempotente (`ignoreDuplicates` + la preselección del comprador
    ya registrado).
  - Probado en local de punta a punta: las 128 aserciones **de entonces** en
    verde (hoy son más; este número es el de ese hito, no el actual — la cuenta
    viva se mide, ver abajo) y **seis
    controles negativos**, cada uno fallando en su aserción (ver §3), más
    `scripts/probe-venta.mjs` (13 aserciones) con sus tres controles: romper la
    policy hace fallar el lado base, "simplificar" `congelada()` a bidireccional
    hace fallar el tripwire, y derivar el vendedor de la sesión —el bug real que
    apareció construyendo esto— también. Ese último es el que demostró que
    tripwire y escenario 3 cubren cosas distintas (§3).

- **RF-08 completo: `vendida` es terminal también para editar**
  (`20260913000454`). Una migración de una sola policy, 10 aserciones (T20) y tres
  pantallas. Lo que no se ve en el diff:
  - **La tarea parecía de UI y el bug real era de base.** Esconder "Editar
    publicación" era lo pedido; lo que estaba roto era que el toggle de pausa de
    Editar **resucitaba una venta** (§3). Ninguna pantalla lo delataba.
  - **Es el primer cambio a una policy del repo.** No había ni un `drop policy`
    ni un `alter policy` en las 17 migraciones anteriores; el precedente de
    "restringir un update sobre `listings` según `old.estado`" había ido por
    trigger, y aquí ese camino está medido como incorrecto (§3).
  - **El control negativo encontró un defecto en la prueba, no en el código.** La
    aserción de "no se puede reactivar una vendida" fallaba con el mensaje del
    trigger de fotos, o sea que no probaba lo que dice; se arregló dándole una
    foto a esa fixture (§3). Vale como recordatorio de que un control negativo se
    corre, no se razona.
  - **Tres variantes nuevas en `relevo-app.html`, ningún frame nuevo:** el
    inventario sigue en 54. Dos de ellas dibujan contenedores degenerados que
    antes no existían —un `.sticky-cta` que se quedaría vacío y una hoja de
    acciones de una sola fila roja—, y la tercera es el guard de Editar.
  - **Dos comentarios del diseño decían lo contrario de la regla nueva** y se
    corrigieron: el del sticky del vendedor afirmaba que "Editar publicación" se
    quedaba sola a ancho completo, que es justo lo que ya no pasa.

- **RF-14 completo: "Reportar publicación" — con eso el grupo Confianza queda en
  4/4.** Una migración (`20260914000455`), 3 aserciones (T21), la hoja
  `src/app/reportar/[id].tsx` y el cableado de los dos íconos del header de
  Detalle. De paso se conectó **Compartir**, que era inerte en las tres variantes.
  Lo que no se ve en el diff:
  - **La tarea parecía 100% de cliente y no lo era.** El frame existía completo y
    `reports` estaba desde la Fase 2, así que el plan original no tocaba SQL —
    pero al revisar las policies apareció que **nada impedía que el dueño
    reportara su propia publicación** (§3). Se cerró en la policy y no con un
    `if`, que es lo que pide §0 regla 7.
  - **Es el SEGUNDO cambio a una policy del repo**, después de `20260913000454`.
    Se siguió su mismo criterio de drop+create (restituir la policy completa a la
    vista) en vez de `alter policy`.
  - **El diff de la migración es UNA cláusula.** Las otras tres se transcriben
    idénticas, incluida la forma envuelta `(select auth.uid())` — que no es un
    cambio de estilo introducido aquí: ya era la del original y la de 11
    migraciones (es la optimización de initplan de Supabase). Conviene saberlo
    antes de leer un drop+create como "reescribieron todo".
  - **El control negativo corrigió la prueba DOS veces, y la segunda cambió el
    código de la prueba, no solo un comentario.** Primero: el comentario de
    T21(b) afirmaba cazar un `not exists` demasiado ancho, y al correrlo resultó
    que ese caso muere antes en T8. Y después, al preguntarse si T21 se sostenía
    SOLA —correrla aislada, fuera de la suite—, apareció que le faltaba una
    aserción entera: contra la variante del `<>` contra el subselect, T21 daba
    verde y la cazaba únicamente T8. De ahí salió (c). Van tres hitos seguidos en
    que el control negativo encuentra algo que el razonamiento había dado por
    bueno, y este agrega una técnica nueva: **correr la sección aislada**, porque
    dentro de la suite el orden del archivo esconde de quién es la red.
  - **Ningún frame nuevo ni variante nueva:** el inventario sigue en 54 y el HTML
    no se tocó. Los toasts son la excepción documentada de §0 regla 4, y son lo
    único de copy que se escribió en código.

- **RF-14 ampliado: "Reportar usuario" desde Perfil público — el segundo
  objetivo de esa tabla, por fin alcanzable.** **Sin migración**: el `check` de
  tabla que impide reportarse a uno mismo está desde `20260906000441:22` y el
  mutuo-excluyente (`num_nonnulls(...) = 1`) desde la misma. Una aserción nueva
  (T21(d)), la generalización de `reportar/[id].tsx` y de `crearReporte()`, y la
  bandera del header de "Perfil público". Lo que no se ve en el diff:
  - **La premisa "no hace falta SQL" se verificó contra el archivo, y esta vez
    sí era cierta** — al revés que en el hito anterior, donde la misma premisa
    resultó falsa y apareció la policy de autorreporte. Lo que sí apareció fue
    un hueco en la SUITE: el `check` de usuario nunca había tenido control
    negativo, porque hasta hoy ninguna pantalla podía chocar con él. De ahí
    (d) — ver §3.
  - **El mutuo-excluyente subió al tipo, no al runtime.** `crearReporte()` toma
    una unión discriminada con `?: never`; pasar los dos objetivos o ninguno
    deja de compilar en vez de morir con 42501. El tipo refleja la regla de la
    base, no la reemplaza — probado con las cuatro combinaciones.
  - **Dos candados distintos producen dos SQLSTATE distintos**, y eso decide el
    copy: `42501` (policy) para la publicación propia y la suspensión, `23514`
    (`check`) para el usuario propio. El `if` del toast de suspensión solo mira
    el primero, así que el segundo cae al genérico — correcto, es un caso que la
    UI no ofrece.
  - **Ningún frame nuevo: el inventario sigue en 54.** El HTML sí se tocó, en
    dos lugares: la bandera del `.profile-top` de "Perfil público" y una
    variante etiquetada dentro de "Reportar publicación" para el título alterno,
    con el patrón de borde punteado que ya usan "modo corrección" y
    `.photo-add.is-busy`.

- **"Omitir por ahora" en Calificar es DEFINITIVO.** La publicación ya es
  `vendida` y la fila de venta pasa a decir "Cambiar comprador", no "Calificar",
  así que no hay segunda entrada para el vendedor. El copy promete algo que no
  ocurre. **Revisar cuando:** alguien reporte que omitió sin querer. **Fix:** un
  botón "Calificar al comprador" en "Detalle (vista vendedor)" — exige frame
  primero (§0 regla 4).

- **El COMPRADOR ya no depende de encontrar el botón: "Calificar" se le abre
  sola al volver a la app, si tiene una compra pendiente.** Es un tercer
  camino además del push (RF-16, sin llegar todavía) y del botón manual de
  Detalle — no reemplaza a ninguno de los dos. Es la deuda OPUESTA a la de
  arriba (esa es del vendedor calificando al comprador, y sigue sin resolver).
  - **"Pendiente" es la MISMA regla que ya usa `useVentaDetalle`
    (`soyComprador && !yaCalifique`), aplicada en bloque**: existe una fila de
    `listing_sales` con `comprador_id = yo` y todavía no hay una fila de
    `ratings` mía hacia ese vendedor por ese `listing_id`. No es una copia
    nueva de autorización — es la misma pregunta que ya se le hace a la base
    por publicación, hecha ahora sobre todas las compras de una vez
    (`fetchComprasPendientesDeCalificar()`).
  - **Una sola vez por SESIÓN, no por compra.** Si aparecen dos compras
    pendientes en la misma sesión, solo se ofrece la más reciente y solo una
    vez; la segunda queda para el próximo arranque (o para el botón manual).
    El candado es un `useRef(false)` (`abierto`, en
    `useAutoAbrirCalificarPendiente()`) fijado en el instante de navegar — a
    propósito NO es el mismo patrón que el bug del guard del avatar de
    moderación (arriba en este mismo archivo, `cuenta-perfil.md`), que
    necesitaba distinguir eventos DISTINTOS; aquí el requisito es justo "una
    vez, punto", así que el mismo booleano simple que allá era un bug, aquí es
    la implementación correcta. Y se resetea SOLO al cambiar de cuenta en el
    mismo dispositivo sin cerrar la app del todo: cerrar sesión desmonta
    `(tabs)/_layout.tsx` de verdad (el `REPLACE` de `<Redirect>` quita esa
    ruta del árbol de navegación, no la deja "congelada" detrás), así que el
    candado de la cuenta anterior no sobrevive para la siguiente.
  - **Reasignar al comprador lo saca de la lista sin ningún código
    especial**: la query filtra por `comprador_id` actual, así que un
    comprador reemplazado deja de aparecer en su propio chequeo la próxima
    vez que se evalúe, por la misma razón por la que dejó de tener el botón en
    Detalle.
  - **"Omitir por ahora" en esta ruta es local al dispositivo, por cuenta, y
    NO es lo mismo que la deuda de arriba** (esa es del vendedor calificando
    al comprador). Se persiste en AsyncStorage (`src/lib/calificar-omitidas.ts`,
    clave por `userId` — un dispositivo puede tener varias cuentas) y su
    efecto es: esa compra puntual nunca vuelve a auto-abrirse, pero el botón
    manual de Detalle la sigue ofreciendo siempre — la pantalla de Calificar
    no distingue de dónde vino el tap, así que "omitir" tiene el mismo efecto
    sin importar el origen.
  - **Suspensión**: guardado del lado cliente con `profile.estado !== 'activo'`
    antes de siquiera consultar candidatas — defensa en profundidad, el
    candado real sigue siendo `ratings_insert_own` (§3 de `CLAUDE.md`).
  - **Fallo silencioso end-to-end**: cualquier error de red en el chequeo (la
    query de `listing_sales`, la de `ratings`, o el AsyncStorage de omitidas)
    hace que el hook no haga nada visible ese ciclo — nunca un toast, nunca un
    error, nunca un loop de reintento. Vuelve a intentarlo en el siguiente
    regreso a primer plano.
  - **La coordinación con el tap de una notificación (`useRespuestaANotificacion`,
    `src/lib/push.ts`) es una bandera comprobada en el momento de actuar
    (`navegacionPorNotificacion`), NUNCA una espera arbitraria.** Este repo no
    tiene ningún precedente de un `setTimeout` usado como heurística de
    carrera —el único caso parecido, un timer fijo en `splash.tsx`, se
    documentó como retirado a propósito— así que el criterio es el mismo que
    `vigente`/`intentoRef` en `listings.ts`/`selector-campus.tsx`: comprobar el
    estado real, no adivinar cuánto tardaría el otro lado. La bandera se
    reinicia a `false` al EMPEZAR cada ciclo de revisión (mount, o cada
    regreso a primer plano) y se comprueba en DOS momentos —antes de ese
    reinicio y después del fetch— porque `AppState` y el listener de
    notificaciones son dos streams de eventos nativos sin orden garantizado
    entre sí. Cubre dos de las tres variantes de la carrera; la tercera (el
    push de Calificar ya ocurrió y la notificación aterriza después) queda
    como hueco residual explícito, porque cerrarla exigiría esa misma espera
    arbitraria que este diseño evita — hoy es igualmente inalcanzable, porque
    el push no entrega en ningún aparato todavía (pendiente 1 de CLAUDE.md
    §8).
  - Sin migración, sin frame nuevo, sin cambio a `can_rate()`: reutiliza
    exactamente la pantalla y el copy existentes de "Calificar".
  - El módulo puro que decide "cuál compra, si alguna" vive en
    `src/lib/calificacion-pendiente.ts` (cero imports) y su probe en
    `scripts/probe-calificacion-pendiente.mjs` — mismo convenio que
    `src/lib/ubicacion.ts` / `scripts/probe-ubicacion.mjs`.
  - **Los cuatro pathnames de `TAB_ROOTS`** (`confianza.ts`) — dónde es seguro
    auto-navegar sin interrumpir otra pantalla — solo tienen `'/perfil'`
    confirmado textualmente en el repo; `/`, `/buscar`, `/favoritos` se
    infieren de la convención de Expo Router y quedan **pendientes de medir en
    dispositivo** (un `console.log(pathname)` temporal visitando los cuatro
    tabs) antes de confiar en esto en producción.

- **La reseña del mal asignado sobrevive y queda inmutable.** Si el vendedor
  acredita por error a C y C lo califica, esa fila se queda: tras la corrección
  `can_rate()` ya no la autorizaría, así que **C tampoco puede editarla**
  (`ratings_update_own` lleva `can_rate()` en su `with check`) y nadie puede
  borrarla (`ratings` sin delete, y eso es deliberado). Alcance: una reseña de
  alguien que sí tuvo contacto real, o sea legítima cuando nació. **Revisar
  cuando:** alguien pida retirar una reseña por venta mal atribuida. **Fix:** un
  `delete` acotado al autor con la misma ventana de congelamiento — es un cambio
  de postura sobre "una calificación no se borra", por eso no se tomó de paso.
- **El vendedor puede reasignar la venta varias veces antes de calificar, y cada
  cambio dispara una notificación.** Acotado a sus propios contactos (las dos
  policies exigen fila en `listing_contacts`), así que el máximo es "los N que
  preguntaron por esa publicación". El comprador anterior conserva su aviso
  —`notifications` no tiene delete y sus filas son historia— y degrada bien: el
  tap lo lleva al Detalle, donde el botón está gateado por la fila de venta, que
  ya no es suya, y ve el `.notice` de "ya se vendió". **Revisar cuando:** un
  vendedor lo reporte, o alguien note avisos repetidos de "califica tu compra"
  sin haber comprado nada. **Fix:** throttle por `listing_id` en el trigger de
  corrección, o no notificar en la corrección y dejar el Detalle como único
  descubrimiento.
- **El amarre cliente ↔ RLS se sostiene con dos mecanismos parciales en vez de
  uno fuerte**, y es una elección, no una carencia. El fuerte sería que el probe
  ejecutara `congelada()` de verdad, lo que exige extraer la condición a un
  módulo puro —sin dependencias de React Native— cargable desde Node. Hoy no se
  paga: es una sola función, tocar la frontera de módulos de `src/lib` cuesta más
  que el riesgo, y la combinación tripwire + escenario 3 ya cazó la regresión
  real (§3). **Revisar cuando:** `src/lib/confianza.ts` acumule más lógica de
  este tipo — condiciones de autorización espejadas contra una policy—, porque
  ahí el costo se reparte entre varias y el argumento se invierte. **Fix:**
  extraer el descriptor de filtros a un `.ts` sin imports de RN, consumido por
  `congelada()` y por el probe vía el type-stripping de Node; el tripwire
  desaparece con él.
- **No se puede deshacer una venta entera**, solo corregir a quién. Borrar la
  fila equivaldría a decir "no fue a través de Relevo" después de haberla
  registrado. Es una línea de alcance explícita, no un olvido: `listing_sales`
  no tiene grant ni policy de DELETE, y T12 lo vigila. **Revisar cuando:**
  alguien marque una venta por error y quiera revertirla del todo.

- **El log de contactos que falla se pierde.** Si el insert a
  `listing_contacts` falla, WhatsApp se abre igual (no se le niega el contacto
  al usuario por un fallo de log) y el usuario ve un toast de error, pero no
  hay reintento: falta una cola de escrituras pendientes con persistencia
  local que se vacíe al recuperar conexión. **Revisar cuando:** se construya
  el grupo Confianza — es ahí, en "¿A quién le vendiste?", donde una fila
  faltante deja de ser invisible y se vuelve un candidato ausente de la lista
  que rompe RF-12.
