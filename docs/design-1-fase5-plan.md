# DESIGN-1, fase 5: cámara o galería, y editor de foto de perfil

Estado: **APROBADO (2026-10-26), con D1-D4 en su primera opción.** Implementada en el código (2026-10-26), confirmada por el usuario en iPhone y Android (2026-10-26).

Alcance: los 3 frames de DESIGN-1 que la app todavía no tiene, "Publicar
(agregar fotos)", "Editar perfil (cambiar foto)" y "Editor de foto de perfil".
Los otros 4 llegaron en la fase 3. Sin migraciones, sin Supabase, sin Edge
Functions y sin SDK 58.

## Lo medido antes de escribir esto

**Frames** (`design/relevo-app.html`):
- "Publicar (agregar fotos)" (`:3577`). Es la hoja `.sheet-card` titulada
  "Agregar fotos", con estas piezas:
  - la fila "Tomar foto" (`:3683`);
  - la fila "Elegir de la galería", con la línea "Puedes elegir hasta 4 más"
    (`:3690`);
  - la `.sheet-note` "Llevas 1 de 5 fotos. JPG o PNG; las convertimos antes de
    subirlas." (`:3695`);
  - el botón `ghost-btn` "Cancelar".

  Según el propio frame, aplica también a Editar publicación.
- "Editar perfil (cambiar foto)" (`:7497`, la hoja en `:7632-7660`). Se titula
  "Foto de perfil" y trae Tomar foto, Elegir de la galería (con la línea
  "Después la ajustas en un círculo") y Cancelar.
- "Editor de foto de perfil" (`:7667`). Pantalla oscura (`.crop-device`,
  `--mint-900`) con estas piezas:
  - el header: "Cancelar", "Ajusta tu foto" y "Listo";
  - el escenario cuadrado con la máscara circular, de diámetro 80 % del ancho
    (`.crop-mask`, `:1195`);
  - la pista "Arrastra para mover · pellizca para acercar";
  - "Así se verá", con 3 vistas previas de 76, 44 y 26 px;
  - los botones "Elegir otra" y "Usar foto".

  El JS del prototipo (`:9942-10032`) define el comportamiento:
  - el zoom va de 1 a `MAX_ZOOM` = 4 (`:9585`);
  - el paneo se limita a que el círculo siempre quede cubierto por la imagen;
  - "Listo" y "Usar foto" confirman lo mismo;
  - "Cancelar" descarta.

**Código:**
- `src/lib/foto-picker.ts:205-256` (`elegirFotos`) solo abre la galería
  (`requestMediaLibraryPermissionsAsync` y `launchImageLibraryAsync`).
  Normaliza a JPEG con `LADO_MAXIMO` 1600 o, para el avatar,
  `LADO_MAXIMO_AVATAR` 512 (`:70`, `:84`).
- Publicar llama a `elegirFotos` desde `agregarFoto()` en
  `src/app/(publicar)/nueva.tsx:218-248`, y Editar publicación desde
  `src/app/(publicar)/editar/[id].tsx:287`. El botón "Agregar" es el
  `onAgregar` de `src/components/PhotoRow.tsx:192`.
- El avatar se cambia en `useFotoPerfil()` (`src/lib/perfil.ts:291-338`). El
  hook llama a `elegirFotos(1, …, {ladoMaximo: 512})` y después a
  `guardarFotoPerfil()` (`:93`). **Lo usan DOS pantallas:**
  - Editar perfil (`src/app/(cuenta)/editar-perfil/index.tsx:170`, `:312`);
  - Completar perfil (`src/app/(onboarding)/completar-perfil.tsx:109`, `:225`).

  El frame solo dibuja la primera.
- Hoy no hay recorte: el avatar se sube con la proporción original y `Avatar`
  lo recorta en círculo al pintarlo (lo que se ve depende del centro de la
  foto).
- `HojaOpciones` (`src/components/HojaOpciones.tsx`) ya trae el cascarón
  (backdrop, handle, header con ✕ y `StatusRow`). Le faltan la línea
  secundaria por fila (`StatusRow` ya tiene `sub`), la `.sheet-note` y el
  "Cancelar".
- `PhotoViewer` ya resolvió los gestos dentro de un `Modal` con su propio
  `GestureHandlerRootView` (CLAUDE.md §9). El editor reusa ese patrón.

**Build nativo (lo que decide si hace falta compilar):**
- `expo-image-picker` 57.0.20 ya trae `requestCameraPermissionsAsync` y
  `launchCameraAsync` (`build/ImagePicker.d.ts:19`, `:75`). Los dos son JS
  sobre el mismo módulo nativo que ya está compilado.
- iOS: el `Info.plist` del dev build ya tiene `NSCameraUsageDescription`, pero
  con el texto por defecto del plugin, en inglés: "Allow $(PRODUCT_NAME) to
  access your camera" (`withImagePicker.js`, `CAMERA_USAGE`). Eso es porque
  `app.json:53-56` solo fija `photosPermission`.
- Android: el manifest del paquete ya declara `android.permission.CAMERA`
  (`android/src/main/AndroidManifest.xml`).
- **Conclusión: la cámara funciona en los dev builds actuales sin compilar.**
  El texto en español del permiso sí exige un build nativo nuevo, y tiene que
  estar antes de TestFlight o de tiendas.
- **Hallazgo de paso:** el plugin agrega también `NSMicrophoneUsageDescription`
  (también en el `Info.plist`) y `android.permission.RECORD_AUDIO`, porque
  `microphonePermission` no está en `false`. RLVO no graba video ni audio, así
  que es un permiso declarado sin uso. Ver D3.

## Propuesta

### 1. Origen de la foto: cámara o galería (`src/lib/foto-picker.ts`)
- `elegirFotos()` gana `opciones.origen: 'galeria' | 'camara'`, con
  `'galeria'` como valor por defecto, que es el comportamiento de hoy.
- Con `'camara'`:
  - pide el permiso con `requestCameraPermissionsAsync()` y, si se niega,
    lanza un `PermisoCamaraDenegadoError` nuevo, hermano de
    `PermisoDenegadoError`;
  - abre `launchCameraAsync({mediaTypes: ['images'], quality: 1})`, una sola
    foto;
  - el resultado pasa por el MISMO filtro de formato, los mismos callbacks
    (`onPlaceholders` y `onFotoLista`) y la misma `normalizar()`. Publicar no
    distingue de dónde vino la foto.
- Toasts nuevos (los toasts no requieren frame, §0 regla 4): "Necesitamos
  acceso a tu cámara para tomar la foto" y "No pudimos abrir la cámara".

### 2. `HojaOrigenFoto` (componente nuevo)
- Usa el cascarón de `HojaOpciones` (Modal de RN, backdrop y handle). No es
  una variante de él, porque añade la nota y el "Cancelar".
- Props: `titulo`, `subGaleria`, `nota?`, `onCamara`, `onGaleria` y
  `onCerrar`. Las dos filas usan `StatusRow` con `sub`, el chevron y los
  íconos de cámara y galería del frame (los agrego a `icons/` si no existen).
- **iOS no presenta el picker mientras el Modal se está cerrando.** Al elegir
  una fila, la hoja se cierra y el picker se abre en `onDismiss` del `Modal`
  (iOS); en Android se abre directamente. Lo pruebo en los dos dispositivos.
  Si `onDismiss` no basta, uso un `InteractionManager` como respaldo, y lo
  digo si hace falta.
- Publicar y Editar publicación:
  - "Agregar" abre la hoja "Agregar fotos";
  - el texto de las filas sale del estado real: "Puedes elegir hasta N más" y
    "Llevas X de 5 fotos. JPG o PNG; las convertimos antes de subirlas.";
  - el tope de 5, los placeholders y los errores no cambian.

### 3. Editor de foto de perfil (`EditorFotoPerfil`, componente nuevo)
- Es un `Modal` a pantalla completa con su `GestureHandlerRootView` (gotcha de
  §9). Arrastrar mueve (`Gesture.Pan`) y pellizcar hace zoom de 1 a 4
  (`Gesture.Pinch`, simultáneo), con Reanimated y los mismos límites del
  prototipo: el círculo siempre queda cubierto.
- "Así se verá" pinta 3 vistas previas (76, 44 y 26) con la misma
  transformación escalada.
- **La geometría va en un módulo PURO (`src/lib/recorte.ts`, sin imports).**
  Convierte `{escala, x, y}` del escenario a un rectángulo cuadrado en
  píxeles de la imagen (`originX`, `originY`, `width` y `height`), acotado a
  los bordes. Lo cubre `scripts/probe-recorte.mjs`, que no necesita stack (el
  mismo criterio que `probe-ubicacion.mjs`):
  - el centro con zoom 1;
  - los bordes;
  - el zoom 4;
  - fotos horizontales y verticales;
  - el redondeo.

  Llevará controles negativos.
- "Listo" y "Usar foto" aplican `ImageManipulator` con `crop(rect)` →
  `resize(512)` → JPEG 0.8 y, después, el `guardarFotoPerfil()` de hoy, que
  queda sin cambios. "Cancelar" descarta sin subir nada. "Elegir otra" abre la
  galería y reinicia el encuadre.
- **Flujo nuevo de `useFotoPerfil()`:**
  1. `cambiar()` abre la hoja "Foto de perfil".
  2. Al elegir el origen, toma o elige UNA foto, normalizada a 1600 (no a 512,
     para que el recorte conserve calidad).
  3. Abre el editor.
  4. Al confirmar, recorta, la deja en 512 y guarda.

  El guard `enCurso` y los avisos de hoy se conservan, y `subiendo` solo es
  verdadero mientras se guarda.
- El avatar guardado pasa a ser CUADRADO (512×512). `Avatar` ya lo pinta en
  círculo, así que no cambia nada visual fuera del editor.

### 4. Diseño primero (§0 regla 4)
En `design/relevo-app.html` se anotan, como variantes etiquetadas y no frames
nuevos:
- que la hoja "Foto de perfil" y el editor aplican también a Completar perfil
  (D1);
- el texto para cuando queda 1 lugar: "Puedes elegir 1 más" (D2).

Después se propaga al código. El conteo de 88 frames no cambia.

### 5. `app.json` (exige un build nativo nuevo; ver D3)
- `"cameraPermission": "RLVO usa tu cámara para que tomes fotos de lo que
  vendes y de tu perfil."`
- `"microphonePermission": false`, si se aprueba D3.

## Decisiones (propongo la primera opción de cada una)
- **D1. ¿Completar perfil también usa la hoja y el editor?**
  - Propongo que sí: es el mismo hook, y dejarlo fuera obligaría a mantener
    dos caminos.
  - La otra opción es que solo los use Editar perfil, como dibuja el frame.
- **D2. Texto con 1 lugar disponible.**
  - Propongo "Puedes elegir 1 más".
  - La otra opción es dejar el plural del frame.
- **D3. Permisos nativos en `app.json`.** Propongo cambiar en esta fase los
  dos:
  - el texto de la cámara en español;
  - `microphonePermission: false`, que quita un permiso sin uso.

  Los dos se aplican en el próximo build nativo (EAS y `expo run:ios`). Para
  probar no hace falta compilar, porque la cámara ya funciona con el texto en
  inglés. La otra opción es dejar `app.json` para la tarea de lanzamiento.
- **D4. Marca en el texto del permiso.**
  - Propongo "RLVO" en el de la cámara.
  - `photosPermission` dice "Relevo". Lo dejo igual salvo que quieras
    unificarlo ahora, porque también exige build.

## Verificación
1. `node scripts/probe-recorte.mjs`, en verde, con sus controles negativos
   uno a uno.
2. `npx tsc --noEmit`, `npm run lint` y `git diff --check`, limpios.
3. Los probes que tocan fotos y avatar siguen en verde: `probe-storage` (41) y
   `probe-moderacion` (166). El cambio es solo de cliente.
4. En dispositivo, lo hace el usuario (el simulador headless no cuenta, §6),
   en iPhone y Android:
   - **Publicar:**
     - la hoja se abre;
     - la cámara toma una foto y la sube;
     - la galería sigue con el tope de 5;
     - negar el permiso da el toast correspondiente;
     - el texto "hasta N más" cambia con el número de fotos.
   - **Editar publicación:** lo mismo.
   - **Editar perfil y Completar perfil:**
     - la hoja se abre;
     - la cámara y la galería llevan al editor;
     - mover, pellizcar y los límites funcionan;
     - las vistas previas se ven;
     - "Elegir otra" cambia la foto;
     - "Cancelar" no cambia nada;
     - "Usar foto" guarda y el avatar se ve recortado como en el círculo.
   - En los dos, que el picker sí se abra después de cerrar la hoja (el riesgo
     del Modal en iOS).
5. Documentación:
   - `CLAUDE.md` §4: los 3 frames ya están en la app;
   - §8, el inventario de componentes: `HojaOrigenFoto` y `EditorFotoPerfil`;
   - §6: el probe nuevo, en un paso 17;
   - `design/RLVO_FINAL_PREVIEW.md`: "Qué falta", punto 4;
   - las reglas `publicar-fotos.md` y `cuenta-perfil.md`.

No hago commit ni push hasta que lo pruebes y lo pidas.
