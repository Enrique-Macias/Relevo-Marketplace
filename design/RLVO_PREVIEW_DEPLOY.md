# Publicación del prototipo RLVO en Cloudflare Pages

Proyecto existente: **`rlvo-design-preview`**. Ejecutar los comandos desde la raíz del repositorio, con Node 22 y el Wrangler ya autenticado.

## Preparar y validar sin publicar

```sh
npm run build:rlvo-preview
npm run check:rlvo-preview
```

El build regenera únicamente `dist/rlvo-preview/`. La validación comprueba archivos, rutas HTTP con un servidor temporal en `127.0.0.1`, logos, los frames y el JavaScript del filtro/editor/carrusel en un entorno simulado de Node. No abre navegador ni prueba la renderización visual.

## Publicar o actualizar

```sh
npm run deploy:rlvo-preview
```

Este comando vuelve a generar y validar el paquete antes de ejecutar:

```sh
npx --no-install wrangler pages deploy dist/rlvo-preview --project-name=rlvo-design-preview
```

No crea proyectos, hace commits ni push. Wrangler usa su selección habitual de rama Git; actualmente la rama local es `main`. Para seleccionar otra rama explícitamente:

```sh
npm run deploy:rlvo-preview -- --branch=NOMBRE_DE_RAMA
```

La URL que indique Wrangler al terminar es la referencia del despliegue. La URL principal depende de la rama de producción configurada en el proyecto. No se ha ejecutado ningún despliegue durante esta preparación.

`--no-install` utiliza el Wrangler disponible y evita instalar paquetes automáticamente. La preparación y validación solo usan módulos incorporados de Node; no se añadieron dependencias.

## Contenido del paquete

- `index.html`: el prototipo completo, sin redirección intermedia; sus logos apuntan a `./assets/brand/`.
- `design/rlvo-app.html`: la copia publicable, conservando las rutas relativas `../assets/brand/`.
- Tres SVG oficiales referenciados: variantes 02, 07 y 16, copiados byte por byte.
- `404.html`: respuesta para rutas inexistentes, sin fallback de SPA que oculte recursos faltantes.
- `_headers`: indica `noindex, nofollow`.

El CSS y JavaScript del prototipo permanecen integrados. Las fuentes siguen cargándose desde Google Fonts; no hay fuentes locales referenciadas y el build no descarga fuentes. Sin conexión se aplican los fallbacks tipográficos del HTML original.

El script copia solo dependencias explícitas de `assets/brand/`, rechaza rutas locales fuera de esa lista y no copia carpetas completas. Ante una nueva dependencia local, se debe revisar y ampliar deliberadamente esa lista. Recursos remotos permitidos: Google Fonts. No se leen ni incluyen `.env`, código de la app, Supabase, documentación, paquetes de Node, credenciales o configuraciones de Wrangler.

Los comentarios no renderizados de HTML/CSS/JS se retiran de las copias publicables. Las variantes y anotaciones **visibles** de los frames se conservan porque son parte del prototipo solicitado. Los archivos fuente y SVG originales no se modifican.

`dist/` ya está excluido por `.gitignore`. No agregar el paquete generado a Git. Solo versionar, cuando se autorice, el script y los comandos de preparación.

Referencias: [Direct Upload con Wrangler](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/), [comandos de Pages](https://developers.cloudflare.com/workers/wrangler/commands/pages/), [rutas y respuesta 404](https://developers.cloudflare.com/pages/configuration/serving-pages/).
