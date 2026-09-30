# RLVO — Privacy Specification

Status: Product specification
Legal review: Required before production

Este documento define el contenido factual que deberá reflejar el Aviso de Privacidad de RLVO.

No debe utilizarse para inventar cláusulas jurídicas.

La fuente factual principal es:

`docs/LEGAL_FACTS.md`

---

# Objetivo

El Aviso de Privacidad deberá explicar de forma clara:

1. quién trata los datos;
2. qué información recopila RLVO;
3. para qué la utiliza;
4. qué información se muestra a otros usuarios;
5. qué proveedores intervienen;
6. cómo funciona la moderación;
7. qué información se conserva;
8. cómo funciona la eliminación;
9. cómo ejercer derechos sobre datos personales;
10. cómo contactar a RLVO.

---

# Responsable

El responsable definitivo todavía depende de la constitución de la sociedad.

No inventar razón social.

No inventar domicilio.

Hasta resolverlo, mantener un marcador explícito de revisión jurídica/corporativa.

Canal confirmado:

privacidad@rlvo.com.mx

---

# Usuarios

RLVO está dirigido exclusivamente a mayores de 18 años.

No se permiten menores.

---

# Categorías de datos

## Cuenta

- correo institucional;
- credenciales gestionadas mediante Supabase Auth;
- ID interno;
- fecha de registro;
- último inicio de sesión;
- token push.

## Perfil

- nombre;
- universidad;
- campus;
- foto opcional;
- carrera opcional;
- intereses opcionales;
- calificación;
- reseñas.

## Teléfono

El teléfono de WhatsApp es necesario para publicar.

No se muestra públicamente.

Se entrega únicamente cuando otro usuario activo selecciona la función de contacto correspondiente.

## Publicaciones

- título;
- descripción;
- precio;
- categoría;
- condición;
- fotografías;
- universidad;
- campus;
- estado;
- fechas;
- vistas;
- moderación.

## Interacciones

- favoritos;
- contactos iniciados;
- publicaciones creadas;
- relación comprador/vendedor cuando se registra una venta;
- reseñas;
- reportes.

## Información técnica

Sentry puede procesar información técnica necesaria para diagnóstico de errores y rendimiento.

Debe configurarse para evitar datos personales innecesarios.

---

# Finalidades

Las finalidades deberán incluir, según corresponda:

- crear y administrar cuentas;
- verificar acceso a un correo institucional;
- asignar universidad;
- mostrar perfiles;
- permitir publicaciones;
- permitir descubrimiento de productos;
- permitir contacto entre usuarios;
- administrar favoritos;
- registrar ventas;
- permitir reseñas;
- moderar contenido;
- prevenir abuso;
- gestionar reportes;
- aplicar suspensiones;
- detectar reincidencias;
- personalizar recomendaciones;
- enviar notificaciones operativas;
- prestar soporte;
- mantener seguridad y estabilidad técnica;
- cumplir obligaciones legales aplicables.

No añadir finalidades publicitarias que no existan.

RLVO no realiza marketing por correo actualmente.

---

# Datos públicos y privados

Públicos para otros usuarios:

- nombre;
- foto;
- universidad;
- campus;
- calificación;
- reseñas;
- carrera cuando corresponda;
- publicaciones.

Privados:

- correo institucional;
- contraseña;
- teléfono hasta que exista una acción explícita de contacto;
- tokens push;
- información administrativa;
- registros internos de moderación.

---

# Verificación universitaria

La verificación solamente demuestra acceso a un correo perteneciente a un dominio institucional admitido.

No constituye verificación de identidad.

No garantiza condición actual de estudiante.

No implica respaldo de ninguna universidad.

---

# WhatsApp

Cuando un usuario decide contactar a un vendedor:

1. RLVO obtiene el número necesario para realizar esa acción;
2. abre WhatsApp en el dispositivo;
3. el contacto continúa fuera de RLVO.

RLVO registra internamente el toque de contacto asociado al usuario, publicación y fecha.

El Aviso deberá distinguir entre:

- el tratamiento realizado por RLVO;
- el tratamiento que posteriormente pueda realizar WhatsApp/Meta bajo sus propios términos cuando el usuario utiliza ese servicio.

---

# Ubicación

La ubicación aproximada solamente se solicita cuando el usuario activa:

"Detectar campus más cercano."

El cálculo ocurre en el dispositivo.

RLVO no almacena ni transmite esa ubicación a su backend.

No afirmar que RLVO almacena geolocalización.

---

# Personalización

"Recomendados para ti" puede utilizar:

- intereses;
- favoritos;
- contactos de los últimos 90 días.

No utiliza machine learning.

---

# Moderación

RLVO puede enviar contenido a proveedores especializados.

OpenAI:
- título;
- descripción.

Google Cloud Vision:
- fotografías de publicaciones;
- avatar;
- OCR.

Amazon Rekognition:
- fotografías de publicaciones.

La finalidad es detectar contenido que incumpla las políticas de RLVO.

Antes del primer procesamiento correspondiente se mostrará al usuario información específica sobre proveedores, datos enviados y finalidad.

La acción y versión aceptada se registrarán.

Este mecanismo deberá ser revisado jurídicamente antes de producción.

---

# Decisiones y revisión

Algunos contenidos claramente prohibidos pueden bloquearse automáticamente.

Casos dudosos pueden pasar a revisión humana.

RLVO conserva registros mínimos de moderación durante 12 meses cuando sea necesario para reincidencias y disputas.

No afirmar que toda moderación es exclusivamente automática.

---

# Reportes

Los reportes pueden incluir:

- motivo;
- comentario;
- reportante;
- objeto reportado;
- fecha;
- estado;
- snapshot necesario.

El usuario reportado no conoce la identidad del reportante.

Retención definida:

12 meses después de resolución.

---

# Conservación

## Mientras exista la cuenta

Se conservan los datos necesarios para prestar el servicio.

## Publicación eliminada

Se elimina junto con sus fotografías.

Puede conservarse un registro mínimo de moderación sin fotografías durante 12 meses cuando exista una infracción.

## Reportes

12 meses después de su resolución.

## Moderación

Registro mínimo:
12 meses.

## Recomendaciones

Contactos/favoritos relevantes:
ventana de 90 días para la personalización descrita.

## Cuenta suspendida eliminada

Puede conservarse indefinidamente un hash SHA-256 del correo para impedir re-registro.

Esta última regla requiere validación jurídica antes del lanzamiento.

---

# Eliminación de cuenta

Ruta:

Perfil → Configuración → Eliminar cuenta

Confirmación:
contraseña.

Periodo de espera:
ninguno.

Al eliminar:

- perfil;
- correo;
- teléfono;
- fotos;
- publicaciones;
- favoritos;
- contactos;
- intereses;
- push tokens;
- reseñas recibidas;
- registro de comprador;
- referencias personales correspondientes;

deben eliminarse según el flujo definido.

Pueden permanecer:

- estrellas anonimizadas de reseñas escritas;
- reportes anonimizados;
- registro mínimo de moderación durante su periodo;
- hash del correo si la cuenta estaba suspendida.

---

# Derechos sobre datos personales

Canal:

privacidad@rlvo.com.mx

El documento final deberá explicar el procedimiento aplicable para ejercer derechos ARCO y cualquier otro derecho correspondiente bajo legislación mexicana vigente.

No inventar:

- plazos legales;
- documentación obligatoria;
- excepciones;
- requisitos jurídicos.

Estos elementos deberán validarse con abogado.

---

# Proveedores

El Aviso deberá contemplar cuando corresponda:

- Supabase;
- OpenAI;
- Google Cloud Vision;
- Amazon Rekognition;
- Sentry;
- Expo/EAS;
- Apple;
- Google;
- Google Workspace;
- Cloudflare;
- Squarespace;
- WhatsApp/Meta.

La clasificación jurídica de cada proveedor deberá revisarse antes de publicar el Aviso definitivo.

---

# Sitio web

Actualmente rlvo.com.mx:

- no recopila información mediante formularios;
- no utiliza analytics;
- no tiene waitlist;
- no utiliza cookies no esenciales.

Si se incorpora cualquiera de estas funciones, revisar este documento antes de desplegar.

---

# Cambios

Cambios sustanciales relacionados con:

- categorías de datos;
- finalidades;
- proveedores;

deben provocar revisión del Aviso y, cuando corresponda, nueva acción del usuario.

---

# Pendientes jurídicos

Antes de producción deben validarse:

- identidad jurídica del responsable;
- domicilio;
- fundamento de cada tratamiento;
- procedimiento ARCO;
- plazos legales aplicables;
- clasificación de proveedores;
- transferencias nacionales/internacionales;
- conservación indefinida del hash;
- mecanismo de aceptación para proveedores de moderación;
- versión final del Aviso.