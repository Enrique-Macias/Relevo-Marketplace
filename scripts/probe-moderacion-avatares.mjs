// ===========================================================================
// Relevo — el camino de avatares de `moderar-contenido` (RF-18, Ola 1.6).
//
// Cómo correrlo (CUATRO cosas, no las tres de los otros probes de red):
//
//   1. supabase start
//   2. Apuntar Vision a este mock ANTES de levantar la función — editar
//      `supabase/functions/moderar-contenido/vision.ts`:
//        export const ENDPOINT_VISION = 'http://host.docker.internal:8935/v1/images:annotate';
//      (deshacer el cambio al terminar — NO se comitea así)
//   3. supabase functions serve --env-file supabase/functions/.env
//   4. node scripts/probe-moderacion-avatares.mjs
//
// POR QUÉ VISION VA MOCKEADO, Y NO ES EL MISMO CASO QUE probe-moderacion-red.mjs.
// `decidirAvatar()` solo borra con el eje `vision` en `'bloquear'`, que exige
// `VERY_LIKELY` de SafeSearch — y la única forma de conseguir eso de Vision DE
// VERDAD es mandarle una imagen genuinamente explícita o gráficamente
// violenta. Este repo no sourcea ni genera ese contenido, ni para pruebas
// (mismo criterio ya aplicado en la ronda anterior para el caso 4 del plan).
// La lógica de umbral (`nivelDeSafeSearch`: `LIKELY → revisar`,
// `VERY_LIKELY → bloquear`) ya está cubierta pura y determinista en
// `probe-moderacion.mjs` — lo que ESTE script prueba es el CABLEADO alrededor
// de esa lógica: que un veredicto `VERY_LIKELY` de verdad dispare el borrado
// del objeto y la nulificación de `foto_url`, que uno `LIKELY` no toque nada,
// y que el guard de la carrera no le borre la foto a un avatar nuevo. Un mock
// que devuelve la FORMA real de la respuesta de Vision (no una foto real) es
// suficiente y correcto para probar exactamente eso — mismo patrón que el
// mock del *refusal* de OpenAI (caso 8 de la ronda anterior,
// `.claude/rules/moderacion.md` §6.3).
//
// `host.docker.internal`, NO `127.0.0.1` — el runtime de `supabase functions
// serve` corre en su propio contenedor Docker, así que `127.0.0.1` desde
// dentro de la función es el contenedor mismo, no este proceso (CLAUDE.md §9,
// destapado montando el mock del caso 8).
//
// Las fotos SÍ son reales (JPEGs sólidos vía `sharp`) — lo único mockeado es
// la RESPUESTA de Vision, no la descarga desde Storage, que corre contra el
// bucket real.
//
// ⚠️ Como el otro lado de la Ola 1.5, esto cuesta dinero si por descuido
// ENDPOINT_VISION queda apuntando a Google en vez del mock — confirma la
// edición antes de correr.
// ===========================================================================

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import sharp from 'sharp';

const RUN = Date.now();
const PUERTO_MOCK = 8935;

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

function ok(nombre, cond, detalle) {
  if (cond) {
    pasadas++;
    console.log(`  ok — ${nombre}${detalle ? ` (${detalle})` : ''}`);
  } else {
    fallos.push(nombre);
    console.log(`  FALLÓ — ${nombre}${detalle ? ` (${detalle})` : ''}`);
  }
}

const igual = (nombre, actual, esperado) =>
  ok(nombre, actual === esperado, `esperado ${JSON.stringify(esperado)}, obtuvo ${JSON.stringify(actual)}`);

// ---------------------------------------------------------------------------
// El mock de Vision — devuelve la FORMA real de `RespuestaVision`, con el
// `adult` que cada escenario necesita. `retrasoMs` es lo que crea la ventana
// de carrera del caso 3: el mock espera antes de responder, y mientras
// espera el script sube un avatar B y actualiza `foto_url`.
// ---------------------------------------------------------------------------

let siguienteAdult = 'VERY_UNLIKELY';
let retrasoMs = 0;

const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    if (retrasoMs > 0) await new Promise((r) => setTimeout(r, retrasoMs));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        responses: [
          {
            safeSearchAnnotation: {
              adult: siguienteAdult,
              violence: 'VERY_UNLIKELY',
              racy: 'VERY_UNLIKELY',
            },
          },
        ],
      })
    );
  });
});

// ---------------------------------------------------------------------------
// Helpers — mismo patrón que probe-moderacion-red.mjs.
// ---------------------------------------------------------------------------

async function crearUsuario(E, correo) {
  const res = await fetch(`${E.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password: 'probe-1234', email_confirm: true }),
  });
  if (!res.ok) throw new Error(`crearUsuario ${correo}: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

async function jpegLimpio(gris = 128) {
  return sharp({ create: { width: 200, height: 200, channels: 3, background: { r: gris, g: gris, b: gris } } })
    .jpeg()
    .toBuffer();
}

async function subirAvatar(E, userId, jpeg) {
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const res = await fetch(`${E.API_URL}/storage/v1/object/avatars/${path}`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'image/jpeg' },
    body: jpeg,
  });
  if (!res.ok) throw new Error(`subirAvatar: ${res.status} ${await res.text()}`);
  return path;
}

async function setFotoUrl(E, userId, path) {
  const res = await fetch(`${E.API_URL}/rest/v1/users?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ foto_url: path }),
  });
  if (!res.ok) throw new Error(`setFotoUrl: ${res.status} ${await res.text()}`);
}

async function fotoUrlDe(E, userId) {
  const res = await fetch(`${E.API_URL}/rest/v1/users?id=eq.${userId}&select=foto_url`, {
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
  });
  const filas = await res.json();
  return filas[0]?.foto_url ?? null;
}

async function objetoExiste(E, path) {
  // `list()` sobre la carpeta del usuario y buscar el archivo — más confiable
  // que intentar descargar, que en un bucket público también serviría un 404
  // JSON que hay que distinguir de un 200 con bytes.
  const carpeta = path.split('/')[0];
  const archivo = path.split('/')[1];
  const res = await fetch(`${E.API_URL}/storage/v1/object/list/avatars`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: carpeta, limit: 100, offset: 0 }),
  });
  if (!res.ok) throw new Error(`objetoExiste: ${res.status} ${await res.text()}`);
  const objetos = await res.json();
  return objetos.some((o) => o.name === archivo);
}

async function llamarTrigger(E, userId, path) {
  const res = await fetch(`${E.API_URL}/functions/v1/moderar-contenido`, {
    method: 'POST',
    headers: { apikey: E.SECRET, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket_id: 'avatars', name: path, entity_id: String(userId) }),
  });
  const texto = await res.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* no-op */ }
  return { status: res.status, json, texto };
}

async function contarFilasModeracion(E) {
  const res = await fetch(`${E.API_URL}/rest/v1/listing_moderacion?select=id`, {
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, Prefer: 'count=exact' },
  });
  return Number(res.headers.get('content-range')?.split('/')[1] ?? -1);
}

// ---------------------------------------------------------------------------

async function main() {
  await new Promise((resolve) => mock.listen(PUERTO_MOCK, '127.0.0.1', resolve));
  console.log(`[mock] Vision escuchando en ${PUERTO_MOCK}`);

  const raw = env();
  const E = { API_URL: raw.API_URL, SECRET: raw.SECRET_KEY || raw.SERVICE_ROLE_KEY };
  if (!E.API_URL || !E.SECRET) throw new Error('No hay stack local. Corre `supabase start` primero.');

  const vivo = await llamarTrigger(E, '00000000-0000-0000-0000-000000000000', 'x.jpg');
  if (vivo.texto.includes('Function not found')) {
    throw new Error(
      'La función no está servida. En otra terminal, CON ENDPOINT_VISION apuntado al mock:\n' +
      '  supabase functions serve --env-file supabase/functions/.env'
    );
  }

  const correo = `probe-avatar-${RUN}@tec.mx`;
  let usuario;
  const objetosSubidos = [];

  try {
    usuario = await crearUsuario(E, correo);
    const filasAntes = await contarFilasModeracion(E);

    // -----------------------------------------------------------------
    console.log('\n== 1. VERY_LIKELY → se borra el objeto y foto_url queda null ==');

    siguienteAdult = 'VERY_LIKELY';
    retrasoMs = 0;

    const jpegA = await jpegLimpio();
    const pathA = await subirAvatar(E, usuario, jpegA);
    objetosSubidos.push(pathA);
    await setFotoUrl(E, usuario, pathA);

    const rA = await llamarTrigger(E, usuario, pathA);
    ok('la función responde 200', rA.status === 200, JSON.stringify(rA.json));
    igual('  …accion: borrar', rA.json?.accion, 'borrar');
    igual('  …foto_url_nulificado: true', rA.json?.foto_url_nulificado, true);

    igual('foto_url quedó en null', await fotoUrlDe(E, usuario), null);
    igual('el objeto YA NO está en el bucket', await objetoExiste(E, pathA), false);

    // -----------------------------------------------------------------
    console.log('\n== 2. LIKELY → no-op: nada se toca ==');

    siguienteAdult = 'LIKELY';
    retrasoMs = 0;

    const jpegB = await jpegLimpio(140);
    const pathB = await subirAvatar(E, usuario, jpegB);
    objetosSubidos.push(pathB);
    await setFotoUrl(E, usuario, pathB);

    const rB = await llamarTrigger(E, usuario, pathB);
    ok('la función responde 200', rB.status === 200, JSON.stringify(rB.json));
    igual('  …accion: conservar', rB.json?.accion, 'conservar');
    ok('  …foto_url_nulificado NO viene (rama distinta de la del borrado)',
       rB.json?.foto_url_nulificado === undefined);

    igual('foto_url SIGUE apuntando al mismo avatar', await fotoUrlDe(E, usuario), pathB);
    igual('el objeto SIGUE en el bucket', await objetoExiste(E, pathB), true);

    // -----------------------------------------------------------------
    console.log('\n== 3. El guard de la carrera: A tardío no le borra la foto a B ==');

    siguienteAdult = 'VERY_LIKELY'; // el veredicto tardío de A: sucio, intenta borrar
    retrasoMs = 2000; // la ventana para que B suceda mientras A sigue evaluándose

    const jpegRaceA = await jpegLimpio(100);
    const pathRaceA = await subirAvatar(E, usuario, jpegRaceA);
    objetosSubidos.push(pathRaceA);
    await setFotoUrl(E, usuario, pathRaceA);

    // Disparado y NO esperado todavía — Vision (el mock) va a tardar 2s.
    const promesaA = llamarTrigger(E, usuario, pathRaceA);

    // Mientras A sigue "evaluándose", el usuario sube un avatar NUEVO — el
    // flujo real del cliente: subir, y DESPUÉS escribir foto_url apuntando al
    // nuevo (storage.ts).
    await new Promise((r) => setTimeout(r, 300)); // dar tiempo a que A ya esté en curso
    const jpegRaceB = await jpegLimpio(60);
    const pathRaceB = await subirAvatar(E, usuario, jpegRaceB);
    objetosSubidos.push(pathRaceB);
    await setFotoUrl(E, usuario, pathRaceB);

    // Ahora sí, esperar a que el veredicto TARDÍO de A llegue.
    const rRaceA = await promesaA;
    ok('la llamada de A (tardía) responde 200 igual', rRaceA.status === 200, JSON.stringify(rRaceA.json));
    igual('  …accion: borrar (A SÍ salió sucio)', rRaceA.json?.accion, 'borrar');

    // LA ASERCIÓN QUE IMPORTA, en dos mitades — ninguna sola basta:
    igual('foto_url sigue apuntando a B, NO quedó en null', await fotoUrlDe(E, usuario), pathRaceB);
    igual('B NO se borró', await objetoExiste(E, pathRaceB), true);

    // Y el efecto colateral esperado, documentado en el docblock de
    // moderarAvatar(): A SÍ se borra del bucket aunque el guard no haya
    // tocado la fila — el objeto ya estaba huérfano (foto_url ya no apunta
    // a él) y esta limpieza es inofensiva.
    igual('  …y A SÍ se borró del bucket (limpieza de un objeto ya huérfano)',
          await objetoExiste(E, pathRaceA), false);

    // -----------------------------------------------------------------
    console.log('\n== 4. Los avatares NUNCA escriben en listing_moderacion ==');

    const filasDespues = await contarFilasModeracion(E);
    igual('cero filas nuevas tras CUATRO moderaciones de avatar',
          filasDespues, filasAntes);

  } finally {
    for (const path of objetosSubidos) {
      await fetch(`${E.API_URL}/storage/v1/object/avatars/${path}`, {
        method: 'DELETE',
        headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      }).catch(() => {});
    }
    if (usuario) {
      await fetch(`${E.API_URL}/auth/v1/admin/users/${usuario}`, {
        method: 'DELETE',
        headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      }).catch(() => {});
    }
    await new Promise((resolve) => mock.close(resolve));
  }

  console.log('');
  if (fallos.length > 0) {
    console.log('===========================================');
    console.log(`   ${fallos.length} PRUEBA(S) FALLARON`);
    for (const f of fallos) console.log(`   · ${f}`);
    console.log('===========================================');
    process.exit(1);
  }
  console.log('===========================================');
  console.log(`   LAS ${pasadas} PRUEBAS PASARON`);
  console.log('===========================================');
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
