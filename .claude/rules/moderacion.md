---
paths:
  - "supabase/functions/moderar-contenido/**"
  - "scripts/probe-moderacion.mjs"
  - "scripts/probe-moderacion-http.mjs"
  - "scripts/probe-moderacion-red.mjs"
  - "supabase/migrations/*listing_status_moderacion*.sql"
  - "supabase/migrations/*listings_estados_no_publicos*.sql"
  - "supabase/migrations/*listings_realtime*.sql"
  - "supabase/migrations/*listing_moderacion*.sql"
  - "src/lib/publicar.ts"
  - "src/lib/storage.ts"
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

> Actualizado 2026-09-18 (segunda vez el mismo día: credenciales reales
> puestas y Ola 1.5 cerrada). Las filas que dicen **Hecho** se midieron contra
> el repo, no se recuerdan.

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
| Enforcement de avatares (`moderarAvatar()`) | **Pendiente — Ola 1.6, sigue siendo stub que conserva siempre** | `index.ts` |
| Los dos triggers de Storage | **Pendiente** | sin migración todavía |
| El rework de `publicar.ts` (nace `pendiente`, ya no activa él mismo) | **Pendiente** | — |
| El `with_check` de `listings_insert_own` forzando `pendiente` | **Pendiente** | deuda ya documentada en `publicar-fotos.md` |
| Suscripción de Realtime en el cliente | **Pendiente** | — |

**Con esto, RF-18 modera publicaciones reales de punta a punta** —el único
hueco funcional que queda es que nada en la app TODAVÍA llama a esta función
(`publicar.ts` sigue sin el rework) y que un avatar sucio no se borra solo.
Los ocho casos de verificación que dependían de red real (4 parcial, 5, 6, 7,
8, 9, 13, y el probe de autorización re-verificado con evaluación real) están
en §6.3, con sus controles negativos.

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

### Contingente del F-spike: si `upsert` resulta ser DELETE+INSERT

El F-spike (medir si `move` cambia `version` y si un upsert es UPDATE real,
DELETE+INSERT, o ninguna de las dos) todavía no se corrió al migrar esto. Los
cuatro resultados posibles y qué hace cada uno con el diseño de arriba:

| Resultado del spike | Qué arma caza el overwrite | Qué hay que cambiar |
|---|---|---|
| UPDATE real sobre la misma fila | la rama UPDATE (`version` distinta) | nada |
| DELETE + INSERT | **la rama INSERT** | nada en la lógica; sí en las pruebas y en un tripwire |
| `move` no cambia `version` | ninguna (y está bien: un move no cambia el contenido) | nada, pero hay que anotarlo |
| **UPDATE pero `version` NO cambia** | **ninguna — el overwrite queda descubierto** | el `WHEN` está mal: comparar `old.metadata` (lleva el `eTag`) o soltar la condición |

**Conclusión, y es más tranquila de lo que parece: si sale DELETE+INSERT no
hace falta discriminar alta de reemplazo.** El discriminador que de verdad
importa ya está puesto, y es otro: **el skip de `pendiente`** (ver §1.3 más
abajo).

- Durante el alta, la publicación está en `pendiente` → el trigger se salta el
  evento **venga como venga** (INSERT, UPDATE o D+I). La llamada final la
  evalúa entera.
- Después de decidida (`activa`/`pausada`/`bloqueada`), **cualquier** evento
  de objeto sobre esa publicación se evalúa. Y ahí alta y reemplazo
  **necesitan exactamente el mismo tratamiento**: una foto agregada al editar
  una publicación viva hay que moderarla igual que una sobrescrita. No hay
  decisión que ramificar.
- Avatares: siempre se evalúan. Tampoco hay nada que distinguir.

**El riesgo real de que salga D+I no es un hueco de lógica, es uno de
mantenimiento:** la rama UPDATE quedaría como código que no dispara nunca para
el caso que la motivó, y alguien podría después "optimizar" la rama INSERT con
un guard tipo *"solo objetos nuevos"* y matar la cobertura del overwrite sin
que nada falle. Se cubre con dos cosas, no con una rama nueva:

1. **La aserción se escribe sobre el RESULTADO, no sobre qué trigger
   disparó**: *"sobrescribir una foto de una publicación `activa` la
   escala"*. Así vale idéntica bajo los tres resultados del spike, y sigue en
   verde si Storage cambia de implementación en una actualización.
2. **Un comentario-tripwire en la rama INSERT** diciendo que también es el
   camino del overwrite cuando el upsert es D+I, con el resultado del spike
   anotado y fechado.

**La cuarta salida del F-spike importa aparte de todo esto:** si un overwrite
NO cambia `version` en absoluto, ni la rama UPDATE (`WHEN` no dispara) ni la
INSERT (no hubo insert) lo ven, y el overwrite queda **sin cobertura** — no es
un problema de lógica de negocio, es que el `WHEN` está mal escrito. El fix
sería comparar `old.metadata` (que lleva el `eTag`) en vez de `version`, o
soltar la condición y aceptar re-evaluar en cada UPDATE. Es la razón concreta
por la que el F-spike va ANTES de escribir el SQL final y no después.

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

`index.ts` **ya existe, como ESQUELETO** (2026-09-18). Tiene completos el
ruteo por `ctx.authMode`, el chequeo de ownership del camino `'user'`, el guard
de `esPromocion()`, la escritura del estado con su `if` anti-`set_updated_at` y
la fila de auditoría en `listing_moderacion`. Lo que le falta es la EVALUACIÓN:
`evaluarListing()` y `moderarAvatar()` son stubs. **Los stubs fallan seguro en
la dirección de cada camino, y las dos direcciones son opuestas a propósito:**
una publicación sin evaluar reporta los cuatro ejes como `'revisar'` y termina
en `pendiente` (inútil pero nunca peligrosa — un stub que devolviera `'limpio'`
publicaría sin mirar); un avatar sin evaluar se CONSERVA, porque
`decidirAvatar()` solo borra con `bloquear` y un stub que borrara sería
destructivo e irreversible.

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
| **`ESTADO_LABEL`** | `mis-publicaciones.tsx:63-67` | **Fallo silencioso**: `ESTADO_LABEL['pendiente']` es `undefined` → RN pinta cadena vacía. Una bloqueada se ve como una pausada con un glitch. | Ampliar el `Record`. Ojo con `:295`: `ESTADO_LABEL[filtro].toLowerCase()` **crashea** si se agrega un chip sin tocar el mapa. |
| **Firmas de tipo** | `listings.ts:619`, `:689`, `:128`, `:410`; `mis-publicaciones.tsx:53` | No admiten los estados nuevos; el enum de la base sí. | Abrir las cinco. |
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

- **Triggers:** las dos ramas por separado, por el Storage API real —
  (1) objeto nuevo → invocación; (2) **sobrescribir con `upsert: true` un
  objeto de una publicación ya `activa` → tiene que escalar**, que es la
  aserción que justifica la rama UPDATE; (3) confirmar que una subida a una
  publicación `pendiente` **no** dispara HTTP (§1.3 de este archivo). Va en
  `probe-storage.mjs`, no en `rls.sql`: el comportamiento real del API solo
  se ve por HTTP.
- **Rework de `publicar.ts`:** `rls.sql` entero (167 aserciones a la fecha de
  este archivo) + los dos probes existentes + una T25 nueva para el
  `with_check` del INSERT, con su control negativo corrido por separado.
- **Realtime:** publicar, ver la pantalla de revisión, mover el estado a
  mano desde Studio, confirmar que llega. **Y confirmar el fallback con
  Realtime apagado a propósito** — probar solo el camino feliz no dice si el
  piso existe.
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

**Ola 2 (depende de la función + F-spike):** los dos triggers de Storage
(§1 de este archivo).

- **F-spike.** Medir si `move` cambia `version` y si un upsert es UPDATE,
  DELETE+INSERT, o ninguna de las dos, con un trigger sonda. **Todavía sin
  correr.**

  Confirmado que NO bloquea la Edge Function: la función recibe `tg_op` pero
  no ramifica sobre él — re-evalúa la entidad completa y, por el camino del
  trigger, solo puede escalar. Ni la lógica, ni el payload, ni la
  idempotencia cambian según el resultado. Su único consumidor es el
  comentario-tripwire de la rama INSERT del trigger, que es Ola 2 — por eso
  el spike se corre en esa ola y no antes.

**Ola 3 (depende de la función y de B):** el rework de `publicar.ts` **+ el
`with_check` de `listings_insert_own`, en el mismo cambio** (§5 de este
archivo); y la UI de los estados nuevos (`ESTADO_LABEL`, los guards de
`alternarPausa()` y de "Editar publicación").

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

Comparten la Edge Function con las publicaciones, con verdict-application
distinta: el pipeline de imagen es idéntico (SafeSearch + OCR + la misma
lista) y separarlos duplicaría exactamente lo que no debe desincronizarse —
el mismo argumento por el que la lista de palabras prohibidas es una sola
(CLAUDE.md §3).

Enforcement binario, solo `VERY_LIKELY`: borrar el objeto + `foto_url = null`
→ el usuario vuelve a sus iniciales. `LIKELY` no hace nada — la razón
completa (no hay dónde encolarlo, se prefiere el riesgo de un avatar dudoso a
borrar contenido legítimo) ya está en CLAUDE.md §3.

Sin `pendiente` de avatar porque `users` no tiene columna de estado para la
foto y el bucket es público — crearlo invalidaría la premisa escrita que
justifica el bucket público (`cuenta-perfil.md:484-485`). Fuera de alcance de
RF-18, documentado como deuda ahí.
