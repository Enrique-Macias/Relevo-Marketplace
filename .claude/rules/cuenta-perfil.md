---
paths:
  - "src/app/(cuenta)/**"
  - "src/app/(tabs)/perfil.tsx"
  - "src/app/(tabs)/favoritos.tsx"
  - "src/lib/perfil.ts"
  - "src/lib/perfil-publico.ts"
  - "src/lib/catalogos.ts"
  - "src/components/SelectorCatalogo.tsx"
---

# Cuenta: Mis publicaciones, Favoritos, Perfil, Editar perfil, Perfil público

> Movido verbatim desde `CLAUDE.md` (§8 / §8b). Esta regla carga sola cuando la
> sesión lee alguno de los archivos de `paths:`. Las reglas transversales —
> tokens de diseño (§2), esquema y RLS (§3), inventario de pantallas (§4) y los
> gotchas de infraestructura (§9) — siguen en `CLAUDE.md`, que carga siempre.

**Cuenta — 8 de 8 pantallas construidas y conectadas: grupo completo.** Las de
"Mis publicaciones" se hicieron por
necesidad, no por avanzar el grupo: conectar
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
- **Ese mismo `fotosGuardadas` destapó dos bugs latentes, INDEPENDIENTES del
  modelo atómico** — estaban ahí desde que "Editar" existe, y sencillamente
  nunca eran alcanzables sin dos guardados en la misma sesión (el modelo atómico
  no los causó, solo hizo evidente que hacía falta una fuente de verdad
  sincronizada). Los dos comparaban o borraban contra `listing.fotos`, el prop
  congelado al abrir la pantalla, en vez de lo que hay en la base ahora mismo:
  `eliminar()` podía dejar huérfano en Storage cualquier foto agregada en la
  sesión de edición actual, y `fotosCambiaron` (antes `firmaInicial`) podía
  hacer que un segundo "Guardar" reescribiera `listing_photos` —con su ventana
  sin fotos— aunque nadie hubiera tocado el set. Los tres puntos
  (`pathsOriginales`, `eliminar()`, `fotosCambiaron`) usan ahora
  `fotosGuardadas`/`firmaGuardada`.
- `SkeletonRows` (nuevo, en `Skeleton.tsx`) es el esqueleto de una lista plana —
  `SkeletonGrid` habría anticipado una forma que no es la que llega.

**"Favoritos" (+ su vacío) construida y conectada** —
`src/app/(tabs)/favoritos.tsx`, con `fetchFavoritos()` nuevo en
`src/lib/listings.ts`. No hizo falta ninguna migración: `favorites` y su RLS
ya estaban aplicadas desde el grupo Explorar. Sin componentes nuevos: reusa
`ProductCard`, `SkeletonGrid`, `EmptyState`/`ErrorState`, igual que
Feed/Búsqueda.

- **El heading es un `<Text>` suelto, NO `PageHeader`.** El frame usa
  `.page-heading` a secas, sin chevron, porque esta pantalla es raíz de tab
  —como Feed y Buscar, que tampoco lo llevan— y `PageHeader` siempre dibuja
  `router.back()`, que aquí no tendría a dónde volver.
- **La lista que se pinta se DERIVA, no se mantiene como estado propio.**
  `items` (lo que trae `fetchFavoritos`) se filtra en cada render contra
  `favoritos` (el `Set` optimista de `useExplorarState`, la misma fuente que
  ya gobierna el corazón en Feed/Búsqueda): `items.filter(l =>
  favoritos.has(l.id))`. El corazón de esta pantalla llama al mismo
  `toggleFavorito()` del contexto —no a un mecanismo propio—, así que la
  tarjeta desaparece sola en el siguiente render cuando se destoca, y
  reaparece sola si la escritura falla y el contexto revierte, porque `items`
  nunca se tocó, solo se filtró. El vacío también se calcula sobre esa lista
  derivada, no sobre `items`: destocar el último favorito aquí mismo muestra
  "Favoritos vacío" al instante, sin esperar un refetch.
- **`fetchFavoritos()` parte de `favorites` como tabla base, no de
  `listings`** —al revés que `fetchListings`/`fetchMisListings`—,
  embebiendo `listing:listings!inner(${SELECT_CARD})`, para poder ordenar el
  resultado de nivel superior por `favorites.created_at` (cuándo se guardó
  como favorito) en vez de por la fecha del listing. Filtra
  `estado = 'activa'`: `ProductCard` no tiene ningún estado visual para
  "vendida" —esa tarjeta no existe en ningún frame de grid, solo en Detalle
  y en la fila plana de Mis publicaciones—, así que mostrar una vendida aquí
  inventaría un estado fuera del diseño (§0 regla 4).
- **Sin paginación ni pull-to-refresh**, mismo criterio que
  `fetchFavoritoIds`: es la lista personal de un estudiante, no un catálogo.
  Refetch al volver al tab (`useFocusEffect` saltando el primer foco, mismo
  patrón que `mis-publicaciones.tsx`), no al gesto.
- Ver §9 sobre el hallazgo que hizo falta verificar antes de escribir esta
  query: si `order`/`limit` por `referencedTable` funcionan con una ruta
  punteada a DOS niveles de embed (`favorites → listing → fotos`), y no solo
  al nivel que ya usaba `fetchListings`.

**"Perfil público" construida y conectada.** Vista de solo lectura del perfil
de OTRO usuario — distinta de "Perfil" (el propio, ver su bloque más abajo).
Vive en `src/app/(cuenta)/perfil-publico/[id].tsx`, con `src/lib/perfil-publico.ts`
como capa de datos (`fetchPerfilPublico`, `fetchReviews`). Se entra desde el
`.seller-card` de "Detalle de publicación", que hasta ahora tenía el chevron
pero ningún `onPress`.

Seis cosas que no se ven en el diff:

- **Es la PRIMERA pantalla que renderiza `rating_promedio`.** Detalle ya lo
  trae en el embed de `vendedor` (`VENDEDOR`, `src/lib/listings.ts:40`) pero
  nunca lo pinta — un grep de `ratingPromedio`/`rating_promedio` en todo `src/`
  antes de esta tarea solo encontraba el `order('vendedor(rating_promedio)')`
  de `mejor_calificados`. Sin ningún criterio de Detalle que copiar para "0
  calificaciones", se decidió aquí: si `total === 0`, todo `.profile-rating`
  (ícono y texto) desaparece — un vendedor sin historial no debe leerse como
  "calificación de 0".
- **El botón de WhatsApp aquí NO llama a `registrarContacto()`.** Esta
  pantalla no tiene ninguna publicación en contexto y `listing_contacts.listing_id`
  es NOT NULL — el caso que ya preveía la deuda consciente de RNF-05 más abajo
  ("eso deja fuera el botón de 'Perfil público'"). El resto de
  `contactarPorWhatsapp()` es el mismo criterio que Detalle: los mismos 3
  motivos de `null`, el mismo orden de prioridad, el mismo tono neutro para el
  vendedor suspendido.
- **"En Relevo" (`mesesEnRelevo()`, `src/lib/format.ts`) no tiene rama de
  años.** El frame solo ilustra un ejemplo en meses; sin un estado en
  `relevo-app.html` con una cuenta de más de un año, no se inventa un formato
  `Na` sin evidencia (§0 regla 4).
- **Las reseñas se piden con un tope de 100, sin paginación** — mismo criterio
  que el inbox de notificaciones: una lista que crece por evento, no un
  catálogo. El `total` de `.profile-rating` sale del `count:'exact'` de esa
  misma consulta, no de `items.length`, para que el número sea correcto aunque
  la lista se corte en el tope.
- **`ratings` tiene DOS FKs a `users`** (`from_user_id`, `to_user_id`, ninguna
  con nombre explícito en la migración → default de Postgres
  `ratings_from_user_id_fkey`/`ratings_to_user_id_fkey`). Embeber `users` desde
  `ratings` sin desambiguar revienta con `PGRST201`, el mismo problema que ya
  resuelve `VENDEDOR` en `listings.ts` — aquí hace falta
  `from_user:users!ratings_from_user_id_fkey(nombre)`.
- **La RLS de `ratings` no necesitó ninguna policy nueva — verificado, no
  asumido.** `ratings_select`
  (`supabase/migrations/20260906000440_favorites_contacts_ratings.sql:163-164`,
  la misma migración donde nace la tabla en la línea 84) es
  `for select to authenticated using (true)` — sin restringir a
  `from_user_id = auth.uid() or to_user_id = auth.uid()` ni ninguna variante
  que excluya a un tercero — y el grant de la línea 188
  (`grant select, insert on public.ratings to authenticated;`) es de tabla
  completa, sin lista de columnas. Leer reseñas de alguien que no es ninguna de
  las dos partes ya estaba permitido antes de esta tarea: se deja anotado para
  que nadie vuelva a preguntárselo.

**Su header creció con la bandera de RF-14, y eso cambió la forma del
`.profile-top`.** Antes tenía dos hijos sueltos (volver + compartir) bajo
`justify-content:space-between`; con un tercero, compartir se habría ido al
centro. Los dos de la derecha van ahora agrupados en un `.nav-actions`, la
misma clase que ya usaba `.detail-nav`. **Van SIN `.round-btn`, al revés que
Detalle**: allá los íconos se pintan sobre la foto y necesitan el círculo
blanco para leerse, aquí caen directo sobre `--paper` — que es lo que
compartir ya hacía solo. La bandera abre `/reportar/[id]` con `tipo:'usuario'`.

**El gap de `.nav-actions` necesitó un override acotado, `.profile-top
.nav-actions{gap:26px}`, y NO se tocó el `gap:8px` de la clase compartida.**
Los 8px de `.nav-actions` leen bien en Detalle porque ahí cada ícono va dentro
de `.round-btn` (36px, ícono de 18px centrado): el espacio ink-a-ink real es
(36-18)/2 + 8 + (36-18)/2 = **26px**, no 8. Aquí los mismos íconos de 18px van
bare, así que el gap directo tenía que ser esos 26px para leer igual de
espaciado — subir el `gap:8px` general habría apretado más a Detalle, que ya
estaba bien. Medido contra el propio CSS del archivo, no a ojo.

**Compartir ya no está inerte: mismo patrón que Detalle, sin un constructor de
texto compartido entre los dos** (ninguno de los dos lo tenía; Detalle también
arma el suyo inline). El mensaje es `nombre + universidad + "Perfil en
Relevo"`, con `.filter(Boolean).join('\n')` porque las dos primeras partes son
nullable — un template literal habría podido imprimir "null" en la hoja de
share. Mismo criterio de "sin link" que Detalle: `compartir-deeplinks.md` documenta las DOS
pantallas en la misma entrada de deuda, no dos entradas separadas — es el
mismo motivo raíz (sin universal links/App Links) y el mismo fix futuro.

**"Editar perfil" construida y conectada.** Vive en
`src/app/(cuenta)/editar-perfil/` (tres archivos: `_layout.tsx`, `index.tsx` y
`universidad.tsx`), con `src/lib/perfil.ts` como capa de datos —creció con
`fetchPerfilEditable`, `guardarPerfil` y `formatTelefonoNacional`—. Se entra por
un `.menu-row` nuevo en Perfil. **Sin migración**: las cinco columnas ya estaban
en el grant de update y `users_update_own` ya acota a `auth.uid()`.

Es la pantalla que cierra dos huecos que no se veían: **la otra puerta del
teléfono** (`docs/product-spec.md:284` lo dice con esas palabras — hasta ahora el
único punto de captura era el gate de Publicar, así que quien ya había publicado
no tenía cómo corregirlo) y **el primer camino de código que escribe `carrera`**,
una columna que existía desde la migración inicial y que nadie llenaba: ni
"Completar perfil" la pide.

Diez cosas que no se ven en el diff:

- **`telefono` entra al UPDATE solo si el usuario TOCÓ el campo** (un `ref`,
  `telefonoTocado`), nunca por comparar el texto final contra el precargado. No es
  quisquillosidad: a un usuario **suspendido** —que SÍ puede editar su perfil,
  §3— `seller_whatsapp` le devuelve `null` aunque tenga número (valida al
  llamante), así que su campo se precarga **vacío**. Con el criterio de
  comparación, cambiar solo la carrera le habría mandado un teléfono vacío encima
  de un número real. Por lo mismo `CambiosPerfil.telefono` es `string` y no
  `string | null`: desde aquí no se borra un teléfono, y así ni siquiera es
  expresable.
- **El número se PRECARGA por la RPC, no por el select**, y funciona porque
  `seller_whatsapp` sobre uno mismo pasa sus dos validaciones (llamante activo +
  objetivo activo). No hay forma de leerlo de otro lado: sigue fuera del grant de
  columna (RNF-05).
- **Es un solo UPDATE con las cinco columnas, y NO reusa `guardarTelefono()`.**
  Aquella escribe una sola columna, correcto en Publicar; aquí partiría el
  guardado en dos statements y un fallo en el segundo dejaría el perfil a medias
  sin nada que se lo dijera al usuario. Todas están en el mismo grant
  (`20260906000438:110` + `20260910000448:62`), así que un solo statement es
  legal — pero sigue prohibido colar `correo`/`estado`/`rating_promedio`, que lo
  rechazarían entero con 42501.
- **Universidad y campus SÍ son editables**, y eso lo decide el frame: los pinta
  como `.select-field` normal, no `.select-field.disabled` — variante que el mismo
  archivo usa a 90 líneas de distancia para "Zona de entrega" de Editar
  publicación. El backend nunca lo impidió.
- **El selector de universidad es una ruta NUEVA y no la del onboarding**, y no se
  llama `selector-universidad.tsx`: dos archivos con ese nombre en dos grupos de
  primer nivel resolverían los dos a `/selector-universidad` — el gotcha de rutas
  ambiguas de más abajo. Es `/editar-perfil/universidad`. Tampoco se pudo montar
  `SelectorCatalogo` dentro de un `Modal` como `CampusBottomSheet`: hace
  `router.back()` adentro al elegir. De ahí el `_layout.tsx` con su contexto, que
  guarda SOLO universidad/campus — nombre, carrera y teléfono se quedan en el
  estado local de la pantalla, que no se desmonta al empujar el selector.
- **Esta pantalla NO recarga al recuperar el foco**, al revés que
  `mis-publicaciones.tsx` y `(publicar)/editar/[id].tsx`. Su única ruta hija
  escribe en el borrador, no en la base: un refetch al volver pisaría la
  universidad que el usuario acaba de elegir con la que sigue guardada.
- **Cambiar de universidad limpia el campus**, la misma regla que ya estaba en
  `(onboarding)/_layout.tsx` — ver la deuda de este archivo sobre por qué esa
  coherencia vive en el cliente y ahora en dos lugares.
- **El círculo de foto es INERTE a propósito** y se pinta completo, con su
  `.cam-badge`. Es un `View`, no un `Pressable`, y sin
  `accessibilityRole="button"`: si no pasa nada, no debe anunciarse como botón —
  el criterio del tile de espera de `PhotoRow`, no el de Compartir/Reportar. Subir
  la foto necesita un bucket propio (la deuda de la foto de perfil, en este archivo).
- **El toast dice "Cambios guardados" y no es copy inventado**: está en el frame
  "Toast de éxito", que usa justamente esta pantalla de fondo.
- **Ese toast tiene una SEGUNDA rama, para el suspendido que guarda su WhatsApp**
  — "Cambios guardados. Tu WhatsApp no se mostrará mientras tu cuenta esté
  suspendida", con la misma variante `'exito'` porque el guardado sí funcionó.
  Salió de una prueba en dispositivo y NO es un bug de guardado: el UPDATE pasa
  (`users_update_own` no lleva `is_active_user()`), pero al reabrir la pantalla el
  campo vuelve a estar vacío, porque `seller_whatsapp` niega el **self-call** por
  sus dos puntas a la vez —el llamante (`private.is_active_user()`,
  `20260911000449:35`) y el objetivo (`and u.estado = 'activo'`, `:39`)—, que con
  `caller = target` son la misma persona. Sin el aviso, el toast de éxito y el
  campo vacío se contradicen y lo razonable es concluir que no se guardó. La
  condición es `mandaTelefono && profile?.estado === 'suspendido'`, y esos dos
  datos ya existían: el primero es el mismo booleano que decide si la columna
  viaja en el UPDATE, y el segundo sale de `PROFILE_COLUMNS`, igual que el toast
  de "Esta cuenta no está disponible para contacto" (`detalle/[id].tsx:266`). No
  se tocó la RPC ni se agregó ninguna lectura de estado.
  **Lo que SÍ queda abierto** es el hermano de este caso: explicar el campo vacío
  **al abrir**, antes de guardar nada. Eso sería un `.notice` persistente, o sea
  copy que el usuario lee con calma, así que exige frame primero (§0 regla 4) y no
  se resolvió de paso. **Revisar cuando:** un suspendido reporte que "perdió" su
  número al entrar a Editar perfil.

Componentes nuevos: ninguno de UI — reusa `Field`, `PhoneField`, `SelectField`,
`FormHeader`, `CampusBottomSheet`, `SelectorCatalogo` y `ErrorState` tal cual. Lo
único nuevo es `SkeletonPerfilForm` (círculo de 84 + 5 cajas de campo), tercer
hermano de `SkeletonRows`/`SkeletonNotifRows` por el mismo motivo de siempre: el
esqueleto anticipa la forma de lo que viene. Y un rol de `Typography`,
`editAvatarInitials` — ojo con él, es el quinto del racimo de avatares de §2 y el
que se confunde por los dos lados.

**`OpcionCatalogo` (`{id, nombre}`) vive en `src/lib/catalogos.ts`**, y no en el
layout de onboarding donde nació: desde esta pantalla hay **dos** borradores que
eligen universidad/campus —`(onboarding)/_layout.tsx` y
`(cuenta)/editar-perfil/_layout.tsx`—, y dos definiciones idénticas con el mismo
nombre en módulos distintos son una invitación a que se separen. El layout de
onboarding lo **re-exporta** (`export type { OpcionCatalogo }`) para no cambiar su
superficie pública. Esa sintaxis no es opcional: bajo transpilación archivo por
archivo (Babel, que es lo que corre Metro), un `export { OpcionCatalogo }` sin
`type` emitiría un re-export de un binding que no existe en runtime y reventaría
aunque `tsc` pasara — por eso van con `type` tanto el re-export como el `import
{ type OpcionCatalogo }`. Medido: el JS que Babel emite para ese layout es
**byte por byte el mismo** antes y después del movimiento. Ojo, es un tipo
distinto de `ItemCatalogo` (`src/components/SelectorCatalogo.tsx`), que lleva
`subtitulo` y es el del selector, no el del borrador.

**"Perfil" (el propio) construida y conectada — cierra el grupo Cuenta (8/8).**
Vive en `src/app/(tabs)/perfil.tsx`, sin ningún archivo nuevo de datos: reusa
`fetchPerfilPublico`/`fetchReviews` (`src/lib/perfil-publico.ts`, SIN
modificar) para el bloque de avatar/nombre/rating, y
`fetchActivasVendedor`/`fetchVentasVendedor` (`src/lib/listings.ts`) para dos
de los tres stat-cards — las cuatro llamadas con el propio `session.user.id`.
La única función nueva es `fetchFavoritosCount` en `src/lib/favoritos.ts`.

Seis cosas que no se ven en el diff:

- **Reusar `fetchPerfilPublico`/`fetchReviews` para el propio usuario no es un
  atajo improvisado: la RLS ya lo permitía.** `users_select` y `ratings_select`
  son `using (true)` — la misma razón por la que "Perfil público" puede leer a
  un DESCONOCIDO ya cubre leerse a uno mismo. Eso da gratis `universidadNombre`
  (que `PROFILE_COLUMNS` de `session.tsx` no trae, solo `universidad_id`) sin
  agregar ningún join a la sesión global.
- **`favorites` no tiene columna `id`** — su PK es compuesta
  (`user_id, listing_id`), a diferencia de `listings`, sobre la que sí corren
  `fetchActivasVendedor`/`fetchVentasVendedor` con `select('id', {head:true})`.
  Copiar ese mismo patrón a ciegas sobre `favorites` habría fallado: la primera
  versión de `fetchFavoritosCount` seleccionaba `id` y se corrigió a
  `listing_id` (`count:'exact', head:true` sobre la columna que sí existe) antes
  de correr nada. Solo sirve para el propio usuario: la RLS de `favorites` es
  `user_id = auth.uid()`.
- **Son DOS efectos de carga, no uno — a diferencia de "Perfil público", al que
  le basta un solo `useEffect`.** Aquella es una ruta de Stack que REMONTA cada
  vez que se navega a ella, así que un solo efecto en `[id, recargas]` alcanza.
  "Perfil" es un TAB que nunca se desmonta mientras la sesión sigue activa, así
  que necesita el mismo patrón de dos piezas que ya usa `mis-publicaciones.tsx`:
  el `useEffect` en `[userId, recargas]` que de verdad pide los datos (y que SÍ
  dispara en el primer montaje, porque `recargas` arranca en 0) más un
  `useFocusEffect` aparte cuyo único trabajo es `setRecargas((r) => r + 1)` en
  cada foco POSTERIOR al primero — con un `useRef` que salta esa primera
  invocación a propósito, para no disparar una segunda carga sobre el mismo
  montaje que el primer efecto ya cubrió. Sin el segundo efecto, volver del tab
  Favoritos o de Editar publicación dejaría los números y la mini-grid
  desactualizados hasta cerrar y reabrir la app.
- **`MiniListingCard` no reusa `ProductCard`, y no es evitar una prop.** El
  frame de Perfil es la PRIMERA vez que el diseño pinta `.sold-badge` sobre una
  tarjeta de GRID — hasta ahora ese overlay solo existía en la fila plana de
  `MiListingRow` (`mis-publicaciones.tsx`), y esta misma sección documenta que
  `ProductCard` no tiene ese estado a propósito (Favoritos, arriba, filtra las
  vendidas en vez de pintarlas por esa razón). No es una invención: el frame
  dibuja la tarjeta con `.info` reducido a solo precio+título —sin corazón, sin
  badge de condición, sin meta de campus/fecha—, así que es una tarjeta más
  simple que `ProductCard`, no una variante suya. Se construyó como componente
  LOCAL a `perfil.tsx` (un solo consumidor), copiando el patrón de
  `ListingPhoto` + `CategoryIcon` de fallback + overlay `.sold-badge` que ya
  existía en `MiListingRow`.
- **Sin publicaciones, la sección "Mis publicaciones" desaparece entera** —
  mismo criterio que el bloque de rating en 0 (`reviews.total === 0`): no hay
  frame de "Perfil" con 0 publicaciones en el inventario de 54, así que se seguía
  un patrón ya existente en esta misma pantalla en vez de inventar uno. Con
  exactamente 1 publicación, la segunda celda del grid queda vacía (`flex:1` sin
  contenido) en vez de estirar la primera — mismo criterio de conteo impar que
  Categoría/Búsqueda.
- **"Cerrar sesión" se corrigió al construir esta pantalla, no solo se movió.**
  El placeholder la pintaba FUERA de `.menu-list`, en `Typography.emphasis`/
  `Colors.brick` (una fila roja aparte). El frame no le da ningún tratamiento
  especial: es la fila 5 de `.menu-list`, mismo `.menu-icon`/`.menu-label` que
  las otras cuatro, sin chevron (es una acción terminal, no navegación) y sin
  color de alerta. Eso se corrigió aquí porque era la primera vez que se
  construía la pantalla real contra el frame — no un cambio de comportamiento
  fuera de alcance.
  "Verificación" y "Ayuda y soporte" —sin pantalla propia en el inventario de
  54 ni en `product-spec.md`— y el engrane de `.profile-top` (ajustes) quedan
  inertes con el mismo patrón ya usado en Detalle para Compartir/Reportar/kebab:
  `onPress={() => {}}` con un comentario de una línea, no un `View` sin
  `accessibilityRole` — esa fila SÍ es un control que algún día podría hacer
  algo, a diferencia del círculo de foto de "Editar perfil"/"Completar perfil".

Componentes nuevos: `SkeletonPerfil` (círculo 76 + 3 cajas de stat + 2 tarjetas
de grid + 5 filas de menú — cuarto hermano de `SkeletonRows`/
`SkeletonNotifRows`/`SkeletonPerfilForm`, mismo motivo de siempre), `IconSettings`
e `IconHelpCircle` (el segundo, distinto de `IconAlertCircle`: círculo + `M12
16v-4M12 8h.01`, no la variante de exclamación), y un rol de `Typography`,
`profileWordmark` (`.wordmark` con el override inline `font-size:20px` del
frame "Perfil" — mismo valor numérico que `otp`, pero rol separado a propósito,
mismo criterio que `campusChip`/`buttonWhatsapp`).

- **"Mis publicaciones" construida y conectada** — cierra el callejón sin salida
  que había creado conectar Publicar (se podía pausar desde Editar y después la
  publicación no era alcanzable desde ninguna parte). `fetchMisListings()` /
  `useMisListings()` en `src/lib/listings.ts`, pantalla en
  `(cuenta)/mis-publicaciones.tsx`, entrada por un `.menu-row` en Perfil. Ver
  `publicar-fotos.md`. Es también lo que desbloqueó el modelo atómico de publicación.

- **RF-13 completo: el botón de WhatsApp abre el número REAL del vendedor**
  (migración `20260910000448`). Se cerró el "HUECO CONOCIDO" que
  `docs/product-spec.md` arrastraba desde el principio. Cuatro cosas que no se
  ven en el diff:
  - **El gate vive en Publicar, NO en el onboarding.** Exigir el teléfono en
    "Completar perfil" le habría cerrado el Feed a quien solo quiere comprar, y
    habría bloqueado a toda cuenta existente. El número no hace falta para
    navegar, hace falta para vender: no se puede publicar sin él.
  - **Y por eso la captura vive en la MISMA pantalla.** Bloquear en Publicar con
    la única captura en el onboarding —por donde toda cuenta existente ya
    pasó— habría dejado al usuario tocando el FAB, bloqueado y sin a dónde ir
    hasta que exista "Editar perfil". Es el callejón sin salida que este mismo
    documento describe para "Mis publicaciones". El campo aparece solo cuando
    `tiene_telefono` es false y desaparece al guardarse.
  - **El campo NO se agregó a "Completar perfil"**, ni siquiera como opcional:
    un comprador lo saltaría, así que el gate de Publicar tendría que existir
    igual, y a cambio costaba tres frames más estado nuevo en el borrador de
    onboarding. Su casa es "Editar perfil", cuyo frame YA lo tenía —adelantado a
    propósito para no hacer dos pasadas al HTML— y que **ya está construida**
    (en este archivo): ahí el número se precarga por la misma RPC
    `seller_whatsapp` y se edita, que es lo que por fin le da salida a quien ya
    publicó con un número equivocado.
  - **El chequeo de suspensión vive en la RPC**, y ese es el único lugar donde
    esa regla se cumple — ver §3, que explica por qué `listing_contacts` no
    alcanzaba. Desde `20260911000449` valida las **dos** puntas: ni un
    suspendido contacta, ni se le contacta a él.

- **Consecuencia abierta de eso, y es el gancho a una tarea que NO está hecha:
  las publicaciones de un suspendido siguen visibles en el feed.**
  `listings_select` no filtra por el estado del dueño (solo esconde las
  `pausada` a quien no es su dueño), así que desde este cambio el catálogo
  puede mostrar una publicación que nadie puede contactar: el comprador toca
  "Contactar por WhatsApp" y recibe "Esta cuenta no está disponible para
  contacto". No es un bug —la regla de negocio se cumple— pero es un callejón
  para el comprador. Cerrarlo es **pausar las publicaciones al suspender la
  cuenta**, y eso es decisión de producto antes que técnica (¿automático con un
  trigger sobre `users` que escribe en `listings`, o revisión manual de un admin
  desde Studio?, ¿y qué pasa al reactivar: se despausan solas o no?). Se trata
  aparte, con su propio plan.

- **La foto de perfil sigue sin poder subirse, y desde "Editar perfil" ya no es
  "fuera de alcance del onboarding" sino deuda con disparador.** Las dos
  pantallas que la dibujan —"Completar perfil" y "Editar perfil"— pintan el
  `.photo-upload-circle` con su `.cam-badge` y **ninguna de las dos responde al
  toque**: son `View`, no `Pressable`, y sin `accessibilityRole="button"`, para
  no anunciar como botón algo que no hace nada. `users.foto_url` existe desde la
  migración inicial y **nadie la escribe ni la lee** (el avatar se dibuja siempre
  con iniciales). Lo que falta NO es el picker —`elegirFotos()`/`normalizar()` de
  `src/lib/foto-picker.ts` sirven igual— sino un **bucket propio**: el de
  `listing-photos` no se puede prestar, porque sus cuatro policies autorizan por
  carpeta `{listing_id}/` contra el dueño de una publicación, y un avatar no tiene
  publicación. **Revisar cuando:** se pida de verdad, o cuando el avatar de
  iniciales se vuelva un problema de confianza entre desconocidos. **Fix:** bucket
  `avatars` (¿público o privado? — si es privado, todo lo que pinte un avatar pasa
  por `ListingPhoto`-style con header `Authorization`), sus policies espejo
  acotadas a `{user_id}/`, su bloque en la suite, y `foto_url` escrito desde estas
  dos pantallas. Va en su propio plan por fases chicas (§6).
- **La base no ata `users.campus_id` a `users.universidad_id`, y quien sostiene
  esa coherencia es el cliente — ahora en DOS lugares.** No hay FK compuesta ni
  `check` que impida guardar un campus de otra universidad: son dos FKs sueltas
  (`20260906000438_users_profiles.sql:11-12`). Lo que lo evita es la línea que
  limpia el campus al cambiar de universidad, que vivía solo en
  `(onboarding)/_layout.tsx` y ahora también en
  `(cuenta)/editar-perfil/_layout.tsx`. Es pre-existente —esta pantalla no lo
  introdujo, solo lo duplicó— y es el mismo tipo de acoplamiento que §3 documenta
  para `congelada()` ↔ el `using` de `listing_sales_update_seller`: dos copias de
  una regla que al desincronizarse no dan ningún error, solo dejan un perfil
  incoherente. **Revisar cuando:** aparezca un TERCER escritor de ese par, o se
  vea en remoto una fila de `users` con un campus que no es de su universidad.
  **Fix:** `unique (universidad_id, id)` en `campus` + FK compuesta desde `users`
  —un `check` con subconsulta no es legal en Postgres—, con su aserción en la
  suite; de paso vuelve imposible el caso en vez de improbable.

- **La lada del teléfono está fija en `+52`**, en el `check` de la base
  (`users_telefono_e164_mx`), en el prefijo inerte del campo y en el
  `slice(1)` que arma el `wa.me`. Hoy el catálogo es mexicano y nadie pidió
  otra cosa, así que un selector de país sería UI que nadie usa. El dato ya se
  guarda en E.164, o sea que el costo futuro es acotado. **Revisar cuando:** se
  abra la app a una universidad fuera de México. **Fix:** alterar el `check` +
  agregar el selector de país a los frames de "Publicar (falta teléfono)" y
  "Editar perfil" (los dos ya están construidos y ya tienen el campo; les
  faltaría el selector). Del lado del código es **un solo sitio**: las dos
  pantallas montan el mismo `PhoneField`, así que el `+52` inerte vive una sola
  vez — lo caro es el `check` de la base y los frames, no el componente.
- **El teléfono es no-enumerable-en-bloque, no inaccesible.** `seller_whatsapp`
  evita que un autenticado se baje el directorio entero en un request, que es lo
  que pide RNF-05 — pero `users.id` sí está en el grant de select, así que un
  cliente hostil podría iterar ids y llamarla N veces. Son N requests
  observables y limitables contra 1 invisible. **Revisar cuando:** aparezcan
  llamadas masivas a esa RPC en los logs del proyecto. **Fix:** rate limit, o
  anclar la firma a un `listing_id` que el llamante esté viendo (ojo: eso deja
  fuera el botón de "Perfil público", que no tiene publicación en contexto).
