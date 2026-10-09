# RF-17 Ola 6 — Métricas: plan v1 FINAL (todas las decisiones cerradas)

**Estado (2026-10-09):** plan v1 FINAL **aprobado** por el usuario. Todas las
decisiones D-1..D-19 están cerradas. **F0 hecho** (decisiones) y **F1 CERRADO**
(commit local `b0f212e32d43b392b07e8d9f734fb86739462e6f`, corrección
documental previa D-19). Este archivo es el F2. Lo que sigue es el texto del
plan aprobado, sin cambios; las cifras de remoto son de su fecha y se REMIDEN en
F13 antes de confiar en ellas. Si el repo cambia, gana el repo y se corrige
este archivo.

## Cambios respecto a la v1

1. **D-6 cerrada = R2, retención de 90 días.** Ventana exacta, purga con pg_cron según el patrón de `…482` y una sola fuente de verdad para el corte (§2.1).
2. **Semántica de cobertura de los usuarios activos.** Tres estados por día: NULL antes del inicio, conteo real (incluido 0) dentro de la retención, y NULL si la actividad ya se purgó. Nombres exactos de los metadatos de `metricas_resumen` (§2.2).
3. **`private.actividad_parametros`, revisada contra cinco alternativas.** Se mantiene la tabla de un renglón, ahora justificada (§2.1.b).
4. **Pruebas de frontera de la retención** (T38 r1-r9) y una aserción en `probe-eliminar-cuenta` (§4).
5. **Mapa exacto de afirmaciones legales a actualizar**, sin redactarlas (§5). Checkpoint F12, **antes del push**: la recolección en producción no empieza antes de que esté declarada.
6. Checkpoints renumerados (F0-F28).

---

## 1. Decisiones (todas CERRADAS)

| # | Decisión | Estado |
|---|---|---|
| D-1 | Auditoría en Reporte resuelto + Detalle de universidad (con sus campus y dominios); sin sección global | CERRADA |
| D-2 | Ventas y calificaciones fuera de la Ola 6 | CERRADA |
| D-3 | `admin.metricas` (por día) + `admin.metricas_resumen` (totales del rango) | CERRADA |
| D-4 | Usuarios activos = NULL ("Sin datos") antes del inicio del tracking | CERRADA |
| D-5 | Un suspendido registra actividad y cuenta como activo | CERRADA |
| D-6 | R2: el registro atribuible (`user_id` + `dia`) se conserva 90 días; purga automática diaria; el cascade de la baja se mantiene; sin snapshots agregados (D11 sigue para después); los días purgados son NULL ("Sin datos"), nunca 0 | CERRADA |
| D-7 | Toda fila de `public.users` (que no sea admin) cuenta como alta | CERRADA |
| D-8 | Contactos = `count(*)` de taps | CERRADA |
| D-9 | Universidad de un contacto = la de la publicación | CERRADA |
| D-10 | Todas las publicaciones existentes por `created_at`, en cualquier estado | CERRADA |
| D-11 | `America/Mexico_City` | CERRADA |
| D-12 | 30 días por defecto; selector de 7, 30 y 90; diario | CERRADA |
| D-13 | Tarjetas + tabla; sin gráfica | CERRADA |
| D-14 | Dos migraciones, `…485` y `…486`, en el mismo rollout, sin pausa entre ellas | CERRADA |
| D-15 | Deduplicación en memoria; sin AsyncStorage | CERRADA |
| D-16 | La serie empieza el día en que se activa el tracking; mientras sea prelanzamiento, se documenta que son datos del equipo y de testers | CERRADA |
| D-17 | Respaldos/PITR no bloquean el cierre de Admin (pendiente de operación y lanzamiento) | CERRADA |
| D-18 | Leaked password protection, fuera de la Ola 6 (deuda de endurecimiento) | CERRADA |
| D-19 | C1, C8 y C9 se corrigen en un commit documental previo e independiente | CERRADA |

**No queda abierta ninguna decisión funcional de la Ola 6.** C3 (Sentry) y C4 (Manrope) siguen fuera de la ola y no la bloquean. Lo único que falta de tu parte, y no es una decisión de diseño, es **el texto legal** de F12 (§5).

## 2. Diseño

Notación: `tz = 'America/Mexico_City'`; `hoy = (now() at time zone tz)::date`.

### 2.1 `…485_actividad_diaria_y_metricas.sql` (fecha real al crearla)

**a) `public.actividad_diaria`** (DDL de `rf17-plan-admin.md:1110-1114`):
- `revoke all … from public, anon, authenticated`; `grant insert (user_id) to authenticated`.
- RLS con una sola policy, `actividad_diaria_insert_own`, `with check (user_id = (select auth.uid()))` (sin `is_active_user()`, por D-5).
- Sin SELECT, UPDATE ni DELETE para el cliente; fuera de Realtime.
- `on delete cascade` desde `users`: la baja borra en el acto todo lo atribuible.
- El cliente no puede fijar `dia` (medido, anexo C).

**b) Inicio del tracking: `private.actividad_parametros`, revisada.** Es un renglón (`id smallint primary key check (id = 1)`, `inicio date not null`) insertado por la migración con `hoy`. Lleva `revoke all` a todos los roles del cliente y RLS sin policies (patrón de `listing_moderacion` y `moderacion_retenida`, `…482:37-53`). Alternativas comparadas:

| Alternativa | Persistente y estable | Problema |
|---|---|---|
| **A. Tabla de un renglón en `private` (recomendada)** | Sí: la fija el apply y nada la mueve (ni el cascade ni la purga) | Un objeto más, con sus aserciones en T12. Es el patrón que el repo ya usa para estado privado |
| B. Función con la fecha "horneada" por DDL dinámico (`execute format('create function … %L', hoy)`) | Sí | Sería el primer `execute format` del repo (0 coincidencias en `supabase/migrations`). Además, el `prosrc` de local y de remoto tendría fechas distintas, y **eso rompe el readback por md5 de `pg_proc` local = remoto** (método de K-6 y de F17). Cambiarla exige una migración |
| C. Fecha literal escrita en la migración | Sí | Hay que adivinar el día del push. Si el push se retrasa, los días entre el literal y el push saldrían como 0 en vez de NULL: es justo el error que D-4 prohíbe |
| D. Fecha de creación de la tabla o de la migración | — | Postgres no guarda cuándo se creó un objeto, y `supabase_migrations.schema_migrations` no tiene una columna de fecha de aplicación (y además es un detalle interno del CLI) |
| E. GUC (`alter database … set app.actividad_inicio`) | Dudosa | Depende de privilegios de `ALTER DATABASE` en Supabase y no está en el esquema versionado. No es un patrón del repo |
| F. `min(actividad_diaria.dia)` | **No** | La mueven el cascade y, ahora, la purga |

**Recomendación: A, sin cambios en la decisión.** Es la única que es persistente, se puede probar con las invariantes de T12, se compara bien entre local y remoto y sigue los patrones existentes.
- Ajuste: la tabla guarda **solo** `inicio`, no la retención. Cambiar los 90 días cambia afirmaciones legales, así que debe pasar por una migración con documentación, no por un UPDATE en Studio.
- **Semántica de `inicio`:** el día real en que RLVO empezó a registrar `actividad_diaria` en ese entorno. **No es la fecha de lanzamiento comercial.** Es un valor persistente que se fija al desplegar la infraestructura de tracking y normalmente no se modifica después.
  - Una modificación posterior solo es admisible como procedimiento excepcional de corrección ante un error operativo demostrado, con decisión explícita y documentada en el runbook.
  - Nunca se modifica para ocultar datos del equipo o de testers ni para hacer coincidir las métricas con la fecha de lanzamiento. Los datos de prelanzamiento se conservan y se identifican como actividad del equipo y de testers (D-16).

**c) Retención: una sola fuente para el corte.**
- `private.actividad_retenida_desde() returns date`: `language sql stable`, `set search_path = ''`, cuerpo `select (now() at time zone 'America/Mexico_City')::date - 89`. EXECUTE revocado a `public`/`anon`/`authenticated`. La llaman el job de pg_cron (como su dueño) y las RPC definer.
- **Ventana exacta:** se conserva una fila mientras `dia >= hoy - 89`, es decir, los 90 días calendario de México más recientes, hoy incluido. Una fila con `dia = hoy - 90` (hace exactamente 90 días) ya es purgable.
- Con eso, el selector de 90 días (`hoy-89 … hoy`) queda siempre completo, una vez que `inicio` tenga ≥ 90 días.
- **Purga (patrón de `…482:179-185`):** `select cron.schedule('purga-actividad-diaria', '23 6 * * *', $$delete from public.actividad_diaria where dia < private.actividad_retenida_desde()$$);`. Diaria a las 06:23 UTC = 00:23 en México, sin horario de verano: poco después del cambio de día y sin coincidir con la purga de las 04:17. `pg_cron` ya está instalado (`…482:179`).
- **Las métricas no dependen de que la purga haya corrido:** filtran por la misma función. Si el job se retrasa o falla, una fila vencida que siga en la tabla igual cuenta como "Sin datos", nunca como dato. El resultado es determinista y el job solo minimiza.

**d) `admin.metricas(p_desde date, p_hasta date, p_universidad_id bigint default null)`
→ `table(dia date, altas int, usuarios_activos int, publicaciones_creadas int, contactos int)`**

Plantilla: `plpgsql stable security definer set search_path = ''`; `perform private.exigir_admin()` primero; `revoke all … from public, anon`; `grant execute … to authenticated`.

**Guardas, en orden:**
- algún extremo NULL, `p_desde > p_hasta` o `p_hasta > hoy` → `22023 rango_invalido`;
- más de 366 días → `22023 rango_demasiado_largo`;
- universidad inexistente → `P0002 universidad_no_existe`.

**Métricas:**
- Días: `generate_series(p_desde, p_hasta, '1 day')`; cada evento cae en `(created_at at time zone tz)::date`.
- **Admins excluidos** en las cuatro: `not exists (… private.admins …)`, con cualquier fila.
- `altas`: `public.users`, filtrado por `u.universidad_id`.
- `publicaciones_creadas`: todas, por `l.universidad_id`, sin dueños admin.
- `contactos`: `count(*)` de taps sobre `listing_contacts` unida a `listings` (filtrado por `l.universidad_id`), sin contactos de admins.
- **Cobertura de activos:** sea `cobertura_desde = greatest(inicio, private.actividad_retenida_desde())`. Entonces `usuarios_activos` es:
  - **NULL** si `d < inicio` (antes del tracking);
  - **NULL** si `d < actividad_retenida_desde()` (ya purgado o purgable);
  - si no, el **conteo real, 0 incluido**: `count(*)` de `actividad_diaria` con `dia = d` (la PK garantiza una fila por persona y día), sin admins y con el filtro por `users.universidad_id`.
- Altas, publicaciones y contactos se calculan sobre todo el rango de hasta 366 días; un día sin eventos da 0.

### 2.2 `admin.metricas_resumen` — metadatos exactos

**`admin.metricas_resumen(p_desde date, p_hasta date, p_universidad_id bigint default null)`
→ `table(desde date, hasta date, altas int, publicaciones_creadas int, contactos int, usuarios_activos_distintos int, inicio_tracking date, retencion_dias int, activos_desde date, activos_hasta date, activos_cobertura text)`**

Siempre devuelve una fila, con la misma plantilla y las mismas guardas.

| Columna | Definición |
|---|---|
| `desde`, `hasta` | Eco del rango solicitado (`p_desde`, `p_hasta`) |
| `altas`, `publicaciones_creadas`, `contactos` | Conteos directos sobre el rango solicitado; **iguales a la suma de los diarios por construcción** (T38 lo amarra) |
| `inicio_tracking` | `actividad_parametros.inicio` |
| `retencion_dias` | `hoy - private.actividad_retenida_desde() + 1` (= 90, derivado de la misma función; sin un segundo literal) |
| `activos_desde` | `greatest(p_desde, inicio_tracking, private.actividad_retenida_desde())`, o NULL si eso es mayor que `p_hasta` |
| `activos_hasta` | `p_hasta` si `activos_desde` no es NULL; si no, NULL |
| `activos_cobertura` | `'completa'` si `activos_desde = p_desde`; `'parcial'` si `p_desde < activos_desde <= p_hasta`; `'sin_datos'` si `activos_desde` es NULL |
| `usuarios_activos_distintos` | `count(distinct a.user_id)` sobre `actividad_diaria` con `a.dia between activos_desde and activos_hasta`, sin admins y con el filtro de universidad; NULL si `'sin_datos'`. **Nunca es la suma de los diarios** |

Como el panel envía el rango y recibe `desde`/`hasta` junto con `activos_desde`/`activos_hasta`/`activos_cobertura`, puede distinguir sin ambigüedad el rango solicitado del rango cubierto.

### 2.3 `…486_admin_auditoria.sql` (sin cambios desde la v1)

`admin.auditoria(p_objetivo_tipo text, p_objetivo_id text, p_cursor bigint default null, p_limit int default 50)` → `table(id, accion, objetivo_tipo, objetivo_id, objetivo_etiqueta, admin_correo, motivo, antes, despues, created_at)`.
- Tipos admitidos: `'reporte'` y `'universidad'`.
- El ámbito `'universidad'` reúne la universidad, sus campus y sus dominios en una sola llamada, resuelto contra las tablas del catálogo. La razón: desactivar y reactivar un dominio no guarda `universidad_id` en la auditoría (`…484:619-620,:663-664`).
- `22023 objetivo_tipo_invalido` / `objetivo_invalido`, con regex antes de cualquier cast.
- Orden `id desc` con cursor; `p_limit` de 1 a 100.
- Límite documentado: un objeto borrado desde Studio desaparece del ámbito.

### 2.4 Lo que no se toca

Ninguna función, policy, trigger, CHECK, índice ni job existente. `purga-moderacion-retenida` sigue igual. `admin_acciones_accion_check` no cambia (las lecturas no auditan).

### 2.5 App (sin cambios desde la v1)

`insert({ user_id })` plano; 201 o `23505` = éxito; sin `upsert`, `ignoreDuplicates`, `.select()` ni SELECT. Deduplicación en memoria por `{userId, día MX}`; foreground con `AppState` y efecto por `userId` en `session.tsx`; JS puro, sin build nativo ni OTA.

### 2.6 Panel

- «Métricas»: selector de 7/30/90 (30 por defecto), universidad (todas o una), tarjetas del resumen y tabla diaria.
- En la tabla, los activos NULL se pintan «Sin datos», con estilo distinto del 0.
- La tarjeta de activos dice el periodo cubierto cuando `activos_cobertura = 'parcial'` ("del {activos_desde} al {activos_hasta}") y «Sin datos» cuando es `'sin_datos'`.
- Nota breve y persistente (va al frame primero, F3), con dos ideas: (1) la actividad se conserva 90 días y los días anteriores aparecen como «Sin datos», no como cero actividad; (2) mientras sea prelanzamiento, son datos del equipo y de testers (D-16). Copy exacto en el frame.
- La auditoría como componente en `DetalleReporte.tsx` y `DetalleUniversidad.tsx`.
- `rechazos.ts` con los 5 mensajes nuevos (el caso 7c obliga).

## 3. Rollout de `…485` + `…486` (sin cambios desde la v1)

- Un solo `db push` las aplica seguidas, sin pausa. Los estados posibles después del push son: 1 = las dos; 2 = solo la `…485`; 3 = ninguna.
- En F5 se confirma en local que el CLI usa una transacción por archivo y se detiene al primer error.
- La recuperación son dos bloques de `drop` independientes. El de la `…485` incluye `select cron.unschedule('purga-actividad-diaria')`, la función de retención y la tabla de parámetros.

## 4. Pruebas

**T12:**
- `actividad_diaria`: solo `INSERT(user_id)` para `authenticated`; nada para `anon`; una sola policy, de INSERT; fuera de Realtime.
- `actividad_parametros`: sin privilegios para el cliente y sin policies.
- `actividad_retenida_desde()`: EXECUTE revocado.
- Las 3 `admin.*` nuevas (de 21 a 24): definer, `search_path` fijo, sin `anon`/`public`.

**T38** (dentro de la transacción de la suite, `now()` es constante; los fixtures fijan `actividad_parametros.inicio` en la propia transacción, porque en local `inicio` es el día del `db reset`):
- Del plan maestro: (a) `dia` explícito → `42501`; (b) otro `user_id` → rechazo; (c) el usuario no puede leer; (d) default de `dia` a las 23:30 MX; (e) exclusión de admins en las cuatro métricas.
- Las de la v1: tripwire de `on conflict` con target = `42501`; un suspendido inserta; NULL antes de `inicio`; `inicio` no cambia al borrar la primera cuenta activa; filtro por universidad en las cuatro métricas (D-9 con una publicación de otra universidad); rango inválido, largo y futuro; no-admin, aal1 y TOTP vencido rechazados; resumen = suma de los diarios en altas, publicaciones y contactos; `usuarios_activos_distintos` ≠ suma (una persona activa 3 días cuenta 1).
- **Frontera de retención (D-6):**

| # | Aserción | Control negativo |
|---|---|---|
| r1 | Fila con `dia = hoy-89` (exactamente dentro): cuenta en `metricas` y en `usuarios_activos_distintos` | función con `- 88` |
| r2 | Fila con `dia = hoy-90` **todavía presente** (sin purgar): `usuarios_activos` de ese día = **NULL**, no 1 ni 0; no entra al distinto | métrica sin el filtro de retención |
| r3 | Día `hoy-150` sin filas y con `inicio` anterior: NULL, no 0 | `coalesce(…, 0)` en la rama purgada |
| r4 | Día dentro de la retención sin filas: **0**, no NULL | NULL para todo día sin filas |
| r5 | Ejecutar el comando EXACTO del job (leído de `cron.job`, patrón de T35e `rls.sql:6684-6701`) borra `hoy-90` y `hoy-200`, y conserva `hoy-89` y `hoy` | `dia <= …` en el comando |
| r6 | `cron.job` tiene `purga-actividad-diaria` activo, con su horario, y el comando llama a `private.actividad_retenida_desde()` (sin un literal `89`/`90`) | un comando con el literal |
| r7 | Resumen `'completa'`, `'parcial'` (rango de 120 días: `activos_desde = hoy-89`) y `'sin_datos'` (rango que termina antes del corte), con `activos_desde`/`activos_hasta`/`retencion_dias` exactos | calcular la cobertura sin la retención |
| r8 | `inicio` posterior a `hoy-89`: `activos_desde = inicio` (gana el más reciente de los dos) | `least` en vez de `greatest` |
| r9 | Borrar la cuenta borra sus filas al instante y el activo de ese día baja en `metricas` y en el resumen | FK sin cascade |

- Cada aserción con su control negativo por separado, contra la suite completa y contra T38 aislada.

**T39 (auditoría):** sin cambios desde la v1.

**Probes:**
- `probe-actividad.mjs` (nuevo; la tabla HTTP del anexo C como pruebas permanentes y el tripwire de `upsert`).
- `probe-admin.mjs` caso 11 (métricas con `activos_cobertura`, resumen y auditoría por HTTP; 7c).
- **`probe-eliminar-cuenta.mjs`: una aserción más,** 0 filas de `actividad_diaria` tras la baja (cubre la "Required implementation verification" de `ACCOUNT_DELETION.md:170-196`).

**Precondición local conocida:** la suite falla en T1 con las 3 cuentas sobrantes del local. Se corre con el método medido, o con `db reset` solo si lo autorizas.

## 5. D-6 en la documentación legal: qué afirmaciones cambian (sin redactar)

**Hecho que deben reflejar:** RLVO registra como máximo una señal de actividad por usuario y día, para calcular métricas agregadas de usuarios activos. El registro atribuible se conserva 90 días, no se expone individualmente a los administradores ni al propio usuario mediante la app, y se elimina antes si se elimina la cuenta.

| Documento | Ubicación | Afirmación actual | Qué tiene que cambiar |
|---|---|---|---|
| `LEGAL_FACTS.md` | §14 "Favoritos y actividad" (`:354-366`) | "RLVO no mantiene actualmente un historial general de navegación por usuario." y "RLVO registra de forma limitada: contactos iniciados; favoritos; publicaciones creadas." | La primera sigue siendo cierta (no son pantallas ni navegación), pero hay que precisarla. A la lista se suma la señal diaria de actividad, con su finalidad y sus 90 días |
| `LEGAL_FACTS.md` | §27 "Eliminación de cuenta" (`:664-678`, "Al eliminar una cuenta desaparecen") | La lista no incluye la actividad | Agregar la señal de actividad |
| `LEGAL_FACTS.md` | §28 "Información conservada…" (`:682-700`) | No la menciona | Sin cambio (no se conserva tras la baja); solo confirmar |
| `PRIVACY_SPEC.md` | "Categorías de datos → Interacciones" (`:102-109`) | Favoritos, contactos, publicaciones, ventas, reseñas, reportes | Agregar la categoría "señal diaria de uso" |
| `PRIVACY_SPEC.md` | "Finalidades" (`:119-141`) | No hay finalidad de medición | Agregar "medir el uso agregado del servicio (usuarios activos)" |
| `PRIVACY_SPEC.md` | "Datos públicos y privados → Privados" (`:150-170`) | No la lista | Agregarla como privada (no visible para el usuario ni de forma individual para los administradores) |
| `PRIVACY_SPEC.md` | "Conservación" (`:287-313`) | Sin subsección | Una subsección: 90 días, purga automática |
| `PRIVACY_SPEC.md` | "Eliminación de cuenta" (lista desde `:331`) | No la incluye | Agregarla |
| `DATA_RETENTION.md` | Matriz (`:20-52`) | No existe la fila. La fila "Listing view count … No per-user browsing history" sigue siendo cierta | Fila nueva: retención de 90 días, "Delete" en la baja, nota "aggregate metrics only" |
| `DATA_RETENTION.md` | "Principle" (`:8-19`) | Exige que la retención coincida con la base | Sin cambio de texto: se cumple con el job y con T38 r5/r6 |
| `ACCOUNT_DELETION.md` | "Information deleted" (`:34-52`) | No la incluye | Agregarla |
| `ACCOUNT_DELETION.md` | "Required implementation verification" (`:170-196`) | No la incluye | Agregarla (la cubre la aserción nueva de `probe-eliminar-cuenta`) |
| `LEGAL_LAUNCH_CHECKLIST.md` | "Data retention" (`:123-135`) | Sin entrada | Casilla "Activity signal: 90 days" + "Verify purge job in production" |
| `LEGAL_LAUNCH_CHECKLIST.md` | "Privacy Notice" (`:33-56`) | "[x] Document retention decisions" | Hay una decisión nueva: la casilla vuelve a quedar sin marcar hasta que el aviso la incluya |
| Aviso de privacidad publicado | **Fuera de este repo** (vive en la landing; según el checklist `:53`, sigue en borrador/noindex) | No lo puedo leer desde aquí | Agregar la misma declaración; necesito su ubicación o su texto |

**Secuencia (consecuencia de minimizar, no una decisión nueva):** los documentos internos se actualizan con tu texto en **F12, antes del `db push`**, para que la recolección en producción nunca empiece antes de estar declarada. El aviso publicado debe estar actualizado antes del lanzamiento público (lista 0i). No redacto nada hasta que me des o valides el texto.

## 6. Checkpoints (F0-F28; cada uno puede detener el siguiente)

**Preparación**
- **F0 — Decisiones** D-1..D-19 cerradas (hecho con esta v1 final).
- **F1 — Commit documental previo (D-19):** C1 (`product-spec.md:241-244,:261-264`), C8 (`admin-runbook.md:10-14,:65-66`) y C9 (`admin-runbook.md` §8). Push solo con tu autorización. STOP: revisas el diff.
- **F2 — `docs/rf17-ola6-plan.md`** (esta v1 final). Commit.
- **F3 — Frames:** «Métricas» con datos y cobertura parcial; «Métricas» con «Sin datos» y la nota de 90 días + prelanzamiento; variante de rango inválido; auditoría en «Universidad — detalle»; confirmar «Reporte resuelto»; «Métricas» en la barra lateral de todos los frames. STOP: tu aprobación visual.
- **F4 — Mediciones B0 en local** (`explain analyze` imprimiendo el rol, con volumen sintético) para `metricas`, `metricas_resumen` y `auditoria`; deciden los índices. STOP si algo contradice el plan.

**Construcción local**
- **F5 — Migraciones `…485` y `…486`** (un commit cada una) + el ensayo de la frontera transaccional del CLI (§3), restaurado desde respaldo con diff.
- **F6 — `rls.sql`:** T12, T38 (incluidas r1-r9) y T39, con controles uno por uno.
- **F7 — Probes:** `probe-actividad`, `probe-admin` caso 11 y `probe-eliminar-cuenta` +1, con sus controles.
- **F8 — Tipos `--local`.** Commit.
- **F9 — App** (`actividad.ts`, `session.tsx`), `tsc`, `lint` y simulador con `SELECT` local. Commit.
- **F10 — Panel** calcado de los frames; `check:admin`, build y aceptación visual; tu prueba manual. **No regresión local completa:** la suite, todos los probes (con `functions serve`), `tsc`, `lint` y los dos checks. STOP.
- **F11 — Recuperación preparada:** los dos bloques de §3 (con `cron.unschedule`), probados en local contra los estados 1-3.

**Producción**
- **F12 — Documentación legal de D-6** (§5) con tu texto: commit independiente. **STOP: sin esto no hay push.**
- **F13 — Preflight (solo lectura):** 48 = 48; md5 de `admin` (21) y `private` (39), policies, CHECKs, índices, grants y `cron.job` (1 job); conteos (10/10, 3 admins, 3 factores, 13 auditorías, publicaciones y contactos); advisors; los objetos nuevos no existen. STOP si hay deriva.
- **F14 — Respaldo (tú):** copia cifrada como K-2, con el SQL de F11 incluido. STOP sin copia verificada.
- **F15 — `git push` selectivo** (con tu autorización).
- **F16 — `db push --dry-run`** (tú): exactamente `…485` y `…486`. STOP si lista otra cosa.
- **F17 — `db push`** (tú).
- **F18 — Readback conjunto (yo, `SELECT`), clasificando el estado:**
  - **Estado 1:** objetos y ACL; `inicio` = el día MX del push; `cron.job` con 2 jobs y el nuevo con su horario y su comando; md5 de lo demás igual a F13; diff de grants (solo `INSERT(user_id)`).
  - **Estado 2:** se verifica la `…485`; la app puede seguir y el panel espera.
  - **Estado 3:** se vuelve a F16.
  - NO-GO de una parte → su bloque de F11.
- **F19 — Tipos `--linked`** (tú) y commit.
- **F20 — JS de la app por Metro** (requiere la `…485` verificada); readback: hay filas (solo conteo).
- **F21 — Pruebas en tu dispositivo real:** foreground, arranque en frío, modo avión.
- **F22 — Build y preflight de `admin/dist`** (requiere el estado 1).
- **F23 — `wrangler pages deploy --commit-hash`** (con tu autorización).
- **F24 — Verificación posterior al despliegue:** batería de 4 variantes × 3 hosts, assets byte-idénticos, headers.
- **F25 — Aceptación manual (tú):** 7/30/90 días; universidad; «Sin datos» antes del inicio, con la nota de 90 días; TOTP vencido; auditoría de un reporte resuelto y de una universidad; cifras cotejadas contra mis `SELECT`.
- **F26 — No regresión en producción:** md5 igual a F13; logs `run_hook`; auditoría = 13 + lo generado; **la primera corrida real de `purga-actividad-diaria` en `cron.job_run_details`** (estado `succeeded`) al día siguiente del push.

**Cierres**
- **F27 — Cierre técnico de la Ola 6:** HEAD = `origin/main`, 0/0; 50 = 50 migraciones; `db push --dry-run` al día; deployment de Production identificado; el job de purga ya corrió.
- **F28 — Cierre documental + "Admin terminado":**
  - `CLAUDE.md` (§1, §3 con conteos medidos y el bloque de `actividad_diaria`, §8 "Hecho" y pendiente 0k, índice de deuda: el snapshot de D11);
  - `admin/CLAUDE.md`;
  - `rf17-plan-admin.md` ("Ola 6: lo que cambió", y §9 corregido con el anexo C y la retención);
  - `admin-runbook.md` (métricas, «Sin datos», 90 días, sesgos, y la semántica e invariante de `inicio_tracking`).
  - **"Admin (RF-17 fase 1) terminado"** cuando L1 (métricas), L2 (auditoría) y L3 (documentos, F1) estén cerradas, F12 hecha y una lectura cruzada de los cuatro documentos de Admin no deje pendientes BLOQUEANTES. Respaldos/PITR (D-17) y leaked password protection (D-18) siguen como pendientes de operación y endurecimiento. El aviso publicado sigue en la lista de lanzamiento.

## 7. Riesgos y regresiones

Recupera el análisis de la v0.1 (§7), que se omitió por accidente al reescribir
la v1 FINAL, adaptado a las decisiones D-1..D-19. No introduce ninguna decisión
nueva.

- **Invariantes de los objetos existentes.** No debe cambiar el hook, `handle_new_user`, MFA, el catálogo, la moderación, las 21 `admin.*` ni el job `purga-moderacion-retenida`. Se comprueba con md5 de `pg_proc` de `admin` y `private`, policies, CHECKs, índices y `cron.job`, antes (F13) y después (F18, F26). Los grants se comparan antes y después en dos grupos:
  - **sobre `public.actividad_diaria`:** solo el mínimo necesario, `INSERT (user_id)` para `authenticated`; sin SELECT, UPDATE ni DELETE, y nada para `anon`;
  - **EXECUTE de las RPC nuevas** (`admin.metricas`, `admin.metricas_resumen`, `admin.auditoria`): solo los grants que prevé el plan (`grant execute … to authenticated` tras `revoke all … from public, anon`). `private.actividad_retenida_desde()` y `private.actividad_parametros` no dan nada al cliente.
  - Cualquier otro grant nuevo o perdido es NO-GO.
- **Advisors.** Se esperan exactamente 3 avisos nuevos `authenticated_security_definer_function_executable` (las tres RPC nuevas, que llaman `exigir_admin()` primero) y ninguno de RLS. Un número distinto, o un aviso de RLS, se investiga antes de seguir.
- **Orden base de datos → app.** Si el JS nuevo llega a un remoto sin la `…485`, el insert falla con `PGRST205`, no se marca como enviado y es inofensivo. Aun así, F20 exige la `…485` verificada (F18) antes de distribuir el JS. El panel exige el estado 1 (F22).
- **Push parcial `…485`/`…486`.** Un solo `db push` aplica las dos seguidas y puede dejar tres estados (§3). El estado 2 (solo la `…485`) deja la app operativa y el panel en espera; F18 lo clasifica y la recuperación de la `…486` (F11) no toca la `…485`. El supuesto de una transacción por archivo se confirma en local en F5; si el CLI se comportara distinto, el plan se detiene ahí.
- **Tripwire contra `upsert`/`ignoreDuplicates`.** Si alguien "simplifica" el cliente a `upsert` o `ignoreDuplicates`, todo insert da `42501` (anexo C). El cliente se lo traga y la métrica de activos queda en cero **en silencio**. Lo vigilan el tripwire del probe HTTP, la aserción de T38 sobre `on conflict` con target y un comentario en `src/lib/actividad.ts`.
- **Retraso o fallo de la purga.** Las métricas filtran con la misma función que el job (`private.actividad_retenida_desde()`), así que una fila vencida que siga en la tabla sigue siendo «Sin datos»: el resultado no cambia y el riesgo es solo de minimización (conservar más de 90 días). F26 verifica la primera corrida real en `cron.job_run_details`; si falla, se diagnostica sin tocar las métricas.
- **Cambio de retención e inicio del tracking.**
  - Cambiar los 90 días cambia afirmaciones legales (§5): exige una migración y la actualización de esos documentos, nunca un cambio directo en la base.
  - `inicio_tracking` **normalmente no debe tocarse** después del despliegue: es la fuente estable que hace verdaderos los NULL de D-4. Modificarlo sería un procedimiento excepcional y operativo, solo ante una necesidad demostrada, decidido de forma explícita y documentado en el runbook. No es una operación normal ni un ajuste arbitrario.
- **Sesgos de los datos.**
  - El `ON DELETE CASCADE` hace que las cifras pasadas bajen cuando una cuenta se elimina: altas, publicaciones, contactos y los activos dentro de la retención. Es el sesgo que corregiría el snapshot de D11 (fuera de esta ola).
  - Mientras sea prelanzamiento, los datos son del equipo y de los testers (D-16).
  - La pantalla y el runbook lo explican; ninguna cifra se presenta como histórica inmutable.

## 8. Archivos que cambiarían (nada tocado todavía)

- **F1:** `docs/product-spec.md`, `docs/admin-runbook.md`.
- **F2:** `docs/rf17-ola6-plan.md`.
- **F3:** `design/admin-panel.html`.
- **F5:** `supabase/migrations/2026MMDD000485_actividad_diaria_y_metricas.sql`, `…486_admin_auditoria.sql`.
- **F6-F7:** `supabase/tests/rls.sql`, `scripts/probe-actividad.mjs` (nuevo), `scripts/probe-admin.mjs`, `scripts/probe-eliminar-cuenta.mjs`.
- **F8-F9:** `admin/src/db/admin.types.ts`, `src/lib/database.types.ts`, `src/lib/actividad.ts` (nuevo), `src/lib/session.tsx`.
- **F10:** `admin/src/pantallas/Metricas.tsx` (nuevo), `Panel.tsx`, `DetalleReporte.tsx`, `DetalleUniversidad.tsx`, un componente de auditoría, `lib/rechazos.ts`, `lib/tipos.ts` y `estilos.css` si hace falta.
- **F12:** `docs/LEGAL_FACTS.md`, `docs/PRIVACY_SPEC.md`, `docs/DATA_RETENTION.md`, `docs/ACCOUNT_DELETION.md`, `docs/LEGAL_LAUNCH_CHECKLIST.md` (con tu texto).
- **F28:** `CLAUDE.md`, `admin/CLAUDE.md`, `docs/rf17-plan-admin.md`, `docs/admin-runbook.md`.

No se tocan: `…476`-`…484`, `rf17-ola5-recuperacion.sql`, Edge Functions, `crear-admin.mjs`, el job `purga-moderacion-retenida`, `design/rlvo-feed-variants.html`.

---

## Anexo A — Baseline medido (2026-10-09; conservado)

- **Repo:** `main` en `22d8790`; único archivo sin trackear `design/rlvo-feed-variants.html`. Migraciones 48 = 48 locales = **48 remotas** (máx. `…484`).
- **`rls.sql`:** tal cual, falla en T1 por las 3 cuentas sobrantes del local (gotcha documentado); apartándolas solo dentro de la transacción, **606/606**, con hashes y conteos idénticos antes y después.
- **`tsc`, `lint`, `check:functions`, `check:admin`:** exit 0.
- **Probes:** `probe-moderacion` 166, `probe-ubicacion` 9, `probe-puerta-totp` 11, `probe-registro` 55 (sin residuos), `probe-admin` 94 (`admin_acciones` local de 132 a 147: append-only).
- **Remoto:** `users` 10 (3 admins, 3 sin universidad, 7 con perfil completo, 0 suspendidos); `listings` 72 (activa 34, pausada 17, vendida 15, bloqueada 6, pendiente 0); `listing_contacts` 24 taps = 17 pares únicos, de 3 usuarios; primeros datos: 2026-09-07, 09-01 y 09-08.
- **Local:** 3 usuarios, 0 publicaciones, 0 contactos.

## Anexo C — Forma del insert (conservado)

- **SQL:** insert plano ok; repetido `23505`; `on conflict (user_id, dia) do nothing` → **`42501`**; sin target ok; `returning 1` ok; `dia` explícito, otro `user_id` y `select` → `42501`; SELECT de columnas sin policy de SELECT → RLS falla incluso en el primer insert; default de `dia` a las 23:30 MX = el mismo día.
- **HTTP** (supabase-js 2.115.0): `insert` 201; repetido 409/23505; `upsert` con o sin `onConflict` → 403/42501; `.select()` → 403. PostgREST emite `INSERT … RETURNING $2`.
- **Conclusión vigente:** `insert({ user_id })` + `23505` como éxito; sin `upsert`, `ignoreDuplicates`, `.select()` ni SELECT.

## Anexo L — Pendientes de Admin (conservado)

- **BLOQUEANTES:** L1 métricas, L2 auditoría, L3 documentos (F1).
- **AJENOS:** L4 respaldos (D-17), L5 Vault de `send-push`, L9 correos de admin en el aviso, L17 aviso de suspensión, L18 Sentry, L19 lo que queda fuera de la fase 1, L20 `.easignore`.
- **MEJORAS:** L6 Cloudflare Access, L7 leaked password (D-18), L8 despliegue y headers, L10-L16 deudas aceptadas (L16 = snapshot D11), L21 higiene local.
- **No es pendiente:** L22.
- C3 y C4: fuera de la ola, no bloquean.
