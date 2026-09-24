---
paths:
  - "src/app/(cuenta)/**"
  - "src/app/(tabs)/perfil.tsx"
  - "src/app/(tabs)/favoritos.tsx"
  - "src/lib/perfil.ts"
  - "src/lib/perfil-publico.ts"
  - "src/lib/catalogos.ts"
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
publicación que se queda sin publicar por un fallo de subida se recupera aquí
(`pausada` hasta RF-18; desde la Ola 3, `pendiente`).

**Y desde RF-18 esta pantalla pinta DOS estados más**: "En revisión"
(`pendiente`) y "Bloqueada" (`bloqueada`), con los textos y los tonos del frame —
ningún color nuevo, ningún chip nuevo. Sobre esos dos, la hoja de acciones NO
ofrece pausar/reactivar, editar ni marcar como vendida: `listings_update_own` los
excluye de su `using` (20260917000459) igual que a `vendida`, así que queda con
una sola fila y es la destructiva. El detalle, en `moderacion.md`.

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
- **`useMisListings` ganó `refrescar()` (pull-to-refresh), gemela de
  `useListings.refrescar()`: pide la página 1 del filtro actual y reemplaza
  `items`/cursor sin vaciar ni pasar por `'loading'`.** Y de paso corrigió un
  guard de `loadMore` que nunca funcionó: comparaba `filtroPedido !==
  estadoFiltro` dentro de su propio `.then()`, pero las dos variables son la
  MISMA binding cerrada por el closure (`estadoFiltro` es un parámetro de la
  función del hook, no un ref) — la comparación nunca podía dar `false`, así
  que nunca descartaba nada. El hook ganó un `versionRef` compartido entre
  `loadMore` y `refrescar` (sube en cada reseteo por filtro y en cada
  `refrescar()` exitoso; `loadMore` lo captura antes de pedir y descarta si
  cambió) — cierra tanto el guard roto de `loadMore` como el caso nuevo de
  "un `refrescar()` reemplazó la lista mientras una página de scroll infinito
  seguía en camino", que sin esto podía duplicar tarjetas. En
  `mis-publicaciones.tsx`, el `useFocusEffect` que antes llamaba a `recargar()`
  (vacía la lista y pasa por skeleton en cada regreso de tab) ahora llama a
  este `refrescar()`: el guard de una sola vuelo (`refrescandoRef`) es lo que
  evita que el foco y el gesto de pull disparen dos cargas a la vez.
  `recargar()` se queda solo para `ErrorState.onRetry`.
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
- **Sigue sin paginar** (mismo criterio que `fetchFavoritoIds`: es la lista
  personal de un estudiante, no un catálogo), **pero desde ahora SÍ tiene
  pull-to-refresh** — la razón para no tenerlo nunca fue "es una lista
  personal", fue que nada lo pedía todavía. Un `refrescar()` hand-rolled EN
  ESTE ARCHIVO (no una función compartida: sigue siendo la única pantalla con
  este estado a mano, y extraerlo a un hook para un solo consumidor no se
  justifica) pide `fetchFavoritos(userId)` de nuevo y reemplaza `items` sin
  vaciarlo ni pasar por el skeleton — mismo criterio que
  `useListings.refrescar()`. El `useFocusEffect` que saltaba el primer foco
  dejó de llamar a `reintentar()` (la que vacía `items` a `[]` y pasa por
  `'loading'`) y ahora llama a este mismo `refrescar()`: el guard de una sola
  vuelo (`refrescandoRef`) es lo que evita que el regreso de tab y el gesto de
  pull compitan si caen casi juntos — el segundo que llegue no-opea.
  `reintentar()` se queda solo para `ErrorState.onRetry`, donde sí se quiere
  el vaciado a skeleton.
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
- **Perfil público tiene pull-to-refresh, y su refactor es más simple que el de
  "Perfil": sin `useFocusEffect` que reconciliar.** Las cuatro consultas
  (`fetchPerfilPublico`, `fetchActivasVendedor`, `fetchVentasVendedor`,
  `fetchReviews`) se extrajeron a `cargarPerfil(id, {silent?})`, mismo patrón
  frío/tibio y mismo guard de una sola vuelo (`cargandoRef`) que "Perfil" — pero
  como esta ruta REMONTA en cada navegación (arriba), el gesto de pull es el
  ÚNICO llamador en modo `silent`; el mount effect sigue siendo la única carga
  fría. `recargas` desapareció aquí también: `ErrorState.onRetry` llama a
  `cargarPerfil` directo. El `refreshControl` va solo en el `<Screen>` del
  contenido principal, no en el de la rama de error temprana — esa rama no
  tiene contenido que proteger y ya ofrece "Reintentar".
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
`fetchPerfilEditable`, `guardarPerfil` y `formatTelefonoNacional`; esta última
se fue con `20260927000470`, reemplazada por `separarE164()` de
`src/lib/validacion-perfil.ts`—. Se entra por
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
- **La universidad es FIJA y el campus sí es editable (fase 2A,
  `20260924000466`).** La universidad la asignó el servidor desde el dominio del
  correo, y `authenticated` ya no tiene UPDATE sobre `users.universidad_id`. El
  frame la pinta `.select-field.disabled` **sin chevron** y el código la pinta
  con `FixedField` (`src/components/Field.tsx`), un `View` que no se anuncia
  como botón. No es un `SelectField` con `disabled`: aquél conserva el chevron
  y significa "todavía no". El campus se elige en `CampusBottomSheet` entre los
  de esa universidad, y que no pueda ser de otra lo garantiza la base (FK
  compuesta `users_campus_universidad_fkey`), no la pantalla.
  **Historia, para no reintroducirla:** antes había una ruta hija
  `/editar-perfil/universidad` (se llamaba así y no `selector-universidad.tsx`
  por el gotcha de rutas ambiguas de más abajo) con un `_layout.tsx` y su
  contexto, porque `SelectorCatalogo` (borrado en la fase 2B, sin consumidores
  desde la 2A) hacía `router.back()` adentro y no cabía en
  un `Modal`. Desaparecieron las dos: sin ruta hija el contexto no tenía
  razón de ser, y el campus volvió al estado local del formulario.
- **Esta pantalla NO recarga al recuperar el foco**, al revés que
  `mis-publicaciones.tsx` y `(publicar)/editar/[id].tsx`: no empuja ninguna ruta
  (el campus se elige en un `Modal`), así que nunca "vuelve" a ella.
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

**El WhatsApp de cualquier país (`20260927000470`).** El `PhoneField` de esta
pantalla ganó el selector de país (`PaisBottomSheet`). Cuatro cosas que no se
ven en el diff:

- **El número guardado se SEPARA en país + nacional** con `separarE164()`,
  incluidos los `+52` que ya existían, que se precargan exactamente como antes:
  MX y "81 1234 5678" (lo vigila `probe-perfil.mjs` (viii)). Sin número, el
  default es México.
- **Cambiar de país TAMBIÉN cuenta como tocar el campo** (`telefonoTocado`):
  el mismo nacional con otra lada es otro número, y tiene que viajar en el
  UPDATE. El criterio de "tocó" sigue protegiendo al suspendido, que precarga
  vacío.
- **Pegar un número internacional** ("+34 612 34 56 78") cambia el país solo y
  deja el nacional (`paisDePegado()`).
- **Con ladas compartidas (+1, +44…)** el país que se pinta al reabrir es el
  que la metadata le asigna al número, que puede no ser el que se eligió (§3).

**Pruebas manuales que tocan en dispositivo:**
- un `+52` existente se precarga como `MX +52` / `81 1234 5678`;
- cambiar a `ES`, capturar `612 34 56 78` y guardar deja `+34612345678` en la
  base (Studio), y al reabrir se ve `ES +34`;
- pegar "+1 202 555 0123" cambia el país a Estados Unidos;
- "81 1234" pinta "Ese número no es válido para México." y apaga "Guardar";
- en el buscador, "espana" y "34" encuentran España;
- con el teclado abierto, la hoja no tapa la lista.

**Nombre válido también aquí (`20260927000469`).** Mismo criterio que
"Completar perfil" (`onboarding-auth.md`): `puedeGuardar` pide
`nombreValido(nombre)`, el `Field` recibe `error` con la variante "nombre no
válido" del frame, y `guardarPerfil()` (`src/lib/perfil.ts`) guarda
`normalizarNombre()` en vez de `.trim()`. El candado es el check; el cliente solo
adelanta su veredicto. **Una cuenta cuyo nombre guardado ya no cumpla** (en
remoto había 1 al planear, que se corrige a mano antes del push, CLAUDE.md §8
pendiente 0f) abriría esta pantalla con el error pintado y "Guardar" apagado
hasta corregirlo, que es el comportamiento correcto: guardarlo tal cual lo
rechazaría la base. **Prueba manual:** abrir Editar perfil con un nombre válido
no pinta error; cambiarlo a "Ana_2" lo pinta y apaga "Guardar".

Componentes nuevos: ninguno de UI — reusa `Field`, `PhoneField`, `SelectField`,
`FormHeader`, `CampusBottomSheet`, `SelectorCatalogo` (hoy borrado, fase 2B) y `ErrorState` tal cual. Lo
único nuevo es `SkeletonPerfilForm` (círculo de 84 + 5 cajas de campo), tercer
hermano de `SkeletonRows`/`SkeletonNotifRows` por el mismo motivo de siempre: el
esqueleto anticipa la forma de lo que viene. Y un rol de `Typography`,
`editAvatarInitials` — ojo con él, es el quinto del racimo de avatares de §2 y el
que se confunde por los dos lados.

**`OpcionCatalogo` (`{id, nombre}`) vive en `src/lib/catalogos.ts`**, y no en el
layout de onboarding donde nació: la usan el borrador de onboarding
(`(onboarding)/_layout.tsx`, para el campus) y el estado local de esta pantalla,
y dos definiciones idénticas con el mismo nombre en módulos distintos son una
invitación a que se separen. (Hubo un segundo borrador,
`(cuenta)/editar-perfil/_layout.tsx`, que se fue con la fase 2A.) El layout de
onboarding lo **re-exporta** (`export type { OpcionCatalogo }`) para no cambiar su
superficie pública. Esa sintaxis no es opcional: bajo transpilación archivo por
archivo (Babel, que es lo que corre Metro), un `export { OpcionCatalogo }` sin
`type` emitiría un re-export de un binding que no existe en runtime y reventaría
aunque `tsc` pasara — por eso van con `type` tanto el re-export como el `import
{ type OpcionCatalogo }`. Medido: el JS que Babel emite para ese layout es
**byte por byte el mismo** antes y después del movimiento. Ojo, es un tipo
distinto de `ItemCatalogo` (el de `src/components/SelectorCatalogo.tsx`, borrado
en la fase 2B), que llevaba `subtitulo` y era el del selector, no el del borrador.

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
- **Ese par de efectos se refactorizó al agregar pull-to-refresh, y el
  contador `recargas` desapareció.** Las seis consultas ahora viven en
  `cargarPerfil(id, {silent?})`, una función llamable con la misma distinción
  frío/tibio que Detalle/Perfil público: carga fría (nada en pantalla) que
  falla pinta `ErrorState`, como antes; recarga tibia (foco o gesto de pull)
  que falla NUNCA reemplaza un perfil bueno ya visible — solo el llamador
  decide si avisa. **Esto cierra un bug preexistente, no solo agrega el
  gesto:** con el `recargas`/efecto viejo, CUALQUIER falla del refresco por
  foco (`setRecargas` → efecto → `catch` → `setErrorPara`) tapaba un perfil
  bueno con `ErrorState`, porque los dos caminos —primera carga y recarga de
  foco— compartían el mismo `setErrorPara`. El guard de una sola vuelo
  (`cargandoRef`, no un contador) es lo que permite que el mount effect, el
  foco y el gesto de pull llamen a la MISMA función sin dispararse dos veces a
  la vez. El `useEffect` de montaje lleva además un `montadoRef` leído ANTES
  de la llamada — es lo que evita que `react-hooks/set-state-in-effect` lo
  marque (mismo blind spot que CLAUDE.md §9 documenta para `useListings`,
  detallado con sus tres instancias en `explorar.md`, bullet de Detalle).
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

- **Consecuencia de eso, ya CERRADA (`20260917000457`): las publicaciones de un
  suspendido ya no se quedan visibles en el feed.** `listings_select` sigue sin
  filtrar por el estado del dueño —solo esconde las `pausada` a quien no es su
  dueño—, así que durante un tiempo el catálogo pudo mostrar una publicación que
  nadie podía contactar: el comprador tocaba "Contactar por WhatsApp" y recibía
  "Esta cuenta no está disponible para contacto". No era un bug —la regla de
  negocio se cumplía— pero sí un callejón. Lo cierra un trigger sobre `users`
  que pasa a `pausada` todas las `activa` de esa cuenta en la misma transacción
  que la suspensión; el mecanismo y el porqué viven en CLAUDE.md §3, y la
  regresión en T23.
  **Lo que hay que saber desde esta pantalla es la otra mitad de la decisión:
  al levantar la suspensión las publicaciones NO se despausan solas.** El
  vendedor las reactiva a mano desde "Mis publicaciones", con el mismo toggle de
  siempre — que ya exige al menos una foto
  (`listings_enforce_activation_has_photos`). Es deliberado, no un olvido:
  despausarlas automáticamente saltaría esa validación justo en las
  publicaciones viejas que no tienen ninguna, y el vendedor se merece decidir
  qué vuelve al catálogo después de una sanción. Cero código de cliente: la
  pantalla ya hacía todo esto. Tampoco se distingue en la UI "pausada por
  suspensión" de "pausada por el usuario" — es el mismo estado, y diferenciarlo
  exigiría frame nuevo (§0 regla 4) y casi seguro una columna.

- **El pausado automático solo cubre UPDATE: una publicación creada `activa`
  para una cuenta YA suspendida se queda `activa`.** El trigger de
  `20260917000457` es `after update on public.users`, así que nada vuelve a mirar
  después del acto de suspender. Medido, en dos mitades que no pesan igual: un
  insert directo de `users` con `estado = 'suspendido'` tampoco lo dispara, pero
  eso por sí solo es inofensivo —la fila es nueva y todavía no puede tener
  publicaciones, porque `listings.user_id` es FK a `users`—; la que sí deja
  hueco es la segunda. Es la gemela exacta del insert con `estado='activa'` y 0
  fotos (`publicar-fotos.md`), incluido el motivo por el que no se cierra: hoy
  **no es alcanzable desde la app**, porque `listings_insert_own` exige
  `is_active_user()`, así que solo llega por `service_role`/Studio — un vector de
  calidad de dato de la moderación, no de seguridad, y quien lo dispararía sería
  la misma persona que está moderando. **Revisar cuando:** exista la plataforma
  de admin de RF-17, que es donde alguien podría dar de alta publicaciones fuera
  del flujo de la app, o cuando aparezca un segundo escritor de `listings` que no
  sea el cliente. **Fix:** el mismo `when` sobre un `before insert` de
  `listings`, o un `check` que niegue `estado = 'activa'` cuando el dueño no esté
  activo — y ojo, es el mismo tipo de cambio que su gemela, así que si algún día
  se cierran, se cierran juntas y con las fixtures de la suite en la mano.

- **Cambiar el avatar puede dejar el anterior huérfano en Storage.** El reemplazo
  es subir → escribir `foto_url` → borrar el anterior, y ese tercer paso es
  best-effort a propósito: propagarlo dejaría al usuario sin poder cambiar su foto
  por un fallo de red. Es el gemelo de `borrarFotos()` (`publicar-fotos.md`), con
  **un modo de fallo extra que aquel no documentaba**: si la policy de SELECT del
  bucket desapareciera, `remove()` devuelve `200` con `[]` y sin `error` —el
  mecanismo vive en CLAUDE.md §9, no aquí, porque no es específico de avatares—,
  y por eso `borrarAvatar()` compara el array en vez de solo mirar `error`. A
  diferencia de las fotos de publicación, aquí el huérfano es **como máximo uno
  por cambio de avatar**, no uno por foto. **Revisar cuando:** el costo de
  almacenamiento aparezca en la factura, o los logs muestren `[storage]` avisando
  de borrados de avatar que no afectaron nada. **Fix:** es el MISMO cron de
  barrido que ya piden las dos deudas de `publicar-fotos.md` — no es una tarea
  aparte, y cuando se haga tiene que cubrir los dos buckets.
**Foto de perfil (RF-03) construida — el círculo de las dos pantallas ya no es
inerte.** Bucket `avatars` (`config.toml` + migración `20260916000456`), el
componente `Avatar` (`src/components/Avatar.tsx`), `useFotoPerfil()` +
`guardarFotoPerfil()` en `src/lib/perfil.ts`, y las funciones de bucket en
`src/lib/storage.ts`. Cierra RF-03, el último requisito sin `✅ Implementado`.

Lo que no se ve en el diff:

- **El bucket es PÚBLICO, y esa es la decisión de la tarea — no el default.** El
  motivo por el que `listing-photos` es privado NO se traslada: allá el criterio
  de SELECT es **variable** (`estado <> 'pausada' or eres el dueño`) y un bucket
  público lo saltaría; T14 tiene una aserción dedicada a eso. Para un avatar no
  existe estado equivalente, y se verificó en el repo antes de decidirlo:
  `users_select` es `using (true)` (`20260906000438:78-79`) y
  `fetchPerfilPublico()` **no filtra por `estado`**, así que el perfil de un
  suspendido se abre igual. La única "revocación" posible de un avatar es borrar
  el objeto, y eso funciona idéntico en los dos tipos de bucket. O sea que la
  policy de SELECT de un `avatars` privado sería `bucket_id = 'avatars'` y nada
  más: una constante — ceremonia, no candado — a cambio de que **las 9
  superficies** que pintan un avatar cargaran el header `Authorization`,
  incluidas las de LISTA (reseñas de 26px, `BuyerRow` de 38px), y de que el guard
  `token !== null` que `ListingPhoto` ya documenta las hiciera parpadear a
  iniciales en cada arranque en frío.
- **Alcance honesto, medido y no supuesto:** público significa que el objeto se
  sirve por `/object/public/` **sin ninguna autenticación** a quien tenga la URL
  (medido: 200 sin `apikey` ni `Authorization`). No es descubrible —la ruta son
  dos uuids, `foto_url` solo la lee `authenticated` y `anon` no tiene un solo
  grant en el proyecto— ni **enumerable**: `list` como `anon` devuelve `[]`
  incluso con la policy de SELECT puesta, porque va `to authenticated`. Pero
  tampoco es revocable salvo borrando el objeto. El probe vigila las dos cosas,
  para no tener que volver a medirlas a mano si Storage cambia de versión.
- **Un `authenticated` SÍ puede listar las carpetas** y con eso saber quién tiene
  foto. No agrega exposición —`users.id` y `foto_url` ya están los dos en el
  `grant select` de `20260906000438:102-104`— y es el precio de que el borrado
  funcione: sin esa policy, `remove()` no borra nada **y no avisa**.
- **Son TRES policies, no cuatro, y las tres diferencias con `listing-photos` son
  deliberadas.** (1) Sin `private.is_active_user()`: un suspendido SÍ puede
  editar su propio perfil, incluida su foto — copiarlo de allá sería una
  regresión, y T22-(e) es una aserción POSITIVA que se pone en rojo si alguien lo
  "endurece". (2) Sin función de parsing de ruta: la carpeta se compara como
  TEXTO contra `auth.uid()::text`, no hay cast que pueda reventar con `22P02`, así
  que no hay nada que envolver en el `case` de
  `private.listing_id_from_object_name()`. (3) Sin policy de UPDATE: ninguna ruta
  del cliente mueve ni sobrescribe un avatar, así que no tendría consumidor —
  mover queda denegado por AUSENCIA de policy, y el probe lo dice con esas
  palabras en vez de fingir que prueba un `with_check`.
- **Nombre de archivo nuevo en cada subida** (`{user_id}/{uuid}.jpg`,
  `upsert: false`), y no una ruta estable con `upsert: true`: el bucket es
  público, así que el CDN cachearía el objeto y la foto nueva no se vería hasta
  que expirara. Un uuid nuevo es cache-busting gratis, y a cambio obliga a borrar
  el anterior — que es justo lo que le da consumidor a la policy de DELETE.
- **`users.foto_url` guarda la RUTA, no una URL**, igual que
  `listing_photos.storage_path`. El nombre de la columna miente y se queda así:
  renombrarla tocaría `database.types.ts`, `PROFILE_COLUMNS` y el diagrama de
  `docs/product-spec.md:291` sin comprar nada. Guardar la URL completa metería el
  project-ref en cada fila y volvería una migración de proyecto una migración de
  datos.
- **Sin migración de grants, verificado contra REMOTO y no solo contra el
  archivo:** `foto_url` está nombrada explícitamente en los dos grants de
  `20260906000438:104` y `:110`, ninguna migración posterior repite el
  `revoke all`, y `information_schema.column_privileges` en el proyecto remoto
  devuelve `SELECT` y `UPDATE` para `authenticated` sobre esa columna.
- **La foto se persiste AL ELEGIRLA, no al tocar "Guardar"**, al revés que
  Publicar. La diferencia tiene causa: allá la carpeta ES `{listing_id}/` y la
  policy exige que el listing exista, así que no hay dónde subir antes. Aquí la
  fila de `users` **siempre existe** (la crea `private.handle_new_user()` al
  verificarse el correo), así que no hay precondición — y diferir reintroduciría
  el huérfano que `publicar-fotos.md` ya tiene como deuda. Por eso `foto_url` NO
  entra en `CambiosPerfil`/`guardarPerfil()`, y salir sin guardar la conserva.
- **El orden subir → `update foto_url` → borrar el anterior es load-bearing.** Al
  revés, un fallo del update dejaría `foto_url` apuntando a un objeto ya borrado,
  o sea un avatar roto para siempre. Si el update falla, `guardarFotoPerfil()`
  limpia el objeto recién subido antes de propagar: es la única ventana en la que
  todavía se conoce su ruta.
- **`useFotoPerfil()` vive en `src/lib/perfil.ts` y NO importa `useToast`.**
  Ningún módulo de `src/lib/` importa un componente en runtime (solo tipos), así
  que el aviso sale por un callback `onAviso` y la pantalla decide con qué lo
  muestra. El hook es compartido porque el flujo y los cuatro textos de error son
  idénticos en las dos pantallas.
- **En "Completar perfil" el aviso va por TOAST y no por el `<Text style={error}>`
  que esa pantalla ya tiene.** Aquél es copy persistente —el usuario lo lee con
  calma— y estrenar texto ahí exigiría un frame (§0 regla 4); un toast es la
  excepción explícita de esa regla, y de paso deja el mismo copy que "Editar
  perfil".
- **El fallback del círculo es distinto en cada pantalla, y es la única de las 9
  superficies donde cambia:** "Editar perfil" cae a iniciales, "Completar perfil"
  al ícono de cámara — ahí el nombre todavía se está escribiendo, así que
  abreviarlo daría "?" o media inicial. De ahí el prop `fallback` de `Avatar`,
  mismo recurso que el de `ListingPhoto`.
- **`LADO_MAXIMO_AVATAR` es 512 y no los 1600 de las publicaciones.** El avatar
  más grande que la app pinta es el círculo de 84 pt → 252 px en 3x, y
  `[storage.image_transformation]` está comentado en `config.toml` porque es de
  plan Pro: el cliente es el ÚNICO lugar donde un avatar se puede dimensionar.
  Con 1600, cada fila de la lista de reseñas se bajaría un JPEG de 1600 px para
  pintarlo a 26.
- **No existe "quitar foto"**, porque el diseño no dibuja esa acción: cambiarla es
  reemplazarla. El `.cam-badge` se conserva con foto justamente por eso.
- **Diseño: dos variantes etiquetadas, ningún frame nuevo.** "con foto" y
  "subiendo" viven dentro de los frames "Completar perfil" y "Editar perfil",
  con el mismo recurso que `.photo-add.is-busy`. El inventario de §4 sigue en 56.
- **Verificación:** 6 aserciones nuevas en la suite (T22, autocontenida con sus
  propios `:O`/`:P`) y 7 en `scripts/probe-storage.mjs`. **Nada en T12**: esta
  tarea no crea funciones, no toca grants y no agrega ningún `EXECUTE`. Los seis
  controles negativos se corrieron uno por uno y cada uno cae en un solo sitio —
  ver la tabla en CLAUDE.md §3.

- **El avatar borrado por moderación AHORA AVISA (RF-18 Ola 4, 2026-09-21), y
  hasta entonces las iniciales volvían en silencio.** `moderarAvatar()`
  (`supabase/functions/moderar-contenido/index.ts`) borra el objeto y pone
  `foto_url` en `null` cuando Vision da `VERY_LIKELY`. El enforcement existía
  desde Ola 1.6; lo que no existía era que el usuario se enterara de POR QUÉ.
  Cinco cosas que no se ven en el diff:
  - **Cuándo se enteraba antes, por superficie, y por qué era incoherente:** en
    Perfil, al reenfocar el tab (esa pantalla refetchea en cada foco) pero sin
    explicación; en "Editar perfil", al re-entrar, tampoco; **y en el header del
    Feed, NUNCA** — pinta `profile.foto_url` de `SessionProvider`, que se lee una
    vez por `userId` y solo mueve `refreshProfile()`. O sea que la foto ya
    borrada podía seguir pintada ahí hasta reiniciar la app, servida desde el
    disco (`Avatar` usa `cachePolicy="disk"`). Cosmético y solo para el propio
    dueño —las demás superficies leen `foto_url` del servidor, que ya es
    `null`—, pero incoherente.
  - **La señal es INEQUÍVOCA, y por eso alcanza con comparar dos valores en vez
    de inventar un campo.** El cliente jamás escribe `null` en esa columna:
    `guardarFotoPerfil()` siempre escribe un path, y `guardarPerfil()` ni
    siquiera la incluye en `CambiosPerfil`. El único productor de `null` es la
    Edge Function. La detección compara lo último que la SESIÓN sabía
    (`profile.foto_url`) contra lo recién traído por `fetchPerfilPublico()`.
  - **Va en su propio efecto y no dentro del `.then` de la carga.** Ahí tendría
    que leer `profile`, que `refreshProfile()` cambia — y eso lo volvería
    dependencia del efecto que hace las SEIS consultas de la pantalla, o sea una
    recarga completa por cada aviso. Separado, el ciclo se cierra solo: tras el
    refresh, `profile.foto_url` ya es `null` y el guard corta.
  - **El guard de repetición GUARDA EL PATH AVISADO, NO UN BOOLEANO — y llegó
    ahí por un bug real, cazado en pruebas manuales el mismo día (2026-09-21).**
    La primera versión usaba un booleano (`avisadoRef`) como cinturón para la
    ventana en la que `refreshProfile()` todavía no resolvió. **Perfil es un TAB
    que no se desmonta** —lo dice el docblock de la propia pantalla, tres
    párrafos más arriba en este mismo archivo— así que ese booleano no era un
    cinturón sino un **pestillo permanente**: el primer avatar moderado avisaba,
    quedaba en `true`, y **el segundo ya no avisaba nunca**, con cualquier foto y
    cualquier timing. Con el path, cada moderación es un evento distinto (cada
    subida estrena uuid, `rutaAvatar()`) y solo se silencia la repetición del
    MISMO. Es el criterio que `Avatar.tsx` ya tenía escrito para `pathFallido`
    —"se guarda el PATH que falló, no un booleano"— y que aquí se había perdido.
    **Re-verificado a mano tras el fix (2026-09-21)**: dos eventos seguidos con
    fotos distintas y sin reiniciar la app → toast las dos veces; más el control
    negativo de un avatar limpio, que no avisa nada. Sin reiniciar entremedio es
    load-bearing: reiniciar remonta el tab y resetea el ref, o sea que la prueba
    habría pasado también con el bug viejo.
  - **La hipótesis natural al ver ese síntoma es OTRA y está descartada, así que
    conviene no volver a recorrerla:** "la sesión se estanca en `null` porque
    nadie llama a `refreshProfile()` tras subir un avatar". **Falso**:
    `editar-perfil/index.tsx` le pasa `onGuardada: refreshProfile` a
    `useFotoPerfil()`, que lo espera tras cada subida exitosa (`perfil.ts`), y
    `completar-perfil.tsx` hace lo mismo. Son CUATRO los llamadores de
    `refreshProfile()` en el repo, no uno. **Y por eso NO hay que meter el
    refresh dentro de `guardarFotoPerfil()`:** duplicaría la lectura del perfil
    en cada cambio de foto y le daría a un módulo de `src/lib/` una dependencia
    del contexto de sesión que su propio docblock declara que no tiene.
  - **El síntoma que acompaña tampoco es un segundo bug: "el header del Feed no
    muestra la foto nueva ni un instante".** Con `foto_url` apuntando a un objeto
    ya borrado, `expo-image` falla y `Avatar` cae a iniciales por su `onError`
    (`Avatar.tsx`). Desde afuera se ve **idéntico** a que la sesión tuviera
    `null`, así que ese síntoma no sirve para diagnosticar: el único observable
    que distinguía algo era la ausencia del toast.
  - **Solo en Perfil, y no también en "Editar perfil".** A esa pantalla solo se
    llega DESDE Perfil, así que Perfil corre siempre primero y deja la sesión en
    `null`; una segunda detección no podría dispararse nunca y sería código
    muerto.
  - **Un toast, así que ningún frame nuevo** — la excepción explícita de §0
    regla 4, igual que el aviso de "Completar perfil" de más arriba. Copy:
    *"Quitamos tu foto de perfil porque no pasó la revisión de contenido"*.

- **El aviso del avatar borrado se pierde si el usuario no abre Perfil, o si no
  ve el toast.** Es el límite consciente de la pieza de arriba: un toast se va a
  los 4s y no deja rastro, y la detección solo corre cuando esa pantalla carga.
  **Y hay un tercer camino por el que se pierde, más angosto y sin cerrar:** si la
  moderación alcanza a nulificar `foto_url` ANTES de que el `refreshProfile()`
  posterior a la subida lo lea, la sesión nunca llega a tener el path nuevo y la
  transición no existe para nadie. Es improbable —el veredicto tarda segundos
  (descarga del objeto + Vision) y ese refresh ocurre milisegundos después del
  `update`— pero no imposible, y desde afuera es **indistinguible** del pestillo
  de arriba: en los dos casos el único síntoma es que no sale el toast. Por eso
  la prueba manual de esta pieza tiene que ser de DOS eventos con fotos
  distintas, no de uno.
  **Revisar cuando:** ocurra cualquiera de las dos, y son dos porque la primera
  puede no llegar nunca — (1) alguien reporte que su foto de perfil desapareció
  sin explicación; (2) se modere el avatar de una cuenta que no sea de prueba,
  hoy observable **solo** en los logs de la Edge Function (`supabase functions
  logs moderar-contenido`) buscando una respuesta con `accion: 'borrar'`.
  **Y el (2) tiene una trampa medida:** un borrado EXITOSO no imprime nada — el
  único `console.warn` de ese camino es el del guard de la carrera, o sea el caso
  en que NO se nulificó `foto_url`—, y los avatares tampoco escriben en
  `listing_moderacion` (`moderacion.md` §6.4). La señal durable no existe, y esa
  ausencia es la mitad del problema: el mismo registro que haría detectable el
  disparador es el que el fix necesita. **Fix**, en este orden: (1) el frame del
  aviso persistente en `relevo-app.html` (§0 regla 4); (2) dónde vive el "ya se
  lo dijimos" —una columna en `users` o un valor nuevo de `notification_type`,
  que cuesta DOS migraciones por el `ALTER TYPE` partido, como
  `20260917000458`/`:459`—; (3) recién ahí el cliente.

- ~~**La base no ata `users.campus_id` a `users.universidad_id`**~~ **[CERRADA]
  por `20260924000466` (fase 2A)**, con el fix que esta misma entrada proponía:
  `unique (universidad_id, id)` en `campus` más una FK compuesta desde `users`,
  y además desde `listings`. Hizo falta un `check`
  (`users_campus_requiere_universidad`) que la entrada no preveía: la FK es
  MATCH SIMPLE y no se evalúa si `universidad_id` es NULL. **Por qué se cerró
  ahora y no antes:** la regla dejó de poder vivir en el cliente. La universidad
  pasó a asignarla el servidor, así que ya no hay "cambiar de universidad" que
  limpie nada. Y lo que viene detrás, la universidad de cada publicación visible
  en las tarjetas, solo da confianza si NADIE la puede falsificar. Las dos
  líneas que limpiaban el campus se fueron con los selectores de universidad.
  Aserciones: T28 (c), (c2), (c3), (d2). Texto original de la deuda, para el
  historial: No hay FK compuesta ni
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

- ~~**La lada del teléfono está fija en `+52`**~~ **[CERRADA] por
  `20260927000470`**, con el fix que esta entrada proponía: check genérico
  (`users_telefono_e164`) y selector de país en los dos frames. El disparador
  no fue una universidad fuera de México sino los estudiantes de intercambio.
  El `slice(1)` del `wa.me` no hubo que tocarlo: ya era agnóstico. Mecanismo y
  decisiones en CLAUDE.md §3 (bloque del teléfono). Texto original, para el
  historial: La lada estaba fija en `+52`, en el `check` de la base
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
