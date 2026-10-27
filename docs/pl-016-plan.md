# PL-016 — Plan de implementación: aceptación explícita y versionada de los términos

Estado: **PLAN, sin aprobar (2026-10-26).** Nada implementado. Parte de la
decisión de los socios (`docs/PRE_LAUNCH_DEBT.md`, PL-016) y de la propuesta
técnica (`docs/PL-015-016-DISENO.md`, Parte 2 y §4.6-4.7). Se ejecuta por fases
chicas (`CLAUDE.md` §6), primero en LOCAL, y cada fase se aprueba aparte.

## Decisiones tomadas (usuario, 2026-10-26)

| # | Decisión | Opción |
|---|---|---|
| P1 | Dónde acepta una cuenta nueva | **A1: casilla en "Completar perfil"**, encima de "Continuar". Ahí ya hay sesión. |
| P2 | Acciones PERMITIDAS antes de aceptar (además de las ya decididas: explorar, nombre, reportar, bloquear, eliminar sus publicaciones y la cuenta) | **Cambiar de campus, guardar favoritos y pausar una publicación.** |
| P3 | Acciones BLOQUEADAS antes de aceptar | Publicar, editar o reactivar una publicación, marcarla vendida o corregir el comprador, subir fotos, foto de perfil, **teléfono y carrera**, reseñar y contactar por WhatsApp. |
| P4 | Evidencia al eliminar la cuenta | **Se borra con la cuenta** (`on delete cascade`). El abogado lo valida después (PL-009); cambiarlo es una migración. |
| P5 | Casillas | **Una casilla con dos enlaces.** El servidor guarda dos registros: Términos `aceptado` y Aviso `presentado`. |

## Decisiones que este plan propone (se confirman al aprobarlo)

| # | Propuesta | Por qué |
|---|---|---|
| Q1 | **Cuentas que aceptaron una versión anterior (o ninguna):** al abrir la app ven "Actualizamos los términos" con **"Ahora no"**; si eligen "Ahora no" exploran (D8-C), y al tocar una acción bloqueada se les vuelve a abrir esa pantalla. | Respeta D8-C. El candado es de la base; la app solo elige qué pantalla mostrar (§0 regla 7). |
| Q2 | **Escrituras técnicas antes de aceptar** (vistas, `actividad_diaria`, token de push, marcar avisos leídos, intereses): **permitidas**. | No son contenido; dependen del Aviso de privacidad, no de los Términos. Queda anotado como pregunta para el abogado (D8-C). |
| Q3 | **Catálogo de versiones fuera de la migración.** La migración crea la tabla vacía; las versiones se cargan con `seed.sql` en local y con un `insert` del usuario en STAGING. Sin versión vigente, **nadie puede aceptar**, así que las acciones de P3 quedan bloqueadas (falla cerrado). | La versión real la fija PL-008, y una migración la llevaría también a PROD. Se agrega como paso al runbook de PL-001. |
| Q4 | **La app abre la URL que guarda el catálogo** (`documentos_legales.url`), no las constantes `URL_TERMINOS`/`URL_PRIVACIDAD`. | La versión y la URL viajan juntas. Las filas de Configuración siguen en PL-007, sin cambios aquí. |
| Q5 | **Verificación:** el texto pasivo "Al continuar aceptas…" deja de ser cierto (ya no se acepta ahí). Pasa a "Consulta los Términos de uso y el Aviso de privacidad." con los dos enlaces. | Frame primero; cubre la parte de PL-007 que toca a Verificación. |

## Aclaraciones de la aprobación (usuario, 2026-10-26)

Plan aprobado con Q1-Q5 y estas condiciones:

1. **Una sola casilla** por UX, con dos registros separados (Términos
   `aceptado`, Aviso `presentado`). La presentación del Aviso **no** se trata
   como consentimiento general a ningún tratamiento de datos. La validación
   jurídica sigue pendiente.
2. **Q4, versiones inmutables:** cada versión apunta al contenido EXACTO que se
   le mostró al usuario, y el de las versiones históricas sigue disponible y sin
   cambios. Si las rutas del sitio muestran siempre el documento más reciente,
   **se propone una estrategia de versionado antes de implementar esta parte**
   (Fase 2).
3. **Q2:** las escrituras técnicas siguen antes de aceptar solo si son
   necesarias y coherentes con los requisitos de privacidad, y nunca abren un
   bypass a una acción bloqueada.
4. **STAGING:** ninguna migración hasta que la app esté lista, las versiones de
   prueba preparadas y el rollout aprobado de forma explícita. Sin afectar a
   los testers actuales de TestFlight.
5. Se conservan los cambios sin commitear. Nada de commit, push, deploy ni
   cambios remotos sin autorización.

Autorizada solo la **Fase 1**; se detiene para la aprobación visual.

**Fase 1 aprobada (2026-10-26)**, commit `d6c1695`.

## Decisiones al entrar a la Fase 2 (usuario, 2026-10-27)

- **V1, versionado (condición 2): URL fija + hash.** Medido con GET:
  `https://www.rlvo.com.mx/terminos` y `/privacidad` dan 200 y muestran siempre
  la última versión; `/terminos/v1` y `/privacidad/2026-10-01` dan 404. Así que:
  - cada versión vive en una URL que no cambia nunca (p. ej.
    `/terminos/2026-10-v1`), y `/terminos` lleva a la vigente. Eso es trabajo
    del repo de la web, fuera de este;
  - `documentos_legales` guarda `url` y `contenido_sha256` (sha256 del texto
    canónico, 32 bytes);
  - un trigger impide EDITAR una versión para cualquier rol, y la FK desde
    `aceptaciones_legales` impide BORRAR una versión que alguien aceptó. Se
    puede borrar un borrador que nadie aceptó;
  - el texto canónico de cada versión se archiva en este repo
    (`docs/legal/versiones/`), para comprobar el hash.
- **V2, foto de perfil en Completar perfil:** hoy se sube al elegirla
  (`src/lib/perfil.ts:105-107`), antes de aceptar, y el candado de P3 la
  rechazaría. Se queda en el teléfono y **se sube al tocar Continuar, después
  de registrar la aceptación**. El candado de P3 no cambia. Es código de la
  Fase 3, sin frames nuevos.
- **Quitar un dato no es agregar contenido:** el trigger de `users` deja
  poner `foto_url`, `telefono` o `carrera` en NULL sin aceptación; solo
  rechaza escribir un valor nuevo.

## Medido para este plan

- Policies que cambian (última definición):
  - `listings_insert_own`: `20260919000463:71`
  - `listings_update_own`: `20260917000459:101`
  - `listing_photos_insert_own`: `20261007000481:358`
  - `listing_photos_objects_insert_own` (Storage): `20261007000481:295`
  - `avatars_objects_insert_own` (Storage): `20260916000456:73`
  - `ratings_insert_own` / `ratings_update_own`: `20260906000440:166` / `:172`
  - `listing_contacts_insert_own`: la versión de UGC-1 (`20261013000487:254-259`)
  - `listing_sales_insert_seller` / `listing_sales_update_seller`: `20260912000453:70` / `:106`
- Sin cambios (P2 y lo ya decidido): `favorites_insert_own`
  (`20260906000440:23`), `reports_insert_own` (`20260914000455:85`), las de
  `user_bloqueos`, `listings_delete_own` y `users_update_own`
  (`20260906000438:82`, que es de fila: la excepción por columna va en un
  trigger, abajo).
- Frames: "Completar perfil" (`design/relevo-app.html:6882`), su estado inicial
  (`:7048`) y su selector de campus (`:7110`); el texto de Verificación
  (`:3409` y `:3458`). En código: `src/app/(onboarding)/completar-perfil.tsx`,
  `verificacion.tsx:119-121`, y el gating de `src/lib/session.tsx:369`
  (`isProfileComplete`).

## Fase 1 — Frames (`design/relevo-app.html`) · STOP para aprobar

1. **"Completar perfil"** y su estado inicial: la casilla sin marcar, con
   "Acepto los **Términos de uso** y leí el **Aviso de privacidad**", y
   "Continuar" deshabilitado sin la casilla. Variante etiquetada: casilla
   marcada, y error persistente ("No pudimos registrar tu aceptación…" con
   reintento).
2. **Frame nuevo "Términos actualizados"** (Onboarding): título, un resumen de
   qué cambió (placeholder hasta que lo redacte el abogado), la misma casilla,
   "Aceptar" y "Ahora no". Variantes: `busy` y error.
3. **Verificación** (las dos variantes): el texto con enlaces de Q5.
4. **Componente de casilla** nuevo en el sistema de diseño, con los tokens
   existentes (sin tokens nuevos), y `accessibilityRole="checkbox"` anotado.

Total: **88 → 89 frames** (Onboarding 18 → 19). Se mide con el `grep | uniq -c`
de §4.

## Fase 2 — Base, en LOCAL

Una migración (`20261026000490_aceptacion_terminos.sql`, consecutivo a medir
antes):

- **`public.documentos_legales (tipo, version, vigente_desde, url)`**, PK
  `(tipo, version)`, `tipo` en `('terminos','aviso_privacidad')`. `revoke all` y
  luego `grant select` a `authenticated`; sin escritura para el cliente. La
  vigente de cada tipo es la más reciente con `vigente_desde <= now()`.
- **`public.aceptaciones_legales (user_id, tipo, version, accion, aceptado_at)`**,
  `unique (user_id, tipo, version)`, FK compuesta a `documentos_legales`,
  `user_id → users on delete cascade` (P4), `accion` en
  `('aceptado','presentado')`. `revoke all` y luego `grant select`; una policy
  de SELECT `user_id = auth.uid()`. RLS activo, fuera de Realtime, sin
  INSERT/UPDATE/DELETE para el cliente.
- **`public.aceptar_terminos(p_version_terminos text, p_version_aviso text)`**
  (la quinta definer de `public`, la invoca el cliente): el usuario sale de
  `auth.uid()` y la hora de `now()`. Rechaza (`22023 version_no_vigente`) si
  alguna de las dos no es la vigente, o sea si el usuario vio una versión
  vieja. Escribe las dos filas con `on conflict do nothing`, así que es
  idempotente. EXECUTE solo para `authenticated`.
- **`private.terminos_vigentes_aceptados()`** (sql, stable, definer, sin
  parámetros, EXECUTE para `authenticated` porque lo usa una policy: SIGSEGV de
  §9). Si no hay versión vigente devuelve false (Q3).
- **Candados de P3:**
  - con el helper en el `with check`: las 8 policies de "Medido", menos
    `listings_update_own`;
  - `seller_whatsapp`: niega el número si quien llama no aceptó (quinta causa
    de `null`);
  - **trigger BEFORE UPDATE en `listings`**: si quien edita es el dueño y no
    aceptó, solo deja pasar `activa → pausada` sin otro cambio (P2). Reactivar,
    editar y marcar vendida se rechazan con `42501 terminos_no_aceptados`;
  - **trigger BEFORE UPDATE en `users`**: igual, rechaza los cambios a
    `foto_url`, `telefono` y `carrera` sin aceptación; `nombre` y `campus_id`
    pasan (D8-D y P2).
  - Los dos triggers miran `auth.uid()` contra el dueño, así que no frenan a
    `service_role`, Studio, `increment_listing_view` ni la pausa por
    suspensión. Se mide en local.
- **`rls.sql`, T42** (autocontenida), con los actores N (sin aceptar), O
  (versión anterior) y V (vigente):
  - cada acción de P3 rechazada para N y O y permitida para V;
  - cada acción de P2 y las de seguridad permitidas para N;
  - la RPC: hora del servidor, idempotencia, versión vieja o inventada
    rechazada, y no se puede aceptar a nombre de otro;
  - catálogo vacío → todo bloqueado;
  - borrado de cuenta → la evidencia se va (T33 (h) sigue en verde);
  - un control negativo por candado, contra la suite completa y contra T42
    aislada.
- **`scripts/probe-terminos.mjs`**: la forma exacta de la llamada del cliente
  por HTTP (la RPC, la lectura del estado, una inserción directa rechazada y
  una publicación rechazada y luego permitida).
- Regresión completa: `rls.sql` y los probes del §6. Puede que haga falta
  ajustar fixtures de secciones anteriores: sus usuarios no habrán aceptado.
  **Esto se mide primero.** Si rompe muchas secciones, la salida es que el
  fixture global acepte la versión de prueba, y se trae como decisión.

### Resultado de la Fase 2 (LOCAL, 2026-10-27)

- `rls.sql`: **763/763** (736 + 27 de T42), tras `supabase db reset`. El
  fixture global acepta `rls-fixture` (decisión del usuario).
- **26 controles negativos**, uno a la vez dentro de la transacción de la suite,
  contra la suite completa y contra T42 aislada: los 26 caen. 23 en su aserción
  de T42 en las dos corridas. Las otras tres:
  - "trigger de `listings` sin la excepción del dueño" cae antes, en (d3): la
    vista de N sobre una publicación ajena;
  - "trigger de `users` sin la excepción del dueño" cae en la precondición:
    Studio siembra a los actores;
  - "aceptaciones sin cascade" cae en la suite completa con un error crudo de
    FK, en T8 (que borra a `:C`), y aislada en (i1);
  - además, "grant select de documentos a anon" cae en T12 en la suite (la
    invariante de anon) y en (g1) aislada.
- **Cambio respecto a la Fase 2 planeada:** `private.terminos_vigentes_aceptados()`
  quedó **INVOKER**, no definer. Medido: con definer o invoker T42 da lo mismo,
  porque el helper solo lee las aceptaciones propias (las deja ver la policy
  select-own) y el catálogo. Invoker no eleva nada, y si esa policy
  desapareciera fallaría cerrado. T42 (a6) lo fija.
- **Desviación de Q3:** las versiones de prueba van en
  `supabase/seeds-local/terminos.sql` (se corre a mano), no en `seed.sql`.
  `seed.sql` viaja a remoto con `db push --include-seed`, y una versión legal
  falsa no puede llegar a STAGING ni a PROD.
- **Probes:** `scripts/_terminos-prueba.mjs` acepta con la secret key (solo
  localhost) y siembra las versiones de prueba si faltan. Se conectó a los 5
  probes que fallaban sin él: `storage` 19 fallos → 41/41, `venta` 1 → 13/13,
  `bloqueos` 2 → 24/24, `eliminar-cuenta` y `eliminar-publicacion` (abortaban
  al subir fotos) → 26/26 y 12/12. Sin cambios y en verde: `registro` 55,
  `perfil` 90, `actividad` 15, `admin` 118, `admin-reset-mfa` 35,
  `moderacion` 166, `ubicacion` 9, `puerta-totp` 11, `recorte` 17.
  `moderacion-http` no se corrió (llama a las APIs pagadas).
- **`scripts/probe-terminos.mjs`: 15/15**, con 2 controles (sin el trigger de
  `listings` → 2b; la RPC sin la comprobación de versión → 3a, donde la FK aún
  rechaza con 23503) que caen en su caso, con la base restaurada y verificada
  por md5. La forma que la app reconoce es `403 / 42501 terminos_no_aceptados`
  (trigger), y la de RLS es `403 / 42501 new row violates row-level security`.

## Fase 3 — App (JS, sin build nativo)

- `src/lib/terminos.ts`: lee las vigentes y las propias, llama a la RPC y
  traduce el error.
- `session.tsx`: suma `terminosAceptados` al estado, derivado del servidor.
- "Completar perfil": la casilla y la RPC en la misma acción que guarda el
  perfil. Si la RPC falla, error persistente y reintento.
- Pantalla "Términos actualizados": la abre el splash con sesión sin
  aceptación, y la abren las acciones de P3 (Q1).
- Verificación: los enlaces (Q5).
- `tsc`, `lint` y prueba manual. Para probar contra LOCAL hace falta el truco de
  `.env.development.local` (gotcha de `.env.local`, índice de deuda §8).

**Cambios al implementarla (2026-10-27):**

- **Puerta obligatoria, decisión del usuario (reemplaza el "Ahora no" de
  D8-C).** Sin aceptar la versión vigente no se entra al Feed: `(tabs)/_layout.tsx`
  redirige a "Términos actualizados", que no se cierra con gesto ni con "atrás".
  Las salidas son aceptar, "Cerrar sesión" y "Eliminar mi cuenta" (el mismo
  "Confirmar eliminar cuenta", extraído a `EliminarCuentaModal`; Apple
  5.1.1(v)). El frame se cambió primero y el usuario lo aprobó. Los bloqueos por
  acción se quedan de respaldo y la base no cambia.
- Si el estado no se puede leer o no hay versión vigente, se entra: por eso un
  build nuevo funciona contra un STAGING sin la migración (prueba A, confirmada).
- El recuadro "Qué cambió" no se pinta (su texto es de PL-008), y en Completar
  perfil la versión vencida avisa con un toast.

## Fase 4 — STAGING · cada paso con autorización

**Antes:** confirmar que QA-R1 no está corriendo, o acordarlo
(`PL-015-016-DISENO.md` §4.8). Las cuentas de STAGING quedan sin aceptación
hasta que acepten desde un build con la Fase 3.

1. Preflight de solo lectura y copia cifrada si se decide (la migración no
   toca filas existentes).
2. `db push --dry-run` y luego `db push` (los corre el usuario).
3. Readback: estructura, grants, md5 de las funciones contra LOCAL y advisors.
4. El usuario inserta las versiones de prueba en `documentos_legales`, con las
   URLs de borrador.
5. `gen types --linked`.
6. Pruebas en iOS y Android: alta nueva, cuenta sin evidencia, versión nueva,
   fallo de red y llamada directa a la API sin aceptación.

## Fase 5 — Documentación

- `CLAUDE.md`:
  - §3: el bloque nuevo, la quinta definer de `public`, la quinta causa de
    `null` de `seller_whatsapp` y los conteos;
  - §4: el frame nuevo;
  - §6: el paso 18, `probe-terminos`;
  - §8: "Hecho".
- `docs/PL-001-prod-bootstrap.md`: cargar `documentos_legales` antes de abrir
  el registro.
- `docs/PRE_LAUNCH_DEBT.md` (PL-016), `DATA_RETENTION.md` y
  `ACCOUNT_DELETION.md` (P4): hoy tienen cambios tuyos sin commitear, así que
  se tocan solo con tu visto bueno y sin mezclarlos con lo tuyo.

## Lo que este plan NO cierra (criterio de cierre de PL-016)

- La validación del abogado de las tres distinciones, de Q2 y de P4 (PL-008 y
  PL-009).
- Los textos y versiones finales (PL-008) y las filas de Configuración
  (PL-007).
- PROD (PL-001).
