# Versión legal `staging-prueba` (PL-016, solo STAGING)

Archivo permanente de los dos documentos que STAGING carga en
`public.documentos_legales` como versión `staging-prueba`
(migración `20261026000490`). Cada fila de esa tabla apunta a una URL y guarda
un `contenido_sha256`; esta carpeta es lo que hace comprobable, después, qué
texto exacto se le mostró a quien aceptó.

| Archivo | Qué es |
|---|---|
| `terminos.html` | Bytes exactos servidos por `https://www.rlvo.com.mx/terminos` |
| `privacidad.html` | Bytes exactos servidos por `https://www.rlvo.com.mx/privacidad` |
| `SHA256SUMS` | sha256 de los dos HTML (`shasum -a 256 -c SHA256SUMS`) |
| `insert-staging.sql` | El `insert` de las dos filas, con esos mismos hashes |

## Procedencia

- Descargados el **2026-10-27** con `curl -s https://www.rlvo.com.mx/<ruta>`
  (sitio en Cloudflare, `cf-cache-status: HIT`, `content-type: text/html`).
- Comprobado ese día: las cuatro variantes de petición (curl simple, UA de
  navegador con `Accept: */*`, con `Accept: text/html` y con
  `Sec-Fetch-Dest: document`) devuelven los MISMOS bytes, así que el hash no
  depende de quién pida la página. El HTML es estático (Astro): el texto
  visible está en el archivo, no lo pinta un script.
- Los dos son **borradores**: dicen "Borrador…" y llevan marcadores
  `[[POR CONFIRMAR: …]]`, sin fecha de actualización. No sirven para PROD.
- El HTML trae, en el fuente, el snippet de Cloudflare Web Analytics
  (`static.cloudflareinsights.com/beacon.min.js`).
- `.gitattributes` (`* -text`, carpeta de arriba) impide que Git convierta
  fines de línea: si los bytes cambian, el hash deja de coincidir.

## Hash del HTML vs. hash del texto canónico

- **Hash del HTML**: sha256 de los bytes que sirve la URL. Cambia con
  cualquier cambio de plantilla, menú, estilos referenciados por nombre,
  scripts o espacios, aunque el documento no cambie. Prueba "esto es lo que
  se sirvió", no "este es el documento".
- **Hash del texto canónico**: sha256 de un archivo de texto que ES el
  documento (el que aprueba el abogado), independiente de la página que lo
  muestra. Es lo que pide la migración (`20261026000490`, comentario de
  `documentos_legales`, decisión V1 de `docs/pl-016-plan.md`).

**En STAGING (`staging-prueba`) se usa el hash del HTML**, por decisión del
usuario (2026-10-27): no existe texto canónico para estos borradores. Es una
excepción documentada a V1, válida solo para esta versión de prueba.

## Qué tiene que cambiar para PROD (PL-001, PL-008)

1. **Texto canónico aprobado por el abogado** (PL-008), sin marcadores, con
   su fecha. Se archiva en `docs/legal/versiones/<version>/` como UTF-8 (NFC),
   fines de línea LF y un salto final, y `contenido_sha256` es el sha256 de
   ESE archivo. Se puede archivar también el HTML publicado, con su propio
   hash, como evidencia de lo servido.
2. **URL inmutable por versión.** Hoy `/terminos` y `/privacidad` muestran
   siempre la última versión, así que una aceptación vieja apuntaría a un
   texto distinto del aceptado. Condición 2 de la aprobación de PL-016:
   proponer la estrategia de versionado de rutas antes de implementarla.
3. **Nombre de versión real** (p. ej. una fecha), nunca `staging-prueba`, y
   su propio `insert`, revisado aparte. Este `insert-staging.sql` no se reusa.
4. **Ninguna fila se edita** (trigger `documento_legal_inmutable`): una
   corrección es una versión nueva.
