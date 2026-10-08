# RLVO — Design system propuesto

**Fase 1 · Prototipo móvil · Iteración 2 del Feed · Pendiente de aprobación**

La propuesta vive en [rlvo-app.html](rlvo-app.html). Conserva las 73 pantallas, el orden, los grupos, los estados y los comportamientos de [relevo-app.html](relevo-app.html). El original continúa siendo la referencia aprobada de la aplicación real hasta recibir el visto bueno para una migración posterior.

Solo se crearon este documento y el nuevo HTML. Los prototipos anteriores, los 18 logos, la aplicación, el panel real y la infraestructura no se modificaron.

## 1. Dirección visual

La dirección general fue aprobada como punto de partida. Esta segunda iteración del Feed sigue pendiente de visto bueno y no establece todavía el diseño final.

Crema para el fondo, blanco para superficies y grafito para texto, contornos y contraste. El lima identifica acciones principales, selecciones y pequeños detalles de marca. Las fotografías y los precios deben tener más peso que la decoración.

El soft neo-brutalism se expresa mediante bordes de 1 px, sombras inferiores de 2–5 px y tipografía sans serif con jerarquía. No se añaden inclinaciones, texturas, contornos gruesos a todos los elementos ni nuevas interacciones.

La referencia Positivus orienta el equilibrio entre neutralidad, lima y contornos. No se copiaron su composición, ilustraciones ni componentes. El enlace de Figma no fue accesible desde la herramienta de consulta; esta propuesta se basa en la dirección descrita en el encargo y en los assets aprobados.

### Cambios de composición

- El hero del feed conserva su mensaje, cifras, verificación y silueta del campus. En la segunda iteración gana espacio interno y presenta los dos indicadores como chips separados.
- Las ocho categorías del feed permanecen en dos filas de cuatro, ahora con tiles de 52 px y separación de 8 px. Sus iconos y etiquetas mantienen el contraste; el contorno decorativo se aclara. Las categorías de otros frames conservan sus medidas y estilos anteriores.
- Las miniaturas de la rejilla usan proporción 1:1 para adelantar los precios. La galería de Detalle mantiene 340 px de altura y el visor conserva la imagen completa y el gesto documentado de cierre.
- Los teléfonos conservan **375 × 812 px**, incluyendo el borde de 10 px: el contenido interior tiene 355 px de ancho. No se deben interpretar esos 355 px como el ancho objetivo de una futura app nativa.
- La barra inferior conserva sus cuatro destinos y el FAB sigue en Perfil. La selección usa una cápsula lima detrás del icono y un texto en grafito.

El original representa productos con glifos SVG y tintes, no con fotografías reales. Estos placeholders se conservaron, incluidos los estados de fotos eliminadas, procesando y vendidas. No se incorporaron fotos de stock que cambien los ejemplos del producto. La decisión de formato cuadrado debe revisarse también con fotografías reales antes de trasladarla a la app.

## 2. Paleta oficial

- **Lime Green:** `#B9FF66` — acento de marca.
- **Graphite:** `#191A23` — texto principal, contornos y superficies oscuras.
- **Cream:** `#F5F1EA` — fondo de aplicación.
- **Light Gray:** `#F3F3F3` — superficie neutra secundaria.
- **White:** `#FFFFFF` — tarjetas, formularios y contenido sobre grafito.
- **Black:** `#000000` — fondo del visor de fotos.

Los colores semánticos siguientes son una propuesta de interfaz adicional a la paleta oficial. No son variantes de logo ni reemplazos de los colores aprobados.

## 3. Tokens semánticos

### Superficies y contenido

- `--ink`: grafito. Texto, precios e iconos principales.
- `--ink-soft`: `#5E606B`. Metadatos, descripciones y placeholders.
- `--paper`: crema. Fondo de pantalla.
- `--card`: blanco. Tarjetas, controles y modales.
- `--surface-muted`: gris claro. Campos fijos y contenedores auxiliares.
- `--line`: `#D8D8DB`. Separadores decorativos; no delimita por sí solo un control interactivo.
- `--control-border`: `#85868F`. Borde de inputs, tiles, chips y radios sin seleccionar.
- `--outline`: grafito. Contornos que definen acciones y superficies elevadas.

### Acciones y selección

- `--action-bg`: lima, mediante el alias existente `--brick`.
- `--action-ink`: grafito, mediante `--ink`.
- `--brick-tint`: mezcla de 16 % del primario y 84 % de blanco. Acentos suaves y algunos placeholders existentes.
- Selección de categorías, chips y segmentos: lima con texto e iconos en grafito y contorno grafito.
- Chips de filtros ya aplicados: grafito con texto claro, para distinguirlos de las opciones del formulario.
- Acciones de texto: grafito; los enlaces de sección también llevan subrayado. El lima no se usa para texto pequeño sobre crema o blanco.

### Éxito, error, advertencia e información

- `--success` / `--forest`: `#256347`; fondo `--success-bg` / `--forest-tint`: `#E6F3EB`. Verificación, confirmaciones positivas y estado activo.
- `--danger`: `#B42332`; `--danger-bg`: `#FCEBED`. Eliminación, errores, campos inválidos y rechazos de moderación.
- `--warning`: `#805500`; `--warning-bg`: `#FFF3D6`. Revisión pendiente, fotos faltantes y problemas de ubicación que permiten seguir eligiendo un campus.
- `--info`: `#405675`; `--info-bg`: `#EBF0F7`. Avisos informativos y estados neutrales con explicación.
- `--disabled-bg`: `#E7E7EA`; `--disabled-ink`: `#686A74`. Acciones que todavía no están disponibles.

La clase semántica se añade al componente sin retirar la clase ni el estado original. Por ejemplo, `.notice.is-error` o `.mine-state.warn.is-error`. Un rechazo no hereda el lima del CTA.

### Feed — decisiones de la segunda iteración

El ajuste se limita a **Feed** y **Feed (sin publicaciones)**, mediante `.feed-frame`. Los otros 71 frames conservan exactamente su markup y no reciben estas reglas CSS.

- **Hero con más aire:** padding de 14 px arriba, 16 px a los lados y 12 px abajo; titular con interlineado 1.15 y 10 px antes de los indicadores. Su altura en el Feed pasa de 120 a 160 px.
- **Indicadores separados:** chips de 24 px de alto, texto Inter de 11 px y separación vertical de 6 px. El conteo utiliza lima/grafito; la verificación utiliza un contorno claro y texto blanco sobre grafito. En el estado vacío se conserva únicamente el chip de verificación, sin añadir un conteo de cero.
- **Lima con un propósito concreto:** destaca el conteo de publicaciones y mantiene los acentos existentes de marca/selección. La silueta del campus se conserva como decoración de 14 px de alto al 12 % de opacidad para no competir con los chips. El hero prescinde de su sombra inferior.
- **Categorías más ligeras:** altura de 52 px, iconos de 20 px, gap interno de 3 px y contorno mezclado con un 28 % de blanco. Ese contorno es decorativo; la identificación de cada categoría sigue apoyándose en icono y etiqueta en grafito. Se conserva un tile de más de 48 px de alto.
- **Más espacio para productos:** se reducen márgenes del encabezado, buscador y secciones. Las fotografías mantienen su tamaño y proporción. La primera fila empieza unos **15 px antes** que en la iteración anterior; sus precios y títulos quedan por encima de la navegación inferior en la primera vista de 375 × 812 px.
- **Identidad conservada:** logo oficial, tamaño y proporciones de su imagen, tipografías Manrope/Inter, colores base y navegación permanecen iguales. No se añade ni retira contenido, una acción o un estado.

Estos ajustes de densidad son específicos del Feed y no redefinen los espaciados globales del design system.

### Compatibilidad del prototipo

Se conservan los identificadores técnicos `--brick`, `--forest`, `--gold`, `--slate`, las clases, IDs y atributos de filtro. Sus roles visuales se redefinen en esta propuesta:

- `--brick`: primario lima, no error.
- `--forest`: éxito y confianza.
- `--gold` / `--gold-tint`: ámbar y su fondo; también estrellas.
- `--slate` / `--slate-tint`: información y su fondo.
- `--brick-dark`: grafito, sin el antiguo degradado cálido.

Los comentarios heredados que describen flujos se conservan. Sus menciones históricas a colores quedan subordinadas a `:root`, la capa final `RLVO component layer` y este documento.

El editor de estilo conserva sus cinco controles de color, dos de tipografía y Restablecer. La etiqueta del control secundario aclara que afecta éxito/confianza. Restablecer recupera los valores RLVO. Los SVG oficiales no cambian al experimentar con el editor; los contrastes documentados solo corresponden a los valores iniciales.

## 4. Tipografía

El original utiliza Fraunces para marca, precios y titulares, e Inter para la interfaz. Se propone **Manrope + Inter** para acercar la app a la geometría del logo sin imitar ni reemplazar su lettering.

- `--font-display`: **Manrope**, fallback `sans-serif`.
- `--font-body`: **Inter**, fallback `sans-serif`.
- Manrope 800: títulos de pantalla, estados vacíos, titulares de autenticación, estadísticas y precios.
- Manrope 700: mensaje del banner e iniciales de avatar.
- Inter 400: cuerpo y metadatos; 500: etiquetas y contenido de tarjetas; 600–700: acciones y selecciones.
- Precios y números destacados usan cifras alineadas y tabulares donde la fuente las ofrece.

Roles principales del HTML:

- Precio de detalle: 28 px; precio de tarjeta/lista: 19 px.
- Autenticación y onboarding: 22 px; banner: 20 px.
- Títulos de pantalla: 19 px; títulos de sección: 15 px; encabezado de hoja: 16 px.
- Texto de producto: 12.5 px; cuerpo: 13–14 px; metadatos: 10.5–12.5 px.
- Botones principales: 13.5 px / 20 px; auxiliares: 13 px / 20 px.
- Texto descriptivo: interlineado 1.5–1.6; titulares: 1.1–1.3 según el rol.

Las fuentes se cargan desde Google Fonts, como en el original. El editor conserva las familias anteriores para comparación y añade Manrope, Inter y Sora entre las opciones de títulos. Ninguna fuente del interior de un SVG se cambia.

Para una futura implementación, incorporar archivos de fuentes y pesos concretos, revisar licencias y verificar el nombre de familia en ambas plataformas. Expo SDK 57 permite incrustar fuentes con el config plugin de `expo-font` o cargarlas en ejecución; su documentación recomienda el plugin en Android/iOS. Esa implementación requiere autorización posterior. [Referencia versionada de Expo Font](https://docs.expo.dev/versions/v57.0.0/sdk/font/).

## 5. Espaciados y geometría

Escala propuesta: `4 / 8 / 12 / 16 / 20 / 24 / 32 px`, expuesta como `--space-1` a `--space-8` con los valores definidos en `:root`.

Se mantienen los paddings de cada flujo cuando el contenido los necesita: margen lateral habitual de 20 px, autenticación de 24 px y estados vacíos de 30 px. La escala no justifica sustituir indiscriminadamente medidas del original.

- Rejilla de productos: dos columnas, separación de 12 px.
- Categorías del feed: cuatro columnas, separación de 8 px y altura de 52 px por tile en la segunda iteración.
- Separación entre acciones: 10 px; entre elementos de lista: 11–12 px.
- Botones primarios, secundarios y destructivos: mínimo de 48 px de alto.
- Buscador y filtro: 44 px de alto.
- Barra inferior: 78 px, conservando su separación inferior.
- Detalle: foto de 340 px; perfiles y miniaturas de formulario conservan sus tamaños.

El área de toque de iconos pequeños heredados deberá verificarse en la implementación nativa. Un prototipo de frames no sustituye esa prueba ni representa Dynamic Type o tamaños de texto del sistema.

## 6. Bordes, radios y sombras

Radios:

- `--radius-sm`: 8 px. Badges y contenedores de iconos.
- `--radius-control`: 12 px. Inputs, botones, chips rectangulares, tiles y toasts.
- `--radius-card`: 16 px. Tarjetas de producto, vendedor y banner.
- `--radius-panel`: 20 px. Modales y borde superior de hojas.
- `--radius-pill`: 999 px. Cápsulas de selección y chips.
- FAB: 18 px. Silueta de cuadrado redondeado para destacar la acción de publicar.
- Avatares, radios e iconos de galería: círculos.
- Dispositivo: radio original de 44 px; las miniaturas y piezas heredadas pueden conservar sus radios explícitos de 14 px.

Bordes de 1 px en componentes y 1.5 px en radios/OTP heredados. Los campos de foto vacíos conservan el borde punteado. Los separadores punteados de variantes siguen siendo documentación del prototipo, no nuevas divisiones de la app.

Sombras:

```css
--shadow-control: 0 3px 0 var(--outline);
--shadow-card: 0 2px 0 var(--outline);
--shadow-panel: 0 5px 0 var(--outline),
                0 14px 32px rgba(25,26,35,.12);
```

Se reservan para CTAs, tarjetas elevadas, ilustraciones de onboarding y modales. Inputs, filas, categorías sin seleccionar y texto permanecen ligeros. Los teléfonos tienen una sombra ambiental exterior, que no pertenece al design system de la app.

## 7. Componentes y estados

### Botones

Primario: lima/grafito, contorno grafito y sombra inferior. Se conserva el texto y la ubicación del CTA original. Secundario: blanco/grafito, borde definido y sin relleno de marca. Destructivo: rojo/blanco; nunca lima.

Deshabilitado: fondo gris y texto gris, sin sombra. Ocupado: mantiene su color y el indicador de tres puntos original; no se confunde con deshabilitado. Las deshabilitaciones nativas y los estados representados del original se conservan.

El FAB conserva su ubicación en Perfil y su icono de suma. Cambia su silueta y sus colores, no su función.

### Inputs y validación

Superficie blanca, borde de control, radio de 12 px y texto en grafito. Placeholder en gris con contraste. Error: borde rojo, tinte rojo y mensaje debajo del campo. Universidad fija: superficie gris y texto legible; se mantiene sin chevron. Teléfono: mismo selector de país y mismo contenido original.

El foco visible usa contorno grafito de 2 px con separación de 3 px. Los filtros externos ahora son botones nativos para poder activarlos por teclado con el mismo handler existente.

### Productos y categorías

La tarjeta mantiene foto/placeholder, precio, título, universidad, fecha, favoritos y badges. El precio gana peso y cifras consistentes. Los títulos conservan su truncamiento previsto; los nombres de universidades mantienen su línea propia y elipsis para nombres largos.

Las categorías conservan todos sus nombres e iconos. El estado seleccionado utiliza lima y grafito. No se añaden categorías ni filtros de negocio.

### Navegación, galería y hojas

La barra inferior mantiene Inicio, Buscar, Favoritos y Perfil. Su icono activo usa una cápsula lima y el resto permanece gris con contraste.

El carrusel conserva scroll horizontal, snap, sus cuatro fotos del ejemplo y la actualización de puntos por JavaScript. Los puntos llevan un pequeño fondo grafito para leerse sobre imágenes claras. El visor conserva su inicio en la tercera foto (`data-inicio="2"`) y su frame de cierre transitorio.

Las hojas mantienen su altura máxima, listas y acciones. El handle es gris de control. Los modales usan blanco, contorno grafito y sombra; el scrim utiliza grafito al 60 %. El modal de cerrar sesión tiene un icono neutro; las eliminaciones tienen icono rojo.

### Avisos y estados del producto

- Error persistente: rojo con texto e icono; no depende solo del color.
- Advertencia de ubicación/revisión: ámbar con explicación y las salidas originales.
- Información: azul grisáceo suave.
- Éxito: verde oscuro y check.
- Toast: grafito con texto blanco; icono de éxito o error con un borde claro.
- Publicaciones: activa en verde; sin fotos/revisión en ámbar; bloqueada en rojo; pausada/vendida en gris.
- Vacíos: icono neutro en contenedor blanco, titular Manrope y acciones originales.
- Skeleton: grises neutros; no utiliza lima.
- Carga: se conservan las animaciones originales de puntos y shimmer. `prefers-reduced-motion` las desactiva sin retirar el indicador.

## 8. Logos oficiales

Se revisaron los 18 archivos y [LEEME.txt](../assets/brand/LEEME.txt). Las geometrías, proporciones, colores y tipografías se mantienen intactas. El kit indica que RLVO está convertido a contornos y que el lema permanece como texto SVG; no se modifica ninguno de los dos.

Usos implementados:

- **07 — horizontal grafito transparente:** encabezados del feed, skeleton y cabecera externa del prototipo. Renderizado a 96 px de ancho en la app, con altura proporcional.
- **02 — isotipo lima transparente:** autenticación y código de registro, a 52 × 52 px sobre grafito. Reemplaza la letra temporal «R».
- **16 — vertical lima transparente:** splash, a 260 px de ancho y altura proporcional sobre grafito. Sustituye la composición antigua de marca.

Los candados del flujo de recuperar contraseña se conservan: son iconos funcionales, no marcas temporales. El copy existente «Tu campus, tu mercado» se mantiene debajo del logo del splash; no se incrusta ni se sustituye el lema de los SVG.

Reglas para extender la identidad:

- Referenciar `../assets/brand/<archivo>.svg` desde `design/`; usar `<img>` con texto alternativo y altura automática.
- Sobre crema/blanco: variantes grafito 01, 07 o 15.
- Sobre grafito: variantes lima 02, 08 o 16; blanco 03, 09 o 14 si se requiere neutralidad.
- Sobre lima: variantes grafito 04, 10, 12 o 17, según formato y tamaño.
- Variantes con fondo: 04–06, 10–13 y 17–18. Respetar el fondo integrado y todo el `viewBox`.
- Usar variantes con lema únicamente cuando las dos líneas sean legibles. No encogerlas en la barra de navegación.
- Mantener espacio libre alrededor; propuesta de interfaz: al menos 8 px en encabezados y 24 px en piezas de presentación. Esto no sustituye un manual oficial de marca.
- No aplicar `filter`, máscaras, clipping, estiramiento, recoloración CSS ni nuevos trazos. No reconstruir el wordmark con Manrope o Inter.
- No usar los isotipos como botones de navegación ni como sustitutos de un icono funcional.

Solo hacen falta tres variantes en estas pantallas. Incluir las 18 indiscriminadamente reduciría la consistencia; las restantes siguen disponibles, sin modificaciones.

## 9. Accesibilidad y contraste

Contrastes calculados para los valores iniciales, con luminancia relativa sRGB:

- Grafito sobre lima: **14.47:1**.
- Blanco sobre grafito: **17.31:1**.
- Grafito sobre crema: **15.37:1**.
- Texto secundario sobre crema: **5.55:1**; sobre blanco: **6.25:1**.
- Rojo sobre blanco: **6.51:1**; sobre fondo de error: **5.65:1**.
- Éxito sobre su tinte: **6.22:1**.
- Advertencia sobre su tinte: **5.92:1**.
- Información sobre su tinte: **6.54:1**.
- Borde de control sobre blanco: **3.62:1**; sobre crema: **3.21:1**.

Blanco sobre lima solo da **1.20:1**, por eso los CTAs e iconos sobre lima utilizan grafito.

Se revisaron textos, placeholders, estados y controles relevantes. La auditoría limitada de contraste del DOM no equivale a una certificación WCAG completa: faltan lector de pantalla, gestos, áreas de toque reales, escalado de fuente del sistema y todas las combinaciones de fotografías futuras. Los controles deshabilitados quedan fuera del umbral exigido a estados activos.

## 10. Preservación del producto y nombre

Se migró el nombre visible a RLVO en splash, encabezados, autenticación, avisos, perfiles, mensajes de venta y título HTML. La comparación de los textos de cada frame solo permite esa migración y la sustitución de las letras de marca por SVG.

Se conservan nombres de universidades, marcas de terceros, correos, dominios, IDs, categorías, valores de ejemplo y rutas técnicas. Las menciones al nombre anterior en comentarios históricos no son texto visible.

### Referencias que requieren revisión posterior

- En Verificación se muestra «Términos de uso y Aviso de privacidad de RLVO». Solo cambia el nombre comercial mostrado. Los documentos legales externos, la identidad del responsable y sus versiones requieren una revisión aparte antes de publicar; no se alteraron en esta fase.
- Se conserva `soporte@rlvo.com.mx` tal como aparece en el original. No se verificó la disponibilidad del canal ni se enviaron mensajes.
- El modal de cerrar sesión conserva el texto que pide verificar el correo al regresar. Revisar su coherencia con el flujo real de inicio por contraseña en una tarea de copy/funcionalidad posterior.
- Los valores ilustrativos no siempre coinciden entre frames: por ejemplo, el detalle del libro muestra «Gratis» y el feed muestra `$280`. Se conserva esa cobertura del original; no se cambian precios para hacerla coincidir arbitrariamente.
- Las filas documentadas de notificaciones no demuestran que sus disparadores estén implementados. Su presencia se conserva sin añadir funcionalidades.

## 11. Extensión futura al panel administrativo

[admin-panel.html](admin-panel.html) comparte los tokens antiguos y la combinación Fraunces/Inter, pero usa tamaños de escritorio, estados de moderación y tablas propios. No se creó ni modificó un prototipo administrativo en esta fase.

Cuando se autorice:

1. Adoptar la misma paleta semántica, Manrope/Inter y las variantes oficiales de marca apropiadas.
2. Separar aprobación/éxito, espera/revisión y bloqueo/destrucción. No traducir todas las acciones administrativas al lima.
3. Mantener Inter para datos densos, cifras tabulares y encabezados legibles; usar Manrope para títulos y métricas.
4. Trasladar radios de 12–20 px y sombras contenidas. Reservar sombras duras para acciones o modales, evitando aplicarlas a cada celda.
5. Conservar filtros, estados, auditoría, advertencias, TOTP y todos los frames existentes del panel.
6. Hacer una comparación de cobertura independiente del panel y una revisión de contraste de tablas/acciones, antes de implementar.
7. Seguir su convención de autoalojar fuentes en producción; la carga desde Google Fonts es solo del prototipo.

La elección de las fuentes, los colores semánticos adicionales y la densidad de tarjetas de esta propuesta deben aprobarse antes de extenderlos.

## 12. Validación y revisión

### Comparación estática ejecutada

- **73 frames originales = 73 frames RLVO.** Misma secuencia de nombres y atributos `data-cat`.
- Onboarding: **17**; Explorar: **21**; Publicar: **10**; Cuenta: **12**; Confianza: **4**; Notificaciones: **2**; Sistema: **7**.
- Misma cobertura de clases originales y estados: modales, hojas, errores, vacíos, variantes, carga y selección.
- Mismos campos, tipos, valores de ejemplo, placeholders y atributos nativos de deshabilitación.
- Misma geometría de los SVG funcionales y de placeholders; solo cambian sus colores de interfaz.
- JavaScript idéntico, exceptuando los valores iniciales/restablecidos del editor de estilo.
- Los 18 SVG son XML válido; las nueve referencias de imagen del nuevo HTML resuelven archivos existentes.
- SHA-256 idéntico antes/después para los dos prototipos anteriores, los 18 SVG y LEEME.txt: **21 archivos protegidos intactos**.
- Ninguna referencia visible a Relevo; se mantienen referencias técnicas/comentarios históricos.

### Navegador — primera iteración

Revisión ejecutada en Chrome mediante una vista previa local, limitada al nuevo HTML y los logos:

- Los ocho filtros externos funcionan y sus contadores coinciden con el inventario. Se verificó también activación de un filtro con Enter.
- El editor aplica cambios de primario, familia de títulos y familia de cuerpo; Restablecer recupera Manrope, Inter y `#B9FF66`. Sus bindings de color originales se conservan.
- Las nueve imágenes de marca cargan (`complete` y `naturalWidth > 0`); sin recursos de imagen fallidos.
- El carrusel de Detalle cambia la foto y el punto activo al deslizar. El visor inicializa la tercera foto: desplazamiento de 710 px sobre ancho de 355 px y punto activo de índice 2.
- Todos los dispositivos miden **375 × 812 px**. No se detectaron desbordamientos horizontales en sus `.screen`.
- En anchos de navegador de **1024, 415 y 375 px**, no hay desbordamiento horizontal de página. A 375 px, el contenedor de la colección permite pan horizontal para conservar el artboard completo; esto es cromo del prototipo, no una interacción nueva de la app. Se restauró el viewport original después de probar.
- Modales, hojas, tab bars y CTAs flotantes permanecen dentro del dispositivo. Las variantes de CTA en flujo normal se excluyen de ese control de overlays porque pertenecen al contenido que se recorre con scroll.
- Revisión visual de feed y su vacío, splash, onboarding, detalle, selector de campus con error, publicación/procesamiento, perfil/soporte, notificaciones/vacío, confirmaciones destructivas y errores de cuenta/conexión.
- Comprobación de contraste de **1,269 elementos de texto** sobre sus fondos calculados: **0 incidencias** con los umbrales AA aplicables, excluyendo texto oculto/deshabilitado y elementos con opacidad reducida. El cálculo incluye tintes sRGB de `color-mix`. No evalúa todo el contenido sobre fotografías ni constituye una auditoría de accesibilidad completa.
- Sin errores o advertencias de consola capturados durante la revisión.
- Sintaxis del JavaScript verificada con `node --check`.

### Validación de la segunda iteración del Feed

- Comparación con la iteración anterior: mismos 73 frames, textos, estados, logos y JavaScript. Los otros 71 frames permanecen idénticos en el HTML.
- Revisión de Feed y Feed vacío en Chrome a 375 × 812 px: sin desbordamiento horizontal, chips completos y navegación conservada. Ambos logos cargan correctamente.
- Hero: 120 → 160 px. Rejilla de categorías: 137 → 112 px. Inicio de productos: aproximadamente 530 → 515 px desde el borde superior del dispositivo. El espacio se recupera en categorías y márgenes sin reducir las imágenes de producto.
- Los precios de la primera fila terminan aproximadamente en 700 px y la navegación empieza en 724 px; los títulos también caben antes de la barra inferior.
- Comprobación de contraste de 85 elementos de texto de ambos frames: 0 incidencias con los umbrales AA del texto. El conteo en lima conserva 14.47:1 con grafito; el chip de verificación usa blanco sobre grafito. El contorno más claro de categorías es decorativo.
- Filtros verificados después del ajuste: Explorar muestra 21/73 y Todas muestra 73/73. Sin errores o advertencias de consola capturados.
- Las validaciones estructurales y de integridad de los originales/logos siguen pasando. No se modificaron archivos de producción ni se realizaron commits o push.

### Validaciones no ejecutadas / límites

- No se ejecutó una comparación pixel a pixel automatizada del original en el navegador: la herramienta rechazó su URL `file://` por política de navegación. La comparación de estructura, textos, campos, estados, geometría SVG y JavaScript sí se ejecutó por lectura de archivos. El original no se sirvió por otra vía para eludir esa restricción.
- No se inspeccionó visualmente cada uno de los 73 frames de forma individual; la revisión visual es representativa y los controles de estructura, geometría y contraste cubren el conjunto.
- No se probó Safari/Firefox, modo sin conexión, lector de pantalla, teclado móvil ni escalado de fuentes nativo. Tampoco autenticación, publicación, eliminación, WhatsApp ni infraestructura: el alcance es exclusivamente el prototipo.
- El documento de Figma no pudo consultarse. No se afirma una comparación visual directa con ese archivo.
- La futura carga de fuentes y renderización de sombras en iOS/Android queda pendiente de implementación autorizada.

### Cómo abrir y revisar

Abrir `design/rlvo-app.html` en un navegador desde el repositorio. Mantener la carpeta `assets/brand/` en su posición para que las rutas relativas funcionen. Hace falta conexión a Internet para las fuentes de Google; sin ella se usa el fallback sans serif.

Usar los filtros superiores para revisar cada grupo, comprobar el contador, hacer scroll dentro de cada teléfono y deslizar horizontalmente las galerías. El editor permite comparar tipografías/colores y volver a la propuesta con Restablecer.

Es un catálogo de frames: los botones de negocio conservan el alcance estático del original. No autentica, publica, elimina ni contacta a nadie. El filtro externo, el editor y los carruseles sí tienen el comportamiento JavaScript original.

Para comparar, abrir también `design/relevo-app.html` en otra pestaña. Esta propuesta no requiere instalar dependencias ni ejecutar la app Expo.

### Decisiones pendientes de visto bueno

- Manrope para titulares/precios junto a Inter para el resto de la interfaz.
- Colores semánticos adicionales y tratamiento contenido de bordes/sombras.
- Hero con chips separados, categorías de 52 px y distribución vertical de la segunda iteración del Feed; las miniaturas cuadradas se mantienen.
- Uso de las variantes 02/07/16 y presentación del splash con el copy existente.

La aprobación de esta propuesta no autoriza por sí sola cambios al panel, implementación nativa ni despliegue. Esas fases requieren una instrucción posterior.

## Apéndice — Inventario de frames en orden original

1. **Feed** — `explorar`.
2. **Feed (sin publicaciones)** — `explorar`.
3. **Selector de campus** — `explorar`.
4. **Selector de campus (detectando ubicación)** — `explorar`.
5. **Selector de campus (sin campus cercano)** — `explorar`.
6. **Selector de campus (permiso denegado)** — `explorar`.
7. **Selector de campus (permiso denegado permanentemente)** — `explorar`.
8. **Selector de campus (ubicación desactivada)** — `explorar`.
9. **Selector de campus (error de ubicación)** — `explorar`.
10. **Detalle de publicación** — `explorar`.
11. **Detalle (vendida)** — `explorar`.
12. **Detalle (vista vendedor)** — `explorar`.
13. **Detalle (foto a pantalla completa)** — `explorar`.
14. **Detalle (foto — cerrando)** — `explorar`.
15. **Splash** — `onboarding`.
16. **Onboarding 1/3** — `onboarding`.
17. **Onboarding 2/3** — `onboarding`.
18. **Onboarding 3/3** — `onboarding`.
19. **Verificación** — `onboarding`.
20. **Verificación (correo no participante)** — `onboarding`.
21. **Publicar** — `publicar`.
22. **Publicar (procesando fotos)** — `publicar`.
23. **Publicar (subiendo imágenes)** — `publicar`.
24. **Publicar (revisando)** — `publicar`.
25. **Publicar (error de subida)** — `publicar`.
26. **Publicar (falta teléfono)** — `publicar`.
27. **Perfil** — `cuenta`.
28. **Perfil (ayuda y soporte)** — `cuenta`.
29. **Configuración** — `cuenta`.
30. **Favoritos** — `cuenta`.
31. **Iniciar sesión** — `onboarding`.
32. **Recuperar contraseña** — `onboarding`.
33. **Código de recuperación** — `onboarding`.
34. **Nueva contraseña** — `onboarding`.
35. **Cuenta eliminada** — `onboarding`.
36. **Búsqueda (recomendados)** — `explorar`.
37. **Búsqueda** — `explorar`.
38. **Búsqueda sin resultados** — `explorar`.
39. **Filtros** — `explorar`.
40. **Perfil público** — `cuenta`.
41. **Notificaciones** — `notificaciones`.
42. **Notificaciones vacío** — `notificaciones`.
43. **Categoría** — `explorar`.
44. **Categoría sin resultados** — `explorar`.
45. **Ver todas (categorías)** — `explorar`.
46. **Código de verificación** — `onboarding`.
47. **Completar perfil** — `onboarding`.
48. **Completar perfil (estado inicial)** — `onboarding`.
49. **Completar perfil (selector de campus)** — `onboarding`.
50. **Intereses** — `onboarding`.
51. **Permiso de notificaciones** — `onboarding`.
52. **Editar perfil** — `cuenta`.
53. **Selector de país** — `cuenta`.
54. **Editar intereses** — `cuenta`.
55. **Editar publicación** — `publicar`.
56. **Reportar publicación** — `confianza`.
57. **Calificar** — `confianza`.
58. **Favoritos vacío** — `cuenta`.
59. **Mis publicaciones** — `cuenta`.
60. **Mis publicaciones vacío** — `cuenta`.
61. **Mis publicaciones (acciones)** — `cuenta`.
62. **Publicación creada** — `publicar`.
63. **Publicación en revisión** — `publicar`.
64. **Publicación no aprobada** — `publicar`.
65. **Confirmar eliminar** — `sistema`.
66. **Confirmar cerrar sesión** — `sistema`.
67. **Confirmar eliminar cuenta** — `sistema`.
68. **Error de conexión** — `sistema`.
69. **Toast de éxito** — `sistema`.
70. **Toast de error** — `sistema`.
71. **¿A quién le vendiste?** — `confianza`.
72. **¿A quién le vendiste? (sin contactos)** — `confianza`.
73. **Loading / skeleton** — `sistema`.
