---
paths:
  - "src/app/(explorar)/**"
  - "src/app/(tabs)/index.tsx"
  - "src/app/(tabs)/buscar.tsx"
  - "src/app/filtros.tsx"
  - "src/app/selector-campus.tsx"
  - "src/lib/listings.ts"
  - "src/lib/explorar-state.tsx"
  - "src/lib/catalogos.ts"
  - "src/components/ProductCard.tsx"
  - "supabase/seeds-local/**"
  - "src/lib/categorias.ts"
  - "src/lib/favoritos.ts"
  - "src/lib/grid.ts"
  - "src/components/ListRow.tsx"
---

# Explorar: feed, búsqueda, categorías y Detalle

> Movido verbatim desde `CLAUDE.md` (§8 / §8b). Esta regla carga sola cuando la
> sesión lee alguno de los archivos de `paths:`. Las reglas transversales —
> tokens de diseño (§2), esquema y RLS (§3), inventario de pantallas (§4) y los
> gotchas de infraestructura (§9) — siguen en `CLAUDE.md`, que carga siempre.

**Explorar — construido y conectado a Supabase real.** Las 11 pantallas
existen como código (7 archivos de ruta, algunos cubren varios estados:
Categoría 2 estados, Búsqueda 3 estados, Detalle 2 estados comprador/vendedor)
y leen del proyecto remoto. `src/lib/explorar-state.tsx` sigue siendo el estado
compartido, pero ahora guarda solo los *valores* (alcance elegido, filtros,
catálogos de campus y categorías, set de favoritos): el filtrado dejó de recorrer un
arreglo y es una query en `src/lib/listings.ts`.

**Qué quedó conectado:** el catálogo de `listings` (con su join a `categories`,
`campus`, `universidades` y `listing_photos`), las `categories` reales, el
catálogo COMPLETO de universidades y campus (fase 2B; antes solo los de la
universidad del perfil), `favorites` con optimistic update y
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
- **`refrescar()` es una función nueva y ADITIVA de `useListings`, no
  reemplaza a `reintentar()`.** `reintentar()` vacía `items` a `[]` y pone
  `estado` en `'loading'` — correcto para "Reintentar" tras un error, donde
  tapar el contenido con el skeleton es lo que se quiere. Pull-to-refresh
  necesita lo contrario: mantener el grid visible mientras refresca. Por eso
  `refrescar()` pide la página 1 fresca y solo reemplaza
  `items`/`cursor`/`total` al llegar, sin tocar `estado` (salvo devolverlo a
  `'ready'` si veía un error previo). Hoy la usan el Feed
  (`(tabs)/index.tsx`), Búsqueda (`(tabs)/buscar.tsx`, las DOS ramas de
  retorno — recomendados y con/sin resultados, mismo hook subyacente) y
  Categoría (`(explorar)/categoria/[id].tsx`), los tres vía el
  `refreshControl` de `Screen`. Categorías y el catálogo de universidades y
  campus siguen sin refrescarse con el gesto — no cambian dentro de una sesión
  y no tienen refetch expuesto. El pull del Feed sí trae el conteo nuevo del
  hero, que viaja en la misma consulta del grid.

  **Y desde que Búsqueda/Categoría pueden `refrescar()` mientras `loadMore()`
  está en vuelo, `useListings` ganó un contador de "generación"**: estado
  `version` (NO un ref — el reseteo que lo sube corre EN RENDER, y mutar un
  ref ahí revienta `react-hooks/refs`), más un `versionRef` sincronizado por
  el mismo efecto-sin-deps que ya sincronizaba `paramsRef`/`keyRef` (corre
  después de cada render). Sube en cada reseteo por filtro/`recargas` y en
  cada `refrescar()` exitoso (vía `setVersion`, nunca mutando el ref
  directamente — mismo criterio). `loadMore()` captura `versionRef.current`
  antes de pedir la página siguiente y descarta su resultado si cambió
  mientras viajaba — sin esto, un pull-to-refresh que resuelve mientras una
  página de scroll infinito sigue en camino podía pegarle esa página encima de
  una lista que ya se había reemplazado por completo, duplicando o mezclando
  tarjetas. `keyRef` seguía cubriendo el caso de "cambié de filtro mientras la
  página viajaba", pero nunca cubrió a `refrescar()`, que deliberadamente no
  toca `key`/`recargas` por ser silencioso. El chequeo de `version` se suma al
  de `keyRef`, no lo reemplaza.

  **`useMisListings` (Mis publicaciones) recibió el mismo tratamiento, y de
  paso corrigió un guard que nunca funcionó.** Su `loadMore()` comparaba
  `filtroPedido !== estadoFiltro` dentro de su propio `.then()` — pero las dos
  variables son la MISMA binding cerrada por el closure (`estadoFiltro` es un
  parámetro de la función del hook, no un ref sincronizado como `keyRef` en
  `useListings`), así que la comparación nunca podía dar `false`: no
  descartaba nada. Reemplazado por el mismo par `version`/`versionRef`, que
  además cierra la misma duplicación de tarjetas que en Búsqueda/Categoría.
- **El alcance vuelve al campus DEL PERFIL cuando ese cambia, sin pisar lo
  elegido en el selector mientras no cambie.** Lo que el usuario elige se guarda
  aparte (`eleccion`) y el default se DERIVA del perfil. La elección se descarta
  EN RENDER cuando cambia la clave `userId|campus_id del perfil`. Así, mudarse de
  campus en "Editar perfil" se nota de inmediato en el Feed, y otra cuenta en el
  mismo teléfono no hereda lo que miraba la anterior. Esto reemplazó al ref
  `campusPerfilAplicado` de antes de la fase 2B. Lo que NO se toca son las
  publicaciones ya creadas: conservan su `campus_id` del insert, y eso es
  correcto. **Ojo: durante un tiempo esta frase fue FALSA** y nadie lo vio:
  "Editar publicación" mandaba en cada guardado el campus ACTUAL del perfil, así
  que editar movía la publicación en silencio. Desde la fase 2A es cierta y tiene
  candado:
  - `actualizarListing` ya no manda ubicación (`UbicacionListing`,
    `src/lib/listings.ts`, solo la recibe el alta);
  - `authenticated` no tiene UPDATE sobre `listings.universidad_id` /
    `campus_id` (`20260924000466`, T28 (d4)).
- **El hero de Detalle es un CARRUSEL, y su visor a pantalla completa es un
  `Modal`, no una ruta.** Las fotos siempre estuvieron completas en
  `fetchListingById()` (`fotos: string[]`, ordenadas por `orden`); lo que
  faltaba era la UI. `PhotoCarousel` es el mecanismo compartido y `PhotoDots`
  los puntos; el chrome (`.detail-nav`, `.detail-badge`, los propios dots) vive
  AFUERA, como hermanos absolutos, o viajaría con el scroll. Seis cosas que no
  se ven en el diff:
  - **El visor es `Modal` de RN por el mismo criterio que la hoja de acciones de
    "Mis publicaciones" y `CampusBottomSheet`**: necesita el ARRAY de fotos y el
    índice tocado en la mano, y una ruta solo recibe params serializables. De
    paso esquiva el gotcha de §9 sobre `presentation` en Stacks anidados.
  - **Lo monta `detalle/[id].tsx` de forma CONDICIONAL, no con un prop
    `visible`.** Cada apertura tiene que ser un montaje nuevo o `indiceInicial`
    no se re-aplica: `useState(indiceInicial)` solo lee su argumento al montar,
    así que abrir en la foto 3 después de haber abierto en la 1 no habría hecho
    nada.
  - **`PhotoCarousel` NO guarda índice propio, a propósito.** El dueño
    (`indiceFoto` en Detalle) es la única fuente de verdad; si el carrusel
    tuviera el suyo, `irA()` tendría que reconciliar dos.
  - **La sincronización hero ↔ visor es explícita, no emergente.** Son dos
    `ScrollView` distintos: al cerrar el visor en la foto 4, el hero se quedaría
    en la 1 si nadie hiciera nada. Por eso `onCerrar` devuelve el índice final y
    Detalle hace `setIndiceFoto(i)` + `carruselRef.current?.irA(i)`. El `irA` va
    sin animar y mientras el Modal todavía tapa, así que no hay tirón visible.
    **Si alguien "simplifica" ese parámetro, rompe esto sin ningún error.**
  - **`contentOffset` de ScrollView NO sirve para abrir en la foto tocada: es
    iOS-only** (`ScrollView.d.ts:406`, dentro de `ScrollViewPropsIOS`, que abre
    en la 336). En Android se habría ignorado en silencio y el visor siempre
    habría abierto en la primera. Se usa `onContentSizeChange` + `scrollTo`, con
    un guard de una sola vez.
  - **El tamaño de página se MIDE con `onLayout`, no se asume.** El ancho sí
    sería `useWindowDimensions().width` en los dos usos, pero el alto no (340 en
    el hero, pantalla completa en el visor), y un `height:'100%'` por página
    colapsa a 0 dentro del contenedor de contenido de un ScrollView.
  - El gesto de cierre va con **`PanResponder` + `Animated`**, no con
    gesture-handler: `react-native-gesture-handler` y `reanimated` están en
    `package.json` pero no se usan en un solo archivo de `src/`. El reparto de
    ejes es `|dy| > |dx| * 2 && |dy| > 8` — eso es lo que impide que el arrastre
    vertical le robe el swipe horizontal entre fotos. **Y el cierre pasa por
    estado (`cerrando`), no por un ref**: el `PanResponder` se crea una sola vez
    y por clausura reportaría siempre `indiceInicial`; `react-hooks/refs`
    además rechaza el ref.
  - **Con 0 fotos el tap no abre nada** (ahí se ve el ícono de categoría de
    fallback) y **con ≤1 foto no se pintan dots** — un indicador de paginación
    de una sola página es ruido. Antes se pintaba uno solo
    (`Math.max(fotos.length, 1)`), que era razonable cuando el hero no
    scrolleaba.
  - Se montan las N páginas de golpe, sin virtualizar: el tope es 5 fotos, ya
    normalizadas por `normalizar()`, y `ListingPhoto` va con `cachePolicy="disk"`
    (línea 81), así que el visor las lee de disco sin volver a bajarlas de la
    red. Ojo: `"disk"` no es `"memory-disk"`, así que sí re-decodifica — si el
    visor se siente lento al abrir, ese es el ajuste.
- **La búsqueda NO escapa el término, y es deliberado.** Va por
  `.textSearch('busqueda', q, {type:'websearch', config:'spanish'})` contra la
  columna generada: `websearch_to_tsquery` está hecho para input crudo (nunca
  lanza error de sintaxis), la coma ya no delimita nada porque es un filtro
  suelto y no un `or=(...)`, y `*` se vuelve una tsquery vacía. Aquí vivió un
  `escapaBusqueda()` de dos capas más un corto circuito para el asterisco;
  ambos se borraron al migrar a tsvector. Si vuelves a ver un `replace` sobre
  el término de búsqueda, es una regresión.

**El `.sticky-cta` del dueño tiene un CUARTO reparto desde RF-18**, y se llega a
él con un tap desde "Mis publicaciones", no solo por deep link: sobre una
publicación `pendiente` o `bloqueada` no se pinta ningún botón —"Marcar como
vendida" la esconde `accionVenta()`, "Editar publicación" el guard de
`puedeEditar`— y en su lugar va el `.notice` con el texto del frame. Comparten
reparto con "vendida sin nada pendiente" porque comparten la causa: los dos
botones afectarían 0 filas. **Y el `.stat-row` desaparece entero** en esos dos
estados (también se salta `fetchStatsPropias`): una publicación que nunca estuvo
en el catálogo tiene los tres números en 0 por definición, y "0 vistas · 0
favoritos · 0 contactos" lee como fracaso en vez de como "no ha empezado" — mismo
recurso que el bloque de rating de Perfil sin reseñas.

Botones inertes a propósito: **ya solo el menú kebab** del dueño, que es otra
tarea. Los demás se fueron cableando y conviene no "restaurarlos": "Editar
publicación" navega a `(publicar)/editar/[id]`; "Marcar como vendida" lanza el
flujo de venta (RF-07); **Reportar** abre `/reportar/[id]` (RF-14) y **Compartir**
llama a `Share.share()` con texto plano (`compartir-deeplinks.md`). **El botón de
WhatsApp ya no tiene nada mock**: pide el número real por `seller_whatsapp` y
registra el contacto en `listing_contacts`, en ese orden.

**El orden de `contactarPorWhatsapp()` cambió y no es cosmético.** Antes
registraba primero y abría después, porque el `wa.me` con placeholder no podía
fallar. Ahora el número puede no llegar —vendedor sin teléfono, o llamante
suspendido— y en ese caso NO hubo contacto: registrarlo dejaría en "¿A quién le
vendiste?" (RF-12) a alguien que nunca pudo escribirle. Por eso el número va
primero y su ausencia corta la función. Lo que NO cambió es el fallo suave del
registro: si el insert revienta, WhatsApp se abre igual y el usuario ve un toast
(`confianza-ventas.md`, deuda del log perdido).

- **Detalle tiene pull-to-refresh, y su diseño se separó en dos piezas a
  propósito.** `fetchListingById()` se extrajo a `cargarDetalle(id, {silent?})`
  — mismo refactor frío/tibio que "Perfil"/"Perfil público": una carga fría
  (nada en pantalla) que falla pinta `ErrorState`, como siempre; una recarga
  tibia (foco o gesto de pull) que falla NUNCA tapa el contenido, solo avisa
  por toast.
  - **El caso `data === null` no es un error, y tiene su propio estado.**
    `fetchListingById` usa `.maybeSingle()`: si la publicación dejó de ser
    visible por RLS (el dueño la pausó, quedó bloqueada por moderación) o se
    borró, la query resuelve BIEN sin fila — no pasa por el `catch`. Antes de
    esta tarea esto no tenía ningún manejo: `listing` se quedaba `null` y la
    pantalla caía en `if (!listing) return null`, es decir, en blanco — el
    mismo síntoma que ya tenía (y sigue teniendo, fuera de este caso) abrir por
    deep link una publicación ya oculta. Ahora se marca con `noDisponible` y la
    pantalla pinta `ErrorState` reutilizado con copy propio ("Esta publicación
    ya no está disponible…"), sin frame nuevo en `relevo-app.html` — mismo
    precedente que "Publicar (error de subida)" representando una familia de
    motivos con un solo patrón visual, y mismo patrón que el guard `esDueno` de
    `editar/[id].tsx` (`componentes-compartidos.md`): el "Reintentar" de
    `ErrorState` apunta a `router.back()`, no a la misma query — reintentarla
    no va a des-esconder la publicación.
  - **`recargas` sigue viva, pero perdió su único consumidor de refetch del
    listing.** Antes alimentaba a la vez el efecto de carga (vía su dependencia)
    Y a `useVentaDetalle`. Ahora solo alimenta a `useVentaDetalle`, y el gesto
    de pull-to-refresh (`onRefresh`) deliberadamente NUNCA la toca: esa hook
    resetea `venta`/`yaCalifique` EN RENDER cuando su key cambia, así que
    bumpearla en cada pull haría parpadear la fila de venta (ej. "Calificar al
    vendedor" desaparece y reaparece) sin motivo. Solo el FOCO sigue
    bumpeándola — es el caso real que la necesita (el regreso de
    `/vendida/[id]` tras marcar una venta). Consecuencia aceptada: el pull
    refresca disponibilidad/contenido/stats de la publicación, pero el estado
    de venta/calificación solo se refresca al volver de tab, no con el gesto.
  - **El `useEffect` de montaje que llama a `cargarDetalle` lleva un
    `montadoRef` leído ANTES de la llamada — no es ceremonia, es lo que evita
    que `react-hooks/set-state-in-effect` lo marque.** La regla rastrea que
    `cargarDetalle` termina en un `setState` cuando se invoca directo desde un
    `useEffect` normal (el `useFocusEffect` de más abajo no se marca por la
    misma razón: no lo reconoce como efecto); un guard que lee un ref antes de
    la llamada hace que el análisis estático se rinda — el mismo blind spot que
    CLAUDE.md §9 ya documenta para `useListings`, aquí con tres instancias
    nuevas (Detalle, Perfil, Perfil público). Verificado probando las tres
    variantes a mano antes de decidir esta (sin guard: marca; con `.catch()` en
    vez de guard: sigue marcando; con el guard: no marca) — no se asumió por
    analogía con el gotcha ya escrito.

- **Búsqueda de texto por tsvector** (migración `20260908000444`). Resolvió de
  una sola vez las dos cosas: el índice GIN por fin se usa (medido con
  `explain analyze` a 80 000 filas: Bitmap Index Scan, 0.9 ms, contra Seq Scan
  de 67 ms con el `ilike` anterior) y desapareció el bug de acentos —
  buscar "calculo" sobre "Cálculo de Larson" devolvía **0** resultados y ahora
  devuelve los 3 esperados. De regalo, `websearch_to_tsquery` convierte `*` en
  una tsquery vacía, así que el bug de "buscar `*` te devuelve el catálogo
  entero" quedó cerrado por el motor y se pudieron borrar del cliente el
  `escapaBusqueda()` de dos capas y su corto circuito.

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

## El buscador del Feed abre Búsqueda con teclado, y aplicar filtros aterriza ahí

**El buscador falso del Feed y "Ver todo" dejaron de ser idénticos.** Antes
los dos hacían el mismo `router.push('/buscar')` sin params. Ahora solo el
buscador (`(tabs)/index.tsx`, el `Pressable` de `.searchFieldFake`) manda
`params: { autoFocus: Date.now().toString() }` — "Ver todo" y el tab bar
siguen sin params, a propósito: son los dos casos donde el usuario llega a
explorar, no a escribir, así que no deben abrir el teclado.

**Por qué el valor es `Date.now().toString()` y no una constante fija —
y por qué el guard del lado de Búsqueda compara VALOR y no un booleano.**
La primera versión de este diseño usaba un `autoFocus: '1'` fijo con un
`ref` booleano que se ponía en `true` la primera vez que disparaba el foco.
Es un bug real, detectado en revisión antes de escribir código: Búsqueda es
la pantalla raíz del tab "Buscar" y **nunca se desmonta** al cambiar de tab
(ver el punto siguiente), así que ese booleano se queda en `true` para
siempre — el foco habría funcionado la PRIMERA vez de toda la sesión de la
app y nunca más, aunque el usuario volviera a tocar el buscador del Feed
después. Y como el param era el mismo string constante, tampoco había forma
de que Búsqueda distinguiera "toque nuevo genuino" de "la pantalla recuperó
el foco con el mismo param que ya había consumido" (el caso que SÍ debe
seguir bloqueado — volver de Detalle, o cambiar de tab y regresar). Por eso
`(tabs)/buscar.tsx` guarda en `autoFocusConsumido` (un `ref<string |
undefined>`) el ÚLTIMO VALOR consumido, no una bandera: dispara el foco solo
si `autoFocus` está presente y es distinto al último ya visto, y luego lo
guarda como consumido. Un tap nuevo en el Feed manda un timestamp distinto
→ dispara; volver de Detalle o cambiar de tab manda el mismo timestamp (o
ninguno) → no dispara.

**Búsqueda no se desmonta entre tabs — verificado leyendo el código fuente
instalado, no por analogía con el comentario del Feed sobre el inbox.**
Medido contra `expo-router@57.0.19` (la versión exacta instalada en este
repo — `native-tabs` es experimental y esto puede cambiar entre parches, así
que si se actualiza `expo-router` vale la pena releer estos tres archivos
antes de asumir que sigue igual):
- `node_modules/expo-router/build/native-tabs/NativeBottomTabsNavigator.js:94-100` —
  `visibleTabs` mapea TODAS las `routes` del tab bar y arma un
  `contentRenderer: () => descriptors[route.key].render()` por cada una, sin
  condicionar por `state.index` (el tab con foco, que se calcula recién
  después, solo para saber cuál resaltar).
- `NativeTabsView.shared.js` (`ScreenContent`) — llama `contentRenderer()`
  sin ningún gate por `isFocused`; ese flag solo cambia `pointerEvents`
  (`box-none` vs `none`, es decir si el tab recibe toques), no si está
  montado.
- `NativeTabsView.ios.js` / `NativeTabsView.android.js` (idéntico en las dos
  plataformas) — `children = tabs.map(...)` crea un `<Screen>` por cada tab
  siempre, sin condicional.

O sea: los 4 tabs se montan de una vez al entrar a `(tabs)` y quedan vivos
todo el tiempo: cambiar de tab solo mueve qué recibe toques, no qué está
renderizado. Es la misma razón por la que el `noLeidas` del Feed se
recuenta con `useFocusEffect` y no solo al montar (`(tabs)/index.tsx:35-40`)
— pero aquí se verificó en el código de `native-tabs` en vez de asumirlo por
ese precedente.

**El foco va con `InteractionManager.runAfterInteractions`, no de forma
síncrona.** Llamar `.focus()` en el mismo tick en que se dispara la
navegación compite con la transición de cambio de tab — el teclado puede
tirar del layout mientras la animación todavía está corriendo.
`runAfterInteractions` encola el foco para después de que el motor de
interacciones considere terminadas las animaciones en curso, y el `task`
que devuelve se cancela en el cleanup del `useFocusEffect` por si el
usuario navega fuera antes de que corra.

**`SearchField` (`src/components/ListRow.tsx`) ganó un ref imperativo** —
mismo patrón que `PhotoCarouselHandle`
(`src/components/PhotoCarousel.tsx:57-60,77-116`): un tipo `SearchFieldHandle
= { focus: () => void }` exportado, `forwardRef` + `useImperativeHandle`
sobre un `useRef<TextInput>` interno. Es aditivo: los otros 3 consumidores
(Selector de universidad —que ya no existe, fase 2A—, Selector de campus,
Categoría) no pasan `ref` y
siguen funcionando igual — `forwardRef` no rompe una llamada sin `ref`.

**Aplicar filtros desde el Feed aterriza en Búsqueda, no vuelve al Feed.**
Antes "Aplicar filtros" (`filtros.tsx`) siempre hacía `router.back()` — sin
importar quién lo abrió. Eso era invisible desde el Feed: su grid ignora
`filtros` por completo (`(tabs)/index.tsx` nunca lee `useExplorarState().filtros`),
así que el usuario volvía sin ver ningún cambio, aunque el filtro sí había
quedado guardado en el contexto compartido. Ahora el ícono de filtro del
Feed manda `params: { origin: 'feed' }`, y "Aplicar filtros" ramifica:
`origin === 'feed' ? router.dismissTo('/buscar') : router.back()`. Desde
Búsqueda o Categoría (que no mandan `origin`) el comportamiento no cambió.

**`dismissTo('/buscar')` SÍ conmuta el tab activo del `NativeTabs` anidado —
confirmado con prueba manual en dispositivo, no asumido por lectura de
código.** Antes de esa prueba no era obvio: `filtros` se abre como
`transparentModal` del Stack RAÍZ empujado sobre `(tabs)` mientras el tab
interno activo sigue siendo Feed, `dismissTo('/buscar')` resuelve un
`POP_TO` contra ESE Stack raíz, y leyendo el código de
`expo-router`/React Navigation no quedaba claro si reescribir los `params`
de la entrada `(tabs)` también reconciliaba el `state.index` del navegador
de tabs ya montado (a diferencia del caso de "Ver todo", que sí está
probado por lectura de código: ahí no hay modal de por medio y el
`NAVIGATE` se despacha directo contra el propio navegador de tabs). La
prueba en dispositivo lo zanjó: tras "Aplicar filtros" desde el Feed, el
tab "Buscar" queda VISIBLEMENTE activo mostrando "con resultados" — no hizo
falta el fallback (`router.back()` + `router.push('/buscar')`) que se había
dejado escrito como plan B, así que no se implementó. Si en el futuro
`dismissTo` deja de conmutar el tab (por ejemplo tras actualizar
`expo-router` más allá de `57.0.19`, la versión con la que se midió esto),
ese fallback de dos líneas sigue siendo la salida conocida.

## Alcance del catálogo: un campus, una universidad o todo (fase 2B)

**Qué es.** `Alcance` (`src/lib/explorar-state.tsx`) es una unión discriminada:
`{tipo:'campus', campus}`, `{tipo:'universidad', universidad}` o
`{tipo:'todo'}`. El campus lleva su universidad ADENTRO (`CampusCatalogo`,
`src/lib/catalogos.ts`), así que no se puede escribir un campus con la
universidad equivocada. `fetchListings` recibe solo ids (`AlcanceFiltro`), y
esa unión es cerrada: una consulta de catálogo sin alcance no compila, en vez
de caer en silencio a "todo".

**Quién lo sigue:**
- el Feed;
- Búsqueda, en sus dos ramas (recomendados y con resultados, incluido su chip
  de alcance);
- Categoría (el "N publicaciones en …").

**Quién no lo sigue:** Favoritos y Mis publicaciones, que son listas
personales. Tampoco Publicar: una publicación nace SIEMPRE en el campus del
perfil (`(publicar)/nueva.tsx`, `getCampus(profile.campus_id)`), y la base lo
impone con `listings_user_universidad_fkey` y `listings_campus_universidad_fkey`.

**Default y persistencia.**
- Arranca en el campus del perfil.
- Si el perfil no tiene campus, cae a su universidad entera, y sin universidad
  a "todo". Esa cuenta de todos modos no pasa de "Completar perfil".
- Es `null` mientras falte el catálogo o el perfil. Sin la segunda guarda, el
  Feed pediría un instante "todo" y luego el campus: dos consultas y un
  parpadeo.
- La elección vive solo en memoria: al reabrir la app vuelve al campus propio.
  Es decisión de producto, no falta de persistencia.

**Una sola etiqueta.** `etiquetaAlcance()` arma el texto del chip del Feed, del
chip de Búsqueda y del conteo de Categoría:
- un campus de OTRA universidad lleva ` · universidad`, y el propio no (esa
  diferencia es la señal);
- una universidad se lee "Todo {universidad}";
- el catálogo completo, "Todas las universidades".

`lugarAlcance()` es la versión para frases ("Nadie ha publicado todavía en …").
Con alcance "todo" dice "Relevo".

**Cambiar de alcance reinicia la paginación sin mezclar.** No hay mecanismo
nuevo: el alcance entra en `key` de `useListings` (JSON de los params), así que
cambiarlo resetea la lista EN RENDER y pide la página 1. `keyRef`/`version`
descartan cualquier `loadMore()` o `refrescar()` que venga en vuelo del alcance
anterior. `refrescar()` y el pull-to-refresh no se tocaron.

**El selector** (`src/app/selector-campus.tsx`) lista TODO el catálogo:
- una sola consulta, `fetchCatalogoCampus()`, por sesión;
- agrupado por universidad, la propia primero ("· Tu universidad") y el resto
  por nombre;
- "Todas las universidades" arriba, y cada grupo abre con "Todos los campus de
  …".

El buscador normaliza acentos y funciona así:
- si machea la universidad, sale el grupo entero;
- si solo machea un campus o una ciudad, sale ese campus sin la fila "Todos";
- mientras hay texto, "Todas las universidades" se oculta;
- una universidad sin campus no se lista.

**No es `CampusBottomSheet`.** Ese FIJA el campus del perfil y sigue acotado a
la universidad propia (`fetchCampus`), sin cambios. "Detectar campus más
cercano" sigue inerte: es la fase 2C.

**La universidad como etiqueta de confianza.**
- `SELECT_CARD` y `SELECT_DETALLE` embeben `universidad:universidades(nombre)`
  en la MISMA consulta, sin una consulta por tarjeta.
- **Sin hint, y medido:** `listings` tiene una sola FK hacia `universidades`.
  Por HTTP como authenticated da 200 en Feed, Búsqueda, Categoría (los tres
  alcances), Detalle, Favoritos (embed anidado `listing→universidades`), Mis
  publicaciones y el catálogo del selector.
- El control de ambigüedad `users(nombre)` sí da PGRST201. Hoy lista DOS FKs
  (`listings_user_id_fkey` y `listings_user_universidad_fkey`), por eso
  `VENDEDOR` lleva hint.
- `ProductCard` pinta la universidad en su propia línea de `.meta`, con la fecha
  debajo. En una sola línea ni "Tec de Monterrey" cabía en una tarjeta de 2
  columnas ("Tec de M…"), y una etiqueta de confianza truncada no dice nada.
- Detalle pinta la universidad en la meta, y en "Detalles" las filas
  "Universidad" y "Zona de entrega" = campus · ciudad.
- `MiListing` trae `universidadNombre` vacío: `SELECT_MIAS` no la embebe porque
  esa pantalla no la muestra.

**El hero del Feed cuenta de verdad.** "800+ publicaciones" era texto fijo. Hoy
es el `total` de la misma consulta del grid (`withCount: true`), sin request
aparte, y se esconde con 0 y mientras no hay número. Frame "Feed (sin
publicaciones)".

**Copy del vacío, alcance por alcance.** El frame solo define el caso campus. En
"una universidad" y en "todo" se reusa el mismo sub ("Prueba con otro campus o
con toda la universidad."), que ahí se lee raro. Hoy es inalcanzable en la
práctica: significaría una universidad sin ninguna publicación, o el catálogo
entero vacío. **Revisar cuando:** se dé de alta una universidad sin
publicaciones. **Fix:** una variante del frame con su propio copy (§0 regla 4).

- **Ningún índice cubre los alcances "universidad" y "todo".** Salida real de
  `\d+ public.listings`: solo `listings_feed_idx (campus_id, estado,
  created_at DESC)` más índices de una columna. El `explain` de
  `where estado='activa' order by created_at desc, id desc limit 20` da
  `Limit → Sort → Seq Scan`, y "universidad" hace lo mismo sobre
  `listings_universidad_id_idx`. Con 54 activas en remoto no importa. El
  `count exact` del hero, de Búsqueda y de Categoría recorre el alcance entero,
  así que en "todo" escala con el catálogo.
  **Revisar cuando:** haya ~10 000 activas, o `explain analyze` del Feed en
  "todo" muestre un Sort de más de ~20 ms.
  **Fix** (una migración, sin tocar el cliente):
  - `create index on listings (created_at desc, id desc) where estado = 'activa'`;
  - `create index on listings (universidad_id, created_at desc, id desc) where estado = 'activa'`;
  - si el conteo pesa, cambiar el hero a `count: 'estimated'`.

**Pruebas locales.** `supabase/seeds-local/multiuniversidad.sql` siembra una
segunda universidad de nombre largo con dos campus (uno vacío), un campus vacío
en el Tec, 10 publicaciones y dos cuentas con contraseña `prueba-1234`. Va FUERA
de `sql_paths` porque `seed.sql` viaja a remoto con `--include-seed`. Se corre
DESPUÉS de la suite de RLS, porque T0 cuenta todos los perfiles; su cabecera
dice cómo.

## Datos de prueba en remoto — BORRAR antes de usuarios reales

Sembrados el 2026-09-23 por `execute_sql`, para probar a mano la fase 2B en
producción, que solo tiene una universidad real:

| Qué | Nombre exacto | id |
|---|---|---|
| universidad | `Universidad de Prueba 2B` | 2 |
| campus | `Campus Norte (prueba 2B)`, ciudad `Ciudad de Prueba` | 3 |
| campus | `Campus Sur (prueba 2B)`, ciudad `Ciudad de Prueba` | 4 |
| cuenta (auth + perfil) | `prueba-2b@example.com`, **sin contraseña** (no puede iniciar sesión) | `7f50bc00-68de-4c01-bdd6-a68362653b1a` |
| publicaciones | 3 `activa` en Campus Norte, sin fotos, descripción "Publicación de prueba de la fase 2B…" | — |

**No se dio de alta ningún dominio** para esa universidad, así que nadie se
puede registrar en ella.

**La cuenta se creó con un INSERT directo en `auth.users`, no por el admin API
como decía el plan**, porque en esa sesión no había acceso a la secret key del
proyecto remoto: el único canal a remoto era `execute_sql` del MCP, que no la
expone, y ningún `.env` del repo la tiene. El efecto es equivalente para esta
prueba: el trigger de alta corrió igual, y dejó `universidad_id` en NULL porque
`example.com` no está en `universidad_dominios`. La diferencia es que la fila no
tiene contraseña (`encrypted_password` en NULL) ni identidad en
`auth.identities`, así que nadie puede iniciar sesión con ella. "Campus Prueba" (id 2, Tec) ya existía antes de esta
tarea: no es parte de esto y no se borra aquí.

Limpieza, en este orden. El borrado del auth user se lleva `public.users`
(`on delete cascade`) y con él sus publicaciones (`listings_user_id_fkey`, también
cascade). Después, los campus ya no los referencia nadie (solo los referencian
`users` y `listings`, medido):
```sql
begin;
delete from auth.users where email = 'prueba-2b@example.com';
delete from public.campus where universidad_id = (select id from public.universidades where nombre = 'Universidad de Prueba 2B');
delete from public.universidades where nombre = 'Universidad de Prueba 2B';
commit;
-- Verificar: debe dar 0 | 0 | 51 (si nadie publicó nada más)
select (select count(*) from public.universidades where nombre like '%Prueba 2B%'),
       (select count(*) from auth.users where email = 'prueba-2b@example.com'),
       (select count(*) from public.listings where estado = 'activa');
```
Cuando se borren, se quita esta sección y el pendiente 0c de CLAUDE.md §8.
