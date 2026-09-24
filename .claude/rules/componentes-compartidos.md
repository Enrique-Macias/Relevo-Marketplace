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

**`Field` tiene `error` (nombre válido, `20260927000469`).** Pinta
`.field-error` bajo el campo y el borde en `--brick` (`.text-field.is-invalid`),
con el rol `Typography.fieldError`. Ese rol tiene los MISMOS valores que
`terms` a propósito, y es otro rol: aquel es letra chica gris de ayuda, este es
un error. El texto es copy PERSISTENTE, así que cualquier uso nuevo necesita su
frame antes (§0 regla 4). Hoy lo usa solo el nombre del perfil.

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
