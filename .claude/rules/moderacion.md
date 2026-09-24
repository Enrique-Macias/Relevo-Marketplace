---
paths:
  - "supabase/functions/moderar-contenido/**"
  - "scripts/probe-moderacion.mjs"
  - "scripts/probe-moderacion-http.mjs"
  - "scripts/probe-moderacion-red.mjs"
  - "scripts/probe-moderacion-avatares.mjs"
  - "supabase/migrations/*listing_status_moderacion*.sql"
  - "supabase/migrations/*listings_estados_no_publicos*.sql"
  - "supabase/migrations/*listings_realtime*.sql"
  - "supabase/migrations/*listing_moderacion*.sql"
  - "supabase/migrations/*listings_insert_pendiente*.sql"
  - "src/lib/publicar.ts"
  - "src/lib/storage.ts"
  - "src/lib/moderacion.ts"
  - "src/app/(explorar)/detalle/**"
  - "src/app/(publicar)/**"
  - "src/app/(cuenta)/mis-publicaciones.tsx"
---

# Moderación pre-publicación (RF-18): diseño de implementación

> **Migrado de un plan de Claude Code que vivía en `~/.claude/plans/`, FUERA del
> repo y sin versionar.** No era una decisión de organización: ese archivo
> sobrevive a que se limpie el contexto de una conversación, pero no a cambiar
> de máquina, a borrar `~/.claude/plans/`, ni a una sesión futura a la que nadie
> le dé la ruta. Lo que sigue es el contenido completo de las partes de ese plan
> que no habían aterrizado en ningún otro archivo del repo — ni CLAUDE.md, ni
> código, ni migraciones — al momento de migrarlo (2026-09-18). Donde el plan
> decía "pediste"/"dijiste", se reescribió en tercera persona; el razonamiento
> técnico se conservó tal cual, sin resumir.
>
> **Las decisiones de umbral (los dos niveles de SafeSearch, qué categorías se
> miran, la asimetría de `vendida`/`pausada`, los techos de OCR y de
> `datos_contacto`, la política de avatares) NO están aquí — ya viven en
> `CLAUDE.md` §3, bloque RF-18.** Esas son la SPEC; este archivo es el DISEÑO DE
> IMPLEMENTACIÓN de esa spec: cómo se dispara, quién autoriza, cómo se cablea el
> cliente. Si algo de aquí contradice CLAUDE.md §3, gana CLAUDE.md §3.

## Estado: qué existe en código y qué no

> Actualizado 2026-09-18 (tercera vez el mismo día: Ola 1.6, el camino de
> avatares, cerrada). Las filas que dicen **Hecho** se midieron contra el
> repo, no se recuerdan.

| Pieza | Estado | Dónde |
|---|---|---|
| Función pura de decisión (los 5 ejes, la regla del piso, la asimetría) | **Hecho** | `supabase/functions/moderar-contenido/decision.ts` |
| Lista de palabras prohibidas | **Hecho** | `supabase/functions/moderar-contenido/palabras-prohibidas.ts` |
| Resolución de los dos secretos (`Deno.env.get`, fail-fast) | **Hecho** | `supabase/functions/moderar-contenido/env.ts` |
| `listings` en la publicación de Realtime | **Hecho** | `supabase/migrations/20260917000460_listings_realtime.sql` |
| Los dos frames de espera/rechazo de Publicar + los dos estados de Mis publicaciones/Editar/Detalle | **Hecho** | `design/relevo-app.html`, ver CLAUDE.md §4 |
| Tabla de auditoría del veredicto (RLS, cero policies, cero grants) | **Hecho** | `supabase/migrations/20260918000461_listing_moderacion.sql` + T12 |
| Entrada de la función en `config.toml` (`verify_jwt = false`) | **Hecho** | `supabase/config.toml` |
| Esqueleto de la Edge Function: ruteo por `authMode`, ownership, guard de promoción, escritura de estado + auditoría | **Hecho** | `supabase/functions/moderar-contenido/index.ts` |
| Typecheck propio de la carpeta de funciones | **Hecho** | `npm run check:functions` |
| Particionado, request y parseo de Vision (sin el `fetch`) | **Hecho** | `supabase/functions/moderar-contenido/vision.ts` |
| Schema, body y parseo de OpenAI, refusal incluido (sin el `fetch`) | **Hecho** | `supabase/functions/moderar-contenido/openai.ts` |
| **Eje de Amazon Rekognition, puro**: cuerpo, parseo, techo del eje, y el **firmador SigV4** | **Hecho** (2026-09-21), con los vectores oficiales de AWS en verde | `supabase/functions/moderar-contenido/rekognition.ts` + `decision.ts` |
| **El `fetch` firmado a Rekognition + `descargarFotos()` compartida** | **Hecho y VERIFICADO contra AWS real** (2026-09-22, §6.7): HTTP 200, `Alcohol` 99.9 → `revisar` | `index.ts`, `evaluarRekognition()` / `llamarRekognition()` |
| **El `fetch` real a Vision y a OpenAI** (Ola 1.5) | **Hecho, con credenciales reales puestas** | `index.ts`, `llamarLoteVision()` / `evaluarTexto()` |
| **La descarga desde Storage + `encodeBase64`** | **Hecho** | `index.ts`, `evaluarFotos()` |
| **Armar los `Ejes` + `decidirListing()` + escritura + auditoría, para PUBLICACIONES** | **Hecho, con el guard de promoción probado end-to-end (§6.3)** | `index.ts`, `evaluarListing()` |
| **Enforcement de avatares** (`moderarAvatar()`): descarga, Vision, `decidirAvatar()`, borrado + guard de la carrera | **Hecho, con el guard de la carrera probado end-to-end (§6.4)** | `index.ts`, `moderarAvatar()` |
| Los dos triggers de Storage | **Hecho, verificados en LOCAL y ACTIVOS en remoto** (2026-09-19: los dos secretos de Vault que los encendían están puestos — ver abajo) | `supabase/migrations/20260918000462_storage_moderacion_triggers.sql` + `probe-storage.mjs` §moderación |
| El rework de `publicar.ts` (nace `pendiente`, ya no activa él mismo) | **Hecho** (Ola 3) | `src/lib/publicar.ts`, `src/lib/moderacion.ts` |
| El `with_check` de `listings_insert_own` forzando `pendiente` | **Hecho** (Ola 3) | `supabase/migrations/20260919000463_listings_insert_pendiente.sql` + T25 |
| UI de los estados nuevos (chips, guards, el 4º reparto de Detalle) | **Hecho** (Ola 3) | `mis-publicaciones.tsx`, `editar/[id].tsx`, `detalle/[id].tsx`, `confianza.ts` |
| Las dos pantallas de veredicto | **Hecho** (Ola 3) | `(publicar)/revision.tsx`, `(publicar)/no-aprobada.tsx` |
| Suscripción de Realtime en el cliente | **Hecho** (Ola 3) | `useVeredictoEnVivo()` en `src/lib/moderacion.ts`, consumida por `revision.tsx` |
| `unirFotoDisparadora()`: la foto sin fila SE evalúa | **Hecho** (2026-09-19), verificado con OCR real end-to-end | `vision.ts` + `probe-moderacion.mjs` (pura) + `probe-moderacion-http.mjs` §7 |
| Aviso al usuario cuando su avatar se borra por moderación | **Hecho y VERIFICADO a mano** (Ola 4, 2026-09-21): dos eventos seguidos con fotos distintas y sin reiniciar la app → toast las dos veces, más el control negativo del avatar limpio | `(tabs)/perfil.tsx` + §8 de este archivo + `cuenta-perfil.md` |
| Verificación manual de Realtime (runbook) | **Hecha** (2026-09-21) — los TRES casos de §4.2, incluido el piso con la publicación apagada | §4.2 y §6.2 |
| **La Edge Function desplegada en REMOTO** | **SÍ** — `ACTIVE`. Iba en `version: 1` (2026-09-19) y hoy en **`version: 5`** (2026-09-22), que es la primera con el eje de Rekognition | CLAUDE.md §8, "Hecho" |
| **El eje de Rekognition EN PRODUCCIÓN** | **Hecho** (2026-09-22, §6.8): desplegado a mano y probado a mano; de esa prueba salieron §8b y el primer FP de §9 | `index.ts` + `rekognition.ts` |

**Con esto, `moderar-contenido` modera publicaciones Y avatares reales de
punta a punta, y desde la Ola 2 los dos triggers de Storage la disparan solos al
entrar un objeto** — verificado end-to-end: sobrescribir la foto de una
publicación `activa` la escala a `bloqueada` (§6.5).

**Y AHORA SÍ PROTEGE EN PRODUCCIÓN (2026-09-19).** Este párrafo decía "todavía
no protege nada" porque faltaban los cuatro pasos manuales del runbook de
CLAUDE.md §8 — los cuatro están dados, remedidos contra remoto y no repetidos
de memoria: la Edge Function está **ACTIVE** (`list_edge_functions`,
`version: 1` **en esa fecha** — hoy va en `version: 5`, ver §6.8), `mcp__supabase__list_migrations` da **27**, igual que
`ls supabase/migrations | wc -l` en el repo (**27**, incluida `20260919000463`),
y `select count(*) from vault.secrets where name like 'moderar_contenido_%'`
da **2**. **Y probado de punta a punta en remoto, desde el dev build, los DOS
veredictos**: una publicación de contenido limpio quedó `activa`; una con una
palabra de la lista quedó `bloqueada`. Confirmado en Studio. El detalle vive en
CLAUDE.md §8, "Hecho".

**La deuda de COSTO sigue viva y es independiente de este cierre** (§7/§9 de
este archivo): cada evento de Editar sigue pagando una evaluación completa
sobre el set VIEJO, así que reemplazar 5 fotos sigue costando 10 requests
reales (5 Vision + 5 OpenAI). No se tocó a propósito — es la decisión de costo
que se dejó fuera de alcance al cerrar el hueco de `unirFotoDisparadora()`.

Los ocho casos de verificación que dependían de red real
para publicaciones (4 parcial, 5, 6, 7, 8, 9, 13, y el probe de autorización
re-verificado con evaluación real) están en §6.3; los cuatro de avatares, en
§6.4 — todos con sus controles negativos.

---

## 1. Los dos triggers de Storage

```
publicar.ts ──(1 llamada, al terminar de subir todo)──► moderar ──► activa | pendiente | bloqueada
storage.objects INSERT/UPDATE ──(por objeto)──────────► moderar ──► SOLO escala
```

### Por qué son DOS, y por qué INSERT solo no alcanza

**Ningún camino del cliente sobrescribe hoy.** Verificado en el código, no
asumido:

- `storage.ts:151-153` `rutaFoto()` → `{listing_id}/{uuid}.{ext}`, uuid nuevo.
- `storage.ts:288-290` `rutaAvatar()` → `{user_id}/{uuid}.{ext}`, uuid nuevo — y
  `:282-286` **descarta explícitamente** la ruta estable con `upsert: true`.
- `storage.ts:211-217` es **la única llamada `.upload()` del repo** (grep
  confirmado), compartida por los dos buckets, `upsert: false`, con el
  comentario `:213-215`: una colisión sería un bug nuestro y debe ser error
  visible.
- `storage.ts:293-298` `subirAvatar()` pasa por ese mismo `subirObjeto()`.
- Cero `.update()`, `.move()`, `.copy()`, `upsert: true`, `x-upsert` sobre
  Storage en `src/` y `scripts/`.

**Y aun así INSERT solo no alcanza**, porque lo que importa es lo que ya está
autorizado, no lo que el cliente hace hoy:

1. **`listing-photos` SÍ tiene policy de UPDATE** —
   `listing_photos_objects_update_own`, con `using` y `with_check` (medido en
   `pg_policy`). `probe-storage.mjs` prueba `move` justamente porque es
   alcanzable. La evasión es directa: subir limpio → quedar aprobado →
   sobrescribir con `upsert: true`. Un trigger de INSERT **nunca lo ve**.
2. **`service_role`/Studio saltan la RLS**, así que hasta `avatars` —sin policy
   de UPDATE— se sobrescribe desde Studio, que es donde se revisa la cola.
3. `probe-storage.mjs:286-289` ya advierte que si alguien mete `upsert: true`
   después, la situación de `avatars` "deja de ser cierto **en silencio**". Un
   trigger acotado a INSERT se rompe igual de callado.

**DOS triggers sobre la misma función, no uno con `INSERT OR UPDATE`:** el
`WHEN` de un trigger declarado sobre ambas **no puede referenciar `OLD`**. El
repo ya chocó con esto — `20260912000453:241-259`, explicado en
`CLAUDE.md:511`.

```sql
after insert on storage.objects
for each row
when (new.bucket_id in ('listing-photos', 'avatars'))

after update on storage.objects
for each row
when (new.bucket_id in ('listing-photos', 'avatars')
      and old.version is distinct from new.version)   -- solo si cambió el CONTENIDO
```

### El F-spike, CORRIDO (2026-09-18) — y corrige dos cosas de este archivo

Trigger sonda `AFTER INSERT/UPDATE/DELETE ON storage.objects` registrando
`tg_op`, `old/new.version`, `old/new.metadata->>'eTag'` y `old/new.name`, contra
el Storage API real del stack local. Desmontado al terminar.

| Operación | Bucket / rol | HTTP | `tg_op` | fila | `version` | `eTag` |
|---|---|---|---|---|---|---|
| POST alta | LP / authenticated | 200 | **INSERT** | nueva | — → v1 | — → e1 |
| POST + `x-upsert: true` | LP / authenticated | 200 | **UPDATE** | **la MISMA** (`id` idéntico) | **CAMBIA** | **CAMBIA** |
| PUT (`.update()` de supabase-js) | LP / authenticated | 200 | **UPDATE** | la misma | CAMBIA | CAMBIA |
| `move()` | LP / authenticated | 200 | **UPDATE** | la misma | **CAMBIA** | **IGUAL** |
| POST sin upsert, ruta existente | LP / authenticated | 400 | — | — | *(cero eventos)* | |
| POST + `x-upsert` | LP / **service_role** | 200 | **UPDATE** | la misma | CAMBIA | CAMBIA |
| `move()` | LP / **service_role** | 200 | **UPDATE** | la misma | CAMBIA | IGUAL |
| POST alta | AV / authenticated | 200 | **INSERT** | nueva | — → v1 | — → e1 |
| POST + `x-upsert` | AV / authenticated | **400** `AccessDenied` *"new row violates row-level security policy"* | — | — | *(cero eventos)* | |
| `move()` | AV / authenticated | 400 | — | — | *(cero eventos)* | |
| POST + `x-upsert` | AV / **service_role** | 200 | **UPDATE** | la misma | CAMBIA | CAMBIA |
| `move()` | AV / **service_role** | 200 | **UPDATE** | la misma | CAMBIA | IGUAL |
| DELETE | LP / service_role | 200 | **DELETE** | — | v → — | |

**Salió la PRIMERA de las cuatro salidas que este archivo contemplaba: UPDATE
real sobre la misma fila, `version` distinta.** O sea que el diseño de arriba
—dos triggers, el de UPDATE guardado por `version`— queda como estaba. Cero
DELETE+INSERT.

**Consecuencia directa: el comentario-tripwire de la rama INSERT NO se
escribió.** Este archivo lo pedía *condicionado* a que saliera D+I, para cubrir
una rama UPDATE que habría quedado muerta. No hay rama muerta. Lo que sí quedó
escrito, y fechado, es el resultado del spike, en el encabezado de
`20260918000462_storage_moderacion_triggers.sql` — para que nadie tenga que
volver a correrlo.

**Y el spike DESMINTIÓ lo que este archivo predecía para `move`.** La tabla de
contingencia decía *"`move` no cambia `version` → ninguna arma lo caza, y está
bien: un move no cambia el contenido"*. Es al revés: **`version` sí cambia en un
`move`, así que un move SÍ dispara la rama UPDATE** (lo que no cambia es el
`eTag` — `version` es un id de revisión de la FILA, no un hash del contenido).

**Se deja disparando a propósito, y no se tapa con un guard de `eTag`:** un move
cambia `path_tokens[1]`, o sea que el objeto pasa a colgar de OTRA publicación,
con otro estado y otro dueño. Re-moderarlo es lo correcto, y es coherente con lo
que §1.4 ya decidía para el payload (*"lo que se modera es dónde QUEDÓ el
objeto"*).

**Dos mediciones laterales que cambian cómo hay que LEER el `WHEN`:**

- **El guard `old.version is distinct from new.version` no filtra ningún ruido
  medido hoy.** 3 × `GET /object/authenticated/` y 3 × `/object/info/` →
  **0 eventos**: `last_accessed_at` no se escribe al leer en esta versión de
  Storage. El guard se conserva como **defensa declarada para UPDATEs futuros
  que no cambien el contenido, sin control negativo que lo respalde** — y su
  control negativo corrido lo confirma: quitarlo deja las 21 aserciones de
  `probe-storage.mjs` en verde. Mismo caso, y misma honestidad, que el
  `estado <> 'pausada'` redundante de `listing_photos_objects_select`. No lo
  leas como un filtro con consumidor.
- **`path_tokens` se recalcula en el UPDATE de un `move`** (es columna
  generada): tras mover a `643/sub.jpg`, `path_tokens[1]` = `643`. El payload de
  `NEW` es correcto sin tocar nada.

**Y el punto 2 de "por qué INSERT solo no alcanza" dejó de ser deducción.** Decía
que `service_role`/Studio saltan la RLS y por eso hasta `avatars` —sin policy de
UPDATE— se sobrescribe desde Studio. Medido: como `authenticated`, el upsert
sobre `avatars` muere con `400 AccessDenied "new row violates row-level security
policy"` y **no genera ningún evento**; con la secret key, es un UPDATE normal.
La rama UPDATE de `avatars` existe exactamente para ese llamador.

### El discriminador "¿es alta o reemplazo?", si aun así se quiere (y su trampa)

Existe y es fiable, pero como **dato de observabilidad, no como rama de
decisión** — el §1.2 de arriba ya explica por qué no hace falta ramificar
sobre esto:

```sql
-- listing-photos
exists (select 1 from public.listing_photos where storage_path = new.name)
-- avatars
exists (select 1 from public.users where foto_url = new.name)
```

Funciona por una razón que hay que escribir, porque es prestada: **en los dos
flujos el objeto se sube ANTES de que exista la fila que lo apunta** —
`publicar.ts:352-356` (`subirPendientes`) y recién `:359` (`guardarFotos`);
`perfil.ts:137` (`subirAvatar`) y recién `:139` (`update foto_url`). Por eso,
en el momento del trigger:

- subida genuina → la fila todavía no existe → `false`
- reemplazo de una ruta ya registrada → la fila de la subida anterior sigue
  ahí → `true`

**La trampa:** eso es cierto *solo* por ese orden. Si alguien algún día
escribe la fila primero —por ejemplo al atacar la deuda del objeto huérfano
(ver `publicar-fotos.md`)—, el discriminador se **invierte en silencio** y
toda subida genuina pasa por reemplazo. El orden ya es load-bearing por otro
motivo (`publicar.ts:9-19`, regla 2), así que está protegido por una
invariante existente — pero esa invariante no sabe hoy que la moderación
depende de ella, y eso hay que anotarlo en los dos lados el día que se use.

**Y tiene costo medido:** no hay índice sobre `listing_photos.storage_path`
ni sobre `users.foto_url` (verificado en `pg_indexes`), así que ese `exists`
es un seq scan en cada evento de objeto. Es una razón más para no ponerlo en
el camino de decisión: si se agrega solo para el log, o se acepta el scan en
una tabla chica, o se paga un índice — pero que sea una decisión consciente y
no un `exists` que alguien copió sin pensar.

### El payload del trigger

`entity_id`, **no `listing_id`** — meter un `user_id` en un campo que se llama
`listing_id` es la clase de mentira que muerde tres meses después:

```
{ bucket_id, name, entity_id: path_tokens[1], tg_op, version }
```

Documentar en el propio SQL y en `moderar-contenido/index.ts`: `entity_id` es
`listings.id` cuando `bucket_id = 'listing-photos'` y `users.id` cuando es
`'avatars'`. El discriminador es `bucket_id`, y la función hace el narrowing
en un solo punto de entrada.

`name` y `path_tokens` van **siempre de `NEW`**: un `move` cambia el nombre, y
lo que hay que moderar es dónde quedó el objeto, no de dónde salió.

### `moderarListing()` descartaba ese `name` — **CERRADO** (2026-09-19)

**Medido leyendo `index.ts` al construir Ola 3, no supuesto.** El camino de
`listing-photos` llamaba a `moderarListing(db, Number(entity_id), …)` **sin
pasarle `name`**: `evaluarListing()` re-leía `listing_photos` entera y
evaluaba lo que esa tabla tuviera en ese instante. Y el objeto se sube
**antes** de que exista su fila —`publicar.ts` (`subirPendientes` y recién
`guardarFotos`), `perfil.ts` (`subirAvatar` y recién `update foto_url`)—, que
es el mismo orden que este archivo ya documenta más arriba como load-bearing.
O sea que, en el instante del trigger, **la foto que lo disparó todavía no
tenía fila**. Dos consecuencias, y el fix solo cierra la primera:

- **Esa foto no se evaluaba nunca.** Se evaluaba el set ANTERIOR, y después de
  `guardarFotos()` ya no llegaba ningún evento más. **CERRADO.**
- **Y se paga N veces por evaluar lo viejo.** Editar reemplazando 5 fotos de una
  publicación `activa` o `pausada` = 5 eventos × (1 Vision + 1 OpenAI) = **10
  requests pagos**, todos sobre las fotos que están siendo reemplazadas. **Sigue
  ABIERTO, a propósito** — el fix es el mínimo pedido: unir la foto, no
  debounce ni mover el disparador. Ver §9.

**El camino de AVATARES no lo tenía**: `moderarAvatar()` ya usaba `name` desde
Ola 1.6. La asimetría era la causa raíz.

**El fix: `unirFotoDisparadora()`, pura, en `vision.ts`.** Une el `name` del
objeto que disparó el trigger al set que `listing_photos` ya tiene, sin
duplicar si la fila YA existe (el caso `x-upsert` de §6.5). Vive en `vision.ts`
y no inline en `index.ts` por el mismo criterio que `particionar()`: es lógica
pura, así que `scripts/probe-moderacion.mjs` la cubre de verdad desde Node, sin
red — 4 aserciones (vacío+disparador, set de 3+disparador nuevo, disparador ya
presente sin duplicar, y sin disparador para el camino del cliente). `index.ts`
solo cablea: le pasa `name` en el camino del trigger y nada en el del cliente.

**Verificado end-to-end, con OCR real y no con contenido explícito.** La única
forma de llegar a `bloqueada` por el eje de la FOTO es Vision SafeSearch en
`VERY_LIKELY` — declinado en este repo ni para pruebas (§6.3/§6.4). El acierto
de lista vía OCR tiene TECHO en `pendiente` por diseño (`nivelDeLista()`), así
que la prueba de `probe-moderacion-http.mjs` §7 sube una foto GENUINA
(`upsert:false`, uuid nuevo, **sin fila**, como `storage.ts` de verdad) con
"clonazepam" impreso como texto, y confirma que escala de `activa` a
`pendiente` con ESA foto —no una vieja— en el detalle de auditoría.

**Un hallazgo NUEVO al verificar, sin relación con la lógica del fix: `conSecret`
en §1 usaba un `name` que apuntaba a un objeto INEXISTENTE, y antes de este fix
ese `name` era inerte.** Con la unión ya cableada, esa descarga fallida se
volvía un eje `no_evaluable → 'revisar'` real, escalando la fixture compartida
de `activa` a `pendiente` — y contaminaba las secciones siguientes, que asumían
que seguía `activa`. Se resolvió dándole a esa aserción sus DOS propias
fixtures (`credencialSecret`/`credencialUser`), mismo criterio de aislamiento
que T11b/T21/T23 (CLAUDE.md §3): no reutilizar fixtures entre pasos cuando el
estado avanza.

**Y ESE MISMO síntoma destapó un bug real, sin relación con el fix, que queda
documentado y sin tocar — ver §9, "La promoción de `moderarListing()` puede
reventar con 500".**

**Por qué no se vio antes de Ola 3, y es la lección:** la prueba end-to-end de
§6.5 usaba `x-upsert` para sobrescribir una ruta **existente** —que sí tiene
fila—, así que el único caso medido era justo el único donde coincidía. Un alta
genuina nunca la tiene: `storage.ts` sube siempre con `upsert: false` y uuid
nuevo.

**Publicar NO está afectado, ni antes ni después del fix**: el skip de
`pendiente` corta antes del `net.http_post`, así que los N eventos del alta
cuestan cero y el alta entera son **2 requests** (1 Vision con todas las fotos
en un lote + 1 OpenAI).

### El trigger se salta las publicaciones en `pendiente` — la razón es una carrera real

**La llamada final (desde `publicar.ts`) evalúa TODO — texto + todas las
fotos. El trigger se salta las publicaciones que están en `pendiente`.**

La opción que parecía más barata era "la llamada final solo evalúa el texto y
lee el estado de la fila como piso, confiando en que el trigger ya evaluó las
fotos". **No cierra, por una carrera real:** `pg_net` es fire-and-forget y la
función tarda segundos en Vision. Secuencia:

```
foto 5 (sucia) sube → trigger → pg_net → función arranca (lenta)
        ⋮ mientras tanto
cliente termina → llamada final → texto limpio → piso = pendiente → promueve a ACTIVA
        ⋮ después
la función de la foto 5 termina → escala activa → bloqueada
```

La publicación estuvo pública en el intervalo. Es exactamente el hueco que la
llamada explícita existía para evitar, movido de sitio.

**El cierre limpio:** una publicación en `pendiente` ya va a ser evaluada
entera por la llamada final que viene en camino, así que el trigger no tiene
nada que aportar ahí. El trigger existe para contenido que **no** está en un
flujo de alta activo: fotos agregadas a una publicación ya decidida (`activa`,
`pausada`, `bloqueada`), avatares, y subidas directas al Storage API.

```
si bucket_id = 'listing-photos':
    si (select estado from listings where id = entity_id) = 'pendiente' → return
    -- la llamada final la va a evaluar completa; no dupliques Vision ni corras carreras
si bucket_id = 'avatars': siempre evalúa
```

Va **en el cuerpo del trigger, antes del `net.http_post`** — no en el `WHEN`,
porque un `WHEN` de trigger no admite subconsultas. Es un lookup por PK dentro
de la misma transacción, y ahorra la llamada HTTP entera.

Tres consecuencias:

- **Sin doble costo de Vision en el camino feliz**: durante el alta el
  trigger no hace nada.
- **Sin carrera**: nada compite con la llamada final.
- **Falla segura si la llamada final nunca llega** (el usuario abandona, la
  app muere): la fila se queda en `pendiente`, que no es público, y el
  revisor humano la ve. El default es el estado seguro.

La **regla del piso** (CLAUDE.md §3: el estado actual nunca baja de nivel)
sigue aplicando igual, como segunda línea: la función lee el estado actual y
nunca lo baja. Es lo que hace que este caso dé el resultado correcto: escalada
a `bloqueada` por el trigger, seguida de una llamada final con texto limpio →
**sigue `bloqueada`**. Probado en `decidirListing()`, caso #8 de la tabla de
verificación (§6 de este archivo).

---

## 2. Autorización de la Edge Function

Dos llamadores con necesidades distintas sobre la misma función: el cliente
(JWT de usuario) y el trigger (`apikey` con la secret key). `send-push` solo
tiene el segundo, por eso usa `withSupabase({ auth: 'secret' })`.

**E-spike resuelto (2026-09-17), y sale mejor de lo previsto.** Medido sobre
`@supabase/server@1.7.0` (bajado con `npm pack` a un temporal y leídos sus
`.d.mts`; el paquete no está en disco porque el import es `npm:` sin
vendorizar):

- **`auth` acepta una LISTA ORDENADA, probada de izquierda a derecha:**
  `type AuthConfig = 'none' | CredentialedAuthMode | [CredentialedAuthMode,
  ...]`. O sea que **`auth: ['secret', 'user']` es nativo** — aparece tal
  cual en los ejemplos del propio tipo. No hay que escribir ningún chequeo de
  JWT a mano, y **se cae la alternativa de la RPC + dos secretos más en
  Vault**.
- **`ctx.authMode` dice QUÉ modo autorizó la request.** Esto es mejor que un
  detalle de comodidad: es el punto de enforcement limpio para la asimetría
  del §1 de este archivo — `authMode === 'secret'` es el trigger (**solo
  escala**), `'user'` es el cliente (**el único que puede promover a
  `activa`**). Sin eso habría que inferir el llamador de la forma del
  payload, que es adivinar.
- `ctx.userClaims` / `ctx.jwtClaims` traen la identidad en el modo `'user'` —
  necesarias para verificar que quien pide moderar su publicación es su
  dueño.
  **Corrección medida (2026-09-18), y el E-spike NO alcanzaba a darla:** son
  dos objetos con formas DISTINTAS, y el que se usa es `userClaims`, cuyo campo
  es **`id`**, no `sub`:

  ```
  ctx.userClaims → { id, role, email, appMetadata, userMetadata }
  ctx.jwtClaims  → { iss, sub, aud, exp, iat, email, role, session_id, … }
  ```

  Escribir `ctx.userClaims?.sub` typechea (el shim deja `ctx` sin tipar) y
  falla en runtime como `401 "sin identidad en el JWT"` — un síntoma que se
  lee como problema de credenciales. Lo destapó la primera corrida de
  `scripts/probe-moderacion-http.mjs`. El caso general —confirmar que un campo
  existe no es confirmar su forma— quedó en CLAUDE.md §9.
  Dato lateral confirmado en la misma medición: el JWT local es **ES256 con
  `kid`**, o sea que el modo `'user'` sí resuelve por JWKS y no por el secreto
  compartido; y en modo `'secret'`, `ctx.authKeyName` vale `"default"`.
- `ctx.supabase` (con RLS del invocante) y `ctx.supabaseAdmin` (la saltea)
  vienen los dos hechos.
- Hay `JwksFetchFailedError` / `JwksNotConfiguredError`, o sea que el modo
  `'user'` **verifica el JWT de verdad contra JWKS**, no lo cree. Eso es lo
  que hace que `verify_jwt = false` en `config.toml` siga siendo correcto y
  siga significando lo que CLAUDE.md §9 dice: *"no es 'función abierta'; la
  autorización la hace la función."*

Queda entonces: **una función, `verify_jwt = false`,
`auth: ['secret', 'user']`**, y la rama de permisos decidida por
`ctx.authMode`.

**El import va PINEADO a `npm:@supabase/server@1.7.0`, y `send-push` NO lo
está** (`send-push/index.ts:22` importa `npm:@supabase/server` a secas, así que
Deno resuelve la última versión al desplegar). No es simetría rota por descuido:
todo el reparto de permisos de esta función descansa en dos propiedades del
contrato de ese paquete —que `auth` acepte un arreglo y que `ctx.authMode`
exista—, las dos verificadas leyendo los `.d.mts` publicados, y un major futuro
podría cambiarlas sin que nada en el repo lo note. `send-push` solo usa
`auth: 'secret'`, que es la forma más vieja y estable del API, así que su
exposición es menor.

**Pendiente, con disparador:** pinear también el de `send-push`. **Revisar
cuando:** se toque `send-push` por cualquier motivo, o salga un major de
`@supabase/server`. **Fix:** agregarle `@<version>` al specifier, en un cambio
propio — no se metió aquí para no mezclar un cambio a la función de push dentro
de una tarea de moderación. Ojo con el efecto colateral: `supabase/functions/shims.d.ts`
declara los DOS specifiers (con y sin versión) porque para TypeScript son
módulos distintos; al pinear `send-push`, el `declare module
'npm:@supabase/server'` sin versión se queda sin consumidor y hay que borrarlo.

---

## 3. Concurrencia dentro de la función — NI `Promise.all` de N fotos, NI secuencial

Con "el cliente espera el veredicto" decidido (§4 de este archivo), la
latencia de la función pasa a estar en el camino crítico de publicar, así que
importa de verdad. La pregunta no es "¿paralelo o secuencial?" — es que
ninguna de las dos es la forma correcta de llamar a Vision.

**Las fotos van en UNA sola llamada a Vision en el caso normal, no en N — pero
la llamada se PARTE por tamaño acumulado, y eso no es opcional.** El endpoint
`images:annotate` de Vision acepta un ARRAY de `AnnotateImageRequest` en el
mismo POST — una entrada por foto, cada una pidiendo `SAFE_SEARCH_DETECTION` +
`TEXT_DETECTION` (el OCR) a la vez — y devuelve un array de resultados, uno
por foto, en una sola respuesta. Eso es literalmente lo que la API está
diseñada para hacer con varias imágenes del mismo request lógico; no es una
optimización propia, es el uso documentado del endpoint. `Promise.all` de 5
`fetch` sueltos pagaría 5 round-trips y 5 veces el overhead de conexión de un
worker de Deno por nada — el batch da el mismo resultado en una sola ida y
vuelta.

**La corrección** (esta sección decía "UNA sola llamada" a secas, y era
imprecisa): Vision documenta TRES topes en `docs.cloud.google.com/vision/quotas`
—*"Images per `images:annotate` request: 16"*, *"Image file size: 20 MB"*,
*"JSON request object size: 10 MB"*— y **el que muerde es el tercero**. base64
infla ~4/3, así que el presupuesto real de bytes crudos por request es ~7.4 MB,
mientras que el bucket permite 5 MiB por foto y hasta 5 fotos: el peor caso son
25 MiB crudos ≈ 33 MB de JSON, **3.3× por encima del límite**.

En la práctica `normalizar()` (`foto-picker.ts`) deja cada foto en cientos de
KB y el caso normal cabe holgado en un solo request. Pero la función también va
a ver fotos que nunca pasaron por ahí: subidas directas al Storage API (deuda
documentada en `publicar-fotos.md`), Studio, y filas viejas. De ahí el
particionado: acumular hasta **6 MB de bytes crudos** (headroom bajo los ~7.4)
o **16 imágenes**, lo que ocurra primero. Una foto que por sí sola pase de 6 MB
va en su propio lote; si además supera el tope de 20 MB por imagen, se trata
como eje no evaluable (§6). O sea que el particionado casi nunca se activa —
pero sin él, una publicación con fotos pesadas no falla "un poco": el request
entero lo rechaza Vision.

**IMPLEMENTADO en `vision.ts` (2026-09-18), y con el umbral VERIFICADO en vez
de justificado en prosa.** Lo que antes era "6 MB con headroom bajo los ~7.4"
ahora tiene aserción: `tamanoBase64()` devuelve el largo EXACTO (`ceil(n/3)*4`,
comparado contra `Buffer.toString('base64')` en el probe, no una constante de
1.33 redondeada que subestimaría), y el probe comprueba que un lote lleno a
6 MiB codifica a 8,388,608 caracteres — **2.00 MB de holgura** bajo el tope de
10 MB, suficiente para el andamiaje del JSON que no entra en el conteo de bytes
crudos. Su control es que 8 MiB **no** cabrían, para que el margen no pase por
casualidad.

**Dos cosas que el particionado hace y que no se ven en la descripción de
arriba**, las dos con control negativo propio:

- **Una foto sobre el tope por imagen no se descarta: sale por
  `demasiadoGrandes`**, para que el llamador la cuente como no evaluable.
  Filtrarla sería el fallo silencioso de §6 movido de sitio.
- **El corte lleva un `actual.length > 0`, y lo que pasa sin él está medido.**
  No es lo que la primera versión de este código afirmaba (que el bucle "no
  termina nunca"): el bucle termina igual, y lo que sale es un **lote vacío** al
  frente —`[0, 1, 1]` en vez de `[1, 1]`— o sea un request a Vision con cero
  imágenes. Solo ocurre cuando la PRIMERA foto es la que no cabe, que es
  exactamente el caso que las pruebas no cubrían: el control negativo del guard
  **no hizo fallar nada** hasta que se agregó ese caso. Hoy lo vigilan tres
  aserciones, una de ellas un barrido de 216 combinaciones de tamaños que exige
  que ningún lote salga vacío nunca.

**El texto (GPT) corre EN PARALELO con ese batch, no después.** No hay
dependencia entre los dos: GPT evalúa título+descripción, que el cliente ya
mandó completos; no necesita nada que salga de Vision. Y el texto de OCR **no
pasa por GPT** (CLAUDE.md §3) — solo se compara contra la lista, en local,
después de que Vision responde. O sea que la forma real es:

```ts
const [vision, gptTexto] = await Promise.all([
  llamarVisionBatch(fotos),        // 1 HTTP call, N imágenes, 2 features cada una
  llamarGPT(titulo, descripcion),  // 1 HTTP call
]);
// coincidencias(ocr) y nivelDeTexto(gptTexto) son síncronos, en local —
// decision.ts no hace red.
```

### 3.2. La forma CAMBIÓ al entrar Rekognition (2026-09-21)

**Rekognition NO batchea: `DetectModerationLabels` es una imagen por llamada**,
al revés de `images:annotate`, que acepta un arreglo. No es una elección de
diseño nuestra, es la forma del API. O sea que N fotos son N llamadas, en
paralelo.

Y las dos APIs de imagen necesitan **exactamente los mismos bytes**, así que
bajarlos dos veces pagaría el doble de latencia de Storage por nada. Ese es el
único motivo por el que la descarga se extrajo de `evaluarFotos()` a
`descargarFotos()` propia:

```ts
const [imagen, resultadoTexto] = await Promise.all([
  (async () => {
    const { descargadas, fallosDeDescarga } = await descargarFotos(db, paths, bucket);
    return await Promise.all([
      evaluarFotos(config, descargadas, fallosDeDescarga),        // Vision, lotes
      evaluarRekognition(config, descargadas, fallosDeDescarga),  // N llamadas
    ]);
  })(),
  evaluarTexto(config, titulo, descripcion),
]);
```

Latencia = `max(descarga + max(vision, rekognition), gpt)` — nada secuencial
nuevo en el camino del cliente, que espera el veredicto (§4).

**`moderarAvatar()` usa los dos pasos pero NO llama a Rekognition**, y eso es
decisión de producto, no una omisión: drogas/alcohol/gambling es una señal de
CATÁLOGO, no de foto de perfil, y `decidirAvatar()` borra de forma
irreversible — un falso positivo ahí no tiene cola donde caer.

**Los TRES caminos de falla segura del eje nuevo**, ninguno propaga excepción
y todos terminan en `'revisar'`, nunca en `'limpio'`:

1. La llamada falla (red, throttling, credenciales, firma mal hecha).
2. **`InvalidImageFormatException`** — Rekognition acepta **solo JPEG y PNG**
   y el bucket permite además `webp`. Hoy no es alcanzable desde la app
   (`normalizar()` entrega siempre JPEG) y **está medido**: las 46 fotos reales
   del bucket remoto son `.jpg`, cero webp y cero png. Sí es alcanzable desde
   una subida directa al Storage API o desde Studio.
3. **`ImageTooLargeException`** — el tope de bytes CRUDOS es **5 MB decimales**
   y el bucket corta en **5 MiB (5,242,880)**, así que existe una franja real
   donde una foto pasa el bucket y no pasa a Rekognition. Se detecta ANTES de
   gastar la llamada, con `MAX_BYTES_REKOGNITION`.

Latencia esperada: `max(vision, gpt)`, no la suma de las dos ni la suma de 5
llamadas a Vision. **Esto es una estimación, no una medición** — al migrar
esto no había función corriendo todavía para cronometrarla contra las APIs
reales. Se mide de verdad cuando exista `index.ts`, contra Vision y OpenAI con
imágenes reales, y ese número —no esta estimación— es el que confirma si el
copy de espera de "Publicar (revisando)" (CLAUDE.md §4) alcanza en la
práctica.

### 3.1. OpenAI: Responses API, y las dos preguntas que el plan dejó abiertas

**Se usa el Responses API (`POST /v1/responses`) con `text.format`, NO Chat
Completions con `response_format.json_schema`.** La razón no es preferencia por
lo nuevo: la guía vigente de Structured Outputs documenta **únicamente** el
Responses API y no cubre la variante de Chat Completions en absoluto.
Implementar contra aquella sería implementar contra una forma que la doc actual
ya no describe.

Las dos preguntas que el plan marcó como "no verificado, a confirmar al
escribirlo", resueltas contra la doc (2026-09-18):

- **¿`model` es obligatorio?** Aparece en TODOS los ejemplos de la guía y no
  hay ningún modelo por default documentado. La *referencia* del endpoint no lo
  lista entre los parámetros del body —artefacto de cómo está redactada esa
  página, tal como el plan sospechó—, así que la doc no permite cerrarlo del
  todo sin llamar a la API. **Resolución práctica: se manda siempre**, con lo
  que la ambigüedad deja de importar.
- **¿Qué forma toma `input`?** Acepta **un string suelto O un arreglo de
  mensajes** (`"optional string or array of EasyInputMessage…"`). Se usa el
  arreglo `system` + `user`, que es la forma canónica de los ejemplos **y** la
  que separa las instrucciones del texto del vendedor — que es entrada no
  confiable, escrita por cualquiera con cuenta. Concatenarla en el prompt de
  sistema es el camino directo a que alguien escriba "ignora las instrucciones
  anteriores" en su descripción. El Structured Output pone el segundo candado:
  la FORMA de la respuesta la fija el schema, así que ni una inyección exitosa
  puede hacer que el modelo conteste otra cosa que los seis grados; lo que sí
  podría mover son los VALORES, y por eso la lista de palabras corre aparte en
  local sobre el mismo texto, con `peor()` garantizando que ninguna señal
  absuelve a la otra.

`text.format` lleva las cuatro claves como HERMANAS —`{ type: 'json_schema',
name, schema, strict }`—, no `schema` anidado dentro de otro objeto.

**IMPLEMENTADO en `openai.ts` (2026-09-18).** Tres cosas que no se ven en el
diff y que tienen control negativo propio:

- **El schema se deriva de un `Record<keyof VeredictoTexto, …>`, y ESA
  anotación es el amarre** entre lo que se le pide a OpenAI y lo que
  `nivelDeTexto()` consume. Agregar una categoría al tipo y no al schema (o al
  revés) **no compila** — medido con las dos variantes. Sin ella se
  desincronizan en silencio: OpenAI devolvería un objeto sin la categoría
  nueva, `nivelDeTexto()` leería `undefined`, y `deGrado(undefined)` cae en la
  rama de `'ninguno'`, o sea que una categoría recién agregada nunca marcaría
  nada. `required` también se deriva de las mismas claves y no se escribe
  aparte, porque `strict` rechaza el schema entero si las dos listas no
  coinciden — un fallo que aparecería recién en producción.
- **El probe verifica que las seis categorías MUEVAN el veredicto**, no solo
  que estén en el schema. Es una aserción distinta de las de forma: caza una
  categoría declarada que nadie consume, que sería una señal que el modelo
  reporta y nosotros tiramos sin ningún error a la vista.
- **La validación de forma al parsear no sobra aunque `strict` la prometa.** El
  modo estricto garantiza la forma del lado de OpenAI; el parseo corre del lado
  nuestro, y confiar en la promesa significa que un cambio de API, un modelo
  mal configurado o una respuesta truncada entren como `undefined` en los seis
  campos — que `deGrado` lee como `'ninguno'`. O sea: **una respuesta rota se
  leería como texto limpio**, el fallo silencioso más caro posible en ese
  archivo. Control negativo corrido: sin la validación, un veredicto al que le
  falta una categoría pasa.

### Los secretos de Vision y OpenAI — ya resuelto en código, no solo aquí

`supabase secrets set` + `Deno.env.get()`, **no Vault** — motivo estructural:
Vault existe en este repo porque el lector es **plpgsql**
(`private.notify_push()` no tiene entorno de proceso). Aquí el lector es el
worker de Deno, que sí lo tiene. Meterlos en Vault obligaría a un roundtrip a
la base desde la función y a abrir lectura sobre `vault.decrypted_secrets`,
que `rls.sql:2189-2192` hoy prohíbe.

Los dos nombres ya están decididos y grabados en código, en
`supabase/functions/moderar-contenido/env.ts` — `GOOGLE_CLOUD_VISION_API_KEY`
(sin convención previa que seguir, así que explícito y sin abreviar) y
`OPENAI_API_KEY` (este sí tiene razón técnica: es el nombre que el SDK
oficial de OpenAI lee por default si no se le pasa `apiKey` al construir el
cliente). `resolverConfig()` falla ruidosamente al ARRANCAR si falta
cualquiera de los dos, con los dos nombres en el mismo mensaje si faltan
ambos — mismo criterio de "nada falla en silencio" que el resto del repo
(CLAUDE.md §9). El runbook del `supabase secrets set` vive junto a los dos
`vault.create_secret` de `CLAUDE.md:1358-1363` — paso manual, como aquellos.
Plantilla para desarrollo local: `supabase/functions/.env.example`.

`env.ts` es Deno-only (usa el global `Deno`) y por eso vive separado de
`decision.ts`/`palabras-prohibidas.ts`: `probe-moderacion.mjs` no puede
importarlo como a esos dos. Verificado solo parcialmente al escribirlo — el
módulo carga sin error de sintaxis en Node y `resolverConfig()` falla
exactamente con `ReferenceError: Deno is not defined` al llamarse fuera de
Deno, lo que confirma la forma del archivo pero NO el comportamiento real
contra Deno, porque `deno` no está instalado ni en el host de desarrollo ni
en el contenedor del edge runtime local. La verificación real espera a
`supabase functions serve`.

**CONSECUENCIA OPERATIVA DE QUE `resolverConfig()` CORRA A NIVEL DE MÓDULO, y
es la que muerde primero al ir a probar:** la función **no arranca** sin los dos
valores puestos. No es que falle la moderación — es que el worker ni sube, así
que los casos de verificación 1-3 (las cinco llaves, ownership, "el trigger no
promueve"), que no tocan Vision ni OpenAI para nada, tampoco se pueden correr.
Para probar la autorización basta con poner valores CUALQUIERA en
`supabase/functions/.env`; no hace falta una credencial real todavía. Está así
a propósito y no se va a "arreglar" haciendo la lectura perezosa: el docblock de
`resolverConfig()` promete fallar al arrancar y no a media petición, que es lo
que evita reventar a la mitad de moderar una publicación real.

**Nota histórica, ya superada — se deja para que quede el razonamiento del
diseño de falla segura, no como estado actual.** `index.ts` empezó como
ESQUELETO (2026-09-18, primera mitad del día): ruteo, ownership, el guard de
`esPromocion()` y la escritura de estado ya estaban, pero `evaluarListing()` y
`moderarAvatar()` eran stubs. **Los stubs fallaban seguro en la dirección de
cada camino, y las dos direcciones eran opuestas a propósito:** una
publicación sin evaluar reportaba todos los ejes como `'revisar'` y
terminaba en `pendiente` (inútil pero nunca peligrosa — un stub que
devolviera `'limpio'` habría publicado sin mirar); un avatar sin evaluar se
CONSERVABA, porque `decidirAvatar()` solo borra con `bloquear` y un stub que
borrara habría sido destructivo e irreversible. **Los dos dejaron de ser
stubs el mismo día** (Ola 1.5 para `evaluarListing()`, §6.3; Ola 1.6 para
`moderarAvatar()`, §6.4) — la asimetría de diseño que este párrafo describe
sigue siendo real (`decidirAvatar()` no cambió), solo que ya no hace falta
un stub para que se cumpla: la implementación real la hereda directo.

Ya no aplica la nota de que `tsconfig.json` deja esta carpeta sin cubrir:
**`npm run check:functions`** la typechea desde 2026-09-18, con su propia config
de Deno (`supabase/functions/tsconfig.json` + `shims.d.ts`). En su primera
corrida encontró un error de tipos real y preexistente en `env.ts` — el caso
general quedó en CLAUDE.md §9. Alcance honesto: no verifica el contrato de
`@supabase/server`, que el shim declara sin tipar a propósito.

---

## 4. Entrega del veredicto al cliente

**Decisión posterior a la aprobación original del plan (2026-09-18): el
cliente ESPERA el veredicto.** `publicar.ts` hace `await` de la Edge Function
y el estado final viene en el body, así que en el camino feliz el usuario
navega directo a "Publicación creada" como hoy. Eso **degrada Realtime a
fallback** —solo para cuando la llamada expira o la app se fue a
background—, coherente con el criterio que ya regía antes de RF-18 ("Realtime
es la vía rápida; el refetch es el que garantiza", ver abajo). La migración de
la publicación de Realtime (§4.1 de este archivo) siguió haciendo falta y no
fue prematura: el fallback la necesita. Lo que cambió con esta decisión fue el
inventario de frames: **dos nuevos** ("En revisión", "No aprobada"), no un
frame de tres estados en vivo — ya construidos, ver CLAUDE.md §4.

### 4.1. Realtime sí, y revierte parcialmente una decisión escrita dos veces

`src/lib/notificaciones.ts:165` y `notificaciones-push.md:44` descartaron
Realtime con estas palabras: *"sería una suscripción abierta toda la sesión
para un dato que cambia un puñado de veces al día"*.

Este caso es **la forma opuesta**, y por eso la excepción se sostiene: una
suscripción a **una fila** (`filter: 'id=eq.<listingId>'`), abierta
**segundos**, mientras una pantalla concreta está montada, para un dato que
cambia una vez y que el usuario está esperando mirando la pantalla. No es
ambiente, es una respuesta.

La migración `20260917000460_listings_realtime.sql` ya existe y su propio
comentario documenta el argumento de arriba y los tres puntos server-side que
NO hacían falta (RLS nueva, `REPLICA IDENTITY full`, policies sobre el
esquema `realtime`). **Lo que sigue sin estar en ningún archivo del repo son
los requisitos del lado del CLIENTE**, porque no hay ningún componente todavía
que se suscriba:

1. **Suscribir desde un efecto de componente, NUNCA desde
   `onAuthStateChange`** — `session.tsx:105-117` documenta un deadlock
   conocido de supabase-js con cualquier llamada async dentro de ese
   callback.
2. **`removeChannel` al desmontar.** Sin esto se vuelve literalmente lo que
   las dos decisiones de `notificaciones.ts`/`notificaciones-push.md`
   rechazaron: una suscripción que sobrevive más de lo que debería.
3. **Gate por token**, mismo patrón ya existente en `ListingPhoto.tsx:60`:
   sin `session.access_token` no se intenta.
4. **Fallback OBLIGATORIO, no opcional.** Realtime es best-effort: el socket
   puede no conectar, y `supabase.ts:111-117` solo refresca el token en
   foreground (`jwt_expiry = 3600`), así que en background se cae. El piso es
   `useFocusEffect` + refetch — que además es el patrón vigente del repo
   (`mis-publicaciones.tsx`, `perfil.tsx`). **Realtime es la vía rápida; el
   refetch es el que garantiza.**

**Descartado, y por qué:** una fila en `notifications` en vez de Realtime.
Pediría un valor nuevo en `notification_type` (otro `ALTER TYPE` partido en
dos migraciones, como `20260917000458`/`:459`) y el push **hoy no entrega**
—las credenciales FCM/APNs siguen pendientes (CLAUDE.md §8, "Pendiente")—, así
que sería infraestructura nueva para una entrega que de todos modos no
llegaría todavía.

**Los cuatro requisitos están CUMPLIDOS desde la Ola 3**, en
`useVeredictoEnVivo()` (`src/lib/moderacion.ts`), que es la única llamada a
`.channel()` del repo. Lo que se sumó en Ola 4 es un quinto que no estaba
escrito y que hace falta para poder verificar el cuarto:

5. **El canal tiene que poder GRITAR que no conectó.** `.subscribe()` acepta un
   callback `(status, err)` con cuatro valores
   (`REALTIME_SUBSCRIBE_STATES`: `SUBSCRIBED`, `TIMED_OUT`, `CLOSED`,
   `CHANNEL_ERROR`) y se estaba llamando sin él. Con el requisito 4 funcionando,
   eso vuelve **indistinguible** un canal muerto de uno sano: el veredicto llega
   igual, por el refetch. Los dos primeros salen por `console.warn`; los otros
   dos por `console.log`, y `CLOSED` es además lo que hace observable el
   requisito 2 (un `CLOSED` por cada `SUBSCRIBED` = no quedó canal abierto).
   Se imprime también **por qué vía** llegó cada veredicto: sin eso, "llegó" y
   "Realtime funciona" son la misma frase. Los logs no se devuelven desde el
   hook —`revision.tsx` no los pintaría, y un campo sin consumidor es lo que
   este repo evita— ni van gateados por `__DEV__`: eso haría que el dev build y
   el de tienda se comporten distinto justo en el camino que se está
   verificando. Medido: nada strippea `console.*` aquí (no hay
   `babel.config.js`, ni `metro.config.js`, ni `transform-remove-console`, y
   `drop_console` no aparece en `@expo/metro-config`/`metro-config`/
   `babel-preset-expo`) — pero tampoco hay recolector de logs, así que en
   release solo los lee quien enchufe el aparato a Xcode o a `adb logcat`.

**No hace falta tocar la propagación del token a Realtime.** `supabase-js`
llama solo a `realtime.setAuth(token)` en `INITIAL_SESSION`/`SIGNED_IN`/
`TOKEN_REFRESHED` (`node_modules/@supabase/supabase-js/dist/index.mjs`,
`_handleTokenChanged`), que es exactamente con lo que el gate por
`session.access_token` del requisito 3 es consistente.

### 4.2. El runbook de verificación de Realtime (manual, por CLAUDE.md §6)

**Cómo llegar a la pantalla.** El camino real —publicar algo que caiga en
`pendiente`— cuesta 2 requests a Vision/OpenAI y **no es determinista**: los
ejes con techo en `pendiente` (OCR, `datos_contacto`) pasan por GPT (§6.3), así
que puede aterrizar en "Publicación creada". El camino determinista y gratis es
poner `estado = 'pendiente'` a mano en Studio sobre una publicación propia y
abrir la pantalla por deep link con el scheme de `app.json`:

```bash
# iOS — el único entorno disponible hoy
xcrun simctl openurl booted "relevomarketplace:///revision?id=<ID>"
# Android — cuando exista el dev build
adb shell am start -W -a android.intent.action.VIEW -d "relevomarketplace:///revision?id=<ID>"
```

El grupo `(publicar)` no aparece en la URL (son route groups, el mismo hecho que
causó la colisión de `index.tsx` de `notificaciones-push.md`), y la pantalla
solo lee `id` de los params.

**Plataformas: hoy iOS y solo iOS, y no es una omisión.** El repo tiene carpeta
`ios/` y **no tiene `android/`** — nunca se corrió un prebuild de Android en
esta máquina. Y para ESTE runbook alcanza, a diferencia de otros pendientes:
lo que se ejercita (el websocket de Realtime, `useFocusEffect`, `removeChannel`)
es JS puro de supabase-js y Expo Router, sin ningún módulo nativo de por medio.
Es lo contrario del pendiente del header `Authorization` de `expo-image`
(`publicar-fotos.md`), que SÍ exige un Android real porque el bug vive en
Fresco, y del de push (CLAUDE.md §8), que exige credenciales por tienda.

| Caso | Qué se hace | Qué debe verse |
|---|---|---|
| 1 — camino feliz | con la pantalla abierta, mover `estado` a `'activa'` desde Studio; repetir con `'bloqueada'` | navega a "Publicación creada" / "no aprobada" **sin tocar la app**, y el log dice **`por REALTIME`** |
| 2 — el piso, con Realtime apagado | `alter publication supabase_realtime drop table public.listings` **en LOCAL**, repetir el caso 1, salir de la pantalla y volver | el estado NO llega solo; al reenfocar sí navega, y el log dice **`por REFETCH`** |
| 3 — el cleanup | entrar y salir de la pantalla varias veces | un `CLOSED` por cada `SUBSCRIBED`; si se acumulan `SUBSCRIBED` sueltos, el canal quedó abierto |

**Lo que hace que el caso 2 no pase por la razón equivocada:** el
`select * from pg_publication_tables where pubname='supabase_realtime'` **antes
y después** del `alter`, y que el log siga diciendo **`SUBSCRIBED`**. Quitar la
tabla de la publicación no hace fallar la suscripción —el canal conecta igual,
solo deja de entregar—, así que un `CHANNEL_ERROR` ahí significaría otra cosa, y
un `por REALTIME` significaría que el `drop` no se aplicó. Es literalmente el
consejo de CLAUDE.md §9: imprimir QUÉ se está comparando contra QUÉ antes de
confiar en un verde. Restaurar con `alter publication supabase_realtime add
table public.listings` en el mismo paso, y **nunca sobre la publicación de
REMOTO**.

---

## 5. Rework de `publicar.ts` — diagnóstico de impacto completo

> **HECHO (Ola 3, 2026-09-19).** Lo que sigue es el diagnóstico con el que se
> construyó, conservado porque explica POR QUÉ cada pieza quedó como quedó. Dos
> correcciones a la tabla de abajo, medidas contra el código al ejecutarlo:
> **las firmas de tipo eran SIETE, no cinco** —le faltaban `ListingDetalle.estado`
> (sin abrirla, el guard nuevo de Editar ni compila) y `accionVenta()`—, y
> **`detalle/[id].tsx` no estaba en la tabla** aunque el diseño ya tenía su
> cuarto reparto del `.sticky-cta` y se llega ahí con un tap desde "Mis
> publicaciones". Las dos entraron en el mismo cambio.

**La regresión #1 ya está armada y esperando**, aunque nadie haya tocado
`publicar.ts` todavía. `20260917000459` metió `pendiente`/`bloqueada` en el
`not in` de `listings_update_own`. En el instante en que la fila nazca
`pendiente`, `publicar.ts:366` afecta 0 filas → `ListingNoEditableError`
(`listings.ts:697`) → `falloGeneral` (`publicar.ts:372`) → el usuario ve *"no
pudimos guardar los cambios, puede ser tu conexión"* y un botón **"Reintentar"
que no funcionará nunca**. Es decir: en cuanto el `with_check` del INSERT se
apriete a `'pendiente'` (§5.2 más abajo) sin haber hecho este rework primero,
publicar queda roto.

| Pieza | Dónde | Qué le pasa | Cómo se adapta |
|---|---|---|---|
| **Modelo atómico** | `publicar.ts:286-291` | **Sobrevive, reforzado.** Nace `pausada` para no ser visible mientras faltan fotos; `pendiente` da lo mismo vía `…459:46`. | Literal a `'pendiente'`; reescribir el docblock (ya no son dos estados y el final no siempre es `activa`). |
| **Paso de activación** | `publicar.ts:366` | **Se borra.** | Lo reemplaza la llamada a `moderar-contenido`. El orden con `guardarFotos()` (`:363-365`) sigue sin ser negociable. |
| **Reintento** | `publicar.ts:233-280`, `:345-376` | **Casi intacto.** No toca `estado`; la idempotencia (`:341-343`) se mantiene y es justo lo que hace que "Reintentar" siga siendo seguro con moderación de por medio. | Reintentar ahora puede significar "volver a pedir moderación". La llamada debe ser idempotente igual que el resto. |
| **Guard anti-doble-creación** | `nueva.tsx:66`, `:224`, `:232` | **Intacto** (es sobre `listingId`). | Sin cambios. |
| **Guard de reentrada (`useRef`)** | `nueva.tsx:138/158` | **Intacto** (es del picker). | Sin cambios. |
| **Motivo de fallo de moderación** | `publicar.ts:37-59`, `:142-184` | Ver §5.1 — cambia la forma de `falloGeneral`. | `falloGeneral` deja de ser booleano. |
| **`creada.tsx`** | docblock `:4-10` | **Miente**: afirma que llegar ahí significa "quedó activa". | Copy ya construido en dos frames nuevos ("Publicación en revisión", "no aprobada"), CLAUDE.md §4. |
| **`alternarPausa()`** | `editar/[id].tsx:374`, `mis-publicaciones.tsx:150` | Sobre `pendiente`/`bloqueada` devuelven 0 filas y muestran *"ya se vendió"* / *"no pudimos cambiar el estado"* — **falso**. | Guard por estado antes de ofrecer la acción. El 0 tiene ahora **cuatro** causas (`…459:94-97`); `listings.ts:638-640` ya está desactualizado. |
| **`ESTADO_LABEL`** | `mis-publicaciones.tsx` | **Fallo silencioso**: `ESTADO_LABEL['pendiente']` es `undefined` → RN pinta cadena vacía. Una bloqueada se ve como una pausada con un glitch. | `Record<EstadoListing, string>` (5 claves, textos del frame). El crash de `ESTADO_LABEL[filtro].toLowerCase()` **se volvió irrepresentable**: `FILTROS` va tipado por `EstadoFiltrable`, así que agregar un chip de "En revisión" sin resolver el plural ("en revisións") NO COMPILA, en vez de reventar en runtime. |
| **Firmas de tipo** | `listings.ts` (`ListingDetalle.estado`, `MiListing.estado`, `crearListing`, `FetchMisListingsParams`, `useMisListings`); `confianza.ts` (`accionVenta`); `mis-publicaciones.tsx` | No admiten los estados nuevos; el enum de la base sí. | **SIETE, no cinco.** Dos tipos exportados en `listings.ts`: `EstadoListing` (los 5) y `EstadoFiltrable` (los 3 con chip). Ver abajo por qué son dos. |
| **`accionVenta()`** | `confianza.ts` | Devolvía `'marcar'` para TODO estado ≠ vendida, así que una `pendiente` ofrecería "Marcar como vendida" en las TRES superficies — y ese update afecta 0 filas sin lanzar. | Devuelve `null` en `pendiente`/`bloqueada`, con el `if` ANTES del `!== 'vendida'`. **No es tipado, es comportamiento.** |
| **`detalle/[id].tsx`** | el `.sticky-cta` del dueño, y el `.stat-row` | Ofrece "Marcar como vendida" + "Editar publicación" sobre una `pendiente`; y pintaría "0 vistas · 0 favoritos · 0 contactos", que lee como fracaso. | Cuarto reparto (`.notice`, sin botones) con los dos textos del frame, y el `.stat-row` desaparece entero (también se salta `fetchStatsPropias`). |
| **Guard de `editar`** | `editar/[id].tsx:452` | Solo cubre `vendida`; con los nuevos pinta el formulario y "Guardar" falla contra RLS — verificado: la policy rechaza CUALQUIER update sobre `pendiente`/`bloqueada`, no solo el cambio de estado. | Extender el guard para reemplazar el formulario entero, igual que ya hace la variante de `vendida` — no basta con apagar la `.status-section`. |
| **`with_check` del INSERT** | `listings_insert_own` | Hoy no restringe `estado`. | Forzar `'pendiente'`. **Mismo cambio que el rework** — solo, rompe publicar al instante (ver arriba). |
| **Default de la columna** | `estado default 'activa'` | **No hay que voltearlo.** El `with_check` solo ata a `authenticated`; las fixtures corren como `postgres`. | Sin cambios — evita reescribir los 4 bloques de fixtures que la deuda hermana ya documenta en `publicar-fotos.md`. |

### 5.1. El fallo de moderación es un motivo propio, y no va en `esDeterminista()`

El requisito era: un tercer motivo determinista, no "transporte", con copy
propio, y que "Reintentar" siga funcionando. Las dos mitades chocan con el
código tal como está, y la resolución importa:

`esDeterminista()` (`publicar.ts:95-97`) hoy no significa "no es de red" —
significa **"no tiene sentido reintentar"**, y es lo que apaga el botón
(`nueva.tsx:276`: `hayDeterminista && !hayTransitorio`). Meter `'moderacion'`
ahí apagaría el botón, que es lo contrario de lo pedido.

Además, un 4xx de moderación **no es atribuible a una foto** — los motivos
hoy viven en `FotoElegida.fallo`, y este es un fallo de la publicación
entera. Su lugar natural es `falloGeneral`.

Diseño concreto:

- `falloGeneral: boolean` → **`falloGeneral: null | 'guardado' | 'moderacion'`**.
- Los dos caen en el balde de **reintentar**, con copy distinto:
  - `'guardado'` → el actual ("No pudimos guardar los cambios, puede ser tu
    conexión") — ahí sí suele ser la red.
  - `'moderacion'` → **"No pudimos enviar tu publicación a revisión, intenta
    de nuevo"**, sin culpar a la conexión.
- `esDeterminista()` **no cambia**: sigue devolviendo true solo para
  `'tamaño' | 'formato'`, y el botón sigue vivo.
- Se actualizan los docblocks que dicen "dos baldes, no tres"
  (`publicar.ts:130-140`) y la deuda de "**solo DOS errores deterministas**"
  en `publicar-fotos.md`: los **motivos** pasan a tres, los **baldes** siguen
  siendo dos.

**AL IMPLEMENTARLO APARECIÓ UN SEGUNDO ERROR, y comparte motivo con el primero
a propósito.** `solicitarModeracion()` puede lanzar `ModeracionEstadoInesperadoError`
—la publicación está en `pausada`/`vendida`, que este flujo no sabe interpretar—,
y eso NO se arregla reintentando: la relectura ve el mismo estado y vuelve a
lanzar. Aun así cae en `'moderacion'`, porque darle motivo propio exige copy
propio, o sea un `.notice` nuevo, o sea un frame (CLAUDE.md §0 regla 4), para un
caso que hoy **no es alcanzable** (una fila nace `pendiente` y solo la Edge
Function la mueve). La causa real va completa al `console.warn` con el estado
recibido. Es decisión, no accidente, y por eso está escrita en el `catch`.

### 5.1b. El guard del reintento — sin él, "Reintentar" puede DEGRADAR lo ya aprobado

No estaba en el plan original y salió de mirar el código en vez de confiar en él.
`moderarListing()` llama a `evaluarListing()` **sin mirar `estadoActual`**; el
estado solo entra después, como argumento de `decidirListing()`. Y ahí, un
veredicto `revisar` sobre una publicación ya `activa` la manda a `pendiente`
(`decision.ts`), y un `bloquear` a `bloqueada`. Junta eso con un hecho ya medido
—GPT no es determinista sobre el MISMO texto, §6.3— y sale el caso:

```
llamada 1 → la función escribe 'activa'  → la respuesta se pierde (red, background)
el usuario toca "Reintentar"
llamada 2 → se vuelve a pagar Vision + OpenAI sobre contenido IDÉNTICO
          → GPT contesta distinto → la publicación aprobada se cae a pendiente
```

Por eso `solicitarModeracion()` **lee el estado primero** y devuelve directo si
ya no es `'pendiente'`, sin invocar nada. Tres cosas que conviene no "simplificar":

- **No es autorización duplicada** (CLAUDE.md §0 regla 7): la Edge Function se
  comporta igual mire el cliente lo que mire, y el ownership lo valida ella con
  `ctx.userClaims.id`. Lo único que se elige aquí es no re-tirar el dado.
- **La carrera es benigna**: si el estado cambia entre la lectura y la
  invocación, lo peor que pasa es que se invoque de más — el comportamiento de
  antes.
- **Hace idempotente el reintento del CLIENTE, no la función.** El camino del
  trigger sigue pudiendo re-evaluar, y ese hueco queda como deuda (§9).

### 5.1c. El reclamo y el CAS — el guard de §5.1b no alcanzaba (2026-09-24)

**§5.1b decía "la carrera es benigna: lo peor es invocar de más", y no lo era.**
El guard lee el estado y, si sigue en `pendiente`, invoca. Pero
`functions.invoke` va sin timeout (`functions-js` 2.115.0 solo aborta con
`timeout` explícito), así que un "Reintentar" tras un fallo EN EL CLIENTE puede
llegar mientras la primera evaluación sigue viva en el servidor, y las dos leen
`pendiente`. Medido en producción (`query_logs`, `function_edge_logs`,
2026-09-22, n=13, status 200): **mín 1,594 ms, p50 2,814 ms, máx 5,044 ms**.
Con esa ventana:

1. se pagaba la evaluación dos veces;
2. `moderarListing()` escribía sin condición y ganaba la última, así que **una
   `bloqueada` podía quedar pisada por `activa`**. Medido con el control
   negativo de (g): sin el CAS, sale `activa`;
3. **H2:** un dueño podía llamar al camino cliente por API sobre una
   publicación que el trigger había escalado a `pendiente` y auto-aprobarse
   sin Studio.

**Los dos arreglos, y qué cierra cada uno:**

- **CAS** (`index.ts`, `moderarListing()`): `.eq('estado', estadoActual)` con
  `count`. Con 0 filas gana lo ya escrito, se relee, se responde el estado
  vigente y la auditoría lleva `descartado_por_carrera: true` y
  `estado_propuesto`. Aplica a los dos caminos, así que también cubre eventos
  concurrentes del trigger. Cierra (2).
- **El reclamo** (`listing_moderacion_reclamos`, `20260928000471`), solo en el
  camino cliente. Cierra (1) y (3).

**Ciclo de vida de la fila del reclamo: una fila, dos estados.**

| Momento | Qué pasa con la fila | ¿Se evalúa después? |
|---|---|---|
| Primera llamada | `insert` con `ignoreDuplicates` + `.select()`; 1 fila = el reclamo es nuestro | — |
| Llamada concurrente | 0 filas → responde el estado vigente con `sin_evaluar: 'reclamo_tomado'` | no |
| Evaluación completa (`evaluacionIncompleta()` false) | `completada_at = now()` | **nunca más**; solo el `on delete cascade` la borra |
| Fallo manejado (500, o algún eje sin evaluar) | la función borra SU fila (`completada_at is null` y su `reclamada_at`) | sí, de inmediato |
| El worker muere | la fila queda sin completar | sí, pasados 60 s (el TTL solo toca `completada_at is null`) |

**Consecuencia operativa:** una publicación que vuelve a `pendiente` por una
foto editada **solo la resuelve Studio**, y un alta que sale `revisar` por su
contenido también: el reintento ya no re-tira GPT. Las fotos nuevas se siguen
evaluando por el camino del TRIGGER, que no usa el reclamo. Con esto, la deuda
de §9 "toda re-evaluación vuelve a tirar el dado de GPT" queda acotada al camino
del trigger, que es como ya estaba escrita.

**`evaluacionIncompleta()` cuenta también causas deterministas** (una foto
sobre el tope, una webp que Rekognition no lee): liberarlas permite re-evaluar
algo que va a dar lo mismo. Se acepta porque la app no reintenta sola un 200
(navega a "Publicación en revisión"), y distinguir "caído" de "inevaluable"
dependería de los strings de motivo.

**Pruebas, en `probe-moderacion-http.mjs` §8** (36 aserciones en total,
medidas): (a) dos llamadas concurrentes dan una sola evaluación; (b) una llamada
después del alta no evalúa; (c) un reclamo huérfano se libera; (d) uno
completado y viejo no; (e) uno en vuelo bloquea; (f) un 500 libera; (g) el CAS
con un bloqueo a mitad de evaluación. Hay una aserción de CONTROL de tiempo: si
la evaluación terminara antes del bloqueo, lo dice en vez de pasar en falso.
Pasó una vez con una espera de 1.5 s, y por eso la espera es de 0.5 s.
Controles negativos corridos uno a la vez, restaurando desde un respaldo y
verificando con `diff`:

| Variante rota | Cae en |
|---|---|
| TTL sin `completada_at is null` | (d), las dos aserciones |
| el reclamo nunca bloquea | (a), (b), (d), (e) |
| nunca liberar tras un fallo manejado | solo (f) |
| sin el CAS | (g), `bloqueada` pisada por `activa` |

Y `evaluacionIncompleta()` es pura: 4 aserciones en `probe-moderacion.mjs` (166
en total). Su control, ignorar el eje de Rekognition, cae en la suya.

### 5.2. El `with_check` de `listings_insert_own`

`listings_insert_own` no restringe hoy qué valor de `estado` trae un INSERT
del cliente — su `with_check` es solo `user_id = auth.uid() and
is_active_user()`, y el INSERT de `listings` está concedido a nivel TABLA.
Esto ya está documentado como deuda consciente en `publicar-fotos.md`
("`listings_insert_own` no restringe qué valor de `estado`..."), con su
"Revisar cuando"/"Fix" — no se repite aquí completo, pero el punto crítico
para el rework es el orden: el `with_check` tiene que apretarse **en el mismo
cambio** que el rework de arriba, nunca antes ni con una migración aparte que
llegue primero — de lo contrario publicar queda roto en el intervalo (la
"regresión #1" del encabezado de esta sección).

---

## 6. Verificación

### 6.1. `decision.ts` — un test por combinación, y la historia de por qué son 13 y no 12

| # | Entrada | Esperado | Qué prueba |
|---|---|---|---|
| 1 | match de lista **tecleado**, resto limpio | `bloqueada` | el eje de lista bloquea solo |
| 2 | match de lista **vía OCR**, resto limpio | `pendiente` | el **techo** del OCR |
| 3 | GPT `claro`, texto **sin** match de lista | `bloqueada` | el eje de GPT bloquea solo |
| 4a | match OCR (`revisar`) **+** GPT `claro` (`bloquear`) | `bloqueada` | **gana el peor** |
| 4b | match tecleado (`bloquear`) **+** GPT `posible` (`revisar`) | `bloqueada` | **gana el peor**, en la otra dirección |
| 5 | Vision `VERY_LIKELY`, texto limpio | `bloqueada` | el eje de Vision |
| 6 | Vision `LIKELY`, texto limpio | `pendiente` | el umbral bajo |
| 7 | todo limpio, `estadoActual = 'pendiente'` | `activa` | la promoción, único camino |
| 8 | `estadoActual = 'bloqueada'` + veredicto limpio | `bloqueada` | **la regla del piso** |
| 9 | `estadoActual = 'pausada'`, veredicto limpio | `pausada` | no despausa a nadie |
| 10 | `datos_contacto: claro` solo | `pendiente` | su techo |
| 11 | `estadoActual = 'vendida'` + veredicto `bloquear` | `bloqueada` | sí escala — y que `listing_sales` quede intacta |
| 12 | `estadoActual = 'pausada'` + veredicto `bloquear` | `bloqueada` | sí escala |
| 13 | `estadoActual = 'pausada'` + veredicto `revisar` | `pausada` | **NO escala** |

4a y 4b son dos casos y no uno a propósito: con un solo orden, una
implementación que devolviera siempre el último eje evaluado pasaría igual.

**9 y 12 son el par que define la asimetría de `bloquear`, y ninguno de los
dos sirve solo.** Los dos parten de `pausada` y dan resultados opuestos según
el veredicto: #9 prueba que una moderación limpia **no** la despausa, #12 que
una sucia **sí** la bloquea. Con solo #9, una implementación que jamás tocara
`pausada` pasaría en verde y dejaría abierto el escondite. Con solo #12, una
que la tratara como cualquier otro estado también pasaría, y despausaría
publicaciones ajenas. #11 es el mismo par del lado de `vendida`, con la
verificación extra de que la fila de `listing_sales` sigue ahí.

**#13 se agregó DESPUÉS de la primera implementación, y cazó un bug real.**
`decidirListing()` dejaba que `revisar` escalara `pausada` a `pendiente`, con
el razonamiento de que sin eso "pausar sería un escondite". El hueco no era
ese: la regla de promoción de #7 mira ÚNICAMENTE si el estado ES `pendiente`,
así que una segunda evaluación limpia sobre esa misma fila —otra foto sube, el
trigger corre de nuevo— la habría promovido sola a `activa`, exactamente el
auto-republicado que #9 existe para impedir. Es el mismo invariante que ya
protegía a `vendida` (`revisar` tampoco la toca); `pausada` necesitaba el
mismo carve-out y no lo tenía. Corregido en `decidirListing()` y en
`probe-moderacion.mjs` (13 de esta tabla; el total del archivo se mide con
`node scripts/probe-moderacion.mjs`, no se recuerda — iba en 44 al escribirse
esta línea y ya se movió dos veces desde entonces). El fix acota el "escondite" a una consecuencia menor y documentada en
el propio código: un acierto de nivel `revisar` sobre una publicación pausada
queda sin marcar hasta que algo más la toque (`bloquear` si empeora, o el
vendedor la reactiva a mano) — aceptable porque mientras está pausada nadie la
ve.

### 6.2. El resto — TODO CORRIDO desde 2026-09-21

> El título de esta sección era "El resto, todavía sin correr" y dejó de ser
> cierto al cerrarse Ola 4: sus cuatro entradas están en verde. Se deja la
> sección porque cada una registra QUÉ se corrió y con qué resultado, que es lo
> que hace falta saber la próxima vez que algo de esto se toque.

- **Triggers: HECHO**, y partido en dos scripts con costos distintos — el
  detalle completo, con los cinco controles negativos, en §6.5.
- **Rework de `publicar.ts`: HECHO** (Ola 3). `rls.sql` entero —177 aserciones,
  medido con su comando, no recordado— con **T25 nueva (8) para el `with_check`
  del INSERT** y sus cuatro variantes rotas corridas una a la vez; más
  `probe-storage.mjs` (21) y `probe-venta.mjs` (13), que **no debían moverse** y
  no se movieron: sus fixtures insertan con la secret key, así que un rojo ahí
  habría significado que el `with_check` estaba atrapando a `service_role`. La
  tabla de qué variante cae en qué aserción está en CLAUDE.md §3.
- **Realtime: CORRIDO Y EN VERDE (2026-09-21), los TRES casos.** Fue lo último
  que quedaba de Ola 4 y estuvo marcado PENDIENTE desde la Ola 3. El runbook
  completo (cómo llegar a la pantalla gratis, y por qué iOS alcanza) vive en
  §4.2. Resultado: camino feliz → navega solo, log **`por REALTIME`**; piso con
  `alter publication supabase_realtime drop table public.listings` **en LOCAL**
  → el estado NO llega solo y al reenfocar navega con log **`por REFETCH`**;
  cleanup → un `CLOSED` por cada `SUBSCRIBED`.
  **Y el caso 2 es el que le da valor a los otros dos**, por el mismo motivo por
  el que la observabilidad tuvo que ir PRIMERO: antes de ella, con el piso del
  refetch funcionando, un canal que jamás conectaba se veía **idéntico** a uno
  que entregaba —el veredicto llegaba de todos modos—, así que esta corrida
  habría salido verde sin probar Realtime en absoluto. Es la familia de fallos
  de CLAUDE.md §9, y por eso el orden fue observabilidad → corrida y no al
  revés.
- **`C` (la migración de Realtime ya aplicada):** `select * from
  pg_publication_tables where pubname='supabase_realtime'` antes y después —
  ya corrido una vez al aplicar `20260917000460`, repetible.

### 6.3. Ola 1.5 (fetch real a Vision/OpenAI) — los ocho casos que dependían de red, corridos con credenciales reales (2026-09-18)

**Tres scripts, tres alcances distintos, y ninguno sustituye a los otros:**

| Script | Qué prueba | ¿Cuesta dinero? | ¿Necesita servidor? |
|---|---|---|---|
| `probe-moderacion.mjs` | DECISIONES puras (**166** al 2026-09-24; decía 162; se mide, no se recuerda) | No | No |
| `probe-moderacion-http.mjs` | AUTORIZACIÓN/CABLEADO + reclamo y CAS (**36** al 2026-09-24; decía 16, y ya iba en 23 antes del §8 — medido: 33 con las 10 primeras del §8) | **Sí, desde la Ola 1.5** | Sí |
| `probe-moderacion-red.mjs` | Particionado, descarga fallida, no-op (10) | Sí | Sí |

**`probe-moderacion-http.mjs` dejó de ser gratis, y no por elección.** Antes
de la Ola 1.5 probaba autorización con la evaluación en stub, así que nunca
tocaba red. En cuanto `evaluarListing()` llama de verdad a las dos APIs, CADA
llamada a la función —aunque el objetivo del test sea solo "¿rechaza sin
llave?"— dispara el pipeline completo si llega a `moderarListing`. No hay
modo "seco" en `index.ts` y no se construyó uno: no estaba pedido y habría
sido una rama de código que solo existe para pruebas. Consecuencia práctica:
la primera versión de este probe usaba títulos de prueba sin sentido
(`RLS ModHTTP propia ${RUN}`), y con evaluación real eso produjo veredictos
NO DETERMINISTAS de GPT entre corridas —una vez `posible`, una vez peor—.
Arreglado con `TITULO_LIMPIO`/`DESCRIPCION_LIMPIA`, un par verificado 5/5 GPT
+ 3/3 Vision antes de confiar en él como fixture.

**El guard de promoción (`esPromocion`) dejó de pasar por vacuidad en este
probe.** Antes, con los ejes siempre en `'revisar'`, `decidirListing` nunca
proponía `activa` desde `pendiente`, así que no había ninguna promoción que
el guard pudiera bloquear — la aserción de "el trigger no promueve" pasaba
sin ejercitar nada. Con contenido limpio de verdad, `enPendiente` SÍ recibe
una promoción real, y el control negativo (desactivar
`bloqueadaPorGuard` en `index.ts`, restaurar servidor, correr) hizo CAER la
aserción — restaurado y reverificado en verde.

**Descubrimiento de fixture, no de producto:** promover a `activa` exige al
menos una foto real en `listing_photos` (`listings_enforce_activation_has_photos`,
CLAUDE.md §3) — un trigger de la BASE, completamente ajeno a la moderación.
La primera corrida de la sección 5 falló con `500 "Una publicación no puede
activarse sin fotos"`, no por un bug de `index.ts` (el error se propagó
correctamente) sino porque el fixture no tenía foto. Arreglado con
`subirFotoLimpia()` — un JPEG sólido generado con `sharp`, verificado 3/3
`limpio` antes de usarlo.

**Los ocho casos, con su resultado exacto:**

| # | Caso | Resultado medido |
|---|---|---|
| 1-3 | Llaves, ownership, trigger no promueve | 16/16 en `probe-moderacion-http.mjs`, guard NO vacuo (ver arriba) |
| 4 (parcial) | Imagen/texto limpios, real | GPT 5/5 `limpio`; Vision (JPEG sólido) 3/3 `limpio`; Vision (ruido 2000×2000) 1/1 `limpio` |
| 4 (LIKELY/VERY_LIKELY) | — | **Declinado a propósito** — ver el bloque de abajo |
| 5 | Particionado: 2 fotos de ~3.9 MB (~7.7 MB crudos) | `lotes_vision: 2` (confirmado leyendo `listing_moderacion.detalle`), veredicto correcto, las dos fotos evaluadas |
| 6 | Vision caído (`ENDPOINT_VISION` a host muerto) | `HTTP 200`, `vision: 'revisar'`, motivo `"sin respuesta de Vision para esta imagen"`, `estado_resultante: 'pendiente'` — sin excepción |
| 7 | OpenAI caído (`ENDPOINT_OPENAI` a host muerto) | `HTTP 200`, `gptTexto: 'revisar'`, `motivo: 'error_http'` con el error DNS real en `detalle`, `pendiente` — sin excepción |
| 8 | OpenAI refusal | `HTTP 200`, `motivo: 'refusal'`, `detalle` con el texto EXACTO del mock, `pendiente` — sin excepción |
| 9 | Falla la descarga de una foto suelta | `buena → evaluada`, `fantasma → no_evaluable`, `estado_resultante: 'pendiente'` — control negativo (filtrar en vez de incluir) hizo caer las dos mitades a la vez |
| 13 | No-op write | `updated_at` idéntico en las dos corridas, pero 2 filas en `listing_moderacion` |

**Por qué 4 (LIKELY/VERY_LIKELY) se declina, con el trade-off explícito.**
Forzar esos niveles con imágenes reales exigiría sourcear o generar contenido
sexual explícito o gráficamente violento — este repo no lo hace, ni para
pruebas, sin importar que el contexto sea "moderación de contenido" y la
intención defensiva. Lo que SÍ se puede y se mide es la lógica de umbral en
sí (`nivelDeSafeSearch()`: `LIKELY → revisar`, `VERY_LIKELY → bloquear`),
determinista y ya cubierta por `probe-moderacion.mjs` sin necesitar ninguna
imagen real. Lo que queda sin probar es exclusivamente "¿Vision de verdad
clasifica una foto genuinamente explícita como `LIKELY`/`VERY_LIKELY`?" —
comportamiento del modelo de Google, no de este código. Si alguna vez hace
falta esa cobertura, la vía es que el usuario aporte un asset ya vetado
(dataset público de SafeSearch, por ejemplo), no que la IA lo genere o lo
busque.

**Casos 6, 7 y 8 no viven en un script permanente**, y es deliberado: piden
editar temporalmente `ENDPOINT_VISION`/`ENDPOINT_OPENAI` en el FUENTE y
reiniciar `supabase functions serve` — automatizar el reinicio del servidor
desde dentro de un script Node que a la vez necesita ESE servidor corriendo
es más aparato del que vale la pena mantener, con el riesgo real de dejar el
entorno de desarrollo a medio restaurar si algo truena a mitad de camino.
Se verificaron a mano, edición + reinicio + prueba + restaurar + reinicio,
con los resultados exactos arriba. El mecanismo para 6 y 7 fue apuntar el
endpoint a un host que no resuelve (`*.host-que-no-existe.invalido`); para 8,
un servidor HTTP local de una sola ruta (`node:http`, sin dependencias)
devolviendo la forma EXACTA de un refusal real, alcanzado desde el
contenedor del edge runtime vía `host.docker.internal` — **no** `127.0.0.1`,
que desde dentro del contenedor apunta al contenedor mismo, no al host.

### 6.4. Ola 1.6 (avatares) — los tres casos del plan, corridos contra la función viva (2026-09-18)

**`evaluarFotos()` se parametrizó por bucket** (`Bucket`, `'listing-photos' |
'avatars'`) para que `moderarAvatar()` reuse el pipeline COMPLETO de imagen
—descarga, particionado, request a Vision, las tres formas de foto no
evaluable— en vez de una copia paralela. Mismo argumento que la lista de
palabras prohibidas siendo una sola (CLAUDE.md §3): dos copias del pipeline
de imagen es exactamente lo que no debe desincronizarse. El único call site
existente (`evaluarListing`) pasó a nombrar `BUCKET_LISTING_PHOTOS`
explícito; nada de su comportamiento cambió (reverificado: probes de
publicaciones siguen en 16+10 tras el cambio).

**Por qué Vision va MOCKEADO en este script y no en uno de los dos anteriores
(`-http`, `-red`).** `decidirAvatar()` solo borra con el eje `vision` en
`'bloquear'`, que exige `VERY_LIKELY` de SafeSearch — y la única forma de
conseguir eso de Vision DE VERDAD es mandarle una imagen genuinamente
explícita o gráficamente violenta. Este repo no sourcea ni genera ese
contenido, ni para pruebas (mismo criterio ya aplicado al declinar la
sub-casuística LIKELY/VERY_LIKELY del caso 4 en §6.3). La lógica de umbral
(`nivelDeSafeSearch`) ya está cubierta pura y determinista en
`probe-moderacion.mjs`; lo que faltaba probar era el CABLEADO alrededor de
esa lógica — y un mock que devuelve la FORMA real de la respuesta de Vision
(nunca una foto real) es exactamente lo que hace falta para eso, sin
comprometer nada. Mismo patrón que el mock del *refusal* de OpenAI (caso 8).

**Los tres casos del plan, con su resultado exacto** —
`scripts/probe-moderacion-avatares.mjs`, 16 aserciones, requiere
`ENDPOINT_VISION` apuntado al mock (ver el encabezado del script para el
procedimiento exacto, editar+reiniciar+restaurar):

| # | Caso | Resultado medido |
|---|---|---|
| 1 | `VERY_LIKELY` → borra | `accion: 'borrar'`, `foto_url_nulificado: true`, `foto_url` en `null`, el objeto YA NO está en el bucket |
| 2 | `LIKELY` → no-op | `accion: 'conservar'`, `foto_url` intacto, el objeto SIGUE en el bucket, `foto_url_nulificado` ni viene en la respuesta |
| 3 | Guard de la carrera | avatar A disparado con la respuesta del mock retrasada 2s; mientras tanto se sube B y se actualiza `foto_url`. El veredicto tardío de A SÍ dice `'borrar'`, pero `foto_url_nulificado: false`, `foto_url` sigue en B, B no se borra — **y A sí se borra del bucket**, un efecto colateral esperado y documentado (ver abajo) |
| — | Avatares nunca escriben en `listing_moderacion` | 0 filas nuevas tras las 4 llamadas de moderación de este script (confirmado con `count=exact` antes/después, no solo leído del código) |

**El borrado del objeto NO lleva el guard de la carrera — es deliberado, y el
caso 3 lo prueba en la misma corrida que prueba lo contrario para `foto_url`.**
Cada subida de avatar estrena uuid (`storage.ts`, `rutaAvatar()`), así que un
objeto cuyo veredicto llega tarde NUNCA es el avatar vigente si `foto_url` ya
cambió — el cliente ya intentó borrarlo (`borrarAvatar()`, best-effort) al
escribir el nuevo. Borrarlo aquí, tarde, es la misma limpieza que el cliente
ya iba a hacer, no un borrado nuevo. Ponerle el mismo guard que a `foto_url`
sería un candado sin nada que proteger, y dejaría huérfanos exactamente los
objetos que este código ya puede limpiar gratis.

**Control negativo corrido, y encontró lo que tenía que encontrar.** Se quitó
`.eq('foto_url', name)` del UPDATE (dejando solo `.eq('id', entityId)`), se
corrió el caso 3 aislado: **`foto_url` quedó en `null`** —el veredicto tardío
de A le borró la foto a B— en vez de seguir apuntando a B. Restaurado,
reverificado en verde. Es la misma familia de gotcha que `listings_update_own`
(CLAUDE.md §9): el `where` que no matchea ninguna fila no lanza, así que sin
el control negativo un guard roto pasaría inadvertido — la llamada sigue
devolviendo 200 igual.

**Por qué el JSON de respuesta distingue `foto_url_nulificado` con `.select('id')`
y no infiriéndolo del `errUpdate`.** Un UPDATE cuyo `where` no matchea ninguna
fila NO es un error (mismo gotcha de arriba) — devuelve un array vacío, sin
`error`. Sin leer ese array, "el guard bloqueó el update" y "el update aplicó"
son indistinguibles desde el código, que es justo la ambigüedad que el caso 3
necesita poder afirmar con certeza.

### 6.5. Ola 2 (los dos triggers de Storage) — corrida 2026-09-18

**Dos scripts, y la línea que los separa es el COSTO**, que es la razón de que
no sea uno solo:

| Script | Qué prueba | ¿Cuesta? | ¿Necesita `functions serve`? |
|---|---|---|---|
| `probe-storage.mjs` (4 aserciones nuevas, 21 en total) | que el trigger DISPARA, con el payload y el header correctos | **No** | **No** |
| `probe-moderacion-http.mjs` (§6, 4 nuevas, 20 en total) | que disparando de verdad el ESTADO se mueve | Sí (ya lo era) | Sí |

**Cómo intercepta `probe-storage.mjs` sin servidor, y por qué sale más barato
que los casos 6-8 de §6.3.** Aquellos tenían que editar `ENDPOINT_VISION` en el
FUENTE y reiniciar `functions serve`, porque es una constante de un `.ts`. Aquí
la URL de la función vive en una **fila de Vault**, así que el script la repunta
con SQL en runtime a un listener `node:http` local y la restaura en el `finally`
— **sin editar fuente, sin reiniciar nada, sin credenciales y sin gastar un
centavo**. El `finally` restaura Vault ANTES que nada: un secreto repuntado que
sobreviva a la corrida deja el trigger llamando a un puerto muerto.

**Precondición medida, no supuesta:** `net.http_post` **desde el contenedor de
Postgres** alcanza `host.docker.internal` — 200 en `net._http_response`, con el
body y el header `apikey` recibidos. CLAUDE.md §9 solo tenía medido ese nombre
desde el contenedor del *edge runtime*; el caso general quedó ahí, ampliado.

**Los cuatro casos de `probe-storage.mjs` y sus CINCO controles negativos**,
corridos uno a la vez contra el script completo:

| Variante rota | Cae en |
|---|---|
| sin el trigger de INSERT | (a) y (d); y (c) cae con su propio mensaje *"la BARRERA no llegó: la aserción no es concluyente"* |
| sin el trigger de UPDATE | **solo (b)** |
| sin el skip de `pendiente` | **solo (c)** |
| el skip aplicado también a `avatars` | **solo (d)** |
| sin el guard `old.version is distinct from new.version` | **NADA — las 21 pasan** |

Tres cosas de esa tabla que conviene no suponer:

- **(b) se afirma sobre el CONTEO antes/después, no sobre "hay al menos uno".**
  Con `>= 1` pasaría en verde por el evento que ya dejó (a), o sea sin que la
  rama UPDATE existiera. Y **no afirma `tg_op === 'UPDATE'`**: eso es un detalle
  de implementación de Storage que el F-spike midió hoy y que una actualización
  puede mover, así que se imprime como dato y no como aserción.
- **(c) lleva BARRERA, y sin ella sería una mentira por timeout.** "No llegó
  nada en N ms" no distingue *no disparó* de *tardó*. Se sube a la `pendiente`,
  después a una `activa`, y se espera a que llegue la de la `activa`; si la
  posterior ya llegó y la anterior sigue ausente, el silencio está probado. El
  control de "sin trigger de INSERT" lo demuestra funcionando: (c) no miente en
  verde, **declara que no es concluyente**.
- **La última fila es un RESULTADO, no un hueco.** El guard de `version` no
  tiene control negativo porque no filtra nada medido (ver §1). Está escrito así
  a propósito en los tres lados: la migración, el probe y §1.

**OJO CON LO QUE ESTAS CUATRO ASERCIONES NO PRUEBAN, descubierto en Ola 3.**
Las dos que ejercitan `listing-photos` usan `x-upsert` sobre una ruta que YA
tiene fila en `listing_photos`, y ese es el único caso en el que "la foto que
disparó el trigger" y "lo que `evaluarListing()` evalúa" coinciden. En un alta
genuina el objeto se sube antes que su fila, así que la función evalúa el set
ANTERIOR y la foto nueva no la mira nadie — el hueco completo está en §1. Estas
aserciones prueban que el trigger DISPARA con el payload correcto, que es lo que
dicen; no prueban QUÉ se evalúa.

**La sección 6 de `probe-moderacion-http.mjs`, y por qué la escalada la dispara
la LISTA y no una imagen sucia.** Forzar `bloquear` por Vision exigiría sourcear
contenido sexual explícito o gráficamente violento, que este repo no hace ni
para pruebas — mismo criterio ya aplicado en §6.3 (caso 4) y §6.4. La lista de
palabras es el eje determinista: una publicación `activa` con una palabra
prohibida en el título, con su foto limpia, a la que se le sobrescribe la foto.
Resultado medido: **`activa → bloqueada`**, más la fila de auditoría con
`lista_tecleada=["clonazepam"]`.

Y el veredicto es determinista **aunque GPT sea un modelo**: `peor()` es
monótona, así que un acierto de lista en texto tecleado da `bloquear` diga lo
que diga OpenAI. Por eso la aserción mira **`detalle.lista_tecleada` y NO
`eje_que_manda`** — `ejeQueManda()` desempata por orden fijo con `vision` y
`gptTexto` ANTES que `listaTecleada`, así que si GPT también dice `bloquear`
—probable con ese texto— el eje reportado sería `gptTexto`. Afirmarlo ataría la
prueba a lo que conteste un modelo.

**El ORDEN de esa sección es load-bearing**, y por el mismo motivo que ya
documenta `listing_sales` en CLAUDE.md §3: la publicación y su foto se crean
ANTES de repuntar Vault. Al revés, la subida inicial ya dispararía el trigger y
dejaría la fila `bloqueada` antes del overwrite — la aserción pasaría en verde
sin haber ejercitado la rama UPDATE en absoluto.


---

### 6.6. El eje de Rekognition (2026-09-21) — lo puro, corrido y en verde

`node scripts/probe-moderacion.mjs` pasó de **124 a 162 aserciones**, las dos
cifras medidas con el comando (`git stash` para el baseline), no recordadas.
**Y el baseline desmintió a este mismo archivo**, que en §6.3 decía 120: la
moraleja de los conteos de CLAUDE.md §3 otra vez, encontrada al medir para
otra cosa. Corregido también allá. Lo que cubre y que no se ve en el diff:

**La firma SigV4 va contra los vectores OFICIALES de AWS**, bajados de
`aws-sig-v4-test-suite`. Son la razón entera de haber escrito el firmador a
mano en vez de usar `npm:aws4fetch`: con una librería la firma no tiene
cobertura a ningún precio, y un bug de firma se manifiesta como un **403
opaco** — indistinguible de una credencial mal puesta, un permiso de IAM
faltante o una región equivocada. Dos vectores completos:

| Vector | Qué agrega |
|---|---|
| `get-vanilla` | la cadena HMAC completa y el formato del `Authorization`, con payload vacío |
| `post-x-www-form-urlencoded` | el **hash del CUERPO** y el orden de varios headers |

**Y ese segundo vector trae una trampa de la SUITE, no un bug nuestro —
medida, no deducida.** El `.creq` oficial de ese caso incluye `content-length`
entre los headers firmados, pero su `.sts` y su `.authz` se calcularon SIN él
(`SignedHeaders=content-type;host;x-amz-date`): los tres ficheros de AWS no son
consistentes entre sí. Es el mismo desacuerdo que reportó aws/aws-sdk-js#853.

Cómo se resolvió, porque la primera corrida falló ahí y la tentación era
**ajustar el esperado hasta que pase**: se firmó el caso con y sin
`content-length` y se comparó cada variante contra los tres ficheros. CON
reproduce el `.creq` y ningún otro; SIN reproduce el `.sts` **y** el `.authz`
exactos. Dos de tres ficheros mandan, y son los dos que dependen de la cadena
HMAC completa — así que se firma sin `content-length`, que además es lo
correcto (AWS no exige firmarlo, y nuestra petición real tampoco lo firma).

**Los cinco controles negativos, corridos UNO A LA VEZ**, verificando con
`grep` que la variante rota de verdad se aplicó ANTES de correr (CLAUDE.md §9,
"una verificación que sale sospechosamente limpia"):

| Variante rota | Cae en |
|---|---|
| sin el `techo()` del eje | las 3 de categoría, la de "NUNCA bloquea" y el barrido de 72 combinaciones |
| la auditoría descarta la banda 50-70 | "la banda 50-70 SÍ va a la auditoría" y la de categorías ajenas |
| umbral de acción 70 → 50 | "el umbral de ACCIÓN de Rekognition es 70" |
| cadena HMAC en mal orden (región ↔ servicio) | **solo** los dos `Authorization` — ni el canonical request ni el string to sign |
| parseo laxo (forma inválida se lee como limpia) | "sin ModerationLabels se RECHAZA" |

**Dos cosas de esa tabla que conviene no suponer.** La cuarta fila es
informativa, no un hueco: el canonical request y el string to sign NO dependen
de la llave, así que es correcto que no caigan — lo que prueba es que las
aserciones de `Authorization` son las que cargan esa cobertura, y borrarlas la
dejaría sin red.

Y la tercera fila **destapó un hueco real y agregó aserciones**. La primera
versión no fijaba los números: casi todas las aserciones usaban
`CONFIANZA_ACCION` de forma simbólica (`CONFIANZA_ACCION - 1` y demás), así que
**se movían con él** y bajar el umbral a 50 hacía caer una sola aserción, por
una razón lateral. Los umbrales son SPEC (CLAUDE.md §3), o sea que cambiarlos
tiene que costar tocar una prueba a propósito. Se agregaron tres pines: el 70,
el 50 y la lista exacta de categorías. Es la misma familia que `:C` en T11b —
una aserción que pasa sin probar lo que dice.

**Lo que este probe NO prueba:** que AWS acepte la firma. Eso es una llamada
real — ver §6.7, donde ya está corrida.

### 6.7. Contra AWS y la función VIVAS (2026-09-22) — las cuatro corridas

Todo contra el stack **LOCAL**. Remoto no se tocó en NINGUNA de estas cuatro
corridas: al hacerlas, `moderar-contenido` seguía en la v4 del 2026-09-19, sin
una sola línea de Rekognition (verificado bajando el fuente desplegado y
grepeándolo, no por inspección de config).

> **Ese estado ya cambió, y la frase de arriba es un registro fechado, no el
> estado actual: el eje se desplegó a producción horas después, el 2026-09-22
> (v5).** Ver §6.8 y CLAUDE.md §8. Se deja escrito así a propósito — estas
> cuatro verificaciones valen porque se hicieron ANTES de desplegar, y
> reescribirlas en presente borraría justamente eso.

| # | Qué | Resultado |
|---|---|---|
| 1 | El firmador dentro del edge runtime | `coincide: true` en `supabase-edge-runtime-1.74.3 / Deno v2.1.4` |
| 2 | `probe-moderacion-http.mjs` | **23/23**, con `"rekognition":[]` ya en el detalle de auditoría |
| 3 | End-to-end con foto real de botella de vino | `activa → pendiente`, `Alcohol` L1 **99.89** guardada |
| 4 | Falla segura (endpoint a host que no resuelve) | `revisar` / `pendiente`, motivo con el error de DNS, **cero etiquetas inventadas** |

**El spike (1) se diseñó para aislar, y por eso NO usa las credenciales
reales:** firma el vector `get-vanilla` con las de EJEMPLO de la suite dentro
de Deno y compara contra la firma conocida. Eso separa *"¿`crypto.subtle` se
porta igual aquí?"* de *"¿mis llaves y mi policy de IAM están bien?"* — que es
exactamente la ambigüedad del 403 opaco. Se borró al terminar.

**Contra AWS de verdad, con el firmador de producción llamado desde Node** (se
puede porque el módulo es puro — esa propiedad paga dos veces):

| Foto (Wikimedia, dominio público) | Etiquetas de AWS | Eje |
|---|---|---|
| botella de vino y copa | `Alcohol` L1 **99.9** + `Alcoholic Beverages` L2 | **`revisar`** |
| primer plano de cartas de póker | **ninguna** | `limpio` |

**Dos hallazgos de esa tabla que valen más que el "pasó".** El primero: una
foto de alcohol a **99.9 de confianza da `revisar`, no `bloquear`** — el techo
del eje demostrado contra dato real en el peor caso posible, no solo con
etiquetas sintéticas. El segundo, inesperado: **`Gambling` NO disparó con un
primer plano de cartas.** La definición de AWS es más estrecha de lo que sugiere
("participar en juegos de azar… en casinos"), así que el miedo a falsos
positivos por vender una baraja puede ser menor de lo asumido. **Una foto no es
una tasa** — es justo el dato que la deuda de §9 existe para acumular en serio,
y no cambia el techo.

**LA CORRIDA 3 FALLÓ LA PRIMERA VEZ Y ESA ES LA LECCIÓN DE LA SECCIÓN.** El
fixture decía *"Cava de madera para seis botellas"*, GPT lo marcó, y
`eje_que_manda` reportó `gptTexto`. Dos problemas de golpe, y el segundo es el
grave:

- **La aserción estaba mal escrita**: afirmaba sobre `eje_que_manda`, que
  desempata por ORDEN FIJO —`vision` y `gptTexto` van antes que
  `rekognition`—, así que ataba la prueba a lo que conteste un modelo. Es
  **exactamente** lo que §6.5 ya advierte para la sección 6 de
  `probe-moderacion-http.mjs`, reencontrado por no leer la propia advertencia.
- **El fixture estaba contaminado**: con GPT marcando el texto, la escalada a
  `pendiente` podía ocurrir SIN Rekognition. La prueba habría pasado por la
  razón equivocada — la familia de `:C` en T11b otra vez.

El arreglo fue texto neutro ("Lámpara de escritorio LED") **y** afirmar sobre
los otros ejes en vez de sobre `eje_que_manda`: se comprueba que GPT devolvió
las seis categorías en `ninguno`, que las dos listas vinieron vacías y que
SafeSearch dio `VERY_UNLIKELY` en todas las fotos — con lo que el `revisar`
**solo puede** venir de Rekognition. Eso es una deducción verificable, no una
aserción sobre un desempate.

**La corrida 4 necesita editar el fuente** (`hostRekognition()` a un host que
no resuelve) y reiniciar, igual que los casos 6-8 de §6.3 — y por eso no vive
en un script permanente. Al restaurar se re-corrió la 3 en verde y se comprobó
con `git status` que el fuente quedó idéntico al commit; restaurar sin
verificar es el fallo silencioso de CLAUDE.md §9.

**Dos tropiezos de herramienta, anotados para no repetirlos.** (a) `supabase
functions serve` **reinicia solo al detectar un archivo nuevo** y choca con
`Conflict: container name already in use` — hay que `docker rm -f
supabase_edge_runtime_<proyecto>` antes de relanzar. (b) `psql` imprime la
línea de estado (`INSERT 0 1`) junto a las filas devueltas, así que un
`RETURNING` leído a pelo sale contaminado; y **Postgres no garantiza
short-circuit en un `WHERE`**, así que `jsonb_typeof(x)='array' and
jsonb_array_length(x)>0` revienta igual — va con `case`.

### 6.8. En PRODUCCIÓN (2026-09-22) — desplegado y probado a mano

`supabase functions deploy moderar-contenido`, **a mano, porque este repo no
tiene CI/CD**: no hay `.github/workflows` ni ninguna otra config, así que el
push a `main` no despliega nunca. Se comprobó empíricamente antes del deploy —
el commit ya estaba en `origin/main` y producción seguía en la versión
anterior—, que es evidencia más fuerte que inspeccionar la config.

Remedido contra remoto, no recordado:

| Comprobación | Resultado |
|---|---|
| `list_edge_functions` | `moderar-contenido` **ACTIVE**, **`version: 5`**, 2026-09-22 |
| Fuente desplegado | trae `DetectModerationLabels`, `firmarSigV4`, `evaluarRekognition`, "Los cinco ejes" |
| …y del código viejo | **cero** `evaluarFotos(db, config`, **cero** "Los cuatro ejes" |
| `list_migrations` vs repo | **27 = 27** — esta tarea no agregó migraciones |

**La prueba manual en producción dio más de lo que buscaba**, y es el origen de
media sección de este archivo:

- El **techo contra dato real**: una foto de alcohol escaló a `pendiente` con
  `Alcohol` @99.9, sin bloquear.
- El **primer falso positivo medido** de Rekognition: `Silla gamer` →
  `Alcohol` @95.7 (§9).
- La **limitación de falsos negativos** entera (§8b): 3 de 6 (n=6) evadieron el
  eje de imagen, y solo 2 de 6 se atraparon de forma fiable.
- Que el escenario `Pills` sobre vitaminas **no** se materializaba (§9).

O sea que el valor del despliegue no fue "quedó encendido": fue que el
contenido real produjo hallazgos que ninguna de las cuatro corridas de §6.7
—todas con fotos elegidas por nosotros— podía producir.

---

## 7. Orden y dependencias — mapa completo de olas

**Ola 0 — sin dependencias entre sí, se pueden correr en paralelo:**

- **A.** Corregir la contradicción de CLAUDE.md §3 sobre los umbrales.
  **Hecho.**
- **B.** Los frames en `relevo-app.html` (CLAUDE.md §0 regla 4 los exige
  antes del código). **Hecho.**
- **C.** `alter publication supabase_realtime add table public.listings`.
  Una línea, sin efecto observable hasta que alguien se suscriba. **Hecho**
  (`20260917000460`).
- **D.** La lista de palabras prohibidas + la función pura de decisión. TS
  puro, sin red, sin Supabase: la pieza más testeable y donde viven todas las
  reglas. **Hecho** (`decision.ts`, `palabras-prohibidas.ts`,
  `probe-moderacion.mjs`).
- **E-spike.** Qué modos de auth acepta `withSupabase`. Bloquea la Edge
  Function: decide cómo se autoriza el llamador. **Hecho** — ver §2 de este
  archivo.

**Ola 1 (depende de A, D, E + un paso manual): HECHA**, junto con sus dos
sub-olas — 1.5 (el `fetch` real a Vision y OpenAI, §6.3) y 1.6 (el camino de
avatares, §6.4). La Edge Function se podía escribir sin los secretos; el
end-to-end esperó a `supabase secrets set` (nombres decididos en §3.1) +
`supabase/functions/.env` local.
**Esta entrada decía "el cuerpo de `index.ts` en sí sigue sin escribirse", y
era falso desde el mismo 2026-09-18** (hoy son 699 líneas, medidas con `wc -l`).
Es la TERCERA línea rancia del mapa encontrada en la misma revisión, junto con
la de Ola 4 y la del enforcement de avatares — la misma moraleja que está escrita
abajo, en el bloque de Ola 4: **un mapa de olas es un plan, no un estado.**

**Ola 2 (depende de la función + F-spike): HECHA, y ACTIVA en prod desde
2026-09-19** (los dos secretos de Vault que la encendían ya están puestos —
ver la actualización más abajo). Los dos triggers de Storage (§1) viven en
`20260918000462_storage_moderacion_triggers.sql`, con sus cuatro aserciones
gratis en `probe-storage.mjs` y la escalada end-to-end en
`probe-moderacion-http.mjs` §6 (todo en §6.5).

- **F-spike. HECHO** (2026-09-18) — resultado completo y sus dos correcciones a
  este archivo en §1. Salió "UPDATE real sobre la misma fila", así que el diseño
  no cambió; lo que sí cambió es que un `move` SÍ dispara, al revés de lo que
  este archivo predecía.

- **LOS SECRETOS DE VAULT DE PRODUCCIÓN NO SE CREAN HASTA QUE OLA 3 ESTÉ
  COMPLETA.** Es una decisión, no un olvido, y es lo que hace que la fila de la
  tabla de estado diga "verificado en LOCAL" y no "Hecho" a secas. (Y hoy hay un
  paso ANTES incluso de ese: la migración sigue sin pushear — remoto tiene 25
  migraciones y ningún `objects_notify_moderacion%` en `pg_trigger`, medido.)

  **El motivo:** mientras `publicar.ts` siga creando las filas en `pausada`
  (`:286-291`), el skip de `pendiente` **no tiene a quién saltarse**, así que el
  trigger evaluaría DURANTE el alta y `decidirListing()` escalaría
  `pausada → bloqueada` ante un `bloquear`. Y una publicación `bloqueada` hoy es
  un **callejón sin salida** para su dueño, verificado archivo por archivo:

  | Qué hace el vendedor | Qué pasa realmente |
  |---|---|
  | Abre "Mis publicaciones" | **La ve** — `listings_select` tiene `or user_id = auth.uid()` |
  | Mira el chip de estado | **Vacío**: `ESTADO_LABEL` es un `Record` de 3 claves (`mis-publicaciones.tsx:63-67`) |
  | Toca "Reactivar" | 0 filas **sin lanzar** → *"No pudimos cambiar el estado"* (`:160`). Falso |
  | Abre "Editar publicación" | **El formulario se pinta entero**: el guard de `editar/[id].tsx:452` solo cubre `vendida` |
  | Guarda | *"Esta publicación ya se vendió"* (`editar/[id].tsx:385`). Mentira lisa |
  | Busca ayuda | **No hay**: RF-17 no existe |
  | Lo único que funciona | **Eliminarla** |

  **Y a cambio no se pierde nada:** Ola 2 no entrega ninguna funcionalidad al
  usuario por sí sola — todo su valor es quedar cableada para Ola 3. Activar los
  secretos antes no compra cobertura, compra riesgo.

  **ACTUALIZACIÓN (Ola 3 cerrada, 2026-09-19): el motivo de arriba ya no
  aplica, Y EL HUECO DE §1 TAMPOCO — la mitad de correctness se cerró
  (`unirFotoDisparadora()`), y queda solo la mitad de COSTO, que siempre fue una
  decisión aparte.** El callejón sin salida de la tabla está cerrado —
  `publicar.ts` crea en `pendiente`, el chip dice "En revisión"/"Bloqueada",
  "Reactivar" y "Editar" ya no se ofrecen, y Detalle pinta su `.notice`—, y la
  foto que dispara un evento ya se evalúa de verdad, incluso sin fila todavía
  (probado end-to-end en §1/§7 de este archivo, con OCR real).

  | Flujo | Requests pagos | ¿Correcto? |
  |---|---|---|
  | Publicar, 5 fotos | **2** (1 Vision + 1 OpenAI, del cliente) | sí — el skip de `pendiente` deja los 5 eventos en 0 |
  | Editar, reemplazando 5 fotos | **10** (5 Vision + 5 OpenAI, del trigger) | **sí, cada evento incluye la foto que lo disparó** — pero SIGUE costando 10: cada uno de los 5 eventos re-evalúa también las que ya se habían evaluado |
  | Sobrescribir una foto (`x-upsert`, solo desde Studio) | 2 | sí — es el caso que midió §6.5 |

  **Se optó por (i): encenderlos y aceptar el costo N-fold como deuda de §9
  con su disparador (debounce o mover el trigger)** — ejecutado 2026-09-19, ver
  arriba. La otra salida que se había planteado ("(ii)" dejarlos apagados hasta
  RF-17) queda registrada por si algún día hay que revertir, no como pendiente.

  **Y una tercera cosa a saber antes de encender, sin relación con el costo:**
  verificar el fix destapó un bug de manejo de errores, no del fix en sí —
  `moderarListing()` puede devolver un 500 CRUDO si intenta promover una
  publicación `pendiente` con 0 fotos reales (choca con
  `listings_enforce_activation_has_photos`). Es angosto —el flujo normal de
  Publicar siempre tiene ≥1 foto para cuando pide moderación— pero queda
  documentado con su disparador en §9, "La promoción de `moderarListing()`
  puede reventar con 500".

  **Exposición medida en remoto (2026-09-18)**, para que la decisión no dependa
  de una intuición: 6 cuentas, todas de alta entre el 09-07 y el 09-15, **cinco
  de ellas en dominios de correo personal** (hotmail/gmail/outlook) y una sola
  `@tec.mx` — o sea, el desarrollador y sus pruebas, no estudiantes ajenos. Pero
  53 publicaciones, todas de los últimos 30 días, 11 en los últimos 7 y la
  última ese mismo día: la ventana **no** es teórica.

  **Probabilidad de que alguien la pise: baja por los ejes deterministas,
  DESCONOCIDA por el de GPT**, y esa asimetría es lo que decide. Vision sobre un
  catálogo de libros y calculadoras: improbable. La lista de palabras:
  improbable **por diseño** (26 entradas, regla de admisión explícita, cuatro
  términos descartados por ambiguos). **`articulo_prohibido` de GPT es el eje que
  lee contexto y es un modelo, y su tasa de falsos positivos sobre este catálogo
  no está medida** — lo único medido es 5/5 `limpio` sobre UN par verificado
  (§6.3), que es un fixture, no una tasa.

  **El costo de esperar, que sí lo tiene:** un trigger que existe en prod y
  nunca dispara está sin probar en prod, y se ve idéntico a uno que funciona.
  Dos amarres: los dos `vault.create_secret` son un **paso explícito del
  checklist de Ola 3** (abajo), y el aviso está en el encabezado del SQL y en
  CLAUDE.md §8.

  **YA NO ES EL CASO: los dos secretos están creados en producción desde
  2026-09-19** (paso 4 del runbook de CLAUDE.md §8, ejecutado y remedido, no
  recordado):
  `select count(*) from vault.secrets where name in
  ('moderar_contenido_secret_key','moderar_contenido_function_url');` → **2**.
  Probado end-to-end en remoto: contenido limpio → `activa`; una palabra de la
  lista → `bloqueada`. Los dos confirmados en Studio.

**Ola 3 (depende de la función y de B): HECHA** (2026-09-19). El rework de
`publicar.ts` **+ el `with_check` de `listings_insert_own`, en el mismo cambio**
(§5 de este archivo); la UI de los estados nuevos (`ESTADO_LABEL`, los guards de
`alternarPausa()`, de "Editar publicación" y del `.sticky-cta` de Detalle,
`accionVenta()`); las dos pantallas de veredicto; y la suscripción de Realtime.
Se sumaron al alcance del plan dos piezas que su tabla de impacto no listaba —
`accionVenta()` y `detalle/[id].tsx`— y el guard del reintento de §5.1b.

**Y, como último paso de esa ola, los dos `vault.create_secret` en
PRODUCCIÓN: HECHO (2026-09-19)** (ver Ola 2 arriba). Es el paso que convirtió
"verificado en local" en "Hecho" — RF-18 protege de verdad en remoto, probado
con los dos veredictos reales.

**Ola 4 — y esta línea decía algo FALSO hasta 2026-09-21, que es la lección de
la ola.** Decía: *"Realtime en el cliente + su fallback por refetch (§4.1);
avatares (§1 cubre el trigger que los toca; el enforcement — borrar objeto +
`foto_url = null` — es el pendiente de esta ola)"*. **Las dos mitades ya estaban
hechas cuando se leyó**, y las dos contradecían a la tabla de estado del
encabezado de este mismo archivo:

- el enforcement de avatares es de la **Ola 1.6** (`moderarAvatar()` en
  `index.ts`, con sus 4 casos en §6.4) — esta línea es anterior a esa ola y
  nunca se actualizó;
- la suscripción de Realtime es de la **Ola 3** (`useVeredictoEnVivo()` en
  `src/lib/moderacion.ts`, consumida por `revision.tsx`), con los cuatro
  requisitos de §4.1 cumplidos.

O sea que planear Ola 4 desde esta línea habría reconstruido dos cosas que ya
existían. **Moraleja, hermana de la de los conteos de migraciones de CLAUDE.md
§3:** un mapa de olas es un plan, no un estado; cuando la prosa del plan y la
tabla de estado discrepan, **gana la tabla**, y antes de confiar en cualquiera
de las dos se mira el código.

**Lo que de verdad quedaba (2026-09-21), partido en lo que YA ESTÁ y lo que
NO — y este párrafo llegó a decir "y se hizo" de las dos cosas, que es
exactamente el error que esta misma sección acaba de documentar dos párrafos
más arriba:**

**Hecho, en código:**

1. **La observabilidad que hacía falta para poder verificar Realtime.**
   `.subscribe()` no llevaba callback de estado, así que un `CHANNEL_ERROR` era
   invisible y el piso del refetch entregaba el veredicto igual: una corrida de
   verificación habría salido verde sin haber probado Realtime en absoluto. Hoy
   se imprime el estado del canal y por qué vía llegó cada veredicto. Ver §4.1.
2. **El aviso del avatar borrado**, que era lo único que faltaba del lado del
   CLIENTE una vez que el enforcement ya existía: hasta entonces las iniciales
   volvían en silencio. Ver §8. **Nació con un bug** —un guard booleano que en
   un tab que no se desmonta era un pestillo permanente, así que solo avisaba el
   PRIMER avatar moderado de cada sesión—, cazado en pruebas manuales el mismo
   día y corregido guardando el path avisado en vez de un booleano. El detalle
   está en `cuenta-perfil.md`.

**Verificado a mano y en verde (2026-09-21), que es lo que CIERRA la ola.**
Ninguna de las dos corridas la puede dar por buena una sesión de IA
(CLAUDE.md §6), así que las hizo el usuario:

- **el runbook de Realtime (§4.2), sus TRES casos**, incluido el piso con la
  publicación apagada a propósito — el que se suele saltar por pedir SQL, y el
  único que prueba que el fallback existe;
- **el escenario de DOS eventos de moderación de avatar seguidos, con fotos
  distintas y sin reiniciar la app** (reiniciar remonta el tab y resetea el ref,
  o sea que habría pasado también con el bug viejo), más el control negativo del
  avatar limpio, que no debe avisar nada.

**Con eso, RF-18 queda cerrado de punta a punta.** Lo que sigue vivo son las
DEUDAS de §9 —decisiones tomadas, no trabajo pendiente— y ninguna bloquea nada.

**Lo importante del mapa:** C, D y los dos spikes no dependen de nada entre
sí y son los que más riesgo quitan más adelante — aunque se consuman en olas
distintas (E en la 1, F en la 2), los dos se pueden correr desde el primer
día. De las cinco piezas de Ola 0, cuatro ya están hechas; falta solo lo que
depende de ellas.

---

## 8. Avatares — resumen de implementación (la spec vive en CLAUDE.md §3)

**Implementado (Ola 1.6, 2026-09-18) — `moderarAvatar()` en `index.ts`, con
los tres casos del plan verificados end-to-end en §6.4.**

Comparten la Edge Function con las publicaciones, con verdict-application
distinta: el pipeline de imagen es idéntico (SafeSearch + OCR + la misma
lista) y separarlos duplicaría exactamente lo que no debe desincronizarse —
el mismo argumento por el que la lista de palabras prohibidas es una sola
(CLAUDE.md §3). En código, esto se resolvió parametrizando `evaluarFotos()`
por bucket en vez de escribir una segunda copia.

Enforcement binario, solo `VERY_LIKELY`: borrar el objeto + `foto_url = null`
→ el usuario vuelve a sus iniciales. `LIKELY` no hace nada — la razón
completa (no hay dónde encolarlo, se prefiere el riesgo de un avatar dudoso a
borrar contenido legítimo) ya está en CLAUDE.md §3.

Sin `pendiente` de avatar porque `users` no tiene columna de estado para la
foto y el bucket es público — crearlo invalidaría la premisa escrita que
justifica el bucket público (`cuenta-perfil.md:484-485`). Fuera de alcance de
RF-18, documentado como deuda ahí.

**El AVISO al usuario llegó después, en Ola 4 (2026-09-21), y es lo único que
faltaba de este camino del lado del cliente.** El enforcement estaba completo
desde Ola 1.6, pero las iniciales volvían **en silencio** y en momentos
distintos según la pantalla: en Perfil al reenfocar el tab, en el header del
Feed nunca (pinta `profile.foto_url` de la sesión, que solo mueve
`refreshProfile()`). Hoy `(tabs)/perfil.tsx` detecta la transición y avisa con un
toast, además de refrescar la sesión para que el Feed deje de pintar la foto ya
borrada. El detalle vive en `cuenta-perfil.md`; lo que importa saber desde aquí
son dos cosas:

- **La señal es inequívoca y por eso alcanza con compararla:** el ÚNICO
  productor de `foto_url = null` es `moderarAvatar()`. El cliente jamás escribe
  `null` ahí (`guardarFotoPerfil()` siempre escribe un path; `guardarPerfil()`
  ni incluye la columna).
- **Un toast NO exige frame** (CLAUDE.md §0 regla 4, la excepción explícita), y
  por eso esta pieza no tocó `relevo-app.html` ni el esquema. Lo que sí quedó
  abierto —un aviso que sobreviva a no verlo— sí los exigiría, y está como deuda
  con disparador en `cuenta-perfil.md`.
- **Y ese aviso persistente YA EXISTE (2026-09-24, RF-16 tanda 2,
  `20260928000473`).** `moderarAvatar()` inserta en `avatar_moderacion`
  `{user_id, storage_path, foto_url_nulificado}` en cada BORRADO (no cuando
  conserva), y el trigger `avatar_moderacion_notify`, con
  `WHEN (new.foto_url_nulificado)`, crea la fila `avatar_eliminado` del inbox.
  Si el guard de la carrera dejó intacto el avatar vigente, queda la fila de
  auditoría y no hay aviso. Un fallo del insert se grita y no tumba la
  respuesta. Cubierto en `probe-moderacion-avatares.mjs` (21 aserciones, 4
  nuevas); su control (quitar el insert) cae en las 4. Con esto, la línea de §6.4
  que decía "los avatares no escriben auditoría, su rastro es el console" ya no
  es cierta: escriben en SU tabla, no en `listing_moderacion`, y la aserción
  "cero filas nuevas en listing_moderacion" sigue valiendo.

---

## 8b. Limitación conocida: FALSOS NEGATIVOS de Rekognition

> **Esto NO es la deuda de §9, y la diferencia es estructural.** §9 es sobre
> falsos POSITIVOS (contenido legítimo marcado) y tiene disparador numérico
> porque **un falso positivo se auto-registra**: deja su fila con su etiqueta y
> se cuenta con SQL. Un falso NEGATIVO no deja nada — cuando AWS no devuelve
> etiqueta, no hay fila, ni columna, ni rastro. Por eso esto va como limitación
> aceptada y no como deuda con número: un "Revisar cuando N falsos negativos"
> sería **incontable por construcción**.

**Nota de una investigación CERRADA que salió del mismo lote:** una
publicación de esas pruebas quedó `bloqueada` por Vision con
`racy: VERY_LIKELY`, y se sospechó un falso positivo de SafeSearch. **No lo
era**: el desarrollador la subió con contenido sexual explícito a propósito
para verificar ese eje. El bloqueo fue correcto, la foto y la publicación ya se
borraron de producción, y no hay nada que arreglar ahí. Se deja escrito para
que nadie la reabra al ver la fila.

**El hallazgo, medido en producción el 2026-09-22** sobre las publicaciones de
prueba del desarrollador, y ampliado con fotos de Wikimedia llamando a AWS
directo con el firmador de producción:

**El mismo tipo de contenido da resultados dispares, y no es aleatorio: es que
ese contenido cae encima de la frontera de decisión del modelo.**

| Contenido | Confianza L1 de `Drugs & Tobacco` | Consecuencia |
|---|---|---|
| Cajetilla de cigarros | **99.9** | detecta sólido, siempre actúa |
| Pluma de vape (4 fotos distintas) | **98.1 / 60.8 / 51.6 / ninguna** | de "actúa" a "invisible" |

Los cigarros son robustos. **Las plumas de vape/wax están repartidas a lo ancho
del umbral**, incluso entre fotos del mismo objeto. Esa es la explicación del
síntoma "unas quedan en pendiente y otras pasan".

### La tasa medida: 3 de 6 (n=6), y solo 2 atrapadas de forma fiable

Ground truth confirmado por el desarrollador, que subió las publicaciones: **6
eran plumas de wax** (#76, #79, #80, #81, #82, #83) y **3 eran controles
legítimos** (calculadora #74, baraja #77, frasco de vitaminas #78). Los tres
controles dieron **cero** etiquetas de Rekognition, o sea ningún falso positivo
entre ellos.

| # | Título | Rekognition | Resultado |
|---|---|---|---|
| 80 | Plumas diferentes modelos | `Drugs & Tobacco` @99.5 | **pendiente** (rekognition) |
| 81 | Plumas W | `Drugs & Tobacco` @96.0 | **pendiente** (rekognition) |
| 82 | Libro Whale | `Drugs & Tobacco` @50.2 (no actúa) | pendiente (**gptTexto, y por azar** — ver abajo) |
| 76 | Plumas bic | — | **activa** |
| 79 | Libretas Bic | — | **activa** |
| 83 | Plumas Bic | — | **activa** |

**3 de 6 escaparon. El denominador va SIEMPRE explícito (n=6)** y no redondeado
a un porcentaje suelto: con seis casos esto es indicativo, no una tasa estable,
y citarlo como "50%" sin el n invitaría a tratarlo como medición estadística.

**Y el número bueno es peor que ese: solo 2 de 6 se atraparon de forma
FIABLE.** El tercero, #82, lo escaló GPT — y GPT sobre ESE texto exacto es una
moneda al aire. Medido corriendo el mismo título y descripción tres veces
contra la API real:

| Texto evaluado | 3 corridas |
|---|---|
| `Libro Whale` / `Libro whale barato` (**el caso real**) | `limpio` · `estafa_spam=posible` · `limpio` |
| `Libro azul` / `Libro azul barato` | limpio · limpio · limpio |
| `Libro Ballena` (Whale en español) | limpio · limpio · limpio |
| `Whale` / `Whale barato` (sin "libro") | `estafa_spam` · `articulo_prohibido` · `articulo_prohibido` |
| `Plumas bic` / `Plumas baratas` (control) | limpio · limpio · limpio |

Producción había dado `articulo_prohibido=posible`; o sea **cuatro
observaciones y tres respuestas distintas**. Lo que dispara es la palabra
**"Whale" en inglés** —"Ballena" y "azul" salen limpios siempre— y solo cuando
no queda diluida por "Libro". **#82 pudo haber quedado `activa` perfectamente.**

**Lo decisivo para no tocar el umbral de acción:** de las publicaciones de
prueba que pasaron a `activa`, **ninguna fue un "casi"**. Todas tenían ausencia
TOTAL de etiqueta en esa categoría. Bajar el umbral de acción de 70 a 55 —o a
51— **no habría atrapado ni una sola**, y sí habría convertido en escalada un
caso que hoy no lo es. El modo de falla no es "se quedó corto": es "el modelo
no lo vio".

### `MinConfidence`: propuesta CERRADA SIN ACCIÓN (2026-09-22)

> **Estado: cerrada. No se aplicó y no se debe reproponer sin datos nuevos.**
> El cambio era **seguro pero inútil**, según su propia medición — no es una
> deuda pendiente ni un "algún día": es una opción evaluada y descartada.

Se propuso bajar el piso de REGISTRO (50) sin tocar el de ACCIÓN (70), que son
independientes por diseño, para ganar visibilidad de casi-aciertos sin mover el
riesgo de falsos positivos. **La medición lo descartó:**

| `MinConfidence` | Tamaño de respuesta | Qué aparece de nuevo |
|---|---|---|
| 50 (actual) | 72-353 B | — |
| **20** | **idéntico, 0 bytes de más** | **NADA, en las 4 fotos probadas** |
| 0 | ~5,700-5,800 B (**16-80×**) | ruido de un dígito (`Gambling@2.6` sobre una baraja) |

En estas fotos no hay etiquetas entre 20 y 50: están arriba de 50 o en ruido
cerca de cero. O sea que **bajar a 20 es un no-op** y bajar a ~0 compra ruido,
no señal. Y sobre todo: **la banda 50-70 YA captura los casi-aciertos** — las
plumas a 51.6 y 60.8 se registran hoy sin actuar, que es exactamente lo que se
quería. El piso actual no es el que esconde los casos perdidos; los perdidos
están por debajo de donde hay señal utilizable.

**Ojo antes de reproponerlo:** nada en el parseo ni en `nivelDeRekognition()`
asume el piso de 50 (verificado con grep), así que el cambio es técnicamente
seguro — es **inútil**, no peligroso. Lo único que lo pinea es una aserción de
`probe-moderacion.mjs`, que existe justamente para que el cambio sea deliberado.

### El TÍTULO DISFRAZADO, y por qué debilita el consuelo de arriba

**Las publicaciones de wax que se escaparon no tenían título neutro por azar:
estaban disfrazadas de "Bic"** (confirmado por el desarrollador, que las subió
así a propósito). Eso importa más que el porcentaje, porque **desarma la otra
línea de defensa justo cuando más falta hace**:

- GPT evalúa "Plumas Bic" y ve un artículo de papelería. No hay nada que marcar.
- La lista de palabras no machea nada por el mismo motivo.
- El OCR solo ve lo impreso en la foto, que en una pluma de wax no dice "wax".

**HIPÓTESIS A VIGILAR (n=6, indicativa y NO concluyente): los tres que
escaparon son exactamente los tres que usaban el disfraz `Bic`.** Los que
usaron otro nombre ("Plumas W", "Plumas diferentes modelos", "Libro Whale")
fueron atrapados. La lectura es que hace falta que se cumplan **DOS condiciones
independientes a la vez**, no una:

1. que la foto quede por debajo del umbral del eje de imagen, y
2. que el título no le dé a GPT nada de qué agarrarse.

**Y hay un matiz mecánico que impide leer esto como "el disfraz engaña a la
moderación": el título NO puede influir en Rekognition, que solo ve la
imagen.** Así que `Bic` no causó la ceguera del eje de imagen — esa es de la
foto. Lo que un nombre de marca real y reconocible hace es satisfacer la
condición (2) **de forma fiable**, mientras que un nombre raro como "Whale" la
satisface solo a veces. Que las dos condiciones coincidieran justo en los tres
`Bic` puede ser causal o puede ser que se eligieran esas fotos para ese
disfraz; con n=6 no se distingue. **Se anota para vigilarla si RF-14 trae casos
reales**, no como conclusión.

O sea que **contra un evasor deliberado, el eje de imagen no es una de tres
líneas de defensa: es la ÚNICA**, y es precisamente el eje con la tasa de fuga
medida arriba. Una versión anterior de esta sección decía que el texto y el OCR
"sostienen la defensa mientras tanto"; eso es cierto para contenido subido sin
mala fe —el frasco de vitaminas escaló por `gptTexto`— y **falso para el caso
que la moderación existe para atrapar**.

### Qué SÍ sostiene la defensa mientras tanto, con su alcance honesto

- **El texto tecleado** (GPT + lista) atrapa lo que se describe con su nombre.
  Medido: dos publicaciones escalaron por `gptTexto` con Rekognition en cero.
  **No atrapa nada si el título miente.**
- **El OCR** compara lo impreso en la foto contra la misma lista, con techo en
  `pendiente`. Útil contra empaques con la palabra a la vista; inútil contra un
  objeto sin texto.
- `peor()` es monótona: que este eje se quede corto no absuelve a los otros —
  pero tampoco hace que los otros vean lo que no pueden ver.
- **El reporte de usuario (RF-14)** deja de ser un extra y pasa a ser la red
  principal para este caso.

**Revisar cuando** — sin número, porque no lo hay: si aparece un reporte de
usuario (RF-14) sobre contenido que pasó la moderación, la primera pregunta es
si este eje lo vio y en cuánto. La fila de `listing_moderacion` responde eso
gratis, y **ese** es el mecanismo de detección realista mientras RF-17 no
exista.

---

## 9. Deuda consciente de moderación — con disparador, no "algún día"

- **El umbral de Rekognition está topado en `revisar` y nunca bloquea solo.**
  Es decisión, no omisión: se tomó sin un solo dato medido de falsos positivos
  sobre este catálogo, y `bloqueada` no tiene recurso hoy (§7).

  **Revisar cuando** una categoría L1 acumule **50 publicaciones distintas**
  con etiqueta de esa categoría a confianza ≥ 70. **Por categoría y por
  separado** — `Drugs & Tobacco`, `Alcohol` y `Gambling` acumulan evidencia a
  ritmos distintos, así que la primera en llegar a 50 se revisa sola. Se mide
  con este comando, no se estima:

  ```sql
  select etiqueta->>'name' as categoria,
         count(distinct m.listing_id) as publicaciones
  from public.listing_moderacion m,
       jsonb_array_elements(m.detalle->'fotos') foto,
       jsonb_array_elements(foto->'rekognition') etiqueta
  where (etiqueta->>'taxonomy_level')::int = 1
    and (etiqueta->>'confidence')::numeric >= 70
  group by 1 order by 2 desc;
  ```

  **Por qué 50, con la cota que de verdad corresponde.** Todas las cotas de
  abajo son **Clopper–Pearson bilateral al 95%**, una sola convención para
  todas las celdas — ojo con la "regla de tres" (`3/n`), que da 6% para 0/50
  pero es la cota **unilateral**: mezclarla con una cota para 1 evento compara
  dos cosas distintas.

  | Observado en 50 | Cota superior real | Qué se hace |
  |---|---|---|
  | **0 falsos positivos** | **7.1%** | Subir a `bloquear` |
  | 1 falso positivo | **10.6%** | NO subir — seguir hasta 150 |
  | ≥2 falsos positivos | >13% | NO subir; el techo se queda |
  | 0-1 FP en 150 | ≤3.7% | Subir a `bloquear` |

  **La tolerancia es CERO a n=50**, y es deliberado: una versión anterior de
  esta entrada justificaba el 50 con la cota de cero eventos (6%) y a la vez
  permitía 1, cuya cota real es **10.6%** — casi el doble, y por encima de lo
  aceptable para una acción irreversible sin apelación. Un solo falso positivo
  no cierra la puerta, solo mueve la decisión a n=150, donde 1 evento cae en
  3.7%. A n=30 la cota con 0 eventos es 11.6%, demasiado alta para decidir.

  **Fix:** agregar la banda `bloquear` en `nivelDeRekognition()` **por
  categoría**, nunca para el eje entero — la evidencia de `Drugs & Tobacco` no
  dice nada sobre `Alcohol`.

  **PRIMERA EVIDENCIA REAL (2026-09-22), y corrige dos predicciones de esta
  misma entrada.** De las pruebas manuales en producción:

  - **Una `Silla gamer` recibió `Alcohol` @95.7** y quedó en `pendiente`. Es el
    **primer falso positivo medido de Rekognition**, y valida la preocupación —
    pero con `Alcohol`, no con la categoría que se temía. Cuenta 1 de las 50
    para esa categoría; con n=1 no decide nada, que es justo el punto del
    disparador.
  - **El escenario `Pills` sobre un frasco de vitaminas NO se materializó.** Un
    `Frasco vitaminas C` real dio **cero etiquetas** de Rekognition; lo que lo
    mandó a `pendiente` fue `gptTexto`, o sea el eje de TEXTO, por la palabra
    "vitaminas". La justificación del techo que citaba ese caso era plausible y
    resultó falsa en la primera prueba — el techo se sostiene igual, por el
    argumento general de no tener datos, y ahora por la silla.
  - **De regalo, un dato contraintuitivo:** la etiqueta L3 `Pills` **sí** se
    dispara… sobre una **cajetilla de cigarros** (`Pills@99.9` medido sobre una
    foto de Marlboro). O sea que esa etiqueta es más ruidosa de lo que su
    nombre sugiere. No afecta la decisión —solo miramos L1— pero desaconseja
    razonar sobre las L3 por su nombre.

  **Dos cosas honestas sobre este disparador.** (a) **Puede no sonar nunca a
  volumen actual, y está bien**: a ~60 publicaciones/mes, una categoría que
  aparezca en el 3% del catálogo tarda ~28 meses en llegar a 50. El techo es el
  default seguro, así que un disparador que no suena no cuesta nada — lo que
  costaría es lo contrario. (b) **El conteo solo existe porque se registra la
  banda 50-70**: si alguien "optimiza" `etiquetasParaAuditoria()` para guardar
  solo lo que superó el umbral de acción, este comando deja de poder calcular
  nada y la deuda se vuelve incobrable en silencio. Tiene aserción propia en el
  probe, con su control negativo (§6.6).

- ~~**El trigger de `listing-photos` evalúa el set ANTERIOR y nunca la foto que lo
  disparó.**~~ **CERRADA** (2026-09-19) — `unirFotoDisparadora()` en `vision.ts`,
  ver §1. Solo cerró la MITAD de correctness (la foto ahora SÍ se evalúa); la
  otra mitad queda abierta, ver la entrada siguiente.

- **Cada Editar sigue pagando N evaluaciones completas sobre el set VIEJO, una
  por foto nueva.** El fix de arriba cierra que la foto se evalúe; NO cierra el
  costo: editar reemplazando 5 fotos sigue disparando 5 eventos × (1 Vision + 1
  OpenAI) = **10 requests pagos**, cada uno re-evaluando también las fotos que
  YA se habían evaluado en el evento anterior. Es DECISIÓN, no una regresión del
  fix — se dejó fuera de alcance a propósito (no se pidió tocar el disparador ni
  agregar debounce). **Revisar cuando:** se autoricen los dos secretos de Vault
  en prod, o antes si aparece gasto inesperado en Vision/OpenAI. **Fix:**
  debounce (juntar varios eventos cercanos en una sola evaluación), o mover el
  disparador a `listing_photos` en vez de `storage.objects` — que a su vez
  pierde la cobertura de subidas directas al Storage API (el argumento de §1),
  así que no es un cambio libre.

- **La promoción de `moderarListing()` puede reventar con 500 si el piso de
  fotos lo bloquea — hallazgo nuevo, destapado al verificar el fix de arriba,
  sin relación con él.** Medido: una publicación `pendiente` con CERO fotos
  reales en `listing_photos`, evaluada limpia por el camino del CLIENTE
  (`puedePromover: true`), propone `decidirListing(..., 'pendiente') = 'activa'`
  — la única promoción que existe — y el `UPDATE {estado:'activa'}` que
  `moderarListing()` ejecuta para aplicarla choca con el trigger de la BASE
  `listings_enforce_activation_has_photos` (CLAUDE.md §3), que rechaza esa
  transición. El error crudo de Postgres —`"Una publicación no puede activarse
  sin fotos"`— se propaga tal cual: `if (errUpdate) return error(errUpdate.message,
  500)` no distingue "fallo de infraestructura" de "la base rechazó una
  transición inválida a propósito", así que el llamador recibe un 500 sin
  ninguna pista de qué pasó. Reproducido exacto (curl directo, sin el probe):
  activar el trigger sobre una `activa` sin fotos con una foto FALSA que falla
  al descargar → escala a `pendiente` (eje `no_evaluable → 'revisar'`, correcto)
  → la siguiente evaluación limpia por el cliente intenta promoverla → 500.
  **¿Es alcanzable en producción, y no solo en un test?** Sí, aunque angosto: el
  cliente solo pide moderación tras `guardarFotos()` con éxito TOTAL
  (`finalizarPublicacion()` corta antes si `hayFallos`), así que el flujo normal
  de Publicar siempre tiene ≥1 foto para cuando llama. El camino real es el del
  TRIGGER: si el `download()` de una foto genuina falla de forma transitoria
  (Storage caído un instante, el objeto se borra entre que sube y que el trigger
  corre), esa foto entra como `no_evaluable`, escala a `pendiente`, y si esa
  publicación tenía 0 fotos EN LA BASE en ese momento (ej. era la primera y
  única, y algo la borró después), la próxima evaluación limpia por cualquier
  camino queda atrapada devolviendo 500 en vez de quedarse en `pendiente`.
  **Revisar cuando:** aparezca un 500 real de `moderar-contenido` en los logs de
  producción con ese mensaje. **Fix:** que `moderarListing()` distinga ese
  SQLSTATE (o el texto del mensaje) del resto de errores de UPDATE, y en ese
  caso se quede en el estado actual en vez de propagar un 500 — la falla es
  segura de cualquier forma (`pendiente` no es público), así que no hace falta
  que sea ruidosa hacia el llamador.

- **Toda re-evaluación vuelve a tirar el dado de GPT sobre texto que no cambió.**
  `veredicto()` mezcla tres ejes deterministas con uno que es un modelo, y
  `evaluarListing()` los corre todos siempre, así que agregarle una foto a una
  publicación aprobada puede degradarla a `pendiente` por el TEXTO, sin que el
  texto se haya tocado. El guard de §5.1b cierra el reintento del CLIENTE; esto
  queda abierto para el camino del trigger. **Revisar cuando:** aparezca una fila
  en `listing_moderacion` con `eje_que_manda = 'gptTexto'` sobre una publicación
  que ya había salido `limpio` antes con el mismo título y descripción.
  **Fix:** que el camino `authMode === 'secret'` no llame a OpenAI (un evento de
  Storage es sobre una IMAGEN; el texto ya lo evaluó el alta), dejando `gptTexto`
  fuera de `Ejes` en esa rama — ojo, cambia lo que asienta §6.3 y hay que
  remedirlo.

- **La cola de `pendiente` mezcla dos cosas.** "La cola" es literalmente
  `estado = 'pendiente'` sobre `listings` (CLAUDE.md §3), y ahí caen tanto las
  publicaciones que la moderación marcó como las abandonadas a media subida (la
  falla segura de §1: el usuario cierra la app y la llamada final nunca llega).
  Para el revisor son indistinguibles a simple vista. **Revisar cuando:** la cola
  pase de un puñado de filas. **Fix:** filtrar por
  `exists (select 1 from listing_moderacion m where m.listing_id = l.id)`, que
  solo tienen las primeras — o esperar a RF-17, que es donde esa vista vive.
