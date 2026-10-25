# DESIGN-1, fase 3 — ojo de contraseña y visor con zoom por gestos

Estado: **CERRADA (2026-10-25): implementada y confirmada por el usuario en iPhone y Android**, incluido el fix del pellizco (`6c053f0`). Ver "Cambios respecto al plan" al final. Solo JS: sin migraciones, sin
Supabase, sin STAGING, sin build nativo nuevo, sin cambios de `app.json`.

## Lo medido antes de escribir esto

- **Frames que mandan** (`design/relevo-app.html`):
  - El ojo: `.pw-field`/`.pw-toggle` (`:1151-1158`), en Iniciar sesión
    (`:5192`), "Iniciar sesión (contraseña visible)" (`:5205-5228`), Nueva
    contraseña (`:5332`, `:5336`), Completar perfil y sus variantes (`:6985`,
    `:6989`, `:7084`, `:7088`, `:7141`, `:7145`) y Confirmar eliminar cuenta
    (`:8981`, `:8993`). Botón de 36×36 a 6px de la orilla derecha, ícono de 18
    en `--ink-soft`, que pasa a `--mint-700` cuando está visible. Las etiquetas
    son "Mostrar contraseña" y "Ocultar contraseña", con `aria-pressed`.
  - El visor: "Detalle (foto ampliada con zoom)" (`:3109`), "Perfil (foto
    ampliada)" (`:4448`, visor `:4577-4590`) y "Perfil público (foto ampliada)"
    (`:5904`, visor `:6058`). Zoom máximo de 4 (`MAX_ZOOM = 4`, `:9585`), sin
    botones. Dos dedos acercan, un dedo desplaza la foto ampliada, el doble
    toque restablece, y ampliada el swipe horizontal mueve la foto en vez de
    cambiarla. Para el avatar, una sola foto sin dots, en `.viewer-avatar`
    (4:5, alto máximo del 78%, `:1178`).
- **Código actual:**
  - Los 6 campos de contraseña de la app ya usan `Field` con `secureTextEntry`:
    `iniciar-sesion.tsx:69`, `nueva-password.tsx:107,116`,
    `completar-perfil.tsx:281,290` y `configuracion.tsx:352` (dentro del
    `ConfirmModal`). Coinciden 1:1 con los frames.
  - `PhotoViewer.tsx` (200 líneas): un `Modal` con un `PanResponder` para
    arrastrar hacia abajo y cerrar, sobre `PhotoCarousel` (un `ScrollView` con
    `pagingEnabled`). No hay zoom. Su único consumidor es
    `detalle/[id].tsx:900`.
  - `Avatar` en `perfil.tsx:339` y `perfil-publico/[id].tsx:398`, sin
    `onPress`.
- **Native:** `react-native-gesture-handler` 2.32.0, `react-native-reanimated`
  4.5.1 y `react-native-worklets` 0.10.1 ya están en `package.json` **y en
  `ios/Podfile.lock`**, así que el dev build actual los trae compilados. Hoy no
  los usa ningún archivo de `src/` (grep: 0 resultados). No hay
  `babel.config.js`: `babel-preset-expo` agrega solo el plugin de worklets.
  **No hace falta build nativo.**

## Parte A — el ojo de contraseña

1. `IconEye` e `IconEyeOff` en `src/components/icons/index.tsx`, con los paths
   del frame (`:5192`, trazo de 1.8).
2. `Field` muestra el ojo **siempre que reciba `secureTextEntry`**:
   - Guarda un estado local `visible` (inicia en `false`) y le pasa al
     `TextInput` `secureTextEntry={secureTextEntry && !visible}`.
   - El botón es un `Pressable` absoluto de 36×36 a `right: 6`, centrado
     verticalmente sobre el input, con el ícono de 18 en `Colors.inkSoft` o
     `Colors.mint700`.
   - El input gana `paddingRight: 46`.
   - Accesibilidad: `accessibilityRole="button"`, una etiqueta que cambia
     ("Mostrar contraseña" / "Ocultar contraseña") y
     `accessibilityState={{ checked: visible }}`.
   - `hitSlop` para que el área de toque no baje de 44.
   - Respeta `editable={false}`: con el campo deshabilitado (p. ej. "Entrando…"
     o un borrado en curso), el ojo sigue funcionando. Es solo de lectura y no
     cambia nada en el servidor.
   - **Por qué en `Field` y no en un `PasswordField` aparte:** el diseño pide el
     ojo en TODOS los campos de contraseña. Así, un campo nuevo con
     `secureTextEntry` lo hereda sin acordarse, y los 6 sitios actuales no
     cambian.
3. **Riesgo que se prueba en dispositivo:** en iOS, al pasar de visible a oculto
   el sistema puede borrar el texto con la siguiente tecla. Es un comportamiento
   conocido de `secureTextEntry`, y además el texto visible activa
   autocorrección y sugerencias. Por eso el `TextInput` recibe
   `autoCorrect={false}` y `autoCapitalize="none"` cuando `secureTextEntry`
   viene puesto, y lo pruebo a mano (ver Verificación). Si el borrado aparece,
   lo traigo como decisión; no lo parcho de forma silenciosa.

## Parte B — visor con zoom por gestos

### B1. `ZoomableImage` (nuevo, `src/components/ZoomableImage.tsx`)
Una sola foto con zoom, hecha con `react-native-gesture-handler` (la API
`Gesture`) y `react-native-reanimated` (shared values, todo en el hilo de UI):

- **Pellizco:** escala de 1 a 4 (`MAX_ZOOM`, el mismo valor del prototipo),
  anclada al punto medio de los dedos.
- **Arrastre con un dedo, solo con escala > 1:** mueve la foto, limitado a que
  no se salga del cuadro (el mismo cálculo de `mx`/`my` del prototipo,
  `:9614-9615`).
- **Doble toque:** si la escala es > 1, vuelve a 1 con animación. Si es 1,
  **no hace nada**: el frame solo documenta "restablece", y acercar con doble
  toque sería comportamiento inventado (§0 regla 1).
- Al soltar, una escala < 1 rebota a 1.
- Avisa al padre con `onZoomChange(ampliada: boolean)` (`runOnJS`/`scheduleOnRN`
  de worklets) solo cuando cruza el 1, no en cada frame.
- El contenido es un `children`, así que sirve igual para una `ListingPhoto`
  (bucket privado) y para un avatar (bucket público).

### B2. `PhotoViewer` se generaliza
- **Envuelve el contenido del `Modal` en `GestureHandlerRootView`.** En Android
  un `Modal` es otra ventana nativa, y sin eso los gestos de RNGH no llegan.
  Es el gotcha documentado de RNGH; lo agrego a CLAUDE.md §9.
- **El arrastre para cerrar migra de `PanResponder` a un `Gesture.Pan`**
  vertical, para que conviva con los gestos del zoom sin pelear por el
  responder. Solo funciona con la foto en escala 1, y conserva la misma
  mecánica: umbral de 120 o velocidad, el fondo se desvanece hasta 0.45 y la
  foto escala a 0.92. Con la foto ampliada, un arrastre hacia abajo DESPLAZA la
  foto (el frame dice "un dedo desplaza la foto ampliada").
- **Swipe entre fotos solo en escala 1:** `PhotoCarousel` gana la prop
  `scrollEnabled`, y el visor la apaga mientras la foto actual está ampliada.
  Al cambiar de foto se restablece el zoom: cada página es su propio
  `ZoomableImage`, y la que sale de pantalla vuelve a 1.
- **Los dots se atenúan a 0.35 mientras hay zoom** (`.photo-viewer.is-zoomed
  .detail-dots{opacity:.35}`, `:1177`).
- Las tres salidas siguen pasando por `onCerrar(indice)`: la X, el arrastre y
  el atrás de Android.
- **La fuente de la foto queda abstracta**, porque se agrega el avatar:
  - `PhotoViewer` recibe `fotos` como hoy (Detalle no cambia su llamada).
  - Para el avatar se agrega un modo de una sola foto: `PhotoViewer` acepta
    `avatar={{ path, nombre }}` en vez de `fotos`. Se pinta con
    `urlAvatarPublica()` dentro de un `.viewer-avatar` 4:5, sin dots y sin
    `PhotoCarousel`.
  - `PhotoCarousel` gana una prop `renderFoto` o, más simple, el visor pasa
    `ZoomableImage` envolviendo cada `ListingPhoto`. Elijo lo segundo: solo se
    toca el lugar donde el carrusel arma cada página, con una prop
    `envolverFoto?: (foto, i) => ReactNode` que el hero de Detalle no usa.

### B3. Abrir el avatar
- En `perfil.tsx` y en `perfil-publico/[id].tsx`, el `Avatar` del bloque
  principal se envuelve en un `Pressable` con
  `accessibilityLabel="Ver foto de perfil"` (el `aria-label` del frame), que
  monta `PhotoViewer` en modo avatar, montado de forma condicional igual que en
  Detalle.
- **Solo si hay foto (`fotoUrl` no es null).** Sin foto, el avatar no es
  tocable. Los frames solo documentan `.has-photo`. El JS del prototipo abre un
  visor de iniciales (`:9825`), pero ampliar unas iniciales no muestra nada
  nuevo y no tiene frame propio.
- Los avatares de las reseñas en Perfil público (`:506`) NO se tocan: el frame
  no los marca como tocables.
- **Perfil público "bloqueado"/"no disponible":** el avatar se sigue viendo en
  esos estados (UGC-1), así que también se puede ampliar. No revela nada que no
  esté ya en pantalla.

## Lo que NO entra en esta fase
- Cámara o galería, el editor de avatar y `Alimentos` (fases 4 y 5).
- El splash y el ícono nativos.
- SDK 58.

## Documentación (en el mismo cambio)
- CLAUDE.md §8, inventario de componentes: la fila nueva `ZoomableImage`; en
  `Field`, el ojo automático con `secureTextEntry`; en `PhotoViewer`, el modo
  avatar y el zoom; en `PhotoCarousel`, `scrollEnabled` y `envolverFoto`.
- CLAUDE.md §9: RNGH dentro de un `Modal` necesita su propio
  `GestureHandlerRootView` (Android), y por qué el cierre dejó `PanResponder`.
- `componentes-compartidos.md` y `explorar.md`, donde hoy describen el visor.

## Verificación
1. `npx tsc --noEmit`, `npm run lint` y `git diff --check`.
2. **En dispositivo, iPhone físico y emulador de Android** (el simulador
   headless no cuenta, §6). Lo corres tú:
   - **El ojo**, en los 6 campos: alternar, escribir con el texto visible,
     volver a ocultar y seguir escribiendo (el riesgo del punto A3), y que el
     login y el guardado sigan funcionando.
   - **El visor de Detalle:** abrir en la foto 3; pellizcar hasta el máximo;
     desplazar la foto ampliada; que el swipe no cambie de foto mientras está
     ampliada; doble toque para restablecer; swipe a otra foto; cerrar con la X,
     arrastrando hacia abajo (solo en escala 1) y con atrás en Android; y que el
     hero quede en la foto donde se cerró.
   - **El avatar**, en Perfil y en Perfil público: abrir, hacer zoom y cerrar.
     Sin foto, no se abre.
3. Lo que se preserva: el tap del hero sigue abriendo el visor, el carrusel del
   hero sigue funcionando y el `ConfirmModal` de eliminar cuenta sigue sin
   salida mientras se borra.

## Commits
1. `feat: ojo de mostrar/ocultar contraseña (DESIGN-1, fase 3)`
2. `feat: visor con zoom por gestos y foto de perfil ampliada (DESIGN-1, fase 3)`

Cada uno con su documentación. Sin push hasta que confirmes en dispositivo.

## Cambios respecto al plan (al implementar)
- **No hay `ZoomableImage` ni cambios a `PhotoCarousel`.** Con un `ScrollView`
  nativo debajo del pellizco, los dos reconocedores compiten por el toque (en
  iOS gana el que dispara primero). Por eso el visor entero (pellizco, mover,
  paginar, arrastrar para cerrar y doble toque) es UN árbol de gesture-handler
  + Reanimated dentro de `PhotoViewer.tsx`, con su propia pista animada. El hero
  de Detalle sigue con `PhotoCarousel`, intacto.
- **El fallback del avatar en el visor es una caja menta vacía, no iniciales:**
  unas iniciales de 72 serían un rol de `Typography` nuevo sin frame que lo
  pida (CLAUDE.md §2). El visor solo abre con foto, así que solo se ve si la
  foto no carga.
