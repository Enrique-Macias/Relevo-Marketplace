# RLVO: Paleta 06 y las 7 pantallas de DESIGN-1

**Estado: APROBADO por el usuario el 2026-10-25 y promovido a la
especificación.** Desde entonces `design/relevo-app.html` ES este prototipo
(88 pantallas, Paleta 06) y se edita a mano, como siempre (CLAUDE.md §0).

Este archivo queda como registro de las decisiones: tokens, contraste,
excepciones y qué cambió respecto a la paleta anterior.

| Archivo | Qué es |
|---|---|
| `design/relevo-app.html` | La especificación, ya con la Paleta 06 |
| `design/rlvo-final-brand/` | 3 copias recoloreadas de `assets/brand/` (solo cambia el color) y su `LEEME.txt`. Las usa `relevo-app.html` |

**Historia:** durante la revisión, el prototipo vivió como
`design/rlvo-app-final-preview.html`, generado por
`design/scripts/build-final-preview.mjs` a partir del `relevo-app.html` de la
paleta anterior (commit `05264fe`). Al aprobarse, el resultado reemplazó a
`relevo-app.html` y los dos archivos se retiraron. El generador ya no sirve:
su entrada era el archivo que reemplazó.

En las secciones de abajo, "el original" es el `relevo-app.html` anterior a la
aprobación, y "las 7 pantallas nuevas" son las de DESIGN-1.

## Cobertura

**88 pantallas: las 81 de `relevo-app.html`, sin quitar ninguna, más 7 nuevas.**
El build lo comprueba: todas las etiquetas del original existen en el resultado.

| Grupo | Original | Final | Nuevas |
|---|---|---|---|
| Onboarding | 17 | 18 | Iniciar sesión (contraseña visible) |
| Explorar | 22 | 23 | Detalle (foto ampliada con zoom) |
| Publicar | 10 | 11 | Publicar (agregar fotos) |
| Cuenta | 17 | 21 | Perfil (foto ampliada) · Perfil público (foto ampliada) · Editar perfil (cambiar foto) · Editor de foto de perfil |
| Confianza | 5 | 5 | — |
| Notificaciones | 2 | 2 | — |
| Sistema | 8 | 8 | — |

La vista previa circular no es un frame aparte: va dentro del editor
("Así se verá", a 76, 44 y 26 px, los tamaños reales del avatar). Así el plan
cuadra en 7 frames nuevos.

## Tokens

Se conservan los nombres históricos (`--brick`, `--forest`, `--gold`,
`--slate`), porque todo el CSS y cientos de estilos inline los usan. Lo que
cambia es su valor.

| Token | Valor | Uso |
|---|---|---|
| `--mint-900` / `--ink` | `#183D39` | Texto principal, superficies oscuras (hero, splash, editor) |
| `--mint-700` / `--brick` / `--forest` | `#23635C` | Acción primaria, enlaces, verificado |
| `--mint-400` / `--accent` | `#78CDB5` | Rellenos, indicadores, logo sobre fondo oscuro. **Nunca texto sobre fondo claro** |
| `--mint-100` / `--brick-tint` / `--forest-tint` | `#DDF5ED` | Selección (chips, segmentos, tab activo), tintes |
| `--mint-50` / `--paper` | `#F5FAF8` | Fondo de la app |
| `--card` | `#FFFFFF` | Tarjetas |
| `--ink-soft` | `#4F6B67` | Texto secundario (derivado, ver excepciones) |
| `--ink-muted` | `#7B918D` | Placeholders y tab inactivo del original (derivado) |
| `--danger` / `--danger-bg` | `#B42332` / `#FCEBED` | Errores y acciones destructivas (excepción) |

## Contraste (WCAG, medido con la fórmula de luminancia relativa)

| Par | Ratio | Mínimo |
|---|---|---|
| `--ink` sobre `--paper` / blanco | 11.28 / 11.90 | 4.5 |
| `--ink-soft` sobre `--paper` / blanco / `--mint-100` | 5.48 / 5.78 / 5.06 | 4.5 |
| Blanco sobre `--mint-700` (CTA) | 6.98 | 4.5 |
| `--mint-700` sobre blanco (enlace) | 6.98 | 4.5 |
| `--ink` sobre `--mint-100` (chip o tab activo) | 10.40 | 4.5 |
| `--ink` sobre `--mint-400` (CTA del editor) | 6.34 | 4.5 |
| `--mint-400` sobre `--mint-900` (splash, editor) | 6.34 | 4.5 |
| `--danger` sobre blanco / `--danger-bg` | 6.51 / 5.65 | 4.5 |
| Blanco sobre `--danger` | 6.51 | 4.5 |
| `--ink-muted` sobre blanco (placeholder) | 3.35 | 3 (no es texto de contenido) |
| ~~`--mint-400` sobre blanco~~ | 1.88 | No se usa como texto |
| ~~`--mint-100` sobre `--paper`~~ | 1.08 | No se usa como texto |

`--mint-400` aparece como color de texto solo tres veces, las tres sobre
`--mint-900`: el eyebrow del hero, "Listo" del editor y "Así se verá".

## Cambios visuales respecto a `relevo-app.html`

- **Paleta:** todo `#C1440E`/`#2F6B4F`/`#D9A441`/`#5B6B78` pasa a la familia
  menta. Quedan 0 hex de la paleta anterior (comprobado con grep).
  - Los grises escritos a mano en el original (barra de estado, íconos, chrome
    del prototipo) se mapean a su equivalente verdoso: `#221F1C→#183D39`,
    `#6B6660→#4F6B67`, `#A8A29A→#7B918D`, etcétera.
- **Marca:**
  - "Relevo" pasa a "RLVO" en todo el copy visible. Los comentarios de
    documentación no cambian.
  - El wordmark de texto se reemplaza por el logo horizontal en `#183D39`.
  - La "R" de auth se reemplaza por el isotipo menta sobre `#183D39`.
  - El splash usa el logo vertical menta sobre un degradado `#183D39 → #23635C`.
  - El candado del flujo de recuperación se conserva: la identidad la marca el
    flujo (CLAUDE.md §4).
- **Selección suave:** el chip o segmento activo pasa de relleno `--ink` a
  menta claro con borde `#23635C`.
  - El tab activo gana una cápsula menta claro.
  - Las tiles elegidas de Intereses se quedan en `--ink`, porque su ícono está
    pintado en `--paper` inline.
- **Errores separados del primario:** borde de error, `.field-error`, filas
  `danger`, el botón Eliminar, el ícono de confirmaciones destructivas, el
  toast de error y `ErrorState` usan `--danger`.
  - En el original, error y CTA eran el mismo `--brick`. Con un primario
    verde, el error tiene que ser otro color.
  - "Confirmar cerrar sesión" no es destructiva: su botón y su ícono usan el
    primario (`is-neutral`).
- **Toast de éxito:** ícono menta con check `--ink`.
- **Tipografía sin cambios:** Fraunces (display) e Inter (cuerpo), por decisión
  del usuario. Estilo plano, sin el neo-brutalism de `rlvo-app.html`.

## Funcionalidades representadas (solo prototipo)

1. **Mostrar u ocultar contraseña** en los 12 campos de contraseña (11 del original y el del frame nuevo):
   - Iniciar sesión, Nueva contraseña ×2 y Completar perfil (sus 3 frames ×2).
   - Confirmar eliminar cuenta y su variante de error.
   - Cada campo es `type="password"` con un botón de ojo (`aria-label` y
     `aria-pressed`), y el ojo alterna de verdad. El frame nuevo muestra el
     estado visible.
2. **Editor de foto de perfil:**
   - Editar perfil → hoja "Tomar foto / Elegir de la galería / Cancelar".
   - Después se abre el editor: arrastrar mueve, pellizcar acerca (de 1× a 4×,
     y en escritorio Ctrl + rueda o el pellizco del trackpad), y el círculo es
     el recorte final.
   - La vista previa circular repite el recorte en vivo.
   - "Usar foto" confirma (toast), "Cancelar" descarta y "Elegir otra" carga
     un archivo local.
   - Los límites impiden que el círculo quede fuera de la imagen.
3. **Fotos ampliadas, zoom solo por gestos** (no hay ningún botón de zoom en el
   visor; comprobado):
   - Gestos: pellizco, desplazar la foto ampliada y doble toque para alternar.
     A zoom 1, deslizar cambia de foto y arrastrar hacia abajo cierra.
   - Se cierra con la X, arrastrando hacia abajo o con Esc. Las flechas del
     teclado navegan en escritorio.
   - Con la foto ampliada, el deslizamiento mueve la foto y no cambia de foto.
     Al cambiar de foto, el zoom se restablece.
   - Dónde se abre: tocar la foto del Detalle abre el visor con sus fotos.
     Tocar el avatar de Perfil o de Perfil público abre un visor de una sola
     foto, sin dots.
4. **Publicar: cámara o galería.**
   - "+ Agregar" en Publicar y en Editar publicación abre la hoja
     "Agregar fotos".
   - Se respeta el tope de 5: la galería permite selección múltiple hasta las
     que faltan, el contador `N/5` se actualiza y, al llegar a 5, desaparece
     "+ Agregar". Si se eligen de más, un toast avisa.
   - El texto de formato ("JPG o PNG; las convertimos antes de subirlas")
     refleja la normalización real de `normalizar()` (CLAUDE.md §9). Los
     estados de procesando, subiendo, revisando y error se conservan como
     estaban.
5. **Categoría `Alimentos`** (nombre exacto) en 12 frames:
   - Como tile antes de "Otros" en Ver todas, Intereses y Editar intereses, con
     un ícono de manzana en el estilo de línea del set. La rejilla de 3 queda
     con 13 tiles.
   - Como segmento en Filtros, Editar publicación, Publicar y sus 5 estados (más el frame nuevo "Publicar (agregar fotos)").
   - El Feed conserva sus 8 tiles (7 + "Más").

## Herramientas del prototipo

- El editor de estilo sigue funcionando, con los valores iniciales de la
  Paleta 06.
- Nuevo selector "Ancho del teléfono" (360, 375 original, 390 y 430 px).

## Excepciones documentadas

- **Rojo de error (`#B42332`):** fuera de la paleta a propósito. Un error verde
  se leería como éxito.
- **Neutros derivados (`#4F6B67`, `#7B918D`, `#6E8480`, `#0E2321` y otros):**
  la Paleta 06 no trae un gris para texto secundario. Se derivan de `#183D39`
  para mantener el tono, con el contraste de la tabla.
- **Tonos de piel (`#F2D6B8`, `#E9C9A8`):** solo en el retrato ilustrado de
  ejemplo de los visores y el editor, que es un placeholder y no un token.
- **"Relevo" → "RLVO" en el copy:** el resto del repo (CLAUDE.md, la app) sigue
  diciendo Relevo. Cambiarlo en la app es una decisión aparte.

## Qué falta para llevarlo a la app

1. ~~Primero se actualiza `design/relevo-app.html`~~ (hecho al aprobarse) y
   después `src/constants/theme.ts`. Las 7 pantallas nuevas pasan a ser frames
   de la especificación.
2. **`Alimentos` exige un cambio de datos:** es una fila de `categories`
   (`supabase/seed.sql` tiene 12, sin ella). Hace falta una migración o un
   seed en remoto, y su ícono en `src/components/icons/categories.tsx`.
3. Los íconos del tab bar son PNG generados (`scripts/generate-tab-icons.mjs`,
   CLAUDE.md §9) y habría que regenerarlos con el color nuevo.
4. ~~Zoom, editor de recorte y cámara/galería~~: el zoom llegó con la fase 3, y
   el editor y la hoja cámara/galería con la fase 5 (en código, confirmados por el
   usuario en iPhone y Android el 2026-10-26). La cámara NO exigió un dev build nuevo:
   `expo-image-picker` ya estaba compilado. Lo que sí espera al siguiente build
   nativo son los textos de permiso en español (`cameraPermission` en
   `app.json`).

## Validaciones corridas (2026-10-23)

- **Frames:** 88 = 81 + 7, y ningún frame del original falta (lo comprueba el
  build).
- **Originales intactos:** `shasum` antes y después de `relevo-app.html`,
  `rlvo-app.html` y los 19 archivos de `assets/brand/`, sin diferencias.
- **Colores:** 0 hex de la paleta anterior y 0 "Relevo" en el copy visible.
- **Contraste:** la tabla de arriba.
- **Navegador:** Chrome headless, por CDP:
  - 0 errores de consola y 0 imágenes rotas; el filtro dice "88 de 88
    pantallas".
  - Interacciones: el ojo alterna `password`/`text`; las hojas abren y cierran;
    el visor del Detalle abre con 4 fotos y 4 dots, la flecha avanza, un
    pellizco simulado lleva a 3×, Esc cierra y el avatar abre su visor; el
    editor mueve y hace zoom, y las 3 vistas previas siguen el recorte.
  - Anchos: a 360, 390 y 430 px, ningún `.screen` desborda.
