# RF-17 — Plataforma web de administración: plan de arquitectura

**Estado (2026-09-29):** plan v2 + v2.1 APROBADO. **Ola 0 en producción**
(`7574b01`; remoto remedido: 40 migraciones con `20260930000476` y el `WHEN` de
`reports_notify_resolved` con `reporter_id IS NOT NULL`); el panel todavía no
existe. Este archivo es la
consolidación de v2 y v2.1 tal como quedaron aprobados. **Donde v2 y v2.1
chocan, prevalece v2.1** (`is_admin()` con `jsonb_typeof`, la lista de claves de
auditoría por tipo, el orden de las olas). El resumen operativo vive en
`CLAUDE.md` §8, pendiente 0k; el detalle, aquí.

Reglas de lectura:
- Todo lo que afirma sobre el repo se verificó el 2026-09-29 y cita
  archivo:línea. Si el repo cambia, **gana el repo** y se corrige este archivo.
- Lo marcado **"pendiente de medir"** no está medido. No se cita como hecho.
- Las cifras de remoto son de esa fecha y se REMIDEN antes de confiar en ellas.

---

## Contexto

Hoy RF-17 "vive en Supabase Studio" (`docs/product-spec.md`, RF-17;
`CLAUDE.md` §1, tabla de stack). Somos 3 admins y 2 no pueden usar Studio ni SQL,
así que hace falta un panel propio. Restricciones duras:

1. La `service_role` key NUNCA llega al navegador.
2. Toda la autorización vive en la base (RLS + RPCs), nunca en el cliente del
   panel.
3. Si una operación de verdad necesita `service_role`, va en una Edge Function
   que verifica que quien llama es admin.
4. Toda acción de admin es una RPC `SECURITY DEFINER` con el chequeo de admin
   ADENTRO, más una tabla de auditoría. Ninguna acción de admin es un UPDATE
   directo desde el panel.

### Alcance de la fase 1

- **(a) Reportes:** listar, ver el objetivo (publicación o usuario), resolver o
  descartar.
- **(b) Cola de moderación:** publicaciones en `pendiente` con sus fotos y el
  veredicto de `listing_moderacion`; aprobar (→ `activa`) y bloquear
  (→ `bloqueada`).
- **(c) Usuarios:** buscar, suspender y reactivar con motivo.
- **(d) Catálogo institucional:** dominios de correo, universidades y campus
  (con latitud y longitud).
- **(e) Métricas básicas de RNF-10.**

**Fuera de alcance:** logs y errores (irán en Sentry, tarea aparte), el chatbot
de soporte, borrar cuentas desde el panel y el aviso de suspensión dentro de la
app (tarea aparte que depende de esta).

### Estado medido en remoto (2026-09-29, `execute_sql`, solo lectura)

- `reports`: 2 `pendiente` y 1 `resuelto`. Ninguno sin reportante ni sin
  objetivo.
- `public.users`: 7, todos `activo`. `auth.users`: 8 (ver "La fila que sobra").
- `listings`: 6 `pendiente`, 5 `bloqueada`, 24 `pausada`, 24 `activa`,
  17 `vendida`.
- `listing_moderacion`: 23 filas.
- 5 universidades (ids 1, 3, 4, 5, 6) y 13 campus.
- `auth.mfa_factors`: 0.
- Migraciones: 39 en remoto (última `20260930000475`), 40 en el repo. *(Después
  del push de la Ola 0, remoto da 40; ver "Ola 0".)*
- `[api] schemas` en local: `["public", "graphql_public"]`
  (`supabase/config.toml:13`). En remoto es un ajuste del Dashboard.

**La fila que sobra.** `auth.users` tiene de más a
`7f50bc00-68de-4c01-bdd6-a68362653b1a` (`prueba-2b@example.com`, creada el
2026-09-23 18:11 UTC, 0 identities): es la cuenta de prueba de la fase 2B
(`.claude/rules/explorar.md`, "Datos de prueba en remoto"). Su limpieza
(pendiente 0c de `CLAUDE.md` §8) corrió a medias: ya no están `public.users`, la
universidad "Prueba 2B", sus campus ni sus publicaciones. Consecuencia para el
panel: **"altas" se mide sobre `public.users`, nunca sobre `auth.users`.**

---

## 0. RF-17 del spec contra el alcance pedido: sí difería

`docs/product-spec.md` decía: "Panel interno para revisar reportes, suspender
usuarios/**publicaciones** y ver métricas básicas de uso. (Vive en Supabase
Studio…)". Diferencias, ya reflejadas en el spec:

1. **"Vive en Studio"** contradice el panel propio; corregido en el spec y en
   `CLAUDE.md` (tabla de stack, y la cola de `pendiente` de moderación).
2. **"Suspender publicaciones"** abarca cualquier publicación, no solo la cola.
   Por eso `admin.bloquear_listing` acepta también `activa`, `pausada` y
   `vendida` (D6), igual que ya escala el pipeline de RF-18 (`CLAUDE.md` §3,
   "vendida y pausada SÍ escalan a bloqueada").
3. **(d) Catálogo institucional no estaba en RF-17.** Era "altas vía
   Studio/service_role" (`CLAUDE.md` §3, catálogos). Es alcance nuevo y está
   anotado en el spec.
4. **(e) Métricas** coincide con RNF-10 (`docs/product-spec.md`, RNF-10:
   publicaciones creadas, usuarios activos, contactos generados).

---

## 1. Ubicación y aislamiento del tooling

**Recomendación (D1, aprobada): `admin/` en este repo, con `package.json` y
lockfile propios, sin workspaces.** Las migraciones, `supabase/tests/rls.sql` y
los tipos generados siguen siendo la fuente única. Los tipos se leen con un alias
`@db/*` → `../src/lib/database.types.ts` (tipos de `public`) más
`admin/src/db/admin.types.ts`, generado con `supabase gen types --schema admin`.

**Alternativas descartadas:**
- **Repo aparte:** duplica las migraciones y los tipos, o los sincroniza con
  submódulos. Rompe la fuente única; la suite RLS dejaría de ver los cambios del
  panel.
- **Expo web:** el panel es de tablas densas de escritorio y RN-web no está
  pensado para eso; obliga a compartir el árbol de rutas y el bundle con la app
  (el tab bar nativo, `NativeTabs`, no existe en web); acopla los releases del
  panel a los de la app.
- **Workspaces:** hoistean dependencias. El React del panel competiría con el
  React fijado por Expo SDK 57 en el `node_modules` raíz. Dos lockfiles
  independientes son más simples y no se pisan.

**Cómo se aísla, verificado:**

- **Typecheck.** `tsconfig.json:14-18` incluye `**/*.ts` y `**/*.tsx`, y solo
  excluye `supabase/functions` (`:19-21`). **Hay que agregar `"admin"` al
  `exclude`.** Sin eso, `npx tsc --noEmit` de la app typechea el panel con la
  config de Expo (es el gotcha de `CLAUDE.md` §9 "un exclude manda el código a
  NINGÚN compilador", al revés).
- **Lint.** `package.json:66` = `expo lint src supabase/functions`, así que el
  lint raíz no toca `admin/`. El panel lleva su propio `eslint.config.js` y sus
  scripts `lint`/`typecheck`/`build`. En la raíz se agrega `npm run check:admin`
  (`npm --prefix admin run typecheck && npm --prefix admin run lint`). La
  pregunta de §9 es "¿quién la mira ahora?".
- **Metro.** No hay `metro.config.js` en la raíz. `admin/node_modules`, con otra
  versión de React, queda dentro del root que vigila Metro. **Pendiente de
  medir en la Ola 1** que el bundle de la app no lo resuelve; si lo hace, se
  agrega `resolver.blockList` para `/admin/`.
- **`.gitignore`.** Verificado el 2026-09-29: `git check-ignore -v
  admin/node_modules/react/index.js` devuelve `.gitignore:4:node_modules/`, o
  sea que `admin/node_modules` ya queda ignorado sin tocar nada (C7).
- **EAS, con trampa (C8).** No existe `.easignore` (`ls -a`). **En cuanto existe
  uno, EAS deja de leer `.gitignore`.** Por eso el `.easignore` nuevo tiene que
  copiar literal todo `.gitignore` y además `admin/` y `admin/node_modules/`
  explícitos. Si no, el build sube `.env.local` y todo lo demás que hoy se
  ignora. Se verifica con `eas build --local` o revisando el tarball antes del
  primer build.
- **CLAUDE.md anidado.** `admin/CLAUDE.md` solo carga cuando la sesión toca
  archivos de `admin/`, así que no contamina las sesiones de la app. Al revés
  **no se puede impedir**: el `CLAUDE.md` raíz carga siempre (el panel vive
  debajo de él). Mitigación:
  - una línea en §0 del raíz: "`admin/` no está bajo las reglas 1-4 ni 6; sus
    reglas viven en `admin/CLAUDE.md`";
  - una regla `.claude/rules/admin-panel.md` con `paths: ["admin/**"]`, validada
    contra un archivo real (gotcha de §9: un `paths:` que no machea no da
    ningún error, simplemente no carga nunca).

---

## 2. Stack e identidad de los admins

**Recomendación (D2, aprobada): SPA con Vite + React + TS**, estática, con la
**publishable key** y `@supabase/supabase-js` fijado igual que la app
(`package.json`, 2.115.0).

- **Next.js, descartado:** su valor es tener un servidor, y aquí el servidor
  sería justo el lugar donde "tentaría" usar `service_role`. Además suma cookies
  SSR y un runtime que hospedar. Sin servidor, la restricción dura se cumple por
  construcción: el bundle no tiene de dónde sacar una secret key.
- **Riesgo de la SPA:** la sesión vive en `localStorage`, así que un XSS la
  robaría. Mitigación: CSP estricta (`script-src 'self'`, `connect-src` solo al
  proyecto de Supabase), `frame-ancestors 'none'` y ningún
  `dangerouslySetInnerHTML`. Todo texto de usuario se pinta escapado.

### Quién es admin: tabla `private.admins`, no `app_metadata`

Estructura: `private.admins(user_id uuid pk references auth.users on delete
cascade, nombre text, created_at, created_by uuid, activado_at timestamptz)`.

- **`app_metadata`, descartado:** viaja dentro del JWT, así que revocar a un
  admin no surte efecto hasta que su token expire (`jwt_expiry = 3600` en local,
  `config.toml:202`); solo se edita con `service_role`; `rls.sql` no puede
  probarlo sin fabricar claims; no deja rastro de quién lo otorgó. La tabla se
  consulta en cada request (revocación inmediata) y es una FK auditable.
- **Por qué `private`:** no está en `[api] schemas` (`config.toml:13`); según el
  `pg_default_acl` medido en remoto (solo hay entradas para `public`, `storage`,
  `graphql`, `graphql_public`, `realtime` y `extensions`), una tabla nueva en
  `private` nace sin grants para `anon`/`authenticated`. Aun así lleva
  `revoke all … from anon, authenticated` explícito y una aserción en T12.

### Cómo se crean las cuentas de admin, dado el trigger de alta

- `private.handle_new_user()` (`20260924000466:48-65`) inserta en `public.users`
  con la `universidad_id` del dominio, o NULL si no casa.
- El Auth Hook rechaza `@rlvo.com.mx` en `/otp`
  (`20260923000465:81-100`). El admin API con la secret key no pasa por el hook:
  está medido para `POST /admin/users` (`CLAUDE.md` §9, caso 7 de
  `probe-registro.mjs`). **Para `inviteUserByEmail` falta medirlo** (caso 1 de
  `probe-admin.mjs`); medirlo en el endpoint que se usa es regla del repo.
- **Recomendación (D4, aprobada):** cuentas de admin SEPARADAS,
  `nombre@rlvo.com.mx`, que no son usuarios del marketplace, creadas por el
  script local `scripts/crear-admin.mjs` (lo corre el admin técnico con la
  secret key en su `.env`, nunca desde el panel). Los correos `@rlvo.com.mx` ya
  reciben correo real (Google Workspace).
- **Consecuencias:** el trigger les crea una fila en `public.users` con
  `universidad_id` NULL. Con eso no pueden publicar (la FK publicación ↔ dueño lo
  impide, `20260924000466:134-140`); si entran a la app móvil caen en "Completar
  perfil (sin universidad asignada)"; aparecen en `users_select`
  (`using (true)`, `20260906000438:79-80`) sin nombre ni publicaciones. Las
  métricas los excluyen explícitamente.
- **¿Un admin es también usuario del marketplace? No.** Descartado: marcar como
  admin la cuenta institucional personal. Mezcla roles: el admin podría resolver
  reportes contra sí mismo o aprobar sus propias publicaciones, y su sesión móvil
  (aal1) convive con la de admin (aal2). Las RPCs rechazan de todos modos actuar
  sobre sí mismo o sobre otro admin.

### Activación en dos pasos y la ventana entre invitación y TOTP

El link de invitación es una credencial al portador hasta que se usa: quien lo
intercepte puede fijar contraseña y enrolar **su propio** TOTP. Mitigación:
`scripts/crear-admin.mjs` activa en dos pasos.

1. `invitar <correo> <nombre>`: `auth.admin.inviteUserByEmail` más una fila en
   `private.admins` con `activado_at = null`. Así `is_admin()` sigue en false
   aunque ya exista aal2.
2. `activar <correo>`: exige exactamente **1 factor TOTP verificado, creado
   después de la invitación**, y la confirmación **por otro canal** (llamada) de
   que la persona enroló; pone `activado_at` y lo audita con tipo `admin`.

Hasta el paso 2 la cuenta no ve nada. En local, la invitación llega a Mailpit
(`:54324`).

### MFA con aal2 exigido en la base (D16, D18)

- **`private.is_admin()` es UNA sola función para lecturas y escrituras**, con
  ventana de **12 h** de TOTP (C6). Exige, las tres a la vez:
  1. fila en `private.admins` con `activado_at is not null`;
  2. `auth.jwt()->>'aal' = 'aal2'`;
  3. un `amr` con `method = 'totp'` y `timestamp` de las últimas 12 h.
- **La forma del `amr` (D18) prevalece sobre la de v2 y sobre un `coalesce`
  plano.** Medido en local el 2026-09-29: sin la clave `amr`,
  `jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'))` devuelve 0 filas;
  con `"amr": null` (JSON null, que `coalesce` NO atrapa) lanza
  `ERROR: cannot extract elements from a scalar`. La forma aprobada:

```sql
exists (
  select 1
  from jsonb_array_elements(
         case when jsonb_typeof(auth.jwt()->'amr') = 'array'
              then auth.jwt()->'amr' else '[]'::jsonb end) e
  where jsonb_typeof(e) = 'object'
    and e->>'method' = 'totp'
    and (e->>'timestamp') ~ '^[0-9]{1,12}$'
    and (e->>'timestamp')::bigint > extract(epoch from now())::bigint - 12*3600
)
```

  Medida en 7 casos, ninguno lanza error:

  | Caso | Resultado |
  |---|---|
  | sin `amr` | false |
  | `amr: null` | false |
  | `["totp"]` (strings) | false |
  | timestamp basura | false |
  | solo password | false |
  | TOTP hace 1 h | **true** |
  | TOTP hace 13 h | false |

- **`private.exigir_admin()`** llama a `is_admin()` y lanza `42501` con **tres
  mensajes distintos**, para que la UI sepa qué pedir: `no_admin`,
  `mfa_requerido` (aal1) y `totp_vencido`.
- **Local:** TOTP está apagado (`config.toml:367-368`, `enroll_enabled` y
  `verify_enabled` en `false`); hay que encenderlo.
- **Remoto, bloqueante para la Ola 1 (RNF-09), tarea del usuario:** confirmar en
  el Dashboard (Auth → MFA) que TOTP está incluido en el plan gratuito. El
  comentario de `config.toml:360` dice "MFA… available to Supabase Pro plan", pero
  es la plantilla del CLI; la doc de GoTrue dice que TOTP viene activo por
  default. Si fuera de pago, cambia el plan.
- **Límites que se documentan:**
  - un token aal2 sigue valiendo hasta su `exp` aunque se borre el factor
    (mismo patrón que `amr`/`iat`, `CLAUDE.md` §9); lo cierra la ventana de 12 h;
  - un refresh de sesión renueva `iat` y **conserva** el `amr` con su timestamp
    original (`CLAUDE.md` §9). **Pendiente de medir** (caso 3 de
    `probe-admin.mjs`) que re-verificar el TOTP renueva ese timestamp; si no lo
    renueva, D16 no se puede cumplir y se reporta;
  - un admin no técnico que pierda el teléfono necesita que otro admin le borre
    el factor. Eso exige `service_role`, así que va en una **Edge Function
    `admin-reset-mfa`** (Ola 3): verifica `is_admin()` del que llama, no se
    aplica a sí mismo y deja auditoría. Mientras tanto, el admin técnico lo hace
    con el script.
- **La UI del panel debe detectar el rechazo y pedir el TOTP otra vez (C6):**
  toda llamada que devuelva `42501` con `totp_vencido` o `mfa_requerido` abre el
  modal de TOTP (`challengeAndVerify`) y reintenta; `no_admin` cierra la sesión.
  **Storage no dice por qué rechaza** (el 400/404 de una imagen no trae el
  motivo; se mide en la Ola 2), así que ante un 400 de una imagen la UI consulta
  `admin.sesion()`: si `totp_reciente` es false, pide TOTP y recarga las
  imágenes.

---

## 4. Cada acción de admin es una RPC, y toda acción se audita

*(La numeración salta del 2 al 4 porque el plan aprobado la conserva así: el
punto 3 quedó fundido con el 2.)*

### Schema `admin`, expuesto (D3, aprobada)

- **Por qué un schema propio y no `public`:** no crece la cuenta de "TRES
  definer en `public`" de `CLAUDE.md` §3; `gen:types --schema admin` genera
  tipos solo para el panel sin tocar los de la app; y el `pg_default_acl` de
  Supabase no lo alcanza (medido en remoto: no hay entrada para un schema
  nuevo), así que nace sin grants.
- **Grants (V6):**

```sql
create schema admin;
revoke all on schema admin from public;
grant usage on schema admin to authenticated;   -- nada para anon
-- y en cada función:
revoke all on function admin.x(...) from public, anon;
grant execute on function admin.x(...) to authenticated;
```

  El `revoke … from public` no sobra: Postgres le da EXECUTE a PUBLIC en toda
  función nueva, y eso es independiente del ACL de Supabase.
- **Costos:** agregar `admin` a `[api] schemas` en `config.toml:13` y en el
  Dashboard (paso manual del usuario, Ola 3).

### Plantilla de TODA RPC

- `security definer`, `set search_path = ''`, plpgsql.
- Primera línea: `perform private.exigir_admin();`.
- Las escrituras: hacen compare-and-set sobre el estado esperado y lanzan si
  afectan 0 filas (lección de `listings_update_own`, `CLAUDE.md` §3); exigen
  `p_motivo` de 3 a 500 caracteres tras `btrim`; auditan en la misma
  transacción; rechazan actuar sobre uno mismo o sobre otro admin.
- Las paginadas (C8) usan `v_limit := least(greatest(coalesce(p_limit, 50), 1),
  100)` y cursor por `id`. `max_rows = 1000` (`config.toml:18`) no reemplaza este
  tope.
- **Ningún `grant update` nuevo a `authenticated` sobre ninguna tabla.**
- Las lecturas también van por RPC definer y **no** con policies de admin sobre
  `listings`/`users`/`reports`: así el camino caliente del feed
  (`listings_select`, `20260917000459:44-47`) no gana ni un `or` nuevo. La única
  excepción es Storage (§6), porque las fotos se sirven por el endpoint
  autenticado y no por RPC (`CLAUDE.md` §9, signed URLs).

### Objetos de `private`

| Objeto | Detalle |
|---|---|
| `private.admins` | `user_id uuid pk references auth.users on delete cascade`, `nombre`, `created_at`, `created_by`, `activado_at`. `revoke all … from anon, authenticated` |
| `private.is_admin()` | `sql stable security definer set search_path = ''`; `revoke … from public, anon`; `grant execute … to authenticated` (workaround del SIGSEGV, ver §5). Forma de D18 arriba |
| `private.exigir_admin()` | Lanza `42501` con `no_admin` / `mfa_requerido` / `totp_vencido`. Solo la llaman RPCs definer, así que va **revocada** a `authenticated` |
| `private.claves_auditoria_ok(p_tipo text, p jsonb)` | IMMUTABLE, `set search_path = ''`. Ver D20 abajo |
| `private.admin_acciones` | Auditoría append-only. Ver abajo |

### `private.claves_auditoria_ok` (D20, prevalece sobre la lista global de v2)

Un CHECK no puede llamar `jsonb_object_keys` directo (es set-returning), así que
va dentro de una función IMMUTABLE. **Medido en local el 2026-09-29** (dentro de
`begin … rollback`, sin residuo): `provolatile = i`; aceptó las 7 filas válidas,
una por tipo de objetivo; rechazó con `violates check constraint` las 6
inválidas (`correo`; `nombre` en `usuario`; un objeto anidado
`{"estado":{"correo":…}}`; `titulo` en `listing`; un array en vez de objeto; un
tipo inventado), y el conteo siguió en 7.

La lista es **por tipo de objetivo** y **rechaza valores anidados**. Con una
lista global, `nombre` quedaría permitido también para `usuario`, que es justo la
fuga que se quiere impedir; y un valor anidado colaría el dato personal como
valor de una clave permitida.

| `objetivo_tipo` | Claves permitidas en `antes`/`despues` |
|---|---|
| `usuario` | `estado`, `suspendido_at`, `publicaciones_pausadas` |
| `reporte` | `estado`, `resolved_at` |
| `listing` | `estado` |
| `universidad` | `nombre` |
| `campus` | `nombre`, `ciudad`, `latitud`, `longitud`, `universidad_id` |
| `dominio` | `dominio`, `universidad_id`, `activo` |
| `admin` | `activado_at`, `factores_borrados` |

Cualquier tipo fuera de esta tabla, o una clave nueva, exige migración. **Se
revisó cada RPC del plan contra esta lista y todas pueden auditar con ella:**
suspender/reactivar → `usuario`; resolver → `reporte`; aprobar/bloquear →
`listing`; editar universidad → `universidad`; editar campus → `campus`
(`nombre`, `ciudad`, más las coordenadas); los tres de dominio → `dominio`;
activar admin y `admin-reset-mfa` → `admin`. `crear_*` usa `antes = null`.

### `private.admin_acciones` (C4)

- **Columnas:** `id bigint identity`; `admin_id uuid not null` **sin FK** (si la
  cuenta del admin se borra, la fila de auditoría se conserva);
  `admin_correo text not null` (snapshot); `accion text check (…)`;
  `objetivo_tipo text check ('reporte','listing','usuario','universidad',
  'campus','dominio','admin')`; `objetivo_id text not null`; `antes jsonb`;
  `despues jsonb`; `motivo text not null`; `created_at`.
- **Qué va en `antes`/`despues`:** solo ids, estados y banderas, por ejemplo
  `{"estado":"activo"}` → `{"estado":"suspendido","publicaciones_pausadas":3}`.
  **Nunca correo, nombre, teléfono, título ni comentario.** Lo hace cumplir un
  CHECK que llama a `claves_auditoria_ok()` sobre las dos columnas.
- **El `motivo` es texto libre:** el panel avisa "no escribas datos
  personales", pero la base no puede hacerlo cumplir.
- **Append-only:** `before update or delete … for each row` y
  `before truncate … for each statement`, los dos con `raise`. Alcance honesto:
  `postgres` puede hacer `drop trigger`; esto frena errores, no a un superusuario
  malicioso.
- **El `DETAIL` de un rechazo del CHECK imprime la fila completa** (con el
  `motivo`) y puede llegar a logs: no se pega en chats ni tickets (va también en
  `admin/CLAUDE.md`).
- **D7 (aprobada):** después de "Eliminar cuenta", `objetivo_id` conserva el uuid
  de alguien que ya no existe (no se resuelve a nada) y el `motivo` que escribió
  el admin. Se conserva como registro de moderación y se anota en el aviso de
  privacidad. T33 (h) solo barre columnas `uuid` de `public`
  (`supabase/tests/rls.sql`, sección T33 (h)) y `objetivo_id` es `text` en
  `private`, así que **es una excepción documentada** a ese barrido, no un hueco
  que se coló.

### Lista completa de RPCs, con firma

Todas en el schema `admin`, `security definer`, con `exigir_admin()` como primera
línea. Las columnas de retorno son las del plan aprobado; la migración de cada
ola las fija.

| RPC | Devuelve | Ola | Notas |
|---|---|---|---|
| `admin.sesion()` | `jsonb {es_admin, aal, totp_reciente, totp_expira_en}` | 1 | Gating de UX del panel, **no es candado** |
| `admin.buscar_usuarios(p_q text, p_limit int default 20)` | `table(id, nombre, correo, universidad, campus, estado, suspendido_at, suspension_motivo, created_at, publicaciones int, reportes_en_contra int, es_admin bool)` | 1 | Lee `correo` (D8, excepción a RNF-05 solo para admins) |
| `admin.detalle_usuario(p_user_id uuid)` | `jsonb` | 1 | La Ola 2 la reusa para el objetivo de un reporte |
| `admin.suspender_usuario(p_user_id uuid, p_motivo text)` | `int` (publicaciones pausadas) | 1 | Dispara `pause_listings_on_suspend` (§7) |
| `admin.reactivar_usuario(p_user_id uuid, p_motivo text)` | `void` | 1 | No despausa (decisión de `20260917000457`) |
| `admin.listar_reportes(p_estado report_status default 'pendiente', p_cursor bigint default null, p_limit int default 50)` | `table(id, motivo, comentario, estado, created_at, resolved_at, reporter_id, reporter_nombre, objetivo_tipo text, listing_id, listing_titulo, listing_estado, reported_user_id, reported_user_nombre, reported_user_correo, reported_user_estado, reportes_mismo_objetivo int)` | 2 | `objetivo_tipo` ∈ `publicacion` / `usuario` / `publicacion_eliminada` / `cuenta_eliminada` (§13). Solo left joins |
| `admin.resolver_reporte(p_id bigint, p_estado report_status, p_motivo text)` | `void` | 2 | Solo `pendiente → resuelto/descartado`. Escribe `resolved_at`. Audita `{estado, resolved_at}` |
| `admin.detalle_listing(p_id bigint)` | `jsonb` | 2 (adelantada, D19) | Cualquier estado, con todo su historial de `listing_moderacion` |
| `admin.bloquear_listing(p_id bigint, p_motivo text)` | `void` | 2 (adelantada, D19) | Desde `pendiente/activa/pausada/vendida`, nunca desde `bloqueada`. Audita solo `estado` |
| `admin.cola_moderacion(p_solo_evaluadas boolean default true, p_cursor bigint default null, p_limit int default 50)` | `table(listing…, dueño_nombre, dueño_estado, fotos text[], evaluaciones int, ultimo_veredicto text, ultimo_detalle jsonb)` | 4 | `p_solo_evaluadas` separa las marcadas por moderación de las abandonadas a media subida |
| `admin.aprobar_listing(p_id bigint, p_motivo text default null)` | `text` (estado final) | 4 | Solo `pendiente → activa`. Rechaza si el dueño no está `activo` o si tiene 0 fotos (traduce los errores de los triggers) |
| `admin.crear_universidad(p_nombre text)` / `admin.editar_universidad(p_id bigint, p_nombre text, p_motivo text)` | `bigint` / `void` | 5 | |
| `admin.crear_campus(p_universidad_id bigint, p_nombre text, p_ciudad text, p_latitud double precision, p_longitud double precision)` / `admin.editar_campus(p_id bigint, p_nombre text, p_ciudad text, p_latitud double precision, p_longitud double precision, p_motivo text)` | `bigint` / `void` | 5 | `editar_campus` **no acepta** `universidad_id`: nunca mueve un campus de universidad |
| `admin.agregar_dominio(p_dominio text, p_universidad_id bigint, p_motivo text)` / `admin.desactivar_dominio(p_dominio text, p_motivo text)` / `admin.reactivar_dominio(p_dominio text, p_motivo text)` | `void` | 5 | Borrado lógico (§10) |
| `admin.metricas(p_desde date, p_hasta date, p_universidad_id bigint default null)` | `table(dia date, altas int, usuarios_activos int, publicaciones_creadas int, contactos int)` | 6 | Rango máximo de 366 días; excluye admins; altas sobre `public.users` |
| `admin.auditoria(p_objetivo_tipo text default null, p_objetivo_id text default null, p_cursor bigint default null, p_limit int default 50)` | `table(…)` | 6 | Solo lectura. (La Ola 1 muestra "su auditoría" de un usuario con una consulta acotada del mismo módulo) |

**No son RPCs, por diseño:** `crear-admin.mjs` (script local con la secret key:
invitar y activar) y la Edge Function `admin-reset-mfa` (Ola 3).

---

## 5. KNOWN_ISSUES (el SIGSEGV)

- Condiciones del crash (`supabase/KNOWN_ISSUES.md`, "Condiciones para
  reproducirlo"): una policy que invoca un definer que el rol no puede ejecutar,
  más un plpgsql que captura el rechazo.
- **`private.is_admin()` se invoca desde una policy de Storage**, así que lleva
  el workaround completo: `language sql stable security definer set search_path =
  ''`; `revoke execute … from public, anon`; `grant execute … to authenticated`.
  El `USAGE` sobre `private` ya existe (`20260906000437:16`).
- **Aserción:** se extiende la de T12 (`supabase/tests/rls.sql`, invariantes de
  T12: "authenticated puede ejecutar las 3 funciones invocadas desde policies")
  de **3 a 4** funciones, sumando `private.is_admin()`. Control negativo:
  `revoke execute on function private.is_admin() from authenticated` → cae esa
  aserción con su mensaje explícito, en vez de matar el backend.
- `private.exigir_admin()` solo la llaman RPCs definer (corre como su dueño), así
  que va **revocada** a `authenticated`, con una aserción gemela en una lista
  nueva de T12. Control: `grant`.

---

## 6. Storage: fotos de `pendiente` y `bloqueada`

Hoy `listing_photos_objects_select`
(`20260908000446_storage_listing_photos_policies.sql:100-109`) = `exists` sobre
`listings` (que pasa a su vez por `listings_select`) `and (estado <> 'pausada' or
dueño)`. Como `listings_select` le muestra al dueño todas las suyas
(`20260917000459:44-47`), **el dueño ve hoy las fotos de su `bloqueada`**. La
decisión de producto es que dejen de ser visibles incluso para el dueño, y el
admin necesita verlas para moderar.

**Propuesta, dos policies permisivas:**

1. `listing_photos_objects_select` (drop + create) agrega
   `and l.estado <> 'bloqueada'` dentro del `exists`. Para terceros,
   `pendiente`/`bloqueada` siguen fuera por `listings_select`. **Esta condición
   SÍ es portante**, a diferencia del `<> 'pausada'` redundante que documenta la
   migración original.
2. `listing_photos_objects_select_admin`:
   `bucket_id = 'listing-photos' and (select private.is_admin())`, sin `exists`
   sobre `listings`, porque el admin no pasa por `listings_select`.

Y la **tabla** `listing_photos_select`
(`20260906000439_listings_and_photos.sql:135-138`) debe espejearla: sin filas de
fotos para el dueño de una `bloqueada`. Si no, la app pide imágenes que dan 400.
La UI de la app para una bloqueada sin fotos (Mis publicaciones,
`no-aprobada.tsx`, `editar/[id].tsx`) necesita frame primero (`CLAUDE.md` §0
regla 4): es tarea de la app, no del panel.

**Reparto entre olas (D19):** la policy del **admin** se adelanta a la Ola 2
(hace falta para "ver el objetivo" de un reporte); la del **dueño** y la de la
tabla `listing_photos` van en la Ola 4, después de decidir D5.

### D5: quién borra los objetos de una `bloqueada` (se decide al entrar a la Ola 4, con su frame)

`remove()` de Storage resuelve primero lo que el invocante VE. Si no ve nada,
responde **200 `[]` sin error** (`CLAUDE.md` §9, medido). Con la regla nueva:

| Camino | Cliente que usa | Con la regla nueva |
|---|---|---|
| El dueño elimina la publicación en la app | sesión del usuario: `borrarFotos()` → `.remove()` (`src/lib/storage.ts:238-241`) | **Deja huérfanos en silencio.** `borrarFotos()` no revisa el array devuelto a propósito (`CLAUDE.md` §9) |
| "Eliminar cuenta" | `ctx.supabaseAdmin` (`supabase/functions/eliminar-cuenta/index.ts:92`) con `list` + `remove` y verificación del conteo (`:58-71`) | **Sin huérfanos.** `service_role` no pasa por RLS, y el conteo estricto lanzaría si algo faltara |
| `moderar-contenido` (descarga) | `supabaseAdmin` | No le afecta |

Opciones para el primer camino:
- (a) una Edge Function que valide que quien llama es el dueño y borre con
  `service_role` (**recomendada**);
- (b) prohibir que el dueño borre una `bloqueada`: además conserva su
  `listing_moderacion` como evidencia (hoy borrarla se lo lleva en cascada);
- (c) aceptar los huérfanos y purgarlos desde el panel.

Para que el segundo camino no retroceda, se agrega un caso a
`probe-eliminar-cuenta.mjs`: una cuenta con una `bloqueada` con foto queda con 0
objetos. Control: `vaciarCarpeta` con el cliente del usuario → cae. **D5 no
bloquea las Olas 0-3.**

---

## 7. Suspensión

**Confirmado:**
- el trigger `users_pause_listings_on_suspend` es `after update … when
  (old.estado is distinct from new.estado and new.estado = 'suspendido')`
  (`20260917000457:112-116`) y dispara sin importar el rol que haga el UPDATE;
- la función `private.pause_listings_on_suspend()` es definer (`:72-93`);
- `admin.suspender_usuario` hace `update public.users set estado = 'suspendido'
  …` como dueño de la función, así que lo dispara. La RPC devuelve el conteo de
  publicaciones que pasaron a `pausada`, medido antes y después.

**Columnas nuevas en `users`:** `suspendido_at timestamptz` y `suspension_motivo
text`, con el check `users_suspension_coherente`:
`(estado = 'suspendido') = (suspendido_at is not null and suspension_motivo is
not null)`. **D15:** esto vuelve obligatorio el motivo también al suspender desde
Studio. Los 7 usuarios de remoto están `activo`, así que no hace falta backfill.
La historia completa vive en `admin_acciones`.

**Quién lee el motivo:**
- `users` tiene `select` **por columna** (`20260924000466:158-160`), así que las
  columnas nuevas quedan ilegibles para `authenticated` sin tocar nada.
- Terceros: no (hoy ven solo `estado`).
- El propio usuario: con una RPC `public.mi_suspension()` que devuelve
  `(suspendido_at, suspension_motivo)` **solo de `auth.uid()`**. La construye la
  tarea siguiente (el aviso de suspensión en la app) y **no entra en RF-17**: si
  entrara, sería la cuarta definer de `public`.
- Aserción en T12: `authenticated` no tiene SELECT sobre las dos columnas.
  Control: `grant select (suspension_motivo)`.

**Sesiones vivas y URLs firmadas (C6, V4, V5):**
- **Suspender.** Todas las escrituras que un suspendido no debe hacer llevan
  `(select private.is_active_user())` en su policy, y esa función lee
  `users.estado` en cada request (`20260906000438:58-61`): publicaciones, fotos,
  Storage, contactos, calificaciones, reportes y ventas. **Un JWT vivo no le da
  ninguna ventana.** Lo que sigue pudiendo hacer (leer, editar su perfil,
  favoritos, intereses) está permitido a propósito (`CLAUDE.md` §3). Mitigación
  necesaria: ninguna; revocar sesiones sería redundante.
- **Bloquear una publicación.** No hay signed URLs en el código (`grep
  createSignedUrl` sobre `src` y `supabase/functions` sale vacío;
  `src/lib/storage.ts:253-263` documenta que se descartaron a propósito), así que
  no hay TTL que citar y el efecto en servidor es inmediato: `listings_select` y
  la policy de Storage se reevalúan en cada request. **Residuo:** lo que ya está
  en el disco de `expo-image` de quien la vio, y la tarjeta en memoria hasta el
  siguiente refetch. Mitigación mínima: aceptarlo y documentarlo en
  `explorar.md`; purgar cachés ajenas no se puede desde el servidor.
- **Revocar a un admin** es inmediato (lee la tabla). Si solo se le borra el
  factor TOTP, su token aal2 sigue vivo hasta `exp`; lo cierra la ventana de 12 h
  de D16.

---

## 8. Deuda marcada "cuando exista RF-17"

Grep de "RF-17" sobre `CLAUDE.md`, `.claude/rules/`, `supabase/migrations/` y
`src/`, y cuáles activa esta plataforma:

| Deuda | Dónde | ¿Se activa? |
|---|---|---|
| Publicación creada `activa` para una cuenta ya suspendida | `.claude/rules/cuenta-perfil.md` (deuda del pausado al suspender), `20260917000457:118-133` | **Sí, y por una vía que la deuda no preveía.** `pause_listings_on_suspend` solo toca `activa` (`:86-89`), así que las `pendiente` de un suspendido quedan en la cola, y **aprobar desde el panel las volvería `activa`**. Lo mismo hace hoy `moderar-contenido`, que no mira el estado del dueño (grep sin coincidencias de `suspendido`/`is_active_user` en su `index.ts`). Fix en la Ola 4, ver abajo |
| `reports.resolved_at` que nadie escribe | `.claude/rules/notificaciones-push.md` (deuda `resolved_at`) | **Sí.** La escribe `admin.resolver_reporte` (Ola 2) |
| La cola mezcla marcadas por moderación con abandonadas a media subida | `.claude/rules/moderacion.md` §9 | **Sí**, con `p_solo_evaluadas` de `cola_moderacion` |
| Un falso negativo que llega por reporte: mirar la fila de moderación | `.claude/rules/moderacion.md` §8b | **Sí.** El detalle de un reporte de publicación muestra su `listing_moderacion` |
| "La cola de `pendiente` la revisa el dev en Studio" | `CLAUDE.md` §3 (RF-18, umbrales) | **Se reemplaza** cuando el panel esté desplegado; ya reescrito como "hoy, y hasta que…" |
| `bloqueada` no tiene recurso (justifica el techo de Rekognition) | `CLAUDE.md` §3, `supabase/functions/moderar-contenido/decision.ts:221-224`, `moderacion.md` §9 | **No en la fase 1** (D10): no hay "desbloquear" y `bloqueada → activa` sigue sin camino. Si se agrega, se reabre esa justificación |
| El copy de "no fue aprobada" no dice el motivo | `src/app/(publicar)/no-aprobada.tsx`, `20260928000473:90-91`, `detalle/[id].tsx` | **Se prepara el dato, no la UI.** El motivo del admin vive **una sola vez**, en `admin_acciones.motivo`. La fila de `listing_moderacion` que escribe el admin lleva `detalle = {origen:'admin', accion_id}` **sin el texto**. No es columna de `listings` (tiene `select` de TABLA, sería público; mismo argumento que `listing_sales`, `CLAUDE.md` §3). Mostrarlo necesita frame y una RPC del dueño: tarea aparte |
| Copy por caso en "Respuesta a tu reporte" | `20260911000451:146-150` | No: sigue genérico; un copy por caso exigiría frame primero |
| `vendida` terminal por policy para que Studio corrija ventas | `20260913000454:43` | No: el panel no corrige ventas en la fase 1 |
| Opción "(ii) triggers apagados hasta RF-17" | `moderacion.md` | Obsoleta; solo se borra la mención |
| El soporte como único canal de apelación del suspendido | `cuenta-perfil.md` | Insumo de la tarea del aviso de suspensión, no de esta |

**El fix de la primera fila (Ola 4), en este orden (C1, C3):**
1. **`moderar-contenido` primero:** cuando la promoción choca con el trigger
   (SQLSTATE `P0001`, mensaje `dueno_no_activo`), la publicación se queda en
   `pendiente`, se anota `detalle.descartado_por_dueno_no_activo` y la función
   responde `pendiente`, no un 500. Se despliega ANTES, porque tolera que el
   trigger todavía no exista.
2. **Migración:** trigger `before insert or update of estado` en `listings` que
   **lanza** si `new.estado = 'activa'` y el dueño no está `activo` (D9: lanza,
   no reescribe en silencio).
3. **Pruebas:** `probe-moderacion-http.mjs`, caso nuevo: el dueño se suspende
   entre el alta y la llamada → 200, `pendiente`, fila de auditoría con la marca
   (control: sin el manejo del error → 500). T35b (abajo).

**Medido en local el 2026-09-29 (C3):** con una versión del trigger aplicada
dentro de la transacción de la suite, la suite completa muere en T11b
(`ERROR: dueno_no_activo`). Con una variante que solo avisa en vez de lanzar, la
suite queda verde y el trigger habría rechazado exactamente **4 escrituras**, todas
`INSERT` hechos como `postgres` que siembran una publicación `activa` de un dueño
suspendido:

| Sección | Fixture | Dueño | Línea |
|---|---|---|---|
| T11b | `RLS Favoritos contables` | `:B`, suspendido desde T10 | `rls.sql:444-446` |
| T13 | `RLS Cálculo de Larson, 9a edición` | `:B` | `rls.sql:489-491` |
| T14 | `RLS Fotos suspendido` | `:B` | `rls.sql:580-583` |
| T23 | `RLS Susp posterior` | `:Q`, suspendido | `rls.sql:1906-1908` |

Ninguna aserción cae por sí misma: lo que cae son los fixtures. Arreglo, en el
mismo cambio que el trigger:
- **T11b y T13:** sembrar su propio dueño activo. **No usar `:A`**: T14 depende
  de que a esa altura no tenga publicaciones (`CLAUDE.md` §3, moraleja "no
  reutilices fixtures").
- **T14 `RLS Fotos suspendido`:** sembrarla `pausada`. La policy de INSERT del
  objeto (`20260908000446:119-129`) mira dueño e `is_active_user()`, no el estado;
  hay que verificar que la aserción siga cayendo **por `is_active_user()`**, con
  su control.
- **T23 (e):** el fixture es justo la deuda que el trigger cierra, así que sin él
  (e) deja de ser observable. Propuesta: `alter table … disable trigger
  listings_exige_dueno_activo` solo alrededor de ese insert, dentro de la
  transacción de la suite y con comentario. El control de T23 (e) (quitar `old.estado
  is distinct from new.estado`) tiene que seguir cayendo ahí.
- Después se corre la suite completa **con el trigger lanzando**, y cada control de
  T11b, T13, T14 y T23 por separado, para confirmar que ninguna aserción quedó
  pasando por la razón equivocada.

**Bug preexistente encontrado al planear (Ola 0, HECHO en local, sin pushear):**
`private.notify_report_resolved()` insertaba `new.reporter_id` en
`notifications.user_id` (NOT NULL); desde `20260929000474` `reporter_id` puede ser
NULL, así que resolver el reporte de una cuenta eliminada abortaba con `23502`
(medido en local). Corregido por `20260930000476` (`CLAUDE.md` §3, "Resolver el
reporte de una cuenta ya eliminada…"); lo vigilan T36 (a) y (a2).

---

## 9. Métricas

| Métrica | Fuente | Sesgo |
|---|---|---|
| Publicaciones creadas | `listings.created_at` | Una publicación o cuenta borrada desaparece de la historia (cascade) |
| Contactos generados | `listing_contacts.created_at` (`20260906000440:45-50`) | Igual |
| Altas | `public.users.created_at`, sin admins | **Nunca `auth.users`** (fila de prueba sobrante, ver Contexto) |
| Ventas / calificaciones (extra) | `listing_sales.created_at`, `ratings.created_at` | Igual |
| **Usuarios activos** | **no hay fuente hoy** | `last_sign_in_at` solo cambia al hacer login y la sesión dura semanas |

**Propuesta (C5, D11 aprobada con "el snapshot después"; va en la Ola 6):
`public.actividad_diaria`**

```sql
create table public.actividad_diaria (
  user_id uuid not null references public.users(id) on delete cascade,
  dia     date not null default (now() at time zone 'America/Mexico_City')::date,
  primary key (user_id, dia)
);
```

- RLS con una sola policy: `insert` con `with check (user_id = auth.uid())`. Sin
  select, update ni delete.
- `revoke all … from anon, authenticated; grant insert (user_id) on
  public.actividad_diaria to authenticated;`. **Solo `user_id`:** el cliente no
  puede fijar `dia`, así que no puede fabricar días pasados ni futuros.
- La app hace `insert … on conflict do nothing` al pasar a foreground, como mucho
  una vez al día (guarda el último día enviado en memoria). **Pendiente de medir
  en local:** si `ignoreDuplicates` (`ON CONFLICT DO NOTHING`) funciona sin SELECT
  sobre la columna del conflicto ni policy de select; si no, el cliente hace un
  insert plano y se traga el `23505`.
- No necesita definer: es invoker con su policy.
- **Costo:** como mucho 1 fila por usuario activo al día (~40 B más el índice).
  Con 1 000 usuarios activos diarios son ~365 000 filas al año, muy dentro del plan
  gratuito (RNF-09).
- **Descartadas:** `auth.refresh_tokens`/`auth.sessions` (schema interno de
  GoTrue, sin historial y con formato que cambia); contar lecturas (imposible sin
  escribir); PostHog o cualquier tercero (excluidos).
- **Sesgo del cascade:** las métricas históricas bajan cuando alguien borra su
  cuenta. El snapshot diario agregado (`private.metricas_diarias` con `pg_cron`) lo
  corrige y **queda para después** (D11).

---

## 10. Dominios, universidades y campus

**Lo que pasa hoy si un admin borra algo, leído del esquema** (se mide con
`begin … rollback` en la Ola 5, no se da por leído):

| Acción | Efecto | Fuente |
|---|---|---|
| Borrar un dominio | No hay FK de `users` hacia `universidad_dominios`: los usuarios existentes conservan su universidad (se asigna solo en el alta) y siguen entrando (el hook solo toca el alta). Las altas nuevas de ese dominio se rechazan. Lo único que se pierde es el rastro | `20260924000466:55-62` |
| Borrar un campus con referencias | **Aborta**: las FKs compuestas `users_campus_universidad_fkey` y `listings_campus_universidad_fkey` no declaran `on delete` (NO ACTION). Un campus sin referencias sí se borra | `20260924000466:83-86, 101-104` |
| Borrar una universidad | Cascade a `campus` y `universidad_dominios`; aborta si algún campus tiene referencias o si algún usuario la tiene (`users.universidad_id`, NO ACTION) | `20260906000437:52`, `20260923000465:31`, `20260906000438:11` |
| Mover un campus a otra universidad | Falla por la FK compuesta | `20260924000466` |

**Recomendación (D12, aprobada):**
- **Dominios con borrado lógico:** columna `universidad_dominios.activo boolean
  not null default true`. El hook y `handle_new_user()` filtran `and d.activo`
  **en las dos copias**, amarradas por T28 (a3) (no pueden compartir helper: el
  hook corre como `supabase_auth_admin`, sin `USAGE` sobre `private`).
- **Universidades y campus en la fase 1:** solo alta y edición, **sin borrar ni
  desactivar**. Desactivar un campus obliga a decidir qué ve el selector
  (`fetchCatalogoCampus`) y quién sigue atado a él: es una tarea de producto
  aparte.
- La base ya impide lo peligroso; las RPCs no exponen `delete`.

---

## 11. Hosting y configuración de Auth

- **Cloudflare Pages** (D13, aprobada; gratis, sin límite de ancho de banda, con
  uso comercial permitido) en `admin.rlvo.com.mx` (CNAME), con despliegue desde el
  repo: build `admin/`, salida `admin/dist`. Headers (CSP, HSTS,
  `X-Frame-Options: DENY`) por `_headers`. **Cloudflare Access queda para
  después**, como segundo perímetro; no sustituye a RLS.
- **Vercel Hobby, descartado:** sus términos prohíben uso comercial.
- **Redirect URLs:**
  - remoto: agregar `https://admin.rlvo.com.mx/**`;
  - **local (C2):** agregar `http://localhost:5173/**` a `additional_redirect_urls`
    (`config.toml:200`).
  - **Por qué no rompe la app:** la app no usa redirects. El OTP se teclea
    (`src/app/(onboarding)/recuperar-password.tsx:35`), no hay `emailRedirectTo` en
    `src/` (grep) y el scheme `relevomarketplace` (`app.json:8`) no pasa por Auth.
- **Site URL:** solo se cambia si las plantillas de la app no usan
  `{{ .ConfirmationURL }}`; se revisa en el Dashboard (la de magic link está puesta
  a mano). **Nunca `supabase config push`** (`CLAUDE.md` §9): empuja el
  `config.toml` entero y puede tumbar el correo de producción.
- La plantilla `invite` local apunta al panel con `token_hash`. En remoto se edita
  en el Dashboard.

---

## 12. Diseño

- **Fuente nueva: `design/admin-panel.html`.** Mismo método que
  `relevo-app.html` (frames estáticos primero; fuente de verdad, §0 reglas 1-4
  aplicadas al panel mediante `admin/CLAUDE.md`), pero en layout de escritorio.
- **Reusa los tokens de color y tipografía de §2**: las variables de `:root`
  (`design/relevo-app.html:10-21`) y el par Fraunces/Inter. **No** reusa tamaños,
  espaciados ni componentes de teléfono.
- **Descartado:** shadcn/Tailwind con sus defaults: crean una segunda identidad
  visual y no tienen fuente de verdad en el repo.
- **D14 (aprobada):** la Ola 1 usa pantallas funcionales mínimas **sin frame**
  (excepción a "frame primero"); a partir de la Ola 2 el orden es frames → tu
  aprobación del diseño → migración.

---

## 13. Reportes cuyo objetivo ya no existe

**Qué deja la base en cada caso:**
- **Usuario reportado que borró su cuenta:** `reported_user_id` queda NULL (FK
  `set null`, `20260906000441:7`) y `reported_user_correo` también
  (`20260929000474:97-112`). El reporte sobrevive **sin identidad**, por diseño
  (decisión 5 de "Eliminar cuenta").
- **Publicación eliminada:** `listing_id` queda NULL y se conserva `listing_titulo`,
  que siempre se captura al crear el reporte (`20260906000441:45-49`).
- **Reportante eliminado:** `reporter_id` queda NULL
  (`20260929000474:86-91`).

**Cómo lo clasifica el panel** (misma lógica que `notify_report_resolved`,
`20260911000451:160-163`):

```sql
objetivo_tipo = case
  when listing_id is not null       then 'publicacion'
  when reported_user_id is not null then 'usuario'
  when listing_titulo is not null   then 'publicacion_eliminada'
  else 'cuenta_eliminada'
end
```

Solo left joins, y **nunca se filtra por "objetivo existente"**: el panel pinta una
etiqueta en cada caso ("Publicación eliminada", "Cuenta eliminada") y no revienta
ni esconde el reporte. Cubierto por T36 (Ola 2).

---

## Migraciones, en orden

Numeración según D17 (aprobada): `476+` mientras el día real sea menor que la
última fecha del repo (hoy `20260930000475`); después, la fecha real. Un archivo
nuevo se crea con `supabase migration new <nombre>` y se **renombra al siguiente
consecutivo** (`CLAUDE.md` §6). El orden de v2.1 con los adelantos de D19:

| # | Archivo | Ola | Contenido |
|---|---|---|---|
| 1 | `20260930000476_notify_report_resolved_sin_reportante.sql` | 0 — **HECHA en local, sin pushear** | `WHEN` de `reports_notify_resolved` con `and new.reporter_id is not null` |
| 2 | `20260930000477_admins_y_auditoria.sql` | 1 | `private.admins`, `private.claves_auditoria_ok`, `private.admin_acciones` (CHECK + triggers append-only), `private.is_admin`, `private.exigir_admin`, schema `admin` con su `grant usage`, `admin.sesion()` |
| 3 | `20260930000478_users_suspension.sql` | 1 | `users.suspendido_at`/`suspension_motivo` + `users_suspension_coherente`; `admin.buscar_usuarios`, `admin.detalle_usuario`, `admin.suspender_usuario`, `admin.reactivar_usuario` |
| 4 | `20260930000479_admin_reportes.sql` | 2 | `admin.listar_reportes`, `admin.resolver_reporte`, y **adelantadas por D19:** `admin.detalle_listing`, `admin.bloquear_listing` y la policy `listing_photos_objects_select_admin` |
| 5 | `20260930000480_listings_activa_exige_dueno_activo.sql` | 4 — **después** de desplegar `moderar-contenido` | Trigger `before insert or update of estado` que lanza `dueno_no_activo` |
| 6 | `20260930000481_admin_moderacion.sql` | 4 | `admin.cola_moderacion`, `admin.aprobar_listing`, y la policy del dueño y la de la tabla `listing_photos` según D5 |
| 7 | `20260930000482_catalogo_admin.sql` | 5 | `universidad_dominios.activo`; hook y `handle_new_user()` (`create or replace`); RPCs de catálogo |
| 8 | `20260930000483_actividad_diaria_y_metricas.sql` | 6 | `public.actividad_diaria`, `admin.metricas`, `admin.auditoria` |

La Ola 3 no tiene migración (despliegue + Edge Function). Cada migración de un
grant nuevo lleva `revoke all` explícito antes (`CLAUDE.md` §1, §9,
`pg_default_acl`).

---

## Aserciones nuevas en `supabase/tests/rls.sql`

Cada una lleva su control negativo, **corrido por separado** dentro de `begin;
<variante>; <suite>; rollback`, **imprimiendo antes el estado vivo** (§9,
"una verificación sospechosamente limpia"), contra la suite completa **y** contra
la sección aislada. Si una aserción falla en OTRA aserción, la prueba está mal
escrita.

**Helpers nuevos (Ola 1):** `pg_temp.as_user_aal(uid, aal text, amr jsonb, sql)`
(fija `sub`, `role`, `aal` y `amr`; con `amr => null` deja la clave como JSON
`null`, a propósito, para probar D18) y `pg_temp.amr_totp(horas_atras int)`. Los
helpers actuales solo ponen `sub`/`role` (`rls.sql:92-130`).

### T12 — invariantes de grants

| Aserción | Control negativo |
|---|---|
| EXECUTE de `authenticated` sobre **4** funciones invocadas desde policies (`is_active_user`, `can_rate`, `listing_id_from_object_name`, **`is_admin`**) | `revoke execute … from authenticated` |
| `private.exigir_admin()` y `private.claves_auditoria_ok()` revocadas a `authenticated` | `grant execute` |
| `private.admins` y `private.admin_acciones` sin privilegios de tabla **ni de columna** para `anon`/`authenticated` | `grant select (motivo)` |
| `users.suspendido_at`/`suspension_motivo` sin SELECT para `authenticated` | `grant select (suspension_motivo)` |
| Toda función de `admin.*` es definer, con `search_path` fijo y sin EXECUTE para `anon`/`public` | una RPC sin el `revoke … from public` |
| `authenticated` tiene USAGE sobre `admin` y `anon` no | `grant usage on schema admin to anon` |

### T35 — identidad, MFA, auditoría y suspensión (Ola 1)

Autocontenida, con `:A35` (admin), `:S35` (usuario) y `:X35` (otro admin). No
reutiliza fixtures de otras secciones.

| Aserción | Control negativo |
|---|---|
| (a) un no-admin recibe `no_admin` | quitar `exigir_admin()` |
| (b) aal1 recibe `mfa_requerido` | `is_admin()` sin la cláusula `aal` |
| (c) admin con `activado_at` nulo → `no_admin` | quitar la cláusula |
| (d) TOTP de hace 13 h → `totp_vencido` | quitar la cláusula de `amr` |
| (d2) **token sin `amr` y con `amr: null` → rechazo limpio `42501`, no `22023`** | la forma con `coalesce` (cae con el error crudo) |
| (d3) **`amr` con timestamp basura (`"abc"`) → rechazo limpio** | quitar el regex `^[0-9]{1,12}$` (cae con error de cast) |
| (e) suspender: `:S35` queda `suspendido` con `suspendido_at` y motivo; sus `activa` pasan a `pausada` y su `vendida` no se toca | sin CAS |
| (f) hay auditoría con `antes`/`despues` exactos | sin escritura de auditoría |
| (g) motivo vacío → rechazo | sin el check |
| (h) sobre sí mismo o sobre `:X35` → rechazo | sin el guard |
| (i) UPDATE, DELETE y **TRUNCATE** sobre `admin_acciones` lanzan, incluso como `postgres` | quitar un trigger a la vez |
| (j) `antes`/`despues` con `correo`, con valor anidado o con clave de otro tipo → `23514` | CHECK que solo mira las claves de nivel superior |
| (k) borrar al admin de `auth.users` conserva su fila de auditoría | FK con cascade |
| (l) revocar al admin (borrar su fila) surte efecto en la llamada siguiente | — |
| (m) **"JWT vivo" (C5):** con los mismos claims, `:S35` inserta un contacto y una publicación `pendiente` **antes** de suspenderlo; **después** de `admin.suspender_usuario`, los mismos inserts dan `42501` (con `rechazo_de`, no `expect_error`) | quitar `is_active_user()` de `listings_insert_own`; lo mismo de `listing_contacts_insert_own` |
| (n) reactivar pone `activo` y limpia las dos columnas, **sin despausar** | despausar en la RPC |

**Por qué (m) existe:** medido el 2026-09-29, T10 (`rls.sql:404-409`) prueba que un
suspendido no puede publicar, pero con `expect_error`, que acepta CUALQUIER
error; y **ninguna** aserción prueba que no pueda insertar en `listing_contacts`
(solo hay un comentario, `rls.sql:895-900`). Ninguna de las dos prueba el caso
"JWT vivo": la misma sesión antes y después de suspender.

### T35b — activación con dueño no activo (Ola 4)

| Aserción | Control negativo |
|---|---|
| `pendiente → activa` con dueño suspendido lanza (`dueno_no_activo`), **como `postgres` y vía `aprobar_listing`** | quitar el trigger |
| la misma transición con dueño activo pasa | trigger que rechaza siempre |
| las 4 fixtures corregidas (T11b, T13, T14, T23) siguen cayendo **por su motivo** con el trigger lanzando | cada control de esas cuatro secciones, uno a la vez |

### T35c — Storage: fotos de `pendiente` y `bloqueada`

Con el helper `as_user_aal`. Que Storage propague `aal` por HTTP se prueba en
`probe-storage.mjs` (`rls.sql` no ve Storage de verdad: `storage.protect_delete`,
`CLAUDE.md` §9).

| Aserción | Ola | Control negativo |
|---|---|---|
| (a) admin aal2 **con TOTP reciente** ve el objeto de una `pendiente` ajena | 2 | quitar la policy de admin |
| (a2) admin con TOTP vencido no la ve | 2 | `is_admin` sin la cláusula de `amr` |
| (b) admin **aal1** no la ve | 2 | `is_admin` sin la cláusula `aal` |
| (c) el dueño **no** ve el objeto de su `bloqueada` | 4 | quitar `<> 'bloqueada'` |
| (d) el dueño **sí** ve el de su `pendiente` | 4 | escribir `not in ('pendiente','bloqueada')` |
| (e) un tercero **no** ve una `pendiente` (aislada) | 4 | aflojar `listings_select` |
| (f) lo mismo (c)-(e) sobre la tabla `listing_photos` | 4 | la variante equivalente en la tabla |

### T36 — reportes

Se abrió en la Ola 0 (T35 quedó reservada para la Ola 1).

| Aserción | Ola | Control negativo |
|---|---|---|
| (a) resolver el reporte de una cuenta eliminada funciona y no avisa a nadie | 0 — **hecha** | el `WHEN` viejo → cae en (a) con `23502` |
| (a2) el reporte de una cuenta viva SÍ avisa | 0 — **hecha** | `when (false)` → cae en (a2) aislada (en la suite completa cae antes en T18) |
| (b) los 4 `objetivo_tipo` aparecen en `listar_reportes`, sin esconder ninguno | 2 | inner join a `users` |
| (c) `resolved_at` escrita al resolver | 2 | no escribirla |
| (d) resolver lo que ya está resuelto → rechazo | 2 | sin CAS |
| (e) `p_limit = 10000` devuelve como máximo 100 | 2 | sin el tope |
| (f) la auditoría de `resolver_reporte` solo trae `estado`/`resolved_at` | 2 | escribir `comentario` → `23514` |
| (g) **`bloquear_listing`:** un no-admin es rechazado | 2 | quitar `exigir_admin()` |
| (h) **`bloquear_listing`:** bloquear una publicación ya `bloqueada` → rechazo (CAS) | 2 | sin CAS |
| (i) **`bloquear_listing`:** la auditoría trae **solo `estado`** | 2 | escribir `titulo` → `23514` |

Sugerencia de esta consolidación (no estaba en el plan aprobado): una aserción
por cada estado de origen permitido de `bloquear_listing` (`pendiente`, `activa`,
`pausada`, `vendida`, D6), con control "restringirlo a `pendiente`".

### T37 — catálogo (Ola 5)

| Aserción | Control negativo |
|---|---|
| un dominio inactivo no asigna universidad (`handle_new_user`) y el hook lo rechaza | filtrar `activo` en una sola de las dos copias (cae T28 (a3) o la nueva) |
| `editar_campus` no puede mover un campus de universidad | aceptar `universidad_id` |
| un campus con referencias no se borra ni siendo `postgres` | la FK con `on delete cascade` |

### T38 — actividad diaria (Ola 6)

| Aserción | Control negativo |
|---|---|
| (a) insertar con `dia` explícito da `42501` | `grant insert (user_id, dia)` |
| (b) insertar para otro `user_id` es rechazado | policy `with check (true)` |
| (c) el usuario no puede leer la tabla | `grant select` |
| (d) el default de `dia` es la fecha de México a las 23:30 hora local | default con `current_date`, que en UTC ya es el día siguiente |
| (e) `admin.metricas()` excluye admins | quitar el filtro |

---

## Probes

### `scripts/probe-admin.mjs` (nuevo, Ola 1) — contra el stack local más Mailpit

| Caso | Qué mide |
|---|---|
| 1 | `inviteUserByEmail` de `@rlvo.com.mx` **no pasa por el hook** (200, llega el correo) |
| 2 | aceptar → contraseña → enrolar → aal2; antes de `activar`, `admin.sesion()` da `es_admin = false` |
| 3 | `amr` y `aal` impresos **tras password, tras TOTP, tras `refreshSession()` y tras re-verificar TOTP**. Lo último confirma que el modal de la UI renueva el timestamp; si no lo renueva, D16 no se puede cumplir y se reporta |
| 4 | RPC con aal2 → OK; con sesión aal1 → `mfa_requerido` |
| 5 | **(C4) olvidé mi contraseña de un admin activado `@rlvo.com.mx`:** `resetPasswordForEmail` → 200, llega el correo → `verifyOtp({type:'recovery'})` → sesión aal1 → pide TOTP → aal2 |
| 5b | **(C4)** lo mismo con un admin invitado que **no aceptó** (correo sin confirmar) |

**Plan B del hook, si el reset de contraseña de un admin falla (casos 5 o 5b):** el
cambio mínimo propuesto es agregar al hook (`public.hook_before_user_created`) una
rama previa que **permita si ya existe una fila en `auth.users` con ese correo**.
`supabase_auth_admin` es dueño de `auth`, así que puede leerlo. **Hoy no se
espera que haga falta**: `scripts/probe-registro.mjs:224-246` ya midió que, para
una cuenta de dominio no permitido creada por el admin API,
`resetPasswordForEmail` da 200, el correo llega y `verifyOtp({type:'recovery'})`
devuelve sesión. Lo que falta medir es el caso de una cuenta creada por
**invitación**, y el de una invitada que todavía no acepta. Si la rama se agrega,
`probe-registro.mjs` gana el caso "un correo nuevo del mismo dominio sigue
rechazado" (control: la rama sin el chequeo de existencia).

### Probes existentes que cambian

| Probe | Caso nuevo | Ola |
|---|---|---|
| `probe-storage.mjs` | admin con aal2 y con aal1 por HTTP; **qué status y cuerpo devuelve Storage cuando el TOTP venció** (fija la detección de la UI); el huérfano del dueño (D5) | 2 y 4 |
| `probe-registro.mjs` | dominio inactivo rechazado; y, si aplica, el plan B del hook | 5 |
| `probe-eliminar-cuenta.mjs` | cuenta con una `bloqueada` con foto → 0 objetos | 4 |
| `probe-moderacion-http.mjs` | el dueño se suspende entre el alta y la llamada → 200, `pendiente` | 4 |

---

## Olas

**Cada ola es verificable por separado.** El orden aprobado (v2.1, con D19):

| Ola | Contenido | Estado |
|---|---|---|
| 0 | Sin panel: fix del trigger de reportes y documentación | **En producción** (remedido el 2026-09-29) |
| 1 | Login con MFA, aceptar invitación y suspender/reactivar de punta a punta con auditoría | Pendiente |
| 2 | Reportes (con `detalle_listing`, la policy de Storage del admin y `bloquear_listing` adelantados, D19) | Pendiente |
| 3 | Despliegue (Cloudflare Pages) + `admin-reset-mfa` | Pendiente |
| 4 | Moderación (cola, aprobar, trigger de dueño activo, policy del dueño) | Pendiente; D5 se decide al entrar |
| 5 | Catálogo institucional | Pendiente |
| 6 | Métricas y `actividad_diaria` | Pendiente |

### Ola 0 — sin panel (EN PRODUCCIÓN)

**Objetivo:** cerrar el bug preexistente y dejar la documentación diciendo la
verdad antes de construir.

1. **Medir el bug antes de corregirlo.** En local, dentro de `begin … rollback`:
   crear reportante y reportado, crear un reporte, borrar al reportante de
   `auth.users` y hacer `update reports set estado = 'resuelto'`. Esperado y
   obtenido: `23502` (`null value in column "user_id" of relation
   "notifications"`).
2. **Migración `20260930000476`**, en su propio commit (`7574b01`): drop y create
   del trigger `reports_notify_resolved` con `when (old.estado is distinct from
   new.estado and new.estado <> 'pendiente' and new.reporter_id is not null)`. La
   función no cambia (conserva OID y revoke).
3. **T36 (a) y (a2)** en `rls.sql`, autocontenidas; +4 aserciones en total (2 de
   fixtures y 2 de comportamiento): 358 → 362.
4. **Documentación**, en commit aparte (`787ed53`): spec, `CLAUDE.md` (stack, cola
   de pendiente, pendiente 0k, pendiente 0c, conteos) y tres reglas.
5. **Verificación:** suite completa en verde; los dos controles cayendo cada uno
   en su aserción (ver la tabla T36); `npx tsc --noEmit` y `npm run lint` sin
   errores.
6. **No se hace:** el `db push` a remoto, la limpieza de `prueba-2b` ni la
   confirmación de TOTP en el Dashboard. **Son del usuario.** Runbook del push:
   `supabase db push`; `list_migrations` debe dar 40; `pg_get_triggerdef` de
   `reports_notify_resolved` en remoto debe traer `reporter_id IS NOT NULL`;
   `gen:types` no cambia (es un trigger).

**Dependencias externas, del usuario:**
- ~~Confirmar en el Dashboard que TOTP está incluido en el plan gratuito
  (**bloqueante para la Ola 1**).~~ **Confirmado por el usuario (2026-09-29).**
- Agregar el schema `admin` a los exposed schemas del Dashboard cuando toque
  (Ola 3).
- La limpieza de `prueba-2b@example.com` (pendiente 0c).
- Los correos `@rlvo.com.mx` ya reciben correo real (Google Workspace).

### Ola 1 — login con MFA, invitación y suspender/reactivar de punta a punta

**Migraciones `…477` y `…478`** (contenido en la tabla de migraciones y en §2 y
§4). Además:

**`rls.sql`:** los helpers nuevos, T12 y T35 (tablas de arriba).

**Tooling:**
- `tsconfig.json:19-21`: agregar `"admin"` al `exclude`.
- `package.json`: script `check:admin`.
- `.easignore`: copia literal de `.gitignore` más `admin/` y
  `admin/node_modules/`.
- Medir que el bundle de Metro no toque `admin/`.
- `config.toml`: `:13` agregar `admin` a `schemas`; `:200` agregar
  `http://localhost:5173/**`; `:367-368` encender TOTP; plantilla `invite` local
  apuntando al panel con `token_hash`. En remoto, la plantilla de invitación se
  edita en el Dashboard, **nunca** con `config push`.
- `admin/CLAUDE.md` y `.claude/rules/admin-panel.md` (§1).

**`admin/`** (Vite + React + TS, CSP, publishable key). Pantallas funcionales
mínimas, **sin frame todavía** (excepción aprobada, D14):
1. **Aceptar invitación:** toma el `token_hash` del link y hace
   `verifyOtp({type:'invite'})`. Link vencido o usado → mensaje y "pide otra
   invitación".
2. **Fijar contraseña:** `updateUser({password})`, con el mínimo de Auth.
3. **Enrolar TOTP:** `mfa.enroll` → QR → `mfa.challengeAndVerify`. Al terminar,
   "Espera a que el admin técnico active tu cuenta".
4. **Login:** contraseña → TOTP → aal2.
5. **Olvidé mi contraseña:** el mismo patrón que la app (`resetPasswordForEmail`
   más código tecleado con `verifyOtp({type:'recovery'})`, sin redirect);
   después pide TOTP como siempre.
6. **Buscar usuario → detalle → suspender o reactivar con motivo → su
   auditoría.**
7. **Manejo de rechazos (C6):** ver §2, "La UI del panel debe detectar el
   rechazo".

**`scripts/crear-admin.mjs`:** `invitar` y `activar` (§2).

**Ventana entre invitación y TOTP, documentada:** mientras la cuenta no esté
activada, `is_admin()` es false aunque tenga aal2. Quien intercepte el link puede
fijar contraseña y enrolar su propio TOTP, pero no ve nada; lo cierra el paso
`activar`, que exige que el dueño real confirme por otro canal.

**`scripts/probe-admin.mjs`:** ver la sección de probes.

**Verificación:** `rls.sql` completa y cada control por separado;
`probe-admin.mjs`; `tsc`, `lint`, `check:functions` y `check:admin`; prueba manual
en local con un admin real y un TOTP de verdad. **No se despliega.**

### Ola 2 — reportes

**Orden fijo (nota heredada):**
1. **Frames de `design/admin-panel.html`:** login/MFA, lista de reportes, detalle
   con los 4 tipos de objetivo y el modal de TOTP, con los tokens de §2. Las
   pantallas de la Ola 1 se alinean a esos frames aquí.
2. **Aprobación del diseño por el usuario.**
3. **Solo después**, la migración `…479`.

**Migración `…479`** (D19): `admin.listar_reportes`, `admin.resolver_reporte`
(CAS `where estado = 'pendiente'`, escribe `resolved_at = now()`, audita
`{estado, resolved_at}`; cierra la deuda de `resolved_at`), y las adelantadas:
`admin.detalle_listing`, `admin.bloquear_listing` (desde `pendiente/activa/
pausada/vendida`, no depende del trigger de dueño activo ni de D5: solo mueve
`estado`) y la policy de Storage del admin (independiente de D5: D5 trata la
policy del **dueño**).

**`rls.sql`:** T36 (b)-(i) y T35c parcial (a), (a2), (b).

**`probe-storage.mjs`:** los mismos tres casos por HTTP, más **qué status y cuerpo
devuelve Storage** cuando el TOTP venció.

**Panel:** lista de reportes filtrable por estado; detalle según el tipo (con la
etiqueta "Cuenta eliminada" o "Publicación eliminada", sin ocultar el reporte);
acciones resolver, descartar, bloquear la publicación y suspender al reportado
(esta última ya existe desde la Ola 1).

### Ola 3 — despliegue y `admin-reset-mfa`

- **Cloudflare Pages** con `admin.rlvo.com.mx` y headers (§11); Cloudflare Access
  queda para después.
- **Redirect URLs y Site URL en remoto** (§11), sin `config push`.
- **Edge Function `admin-reset-mfa`:** `is_admin()` del que llama (D16), nunca
  sobre sí mismo, borra el factor con `service_role` y audita (tipo `admin`,
  `factores_borrados`).
- **Push de las migraciones 476-479** con su runbook: `list_migrations`,
  verificación de grants y definers en remoto (`has_function_privilege`,
  `prosecdef`, `proconfig`), y `gen:types --schema admin`.
- **Las invitaciones reales de los 3 admins**, con `crear-admin.mjs`.
- El usuario agrega el schema `admin` a los exposed schemas del Dashboard.

### Ola 4 — moderación

Orden (§8): (1) desplegar `moderar-contenido` con el manejo de `dueno_no_activo`
y su caso en el probe; (2) migración `…480` (el trigger) con las **4 fixtures
arregladas en el mismo cambio** y T35b; (3) migración `…481`: la cola, aprobar y
la policy del dueño según **D5, que se decide al entrar a esta ola junto con su
frame**; T35c (c)-(f); el probe de Storage y el de eliminar cuenta.

### Ola 5 — catálogo institucional

Migración `…482`, T37 y el probe de registro (§10).

### Ola 6 — métricas

Migración `…483`, T38, el cambio en la app para `actividad_diaria` (con su build y
el runbook de push) y la pantalla de métricas. El snapshot diario con `pg_cron`
queda **después** (D11).

---

## Decisiones D1-D20 y su estado

| # | Decisión | Estado |
|---|---|---|
| D1 | `admin/` en este repo con `package.json` propio, sin workspaces, más la línea en §0 del `CLAUDE.md` raíz | Aprobada |
| D2 | SPA Vite + React + TS y no Next.js | Aprobada |
| D3 | Schema `admin` expuesto y no RPCs en `public` (paso manual en el Dashboard) | Aprobada |
| D4 | Cuentas separadas `@rlvo.com.mx`, invitadas por script y activadas en dos pasos; no son usuarios del marketplace; identidad en `private.admins`, no en `app_metadata` | Aprobada |
| D5 | Cómo borra el dueño una `bloqueada` cuando ya no ve sus fotos: Edge Function (recomendada), prohibirlo o aceptar huérfanos y purgar. "Eliminar cuenta" no necesita cambios | **Pendiente: se decide al entrar a la Ola 4**, junto con su frame. No bloquea las Olas 0-3 |
| D6 | `bloquear_listing` también desde `activa`, `pausada` y `vendida` | Aprobada |
| D7 | La auditoría conserva `objetivo_id` y el motivo después de que se elimina una cuenta, sin datos personales en `antes`/`despues`; excepción documentada a T33 (h) | Aprobada |
| D8 | El admin puede leer `users.correo` (excepción a RNF-05 solo para admins) | Aprobada |
| D9 | El trigger de dueño activo **lanza**, no reescribe en silencio; `moderar-contenido` lo traduce a `pendiente` | Aprobada |
| D10 | Sin "desbloquear" en la fase 1: `bloqueada` sigue siendo terminal | Aprobada |
| D11 | Snapshot de métricas con `pg_cron`: **después**. `actividad_diaria` va en la Ola 6 | Aprobada |
| D12 | Universidades y campus sin borrar ni desactivar; dominios con borrado lógico | Aprobada |
| D13 | Cloudflare Pages en `admin.rlvo.com.mx`; Cloudflare Access después | Aprobada |
| D14 | `design/admin-panel.html` con los tokens de §2, y la Ola 1 sin frame | Aprobada |
| D15 | El check de coherencia vuelve obligatorio el motivo también al suspender desde Studio | Aprobada |
| D16 | `is_admin()` exige TOTP de las últimas 12 h vía `amr`: una sola función para lecturas y escrituras; la UI detecta el rechazo (incluido el 400 de Storage) y pide el TOTP otra vez (C6) | Aprobada, con C6 |
| D17 | Fecha de las migraciones: `476+` mientras el día real sea menor que la última fecha del repo; después, la fecha real | Aprobada |
| D18 | La cláusula de `amr` usa `jsonb_typeof(...) = 'array'` y no solo `coalesce` (que lanza con `"amr": null`, medido) | Aprobada |
| D19 | Adelantar a la Ola 2 `detalle_listing`, la policy de Storage del admin y `bloquear_listing` | Aprobada |
| D20 | `claves_auditoria_ok` con lista por tipo de objetivo y sin valores anidados, en vez de una lista global | Aprobada |

---

## Notas heredadas por ola (registradas, no implementadas)

- **Ola 1, T35 (d2)/(d3):** además del caso de `amr` ausente y `amr: null`, el caso
  **"timestamp basura"** con su control (quitar el regex de `is_admin()`).
- **Ola 1, `admin/CLAUDE.md`:** el `DETAIL` de un rechazo del CHECK de
  `admin_acciones` imprime la fila completa (con el `motivo`, texto libre) y puede
  llegar a logs. **No pegarlo en chats ni en tickets.**
- **Ola 1, `probe-admin.mjs`:** si el caso 3 muestra que re-verificar el TOTP no
  renueva el timestamp de `amr`, D16 no se puede cumplir y hay que reportarlo
  antes de seguir.
- **Ola 2:** `bloquear_listing` entra con su propia aserción y control (no-admin
  rechazado, CAS, auditoría con solo `estado`). El orden es: frames de
  `design/admin-panel.html`, aprobación del diseño del usuario y solo después la
  migración `…479`.
- **Ola 2:** la deuda de `resolved_at` (`notificaciones-push.md`) se activa aquí;
  el `before update` que la escriba **no copia** la cláusula `new.reporter_id is
  not null` del `WHEN` de `reports_notify_resolved`, porque `resolved_at` tiene
  que escribirse también para un reporte sin reportante.
- **Ola 3:** el schema `admin` lo agrega el usuario a los exposed schemas del
  Dashboard.
- **Ola 4:** el trigger de dueño activo cae en 4 fixtures (T11b, T13, T14, T23):
  arreglarlas en el mismo cambio y correr la suite con el trigger lanzando.
  `moderar-contenido` se despliega ANTES. D5 se decide al entrar, con su frame.
- **Ola 6:** `ignoreDuplicates` sobre `actividad_diaria` sin SELECT queda
  pendiente de medir en local.

---

## Verificación, por ola

- `docker exec -i supabase_db_relevo-marketplace psql -v ON_ERROR_STOP=1 -U
  postgres -d postgres < supabase/tests/rls.sql`, con cada control negativo como se
  describe arriba (`begin; <variante>; <suite>; rollback`, imprimiendo antes el
  estado vivo).
- Los probes afectados, más `probe-admin.mjs`.
- `npx tsc --noEmit` (sin que vea `admin/`), `npm run lint`,
  `npm run check:functions` y `npm run check:admin`.
- Los conteos (migraciones, aserciones, definers de `public`) se miden con su
  comando y se corrigen en `CLAUDE.md` en la misma tarea.

Fuente: plan v2 + v2.1 de la sesión del 2026-09-29
