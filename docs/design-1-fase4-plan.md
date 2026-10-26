# DESIGN-1, fase 4: categoría `Alimentos` y CRUD de categorías en el panel

Estado: **EN STAGING (2026-10-26)**: migración aplicada con readback igual a
local, tipos `--linked`, pruebas del usuario en iPhone, Android y el panel, y
el panel desplegado (`cea07690`, `078c401`). La evidencia está en `CLAUDE.md`
§8, "Hecho". PROD sigue pendiente (PL-001). Antes era:
IMPLEMENTADO Y PROBADO EN LOCAL (2026-10-25).
D1-D4 decididas (abajo). Los 4 frames del panel (`data-cat="categorias"`, 41 en
total) los aprobó el usuario el 2026-10-25. Evidencia local:
- `rls.sql` 736/736 (T41, 21 aserciones). Los 24 controles negativos se
  corrieron uno a la vez, contra la suite y contra T41 aislada, y cada uno cae
  en su aserción. Las excepciones esperadas son el `grant execute` a anon (cae
  en T12 dentro de la suite y en (e2) aislada) y el EXECUTE de la función de
  trigger (cae solo en T12).
- `probe-admin` 118/118 (caso 12, 13 pruebas). Sus controles: sin el trigger
  de intereses cae en 12g, y sin la rama de «Otros» cae en 12b.
- `registro` 55, `storage` 41, `venta` 13, `actividad` 15, `bloqueos` 24,
  `perfil` 90, `moderacion` 166, `ubicacion` 9 y `puerta-totp` 11.
- `tsc`, `lint`, `check:functions` y `check:admin`, limpios.
- Falta la prueba en dispositivo y del panel en local, que hace el usuario.

## Por qué no basta con "insertar una fila"

Medido en el repo:

- `public.categories` es `(id bigint identity, nombre text unique)`, con
  `grant select` a nivel de tabla para `authenticated`
  (`20260906000437:60, 93-97`). No tiene `orden`, `icono` ni `activa`.
- El cliente ordena por `id` (`src/lib/categorias.ts`, `fetchCategorias`). Una
  fila nueva tendría id 13 y quedaría DESPUÉS de "Otros". El diseño la pone
  antes.
- El ícono sale del NOMBRE (`slugCategoria(nombre)` → llave de `PATHS` en
  `src/components/icons/categories.tsx`; si no está, cae a `otros`). Así que,
  con un CRUD:
  - renombrar una categoría desde el panel le quitaría el ícono;
  - una categoría creada desde el panel nunca tendría ícono propio.
- `listings.categoria_id` no tiene cascade (`…439`): borrar una categoría con
  publicaciones falla con 23503. `user_intereses.categoria_id` sí es cascade
  (`…475:34`): borrar una sin publicaciones se llevaría los intereses en
  silencio.
- `admin.detalle_listing` (`…479`) y `admin.cola_moderacion` (`…481`) hacen left
  join a `categories` por el nombre. La moderación (`moderar-contenido`) no usa
  las categorías de publicación (grep: sus "categorías" son las de
  SafeSearch, GPT y Rekognition).

## Propuesta (las decisiones abiertas van al final)

### 1. Migración `20261025000489_categorias_admin.sql`

- **Columnas nuevas en `categories`**:
  - `orden int not null`, único: el orden del catálogo en la app.
  - `icono text not null`, con un CHECK contra la lista CERRADA de llaves que la
    app sabe pintar (las 12 de hoy más `alimentos`).
  - `activa boolean not null default true`.
  - Backfill: `orden` = el `id` de hoy e `icono` = el slug de hoy, ANTES de los
    `not null`.
- **Forma del nombre**: el mismo patrón de la Ola 5 (normalizado, de 2 a 50
  caracteres) y un índice único sobre `lower(nombre)`. Antes del push se mide
  en remoto que ningún nombre lo viole.
- **`Alimentos`**: entra con `orden` justo antes de "Otros" (Otros se recorre
  uno), icono `alimentos` y activa. También va en `supabase/seed.sql`, con el
  mismo `on conflict do nothing`.
- **Grants**: `categories` ya tiene `select` de tabla, que cubre las columnas
  nuevas (mismo caso que `campus.latitud`). Se mide con el diff de grants
  antes/después y no se escribe ningún grant nuevo.
- **Candado de "inactiva" en la base (§0 regla 7)**: un trigger BEFORE en
  `listings` rechaza insertar, o CAMBIAR `categoria_id`, hacia una categoría
  inactiva (`55000 categoria_inactiva`). Una publicación que ya estaba en ella
  la conserva y se puede seguir editando en lo demás. Lo mismo en el INSERT de
  `user_intereses`.
- **RPC del panel** (schema `admin`, definer, `search_path = ''`,
  `exigir_admin()` primero, EXECUTE solo `authenticated`, auditadas con
  `private.auditar()`):
  - `categorias()`: lectura, con el conteo de publicaciones e intereses de cada
    una;
  - `crear_categoria(nombre, icono)`: entra al final, antes de "Otros";
  - `editar_categoria(id, nombre, icono)`;
  - `desactivar_categoria(id, motivo)` y `reactivar_categoria(id, motivo)`, con
    CAS;
  - `reordenar_categorias(ids, motivo)`: recibe el orden COMPLETO (todas las
    ids, una vez cada una) y lo aplica en una transacción. Rechaza
    `orden_desactualizado` si el conjunto de ids no es exactamente el actual
    (otra persona creó una entre tanto) y `sin_cambios` si nada se mueve.
    Escribe una fila de auditoría por categoría que cambió de lugar (las
    claves no admiten arreglos, D20).
- **Auditoría**:
  - `admin_acciones_accion_check` pasa de 16 a **21** acciones;
  - `objetivo_tipo` suma `'categoria'`;
  - `claves_auditoria_ok('categoria')` = `nombre`, `icono`, `orden`, `activa`
    (`create or replace`, misma firma, solo SUMA).

### 2. App (solo JS, sin build nativo)

- `fetchCategorias()` trae `id, nombre, icono, orden, activa` y ordena por
  `orden`. El tinte sigue ciclando por posición.
- El ícono sale de `icono` y ya no de `slugCategoria(nombre)`. Si llega una
  llave que este build no conoce, cae a `otros`, como hoy.
- **Las inactivas se esconden de lo que ELIGE**: Feed, Ver todas, Filtros,
  Publicar, Intereses y Editar intereses. **Se conservan para lo que MUESTRA**:
  el nombre en Detalle y en las tarjetas de publicaciones que ya existen. Al
  editar una publicación en una inactiva, el selector muestra la suya, pero no
  deja elegir otra inactiva.
- El ícono `alimentos` se transcribe del prototipo (`design/relevo-app.html`) a
  `PATHS`.
- **Builds viejos** (TestFlight): siguen funcionando. Ordenan por id, así que
  ven Alimentos al final, con el ícono de `otros`, y no esconden las
  inactivas; si alguien elige una inactiva, el trigger lo rechaza con un error
  genérico. Es aceptable y se documenta.

### 3. Panel (`admin/`)

- **Primero los frames** en `design/admin-panel.html`, para tu aprobación
  (`admin/CLAUDE.md`): lista de categorías (con conteos, estado y mover
  arriba/abajo), modal de crear o editar (nombre y selector de ícono de entre
  los 13), modal de desactivar o reactivar (con motivo), y su entrada en la
  navegación del Catálogo.
- Después, las pantallas y modales siguiendo el patrón de la Ola 5. Ninguna
  regla vive en el panel: los rechazos se pintan con `textoDeRechazo`.

### 4. Pruebas, en local

- `rls.sql`, sección T41 (autocontenida):
  - forma y unicidad del nombre, CHECK del ícono, orden único;
  - el trigger de inactiva (insert, cambio de categoría, y una publicación ya
    existente que se sigue editando);
  - intereses;
  - las RPC: autorización, auditoría y CAS;
  - `authenticated` lee las columnas pero no escribe.
  - Cada control negativo se corre uno a la vez, contra la suite y contra T41
    aislada.
- `probe-admin.mjs`, caso 12: las RPC por HTTP y el amarre de sus `raise` con
  `rechazos.ts` (el caso 7c ya lo exige).
- `tsc`, `lint`, `check:functions` y `check:admin`. Prueba en dispositivo
  (iPhone y Android) y del panel en local, por ti.

### 5. Remoto (lo corres tú, en este orden)

1. Preflight de solo lectura (yo): nombres que violarían el CHECK nuevo, conteo
   de categorías, 52 = 52.
2. `supabase db push --linked --dry-run`, con solo la `…489`, y después el
   push.
3. Readback (yo): definiciones, privilegios, CHECK de acciones y advisors.
4. `npm run gen:types` y `npm --prefix admin run gen:types` (con `--linked`).
5. **Después del push**, el JS nuevo de la app por Metro (antes, `select … orden`
   contra un remoto sin la columna rompería el catálogo) y el deploy del panel.
6. CLAUDE.md, el mismo día: §3 (esquema de `categories`, nuevas RPC, conteos de
   T12/`rls.sql`), §4 (Alimentos ya es una fila), §8 ("Hecho") y
   `admin/CLAUDE.md`.

## Decisiones (tomadas por el usuario el 2026-10-25)

- **D1. Borrar = desactivar.** No hay borrado real: las publicaciones conservan
  su categoría y los intereses no se pierden.
- **D2. Ícono elegido de los 13** que conoce la app. Un ícono nuevo exige
  código y una versión de la app.
- **D3. Los admins reordenan**: un modo "Reordenar" con flechas y "Guardar
  orden" con motivo, en UNA sola RPC (`reordenar_categorias`). Son 5 RPC de
  escritura: el CHECK de acciones pasa de 16 a **21**.
- **D4. `wrangler pages deploy` lo corre Claude** al llegar ese paso, pidiendo
  confirmación antes.
