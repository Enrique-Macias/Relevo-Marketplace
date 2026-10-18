# RLVO — Checklist de pruebas TestFlight

Versión a probar: **RLVO 1.0.0 (3)**, instalada desde TestFlight, más el panel
de administración en `https://admin.rlvo.com.mx`.

## Ronda 1 — Smoke Test socios

**Objetivo:** comprobar rápido que los flujos críticos de RLVO funcionan en el
build real de TestFlight (RLVO 1.0.0 (3)) contra STAGING, antes de correr la
suite completa.

**Cómo usarla:**

- Lee primero **"Antes de empezar"** y la **Leyenda**, más abajo. Las mismas
  reglas aplican aquí.
- Esta lista solo **referencia** pruebas de la suite completa. Las
  instrucciones de cada una (acción, resultado esperado, notas) están en su
  sección, con el mismo ID. Marca PASS/FAIL ahí mismo.
- Son **34 pruebas**: 16 que hace cada socio por su cuenta (A), 10 entre los
  dos (B) y 8 del panel (C). No incluye ninguna 🔴, ni eliminar cuentas, ni
  suspender usuarios.
- **Tiempo estimado:** unos 25-35 minutos por socio para la parte A, 40-50
  minutos juntos para la parte B y unos 10-15 minutos por socio para la parte C.
  En total, alrededor de 1.5 a 2 horas.
- Usa solo datos de prueba con "QA" en el título o en el comentario.

### A. Cada socio por su cuenta

Kiko y Emilio hacen estas pruebas, **cada uno en su iPhone**:

**Instalación**

- [ ] QA-INSTALL-01 — Instalar desde TestFlight · P0
- [ ] QA-INSTALL-03 — Primer arranque sin computadora · P0

**Registro y sesión.** Si ya creaste tu cuenta, marca QA-AUTH-01 según lo que
viste al registrarte; no hace falta otra cuenta. Si te registras ahora, sigue
el registro completo hasta llegar al Feed.

- [ ] QA-AUTH-01 — Registro con correo institucional · P0
- [ ] QA-AUTH-05 — Iniciar sesión · P0 (incluye cerrar sesión antes)
- [ ] QA-AUTH-08 — La sesión se conserva · P0

**Perfil**

- [ ] QA-PROFILE-07 — WhatsApp con selector de país · P0 (hace falta para las
  pruebas de contacto de la parte B)

**Descubrir**

- [ ] QA-FEED-01 — Carga del Feed · P0
- [ ] QA-FEED-07 — Búsqueda · P0
- [ ] QA-FEED-10 — Detalle de publicación · P0

**Publicaciones y favoritos**

- [ ] QA-LISTING-02 — Crear publicación limpia · P0
- [ ] QA-LISTING-07 — Editar publicación · P0
- [ ] QA-LISTING-08 — Pausar y reactivar · P0 (se hace desde Mis
  publicaciones)
- [ ] QA-FAV-01 — Agregar y quitar favorito · P0
- [ ] QA-FAV-02 — Lista de favoritos · P0

**Notificaciones**

- [ ] QA-PUSH-01 — Permiso de notificaciones · P0
- [ ] QA-PUSH-02 — Inbox de notificaciones · P0

### B. Entre Kiko y Emilio

Para estas pruebas coordínense. Definan antes:

- **Socio A = vendedor** (con WhatsApp guardado, QA-PROFILE-07).
- **Socio B = comprador.**

Pueden intercambiar roles después si les aporta algo. Háganlas **en este
orden**, porque varias reutilizan la publicación "QA Mochila" de QA-E2E-01:

- [ ] QA-E2E-01 — A publica, B la encuentra · P0
- [ ] QA-E2E-02 — Favorito y baja de precio · P0
  - En el iPhone de B, durante esta prueba marquen también:
  - [ ] QA-PUSH-03 — Push con la app cerrada · P0
  - [ ] QA-PUSH-05 — Abrir un push · P0
- [ ] QA-E2E-09 — Pausar oculta, reactivar muestra · P1
- [ ] QA-E2E-03 — B contacta, A lo ve · P0
  - En el iPhone de B, durante esta prueba marquen también:
  - [ ] QA-CONTACT-01 — Contactar por WhatsApp · P0
- [ ] QA-E2E-04 — Venta y calificaciones cruzadas · P0
- [ ] QA-E2E-05 — Reporte de app a panel · P0 (incluye resolver el reporte en
  el panel, QA-ADMIN-06 🟡, solo sobre el reporte "Prueba QA" que crea esta
  prueba)
- [ ] QA-E2E-08 — Bloqueo y restauración · P0 (termina con "Usuarios
  bloqueados" vacía)

**Opcional / exploratoria, no cuenta para el PASS de la Ronda 1:**

- QA-E2E-06 — Revisión y aprobación (P1). Depende de QA-LISTING-05, y la
  revisión automática puede publicar o mandar a revisión el mismo texto, así que
  el resultado no es determinista. Si la publicación quedó en revisión, pueden
  aprobarla en el panel (QA-ADMIN-09 🟡, solo sobre esa publicación). Si quedó
  publicada sin revisión, márquenla "no probado", no FAIL.

### C. Panel admin

En `https://admin.rlvo.com.mx`, cada uno con su cuenta de admin. Todas son 🟢
(solo leen). La única acción 🟡 de esta ronda es resolver el reporte de
QA-E2E-05, en la parte B.

- [ ] QA-ADMIN-01 — Login con contraseña y app autenticadora 🟢 · P0
- [ ] QA-ADMIN-04 — Lista de reportes y filtros 🟢 · P0
- [ ] QA-ADMIN-05 — Detalle de un reporte 🟢 · P0 (usen el reporte de
  QA-E2E-05)
- [ ] QA-ADMIN-07 — Cola de moderación 🟢 · P1 (puede estar vacía: también es
  válido si se ve su estado vacío)
- [ ] QA-ADMIN-08 — Detalle de publicación 🟢 · P1
- [ ] QA-ADMIN-11 — Buscar usuarios 🟢 · P1
- [ ] QA-ADMIN-12 — Detalle de usuario 🟢 · P1
- [ ] QA-ADMIN-15 — Ver catálogo 🟢 · P1 (solo ver: nada de crear ni editar)

### Si algo falla

Si una prueba falla, detengan únicamente ese flujo, registren el bug usando la
plantilla al final de este documento y continúen con las demás pruebas cuando
sea seguro.

### Criterio de PASS de la Ronda 1

La Ronda 1 es **PASS** si:

- todos los P0 seleccionados pasan;
- no hay crashes reproducibles;
- los flujos principales app ↔ STAGING funcionan;
- los flujos seleccionados entre ambos socios (parte B) funcionan;
- las acciones esenciales del panel (parte C y el reporte de QA-E2E-05)
  funcionan.

Un FAIL en un P1 se reporta con la plantilla, pero no bloquea la Ronda 1 salvo
que sea un crash. QA-E2E-06 no cuenta.

**Completar esta Ronda 1 NO sustituye la suite completa de QA.** Las 121
pruebas de abajo siguen siendo la suite maestra. Esta ronda solo valida el
build de TestFlight contra STAGING; no es una aprobación para lanzar.

---

## Antes de empezar (léelo una vez)

- **Es una versión BETA.** Esperamos encontrar errores; para eso es esta ronda.
- **Todo apunta a STAGING**, el ambiente de pruebas. Las cuentas, publicaciones,
  reportes y notificaciones que veas ahí son **de prueba**. Nada de esto es
  producción ni lo verán usuarios reales.
- **Puedes crear, modificar y eliminar datos de prueba** (publicaciones,
  favoritos, reportes) sin miedo, salvo lo que este documento marca con 🔴.
- **No uses información personal sensible**: nada de fotos de personas, INE,
  direcciones, datos bancarios ni conversaciones privadas. Usa fotos de objetos
  comunes (un libro, una taza, una mochila) y textos inventados.
- **El teléfono de WhatsApp que guardes sí es real** (la app abre WhatsApp con
  ese número). Usa el tuyo solo si estás de acuerdo en que el otro socio lo vea.
- **Si algo falla, NO intentes "arreglarlo" desde el panel de admin.** Anota el
  fallo con la plantilla del final y sigue. Arreglarlo a mano borra la evidencia.
- **TestFlight puede registrar crashes y feedback.** Si la app se cierra sola,
  TestFlight te puede pedir enviar el reporte: acéptalo. También puedes tomar una
  captura y mandarla como feedback desde TestFlight.
- **Nunca compartas** contraseñas, códigos de verificación (OTP), códigos de tu
  app autenticadora ni enlaces privados en los reportes.

### Leyenda

| Marca | Significado |
|---|---|
| **P0** | Crítico para el lanzamiento: si falla, no se lanza |
| **P1** | Importante: debe funcionar, pero hay forma de rodearlo |
| **P2** | Pulido o caso borde |
| 🟢 | Seguro de probar (panel admin) |
| 🟡 | Probar únicamente con datos o cuentas **de prueba**, acordándolo antes con el otro socio |
| 🔴 | **No ejecutar** durante esta ronda |
| **Socio A / Socio B** | Las dos cuentas que usan Kiko y Emilio en las pruebas conjuntas |

Para cada prueba marca **PASS** si el resultado fue el esperado y **FAIL** si
no. Si FAIL, llena un reporte de bug (al final) y escribe su número en "Notas".

---

## 1. Instalación y primer arranque

- [ ] **QA-INSTALL-01 — Instalar desde TestFlight** · P0
  - Acción: abre TestFlight, instala RLVO.
  - Esperado: se instala sin error y aparece en la pantalla de inicio.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-INSTALL-02 — Ícono y nombre** · P1
  - Acción: mira el ícono en la pantalla de inicio.
  - Esperado: el ícono de RLVO se ve nítido (no pixelado ni recortado) y el
    nombre bajo el ícono dice "RLVO".
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-INSTALL-03 — Primer arranque sin computadora** · P0
  - Acción: con la computadora apagada o lejos, abre la app.
  - Esperado: la app abre sola, sin pantallas rojas/amarillas de error ni
    mensajes de "desarrollo". Llega a la pantalla de bienvenida o, si ya tenías
    sesión, al Feed.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-INSTALL-04 — Cerrar y reabrir** · P0
  - Acción: cierra la app por completo (desliza hacia arriba en el selector de
    apps) y vuelve a abrirla tres veces.
  - Esperado: abre siempre, sin crash y sin quedarse en blanco.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-INSTALL-05 — Splash y bienvenida** · P2
  - Acción: con una sesión cerrada, abre la app y recorre las 3 pantallas de
    bienvenida con "Siguiente" hasta "Comenzar".
  - Esperado: las tres pantallas se ven completas, sin textos cortados; "Comenzar"
    lleva a "Verifica que eres estudiante".
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: la pantalla de carga inicial (splash) todavía usa colores
    provisionales; no es bug (ver sección 16).

---

## 2. Registro y autenticación

Precondición: un correo institucional de una universidad dada de alta en
STAGING. Si ya tienes cuenta, usa las pruebas de registro solo con un segundo
correo institucional, si lo tienes.

- [ ] **QA-AUTH-01 — Registro con correo institucional** · P0
  - Acción: en "Verifica que eres estudiante", escribe un correo institucional
    nuevo y toca "Enviar código de verificación".
  - Esperado: llega un correo con un código de 6 dígitos y la app pasa a
    "Ingresa el código". (Si no llega, revisa spam y, en correos de Microsoft
    365, la **Cuarentena**: es un problema conocido del lado de la universidad.)
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-AUTH-02 — Correo no institucional rechazado** · P0
  - Acción: intenta registrarte con un correo personal (por ejemplo, de Gmail).
  - Esperado: un aviso dice que ese correo no pertenece a una universidad
    participante. No llega ningún código.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-AUTH-03 — Código correcto** · P0
  - Acción: escribe el código de 6 dígitos que llegó.
  - Esperado: pasa a "Cuéntanos de ti" (Completar perfil).
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-AUTH-04 — Código incorrecto y reenviar** · P1
  - Acción: escribe un código inventado; después toca "Reenviar".
  - Esperado: con el código inventado aparece un error y no avanza. "Reenviar"
    manda un código nuevo que sí funciona.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-AUTH-05 — Iniciar sesión** · P0
  - Acción: cierra sesión (Perfil → Cerrar sesión) y entra con "Iniciar sesión",
    correo y contraseña.
  - Esperado: entra al Feed con tus datos.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-AUTH-06 — Contraseña incorrecta** · P0
  - Acción: intenta entrar con una contraseña equivocada.
  - Esperado: aparece un mensaje de error y no entra. (Si el mensaje está en
    inglés, anótalo como S3.)
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-AUTH-07 — Cerrar sesión** · P0
  - Acción: Perfil → "Cerrar sesión" → confirma.
  - Esperado: vuelve a la pantalla inicial sin sesión. "Cancelar" en el modal
    cierra el modal sin cerrar sesión.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-AUTH-08 — La sesión se conserva** · P0
  - Acción: con sesión iniciada, cierra la app por completo y ábrela al día
    siguiente (o tras varias horas).
  - Esperado: entra directo al Feed, sin pedir contraseña.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-AUTH-09 — Recuperar contraseña** · P0
  - Acción: en "Iniciar sesión" toca el enlace para recuperar contraseña, escribe
    tu correo, ingresa el código que llega y crea una contraseña nueva (mínimo 8
    caracteres).
  - Esperado: vuelve a "Iniciar sesión" y la contraseña nueva funciona; la vieja
    ya no.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

---

## 3. Onboarding y perfil

- [ ] **QA-PROFILE-01 — Completar perfil** · P0
  - Acción: tras el registro, escribe tu nombre, elige campus y crea una
    contraseña (mínimo 8 caracteres, las dos iguales). Toca "Continuar".
  - Esperado: la **Universidad** aparece ya puesta y no se puede cambiar; el
    campus solo ofrece campus de esa universidad. Avanza a "¿Qué te interesa?".
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-PROFILE-02 — Nombre inválido** · P1
  - Acción: en el nombre escribe "Ana_2" o "J".
  - Esperado: aparece un error bajo el campo y el botón queda apagado. Con un
    nombre normal (letras, acentos, espacios) se habilita.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-PROFILE-03 — Intereses y permiso de notificaciones** · P1
  - Acción: elige 2 o 3 categorías y toca "Continuar" (o "Omitir"). En "No te
    pierdas nada" toca "Activar notificaciones".
  - Esperado: iOS pide el permiso (puede que ya lo haya pedido antes; ver
    sección 16) y la app llega al Feed.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-PROFILE-04 — Pantalla de Perfil** · P0
  - Acción: abre la pestaña Perfil.
  - Esperado: se ven tu foto o iniciales, nombre, universidad, los contadores
    (Activas, Vendidos, Favoritos) y el menú: Mis publicaciones, Mis intereses,
    Editar perfil, Verificación, Ayuda y soporte, Cerrar sesión.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: "Verificación" todavía no hace nada al tocarla; no es bug.

- [ ] **QA-PROFILE-05 — Foto de perfil** · P1
  - Acción: Editar perfil → toca el círculo de foto → elige una foto de un
    objeto.
  - Esperado: la foto se sube sola (sin tocar "Guardar") y se ve en Perfil, en
    el Feed y en tu perfil público.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-PROFILE-06 — Editar nombre, carrera y campus** · P1
  - Acción: Editar perfil → cambia carrera y campus → "Guardar".
  - Esperado: toast "Cambios guardados" y los datos nuevos se ven en Perfil.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-PROFILE-07 — WhatsApp con selector de país** · P0
  - Acción: Editar perfil → campo de WhatsApp → toca "MX +52", busca "España",
    vuelve a México y escribe un número de 10 dígitos. Guarda. Prueba también
    un número corto (por ejemplo, "81 1234").
  - Esperado: el número válido se guarda y al reabrir aparece igual. El corto
    muestra "Ese número no es válido para México." y "Guardar" se apaga.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-PROFILE-08 — Mis intereses** · P2
  - Acción: Perfil → Mis intereses → cambia la selección → "Guardar".
  - Esperado: toast "Intereses guardados"; "Guardar" está apagado si no cambias
    nada.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-PROFILE-09 — Configuración** · P1
  - Acción: toca el engrane de Perfil.
  - Esperado: se ven Notificaciones (con su estado: Activadas/Desactivadas),
    Privacidad → Usuarios bloqueados, Contacto, la versión de la app y Eliminar
    cuenta. Tocar Notificaciones abre Ajustes de iOS.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: "Aviso de privacidad", "Términos", "Calificar la app" y "Compartir la
    app" están ocultas a propósito (sección 16).

- [ ] **QA-PROFILE-10 — Ayuda y soporte** · P2
  - Acción: Perfil → Ayuda y soporte → Correo.
  - Esperado: se abre una hoja con la opción de Correo; al tocarla se abre Mail
    con asunto y mensaje prellenados. No envíes el correo.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: la opción de WhatsApp de soporte todavía no aparece; es esperado.

- [ ] **QA-PROFILE-11 — Eliminar cuenta (solo cuenta desechable)** · P1
  - Precondición: una cuenta extra, creada solo para esto con un segundo correo
    institucional. **Nunca con tu cuenta principal.**
  - Acción: Configuración → Eliminar cuenta → primero una contraseña incorrecta,
    después la correcta.
  - Esperado: con la incorrecta, "La contraseña no es correcta." y la sesión
    sigue. Con la correcta aparece "Cuenta eliminada"; al continuar llegas al
    inicio sin sesión y esa cuenta ya no puede entrar.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: si no tienes un segundo correo institucional, marca "no probado".

---

## 4. Feed y descubrimiento

- [ ] **QA-FEED-01 — Carga del Feed** · P0
  - Acción: abre la pestaña de inicio.
  - Esperado: en pocos segundos se ven el chip de campus, el buscador,
    "Categorías" y "Recomendado para ti" con tarjetas (foto, precio, título,
    universidad, fecha).
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-FEED-02 — Scroll y refresco** · P0
  - Acción: baja hasta el final de la lista; luego regresa arriba y jala hacia
    abajo para refrescar.
  - Esperado: se cargan más tarjetas al bajar, sin repetidas. Jalar refresca sin
    dejar la pantalla en blanco.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-FEED-03 — Cambiar alcance (campus/universidad/todas)** · P1
  - Acción: toca el chip de campus del Feed → elige otro campus, después una
    universidad entera, después "todas".
  - Esperado: el Feed cambia de contenido según lo elegido. Tu perfil NO cambia
    de campus (verifícalo en Editar perfil).
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-FEED-04 — Alcance sin publicaciones** · P2
  - Acción: elige un campus donde nadie haya publicado.
  - Esperado: mensaje "Nadie ha publicado todavía en …" con botón "Cambiar
    campus", no una pantalla vacía.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-FEED-05 — Detectar campus más cercano** · P2
  - Acción: en "Elige tu campus", toca la opción de detectar tu campus y acepta
    el permiso de ubicación.
  - Esperado: o elige un campus, o dice que no encontró ninguno cerca. Si niegas
    el permiso, aparece un aviso con "Ir a Ajustes". En ningún caso se traba.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: **limitación conocida**: los campus de STAGING pueden no tener
    coordenadas reales, así que "no encontramos ningún campus cerca" no es bug.

- [ ] **QA-FEED-06 — Categorías** · P1
  - Acción: toca una categoría (o "Ver todas" y luego una).
  - Esperado: lista de esa categoría. Ordenar (Recientes, Precio menor/mayor,
    Mejor calificados) cambia el orden. Si no hay nada, aparece un mensaje con
    "Buscar en todas las categorías".
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-FEED-07 — Búsqueda** · P0
  - Acción: pestaña Buscar → escribe parte de una palabra (por ejemplo "calc"
    para "Cálculo") y luego una palabra sin acento.
  - Esperado: aparecen resultados que contienen la palabra, con o sin acento, y
    un contador. Buscar algo inexistente muestra "No encontramos …".
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: hay que escribir al menos 3 letras para que busque por prefijo.

- [ ] **QA-FEED-08 — Filtros** · P1
  - Acción: en Buscar abre Filtros → elige categoría, rango de precio,
    condición y orden → "Aplicar filtros". Quita un chip de filtro con la ✕;
    después "Limpiar todo".
  - Esperado: los resultados respetan los filtros; los chips reflejan lo
    elegido; quitar o limpiar restaura la lista.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-FEED-09 — Recomendados para ti** · P2
  - Acción: abre Buscar sin escribir nada.
  - Esperado: "Recomendados para ti" muestra publicaciones (primero de las
    categorías que elegiste como interés). Nunca aparecen tus propias
    publicaciones.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-FEED-10 — Detalle de publicación** · P0
  - Acción: toca una tarjeta ajena.
  - Esperado: fotos en carrusel, precio, título, condición, descripción,
    universidad, vistas, vendedor y botón "Contactar por WhatsApp". Tocar una
    foto la abre a pantalla completa y se cierra deslizando.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-FEED-11 — Compartir** · P2
  - Acción: en el Detalle toca compartir.
  - Esperado: se abre la hoja de compartir de iOS con un texto de la
    publicación.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: se comparte solo texto, sin enlace; es esperado.

- [ ] **QA-FEED-12 — Perfil público del vendedor** · P1
  - Acción: en el Detalle toca la tarjeta del vendedor.
  - Esperado: su nombre, universidad, antigüedad en Relevo, publicaciones
    activas, calificaciones (si tiene) y botón de WhatsApp.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

---

## 5. Publicaciones

Usa fotos de objetos comunes y textos inventados. El botón para publicar
(círculo con "+") está en la pestaña **Perfil**.

- [ ] **QA-LISTING-01 — Publicar sin WhatsApp guardado** · P1
  - Precondición: una cuenta sin WhatsApp guardado (si la tuya ya lo tiene,
    sáltala).
  - Acción: toca el botón de publicar.
  - Esperado: el formulario pide tu WhatsApp; sin él no se puede publicar.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-LISTING-02 — Crear publicación limpia** · P0
  - Acción: llena Título ("QA Libro de cálculo"), Precio, Categoría, Condición,
    Descripción y agrega 1 a 3 fotos de un objeto. Toca publicar.
  - Esperado: el botón pasa por "Subiendo imágenes" y "Revisando tu
    publicación…", y llega a "Publicación creada". "Ver mi publicación" la abre.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: anota cuántos segundos tardó en total.

- [ ] **QA-LISTING-03 — Validaciones del formulario** · P1
  - Acción: intenta publicar sin título, sin foto, sin categoría o sin
    condición. En Precio intenta escribir más de 100,000 o decimales.
  - Esperado: el botón de publicar queda apagado mientras falte algo; el precio
    no acepta más de 100,000. Precio 0 sí se permite (regalo).
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-LISTING-04 — Límite de 5 fotos** · P1
  - Acción: intenta agregar 6 o más fotos; incluye una captura de pantalla.
  - Esperado: solo se aceptan 5 (contador "5/5"). La captura de pantalla se sube
    bien.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-LISTING-05 — Publicación que queda en revisión** · P1
  - Acción: crea otra publicación limpia, pero en la descripción escribe
    "Escríbeme al 81 1234 5678 o a mi correo".
  - Esperado: lo más probable es que llegue a **"Publicación en revisión"** (la
    revisión automática manda a revisión los datos de contacto en el texto). En
    Mis publicaciones aparece "En revisión" y no se ve en el Feed del otro socio.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: el revisor automático no siempre da el mismo veredicto. Si queda
    publicada, anótalo como observación, no como bug. Esta publicación sirve
    para QA-ADMIN-09.

- [ ] **QA-LISTING-06 — Mis publicaciones** · P0
  - Acción: Perfil → Mis publicaciones.
  - Esperado: aparecen tus publicaciones con su estado (Activa, Pausada, Vendida,
    En revisión). Jalar hacia abajo refresca.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-LISTING-07 — Editar publicación** · P0
  - Acción: abre una publicación tuya activa → Editar → cambia título y precio →
    Guardar.
  - Esperado: "Cambios guardados" y el cambio se ve en el Detalle y en el Feed.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-LISTING-08 — Pausar y reactivar** · P0
  - Acción: en Mis publicaciones abre las acciones de una publicación → Pausar.
    Luego Reactivar.
  - Esperado: toasts "Publicación pausada" / "Publicación reactivada". Pausada,
    el otro socio deja de verla en el Feed y en Buscar; reactivada, vuelve.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-LISTING-09 — Marcar como vendida** · P0
  - Acción: en las acciones elige "Marcar como vendida". Si alguien te contactó,
    aparece en la lista; elige a esa persona o "No fue a través de Relevo".
    Toca "Confirmar venta".
  - Esperado: toast "Publicación marcada como vendida"; aparece como Vendida y ya
    no se puede editar ni reactivar. Si elegiste comprador, se abre Calificar.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: el flujo completo con comprador está en QA-E2E-04.

- [ ] **QA-LISTING-10 — Eliminar publicación** · P0
  - Acción: en una publicación tuya de prueba → Eliminar → confirma.
  - Esperado: toast "Publicación eliminada" y desaparece de Mis publicaciones y
    del Feed. "Cancelar" no borra nada.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-LISTING-11 — Vista del vendedor en el Detalle** · P1
  - Acción: abre el Detalle de una publicación tuya.
  - Esperado: en lugar de "Contactar" ves tus estadísticas (vistas, favoritos,
    contactos) y botones para editar y marcar como vendida.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-LISTING-12 — Salir a mitad de la publicación** · P2
  - Acción: con el formulario lleno, sal sin publicar.
  - Esperado: no se crea ninguna publicación nueva (revisa Mis publicaciones).
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

---

## 6. Favoritos

- [ ] **QA-FAV-01 — Agregar y quitar favorito** · P0
  - Acción: toca el corazón de una tarjeta ajena; luego tócalo otra vez.
  - Esperado: el corazón se llena y se vacía de inmediato, también en el Detalle.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-FAV-02 — Lista de favoritos** · P0
  - Acción: abre la pestaña Favoritos.
  - Esperado: aparecen las publicaciones guardadas; al quitar el corazón ahí
    mismo la tarjeta desaparece. Sin favoritos se ve "Favoritos vacío".
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: las publicaciones vendidas o pausadas no aparecen en esta lista.

- [ ] **QA-FAV-03 — Persistencia** · P1
  - Acción: guarda un favorito, cierra la app por completo y ábrela.
  - Esperado: el favorito sigue ahí, y el contador "Favoritos" de Perfil coincide.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

---

## 7. Contacto comprador-vendedor

No hay chat, pagos ni envíos dentro de la app: el contacto es por WhatsApp y la
compra se acuerda en persona.

- [ ] **QA-CONTACT-01 — Contactar por WhatsApp** · P0
  - Precondición: el vendedor tiene WhatsApp guardado.
  - Acción: en el Detalle de una publicación ajena toca "Contactar por WhatsApp".
  - Esperado: se abre WhatsApp (a veces pasa antes por Safari y pregunta "¿Abrir
    en WhatsApp?") con el número del vendedor y el mensaje "Hola, vi tu
    publicación … en Relevo". No hace falta enviarlo.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-CONTACT-02 — Vendedor sin WhatsApp** · P1
  - Precondición: un vendedor de prueba sin número (si existe en STAGING).
  - Acción: toca "Contactar por WhatsApp".
  - Esperado: aviso "Este vendedor todavía no ha dejado un WhatsApp"; no se abre
    nada.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-CONTACT-03 — WhatsApp desde Perfil público** · P2
  - Acción: en el perfil público de un vendedor toca su botón de WhatsApp.
  - Esperado: abre WhatsApp con su número. (Este contacto no cuenta para
    "¿A quién le vendiste?", porque no es sobre una publicación.)
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

---

## 8. Notificaciones

- [ ] **QA-PUSH-01 — Permiso de notificaciones** · P0
  - Acción: revisa en Ajustes de iOS → RLVO → Notificaciones que estén
    permitidas.
  - Esperado: permitidas (si las negaste, Configuración de la app dice
    "Desactivadas" y lleva a Ajustes).
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: iOS puede pedir el permiso antes de la pantalla "No te pierdas nada";
    está anotado (sección 16).

- [ ] **QA-PUSH-02 — Inbox de notificaciones** · P0
  - Acción: toca la campana del Feed.
  - Esperado: lista de avisos con título, texto y hora. Sin avisos se ve un
    estado vacío. El punto rojo de la campana desaparece al abrirla (todo queda
    como leído).
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-PUSH-03 — Push con la app cerrada** · P0
  - Acción: cierra RLVO por completo y pide al otro socio que provoque un aviso
    (por ejemplo, QA-E2E-02).
  - Esperado: llega la notificación a la pantalla de bloqueo/centro de
    notificaciones en menos de un minuto.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-PUSH-04 — Push con la app en segundo plano y abierta** · P1
  - Acción: repite con la app en segundo plano y luego con la app abierta.
  - Esperado: llega en ambos casos (con la app abierta se ve como banner).
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-PUSH-05 — Abrir un push** · P0
  - Acción: toca la notificación.
  - Esperado: la app abre la publicación relacionada (precio, venta,
    aprobación). Los avisos sin publicación (calificación recibida, respuesta a
    reporte, foto de perfil) abren el inbox.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-PUSH-06 — Tocar un aviso del inbox** · P1
  - Acción: en el inbox toca cada tipo de aviso que tengas.
  - Esperado: baja de precio / se vendió / aprobada / no aprobada → Detalle;
    calificación recibida → tu perfil público; foto de perfil quitada → Editar
    perfil; respuesta a tu reporte → no navega.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-PUSH-07 — Ningún push después de cerrar sesión** · P1
  - Acción: cierra sesión en tu iPhone y pide al otro socio que provoque un aviso
    para tu cuenta.
  - Esperado: tu iPhone no recibe el push (el aviso sí estará en el inbox al
    volver a entrar).
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

Tipos de aviso que existen hoy: baja de precio de un favorito, tu favorito se
vendió, califica tu compra, recibiste una calificación, tu publicación fue
aprobada, tu publicación no fue aprobada/retirada, respuesta a tu reporte y foto
de perfil quitada por revisión.

---

## 9. Bloqueos y seguridad

Se prueba entre dos cuentas: **A** bloquea a **B**. Antes de empezar: B tiene al
menos una publicación activa, A tiene al menos una publicación activa, y A tiene
una publicación de B en favoritos.

- [ ] **QA-BLOCK-01 — Bloquear desde el Detalle** · P0
  - Acción (A): abre una publicación de B → menú "⋯" → "Bloquear usuario" →
    confirma.
  - Esperado: toast de éxito y la pantalla se cierra.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-BLOCK-02 — A deja de ver a B** · P0
  - Acción (A): busca publicaciones de B en Feed, Buscar, Categoría y Favoritos.
  - Esperado: ninguna aparece en ningún lado (el favorito tampoco se muestra).
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-BLOCK-03 — B deja de ver a A** · P0
  - Acción (B): busca las publicaciones de A.
  - Esperado: B tampoco ve las publicaciones de A en ningún lado.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-BLOCK-04 — Perfil público, del lado de A** · P0
  - Acción (A): abre el perfil de B (desde "Usuarios bloqueados" o un aviso
    viejo).
  - Esperado: se ve nombre y calificaciones, sin publicaciones, sin contadores y
    sin WhatsApp; hay un botón "Desbloquear".
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-BLOCK-05 — Perfil público, del lado de B** · P0
  - Acción (B): abre el perfil de A (por ejemplo, desde una calificación o un
    aviso viejo).
  - Esperado: "Este perfil no está disponible.", sin publicaciones ni WhatsApp,
    y **nada indica que A bloqueó a B**.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-BLOCK-06 — Sin contacto ni avisos entre ellos** · P0
  - Acción: con el bloqueo activo, A baja el precio de una publicación que B
    tenía en favoritos (si la hay).
  - Esperado: B no recibe aviso de baja de precio. Ninguno puede abrir el
    WhatsApp del otro desde la app.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-BLOCK-07 — Usuarios bloqueados** · P1
  - Acción (A): Configuración → Privacidad → Usuarios bloqueados.
  - Esperado: aparece B (nombre y foto). Sin bloqueos, se ve el estado vacío.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-BLOCK-08 — Desbloquear y restauración** · P0
  - Acción (A): toca "Desbloquear" en la lista (o en el perfil de B).
  - Esperado: B sale de la lista sin pedir confirmación. Al refrescar, A y B
    vuelven a verse publicaciones, perfiles y WhatsApp; el favorito de A sobre B
    vuelve a aparecer.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-BLOCK-09 — Bloquear desde Perfil público** · P1
  - Acción (A): en el perfil de B → "⋯" → "Bloquear usuario"; luego desbloquear
    desde el mismo menú.
  - Esperado: mismo resultado que QA-BLOCK-01 y QA-BLOCK-08.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-BLOCK-10 — Bloquear dos veces / tocar rápido** · P2
  - Acción: toca dos veces seguidas el botón de confirmar bloqueo.
  - Esperado: sin error ni duplicados; B aparece una sola vez en la lista.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

**Limitaciones conocidas (no son bugs):** las calificaciones entre A y B se
siguen viendo; bloquear no borra reportes, ventas ni avisos anteriores; y
bloquear no impide calificar una venta registrada antes del bloqueo.

---

## 10. Reportes y moderación

- [ ] **QA-REPORT-01 — Reportar una publicación** · P0
  - Acción: en el Detalle de una publicación ajena de prueba → "⋯" → "Reportar
    publicación" → motivo "Es spam o publicidad" → texto "Prueba QA" → "Enviar
    reporte".
  - Esperado: aparece "Gracias por avisarnos", con la opción de bloquear al
    vendedor (elige "Ahora no").
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-REPORT-02 — Reportar un usuario** · P1
  - Acción: en el perfil público de otro socio → "⋯" → "Reportar usuario" →
    motivo y texto "Prueba QA" → enviar.
  - Esperado: "Gracias por avisarnos".
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-REPORT-03 — No puedes reportarte a ti mismo** · P2
  - Acción: abre una publicación tuya.
  - Esperado: el menú no ofrece "Reportar publicación".
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:


---

## 11. Calificaciones

Precondición real: solo se puede calificar cuando hubo contacto por WhatsApp
desde la app **y** el vendedor marcó la venta eligiendo a ese comprador.

- [ ] **QA-REVIEW-01 — El vendedor califica al comprador** · P0
  - Acción: tras "Confirmar venta" con comprador, en Calificar elige estrellas,
    escribe un comentario opcional y "Enviar calificación".
  - Esperado: "¡Gracias por calificar!".
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-REVIEW-02 — El comprador califica al vendedor** · P0
  - Acción (comprador): cierra y abre la app después de la venta.
  - Esperado: "Calificar" se abre sola una vez; también llega el aviso "Califica
    tu compra". Al enviar, "¡Gracias por calificar!".
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-REVIEW-03 — La calificación se ve en el perfil** · P1
  - Acción: abre el perfil público de quien recibió la calificación.
  - Esperado: aparecen el promedio, el número de calificaciones y la reseña. El
    calificado recibe el aviso "recibiste una calificación".
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-REVIEW-04 — "Omitir por ahora"** · P2
  - Acción: en Calificar toca "Omitir por ahora".
  - Esperado: se cierra. **Limitación conocida:** esa compra ya no vuelve a
    abrirse sola.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-REVIEW-05 — Cambiar comprador** · P2
  - Acción (vendedor, antes de calificar): en la publicación vendida →
    "Cambiar comprador" → elige otro contacto → "Guardar cambio".
  - Esperado: "Comprador actualizado". Si el vendedor ya calificó, avisa que no
    se puede cambiar.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: requiere que dos personas hayan contactado; si no, márcala "no
    probado".

---

## 12. Panel de administración

URL: `https://admin.rlvo.com.mx`. El panel apunta a STAGING. Cada acción que
escribe pide un **motivo** y queda en la auditoría para siempre: usa motivos
tipo "Prueba QA TestFlight".

### Acceso

- [ ] **QA-ADMIN-01 — Login con contraseña y app autenticadora** 🟢 · P0
  - Acción: entra con tu correo de admin, contraseña y el código de 6 dígitos de
    tu app autenticadora.
  - Esperado: entra al panel en la sección Reportes.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-ADMIN-02 — Código incorrecto** 🟢 · P1
  - Acción: escribe un código de 6 dígitos equivocado.
  - Esperado: error claro, no entra.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-ADMIN-03 — Sesión larga (más de 12 horas)** 🟢 · P2
  - Acción: deja el panel abierto más de 12 horas y luego abre un reporte.
  - Esperado: el panel te pide de nuevo el código de tu app autenticadora y
    después continúa.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

### Reportes

- [ ] **QA-ADMIN-04 — Lista de reportes y filtros** 🟢 · P0
  - Acción: abre Reportes y cambia entre Pendientes, Resueltos, Descartados y
    Todos.
  - Esperado: la lista cambia; cada estado vacío tiene su mensaje.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-ADMIN-05 — Detalle de un reporte** 🟢 · P0
  - Acción: abre el reporte de QA-REPORT-01.
  - Esperado: se ven motivo, comentario, quién reportó, la publicación con sus
    fotos y los botones "Ver publicación" / "Ver cuenta del dueño".
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-ADMIN-06 — Resolver o descartar** 🟡 · P0
  - Acción: solo sobre reportes "Prueba QA": escribe un motivo y toca "Resolver"
    (o "Descartar").
  - Esperado: el reporte cambia de estado, muestra su auditoría y quien reportó
    recibe el aviso de respuesta en la app.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

### Moderación y publicaciones

- [ ] **QA-ADMIN-07 — Cola de moderación** 🟢 · P1
  - Acción: abre Moderación y cambia entre "Evaluadas" y "Sin evaluar".
  - Esperado: se ven las publicaciones en revisión con el veredicto automático.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-ADMIN-08 — Detalle de publicación** 🟢 · P1
  - Acción: abre una publicación desde la cola o desde un reporte.
  - Esperado: fotos, datos, dueño y por qué la revisión automática la marcó.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-ADMIN-09 — Aprobar publicación** 🟡 · P0
  - Acción: solo sobre la publicación de QA-LISTING-05 → "Aprobar publicación"
    → motivo → confirmar.
  - Esperado: sale de la cola; el dueño recibe "tu publicación fue aprobada" y
    el otro socio ya la ve en el Feed.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-ADMIN-10 — Bloquear publicación** 🟡 · P1
  - Acción: solo sobre una publicación "QA" creada para esto → "Bloquear
    publicación" → motivo.
  - Esperado: deja de verse en la app; el dueño recibe el aviso y en Mis
    publicaciones la ve "Bloqueada", con eliminar como única acción.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: **desde el panel no se puede desbloquear**; úsala solo con una
    publicación desechable.

### Usuarios

- [ ] **QA-ADMIN-11 — Buscar usuarios** 🟢 · P1
  - Acción: Usuarios → busca por nombre o correo; sin texto, toca "Buscar".
  - Esperado: resultados correctos; sin texto, las cuentas más recientes. Los
    admins llevan la etiqueta "Admin".
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-ADMIN-12 — Detalle de usuario** 🟢 · P1
  - Acción: abre una cuenta.
  - Esperado: estado, publicaciones por estado e historial de acciones.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-ADMIN-13 — Suspender y reactivar** 🟡 · P1
  - Acción: **solo con una cuenta creada para esto** (nunca la de un socio ni la
    de un admin): suspender con motivo; en la app, esa cuenta intenta publicar,
    contactar y reportar; luego reactivar.
  - Esperado: suspendida, sus publicaciones activas se pausan y la app le impide
    publicar, contactar y reportar (con avisos). Reactivada puede volver a
    hacerlo, pero **sus publicaciones siguen pausadas** hasta que las reactive.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: si no hay cuenta desechable, márcala "no probado".

- [ ] **QA-ADMIN-14 — Restablecer app autenticadora de otro admin** 🔴
  - **No ejecutar en esta ronda.** Solo verifica que el botón exista en la cuenta
    de otro admin y que en tu propia cuenta no aparezca.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

### Catálogo

- [ ] **QA-ADMIN-15 — Ver catálogo** 🟢 · P1
  - Acción: Catálogo → abre una universidad.
  - Esperado: se ven sus campus, dominios (activo/inactivo) y su auditoría.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-ADMIN-16 — Validaciones sin guardar** 🟢 · P2
  - Acción: abre "Agregar dominio", escribe `gmail.com` o un dominio que ya
    exista, con motivo, y envía.
  - Esperado: el panel lo rechaza con un mensaje claro y no guarda nada.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-ADMIN-17 — Crear/editar universidades, campus y dominios** 🔴
  - **No ejecutar.** Las universidades y campus no se pueden borrar, y
    desactivar un dominio real impide registrarse con él.

### Métricas

- [ ] **QA-ADMIN-18 — Métricas** 🟢 · P2
  - Acción: Métricas → cambia entre 7, 30 y 90 días y filtra por universidad.
  - Esperado: las cifras cambian; los días sin registro dicen "Sin datos" (no
    es lo mismo que 0).
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: las cifras son de cuentas de prueba; los admins no se cuentan.

---

## 13. Pruebas entre dos socios

Socio A = vendedor, Socio B = comprador (salvo que se diga otra cosa). Ambos en
la misma universidad o con el alcance del Feed en "todas".

- [ ] **QA-E2E-01 — A publica, B la encuentra** · P0
  - Precondición: A tiene WhatsApp guardado.
  - Socio A: publica "QA Mochila" con foto.
  - Socio B: la busca por "mochi" en Buscar y la abre.
  - Esperado: B la encuentra en menos de un minuto y ve fotos, precio y vendedor
    correctos.
  - Cleanup: ninguno (se reutiliza en los siguientes).
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-E2E-02 — Favorito y baja de precio** · P0
  - Precondición: QA-E2E-01.
  - Socio B: marca "QA Mochila" como favorito y cierra la app.
  - Socio A: edita la publicación y baja el precio.
  - Esperado: B recibe un push "… ahora cuesta $X, antes $Y"; al tocarlo abre la
    publicación con el precio nuevo.
  - Cleanup: ninguno.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-E2E-03 — B contacta, A lo ve** · P0
  - Socio B: en "QA Mochila", "Contactar por WhatsApp" (no hace falta enviar).
  - Socio A: abre su publicación → "Marcar como vendida".
  - Esperado: B aparece en la lista "¿A quién le vendiste?"; en el Detalle de A
    el contador de contactos subió.
  - Cleanup: A no confirma todavía (sigue en QA-E2E-04).
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-E2E-04 — Venta y calificaciones cruzadas** · P0
  - Socio A: elige a B y "Confirmar venta"; califica a B.
  - Socio B: recibe "Califica tu compra"; al reabrir la app se le abre Calificar;
    califica a A.
  - Esperado: la publicación queda Vendida para los dos (B ve el aviso de
    vendida en el Detalle). Cada uno ve la calificación del otro en su perfil
    público y recibe el aviso de calificación.
  - Cleanup: ninguno (las calificaciones no se borran).
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-E2E-05 — Reporte de app a panel** · P0
  - Socio B: reporta una publicación "QA" de A con comentario "Prueba QA".
  - Socio A (en el panel): encuentra el reporte en Pendientes, lo abre y lo
    resuelve con motivo "Prueba QA TestFlight".
  - Esperado: el reporte pasa a Resueltos con su auditoría; B recibe el aviso de
    respuesta a su reporte en la app.
  - Cleanup: ninguno.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-E2E-06 — Revisión y aprobación** · P1
  - Socio A: publica con datos de contacto en la descripción (QA-LISTING-05).
  - Socio B (en el panel): la encuentra en Moderación y la aprueba con motivo.
  - Esperado: A recibe "tu publicación fue aprobada" y B la ve en el Feed.
  - Cleanup: A la elimina al terminar.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: si la publicación quedó publicada sin revisión, márcala "no probado".

- [ ] **QA-E2E-07 — Favorito que se vende** · P1
  - Precondición: B tiene en favoritos otra publicación de A; un tercero no hace
    falta.
  - Socio A: la marca como vendida con "No fue a través de Relevo".
  - Esperado: B recibe el aviso "se vendió" y la publicación sale de sus
    Favoritos.
  - Cleanup: ninguno.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-E2E-08 — Bloqueo y restauración** · P0
  - Socio A: bloquea a B (sección 9).
  - Socio B: confirma que no ve a A y que el perfil de A dice "no disponible".
  - Socio A: desbloquea.
  - Esperado: todo vuelve a verse en los dos teléfonos tras refrescar.
  - Cleanup: confirmar que "Usuarios bloqueados" de A queda vacía.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-E2E-09 — Pausar oculta, reactivar muestra** · P1
  - Socio A: pausa una publicación activa.
  - Socio B: la busca; luego A la reactiva y B refresca.
  - Esperado: pausada no aparece para B; reactivada vuelve a aparecer.
  - Cleanup: ninguno.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

---

## 14. UI/UX

- [ ] **QA-UX-01 — Textos cortados** · P1
  - Acción: recorre todas las pantallas buscando textos que se corten o encimen
    (títulos largos, nombres largos, precios grandes como $100,000).
  - Esperado: nada cortado de forma que se pierda información.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-UX-02 — Teclado** · P0
  - Acción: en Publicar, Editar perfil, Reportar y Eliminar cuenta, toca los
    campos de abajo.
  - Esperado: el teclado nunca tapa el campo que estás escribiendo ni el botón
    principal.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-UX-03 — Bordes del iPhone (notch / isla dinámica)** · P1
  - Acción: revisa la parte superior e inferior de cada pantalla y de las hojas
    que suben desde abajo.
  - Esperado: nada queda debajo de la isla dinámica ni de la barra de inicio.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-UX-04 — Botones y estados de carga** · P1
  - Acción: observa los botones al publicar, guardar o enviar.
  - Esperado: mientras trabajan muestran "…" o puntos y no se pueden tocar dos
    veces; las listas muestran esqueletos grises al cargar.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-UX-05 — Imágenes** · P1
  - Acción: revisa fotos en Feed, Detalle, Favoritos y Perfil.
  - Esperado: cargan, no se deforman y no se ve la foto de otra publicación.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-UX-06 — Modo oscuro del iPhone** · P2
  - Acción: activa el modo oscuro en Ajustes de iOS y abre la app.
  - Esperado: todo sigue legible. (La app se diseñó en colores claros; si algún
    texto o barra se ve mal, anótalo como S3.)
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-UX-07 — Tamaño de texto grande** · P2
  - Acción: Ajustes → Pantalla y brillo → Tamaño del texto al máximo; abre la
    app.
  - Esperado: se puede usar; anota pantallas donde se rompa.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: ya sabemos que Perfil corta texto con letra grande.

- [ ] **QA-UX-08 — Otro tamaño de iPhone** · P2
  - Acción: si tienen iPhones de tamaños distintos, repite Feed, Detalle y
    Publicar en los dos.
  - Esperado: se ven bien en ambos.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas: anota el modelo.

- [ ] **QA-UX-09 — Rendimiento percibido** · P1
  - Acción: usa la app 10 minutos seguidos.
  - Esperado: el Feed carga en unos 2 segundos con buena señal; el scroll es
    fluido; no se calienta ni se cierra.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

La app solo funciona en vertical (no gira), es esperado. En iPad, si TestFlight
permite instalarla, corre como app de iPhone ampliada; eso **no** es bug.

---

## 15. Red y recuperación

No hagas pruebas de carga ni de abuso: solo uso normal con mala señal.

- [ ] **QA-NET-01 — Sin conexión al abrir** · P1
  - Acción: activa modo avión y abre la app (con sesión).
  - Esperado: mensajes de error con "Reintentar"; sin crash. Al quitar modo avión
    y tocar "Reintentar", carga normal.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-NET-02 — Perder conexión a mitad de una acción** · P1
  - Acción: activa modo avión justo antes de guardar un favorito, editar el
    perfil o enviar un reporte.
  - Esperado: aviso de error; nada queda a medias (al volver la red, el estado
    es coherente después de refrescar).
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-NET-03 — Publicar con mala señal** · P1
  - Acción: publica con poca señal o cambiando de Wi-Fi a datos durante la
    subida.
  - Esperado: o termina bien, o muestra un error con opción de reintentar. Si
    falla, revisa Mis publicaciones: no deben quedar duplicados.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-NET-04 — Segundo plano y regreso** · P1
  - Acción: deja la app en segundo plano 10+ minutos (y otra vez varias horas) y
    regresa.
  - Esperado: vuelve donde estabas o al Feed, con datos actualizados al
    refrescar; sin pantalla en blanco y sin pedir login.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

- [ ] **QA-NET-05 — Doble toque y refresco repetido** · P2
  - Acción: toca dos veces rápido "Publicar", "Guardar", "Enviar reporte",
    "Confirmar venta"; jala para refrescar varias veces seguidas.
  - Esperado: una sola acción (sin publicaciones o reportes duplicados) y
    ningún error por refrescar.
  - Resultado: ⬜ PASS / ⬜ FAIL
  - Notas:

---

## 16. Qué NO probar todavía (no son bugs)

- **PROD / producción:** no existe todavía. Todo es STAGING.
- **Android:** no hay versión de Android en esta ronda.
- **Pagos, chat, envíos o comisiones:** no existen en esta fase; el contacto es
  por WhatsApp y la compra en persona.
- **Pantalla de carga inicial y algunos colores/íconos:** tienen valores
  provisionales.
- **Aviso de privacidad, Términos, "Calificar la app" y "Compartir la app":**
  ocultos en Configuración hasta que existan las versiones finales. El texto
  "Al continuar aceptas…" del registro todavía no tiene enlace.
- **Confirmación de mayoría de edad (18+):** pendiente de decisión.
- **"Verificación"** en el menú de Perfil: aún no hace nada.
- **WhatsApp de soporte:** solo existe el correo de soporte.
- **Compartir con enlace:** se comparte solo texto.
- **Momento en que iOS pide el permiso de notificaciones:** puede salir antes de
  la pantalla que lo explica.
- **"Detectar campus":** las coordenadas de campus en STAGING pueden no ser
  reales.
- **Aviso dentro de la app al ser suspendido** y **motivo de "no aprobada"**:
  todavía no se muestran.
- **Desbloquear una publicación desde el panel:** no existe.
- **Historial de búsquedas:** no se guarda, a propósito.
- **El inbox no pagina:** con muchísimos avisos podría ser largo.
- **Datos viejos de STAGING:** hay publicaciones antiguas sin foto, cuentas de
  correo personal anteriores al filtro de dominios y avisos viejos que nunca se
  enviaron como push. No los reporten.
- **El nombre "Relevo"** aparece en algunos textos de la app y el ícono dice
  "RLVO": anótenlo solo si les parece confuso, como S3.

---

## Cómo reportar un bug

Copia esta plantilla por cada fallo:

### Reporte de bug

- ID de prueba:
- Severidad:
- Dispositivo:
- Versión iOS:
- Build RLVO: 1.0.0 (3)
- Cuenta de prueba: (solo el nombre que aparece en la app, no el correo completo)
- Hora aproximada:
- Pasos:
- Resultado obtenido:
- Resultado esperado:
- ¿Reproducible?: siempre / a veces / una vez
- Captura/video:

**Severidad:**

| Nivel | Significa |
|---|---|
| **S0** | La app se cierra (crash), se pierden datos, o un problema de seguridad (ves datos que no deberías) |
| **S1** | Un flujo principal está bloqueado (no se puede registrar, publicar, contactar…) |
| **S2** | Algo funciona mal, pero hay forma de rodearlo |
| **S3** | Visual o de pulido |

**Nunca incluyas** contraseñas, códigos de verificación, códigos de la app
autenticadora, tokens, números de teléfono ajenos ni datos personales sensibles.
Si una captura los muestra, tápalos antes de enviarla.

---

## Resumen ejecutivo

Actualízalo a mano conforme avancen.

| Área | P0 totales | PASS | FAIL | Pendientes |
|---|---|---|---|---|
| 1. Instalación | 3 | | | |
| 2. Autenticación | 8 | | | |
| 3. Perfil | 3 | | | |
| 4. Feed | 4 | | | |
| 5. Publicaciones | 6 | | | |
| 6. Favoritos | 2 | | | |
| 7. Contacto | 1 | | | |
| 8. Notificaciones | 4 | | | |
| 9. Bloqueos | 7 | | | |
| 10. Reportes | 1 | | | |
| 11. Calificaciones | 2 | | | |
| 12. Panel admin | 5 | | | |
| 13. Entre socios | 6 | | | |
| 14. UI/UX | 1 | | | |
| 15. Red | 0 | | | |
| **Total** | **53** | | | |
