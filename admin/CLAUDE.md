# Panel de administración (`admin/`) — RF-17

SPA con Vite + React + TS (D2), estática, que habla con Supabase **solo con la
publishable key**. El plan completo es `docs/rf17-plan-admin.md`; el estado por
olas vive en `CLAUDE.md` raíz §8, pendiente 0k. Este archivo carga solo cuando
la sesión toca `admin/`.

## Qué reglas del `CLAUDE.md` raíz NO aplican aquí

`admin/` no está bajo las reglas 1-4 ni 6 de §0 raíz (D1): esas hablan de
`design/relevo-app.html` y de la app móvil. Las del panel son:

1. **Diseño.** La fuente de verdad es `design/admin-panel.html`, desde la
   Ola 2: frames primero, aprobación del usuario después y solo entonces el
   código. La Ola 1 se construyó sin frame (D14) y la Ola 2 la alineó a esos
   frames. Solo se reusan los TOKENS de color y
   tipografía de §2 raíz (`src/estilos.css`); nada de tamaños ni componentes
   de teléfono.
   **Vigente desde la Ola 2 (frames aprobados por el usuario el 2026-10-01):** `design/admin-panel.html`, 35 frames (24 hasta la Ola 3; la Ola 4 sumó tres de Moderación y el detalle "en revisión (aprobar)", aprobados por el usuario el 2026-10-07; la Ola 3b reemplazó "Usuario — cuenta de admin" por su versión con «Restablecer app autenticadora» y sumó el modal, aprobados el 2026-10-08; la Ola 5 sumó seis de Catálogo y el ítem «Catálogo» en la barra lateral de todos, aprobados el 2026-10-08) medidos con `grep -o 'class="desk-block" data-cat="[^"]*"' design/admin-panel.html | sort | uniq -c`. Toda pantalla del panel lo calca antes de conectarse a datos; una pantalla o un estado que no esté ahí se dibuja ahí primero.
2. **Autorización, siempre en la base** (§0 regla 7 raíz, esta sí aplica).
   Toda acción es una RPC `security definer` de `admin.*` cuya primera línea es
   `perform private.exigir_admin();`, y toda escritura se audita en
   `private.admin_acciones`. Ningún `if` del panel decide quién puede qué: si
   el panel esconde un botón es UX, no candado.
3. **La secret key nunca llega al navegador.** Lo que de verdad necesite
   `service_role` va en una Edge Function que verifique `is_admin()` del que
   llama (hoy: `admin-reset-mfa`, Ola 3b, que delega toda la autorización en
   las RPC `admin.restablecer_mfa_*`), o en
   `scripts/crear-admin.mjs`, que corre en la terminal del admin técnico con una
   secret key TEMPORAL (se crea para la alta y se borra después).

## Identidad y MFA (20260930000477)

- Admin = fila en `private.admins` con `activado_at` puesto. **Revocar a un
  admin es poner `activado_at = null`** (`crear-admin.mjs desactivar`, que lo
  audita como `desactivar_admin`), con efecto en la request siguiente. T35 (l)
  prueba la revocación borrando la fila: también revoca, pero pierde nombre y
  fechas y no deja rastro.
- **Suspender NO revoca a un admin**: `is_admin()` no mira `users.estado`
  (decisión E de la Ola 1). Desde el panel no se puede suspender a un admin
  (G4, `objetivo_es_admin`); por Studio sí, y en ese caso otro admin lo puede
  reactivar (`reactivar_usuario` no lleva G4).
- `is_admin()` exige aal2 **y** un TOTP de las últimas 12 h leído de `amr`.
  Medido: un refresh conserva el timestamp del TOTP y re-verificarlo lo
  renueva (`scripts/probe-admin.mjs`, caso 3). Por eso la UI, ante
  `totp_vencido`, pide el código y reintenta.

## Restablecer la app autenticadora (Ola 3b, `20261008000483`, en producción desde el 2026-10-08)

- **Panel:** el detalle de una cuenta de admin (`pantallas/Usuarios.tsx`)
  muestra "Acceso al panel" y "App autenticadora", y la tarjeta «Restablecer app
  autenticadora» con sus variantes (propia cuenta sin botón, ya desactivado, sin
  app, restablecimiento pendiente). El modal es `componentes/ModalRestablecerMfa.tsx`.
  Que la propia cuenta no tenga botón es UX: el candado es la guarda
  `no_sobre_si_mismo` de la base.
- **La llamada:** la Edge Function `admin-reset-mfa`, por `useLlamar`. Su
  rechazo se traduce a `{code, message}` con `lib/funciones.ts` (puro), así que
  un `totp_vencido` reenviado abre el modal de TOTP igual que en una RPC.
- **`intento_pendiente`:** el modal lo manda cuando el detalle muestra un
  restablecimiento pendiente, y también en los reintentos tras un 502 (la
  función devuelve el `accion_id`). En el estado normal va en `null`. Así un
  reintento que otro admin ya cerró responde `ya_completado` en lugar de abrir
  un reset nuevo.
- **Fail-closed:** la base desactiva antes de que la función toque Auth; solo
  se borran factores `totp` anteriores al inicio del intento. El detalle de
  diseño y la evidencia, en `docs/rf17-plan-admin.md`, "Ola 3b".

## Rechazos: solo tres mensajes cambian la sesión

`src/lib/rechazos.ts` (puro, sin imports; lo importa `probe-admin.mjs`):

| Mensaje (42501) | Qué hace el panel |
|---|---|
| `no_admin` | cierra la sesión |
| `mfa_requerido`, `totp_vencido` | abre el modal de TOTP y reintenta UNA vez |
| cualquier otro (incluidos `no_sobre_si_mismo`, `objetivo_es_admin`, un 42501 de RLS) | lo muestra y ya |

Cerrar la sesión por un 42501 de una guarda echaría al admin por un error suyo
de operación. El amarre con la base es el caso 7 de `probe-admin.mjs`; el 7c
exige que todo `raise` de `admin.*` (leído del `pg_proc` vivo) tenga un texto
decidido: propio en `TEXTOS`, o el genérico a propósito en `SIN_TEXTO_PROPIO`
(mensajes que el panel nunca provoca y cuyo copy no está en los frames). Un
mensaje nuevo en una RPC obliga a decidir cuál.

## El modal de TOTP: una sola puerta (`src/lib/puerta-totp.ts`)

App es su ÚNICO dueño (`registrarModal`); todo lo demás pide el TOTP con
`pedirTotp(causa)`. Una promesa en vuelo compartida: N llamadas concurrentes
abren UN modal y terminan juntas; se limpia al resolverse (éxito, cancelación o
error). Antes de la Ola 2, App guardaba un solo `resolve` y dos llamadas
concurrentes dejaban la primera colgada para siempre: lo reproduce
`scripts/probe-puerta-totp.mjs`. Toda llamada a `admin.*` pasa por
`src/lib/llamar.ts`, que usa esta puerta.

## Fotos del bucket privado (`FotoListing`, D-A2 de la Ola 2)

- `<img src>` no manda `Authorization`: la foto se baja con
  `storage.download()` (el token de la sesión, `/object/{bucket}/…`) y se pinta
  como object URL. La CSP del build permite `img-src blob:` solo por esto.
  **Nada de signed URLs**: evalúan la RLS al firmar y seguirían sirviendo la
  foto después de que venza el TOTP (`CLAUDE.md` §9).
- El object URL se libera en el cleanup; si el componente se desmonta antes de
  que termine la descarga, el resultado se ignora (sin object URL huérfano).
- **Storage no dice por qué rechaza** (medido: aal1, TOTP vencido y no-admin dan
  el mismo `400 NoSuchKey`). Ante un fallo, `src/lib/fotos.ts` le pregunta a
  `admin.sesion()` UNA vez para todas las fotos (promesa compartida): si falta
  el TOTP lo pide por la puerta y cada foto reintenta una sola vez; si se
  cancela, quedan en "La foto no está disponible" con un "Reintentar" que es
  acción del usuario, no un bucle.

## Fuentes y CSP (D-A1 de la Ola 2)

Autoalojadas en `public/fonts/`, con su licencia OFL al lado: Fraunces latin
con ejes wght + opsz (el mismo archivo que carga el diseño) e Inter latin wght,
de `@fontsource-variable/*` 5.3.0, 115,560 B en total. Sin Google Fonts: la CSP
del build es `font-src 'self'`, `style-src 'self'`. `estilos.css` se genera del
CSS de `design/admin-panel.html` sin el cromo del prototipo; si el diseño
cambia, cambia ahí primero.

## Runbook de moderación: bloquear una `vendida`

Bloquear una publicación `vendida` deja a su COMPRADOR sin camino en la app
para calificar al vendedor (la base todavía acepta la reseña, pero la app
la busca por `listings_select`, que esconde la `bloqueada`). Es deuda aceptada
(`CLAUDE.md` §3, "Panel de admin"); antes de bloquear una vendida con una
calificación pendiente, avísale al comprador por el canal de soporte.

## Catálogo (Ola 5, `20261008000484`): en producción desde el 2026-10-09; RF-17 Ola 5 — CERRADA

Despliegue, aceptación y cierre completados (K-1 a K-14 del plan v3.2,
evidencia en `CLAUDE.md` §8, "Hecho"): migración en remoto (48 = 48), tipos
`--linked` (`014f7f0`), deployment `3259ea7f` y cierre en `9f2f434`.

- **Pantallas:** `pantallas/Catalogo.tsx` (lista) y `pantallas/DetalleUniversidad.tsx`
  (campus y dominios, con las variantes sin campus y sin dominios), y los modales
  `ModalUniversidad`, `ModalCampus`, `ModalAgregarDominio` y `ModalEstadoDominio`.
  Las dos pantallas leen `admin.catalogo()` (el panel no puede leer
  `universidad_dominios`: no tiene grant, T27).
- **Ninguna regla vive en el panel.** Normalización de nombres y dominios,
  unicidad sin distinguir mayúsculas, proveedores públicos
  (`private.proveedores_correo_publico()`), «sin campus no hay dominio»
  (`universidad_sin_campus`), agregar que nunca reactiva y el CAS de
  desactivar/reactivar son de la base. El panel pinta el rechazo con
  `textoDeRechazo` (sujeto `campus` para `nombre_duplicado` de un campus). El
  único chequeo local es que latitud y longitud SEAN números. «Guardar» no se
  bloquea sin cambios: lo decide la base (`sin_cambios`).
- **Lo que el panel NO ofrece (D12):** borrar o desactivar universidades y
  campus, mover un campus o un dominio de universidad. `editar_campus` ni
  siquiera recibe `universidad_id`.
- **Cuándo lo ve la app** (corrección v3.2 del plan, validada en I-local): el
  chip y el selector de campus usan el catálogo de la sesión, así que un campus o
  universidad nuevos, y un cambio de nombre, se ven al reabrir la app; el nombre
  de una universidad en las tarjetas, con pull-to-refresh; el de un campus, en
  Detalle.
- **Riesgos y operación:** la ventana hook→trigger (cuenta sin universidad) y
  la herramienta de recuperación del hook (`docs/rf17-ola5-recuperacion.sql`, no
  es un rollback de la ola) están en `docs/admin-runbook.md` §7.
- Plan completo, con decisiones y evidencia: `docs/rf17-ola5-plan.md` (v3.2).

## Moderación y aprobar (Ola 4, en producción desde el 2026-10-08)

- **Moderación** (`pantallas/Moderacion.tsx`) pinta `admin.cola_moderacion`:
  solo `pendiente`, de la más antigua a la más reciente, con los chips
  "Evaluadas" y "Sin evaluar". La miniatura es el recuadro del frame, sin bajar
  la foto (una página serían hasta 50 descargas del bucket privado); las fotos
  se ven en el detalle.
- **Aprobar** (`componentes/ModalAprobar.tsx`, hermano de `ModalBloquear`):
  `admin.aprobar_listing` con motivo obligatorio. Los cuatro rechazos del frame
  (`estado_inesperado`, `dueno_no_activo`, `sin_fotos`, `moderacion_en_curso`)
  los dice la RPC; que la tarjeta deshabilite el botón con el dueño suspendido o
  sin fotos es UX, no candado. Dos pestañas aprobando la misma publicación: una
  gana y la otra recibe `estado_inesperado` (medido en producción, prueba D).
- **"Bloqueadas"** en el detalle de usuario suma las `bloqueada` que siguen
  existiendo y las eliminadas que se retienen 12 meses en
  `private.moderacion_retenida` (`…482`).
- El dueño de una `bloqueada` ya no ve sus fotos (D5); el admin sí, por su
  policy. La app las borra con la Edge Function `eliminar-publicacion`.

## Runbook de moderación: desbloquear por Studio

El panel NO desbloquea (D10): `bloqueada` es terminal. Si un bloqueo fue un
error, la única vía es Studio (un UPDATE de `listings.estado`), a propósito y
sin trigger que lo impida. Studio **no deja rastro en `admin_acciones`** y **el
dueño no recibe aviso**, así que quien lo haga deja el motivo anotado fuera de la
base —quién, cuándo y por qué— y le avisa al dueño por el canal de soporte. A
`activa` solo pasa con al menos una foto; a `pausada`, sin condición
(`CLAUDE.md` §3, "Panel de admin").

## Runbook de operación (los tres admins; versión en lenguaje llano: `docs/admin-runbook.md`)

- **[RETIRADA el 2026-10-07] La regla del hueco del dueño suspendido (A1b).** El
  candado vive en la base desde `20261007000480`: los triggers
  `listings_exige_dueno_activo_ins`/`_upd` lanzan `55000 dueno_no_activo` ante
  cualquier paso a `activa` de una publicación cuyo dueño no esté activo, para
  todos los roles (Studio incluido), y `moderar-contenido` (v9) lo traduce a
  `pendiente`. La consulta semanal y el aviso al suspender ya no hacen falta.
  Desde el despliegue del panel de la Ola 4 (2026-10-08, deployment `2bb8f280`),
  el aviso de suspender dice "no se podrá aprobar mientras la cuenta esté
  suspendida", como el frame.
- **Barrido semanal de fotos huérfanas** (`docs/admin-runbook.md` §7): carpetas de
  `listing-photos` sin publicación, que se borran desde el Dashboard.
- **Perder el teléfono (o cambiarlo), desde la Ola 3b.** (1) Llamada de voz a
  la persona; (2) otro admin pulsa «Restablecer app autenticadora» en su detalle
  (desactiva y borra sus TOTP en una sola operación, fail-closed); (3) la
  persona entra con su contraseña y enrola un TOTP nuevo (sin TOTP verificado,
  el panel manda a enrolar: `App.tsx`); (4) segunda llamada con la hora del
  enrolamiento; (5) `node scripts/crear-admin.mjs activar --remoto
  --pooler-host <host-del-pooler> <correo>`, que exige un factor POSTERIOR al
  último `desactivar_admin` o `restablecer_mfa` y se niega con un intento
  pendiente. Probado de punta a punta en producción el 2026-10-08 con una
  cuenta temporal (`CLAUDE.md` §8). El camino viejo (desactivar → borrar el
  factor en el Dashboard → `activar`) queda solo como emergencia si nadie puede
  usar el panel; el borrado desde el Dashboard nunca se ha ejecutado en
  producción.
- **Retirar el acceso de un admin** (sin borrar su cuenta, su fila de
  `private.admins` ni su app): `crear-admin.mjs desactivar`. El panel no tiene
  esa acción, y «Restablecer app autenticadora» no es para esto (su auditoría
  diría que cambió de teléfono).
- **Suspender por Studio** exige `suspendido_at` y `suspension_motivo` (3-500
  tras `btrim`) o falla con 23514 (D15); reactivar exige dejar los dos en NULL.
  Studio no audita.

## Alta de admins: `scripts/crear-admin.mjs`

Sin `--remoto` corre solo contra el stack local; con `--remoto --pooler-host H`
lo corre el admin técnico en su terminal contra producción (prompt sin eco para
la secret key temporal y la contraseña de la base; ver la cabecera del script).

- `crear [--correo-externo] <correo> <Nombre>`: **no** usa `inviteUserByEmail`,
  que SÍ pasa por el Auth Hook de dominios (403 `dominio_no_participante`,
  medido); crea por `admin/users`, registra en `private.admins` sin activar y
  manda el código de recuperación. La persona fija su contraseña en "Primera
  vez u olvidé mi contraseña" y enrola su TOTP.
  - **Correo del admin.** Por defecto solo `@rlvo.com.mx`. Otro dominio (p. ej.
    el personal de un cofundador) exige `--correo-externo` **y** teclear el
    correo de nuevo; sin coincidencia no se toca nada.
  - **El preflight se detiene** (SQL, sin lista en el cliente) si el dominio
    está en `public.universidad_dominios` (misma comparación exacta que el
    hook: es un correo de alumno, no de admin) o si ya existe una cuenta con
    ese correo: **una cuenta del marketplace no se convierte en admin**, se usa
    otro correo.
  - **No toca el registro de usuarios normales**: el alta del admin va por el
    admin API, fuera del hook, y no cambia `universidad_dominios`, el hook ni
    `handle_new_user`. Un correo personal de admin sigue sin poder registrarse
    por OTP en la app.
  - Con un correo externo, `admin_correo` guarda ese correo **para siempre** en
    la auditoría (append-only). Los cofundadores lo aceptaron.
- `activar <correo>`: exige confirmar **por otro canal** y exactamente UN TOTP
  verificado creado después del alta y de la última desactivación o
  restablecimiento (`desactivar_admin` o `restablecer_mfa`), y se niega
  mientras haya un restablecimiento pendiente (Ola 3b). Audita con
  el actor centinela `00000000-0000-0000-0000-000000000000` y `admin_correo =
  'script:crear-admin.mjs'` (no hay JWT de un admin). Acepta cualquier correo
  bien formado: el SQL exige que esté en `private.admins`.
- `desactivar <correo> --motivo "<3-500>"`: `activado_at = null` y la fila
  `desactivar_admin`, en la misma sentencia.
- Nada se interpola: variables de psql (`:'var'`), `execFileSync` sin shell y
  **ningún dollar-quote** en su SQL (psql no sustituye `:'var'` dentro de uno).

## Auditoría: lo que NO se pega en ningún lado

- `antes`/`despues` solo llevan las claves permitidas POR TIPO de objetivo
  (`private.claves_auditoria_ok`, D20): nunca correo, nombre, teléfono, título
  ni comentario.
- **Una fila con `admin_id = 00000000-0000-0000-0000-000000000000` y
  `admin_correo = 'script:crear-admin.mjs'` es del SCRIPT, no un error ni un
  admin borrado**: la escribe `crear-admin.mjs activar`, que corre con la
  secret key y sin JWT de ningún admin. Al pintar la auditoría, se lee como
  "script". (Un admin borrado conserva su uuid y su correo reales: `admin_id`
  no lleva FK.)
- El `motivo` es texto libre (3-500 caracteres): el panel pide no escribir
  datos personales, pero la base no lo puede hacer cumplir.
- **El `DETAIL` de un rechazo de cualquier CHECK de `admin_acciones` imprime la
  fila COMPLETA, con el `motivo`, y puede llegar a logs. No lo pegues en chats
  ni en tickets.**

## Producción (Ola 3)

*Estado a 2026-10-05, salvo el deployment vigente; si algo de esto cambia, se
cambia aquí.* Deployment de Production vigente a 2026-10-09:
`3259ea7f-ff80-45ed-8817-ea37a63f45ca` (fuente `014f7f0`, Ola 5;
`index-DKEG9wmp.js`, SHA-256 `674eb80b…`), desplegado con
`npx wrangler pages deploy admin/dist --project-name rlvo-admin --branch main
--commit-hash 014f7f0`; el anterior era `f0e7e467` (fuente `c45009d`, Ola 3b). **Si el HEAD local tiene commits que no son del
panel, se despliega con `--commit-hash` del commit que corresponde**: wrangler
etiqueta el deployment con el HEAD.

- **Dónde:** Cloudflare Pages, proyecto `rlvo-admin`, dominio
  `admin.rlvo.com.mx` (también `rlvo-admin.pages.dev`). **Direct Upload, sin Git
  ni CI/CD**: se despliega a mano.
- **Variables del build** (`admin/.env.production.local`, ignorado por git; solo
  estas dos): `VITE_SUPABASE_URL` (la del proyecto remoto) y
  `VITE_SUPABASE_PUBLISHABLE_KEY` (la publishable; **nunca** la secret).
  `vite.config.ts` aborta el build si falta alguna.
- **Desplegar:** `npm --prefix admin ci && npm --prefix admin run build` y después
  `npx wrangler pages deploy admin/dist --project-name rlvo-admin`. Comprueba en
  el Dashboard que el deployment quedó como **Production**: si quedara como
  Preview, el dominio seguiría con la versión vieja. El de la Ola 3 se corrió sin
  `--branch`, desde `main`, y quedó en producción.
- **Antes de subir, sobre `admin/dist`:** 0 archivos `.map`; 0 coincidencias de
  `eyJhbGci`, `service_role`, `http://127.0.0.1:54321`; `sb_secret_` solo como el
  prefijo de la biblioteca (1; con ≥10 caracteres de llave, 0); `localhost` solo
  los 3 de `supabase-js` (`localhost:9999` sin usar y dos comparaciones);
  `127.0.0.1` solo el 1 de su lista; la URL remota 1 vez en el JS, en `_headers` y
  en `index.html`; exactamente 1 llave publishable embebida y es la del remoto.
- **`_headers`:** lo genera el MISMO plugin que la `<meta>` de la CSP
  (`vite.config.ts`), así que no pueden divergir. Lleva CSP con
  `frame-ancestors 'none'`, HSTS, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy: no-referrer` y `Permissions-Policy`. Pages lo aplica a todas
  las respuestas, incluido el fallback de SPA.
- **Después de subir, la batería de 4 variantes de petición** (curl simple, UA de
  navegador con `*/*`, UA con `Accept: text/html`, UA con `Accept` y
  `Sec-Fetch-Dest: document`) sobre el dominio, `pages.dev` y el deployment: el
  HTML debe ser byte-idéntico a `dist/index.html` y sin `cloudflareinsights`. Una
  sola variante NO basta: la inyección de Cloudflare Web Analytics solo aparece
  con `Accept: text/html` (`CLAUDE.md` §9). Además, los 6 headers contra
  `dist/_headers` y JS, CSS y fuentes byte a byte.
- **Cloudflare Web Analytics** estaba, a 2026-10-05, en "Enable with JS Snippet
  installation" a nivel de zona y el snippet vive solo en la landing (otro repo):
  el panel no lo lleva y **la CSP no se amplía** para permitirlo. Si alguien
  vuelve la zona a inyección automática, el beacon reaparece en el panel.
- **Observaciones sin acción (medidas el 2026-10-02):** Cloudflare agrega `access-control-allow-origin:
  *`, `nel` y `report-to` (no se quitan desde `_headers`); las fuentes `.woff2`
  se sirven sin `content-type` (cargan igual); cualquier ruta inexistente da 200
  con el `index.html`; y el borde conserva el JS anterior tras un redespliegue,
  medido: hasta 4 h en el dominio propio (`max-age=14400`) y hasta 7 días en
  `pages.dev` (`s-maxage=604800`) (no hace falta purgar: el `index.html` ya apunta
  al nuevo).
- **Rutas:** el panel no usa rutas con path (`Panel.tsx` es un estado), así que
  `/usuarios/x` y cualquier otra abren la app en Reportes.

## Desarrollo local

```bash
cd admin && npm install
# admin/.env.local (ignorado por git), con API_URL y PUBLISHABLE_KEY de `supabase status`:
#   VITE_SUPABASE_URL=http://127.0.0.1:54321
#   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
npm run dev            # http://localhost:5173
```

El stack local necesita TOTP encendido y `admin` en `[api] schemas`
(`supabase/config.toml`). **Orden, medido:** si el schema `admin` se expone
ANTES de que exista, PostgREST no carga el schema cache (3F000) y TODO el API
responde 503. En remoto, el Dashboard se toca después del push de
`20260930000477`, nunca antes (Ola 3).

## Verificación

- `npm run check:admin` desde la raíz (typecheck + lint del panel). El
  `tsconfig.json` raíz excluye `admin/`: sin este comando, nadie lo mira.
- `node scripts/probe-admin.mjs` (stack local + Mailpit): 94 pruebas a
  2026-10-09 (84 a 2026-10-08), con el camino `--remoto`, los correos externos de
  `crear-admin.mjs`, el amarre del TTL del reclamo (7d) y, desde la Ola 5, el
  catálogo por HTTP (caso 10, con la carrera de `agregar_dominio` hecha
  determinista). `node scripts/probe-registro.mjs`: 55 (caso 10, dominios
  activos e inactivos contra GoTrue). Y
  `node scripts/probe-puerta-totp.mjs` (11), `node scripts/probe-storage.mjs`
  (41), `node scripts/probe-eliminar-publicacion.mjs` (12) y
  `node scripts/probe-admin-reset-mfa.mjs` (35, Ola 3b; necesita además
  `supabase functions serve`), también a 2026-10-08.
- `supabase/tests/rls.sql`: T12, T35 y, desde la Ola 4, T35b, T35c (Ola 4),
  T35d y T35e; desde la Ola 3b, T35f (28); desde la Ola 5, T37 (77) y T28 (a3)
  con un dominio inactivo.
- Tipos: `npm run gen:types` (desde `admin/`) regenera `src/db/admin.types.ts`
  contra el stack **local** y es el default a propósito: las RPC nuevas se
  prueban en local antes del push. `--linked` produce el mismo contenido con
  otro formato (bloque `__InternalSupabase`, paréntesis en los genéricos de los
  helpers, una línea en blanco menos). **Tras cada push** se regenera con
  `cd .. && supabase gen types typescript --linked --schema admin >
  admin/src/db/admin.types.ts`, se compara y se commitea ese; un archivo
  generado con `--local` vuelve al formato viejo (ruido en el diff, no un error).
- ESLint prohíbe `dangerouslySetInnerHTML` y el prop `style` en TSX: la CSP
  del build (`vite.config.ts`) no permite scripts ni estilos inline.
