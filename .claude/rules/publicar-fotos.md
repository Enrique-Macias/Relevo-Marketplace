---
paths:
  - "src/app/(publicar)/**"
  - "src/lib/publicar.ts"
  - "src/lib/storage.ts"
  - "src/lib/listing-form.ts"
  - "src/lib/foto-picker.ts"
  - "src/components/PhotoRow.tsx"
  - "src/components/ListingPhoto.tsx"
  - "src/components/ListingFormFields.tsx"
  - "supabase/migrations/*storage*.sql"
---

# Publicar: modelo atómico, fotos y Storage

> Movido verbatim desde `CLAUDE.md` (§8 / §8b). Esta regla carga sola cuando la
> sesión lee alguno de los archivos de `paths:`. Las reglas transversales —
> tokens de diseño (§2), esquema y RLS (§3), inventario de pantallas (§4) y los
> gotchas de infraestructura (§9) — siguen en `CLAUDE.md`, que carga siempre.

**Publicar — construido, conectado y ATÓMICO.** Las 7 pantallas del grupo viven
en 3 archivos de ruta: `nueva.tsx` cubre los 5 estados de Publicar (formulario,
falta teléfono, procesando fotos, subiendo, error de subida), más `creada.tsx`
—hoy de un solo estado— y `editar/[id].tsx`. (Esta cuenta decía "5 pantallas /
3 estados": se le había quedado fuera "procesando fotos", que sí es un
`phone-block` propio y §4 sí contaba.) La capa de datos: `src/lib/storage.ts`
(subida, borrado y URL autenticada — desde RF-03 habla con los DOS buckets del
proyecto, así que ojo: `BUCKET` es el privado y `BUCKET_AVATARS` el público),
`src/lib/publicar.ts` (la orquestación y su orden de
llamadas), `src/lib/listing-form.ts` (estado + validación compartida),
`src/lib/perfil.ts` (el teléfono: normalización, escritura y la RPC de lectura) y
`src/lib/foto-picker.ts`.

Detalles que no se ven en el diff:

- **El gate del teléfono (RF-13) se suma a `listoParaGuardar` en `nueva.tsx`, NO
  a `puedeGuardar` de `listing-form.ts`** — ese booleano lo comparte "Editar
  publicación", que no debe heredarlo: quien edita una publicación ya publicó, o
  sea que ya dio su número. `listoParaGuardar` ya existía para exactamente esto
  (los datos del perfil que el formulario necesita pero no controla), así que el
  gate no estrenó mecanismo.
- **El teléfono no vive en `useListingForm`, y no es organización.** No es un
  campo de la publicación sino del perfil, y se escribe en `public.users`.
  Dentro del form viajaría hasta `aInput()`, que arma la fila de `listings`.
  Por lo mismo `ListingFormFields` lo recibe como un prop opcional entero
  (`telefono`) y no como parte de `form`: sin ese prop el formulario es
  exactamente el de antes, que es lo que necesita Editar.
- **`faltaTelefono` es `profile?.tiene_telefono === false`, con el `=== false`
  a propósito.** Mientras el perfil no ha cargado, `tiene_telefono` llega
  `undefined`; con un `!profile?.tiene_telefono` el campo parpadearía en la
  pantalla de todo el mundo durante el primer render.
- **El teléfono se guarda ANTES de crear la publicación**, mismo criterio que
  "Completar perfil" con la contraseña: si falla, todavía no se creó nada y no
  hay qué recuperar. Al revés dejaría una publicación `pausada` cuyo dueño sigue
  sin ser contactable. Después va un `refreshProfile()`, que es lo que hace
  desaparecer el campo.

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
- **Las fotos se NORMALIZAN al elegirlas**, en `normalizar()`
  (`src/lib/foto-picker.ts`): siempre re-encode a JPEG `compress: 0.8`, y resize
  solo si el lado mayor pasa de 1600 px. Sin esto, cualquier screenshot (PNG de
  6+ MB) falla siempre contra el tope de 5 MiB del bucket — ver §9, el `quality`
  del picker no comprime PNG. Va **al elegir y no al subir** por lo mismo que el
  filtro de formato ("con la foto todavía a la vista y pudiendo elegir otra"), y
  así se paga una vez por foto y no en cada reintento.
  - **El orden es filtrar-formato → normalizar, no al revés.** Invertirlo
    dejaría `formatoSoportado()` muerto (el manipulator convertiría un TIFF a
    JPEG), y si el manipulator falla justo con ese formato exótico caeríamos a
    la URI original y subiríamos algo que el bucket rechaza, con el error lejos
    de su causa.
  - Si el manipulator falla se conserva la URI original en vez de descartar la
    foto: puede que ya fuera lo bastante chica, y abajo está la red del punto
    siguiente.
  - **1600 px** sale del diseño: el frame mide 375 pt y el hero de Detalle es a
    ancho completo → 1125 px en 3x.
- **`subirFoto()` distingue el fallo DETERMINISTA del transitorio**, y
  `subirConReintento()` ya no reintenta el primero. Se detecta con
  `StorageApiError.code === 'EntityTooLarge'` —el campo que la propia librería
  documenta para esto, no el `message`, que viene en inglés— y se traduce a
  `FotoDemasiadoGrandeError`, hermano de `FormatoNoSoportadoError`. Antes de
  esto, un incidente real de 6 toques generó **12 requests**: el reintento
  automático duplicaba cada intento condenado.
- **El motivo se marca EN la foto** (`FotoElegida.fallo`), no en el estado de la
  pantalla, y de ahí sale todo lo demás:
  - `subirPendientes()` **salta** las marcadas como deterministas: se reportan
    con su motivo sin tocar la red. Sin eso, el caso mixto —una foto muy grande
    y otra caída por conexión— reintroduce el desperdicio, porque "Reintentar"
    es legítimo por la segunda y arrastraría a la primera.
  - El aviso y el CTA se **derivan en cada render** de `form.fotos`
    (`fallosDe()` + `componerAviso()`), nunca se guardan. Es lo que hace que
    quitar la foto culpable recomponga el texto al instante **y renumere**: si
    se quita la foto 2, la que era 4 pasa a ser 3. Un texto guardado en estado
    seguiría nombrando fotos ya quitadas, con las posiciones corridas.
  - `idFoto()` no incluye `fallo`, así que marcar no remonta miniaturas ni
    dispara `fotosCambiaron` en Editar: anotar no es editar el set.
- **`finalizarPublicacion()` no propaga el fallo de `guardarFotos()` ni el de la
  activación: los devuelve en `falloGeneral`.** Tiene un solo camino de retorno a
  propósito. Como `guardarFotos()` corre ANTES del early return (tiene que, o
  quedan huérfanos), una excepción ahí se llevaba el resultado entero — y con él
  las marcas de las fotos que ya se sabían malas: el usuario veía solo el
  genérico y cada "Reintentar" volvía a subir la foto condenada.
- **El congelado está partido, y las dos mitades no comparten razón.**
  `PhotoRow` se congela solo mientras hay una subida en curso (quitar una foto a
  media subida rompe el orden); los campos de texto, mientras
  `listingId !== null` (la publicación ya existe en la base con ese texto y
  `finalizarPublicacion` no lo reescribe). Tras un fallo lo segundo sigue siendo
  cierto y lo primero no — y ahí el usuario NECESITA poder quitar la foto. De
  ahí el prop `fotosDisabled` de `ListingFormFields`.
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
- **`PhotoRow` tiene un tercer estado, `FotoProcesando`, para el momento entre
  elegir una foto y que `normalizar()` termine con ella** — más urgente desde
  que cada foto se re-encodea y a veces se redimensiona antes de aparecer:
  elegir varias fotos grandes de golpe podía tardar segundos sin ninguna señal
  de que algo estaba pasando. Nuevo frame en `relevo-app.html`: "Publicar
  (procesando fotos)".
  - **La miniatura muestra la foto real recién elegida** (la uri cruda del
    picker, sin esperar a `normalizar()`), con un scrim (`rgba(34,31,28,0.55)`,
    el mismo tono que ya usa `.photo-remove`) y `BlinkingDots`/`.splash-dots`
    encima — el mismo indicador que ya usa el botón "Subiendo imágenes", no
    un skeleton nuevo. Mostrar la foto real responde directo a "parece que no
    se cargó": si se ve la foto, sí se cargó.
  - **Es por foto individual, no por lote.** `elegirFotos()` dejó de resolver
    un array una sola vez al final — ahora toma `callbacks.onPlaceholders`
    (avisa, tras el filtro de formato, cuántas fotos van a procesarse) y
    `onFotoLista` (avisa una por una, en cuanto CADA `normalizar()` termina).
    Sin esto, aunque hubiera loading visual, las 5 miniaturas habrían
    aparecido nítidas todas al mismo tiempo, tan tarde como la más lenta — que
    es justo lo que pasaba antes de este cambio. El loop sigue siendo
    secuencial (sin `Promise.all`, mismo motivo de siempre: pico de memoria).
  - **La uri cruda del asset es la llave que conecta el placeholder con su
    resultado** (`reemplazarPlaceholder` en `listing-form.ts`) — no hace falta
    un id nuevo. No hay colisión posible porque `.photo-add` desaparece
    mientras hay un lote en curso (prop `procesando` de `PhotoRow`, DERIVADO en
    cada render de `form.fotos.some(origen === 'procesando')`, no un estado
    aparte): no puede haber dos lotes generando la misma uri a la vez.
  - **`puedeGuardar` (`listing-form.ts`) excluye cualquier foto `'procesando'`.**
    Sin esto, tocar "Publicar artículo"/"Guardar" mientras una foto sigue
    procesando le pasaría una `FotoProcesando` (sin `path`) a
    `subirPendientes()`, que solo sabe tratar `'storage'`/`'local'`. De ahí
    sale `FotoParaGuardar` (`PhotoRow.tsx`), el tipo angosto —sin
    `'procesando'`— que ahora usan `subirConReintento`, `subirPendientes` y las
    firmas de `publicarListing`/`finalizarPublicacion`/`guardarEdicion`.
    `fallosDe` NO se angostó: se sigue llamando en cada render sobre
    `form.fotos` (`FotoEnEdicion`) para derivar el aviso, incluso mientras hay
    una foto procesando — su propio filtro (`origen === 'local' && fallo`) ya
    la excluye sola, sin necesitar el tipo más estrecho.
    `fotosParaGuardar()` (`publicar.ts`) es la función que hace el angostado en
    el límite del módulo, en los dos únicos sitios que llaman a
    `publicarListing`/`finalizarPublicacion`/`guardarEdicion`.
    **VERIFICADO, no supuesto — hoy NO hay ningún camino de ejecución que la
    haga lanzar**: `publicar()` (`nueva.tsx`) y `guardar()`
    (`editar/[id].tsx`) vuelven a chequear `listoParaGuardar`/`puedeGuardar`
    de forma síncrona en su propio primer renglón, y entre ese chequeo y la
    llamada a `fotosParaGuardar(form.fotos)` no hay ningún `await` — es la
    MISMA clausura, sobre el MISMO array de `form.fotos` (React no muta el
    array de un render viejo), así que no existe secuencia de taps donde el
    guard vea una cosa y la llamada de abajo vea otra. No es "red por si
    `puedeGuardar` se saltara": hoy no se puede saltar.
    **Entonces por qué existe**: `publicarListing`/`finalizarPublicacion`/
    `guardarEdicion` necesitan `FotoParaGuardar[]`, y `form.fotos` es
    `FotoEnEdicion[]` — ALGO tiene que angostar ese tipo en la frontera,
    con o sin este chequeo. La alternativa era un `as FotoParaGuardar[]` mudo
    en cada call site: mismo costo, cero protección si algún día alguien
    inserta un `await` entre el guard y la llamada (reintroduciendo la
    ventana que hoy no existe) o agrega un tercer call site sin el mismo
    guard. Entre las dos formas de resolver un problema de tipos que había
    que resolver de todos modos, se eligió la que falla alto en vez de la que
    corrompe en silencio — no es validación agregada por si acaso sobre un
    riesgo de hoy.
  - **`agregarFoto()` (en `nueva.tsx` y `editar/[id].tsx`) gana un guard de
    reentrada por `useRef`**, no por estado: tiene que valer ANTES del primer
    `await`, sin esperar a un re-render. Un doble-tap muy rápido en "Agregar"
    podría, si no, abrir el picker dos veces y generar dos lotes de
    `elegirFotos()` superpuestos.
  - **MEDIDO con datos reales (instrumentación temporal de 3 puntos en
    `elegirFotos()`, `console.log` bajo `__DEV__`, YA RETIRADA del código —
    esto es el resultado, no una nota de "sigue ahí"): el tiempo del picker
    NO escala con la cantidad de fotos elegidas** — 1 foto: 5183ms; 4 fotos:
    7224ms; 5 fotos: 5898ms en un intento y 13767ms en otro. Es altamente
    variable por foto específica, consistente con que iOS esté descargando
    esa foto desde iCloud si no estaba ya en el dispositivo — comportamiento
    del sistema, fuera de control de la app; ni `normalizar()` ni el loop
    pueden arreglarlo. El loop de `normalizar()` en sí (punto 3/3) y el tramo
    resolve→`onPlaceholders` (punto 2/3, solo un `.filter()`) confirmaron NO
    ser donde está el retraso. **Si hace falta volver a medir** (ej. tras un
    cambio real al picker o a `normalizar()`), reinstalar los 3
    `console.log` bajo `__DEV__` es rápido — no vale la pena dejarlos
    permanentes por esa posibilidad.
  - **De ahí, un segundo hueco de señal visual: `eligiendoFotos`.** El picker
    puede tardar esos mismos varios segundos DESPUÉS de que el usuario ya
    confirmó su selección y la pantalla de Publicar vuelve a ser visible —
    hasta que `launchImageLibraryAsync()` resuelve, `form.fotos` no cambió en
    nada, así que un `procesando` derivado solo de `form.fotos.some(...)` se
    quedaba en `false` todo ese rato: "+" se veía tocable aunque
    `agregarFoto()` ya estuviera bloqueado por el ref de arriba. Por eso
    `nueva.tsx`/`editar/[id].tsx` ganaron `eligiendoFotos` — SÍ es estado (no
    ref: tiene que disparar un re-render), cierto desde el tap hasta el
    `finally` de `agregarFoto()`.
  - **RESUELTO: `PhotoRow` tiene un CUARTO estado en el slot de `.photo-add`,
    no solo mostrar/esconder.** `eligiendoFotos` se pasa TAL CUAL a `PhotoRow`
    (`ListingFormFields` ya no combina nada — se movió adentro, ver abajo por
    qué), que distingue tres casos con datos que ya tiene todos:
    - `fotos.some(origen === 'procesando')` (ya hay placeholder) → `.photo-add`
      sigue escondido del todo, sin reemplazo — el estado ya aprobado, sin
      cambios.
    - si NO hay placeholder pero `eligiendoFotos` es cierto (el picker sigue
      resolviendo, `fotos` no cambió en nada todavía) → el slot 76×76 con
      borde punteado se queda, pero con `BlinkingDots` centrado en vez del
      ícono "+" y el texto "Agregar". Frame: variante renderizada de verdad
      (no solo comentada) dentro de "Publicar (procesando fotos)", separada
      por un borde punteado y etiquetada "Variante (doc, no es parte del
      flujo)" — ver `.photo-add.is-busy` en `relevo-app.html`.
    - ninguno de los dos → el `.photo-add` normal, tocable.
    **El tile de espera es un `View`, no un `Pressable`** — sin `onPress` ni
    `accessibilityRole="button"`. `procesandoRef` ya bloqueaba un segundo tap,
    pero el tile en sí no debía invitar al toque durante la espera.
    **Por qué la combinación se movió de `ListingFormFields` a `PhotoRow`**:
    antes `ListingFormFields` hacía `eligiendoFotos ||
    fotos.some(procesando)` para un solo booleano `procesando` que solo podía
    decir "mostrar" o "esconder" — no bastaba para elegir ENTRE dos contenidos
    distintos del mismo slot. `PhotoRow` ya recibe `fotos` completo, así que
    puede derivar `hayPlaceholder` él mismo sin que se lo pasen aparte.
- **La entrada a Publicar es el FAB de Perfil**, la única que define el diseño
  (§0.6: el tab bar tiene 4 ítems, sin "+" central). **Vive en
  `(tabs)/_layout.tsx` como hermano de `<NativeTabs>`, NO dentro de
  `perfil.tsx`** — ahí se pintaba pero no recibía el toque; ver el gotcha de §9
  antes de "acercarlo a su pantalla". El layout decide mostrarlo solo cuando
  `usePathname() === '/perfil'`.
- **Asimetría declarada en Editar, no olvido:** su aviso es un toast (mismo
  `componerAviso()`, calculado una vez al terminar el intento en vez de en cada
  render), y por eso ahí el botón "Guardar" **no** se deshabilita en el caso
  determinista, a diferencia de Publicar. Un botón apagado sin un aviso
  permanente al lado que explique por qué sería un misterio, y darle a Editar un
  aviso persistente exige un frame nuevo (§0 regla 4). Volver a tocarlo
  re-muestra el toast y no gasta red: las marcadas se saltan igual.
  **Revisar cuando:** alguien reporte no entender por qué su publicación no
  guarda.
- **"Marcar como vendida" ya NO es inerte en Editar** (lo era antes de RF-07):
  navega a "¿A quién le vendiste?" del grupo Confianza, con el mismo
  `accionVenta()` que las otras dos entradas. Cablearla como un update suelto a
  `'vendida'` saltándose ese paso seguiría rompiendo RF-12.
  Y desde RF-08 esa fila **solo existe en su primer estado aquí**: al volver de
  Calificar, el refetch al foco descubre que la publicación ya es vendida y la
  pantalla rebota con su guard, así que "Cambiar comprador" nunca llega a pintarse
  en Editar. Se ofrece desde Detalle y desde la hoja de "Mis publicaciones".

Del grupo Publicar se sumaron: **`ListingPhoto`** (arriba), **`PhotoRow`**
(`.photo-row`/`.photo-thumb`/`.photo-add`/`.photo-remove`, con el contador
`N/5`) y **`ListingFormFields`**, que es EL formulario de publicación —
"Publicar" y "Editar publicación" lo comparten porque, tras actualizar el
diseño, tienen los mismos campos en el mismo orden. `FormHeader` creció con
`leading` (`'back'`/`'close'`) y `trailing` (la acción "Guardar" en `--brick`).

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
    devuelve **HTTP 200**). **Ya tiene hermano**: `scripts/probe-venta.mjs`, por
    otra razón (§3) — aquel cubre lo que la RLS de SQL no alcanza, este amarra
    una condición que vive en dos runtimes. Los dos son parte de la verificación
    de backend, no extras: ver §6.
  - **Ya se sube y se pinta.** El grupo Publicar escribe en `listing_photos` y
    `ListingPhoto` las lee por el endpoint autenticado — ver más abajo en este archivo.
- **Grupo Explorar conectado a datos reales** (7ª migración incluida:
  `listing_favorites_count`). Los mocks `src/constants/mock/{listings,campus,
  categorias}.ts` ya no existen; la capa de datos vive en `src/lib/listings.ts`,
  `src/lib/categorias.ts` y `src/lib/favoritos.ts`. Ver `explorar.md`.

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
- **`listings_insert_own` no restringe qué valor de `estado` trae un INSERT del
  cliente**, y esto es distinto del punto de arriba — aquél es sobre 0 fotos,
  este es sobre el ESTADO mismo. Medido (CLAUDE.md §3, migración
  `20260917000459`): su `with_check` es solo `user_id = auth.uid() and
  is_active_user()`, y el INSERT de `listings` está concedido a nivel TABLA, así
  que cubre la columna. Un autenticado cualquiera crea su propia fila
  directamente en cualquiera de los 5 valores del enum —incluidos `activa`,
  `vendida` y `bloqueada`— sin pasar nunca por `pendiente`. Y no hace falta un
  cliente hostil para tocarlo: el flujo ACTUAL de `publicar.ts` también termina
  en `activa` sin pasar por revisión — crea en `'pausada'` (`:307`) y la pasa a
  `'activa'` (`:366`) en cuanto las fotos suben, exactamente el camino que la
  moderación pre-publicación necesita interceptar. **Revisar cuando:** se diseñe
  el rework de `publicar.ts` para la moderación pre-publicación y su Edge
  Function. **Fix:** forzar `estado = 'pendiente'` en el `with_check` del
  INSERT, y mover la transición `pendiente → activa` a código elevado (trigger o
  Edge Function) — con el `with_check` forzado, esa transición deja de poder
  hacerla el cliente.
- **El reintento solo distingue DOS errores deterministas**, `EntityTooLarge` y
  el formato no soportado. La regla más amplia —"no reintentar ningún 4xx"— se
  evaluó y se descartó: un 401 puede ser un token en refresco, o sea
  transitorio, y reintentarlo es lo correcto. **Revisar cuando:** aparezca en
  los logs un 4xx determinista que no sea de tamaño ni de formato (un
  `AccessDenied` por suspensión a media subida, por ejemplo). **Fix:** mover el
  criterio de una lista de errores conocidos a "reintentar solo
  `StorageUnknownError` y 5xx".
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
  **Y hay un modo de fallo que esta nota no decía, medido después:** si el orden
  se invierte, `remove()` no devuelve error — devuelve **200 con una lista
  vacía**, así que el `if (error)` de `borrarFotos()` ni siquiera imprime su
  `console.warn` y el huérfano se genera **en silencio**. El mecanismo está en
  CLAUDE.md §9; no es específico de este bucket.
