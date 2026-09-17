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
// Crea sus propios usuarios y publicaciones, con correos únicos por corrida, y
// limpia en un `finally`. Si una corrida muere de golpe puede dejar basura en la
// base LOCAL; `supabase db reset` la borra.
// ===========================================================================

import { execFileSync } from 'node:child_process';

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
const subir = (E, tok, ruta, bucket = BUCKET) =>
  fetch(`${E.API_URL}/storage/v1/object/${bucket}/${ruta}`, {
    method: 'POST',
    headers: { apikey: E.PUBLISHABLE, Authorization: `Bearer ${tok}`,
               'Content-Type': 'image/jpeg' },
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
  } finally {
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
        body: JSON.stringify({ prefixes: [`${id}/a.jpg`, `${id}/intruso.jpg`, `${id}/robado.jpg`] }),
      }).catch(() => {});
    }
    for (const id of [activa, pausada, deAjeno]) {
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
