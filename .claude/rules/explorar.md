---
paths:
  - "src/app/(explorar)/**"
  - "src/app/(tabs)/index.tsx"
  - "src/app/(tabs)/buscar.tsx"
  - "src/app/filtros.tsx"
  - "src/app/selector-campus.tsx"
  - "src/lib/listings.ts"
  - "src/lib/explorar-state.tsx"
  - "src/lib/categorias.ts"
  - "src/lib/favoritos.ts"
  - "src/lib/grid.ts"
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
- **`refrescar()` es una función nueva y ADITIVA de `useListings`, no
  reemplaza a `reintentar()`.** `reintentar()` vacía `items` a `[]` y pone
  `estado` en `'loading'` — correcto para "Reintentar" tras un error, donde
  tapar el contenido con el skeleton es lo que se quiere. Pull-to-refresh
  necesita lo contrario: mantener el grid visible mientras refresca. Por eso
  `refrescar()` pide la página 1 fresca y solo reemplaza
  `items`/`cursor`/`total` al llegar, sin tocar `estado` (salvo devolverlo a
  `'ready'` si veía un error previo). Hoy solo la usa el Feed
  (`(tabs)/index.tsx`), vía el `refreshControl` de `Screen`. Categorías y
  campus activo no se refrescan con el gesto — no cambian dentro de una
  sesión y no tienen refetch expuesto hoy.
- **`campusSeleccionado` sigue al campus DEL PERFIL cuando ese cambia, pero no
  pisa la elección del selector del Feed** — y esas dos cosas se distinguen con
  un `ref` (`campusPerfilAplicado`), no con el estado. El efecto que carga el
  catálogo puede volver a correr por dos razones opuestas: si es una recarga con
  el mismo campus de perfil, hay que respetar lo que el usuario haya elegido en
  el bottom sheet (eso es lo que protege el `return actual`); si el campus del
  PERFIL cambió —solo pasa en "Editar perfil"—, hay que reapuntar, o el Feed se
  queda en el campus viejo el resto de la sesión aunque el usuario acabe de
  mudarse. Cambiar de UNIVERSIDAD nunca necesitó esto: el campus viejo ya no
  aparece en la lista nueva y cae solo. Lo que NO se toca son las publicaciones
  ya creadas, que conservan su `campus_id` del insert — eso es correcto, no un
  efecto que haya que compensar.
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
