---
paths:
  - "src/components/**"
---

# Componentes compartidos: qué existe y qué no unificar

> Movido verbatim desde `CLAUDE.md` (§8 / §8b). Esta regla carga sola cuando la
> sesión lee alguno de los archivos de `paths:`. Las reglas transversales —
> tokens de diseño (§2), esquema y RLS (§3), inventario de pantallas (§4) y los
> gotchas de infraestructura (§9) — siguen en `CLAUDE.md`, que carga siempre.

Componentes reusables ya construidos aquí (no los reconstruyas):
`ProductCard`, `CategoryTile`, `PageHeader`, `EmptyState`,
`SegmentedControl`, `Chip`, `ActiveFilterChip`, `SheetScreen`,
`RoundIconButton`, `PhotoCarousel`/`PhotoDots`, `PhotoViewer`,
`HojaAccionesListing`,
más los íconos de categorías. Al conectar datos reales se
sumaron tres del grupo Sistema, transcritos de sus frames: `SkeletonGrid` /
`SkeletonCatGrid`, `ErrorState` (con "Reintentar") y `Toast` (`ToastProvider`
montado en el `_layout.tsx` raíz, con variantes de éxito y error). Se
construyeron ahora porque conectar la red hace alcanzables por primera vez los
estados de carga, fallo y aviso no bloqueante. `SheetScreen` es una
pantalla de Stack con `presentation:'transparentModal'` **declarada en el
Stack raíz** (`src/app/selector-campus.tsx`, `src/app/filtros.tsx` — no
dentro de `(explorar)/`, ver el gotcha de sección 9) — es distinto de
`CampusBottomSheet.tsx` (un `Modal` de RN real, usado solo por Completar
perfil en Onboarding); no unificar ambos, sirven casos de uso distintos ya
documentados en sección 5.

**`HojaAccionesListing`** (`src/components/HojaAccionesListing.tsx`) es la hoja
de acciones de una publicación (pausar/reactivar, editar, marcar como
vendida/cambiar comprador, eliminar) — extraída de un componente local
(`HojaAcciones`) que antes vivía solo en `mis-publicaciones.tsx`, cuando ganó
un segundo consumidor: el kebab de "Detalle (vista vendedor)"
(`confianza-ventas.md`/`explorar.md`). Mismo criterio que `CampusBottomSheet`
frente a `SheetScreen` (arriba): es un `Modal` de RN, no una ruta de Stack,
porque quien la abre ya tiene el estado y la venta de la publicación en la
mano — una ruta solo recibiría params serializables y obligaría a
re-fetchear o inventar un canal de vuelta. Calcula internamente
`puedeAlternarPausa()`, `puedeEditarListing()` (`src/lib/listings.ts`) y
`accionVenta()` (`src/lib/confianza.ts`) a partir de `estado`/`venta`: las
decisiones de qué fila mostrar viven en el componente, nunca recalculadas en
cada pantalla que lo monta. Sus dos consumidores difieren en lo que pasa
DESPUÉS de cada acción (optimista+rollback y filtrar un array en la lista;
refetch silencioso o `router.back()` en Detalle), no en cuál fila se ofrece
— ver `confianza-ventas.md`.

**`Field` tiene `error` (nombre válido, `20260927000469`).** Pinta
`.field-error` bajo el campo y el borde en `--brick` (`.text-field.is-invalid`),
con el rol `Typography.fieldError`. Ese rol tiene los MISMOS valores que
`terms` a propósito, y es otro rol: aquel es letra chica gris de ayuda, este es
un error. El texto es copy PERSISTENTE, así que cualquier uso nuevo necesita su
frame antes (§0 regla 4). Hoy lo usa solo el nombre del perfil.

**`PhoneField` ya no pinta un `+52` inerte (`20260927000470`)**: recibe `pais`
(el `Pais` de `src/lib/paises.ts`), `onPaisPress` y `error`, y el país es un
`Pressable` (`.phone-country`: ISO en 600, lada y chevron en `--ink-soft`,
separador `--line`). **Sin bandera emoji**, ver CLAUDE.md §3. El placeholder
"81 1234 5678" solo se pinta con México: para otro país no hay ejemplo en el
frame y no se inventa. **`PaisBottomSheet` es hermano de `CampusBottomSheet`,
no una variante, y no se unifican**: su lista es estática (245 filas, sin
carga ni error) y va en `FlatList`; el de campus carga por red y son pocas
filas.

Al migrar al modelo atómico se sumaron dos más, ambos por EXTRACCIÓN y no
escritos de cero:
- **`Notice`** (`.notice`) — el aviso persistente, sacado tal cual de
  `creada.tsx`. Es hermano del `Toast`, no una variante: el toast se va a los 4s
  y este trae una acción, así que irse mientras se lee es justo lo que no debe
  hacer.
- **`BlinkingDots`** (`.splash-dots`) — los 3 puntos que ya vivían dentro de
  `(onboarding)/splash.tsx`. Son el ÚNICO indicador de espera del sistema de
  diseño, así que el botón "Subiendo imágenes" los reusa en vez de estrenar un
  spinner. Que funcionen sobre `--brick` no es suerte: `.splash-dot` es
  `--paper` al 50%, el mismo color del texto de `.primary-btn`.
  **Ganó una prop opcional `dotColor` en la fase 2C** (default: el mismo
  `--paper` al 50% de siempre, así que los consumidores existentes —Splash,
  "Publicar (subiendo imágenes)"/"(revisando)"— no cambian). La necesitó
  "Selector de campus (detectando ubicación)": ahí los puntos van sobre
  `--paper`, no dentro de un botón `--brick`, y necesitan el color opuesto
  para leerse.

Y **`PrimaryButton` creció con `busy`**, que NO es `disabled` con otro nombre:
`disabled` (0.45) dice "todavía no puedes", `busy` dice "está pasando" y va a
color pleno — bajarlo apagaría los puntos que comunican el avance.

- **`ErrorState` promete "Reintentar" aunque no haya nada que reintentar.** Su
  `PrimaryButton` lleva el label hardcodeado (`ErrorState.tsx:37`), sin prop para
  cambiarlo, así que el guard de `esDueno` de `editar/[id].tsx` dice "Reintentar"
  y ejecuta `router.back()`. Es pre-existente y se detectó al construir RF-08; el
  guard nuevo de vendida lo esquivó usando `EmptyState` sin botón, que además es
  el criterio correcto (§4: la única acción posible es volver, y eso ya es el
  chevron del header). **Revisar cuando:** aparezca un tercer consumidor de
  `ErrorState` cuyo fallo tampoco sea reintentable, o alguien reporte que el botón
  no hace lo que dice. **Fix:** una prop `actionLabel` con default `'Reintentar'`,
  o migrar ese guard a `EmptyState` como el de vendida — pero el copy del botón es
  persistente, así que el frame va primero (§0 regla 4).

**`CategoryTile` ganó `selected` opcional (`20260930000475`)**, y es
estrictamente aditivo:
- Sin la prop, la tile se ve, se toca y se anuncia igual que siempre: el Feed y
  "Ver todas" navegan.
- Con la prop es una casilla: `accessibilityRole="checkbox"` y
  `accessibilityState.checked`.
- Seleccionada lleva fondo y borde `--ink` y ícono y texto `--paper`
  (`.cat-item.selected`, el `active` de siempre del sistema).

**`CategoriasSelector` (nuevo)** es la rejilla de 3 de selección múltiple de
"Intereses" (onboarding) y "Editar intereses" (Cuenta). Es presentacional: el
set y el `onToggle` son del dueño, y `alternar()` devuelve un `Set` nuevo sin
mutar. **No se unifica con "Ver todas (categorías)"** aunque la geometría sea
la misma (gap 10 y relleno de la última fila): esa pantalla navega y esta
elige.

**`AuthSub` ganó `style` opcional**, igual que `AuthHeadline`. Lo pide el
frame "Intereses", que baja su `margin-bottom` a 20.
