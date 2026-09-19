// ===========================================================================
// Relevo — prueba de punta a punta de la RLS del bucket `listing-photos`.
//
// Cómo correrlo (local, con el stack arriba):
//     supabase start           # o supabase db reset
//     node scripts/probe-storage.mjs
//
// POR QUÉ EXISTE, SI YA HAY UNA SUITE DE RLS:
// supabase/tests/rls.sql prueba las POLICIES insertando en storage.objects por
// SQL. Este script prueba que el SERVICIO de Storage las aplique sobre HTTP, que
// es como las va a tocar la app. No es redundante: hay cosas que solo se ven
// aquí.
//   - DELETE no se puede probar por SQL: el trigger storage.protect_delete de
//     Supabase aborta cualquier borrado directo antes de que la RLS opine. Una
//     aserción en la suite pasaría con la policy borrada — por la razón
//     equivocada. La cobertura real de listing_photos_objects_delete_own vive
//     AQUÍ.
//   - Lo mismo con `move`, que es lo que ejercita el with_check de UPDATE: sin
//     él, un dueño puede renombrar su objeto hacia la carpeta de un listing
//     ajeno y plantarle una foto a otra persona.
//   - Y el endpoint /object/authenticated/, que es el camino real de lectura del
//     cliente (ver CLAUDE.md §9 sobre por qué no signed URLs).
//
// La aserción que más importa es "un ajeno NO lee la foto de una publicación
// pausada": es la regla por la que el bucket es privado. Si alguien afloja las
// policies, pone el bucket público, o migra la lectura a signed URLs —que
// evalúan la RLS al firmar y no al servir—, esa línea es la que lo caza.
//
// Sin dependencias: fetch nativo contra la API HTTP, a propósito. Meter
// supabase-js aquí probaría el cliente, no el servicio.
//
// MODERACIÓN AUTOMÁTICA (RF-18, Ola 2). La última sección cubre los dos triggers
// de `storage.objects`. No necesita `supabase functions serve` ni credenciales
// de Vision/OpenAI y no cuesta dinero: repunta los dos secretos de Vault a un
// listener local y los restaura al terminar. El detalle está junto a los
// helpers, más abajo.
//
//   CONTROLES NEGATIVOS, corridos UNO A LA VEZ el 2026-09-18, cada uno contra
//   este script completo. Es la tabla que dice si estas aserciones prueban lo
//   que dicen:
//
//     sin el trigger de INSERT ....... (a) y (d); y (c) cae con su mensaje de
//                                      "la BARRERA no llegó: no concluyente"
//     sin el trigger de UPDATE ....... SOLO (b)
//     sin el skip de `pendiente` ..... SOLO (c)
//     el skip también en `avatars` ... SOLO (d)
//     sin `old.version is distinct
//       from new.version` ............ **NADA: las 21 pasan**
//
//   Esa última fila es un resultado, no un hueco por llenar: el guard de
//   `version` NO filtra ningún ruido medido hoy (3 lecturas por
//   `/object/authenticated/` y 3 por `/object/info/` -> 0 eventos de trigger).
//   Existe como defensa declarada para UPDATEs futuros que no cambien el
//   contenido, igual que el `estado <> 'pausada'` redundante de
//   `listing_photos_objects_select`. No le busques control negativo: no lo
//   tiene, y está escrito así a propósito.
//
// Crea sus propios usuarios y publicaciones, con correos únicos por corrida, y
// limpia en un `finally`. Si una corrida muere de golpe puede dejar basura en la
// base LOCAL; `supabase db reset` la borra — y para los secretos de Vault, que
// viven fuera de ese reset, el `finally` los restaura antes que nada.
// ===========================================================================

import { execFileSync } from 'node:child_process';
import http from 'node:http';

const BUCKET = 'listing-photos';
const BUCKET_AVATARS = 'avatars';
const RUN = Date.now();

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function env() {
  const raw = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  const out = {};
  for (const line of raw.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, '');
  }
  return out;
}

let pasadas = 0;
const fallos = [];

// Códigos de rechazo aceptados. Es un CONJUNTO y no un número exacto a propósito:
// Storage ha devuelto 400, 403 y 404 para "no autorizado" según la versión, y
// clavar uno solo haría que la prueba se rompiera al actualizar el stack por una
// razón que no es la que nos importa. Un 5xx o un 200 sí fallan.
const RECHAZOS = [400, 401, 403, 404];

function ok(nombre, cond, detalle) {
  if (cond) {
    pasadas++;
    console.log(`  ok — ${nombre}${detalle ? ` (${detalle})` : ''}`);
  } else {
    fallos.push(nombre);
    console.log(`  FALLÓ — ${nombre}${detalle ? ` (${detalle})` : ''}`);
  }
}

function permitido(nombre, res) {
  ok(nombre, res.status >= 200 && res.status < 300, `HTTP ${res.status}`);
}

function denegado(nombre, res) {
  ok(nombre, RECHAZOS.includes(res.status), `HTTP ${res.status}`);
}

// ---------------------------------------------------------------------------
// Llamadas a la API
// ---------------------------------------------------------------------------

async function crearUsuario(E, correo) {
  const res = await fetch(`${E.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`,
               'Content-Type': 'application/json' },
    // Este probe es INMUNE a `minimum_password_length` (supabase/config.toml), y no
    // por los 10 caracteres de `probe-1234`: el admin API está EXENTO de esa
    // validación. Medido contra el stack local con el mínimo en 8 — `signup` y
    // `PUT /user` devuelven 422 `weak_password` con 7 caracteres, y este mismo
    // `POST /admin/users` devuelve 200. El corte es por llave, no por endpoint: lo
    // que exige la secret key no valida fortaleza. Ver CLAUDE.md §9.
    body: JSON.stringify({ email: correo, password: 'probe-1234', email_confirm: true }),
  });
  if (!res.ok) throw new Error(`crearUsuario ${correo}: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

async function token(E, correo) {
  const res = await fetch(`${E.API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: E.PUBLISHABLE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password: 'probe-1234' }),
  });
  if (!res.ok) throw new Error(`token ${correo}: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

// Las publicaciones se crean con la secret key (salta RLS), igual que
// dev-listings.sql: `authenticated` no puede insertar en nombre de otro.
async function crearListing(E, userId, titulo, estado) {
  const res = await fetch(`${E.API_URL}/rest/v1/listings`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`,
               'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, categoria_id: 1, universidad_id: 1,
                           campus_id: 1, titulo, precio: 100, condicion: 'nuevo', estado }),
  });
  if (!res.ok) throw new Error(`crearListing ${titulo}: ${res.status} ${await res.text()}`);
  return (await res.json())[0].id;
}

// Los cuatro helpers toman el bucket: el proyecto tiene DOS y son de
// visibilidad opuesta (`listing-photos` privado, `avatars` público).
// `extra` existe para `x-upsert: true`, que es lo que ejercita la rama UPDATE de
// los triggers de moderación. Default `{}`: los call sites de arriba no cambian.
const subir = (E, tok, ruta, bucket = BUCKET, extra = {}) =>
  fetch(`${E.API_URL}/storage/v1/object/${bucket}/${ruta}`, {
    method: 'POST',
    headers: { apikey: E.PUBLISHABLE, Authorization: `Bearer ${tok}`,
               'Content-Type': 'image/jpeg', ...extra },
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9]),
  });

// El camino real de lectura del cliente: endpoint autenticado + header, no una
// URL firmada. La policy se re-evalúa en CADA request.
const leer = (E, tok, ruta, bucket = BUCKET) =>
  fetch(`${E.API_URL}/storage/v1/object/authenticated/${bucket}/${ruta}`, {
    headers: { apikey: E.PUBLISHABLE, Authorization: `Bearer ${tok}` },
  });

// OJO: este es el endpoint de UN objeto, y NO es el que usa el cliente.
// `supabase.storage.from(b).remove([...])` pega al de abajo, `removeJs`, que
// falla de otra manera — ver su comentario. Los dos se ejercitan a propósito.
const borrar = (E, tok, ruta, bucket = BUCKET) =>
  fetch(`${E.API_URL}/storage/v1/object/${bucket}/${ruta}`, {
    method: 'DELETE',
    headers: { apikey: E.PUBLISHABLE, Authorization: `Bearer ${tok}` },
  });

/**
 * Lo que de verdad hace `supabase-js` al borrar: DELETE al BUCKET con un body
 * de `prefixes`. Importa distinguirlo del de arriba porque NO fallan igual —
 * medido: sin visibilidad de SELECT sobre el objeto, éste responde **200 con un
 * array vacío** y deja el archivo intacto, mientras que el de un solo objeto
 * contesta 400 `AccessDenied`. Ver CLAUDE.md §9.
 *
 * Consecuencia para las aserciones: un `permitido(res)` sobre esta llamada
 * pasaría en verde con la policy de SELECT borrada. Hay que contar objetos.
 */
const removeJs = (E, tok, rutas, bucket = BUCKET) =>
  fetch(`${E.API_URL}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: { apikey: E.PUBLISHABLE, Authorization: `Bearer ${tok}`,
               'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: rutas }),
  });

/** Lectura pública: sin `apikey` y sin `Authorization`. Eso ES "público". */
const leerPublico = (E, ruta, bucket) =>
  fetch(`${E.API_URL}/storage/v1/object/public/${bucket}/${ruta}`);

/** `list` del bucket. Con la publishable a secas se ejecuta como `anon`. */
const listar = (E, auth, bucket) =>
  fetch(`${E.API_URL}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: { apikey: E.PUBLISHABLE, Authorization: `Bearer ${auth}`,
               'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: '', limit: 100, offset: 0 }),
  });

// ---------------------------------------------------------------------------
// Moderación automática (RF-18, Ola 2): el mock y el repunte de Vault
// ---------------------------------------------------------------------------
//
// CÓMO SE INTERCEPTA LA LLAMADA DEL TRIGGER SIN `supabase functions serve`, y
// por qué sale MÁS BARATO que los casos 6-8 de `.claude/rules/moderacion.md`
// §6.3: aquellos tenían que editar `ENDPOINT_VISION` en el FUENTE y reiniciar
// el servidor, porque es una constante de un `.ts`. Aquí la URL de la función
// vive en una FILA DE VAULT, así que este script la repunta con SQL en runtime
// y la restaura en el `finally` — sin editar fuente, sin reiniciar nada, sin
// credenciales de Vision/OpenAI y sin gastar un centavo.
//
// PRECONDICIÓN MEDIDA (2026-09-18), no supuesta: `net.http_post` DESDE EL
// CONTENEDOR DE POSTGRES alcanza `host.docker.internal` — status 200 en
// `net._http_response`, y el listener recibió el body exacto y el header
// `apikey`. CLAUDE.md §9 solo tenía medido ese nombre desde el contenedor del
// EDGE RUNTIME; esto lo extiende al de la base.
//
// POR QUÉ `docker exec psql` Y NO HTTP, en un script que presume de no usar
// nada más que `fetch`: `vault` no es un esquema expuesto al Data API —y no
// debe serlo, `rls.sql` tiene una aserción de que `authenticated` no lo toca—,
// así que no hay endpoint que llamar. Es la misma vía que el runbook de la
// suite de RLS (CLAUDE.md §6, paso 1).
const DB_CONTAINER = 'supabase_db_relevo-marketplace';
const SECRETO_KEY = 'moderar_contenido_secret_key';
const SECRETO_URL = 'moderar_contenido_function_url';

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

function sql(q) {
  return execFileSync(
    'docker',
    ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres',
     '-t', '-A', '-F', '|', '-c', q],
    { encoding: 'utf8' }
  ).trim();
}

/** Lo que hay HOY en Vault para los dos nombres, para poder devolverlo igual. */
function leerSecretos() {
  const filas = sql(
    `select name, id, decrypted_secret from vault.decrypted_secrets
      where name in (${lit(SECRETO_KEY)}, ${lit(SECRETO_URL)})`
  );
  const out = {};
  for (const f of filas.split('\n').filter(Boolean)) {
    const [name, id, secreto] = f.split('|');
    out[name] = { id, secreto };
  }
  return out;
}

/** Deja `name` valiendo `valor`, exista o no la fila. */
function ponerSecreto(previo, name, valor) {
  if (previo[name]) {
    sql(`select vault.update_secret(${lit(previo[name].id)}::uuid, ${lit(valor)})`);
  } else {
    sql(`select vault.create_secret(${lit(valor)}, ${lit(name)})`);
  }
}

/** Lo contrario: el valor de antes, o ninguna fila si antes no había. */
function restaurarSecreto(previo, name) {
  if (previo[name]) {
    sql(`select vault.update_secret(${lit(previo[name].id)}::uuid, ${lit(previo[name].secreto)})`);
  } else {
    sql(`delete from vault.secrets where name = ${lit(name)}`);
  }
}

/** Un listener de una sola ruta que apunta todo lo que le llega. */
function levantarMock() {
  const recibido = [];
  const srv = http.createServer((req, res) => {
    let crudo = '';
    req.on('data', (c) => (crudo += c));
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(crudo); } catch { /* lo dejamos en null a propósito */ }
      recibido.push({ apikey: req.headers['apikey'] ?? null, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => {
    // 0.0.0.0 y no 127.0.0.1: quien nos llama es otro contenedor.
    srv.listen(0, '0.0.0.0', () => resolve({ srv, recibido, puerto: srv.address().port }));
  });
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `pg_net` es fire-and-forget y ASÍNCRONO, así que no se puede leer el mock
 * justo después del upload. Se pollea con tope en vez de dormir un fijo: más
 * rápido en el caso normal y no se vuelve flaky si la máquina va lenta.
 */
async function esperarA(pred, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await dormir(120);
  }
  return false;
}

const deListing = (recibido, entityId) =>
  recibido.filter((r) => r.body?.entity_id === String(entityId));

const mover = (E, tok, desde, hacia, bucket = BUCKET) =>
  fetch(`${E.API_URL}/storage/v1/object/move`, {
    method: 'POST',
    headers: { apikey: E.PUBLISHABLE, Authorization: `Bearer ${tok}`,
               'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketId: bucket, sourceKey: desde, destinationKey: hacia }),
  });

// ---------------------------------------------------------------------------

async function main() {
  const raw = env();
  const E = {
    API_URL: raw.API_URL,
    SECRET: raw.SECRET_KEY || raw.SERVICE_ROLE_KEY,
    PUBLISHABLE: raw.PUBLISHABLE_KEY || raw.ANON_KEY,
  };
  if (!E.API_URL || !E.SECRET) {
    throw new Error('No hay stack local. Corre `supabase start` primero.');
  }

  const correoDueno = `probe-dueno-${RUN}@tec.mx`;
  const correoAjeno = `probe-ajeno-${RUN}@tec.mx`;
  let dueno, ajeno, activa, pausada, deAjeno;
  // Fixtures PROPIOS de la sección de moderación. No se reusan los de arriba a
  // propósito: a esa altura del archivo `activa/foto.jpg` ya fue BORRADA por la
  // sección de borrado, y un fixture cuyo estado depende de secciones anteriores
  // es justo la trampa que CLAUDE.md §3 documenta para `rls.sql` (`:C` en T11b).
  let modActiva, modPendiente, modBarrera, mock, previos;

  try {
    dueno = await crearUsuario(E, correoDueno);
    ajeno = await crearUsuario(E, correoAjeno);
    const tDueno = await token(E, correoDueno);
    const tAjeno = await token(E, correoAjeno);

    activa  = await crearListing(E, dueno, `Probe activa ${RUN}`,  'activa');
    pausada = await crearListing(E, dueno, `Probe pausada ${RUN}`, 'pausada');
    deAjeno = await crearListing(E, ajeno, `Probe ajena ${RUN}`,   'activa');

    console.log('\n== Escritura ==');
    permitido('el dueño sube una foto a la carpeta de su publicación',
      await subir(E, tDueno, `${activa}/foto.jpg`));
    denegado('un ajeno NO puede subir a la carpeta de esa publicación',
      await subir(E, tAjeno, `${activa}/intruso.jpg`));
    denegado('el dueño NO puede subir a la carpeta de una publicación ajena',
      await subir(E, tDueno, `${deAjeno}/ajena.jpg`));
    denegado('una ruta sin carpeta de listing es rechazada',
      await subir(E, tDueno, `basura/x.jpg`));

    console.log('\n== Lectura (endpoint autenticado) ==');
    permitido('cualquier authenticated lee la foto de una publicación activa',
      await leer(E, tAjeno, `${activa}/foto.jpg`));

    await subir(E, tDueno, `${pausada}/oculta.jpg`);
    denegado('un ajeno NO lee la foto de una publicación PAUSADA',
      await leer(E, tAjeno, `${pausada}/oculta.jpg`));
    permitido('su dueño SÍ lee la foto de su publicación pausada',
      await leer(E, tDueno, `${pausada}/oculta.jpg`));

    console.log('\n== Mover (with_check de UPDATE) ==');
    denegado('el dueño NO puede mover su objeto a la carpeta de un listing ajeno',
      await mover(E, tDueno, `${activa}/foto.jpg`, `${deAjeno}/robada.jpg`));

    console.log('\n== Borrado (no cubierto por la suite SQL) ==');
    denegado('un ajeno NO puede borrar la foto de otra persona',
      await borrar(E, tAjeno, `${activa}/foto.jpg`));
    permitido('el dueño SÍ puede borrar la foto de su publicación',
      await borrar(E, tDueno, `${activa}/foto.jpg`));

    // -----------------------------------------------------------------------
    // Avatares (RF-03). Bucket `avatars`, PÚBLICO — al revés que el de arriba.
    //
    // Esta sección existe porque casi nada de lo que sostiene esa decisión se
    // puede ver desde SQL: que el objeto se sirva sin auth, que `anon` no pueda
    // enumerarlo, y el borrado (que la suite no puede probar por
    // `storage.protect_delete`). T22 cubre las policies; esto cubre el
    // servicio.
    // -----------------------------------------------------------------------
    console.log('\n== Avatares (bucket público) ==');

    permitido('el dueño sube su avatar a su propia carpeta',
      await subir(E, tDueno, `${dueno}/a.jpg`, BUCKET_AVATARS));
    denegado('un ajeno NO puede subir a la carpeta de otro usuario',
      await subir(E, tAjeno, `${dueno}/intruso.jpg`, BUCKET_AVATARS));

    // ESTA es la que prueba que el bucket es público de verdad: sin `apikey` y
    // sin `Authorization`. Si alguien lo pasara a privado "por consistencia con
    // listing-photos", cae aquí y en ningún otro lado.
    permitido('el avatar se sirve SIN autenticación por /object/public/',
      await leerPublico(E, `${dueno}/a.jpg`, BUCKET_AVATARS));

    // Y ESTA es la que sostiene el "alcance honesto" de la decisión: público
    // significa servible con la URL, no enumerable. Si `anon` pudiera listar,
    // el bucket estaría filtrando qué user_id tiene foto y la decisión de §3
    // tendría que revisarse. Se mira el CUERPO, no el status: `list` contesta
    // 200 con `[]` cuando no ve nada.
    const listaAnon = await listar(E, E.PUBLISHABLE, BUCKET_AVATARS);
    const cuerpoAnon = listaAnon.ok ? await listaAnon.json() : null;
    ok('anon NO puede enumerar el bucket público',
      Array.isArray(cuerpoAnon) && cuerpoAnon.length === 0,
      `status ${listaAnon.status}, cuerpo ${JSON.stringify(cuerpoAnon)}`);

    // Mover: denegado por AUSENCIA de policy de UPDATE, no por un `with_check`
    // — a diferencia de `listing-photos`, que sí tiene una. Ninguna ruta del
    // cliente mueve un avatar (cada subida estrena uuid), así que una policy de
    // UPDATE no tendría consumidor. Si algún día alguien mete `upsert: true`,
    // tiene que agregarla CON su `with_check` de carpeta, o esto deja de ser
    // cierto en silencio.
    denegado('nadie mueve su avatar a la carpeta de otro usuario',
      await mover(E, tDueno, `${dueno}/a.jpg`, `${ajeno}/robado.jpg`, BUCKET_AVATARS));

    denegado('un ajeno NO puede borrar el avatar de otra persona',
      await borrar(E, tAjeno, `${dueno}/a.jpg`, BUCKET_AVATARS));

    // EL BORRADO DEL DUEÑO SE COMPRUEBA CONTANDO, NO POR EL STATUS, y no es
    // prolijidad: `remove()` —el que de verdad usa el cliente— responde 200 con
    // `[]` cuando la RLS de SELECT no le muestra el objeto, sin `error`. Un
    // `permitido(res)` aquí pasaría en verde con `avatars_objects_select`
    // borrada, o sea por la razón equivocada. Ver CLAUDE.md §9.
    const borradoRes = await removeJs(E, tDueno, [`${dueno}/a.jpg`], BUCKET_AVATARS);
    const borrados = borradoRes.ok ? await borradoRes.json() : null;
    ok('el dueño SÍ borra su avatar (y remove() dice cuál, no solo 200)',
      Array.isArray(borrados) && borrados.length === 1,
      `status ${borradoRes.status}, ${Array.isArray(borrados) ? borrados.length : '?'} objeto(s)`);

    // -----------------------------------------------------------------------
    // Moderación automática (RF-18, Ola 2) — los dos triggers de storage.objects
    //
    // QUÉ SE AFIRMA Y QUÉ NO. Las aserciones se escriben sobre el RESULTADO
    // OBSERVABLE ("sobrescribir la foto de una publicación activa la vuelve a
    // mandar a moderar"), nunca sobre QUÉ TRIGGER disparó. El F-spike del
    // 2026-09-18 midió que un upsert es un UPDATE real sobre la misma fila —y
    // no un DELETE+INSERT— pero eso es un detalle de implementación de Storage
    // que una actualización puede mover. `tg_op` se IMPRIME como dato y no se
    // afirma: así estas pruebas siguen siendo válidas si Storage cambia de
    // mecanismo, que es exactamente lo que no queremos volver a averiguar a
    // mano.
    //
    // No cuesta dinero y no necesita `supabase functions serve`: el trigger
    // llama al mock local, no a la Edge Function. La escalada de estado
    // end-to-end (que sí necesita la función y sí cuesta) vive en
    // `probe-moderacion-http.mjs`.
    // -----------------------------------------------------------------------
    console.log('\n== Moderación automática (triggers de storage.objects) ==');

    mock = await levantarMock();
    previos = leerSecretos();
    const CENTINELA = `sb_secret_PROBE_${RUN}`;
    ponerSecreto(previos, SECRETO_KEY, CENTINELA);
    ponerSecreto(previos, SECRETO_URL,
      `http://host.docker.internal:${mock.puerto}/moderar-contenido`);

    modActiva    = await crearListing(E, dueno, `Probe mod activa ${RUN}`,    'activa');
    modPendiente = await crearListing(E, dueno, `Probe mod pendiente ${RUN}`, 'pendiente');
    modBarrera   = await crearListing(E, dueno, `Probe mod barrera ${RUN}`,   'activa');

    // (a) OBJETO NUEVO -> invocación. Se afirma también el header `apikey`: sin
    // él la Edge Function contesta 401 y el trigger sería decorativo.
    await subir(E, tDueno, `${modActiva}/uno.jpg`, BUCKET);
    const llegoA = await esperarA(() => deListing(mock.recibido, modActiva).length >= 1);
    const evA = deListing(mock.recibido, modActiva)[0];
    ok('un objeto nuevo en una publicación activa dispara la moderación',
      llegoA && evA?.body?.bucket_id === 'listing-photos' && evA?.apikey === CENTINELA,
      llegoA ? `tg_op=${evA?.body?.tg_op}, apikey ${evA?.apikey === CENTINELA ? 'ok' : 'MAL'}`
             : 'no llegó nada');

    // (b) SOBRESCRIBIR -> vuelve a moderar. Es LA aserción que justifica la rama
    // UPDATE, y la evasión que estos triggers existen para cerrar: subir limpio,
    // quedar aprobado, y reemplazar la foto después.
    //
    // SE COMPARA EL CONTEO ANTES/DESPUÉS, no "hay al menos uno": con `>= 1` esta
    // aserción pasaría en verde por el evento que ya dejó (a), o sea sin que la
    // rama UPDATE existiera siquiera.
    const antesB = deListing(mock.recibido, modActiva).length;
    await subir(E, tDueno, `${modActiva}/uno.jpg`, BUCKET, { 'x-upsert': 'true' });
    const llegoB = await esperarA(() => deListing(mock.recibido, modActiva).length > antesB);
    const evB = deListing(mock.recibido, modActiva).at(-1);
    ok('sobrescribir la foto de una publicación activa la vuelve a mandar a moderar',
      llegoB && evB?.body?.name === `${modActiva}/uno.jpg`,
      `${antesB} -> ${deListing(mock.recibido, modActiva).length} evento(s), tg_op=${evB?.body?.tg_op}`);

    // (c) PUBLICACIÓN `pendiente` -> NO dispara. Está en un flujo de alta activo
    // y la llamada final del cliente va a evaluarla entera; moderarla aquí
    // duplicaría Vision y abriría la carrera de §1.3.
    //
    // LA BARRERA NO ES OPCIONAL: "no llegó nada en N ms" no distingue "no
    // disparó" de "todavía no llegó". Se sube a la pendiente, después a una
    // ACTIVA, y se espera a que llegue la de la activa. Si la posterior ya
    // llegó y la anterior sigue ausente, el silencio está probado y no es
    // lentitud.
    await subir(E, tDueno, `${modPendiente}/uno.jpg`, BUCKET);
    await subir(E, tDueno, `${modBarrera}/uno.jpg`, BUCKET);
    const llegoBarrera = await esperarA(() => deListing(mock.recibido, modBarrera).length >= 1);
    ok('una subida a una publicación PENDIENTE no dispara la moderación',
      llegoBarrera && deListing(mock.recibido, modPendiente).length === 0,
      llegoBarrera
        ? `${deListing(mock.recibido, modPendiente).length} evento(s) para la pendiente`
        : 'la BARRERA no llegó: la aserción no es concluyente');

    // (d) AVATAR -> siempre dispara, sin skip de estado. Es la aserción POSITIVA
    // que impide "arreglar" la función copiándole el guard de `pendiente` a los
    // dos buckets por simetría — un avatar no tiene estado que consultar.
    // Hermana de T22 (e), que existe por el mismo motivo con `is_active_user()`.
    await subir(E, tDueno, `${dueno}/mod.jpg`, BUCKET_AVATARS);
    const llegoD = await esperarA(() => deListing(mock.recibido, dueno).length >= 1);
    const evD = deListing(mock.recibido, dueno)[0];
    ok('un avatar nuevo dispara la moderación (sin skip de estado)',
      llegoD && evD?.body?.bucket_id === 'avatars',
      llegoD ? `entity_id=${evD?.body?.entity_id}, tg_op=${evD?.body?.tg_op}` : 'no llegó nada');

  } finally {
    // Lo de moderación primero: restaurar Vault y cerrar el listener importa
    // más que borrar filas, porque un secreto repuntado que sobreviva a la
    // corrida deja al trigger llamando a un puerto muerto en la próxima.
    if (previos) {
      try { restaurarSecreto(previos, SECRETO_KEY); } catch {}
      try { restaurarSecreto(previos, SECRETO_URL); } catch {}
    }
    if (mock) mock.srv.close();

    for (const id of [modActiva, modPendiente, modBarrera]) {
      if (id) await fetch(`${E.API_URL}/storage/v1/object/${BUCKET}/${id}/uno.jpg`, {
        method: 'DELETE', headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      }).catch(() => {});
    }

    for (const [id, ruta] of [[pausada, 'oculta.jpg'], [activa, 'foto.jpg']]) {
      if (id) await fetch(`${E.API_URL}/storage/v1/object/${BUCKET}/${id}/${ruta}`, {
        method: 'DELETE', headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      }).catch(() => {});
    }
    // Los avatares: lo que subió el dueño más lo que alguna aserción haya
    // dejado a medias. Con la SECRET, que no pasa por RLS.
    for (const id of [dueno, ajeno]) {
      if (!id) continue;
      await fetch(`${E.API_URL}/storage/v1/object/${BUCKET_AVATARS}`, {
        method: 'DELETE',
        headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`,
                   'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [`${id}/a.jpg`, `${id}/intruso.jpg`, `${id}/robado.jpg`, `${id}/mod.jpg`] }),
      }).catch(() => {});
    }
    for (const id of [activa, pausada, deAjeno, modActiva, modPendiente, modBarrera]) {
      if (id) await fetch(`${E.API_URL}/rest/v1/listings?id=eq.${id}`, {
        method: 'DELETE', headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      }).catch(() => {});
    }
    for (const id of [dueno, ajeno]) {
      if (id) await fetch(`${E.API_URL}/auth/v1/admin/users/${id}`, {
        method: 'DELETE', headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      }).catch(() => {});
    }
  }

  console.log(`\n${'='.repeat(43)}`);
  if (fallos.length) {
    console.log(`   ${fallos.length} FALLARON de ${pasadas + fallos.length}`);
    for (const f of fallos) console.log(`   - ${f}`);
    console.log('='.repeat(43));
    process.exit(1);
  }
  console.log(`   LAS ${pasadas} PRUEBAS PASARON`);
  console.log('='.repeat(43));
}

main().catch((e) => { console.error(`\n${e.message}`); process.exit(1); });
