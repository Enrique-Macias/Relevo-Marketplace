# RF-17 Ola 5 — Catálogo institucional: plan v3.2

Plan de solo lectura: todavía no se implementa nada. **v3.2 = v3.1 + "Corrección v3.2" (al final, sobre cuándo ve la app un cambio de nombre). v3.1 = v3 aprobado + "Enmiendas v3.1", ya aplicadas en D, G, I, J, K, L y M.** Donde v3 y una enmienda chocan, gana la enmienda.

## Contexto

Hoy las universidades, los campus y los dominios se dan de alta en Studio, y 2 de los 3 admins no pueden usarlo.

La Ola 5 lleva al panel:
- el alta y la edición de universidades y campus;
- el alta, la desactivación y la reactivación de dominios.

Según D12, los dominios tienen borrado lógico. Las universidades y los campus no se borran ni se desactivan.

Las mediciones son del 2026-10-08.

## Working tree

Este plan existe en dos copias, idénticas:
- el artefacto interno del modo Plan, en `~/.claude/plans/`, fuera del repo;
- `docs/rf17-ola5-plan.md`, la única escritura en el repo, autorizada por ti.

No se tocaron migraciones, frames ni código.

Antes de escribir la copia del repo:
- `git status --short` salía vacío;
- HEAD era `e751539`, igual que `origin/main`.

**Estado a v3.1** (`git status --short`):
```
?? design/rlvo-feed-variants.html
?? docs/rf17-ola5-plan.md
```
- `docs/rf17-ola5-plan.md` es este plan, autorizado.
- **`design/rlvo-feed-variants.html` NO lo creé yo.** Apareció mientras trabajaba en v3. No lo toco, y no entra en ningún commit de la Ola 5 (enmienda 8: `git add` explícito).

Los experimentos locales corrieron dentro de `BEGIN … ROLLBACK`. El directorio temporal `/w` del contenedor se borró después de cada uso. Las columnas de `universidad_dominios` en local se volvieron a medir: siguen siendo 3.

## Decisiones finales (todas tomadas)

| # | Decisión |
|---|---|
| L1 | `p_motivo` obligatorio también al crear |
| L2 | Normalización y unicidad en la base, con expresión autocontenida (B.4) |
| L3 | Sin `desactivado_at` |
| L4 / L-A | Lista ampliada de proveedores públicos, **solo en `private.proveedores_correo_publico()`** (enmienda 3) |
| L-B | `rlvo.com.mx` no se bloquea en la base; solo una regla del runbook |
| L5 | Guarda `universidad_sin_campus` |
| L6 | El ciclo completo, solo en local |
| L7 | Sin catálogo QA en producción |
| L9 | Copia cifrada obligatoria |
| L10 | No correr `probe-moderacion-http` |
| L-C | Ninguna cuenta real es requisito: K-7B por defecto, K-7A opcional |
| L-D | Ventana hook→trigger: riesgo aceptado, con runbook de diagnóstico y escalamiento |
| L-E | Corrección mínima declarada de `CLAUDE.md:3964-3965` en el commit h |
| L-F | 7 etiquetas en `ACCION` en el commit e |
| — | Producción no se muta solo para demostrar RPC |

Además quedan aprobados:
- `admin.catalogo()`;
- `editar_campus` sin `universidad_id`;
- ninguna RPC mueve dominios;
- agregar nunca reactiva;
- un dominio inactivo no afecta a usuarios ya registrados;
- `activo not null default true`.

(La "serialización" con advisory lock salió de lo aprobado: enmienda 2.)

---

## A. Línea base medida

### Local

Con el stack de relevo arriba y `functions serve` corriendo:

| Qué | Resultado |
|---|---|
| `rls.sql` | **529/529**, "TODAS LAS PRUEBAS PASARON". Las 529 líneas `ok —` coinciden con el `grep` de §8 |
| `probe-puerta-totp` | **11** |
| `probe-storage` | **41** |
| `probe-admin` | **84** |
| `probe-admin-reset-mfa` | **35** |
| `probe-eliminar-publicacion` | **12** |
| `probe-eliminar-cuenta` | **25** |
| `probe-registro` | **34** |
| `probe-moderacion-http` | No se corrió y no es criterio (L10) |
| `tsc`, `lint`, `check:functions`, `check:admin` | exit 0 los cuatro |
| Migraciones | **47** en el repo y **47** en remoto; la última es `20261008000483` |
| Frames | **29**: acceso 6, reportes 8, moderacion 3, publicacion 2, usuarios 6, sistema 4 |
| Funciones `admin.*` | **13** |

### Producción

Medido con `execute_sql`, solo `SELECT` y sin datos personales.

**Universidades: 5.**
- Tec (id 1): 1 campus, dominios `tec.mx` y `exatec.tec.mx`, 7 usuarios y 72 publicaciones.
- UDEM (3), UANL (4, con 6 campus), U-ERRE (5) y Tecmilenio (6, con 4 campus): 1 dominio cada una y 0 usuarios.
- Todas tienen al menos un campus y un dominio.

**Campus: 13**, todos con coordenadas. Solo el campus 1 tiene referencias.

**Usuarios: 11.** Los 4 sin universidad son las 4 filas de admin.

**`universidad_dominios`: 6 filas.**
- Columnas: `dominio`, `universidad_id`, `created_at`.
- **`activo` no existe todavía.**

**Nombres:**
- 0 sucios y 0 duplicados sin distinguir mayúsculas.
- Largo máximo: 16 (universidad), 29 (campus) y 24 (ciudad).

**FKs hacia el catálogo:**
- `campus→universidades` y `dominios→universidades`: **cascade**.
- `users.universidad_id`, `users(universidad_id, campus_id)`, `listings.universidad_id` y `listings(universidad_id, campus_id)`: **NO ACTION**.

**Hook y `handle_new_user`:**
- El md5 coincide entre remoto y local: `b6e6a8a7…` y `87e685cf…`.
- ACL del hook: `{postgres, service_role, supabase_auth_admin}`.
- ACL del trigger: `{postgres}`.

**Auditoría:**
- El CHECK admite 9 acciones.
- `objetivo_tipo` ya incluye `universidad`, `campus` y `dominio`.
- 13 filas, id máximo 13.

**Admins (línea base de la regresión):**

| Qué | Valor |
|---|---|
| Filas en `private.admins` | 4, de las cuales **3 activas** |
| md5 de `(user_id:activado_at)` de las activas | `8c60a45c…` |
| Factores de esos admins | 4, md5 `6fe46b3b…` |
| md5 de `is_admin()` | `1364433e…` (igual en local) |
| md5 de `exigir_admin()` | `f4dfe532…` (igual en local) |
| ACL de `is_admin` | `{postgres, authenticated}` |

### Efectos medidos en local

Dentro de `begin … rollback`, sin residuo:

| Acción | Resultado |
|---|---|
| Borrar un dominio | Los usuarios conservan su universidad; el hook rechaza |
| Borrar un campus usado | `23503 users_campus_universidad_fkey` |
| Borrar una universidad con usuarios | `23503 users_universidad_id_fkey` |
| Borrar una universidad sin referencias | Cascade |
| **Mover un campus SIN referencias** | **Se mueve** (`UPDATE 1`) |
| **Mover un dominio de universidad** | **Se mueve** (`UPDATE 1`) |
| **Nombre `''`, `' X '` o duplicado en mayúsculas** | **Se acepta** |
| Coordenadas `NaN` o `Infinity` | Ya se rechazan (`campus_latitud_check`) |

---

## B. Estado actual y dependencias

### 1. El dominio se normaliza en las dos puntas (7c)

- El hook compara `split_part(lower(btrim(email)), '@', -1)` (`supabase/migrations/20260929000474_eliminar_cuenta.sql:247`).
- `handle_new_user` hace lo mismo (`20260924000466_universidad_desde_dominio.sql:61`).
- Lo guardado lo normaliza el CHECK `dominio = lower(btrim(dominio))` (`20260923000465_universidad_dominios.sql:23-26`).
- La coincidencia es exacta y en minúsculas.

### 2. Las dos funciones de registro

**Hook** (`…474:226-257`):
- revisa primero `correos_bloqueados` (`:233-243`) y después el dominio (`:244-249`);
- `sql stable`, sin definer, `search_path = ''`.

**`handle_new_user`** (`…466:48-65`):
- plpgsql y definer;
- nunca lanza.

Grants: `…465:103-106` y `…438:39`. El amarre entre las dos es T28 (a3) (`rls.sql:3245-3275`).

### 3. Quién usa `universidad_dominios`

| Consumidor | Uso | Efecto de la Ola 5 |
|---|---|---|
| Hook | Lee | Filtra `activo` |
| `handle_new_user` | Lee | Filtra `activo` |
| Policy y grant de `supabase_auth_admin` (`…465:53-58`) | Portante | Sin cambio |
| Preflight de `crear-admin.mjs:267-268` | Lee | **Sin cambio**: un dominio inactivo sigue siendo de alumno |
| `probe-admin.mjs:123,128,619-623` | Lee | Sin cambio |
| `probe-registro.mjs:173-184` | Lee | Casos nuevos |
| `seed.sql:46`, `seeds-local/*` y ~10 inserts de `rls.sql` | Escriben `(dominio, universidad_id)` | Compatibles gracias al default |
| `database.types.ts:595` | Tipos | Gana `activo` |
| `src/lib/registro.ts` | Códigos | Sin cambio |
| `admin/` | — | No la usa hoy |

### 4. Un CHECK no puede llamar a una helper de `private`

Probado en local dentro de `BEGIN … ROLLBACK`, con la helper revocada.

**CHECK que llama a la helper:**

| Rol | Resultado |
|---|---|
| `service_role` (tiene INSERT en `campus`, pero no USAGE sobre `private` ni EXECUTE) | **`42501 permission denied for function normaliza_texto`** |
| `authenticated` | `42501 permission denied for table campus`: lo frena el privilegio de tabla antes de llegar al CHECK |
| `postgres` | OK |

**Expresión autocontenida (la que se usa):**
- Definición: `CHECK (((nombre = btrim(regexp_replace(nombre, '\s+'::text, ' '::text, 'g'::text))) AND ((char_length(nombre) >= 2) AND (char_length(nombre) <= 100))))`.
- `service_role` inserta `'Exp S ok'` sin problema.
- `' Exp  S'`, `'x'`, `'Exp\tS'` y un nombre con NBSP dan 23514.

La helper sigue existiendo, pero **solo la usan las RPC**.

### 5. Efecto en la app (comportamiento actual demostrado)

**Registro con un dominio inactivo:**
- Recibe el mismo `403 dominio_no_participante` y el mismo `Notice` que hoy.
- No hace falta código ni frame nuevo en la app.

**Usuarios ya registrados:**
- No cambian.
- Login, recuperación y OTP no pasan por el hook (`probe-registro` 5 y 6).

**Catálogo:**
- Se lee de forma dinámica, así que **no hace falta un build nuevo**.
- `fetchCatalogoCampus` (`src/lib/catalogos.ts:115-131`) corre una vez por sesión (`explorar-state.tsx:165`).
- `fetchCampus` (`:133-142`) se llama al abrir el sheet.
- **Cuándo se ve un cambio de NOMBRE en la app** (corregido en v3.2; ver "Corrección v3.2"):
  - **El chip del Feed y el Selector de campus** usan el catálogo en memoria (`explorar-state.tsx:161-174`; `etiquetaAlcance`, `:67-73`), que se lee una vez por sesión. **Un rename se ve al reabrir la app**, igual que una universidad o un campus nuevo. El pull-to-refresh del Feed NO lo relee (`src/app/(tabs)/index.tsx:57-70`, solo re-pide las tarjetas).
  - **Las tarjetas** muestran solo la UNIVERSIDAD (`src/components/ProductCard.tsx:83`, embed `listings.ts:116`): su nombre nuevo se ve con pull-to-refresh, si esa universidad tiene publicaciones en el alcance.
  - **El nombre de un CAMPUS** no aparece en ninguna tarjeta: se ve en Detalle ("Zona de entrega", `src/app/(explorar)/detalle/[id].tsx:726-727`) al abrir una publicación de ese campus.
  - Las pantallas de perfil leen el campus al abrir su sheet (`fetchCampus`), así que ahí se ve en la siguiente apertura.

**Universidad sin campus:**
- El selector del Feed no la muestra.
- Si tiene un dominio activo, quien se registre se queda **atascado** en "Completar perfil" con "Esta universidad todavía no tiene campus dados de alta." (`src/components/CampusBottomSheet.tsx:151-154`).
- Esto justifica la guarda de L5.

### 6. Campus sin coordenadas (7b)

- `campusMasCercano` salta los campus sin coordenadas (`src/lib/ubicacion.ts:70`).
- Si ningún campus queda a 50 km o menos, devuelve `null` (`:79`).
- Un campus sin coordenadas nunca se detecta, pero se puede elegir a mano.

### 7. Mapa `ACCION` del panel (7a)

- Está en `admin/src/lib/formato.ts:45-55` y hoy tiene 9 acciones.
- Lo usan `Usuarios.tsx:203` y `DetalleListing.tsx:130`, con el fallback `?? a.accion`.
- Esas dos pantallas nunca muestran filas de catálogo.
- L-F suma las 7 etiquetas en el commit e.

### 8. Ventana hook → trigger (L-D, riesgo aceptado)

GoTrue llama al hook y después inserta en `auth.users`, dentro de la misma petición (milisegundos).

Si el dominio se desactiva justo en ese intervalo:
- **el usuario de Auth se crea**;
- el trigger deja **`public.users.universidad_id = NULL`** (medido en local);
- el alta no aborta.

Lo que ve el usuario:
- "Completar perfil" en su variante "sin universidad asignada" (`completar-perfil.tsx:77`, `:284-305`), con su `.notice` y el botón "Usar otro correo".
- No puede elegir campus ni publicar.

Cómo se sale:
- Reactivar el dominio no repara la cuenta.
- Volver a registrarse con el mismo correo entra a la misma cuenta.

No se agrega RPC de reparación. El runbook (commit h) documenta **diagnóstico y escalamiento**, no una instrucción rutinaria:

1. **Diagnóstico** (Studio, solo lectura):
   - la fila de `public.users`: `universidad_id`, `campus_id` y `estado`;
   - el dominio de su correo en `auth.users`;
   - la fila de ese dominio en `universidad_dominios`: a qué universidad apunta y si está `activo`;
   - las acciones `desactivar_dominio` y `reactivar_dominio` en `admin_acciones` cerca del `created_at` de la cuenta, como evidencia de que fue la ventana y no otra causa.
2. **Qué corresponde:**
   - la universidad del dominio;
   - que esa universidad tenga campus;
   - que `campus_id` siga en NULL.
   - Por `users_campus_requiere_universidad` y la FK compuesta `users_campus_universidad_fkey`, fijar `universidad_id` con `campus_id` en NULL es válido.
   - **El campus no se fija a mano: lo elige el usuario** en "Completar perfil".
3. **Escalamiento:** al admin técnico.
   - Antes de tocar nada, se anota quién, cuándo y por qué, fuera de la base (Studio no audita).
   - Solo entonces se hace el UPDATE manual de `universidad_id`.
   - Después se verifica que el usuario termine su perfil.

T37 (o) lo documenta como prueba.

---

## C. Discrepancias con el plan histórico

1. **`and d.activo` no existe** en ninguna de las dos copias, y tampoco existe la columna.
2. **"Mover un campus falla por la FK" (§10)** solo es cierto si el campus tiene referencias. El candado real es la firma de `editar_campus`.
3. **Nada en la base impide mover un dominio de universidad.** Lo impide que ninguna RPC lo haga.
4. **En §4, las RPC de alta no llevan `p_motivo`**, y la auditoría lo exige. Se resuelve con L1.
5. **§4 no define una RPC de lectura**, y el panel no puede leer los dominios (T27 (a)). Se agrega `admin.catalogo()`.
6. **Los nombres no tienen restricción en la base.** Se resuelve con L2.
7. **§10 es anterior a `…474`.** Si se partiera de `…465`, se perdería la rama `correo_bloqueado`. Por eso se parte de `…474:226-257`.
8. **`CLAUDE.md:3964-3965`** dice que `926ea74` y `1c8cd8f` quedaron "solo en local", pero ya están en `origin/main` (`e751539`). L-E: se corrige con un mínimo en el commit h, añadiendo "(se publicaron después, con `e751539`)". Nada más.
9. **`probe-registro` (34)** no estaba en la lista de la línea base.

---

## D. Contrato de la Ola 5

### IN

**Migración `2026MMDD000484_catalogo_admin.sql`** (la fecha real, según D17):

1. **Columna:** `universidad_dominios.activo boolean not null default true`. **Sin `desactivado_at`.**
2. **Hook y `handle_new_user`:**
   - `create or replace`, **copiados literalmente** de `…474:226-257` y `…466:48-65`;
   - un único cambio: `and d.activo`;
   - grants reescritos de forma explícita con los mismos valores;
   - sin `drop`;
   - **no hace falta un grant nuevo para `activo`** (enmienda 1, verificado: el grant de `supabase_auth_admin` es de TABLA, `…465:53`).
3. **`admin_acciones_accion_check`:** pasa de 9 a **16** acciones.
4. **Checks de forma, autocontenidos:**
   - aplican a `universidades.nombre`, `campus.nombre` y `campus.ciudad`;
   - exigen el texto normalizado y un largo de 2 a 100;
   - índices únicos `universidades (lower(nombre))` y `campus (universidad_id, lower(nombre))`.
5. **Proveedores públicos (L-A):** la lista de 21 vive **solo** en `private.proveedores_correo_publico()` (IMMUTABLE, revocada), que consulta `agregar_dominio`. **Sin CHECK de tabla** (enmienda 3).
6. **`private.normaliza_texto`:** solo para las RPC.
7. **8 RPC de `admin`:** `admin.*` pasa de 13 a **21**.
8. **Ninguna RPC** cambia el `dominio` ni el `universidad_id` de un dominio, ni el `universidad_id` de un campus.

**Además:**
- T37 y T28 (a3) extendida;
- `probe-registro` 10a-10g;
- `probe-admin`: textos, escrituras, concurrencia y etiquetas `ACCION`;
- el panel de Catálogo;
- 6 frames nuevos (de 29 a 35);
- la herramienta específica de recuperación del hook y de `handle_new_user` (K-6b, enmiendas 7 y 10), en `docs/rf17-ola5-recuperacion.sql`. **No es un rollback de la `…484`**;
- el runbook: L-B y el diagnóstico de L-D;
- la documentación.

### OUT

- Borrar o desactivar universidades o campus.
- Mover dominios o campus.
- `desactivado_at`.
- La auditoría del catálogo en el panel (llega en la Ola 6).
- Métricas.
- Re-derivar la universidad de cuentas existentes.
- El plan B del hook.
- El preflight de `crear-admin.mjs`.
- La app móvil.
- **Bloquear `rlvo.com.mx` en la base** (L-B: solo runbook).
- **Catálogo QA y escrituras de demostración en producción.**
- Deuda ajena: índices de alcance, `.easignore`, Vault y respaldos.

### Registro intacto: cómo se garantiza

- (a) El default `true` deja activos los 6 dominios en la misma transacción.
- (b) Las funciones se copian literalmente.
- (c) T37 b y T28 (a3).
- (d) `probe-registro` contra GoTrue real.
- (e) El readback del hook con los 6 dominios (K-6), con el alcance de rol de la enmienda 1.
- (f) K-7B por defecto; K-7A es opcional.
- (g) La herramienta de recuperación del hook, ya probada (K-6b). Solo aplica si se demuestra que la causa es el hook o `handle_new_user`.

---

## E. RPC por RPC

### Plantilla común

- `security definer`, `set search_path = ''`, plpgsql.
- `revoke all … from public, anon` y `grant execute … to authenticated`.
- Primera línea: `perform private.exigir_admin()`.
- **Sin bloques `EXCEPTION`.**
- **Sin `pg_advisory_xact_lock`** (enmienda 2). Las escrituras se apoyan en `for update` o CAS y en los índices únicos.
- `crear_universidad` y `crear_campus` insertan con `on conflict do nothing`; si afecta 0 filas, devuelven `nombre_duplicado`, sin 23505 crudo.
- En las ediciones se pre-chequea el duplicado **excluyendo el propio `p_id`**. Si una carrera con otra sesión gana justo entre el pre-chequeo y el UPDATE, el índice único responde 23505 crudo, y eso queda documentado.
- Motivo de 3 a 500 caracteres; si no, `22023 motivo_invalido`.
- Los nombres pasan por `normaliza_texto` y un largo de 2 a 100; si no, `22023 nombre_invalido` o `ciudad_invalida`.

### Las 8 RPC

**`catalogo()` → `jsonb`**
- Devuelve las universidades con sus campus (con conteos de `usuarios` y `publicaciones`), sus dominios (con `activo` y `created_at`) y el número de usuarios por universidad.
- **No devuelve admins ni correos.**
- Guardas: `exigir_admin`.
- Auditoría: ninguna (es lectura).

**`crear_universidad(p_nombre, p_motivo)` → `bigint`**
- Guardas: motivo; nombre; `23505 nombre_duplicado` (`on conflict do nothing` sobre el índice `lower(nombre)`, 0 filas).
- Auditoría: `crear_universidad` · universidad · id · `null` → `{nombre}`.

**`editar_universidad(p_id, p_nombre, p_motivo)` → `void`**
- Guardas: motivo; nombre; `P0002 universidad_no_existe` (`for update`); `55000 sin_cambios` (texto normalizado idéntico); `nombre_duplicado` (excluye el propio `p_id`, así que `'tec'` → `'TEC'` sí se permite).
- Auditoría: `{nombre}` → `{nombre}`.

**`crear_campus(p_universidad_id, p_nombre, p_ciudad, p_latitud, p_longitud, p_motivo)` → `bigint`**
- Guardas: motivo; nombre; ciudad; `22023 coordenadas_invalidas` (las dos coordenadas o ninguna, y en rango); `universidad_no_existe`; `nombre_duplicado` (en la misma universidad, `on conflict do nothing`, 0 filas).
- Auditoría: `null` → `{nombre, ciudad, latitud, longitud, universidad_id}`.

**`editar_campus(p_id, p_nombre, p_ciudad, p_latitud, p_longitud, p_motivo)` → `void`**
- **Sin `universidad_id`.** Es un reemplazo completo: `null`/`null` borra las coordenadas.
- Guardas: las de crear, más `P0002 campus_no_existe` (`for update`) y `sin_cambios`.
- Auditoría: solo las claves que cambiaron.

**`agregar_dominio(p_universidad_id, p_dominio, p_motivo)` → `void`**
- Normaliza: `lower`, `btrim` y quita un `@` inicial.
- Guardas, en orden:
  - motivo;
  - `22023 dominio_invalido`: hostname con al menos un punto, sin `@` ni espacios, de 253 caracteres o menos;
  - `22023 dominio_no_permitido`: proveedor público, consultado contra `private.proveedores_correo_publico()`;
  - `universidad_no_existe`;
  - `55000 universidad_sin_campus`;
  - si el dominio ya existe: `55000 dominio_existe_activo`, `dominio_existe_inactivo` o `dominio_de_otra_universidad`.
- Inserta con `on conflict do nothing`; 0 filas → `dominio_existe_activo`.
- **Nunca reactiva.**
- Auditoría: `agregar_dominio` · dominio · el texto del dominio · `null` → `{dominio, universidad_id, activo: true}`.

**`desactivar_dominio(p_dominio, p_motivo)` → `void`**
- Guardas: motivo; `P0002 dominio_no_existe`; CAS `where activo`; 0 filas → `55000 dominio_ya_inactivo`.
- Se permite desactivar el último dominio de una universidad con usuarios; el panel avisa.
- Auditoría: `{activo: true}` → `{activo: false}`.

**`reactivar_dominio(p_dominio, p_motivo)` → `void`**
- Guardas: motivo; `dominio_no_existe`; `universidad_sin_campus`; CAS `where not activo`; 0 filas → `55000 dominio_ya_activo`.
- Auditoría: `{activo: false}` → `{activo: true}`.

### Idempotencia

- Repetir una acción devuelve un código explícito, nunca un éxito silencioso ni una auditoría doble.
- No aplican las guardas `no_sobre_si_mismo` ni `objetivo_es_admin`.

---

## F. Auditoría

**7 acciones nuevas**, una por RPC de escritura y con su mismo nombre:
- `crear_universidad`
- `editar_universidad`
- `crear_campus`
- `editar_campus`
- `agregar_dominio`
- `desactivar_dominio`
- `reactivar_dominio`

El CHECK pasa de **9 a 16** acciones.

**Sin cambios:**
- `objetivo_tipo`.
- `claves_auditoria_ok`: las listas de D20 ya cubren estas claves.

**Corrección de la justificación anterior:** decir que "`universidad_dominios.created_at` da la fecha" era falso, porque esa columna es la fecha de ALTA del dominio. La versión correcta:
- `activo` es el **estado actual**.
- La **historia** está en las filas de `admin_acciones`: su `accion` dice qué pasó y su `created_at`, cuándo.
- Por eso basta `{activo: true}` → `{activo: false}`. Guardar también un timestamp duplicaría `admin_acciones.created_at`.
- Sin `desactivado_at` no hay una segunda fuente temporal que pueda divergir de la primera.
- **Límite:** lo que se haga por Studio no deja historia.

**No se reutilizan:**
- `estado_inesperado` (`admin/src/lib/rechazos.ts:79-85`);
- las acciones de admin ni las de usuario.

---

## G. T37 y probes

### T37

Va autocontenida, al final de `rls.sql`. Siembra:
- `RLS T37 Uni`, sin campus;
- `RLS T37 Otra`;
- los dominios `rls-t37.mx` y `rls-t37b.mx`;
- un admin activado (con `claims_aal` y `rechazo_aal`) y un no-admin.

Cada acción va en una sentencia y su comprobación en otra (`\gset`).

Controles negativos:
- uno a la vez;
- con el patrón `begin; <variante>; <suite>; rollback`;
- imprimiendo antes el md5 de `prosrc` o el `pg_get_constraintdef` vivo;
- contra la suite completa y contra T37 aislada.

| # | Qué prueba | n | Control negativo |
|---|---|---|---|
| pre | Fixtures | 1 | — |
| a | `activo` es NOT NULL con default `true`, y las filas sembradas quedan en `true` | 2 | Default `false` |
| b | Hook: activo `{}`, inactivo rechaza, reactivado `{}` (3); trigger: inactivo → NULL, activo → universidad (2); `correo_bloqueado` va antes que el dominio (1); ACL del hook y del trigger iguales al literal (1). **Corre como `postgres`: prueba la LÓGICA, no el rol real** (enmienda 1, ver Enmiendas v3.1) | 7 | Sin filtro en el hook; sin filtro en el trigger; hook copiado de `…465`; `grant` a `authenticated` |
| T28 (a3) | Suma un correo de dominio inactivo (misma aserción) | 0 | Filtrar en una sola de las dos copias |
| c | No-admin rechazado en las 8 RPC (8); aal1 → `mfa_requerido` (2); TOTP vencido → `totp_vencido` (2); un admin válido lee `catalogo()`, que no trae admins ni correos (1) | 13 | Quitar `exigir_admin` de una |
| d | `crear_universidad`: éxito y auditoría (2), motivo (1), nombre (1), duplicado en mayúsculas (1) | 5 | Sin `lower` |
| e | `editar_universidad`: éxito y auditoría (2), `sin_cambios` (1), no existe (1), **`'tec'` → `'TEC'` sobre la misma universidad da éxito** (1, enmienda 6) | 5 | Sin la guarda `sin_cambios`; un duplicado que no excluya el propio `p_id` |
| f | `crear_campus`: con y sin coordenadas (2), una sola (1), fuera de rango (1), universidad inexistente (1), duplicado (1), mismo nombre en otra universidad (1), auditoría (1) | 8 | Sin validación de coordenadas (se exige 22023) |
| g | `editar_campus`: la firma no tiene `universidad_id` (1), `null`/`null` borra (1), `sin_cambios` (1), auditoría con solo las claves cambiadas (1), no existe (1) | 5 | Aceptar `p_universidad_id`; auditar todo |
| h | `agregar_dominio`: normaliza (1), auditoría (1), inválido (1), proveedor público (1), sin campus (1), existe activo (1), existe inactivo (1) **y sigue inactivo** (1), de otra universidad (1) | 9 | `on conflict do update set activo = true`; sin la guarda de campus |
| i | Desactivar: éxito y auditoría (2), ya inactivo (1), no existe (1). Reactivar: éxito y auditoría (2), ya activo (1), sin campus (1) | 8 | CAS sin `and activo` |
| j | Desactivar no cambia el `universidad_id` de los usuarios existentes | 1 | — |
| k | El CHECK admite las 16 y rechaza una inventada | 2 | El CHECK de 9 |
| l | Un campus con referencias no se borra ni siendo `postgres` | 1 | FK en cascade |
| m | Checks de universidad, campus y ciudad → 23514 (3); índices únicos con `lower` → 23505 (2); **NBSP → 23514 (1) y tabulador → 23514 (1)** (enmienda 6, medidos en B.4); `normaliza_texto` cumple el check (1). **Sin las aserciones del CHECK de proveedores ni la de lista = lista** (enmienda 3) | 8 | Quitar cada check o índice |
| n | **Regresión de admins:** md5 de `private.admins` y de `auth.mfa_factors` iguales antes y después de T37 | 1 | Una RPC que toque `private.admins` |
| o | Ventana hook→trigger: el trigger deja NULL | 1 | — |
| | **Total T37 (DISEÑO, enmienda 12)** | **77** | **529 → ~606**. Es diseño, no contrato: el conteo final se mide tras implementar con el `grep` |

**Recálculo:** 76 − 2 (m: CHECK de proveedores y lista = lista) + 2 (m: NBSP y tabulador) + 1 (e: mayúsculas) = **77**.

**Concurrencia:** sin advisory lock (enmienda 2), queda a cargo de `on conflict`, CAS y los índices únicos. Se mide en `probe-admin` con dos llamadas HTTP.

### `probe-registro` (34 → 55)

Universidad de prueba con 1 campus y el dominio `probe-ola5.mx`. Al arrancar imprime `activo` y si cada función contiene `prosrc like '%d.activo%'`.

| Caso | Qué comprueba | n |
|---|---|---|
| 10a | Dominio activo: 200, fila, correo y universidad | 4 |
| 10b | Dominio desactivado: 403, `esDominioNoParticipante`, sin fila, sin correo | 4 |
| 10c | Dominio inexistente: 403, sin fila | 2 |
| 10d | Dominio reactivado: 200 y universidad | 2 |
| 10e | Cuenta existente cuyo dominio se desactiva: password, reset con correo, recovery, OTP y `universidad_id` sin cambio | 5 |
| 10f | `/admin/users` con dominio inactivo: 200, universidad NULL | 2 |
| 10g | `correo_bloqueado` con dominio activo: 403, sin fila | 2 |

Controles: quitar el filtro de cada copia; caen 10b y 10f.

### `probe-admin` (84 → 94)

- El 7c exige texto para cada `raise` nuevo.
- `catalogo()` por HTTP (1).
- Una escritura por RPC, con 200 y su auditoría (7).
- Dos `agregar_dominio` concurrentes: uno da 200 y el otro `dominio_existe_activo`, sin 23505 crudo (2).

### Herramienta de recuperación del hook (enmiendas 7 y 10)

**Qué es:** una herramienta específica que restaura **solo** `hook_before_user_created` y `handle_new_user`. **No es un rollback general de la `…484`.**

**Dónde vive:** en `docs/rf17-ola5-recuperacion.sql` (**nunca** en `supabase/migrations/`), y además junto a la copia cifrada de K-2. Su cabecera dice que no es una migración, y lleva la precondición.

Se vuelve a probar en el commit b, contra la `…484` real.

**Ya probada en local:**
- **Estado anterior a la Ola 5:** md5 `87e685cf` / `b6e6a8a7`, OID 18592 / 19058.
- **`…484` simulada:** md5 `f11e4416` / `cc0b0bbe`. Con `tec.mx` inactivo, el hook da 403 y el trigger deja NULL.
- **Restauración:**
  - el texto literal de `…474:226-257` y `…466:48-65`;
  - `revoke execute … from public, anon, authenticated`;
  - `grant execute … to supabase_auth_admin` (hook);
  - el revoke del trigger.
- **Resultado:**
  - **md5, ACL, `prosecdef`, `provolatile`, `proconfig` y OID idénticos** a los de antes;
  - `correo_bloqueado` funciona;
  - `on_auth_user_created` sigue intacto.

**Limitación:** restaurar reabre los dominios que estén inactivos en ese momento.

**Precondición:** antes de restaurar, correr `select count(*) from universidad_dominios where not activo`. Si da más de 0, se decide antes de seguir.

---

## H. Frames

Van en `design/admin-panel.html`, que pasa de 29 a **35** frames. Usan `data-cat="catalogo"` y suman el ítem "Catálogo" a la navegación.

1. **Catálogo — lista de universidades**
   - Por universidad: campus, dominios activos e inactivos, y usuarios.
   - Botón "Agregar universidad".
   - Variante: error de carga.
2. **Universidad — detalle**
   - El nombre, con "Editar".
   - Campus: nombre, ciudad, si tiene coordenadas, usuarios y publicaciones. Con "Editar" y "Agregar campus".
   - Dominios: chip de estado, fecha de alta, "Desactivar"/"Reactivar" y "Agregar dominio".
   - Variantes: sin campus (con aviso) y sin dominios.
3. **Modal Universidad (crear y editar)**
   - Nombre y motivo.
   - Variantes: duplicado, inválido, `sin_cambios`, y el aviso de que el nombre se ve en todas las publicaciones.
4. **Modal Campus (crear y editar)**
   - Nombre, ciudad, coordenadas opcionales y motivo.
   - Variantes: `coordenadas_invalidas`, duplicado, y los avisos sobre "Detectar campus más cercano".
5. **Modal Agregar dominio**
   - Campo, motivo y el texto "coincidencia exacta".
   - Variantes: inválido, proveedor público, sin campus, existe activo, existe inactivo (con "Reactivar") y de otra universidad.
6. **Modal Desactivar / Reactivar**
   - Motivo, y el aviso "Nadie nuevo podrá registrarse con @x. Las cuentas existentes no cambian."
   - Variantes: el último dominio activo de una universidad con usuarios, y `dominio_ya_*`.

Orden: frames → revisión en navegador → **⛔ tu aprobación** → migración.

---

## I. Pruebas manuales tuyas

### Local: el ciclo completo

Con el panel en `:5173`, tu TOTP y la app en el simulador:

1. Crear una universidad, su campus y su dominio. Registrarse en la app: entra con su universidad y su campus.
2. Desactivar el dominio. Un alta nueva ve "correo no participante"; la cuenta del paso 1 sigue entrando y recuperando su contraseña.
3. Reactivar el dominio: el alta vuelve a funcionar.
4. Intentar agregar `gmail.com`: no permitido. Agregar un dominio a una universidad sin campus: bloqueado.
5. **Una universidad o un campus NUEVO, y el CAMBIO DE NOMBRE de cualquiera de los dos en el chip del Feed y en el Selector de campus**, se ven **al cerrar y reabrir la app**, porque `fetchCatalogoCampus` corre una vez por sesión (`explorar-state.tsx:161-174`). El pull-to-refresh del Feed no relee el catálogo. **Con pull-to-refresh** solo se ve el nombre nuevo de una **universidad en las tarjetas** (si tiene publicaciones en el alcance); el de un **campus** se ve en **Detalle** al abrir una de sus publicaciones (enmienda 9, corregida en v3.2).
6. Comprobar que cada rechazo pinta su texto. Con dos pestañas desactivando a la vez, una gana y la otra recibe `dominio_ya_inactivo`.

### Producción

No se escribe catálogo ni se crea ningún usuario por defecto.

1. Abrir Catálogo y comprobar que los conteos cuadran con K-6.
2. Pruebas de rechazo, que **no escriben** (la RPC lanza antes de escribir y la transacción se revierte):
   - `tec.mx` → `dominio_existe_activo`;
   - `gmail.com` → `dominio_no_permitido`;
   - **`sin_cambios`**: abrir "Editar universidad" de Tec y guardar **el valor precargado, sin modificarlo**. El panel no bloquea el envío sin cambios: decide la base.
   - (Se eliminó "desactivar `noexiste-ola5.mx`": la UI no lo permite y lo cubre T37. Enmienda 4.)
   - **Cualquier escritura accidental se detecta en K-12**: `admin_acciones` sigue con id máximo 13.
3. **K-7A (opcional):** solo si confirmas un buzón institucional que controles.
4. **No hay escrituras de catálogo** salvo por una necesidad real o una prueba que apruebes explícitamente.

---

## J. Commits a–j

**Regla de Git (enmienda 8):** todo commit se hace con `git add <archivos explícitos>`, nunca con `git add -A` ni `git add .`. `design/rlvo-feed-variants.html` y cualquier otro archivo ajeno se quedan fuera. Los conteos de cada verificación son **diseño**: el definitivo se mide tras implementar (enmienda 12).

**a. Frames del catálogo (+6)**
- Archivos: `design/admin-panel.html`.
- Precondición: plan aprobado.
- Verificación: conteo de 35, revisión en navegador y **⛔ tu aprobación**.

**b. Migración `…484` completa**
- Columna, hook, trigger, CHECK de 16, checks de nombres, índices, 2 helpers (una de ellas con la lista de proveedores) y 8 RPC. **Sin CHECK de proveedores ni advisory lock.**
- Archivos: `supabase/migrations/2026MMDD000484_catalogo_admin.sql`.
- Precondición: a aprobado.
- Verificación:
  - `db reset`;
  - las 529 aserciones previas en verde sin cambios (T27, T28 y T33 (k2) incluidas);
  - ACL y `pg_get_constraintdef` leídos;
  - **el hook bajo el rol real**: con `psql -U supabase_admin`, `begin; set local role supabase_auth_admin; select …; rollback;` sobre los 6 dominios de la semilla y los de prueba, un dominio inexistente y `x@gmail.com` (enmienda 1);
  - **la herramienta de recuperación del hook contra la `…484` real**, con md5 de vuelta a `87e685cf` / `b6e6a8a7`.

**c. T37 y T28 (a3)**
- Archivos: `supabase/tests/rls.sql`.
- Precondición: b.
- Verificación: la suite en verde (diseño: ~606; el conteo final se mide), T37 aislada en verde, y cada control cayendo en su aserción.

**d. `probe-registro` 10a-10g**
- Archivos: `scripts/probe-registro.mjs`.
- Precondición: b, con el hook activo en local.
- Verificación: 55 en verde; los dos controles caen en 10b y 10f.

**e. Textos, `ACCION` y `probe-admin`**
- Archivos: `admin/src/lib/rechazos.ts`, `admin/src/lib/formato.ts` (7 etiquetas, L-F) y `scripts/probe-admin.mjs`.
- Precondición: b.
- Verificación: `probe-admin` 94 y `check:admin`.

**f. Tipos del panel (`--local`)**
- Archivos: `admin/src/db/admin.types.ts`.
- Precondición: b.
- Verificación: `check:admin`.

**g. Panel: Catálogo**
- Archivos:
  - `admin/src/pantallas/{Panel,Catalogo,DetalleUniversidad}.tsx`;
  - `admin/src/componentes/Modal{Universidad,Campus,AgregarDominio,EstadoDominio}.tsx`;
  - `admin/src/lib/tipos.ts`;
  - `admin/src/estilos.css`.
- Precondición: a, e y f.
- El modal de edición **no bloquea el envío sin cambios**: el `sin_cambios` lo decide la base (I-producción 2).
- Verificación: `check:admin`, build, aceptación visual contra los 6 frames y **tus pruebas I-local**.

**h. Documentación previa al despliegue**
- Archivos:
  - `CLAUDE.md` §3, §6 y §8, con los conteos LOCALES medidos;
  - `docs/rf17-plan-admin.md` ("Ola 5: lo que cambió");
  - `admin/CLAUDE.md`;
  - `docs/admin-runbook.md`: §2 (catálogo, incluido **cuándo ve la app un cambio de nombre**: chip y selector al reabrir; tarjetas y Detalle como en B.5, corrección v3.2), §7 (L-B: "no dar de alta dominios de RLVO"), el diagnóstico de L-D (B.8) y el contrato de K-6b;
  - **la corrección mínima de `CLAUDE.md:3964-3965` (L-E)**, declarada en el mensaje del commit;
  - `docs/rf17-ola5-plan.md` (este plan; enmienda 8: solo entra aquí);
  - `docs/rf17-ola5-recuperacion.sql` (enmienda 7).
- **Redacción obligatoria (enmienda 5):** "implementada y probada en local, pendiente de despliegue". **No afirma** 48 migraciones en remoto ni que la Ola 5 esté en producción.
- Precondición: c a g en verde.
- Verificación: conteos LOCALES re-medidos (48 en el repo, aserciones, probes, 35 frames y 21 funciones).

**i. Tipos `--linked`**
- Archivos: `admin/src/db/admin.types.ts` y `src/lib/database.types.ts`.
- Precondición: K-5.
- Verificación: en el panel solo cambia el formato y en la app solo aparece `activo`; `tsc` y `check:admin`.

**j. Cierre**
- Archivos: `CLAUDE.md` §8, `docs/rf17-plan-admin.md` y `admin/CLAUDE.md`.
- **Aquí, y solo aquí, se escriben los conteos remotos y "CERRADA"** (enmienda 5).
- Precondición: **K-13** (K-12 ya completado; el commit j se crea en K-13). Enmienda 11.
- Verificación: **incluye K-14**. CERRADA solo con M cumplido.

---

## K. Orden de despliegue

El orden es base → registro → tipos → panel. La app no cambia.

**K-1. Preflight (yo, solo lectura) ⛔**
- Remoto en 47 migraciones y 6 dominios.
- El hook devuelve `{}` para los 6.
- md5 y ACL del hook y del trigger iguales a A.
- `is_admin`, `exigir_admin`, admins y factores iguales a A.
- 0 nombres que violen los checks nuevos (incluido el mínimo de 2).
- 0 dominios en la lista de proveedores.
- `git status` limpio.

**K-2. Copia cifrada obligatoria (tú) ⛔**
Esquema y datos, con el procedimiento de la Ola 3: AES-256, SHA-256 y borrado de los `.sql` en claro. **Junto a ella se guarda `docs/rf17-ola5-recuperacion.sql`** (enmienda 7). Confirmas cuando esté verificada.

**K-3. Push de Git (tú) ⛔**
Selectivo si hay commits ajenos.

**K-4. `supabase db push --dry-run` (tú) ⛔**
Debe salir **solo** `…484`. Se requiere tu aprobación para seguir.

**K-5. `supabase db push` (tú)**

**K-6. Readback inmediato (yo) ⛔ go/no-go**
- 48 migraciones.
- `activo` en `true` para 6 de 6.
- **Hook, con el alcance de rol de DP-1 (decidida: local real + remoto por catálogo)** (enmienda 1). El `set local role supabase_auth_admin` **no es posible en remoto** (medido), así que en remoto se verifica:
  - privilegios del rol real: `has_table_privilege` y `has_column_privilege('supabase_auth_admin', …, 'activo', 'select')`;
  - la policy (`roles = {supabase_auth_admin}`, `qual = true`) y el ACL de la función;
  - la lógica, ejecutada como `postgres`, sobre los 6 dominios, un dominio inexistente y `x@gmail.com`, **etiquetada como lógica y no como ejecución bajo el rol**.
- md5 del hook y del trigger iguales a local; ACL igual a A.
- CHECK de 16.
- 21 funciones `admin.*` con su plantilla y md5 iguales a local.
- El resto de funciones, sin cambios.
- Checks e índices presentes.
- `is_admin`, `exigir_admin`, admins y factores sin cambios.

**K-6b. Ante una falla: STOP y diagnóstico. La herramienta del hook NO es un rollback general (enmienda 10) ⛔**

La herramienta restaura **únicamente** `hook_before_user_created` y `handle_new_user`. Tres casos:

1. **Falla en el camino de registro, y el diagnóstico DEMUESTRA que la causa es el cambio del hook o de `handle_new_user` de la Ola 5:** STOP ⛔ → diagnóstico → precondición de dominios inactivos (`select count(*) from universidad_dominios where not activo`) → propuesta de migración correctiva NUEVA con el texto de `docs/rf17-ola5-recuperacion.sql` → dry-run → **tu aprobación** → ejecución.
2. **Falla en cualquier otra parte** (un CHECK, una RPC, el ACL de otra función, los índices, `admin.*`, `is_admin`, `exigir_admin`, el panel, los tipos, la auditoría…): STOP ⛔ y diagnóstico específico. **No se restaura el hook como respuesta genérica.**
3. **Causa desconocida:** STOP ⛔. No se ejecuta ninguna recuperación hasta identificarla.

**K-7B. Regresión de registro por defecto, sin crear usuario (yo) ⛔**
- El mismo alcance de rol que K-6 (DP-1): privilegios, policy y ACL del rol real, y la lógica como `postgres` sobre los 6 dominios reales, un inexistente y `x@gmail.com`, etiquetada como lógica.
- `correo_bloqueado` sigue antes que el dominio, comprobado con `prosrc`.
- Todo de solo lectura.
- **La ejecución real bajo `supabase_auth_admin`** sale de dos lugares:
  - en local: el `set local role` como `supabase_admin` (commit b) y `probe-registro` contra GoTrue, con md5 local = remoto;
  - en remoto: los logs `run_hook` de la siguiente alta natural, si ocurre, o K-7A.

**K-7A. Opcional, solo con un buzón que confirmes (tú) ⛔**
- Un alta real en un dominio institucional, con su `universidad_id` y `run_hook` OK.
- Después, "Eliminar cuenta" desde la app.
- **Antes yo leo `estado`, que debe ser `activo`.** Una cuenta suspendida eliminada bloquea su correo para siempre (`…474:208`, trigger en `:217-221`).

**K-8. `gen types --linked` (tú y yo) ⛔**
Para la app y el panel, más el diff. Commit i.

**K-9. Build y preflight de `admin/dist` (yo) ⛔**

**K-10. Deploy (tú; la batería, yo) ⛔ antes del deploy**
- `wrangler pages deploy … --commit-hash <commit>`.
- Production, 4 variantes × 3 hosts, 6 headers y comprobación byte a byte.

**K-11. Smoke manual (tú) ⛔**
I-producción 1 y 2: `dominio_existe_activo`, `dominio_no_permitido`, y `sin_cambios` con el valor precargado (enmienda 4).

**K-12. Readback final (yo) ⛔**
- `admin_acciones` sin filas de catálogo: sigue en id 13, salvo una operación real.
- Los 6 dominios activos.
- 0 cambios en `users.universidad_id`.
- Admins y factores intactos.
- Si hubo K-7A, la cuenta eliminada y su correo no bloqueado.

**K-13. Documentación de cierre (yo) ⛔**
Commit j (conteos remotos y "CERRADA") y tu aprobación del push.

**K-14. Cierre (yo)**
Git limpio, `HEAD = origin/main` y 48 = 48 migraciones.

### Por qué basta esta evidencia sin un E2E en producción

- El ciclo completo se prueba en local contra GoTrue real.
- El md5 de cada función en remoto es igual al de local.
- Los rechazos de I-producción ejercitan en producción la autorización y las búsquedas.
- K-7B prueba el hook en producción.

La escritura y su auditoría salen de T37, de los controles, de `probe-admin` y de la concurrencia. `private.auditar` ya está en producción desde la Ola 1.

---

## L. Riesgos y decisiones

### Riesgos

1. **El `create or replace` del hook.** Mitigación: copia literal, controles b, la prueba bajo el rol real en local (commit b), K-6 y K-7B. La herramienta específica de K-6b solo se usa si el diagnóstico demuestra que la causa es el hook o `handle_new_user` (enmienda 10).
2. **La herramienta del hook reabre dominios inactivos.** Mitigación: su precondición.
3. **La ventana hook→trigger.** Aceptada (L-D), con diagnóstico y escalamiento en el runbook (B.8).
4. **Sin PITR.** Mitigación: copia cifrada obligatoria.
5. **La lista de proveedores vive solo en una función.** Studio puede insertar un proveedor sin que nada lo frene (enmienda 3, aceptado). Para cambiar la lista hace falta una migración nueva con `create or replace`.
6. **Sin advisory lock** (enmienda 2). Las carreras las deciden `on conflict`, CAS y los índices únicos. En una edición puede salir un 23505 crudo si gana una carrera rara.
7. **El hook no se puede ejecutar bajo su rol real en remoto** (enmienda 1, medido). La evidencia de remoto bajo el rol queda limitada a privilegios, policy y ACL, más los logs de `run_hook`. Ver DP-1.

### L-A. Proveedores públicos

Son 21 buzones públicos genéricos; ninguno es dominio de universidad. `[+]` marca los que yo agregué a tu lista.

```
gmail.com
googlemail.com        [+]
hotmail.com
hotmail.com.mx
hotmail.es            [+]
outlook.com
outlook.es
outlook.com.mx        [+]
live.com
live.com.mx           [+]
msn.com
yahoo.com
yahoo.com.mx
yahoo.es              [+]
icloud.com
me.com
mac.com               [+]
protonmail.com
proton.me             [+]
aol.com               [+]
gmx.com               [+]
```

**Dónde vive (enmienda 3).** **Solo** en `private.proveedores_correo_publico()`, en la sección 5 de `supabase/migrations/2026MMDD000484_catalogo_admin.sql`. Sin CHECK de tabla. El archivo todavía no existe; las líneas exactas se reportan en el commit b.

**Cómo se modifica.** Con un `create or replace` de la función en una **migración nueva**. Un dominio que ya esté en la tabla no se ve afectado. Hoy no hay ninguna coincidencia (K-1 lo vuelve a medir).

### L-B. `rlvo.com.mx`

No se bloquea en la base y no entra en la lista de L-A. El commit h agrega una regla al runbook:
- no dar de alta dominios de RLVO;
- si se hace, el alta queda abierta a los buzones de RLVO y el preflight de `crear-admin.mjs:267-268` deja de permitir crear admins `@rlvo.com.mx`, aun desactivado.

### Decisiones pendientes

**Ninguna.** **DP-1 quedó DECIDIDA: "Local real + remoto por catálogo"**, la propuesta de abajo. K-7A sigue opcional. Se conserva el análisis:

**DP-1 (decidida), que abrió la enmienda 1:**
- **Lo medido:** `set local role supabase_auth_admin` **falla** como `postgres` en local (`permission denied to set role`, porque `pg_has_role('postgres', 'supabase_auth_admin', 'member') = f`) y en remoto (`execute_sql` corre como `postgres`, con `rolsuper = f` y sin membresía).
- **Solo funciona en local, como `supabase_admin`** (superusuario).
- Por eso `rls.sql`, que corre como `postgres` (cabecera, `rls.sql:6-7`), **no puede** ejecutar el hook bajo el rol real, y K-6/K-7B tampoco.
- **Propuesta:**
  - en local, la ejecución bajo el rol real se hace con `psql -U supabase_admin` + `set local role`, en la verificación del commit b, más `probe-registro` contra GoTrue;
  - T37 b se queda como prueba de lógica;
  - en remoto: privilegios, policy, ACL y lógica (etiquetada como tal), más los logs `run_hook`;
  - K-7A sigue opcional.
- **Alternativa:** volver K-7A obligatorio, como única ejecución real bajo el rol en remoto.

---

## M. Criterios de aceptación y cierre

**Diseño y pruebas locales**
- 35 frames aprobados por ti antes de la migración.
- `rls.sql` en verde: línea base 529, diseño ~606. **Conteo final medido tras la implementación** (enmienda 12). T37 aislada en verde y cada control cayendo en su aserción.
- `probe-registro` (diseño ~55) y `probe-admin` (diseño ~94) en verde, con **el conteo final medido tras la implementación**. Sin cambios en storage 41, admin-reset-mfa 35, eliminar-publicacion 12, eliminar-cuenta 25 y puerta-totp 11.
- `tsc`, `lint`, `check:functions` y `check:admin` limpios.
- **Ninguna prueba de pago es criterio**, incluido `probe-moderacion-http`.
- El hook ejecutado bajo `supabase_auth_admin` en local (commit b, enmienda 1).
- La herramienta de recuperación del hook, probada contra la `…484` real (commit b) y guardada en `docs/rf17-ola5-recuperacion.sql` y junto a la copia de K-2.

**Remoto**
- 48 migraciones, igual que el repo.
- `activo = true` para 6 de 6.
- Hook: privilegios, policy y ACL del rol real correctos, y la lógica da `{}` para los 6 (K-6/K-7B, con el alcance de DP-1).
- ACL del hook y del trigger idénticos.
- CHECK de 16.
- **21** funciones `admin.*` con su plantilla y md5 iguales a local.

**Regresión de admins**
- Los 3 activos con el mismo md5 de `(user_id:activado_at)`.
- Factores con el mismo md5.
- `is_admin()` y `exigir_admin()` con el md5 de A.
- `catalogo()` autoriza a un admin válido y rechaza al no-admin (T37 c y K-11).
- La Ola 5 no escribe `private.admins` ni `auth.mfa_factors` (T37 n y K-12).

**Despliegue**
- Tipos `--linked` comiteados.
- Panel en Production con la batería limpia.
- Tus pruebas: el ciclo local completo y el smoke de producción (lectura y rechazos que no escriben).
- Readback final: 0 escrituras de catálogo salvo una operación real y 0 cambios en `users.universidad_id`. Si hubo K-7A, la cuenta queda eliminada con su correo sin bloquear.

**Documentación**
- El commit h dice "implementada y probada en local, pendiente de despliegue". Los conteos remotos y "CERRADA" van solo en el commit j.
- **CERRADA solo después de K-14** (enmienda 11). K-12 es el readback de producción; K-13 y K-14 son gates obligatorios.

---

## Enmiendas v3.1

Aprobadas por el usuario sobre v3 y aplicadas arriba. Todo lo demás queda **exactamente** igual que en v3:
- L1–L10 y L-A–L-F;
- 8 RPC, 7 acciones y 21 funciones `admin.*`;
- frames de 29 a 35 y migración `…484`;
- sin `desactivado_at` y sin catálogo QA;
- K-7B obligatorio y K-7A opcional;
- lista ampliada de proveedores y `rlvo.com.mx` solo en el runbook;
- la recuperación del hook;
- los commits a–j y el orden de K.

Las enmiendas 5, 7 y 8 ajustan el CONTENIDO de h, j y K-2, no su orden ni su número.

1. **El hook bajo el rol real.**
   - El grant y la policy de `supabase_auth_admin` son de **TABLA**: `grant select on public.universidad_dominios to supabase_auth_admin;` (`…465:53`) y `create policy universidad_dominios_select_auth_admin … for select to supabase_auth_admin using (true);` (`…465:55-58`). Así que `activo` es legible **sin grant nuevo**.
   - **Medido en local:** tras agregar la columna, `has_column_privilege('supabase_auth_admin', …, 'activo', 'select') = t`. Las 3 filas de `column_privileges` son las derivadas del grant de tabla. En remoto: `tabla_select = t`, `col_privs = 3`, y una sola policy con `qual = true`.
   - **Ejecución bajo el rol** (como `supabase_admin`, `begin … rollback`):
     - `tec.mx` → `{}`;
     - inactivo, inexistente y `gmail.com` → `dominio_no_participante`;
     - control: sin la policy, `tec.mx` → `dominio_no_participante` (tabla vacía).
   - **El método pedido no se puede aplicar tal cual** (DP-1): `postgres` no puede `set role supabase_auth_admin`, ni en local ni en remoto.
2. **Sin `pg_advisory_xact_lock`.** Se conservan `for update`, CAS y los índices únicos. `crear_*` usan `on conflict do nothing` y devuelven `nombre_duplicado`. "La serialización" sale de lo aprobado.
3. **Sin el CHECK de proveedores en la tabla.** La lista de 21 vive solo en `private.proveedores_correo_publico()` y se cambia con `create or replace` en una migración nueva. Salen de T37 m las aserciones del CHECK y la de "lista = lista".
4. **Producción (I y K-11):** `sin_cambios` se prueba enviando el valor precargado sin modificarlo. Se eliminó "desactivar `noexiste-ola5.mx`". Una escritura accidental se detecta en K-12 (id máximo 13).
5. **Documentación:**
   - el commit h dice "implementada y probada en local, pendiente de despliegue";
   - los conteos remotos y "CERRADA" van solo en el commit j, tras K-13 y K-14.
6. **T37:**
   - e suma `'tec'` → `'TEC'` sobre la misma universidad (excluye el propio `p_id`, así que es éxito);
   - m suma NBSP y tabulador.
   - Total de diseño: **77**.
7. **La herramienta de recuperación** va en `docs/rf17-ola5-recuperacion.sql` (nunca en `supabase/migrations/`), con una cabecera que dice que no es una migración y su precondición. Se guarda también junto a la copia de K-2. Entra en el commit h.
8. **Git:**
   - `git add` siempre con archivos explícitos;
   - `docs/rf17-ola5-plan.md` entra **solo en el commit h**. El texto recibido decía "commitl"; lo leo como el commit h, el de documentación previa al despliegue, que ya lo listaba. Si te referías a otro, dímelo.
9. **I-local, prueba 5:** una universidad o un campus NUEVO aparece en el selector solo al reabrir la app (`fetchCatalogoCampus` corre una vez por sesión); un cambio de nombre se ve con pull-to-refresh. **[Corregido en v3.2: la segunda mitad era incorrecta; ver abajo.]**
10. **K-6b** es una herramienta específica, no un rollback de la `…484`. Tiene el contrato de tres casos de K-6b. Se corrigieron el riesgo 1 y las menciones en D, G y M.
11. **Cierre:** "CERRADA solo después de K-14". El commit j tiene como precondición K-13, y su verificación incluye K-14.
12. **Conteos:** la línea base de `rls.sql` es 529. T37 (77), `probe-registro` (~55) y `probe-admin` (~94) son **diseño**, no contrato. Los definitivos se miden con el `grep` tras implementar y se documentan solo después.

---

## Corrección v3.2 (2026-10-09): cuándo ve la app un cambio de nombre

**Esto corrige una expectativa INCORRECTA del plan, no una regresión de la Ola 5.** Ni la migración `…484`, ni las RPC, ni el panel cambian; tampoco la app móvil (sigue fuera de alcance).

**Qué pasó en I-local:** se renombró "Campus Prueba" a "Campus Prueba Renombrado" desde el panel; la base quedó bien (campus 1334, auditoría 2242 `editar_campus` con `antes {nombre: "Campus Prueba"}` → `despues {nombre: "Campus Prueba Renombrado"}`). Con la app abierta en el Feed, el pull-to-refresh siguió mostrando "Campus Prueba" en el chip.

**Causa (comportamiento existente desde la fase 2B, medido en el código):**
- El chip pinta `etiquetaAlcance(alcance)` → `alcance.campus.nombre` (`src/lib/explorar-state.tsx:67-73`; `src/app/(tabs)/index.tsx:117-120`).
- `alcance` sale del catálogo en memoria, que `fetchCatalogoCampus()` lee **una vez por `userId`** (`explorar-state.tsx:161-174`, con el comentario "Una consulta por sesión: universidades y campus solo cambian desde Studio").
- El pull-to-refresh del Feed solo llama a `refrescar()` de `useListings` (`index.tsx:57-70`, cuyo comentario dice "Categorías y campus no se refrescan aquí").
- Las tarjetas muestran la universidad, no el campus (`src/components/ProductCard.tsx:83`); el campus se ve en Detalle (`detalle/[id].tsx:726-727`).

**Qué estaba mal en el plan:** B.5 decía "Los nombres llegan en los embeds", y el paso 5 de I-local y la enmienda 9 decían "un cambio de nombre se ve con pull-to-refresh". No separaban universidad de campus ni consideraban el chip y el selector, que usan el catálogo de la sesión.

**Qué dice ahora (decisión del usuario, opción A, sin código):**
- **Chip del Feed y Selector de campus:** un nombre nuevo, igual que una universidad o un campus nuevos, se ve **al cerrar y reabrir la app**.
- **Tarjetas:** con pull-to-refresh se ve el nombre nuevo de una **universidad** (si tiene publicaciones en el alcance).
- **Detalle:** el nombre nuevo de un **campus** se ve al abrir una de sus publicaciones.
- Corregidos B.5, el paso 5 de I-local, el contenido del commit h (runbook §2) y la nota de la enmienda 9.

**Prueba a repetir (I-local 5):** cerrar y reabrir la app; el chip del Feed debe decir "Campus Prueba Renombrado".

**Lo que no se hizo:** cambiar la app para que el pull-to-refresh relea el catálogo (opción B). Queda como posible mejora fuera de esta ola: exponer un `recargarCatalogo()` en `explorar-state.tsx` y llamarlo desde `onRefresh` del Feed; pediría distribuir JS nuevo de la app.
