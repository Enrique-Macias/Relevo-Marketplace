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
| Función pura de decisión (los 4 ejes, la regla del piso, la asimetría) | **Hecho** | `supabase/functions/moderar-contenido/decision.ts` |
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
| **El `fetch` real a Vision y a OpenAI** (Ola 1.5) | **Hecho, con credenciales reales puestas** | `index.ts`, `llamarLoteVision()` / `evaluarTexto()` |
| **La descarga desde Storage + `encodeBase64`** | **Hecho** | `index.ts`, `evaluarFotos()` |
| **Armar los `Ejes` + `decidirListing()` + escritura + auditoría, para PUBLICACIONES** | **Hecho, con el guard de promoción probado end-to-end (§6.3)** | `index.ts`, `evaluarListing()` |
| **Enforcement de avatares** (`moderarAvatar()`): descarga, Vision, `decidirAvatar()`, borrado + guard de la carrera | **Hecho, con el guard de la carrera probado end-to-end (§6.4)** | `index.ts`, `moderarAvatar()` |
| Los dos triggers de Storage | **Hecho y verificado en LOCAL; en remoto ni siquiera pusheados — y los secretos van en Ola 3** | `supabase/migrations/20260918000462_storage_moderacion_triggers.sql` + `probe-storage.mjs` §moderación |
| El rework de `publicar.ts` (nace `pendiente`, ya no activa él mismo) | **Hecho** (Ola 3) | `src/lib/publicar.ts`, `src/lib/moderacion.ts` |
| El `with_check` de `listings_insert_own` forzando `pendiente` | **Hecho** (Ola 3) | `supabase/migrations/20260919000463_listings_insert_pendiente.sql` + T25 |
| UI de los estados nuevos (chips, guards, el 4º reparto de Detalle) | **Hecho** (Ola 3) | `mis-publicaciones.tsx`, `editar/[id].tsx`, `detalle/[id].tsx`, `confianza.ts` |
| Las dos pantallas de veredicto | **Hecho** (Ola 3) | `(publicar)/revision.tsx`, `(publicar)/no-aprobada.tsx` |
| Suscripción de Realtime en el cliente | **Hecho** (Ola 3) | `useVeredictoEnVivo()` en `src/lib/moderacion.ts`, consumida por `revision.tsx` |
| `unirFotoDisparadora()`: la foto sin fila SE evalúa | **Hecho** (2026-09-19), verificado con OCR real end-to-end | `vision.ts` + `probe-moderacion.mjs` (pura) + `probe-moderacion-http.mjs` §7 |
| **La Edge Function desplegada en REMOTO** | **NO** — `list_edge_functions` devuelve solo `send-push` | CLAUDE.md §8, pendiente 2 |

**Con esto, `moderar-contenido` modera publicaciones Y avatares reales de
punta a punta, y desde la Ola 2 los dos triggers de Storage la disparan solos al
entrar un objeto** — verificado end-to-end: sobrescribir la foto de una
publicación `activa` la escala a `bloqueada` (§6.5).

**PERO EN PRODUCCIÓN TODAVÍA NO PROTEGE NADA, Y YA NO ES POR EL MISMO MOTIVO.**
Ola 3 está completa, así que el hueco funcional que este párrafo señalaba —el
rework de `publicar.ts`— se cerró. Lo que queda es de DESPLIEGUE, y son cuatro
pasos manuales que no se han dado (CLAUDE.md §8, pendiente 2): la Edge Function
**nunca se desplegó a remoto** (medido con `list_edge_functions`: allá solo vive
`send-push`), sus dos credenciales no están puestas, la migración del
`with_check` no se ha pusheado, y los dos secretos de Vault siguen en 0 — así
que allá `private.notify_moderacion()` levanta un `warning` y no llama a nadie.
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
publicación sin evaluar reportaba los cuatro ejes como `'revisar'` y
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

### 6.2. El resto, todavía sin correr

- **Triggers: HECHO**, y partido en dos scripts con costos distintos — el
  detalle completo, con los cinco controles negativos, en §6.5.
- **Rework de `publicar.ts`: HECHO** (Ola 3). `rls.sql` entero —177 aserciones,
  medido con su comando, no recordado— con **T25 nueva (8) para el `with_check`
  del INSERT** y sus cuatro variantes rotas corridas una a la vez; más
  `probe-storage.mjs` (21) y `probe-venta.mjs` (13), que **no debían moverse** y
  no se movieron: sus fixtures insertan con la secret key, así que un rojo ahí
  habría significado que el `with_check` estaba atrapando a `service_role`. La
  tabla de qué variante cae en qué aserción está en CLAUDE.md §3.
- **Realtime: PENDIENTE de correrse a mano**, y es lo único de Ola 3 que no se
  puede verificar desde aquí. Publicar, ver la pantalla de revisión, mover el
  estado a mano desde Studio, confirmar que llega. **Y confirmar el fallback con
  Realtime apagado a propósito** (`alter publication supabase_realtime drop
  table public.listings`, con `pg_publication_tables` antes y después) — probar
  solo el camino feliz no dice si el piso existe.
- **`C` (la migración de Realtime ya aplicada):** `select * from
  pg_publication_tables where pubname='supabase_realtime'` antes y después —
  ya corrido una vez al aplicar `20260917000460`, repetible.

### 6.3. Ola 1.5 (fetch real a Vision/OpenAI) — los ocho casos que dependían de red, corridos con credenciales reales (2026-09-18)

**Tres scripts, tres alcances distintos, y ninguno sustituye a los otros:**

| Script | Qué prueba | ¿Cuesta dinero? | ¿Necesita servidor? |
|---|---|---|---|
| `probe-moderacion.mjs` | DECISIONES puras (120 aserciones) | No | No |
| `probe-moderacion-http.mjs` | AUTORIZACIÓN/CABLEADO (16) | **Sí, desde la Ola 1.5** | Sí |
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

**Ola 1 (depende de A, D, E + un paso manual):** la Edge Function
(`index.ts`). Se puede escribir sin los secretos; no se prueba end-to-end
hasta `supabase secrets set` (nombres ya decididos, ver §3.1 — hecho) +
`supabase/functions/.env` local (plantilla ya creada — hecho). **El cuerpo
de `index.ts` en sí sigue sin escribirse.**

**Ola 2 (depende de la función + F-spike): HECHO EN EL ESQUEMA, INERTE EN
PROD.** Los dos triggers de Storage (§1) viven en
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

  Dos salidas, no tres — la que pedía "arreglar primero el `name`" ya está
  hecha: **(i)** encender igual y aceptar el costo N-fold como deuda de §9 con
  su disparador (debounce o mover el trigger); **(ii)** dejarlos apagados hasta
  que exista RF-17, que es quien revisaría la cola de todos modos. **Todo Ola 3
  funciona igual sin los secretos**: lo único apagado es la re-moderación
  automática de Storage.

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
  CLAUDE.md §8. Verificación de que sigue inerte, en remoto:
  `select count(*) from vault.secrets where name in
  ('moderar_contenido_secret_key','moderar_contenido_function_url');` → 0.

**Ola 3 (depende de la función y de B): HECHA** (2026-09-19). El rework de
`publicar.ts` **+ el `with_check` de `listings_insert_own`, en el mismo cambio**
(§5 de este archivo); la UI de los estados nuevos (`ESTADO_LABEL`, los guards de
`alternarPausa()`, de "Editar publicación" y del `.sticky-cta` de Detalle,
`accionVenta()`); las dos pantallas de veredicto; y la suscripción de Realtime.
Se sumaron al alcance del plan dos piezas que su tabla de impacto no listaba —
`accionVenta()` y `detalle/[id].tsx`— y el guard del reintento de §5.1b.

**Y, como último paso de esa ola —no antes—, los dos `vault.create_secret` en
PRODUCCIÓN** (ver Ola 2 arriba). Hasta que se creen, la moderación automática de
Storage no protege nada en remoto. Es el paso que convierte "verificado en
local" en "Hecho".

**Ola 4:** Realtime en el cliente + su fallback por refetch (§4.1); avatares
(§1 cubre el trigger que los toca; el enforcement — borrar objeto + `foto_url
= null` — es el pendiente de esta ola).

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

---

## 9. Deuda consciente de moderación — con disparador, no "algún día"

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
