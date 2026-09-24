// ===========================================================================
// Relevo — la Edge Function `moderar-contenido` por HTTP (RF-18).
//
// Cómo correrlo (necesita DOS procesos, y esa es la diferencia con los otros):
//     supabase start                                          # terminal 1
//     supabase functions serve --env-file supabase/functions/.env   # terminal 2
//     node scripts/probe-moderacion-http.mjs                   # terminal 3
//
// POR QUÉ ES UN CUARTO PROBE Y NO PARTE DE `probe-moderacion.mjs`. Aquel es
// puro: importa `decision.ts` desde Node y corre en menos de un segundo, sin
// stack ni red. Lo que prueba son DECISIONES. Este prueba el CABLEADO —quién
// puede llamar, con qué credencial, sobre qué publicación— y para eso no hay
// atajo: hay que pegarle a la función de verdad. Mezclarlos le quitaría al
// primero su mejor propiedad, que es correr siempre y en todos lados.
//
// ⚠️ DESDE LA OLA 1.5 (2026-09-18), ESTE ARCHIVO CUESTA DINERO Y NECESITA
// CREDENCIALES REALES. `evaluarListing()` llama a Vision y a OpenAI de
// verdad — ya no hay stub que interceptar — así que CADA corrida de este
// probe dispara varias llamadas reales a las dos APIs (una por foto/lote a
// Vision, una a OpenAI por evaluación de texto). No es opcional ni
// configurable: no existe un modo "seco" en `index.ts`, así que la única
// forma de probar el cableado es a través del pipeline real. Necesita los
// DOS secretos puestos en `supabase/functions/.env` — sin ellos la función ni
// arranca (`resolverConfig()` corre a nivel de módulo a propósito).
//
// POR ESO EL CONTENIDO DE PRUEBA NO ES TEXTO AL AZAR. Ver `TITULO_LIMPIO` /
// `DESCRIPCION_LIMPIA` más abajo: la primera versión de este archivo usaba
// títulos tipo `RLS ModHTTP propia ${RUN}`, y funcionaba bien mientras la
// evaluación era un stub. En cuanto empezó a llamar a GPT de verdad, ESE
// MISMO título produjo veredictos NO deterministas entre corridas —el modelo
// interpretando ruido de forma distinta cada vez—, incluyendo una corrida que
// bloqueó una publicación de prueba. El fix no es mockear nada: es usar
// contenido genuinamente aburrido y VERIFICARLO por separado (5/5 corridas
// reales de GPT, 3/3 de Vision) antes de depender de él como fixture.
//
// REQUISITO NO OBVIO #2: promover a `activa` exige al menos una foto real en
// `listing_photos`, por `listings_enforce_activation_has_photos`
// (CLAUDE.md §3) — un trigger de la BASE, completamente ajeno a la
// moderación. La sección 5 lo destapó: sin una foto, el camino de usuario
// devolvía `500 "Una publicación no puede activarse sin fotos"`, no un bug de
// `index.ts` sino un fixture incompleto. Ver `subirFotoLimpia()`.
//
// Crea sus propios usuarios, publicaciones y UNA foto real (JPEG sólido vía
// `sharp`, ya dependencia del repo) con nombres únicos por corrida, y limpia
// TODO en un `finally` —incluido el objeto de Storage, que no cascadea al
// borrar el listing—, igual que los otros probes.
//
// CONTROLES NEGATIVOS CORRIDOS (2026-09-18), uno a la vez, contra la función
// VIVA:
//
//   | Qué se rompió en `index.ts`        | Cae en                              |
//   |------------------------------------|-------------------------------------|
//   | el chequeo de ownership            | «un tercero NO puede…» + «ajena e   |
//   |                                    | inexistente se ven IGUAL»           |
//   | el guard de `esPromocion()`        | «el TRIGGER sobre una pendiente     |
//   |                                    | LIMPIA → sigue pendiente» (§5)      |
//
// **El guard YA NO pasa por vacuidad.** Con la evaluación real y el par
// LIMPIO verificado, `enPendiente` SÍ recibe una promoción real que bloquear
// —`decidirListing({...limpio}, 'pendiente')` propone `activa` de verdad—, y
// el control negativo (desactivar `bloqueadaPorGuard` y volver a correr contra
// el servidor vivo) hizo caer la aserción. Antes de la Ola 1.5 esto era
// imposible de probar aquí: con los ejes siempre en `'revisar'`,
// `decidirListing` nunca proponía `activa` desde `pendiente`, así que no
// había ninguna promoción que el guard pudiera bloquear. La cobertura pura
// (405 combinaciones en `probe-moderacion.mjs`) sigue siendo la red que no
// depende de red ni de credenciales; esta es, además, la prueba de que el
// guard hace su trabajo en el sistema real.
//
// Este archivo nació encontrando un bug real de la primera corrida:
// `ctx.userClaims` expone **`id`**, no `sub` (el `sub` está en
// `ctx.jwtClaims`). El E-spike había confirmado que `userClaims` EXISTE, que no
// es lo mismo que conocer su forma, y el shim de tipos deja `ctx` sin tipar a
// propósito — así que el error salía como un 401 «sin identidad en el JWT», que
// se lee como problema de credenciales y no como un nombre de campo mal puesto.
// ===========================================================================

import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const RUN = Date.now();

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
  ok(nombre, actual === esperado, `esperado ${esperado}, obtuvo ${actual}`);

// ---------------------------------------------------------------------------

async function crearUsuario(E, correo) {
  const res = await fetch(`${E.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`,
               'Content-Type': 'application/json' },
    // Inmune a `minimum_password_length`: el admin API está exento de esa
    // validación (CLAUDE.md §9, medido — el corte es por llave, no por endpoint).
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

// Descripción genérica, deliberadamente aburrida — reusa el mismo criterio
// que `DESCRIPCION_LIMPIA` de más abajo. No lleva `descripcion` propia por
// default: la mayoría de las aserciones de este archivo no leen el veredicto,
// solo la autorización, así que el default puede ser `null` sin costo.
async function crearListing(E, userId, titulo, estado, descripcion = null) {
  const res = await fetch(`${E.API_URL}/rest/v1/listings`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`,
               'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, categoria_id: 1, universidad_id: 1,
                           campus_id: 1, titulo, descripcion, precio: 100, condicion: 'nuevo', estado }),
  });
  if (!res.ok) throw new Error(`crearListing ${titulo}: ${res.status} ${await res.text()}`);
  return (await res.json())[0].id;
}

/**
 * Título+descripción REALISTAS y ABURRIDOS, no texto al azar — y esto dejó de
 * ser cosmético en cuanto la evaluación se volvió real (Ola 1.5).
 *
 * La primera versión de este archivo usaba títulos tipo `RLS ModHTTP propia
 * ${RUN}` —texto sin sentido con un timestamp—, y funcionaba bien mientras
 * `evaluarListing()` era un stub que ignoraba el contenido. En cuanto empezó a
 * llamar a GPT de verdad, ese mismo título produjo un veredicto NO
 * DETERMINISTA: una corrida dio `articulo_prohibido: 'posible'` (→
 * `pendiente`), otra dio algo peor (→ `bloqueada`) — el modelo interpretando
 * ruido de forma distinta cada vez. Medido reproduciendo la llamada aislada.
 *
 * Con ESTE par exacto, GPT-4o-mini da `limpio` en las seis categorías de
 * forma consistente (verificado 5/5 corridas reales, sin mockear nada). Las
 * aserciones de más abajo que esperan un veredicto específico usan este par
 * y NINGÚN otro — no se vale "parece razonable que también dé limpio" sin
 * volver a medir.
 */
const TITULO_LIMPIO = 'Calculadora científica Casio fx-991LA Plus';
const DESCRIPCION_LIMPIA =
  'Calculadora en buen estado, la usé para mis clases de cálculo. Incluye funda y pilas nuevas.';

/**
 * Sube una foto GENUINAMENTE limpia a `listing-photos` e inserta su fila en
 * `listing_photos` — necesaria para CUALQUIER prueba que espere que una
 * publicación llegue a `activa`.
 *
 * NO ES OPCIONAL, y no se descubrió por lectura de código sino por una
 * corrida real: `listings_enforce_activation_has_photos` (CLAUDE.md §3) es un
 * trigger de la BASE, completamente ajeno a la moderación, que rechaza
 * cualquier UPDATE a `estado = 'activa'` sobre una publicación sin fotos. La
 * primera versión de este archivo probaba la promoción sobre `enPendiente`
 * SIN fotos, y el camino de usuario devolvía `500 "Una publicación no puede
 * activarse sin fotos"` — no un bug de `index.ts` (el error se propagó
 * correctamente, sin nada silencioso), sino un fixture incompleto.
 *
 * El JPEG es un cuadro sólido de 300×300 generado con `sharp` (ya dependencia
 * del repo, mismo patrón que `scripts/generate-tab-icons.mjs`) — no una foto
 * real de ningún lado. Verificado 3/3 corridas reales contra Vision:
 * `{adult: VERY_UNLIKELY, violence: UNLIKELY, racy: UNLIKELY}` → `limpio`,
 * de forma consistente.
 */
async function subirFotoLimpia(E, listingId) {
  const jpeg = await sharp({
    create: { width: 300, height: 300, channels: 3, background: { r: 128, g: 128, b: 128 } },
  })
    .jpeg()
    .toBuffer();

  const storagePath = `${listingId}/limpia-${RUN}.jpg`;

  const resSubida = await fetch(`${E.API_URL}/storage/v1/object/listing-photos/${storagePath}`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'image/jpeg' },
    body: jpeg,
  });
  if (!resSubida.ok) {
    throw new Error(`subirFotoLimpia: ${resSubida.status} ${await resSubida.text()}`);
  }

  const resFila = await fetch(`${E.API_URL}/rest/v1/listing_photos`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ listing_id: listingId, storage_path: storagePath, orden: 0 }),
  });
  if (!resFila.ok) {
    throw new Error(`subirFotoLimpia (fila): ${resFila.status} ${await resFila.text()}`);
  }

  return storagePath;
}

/**
 * Sube una foto GENUINA con una palabra de la lista IMPRESA como texto —
 * `upsert:false`, uuid nuevo, exactamente como `storage.ts` sube de verdad
 * (`subirObjeto()`) — y a propósito NO le escribe fila en `listing_photos`:
 * es la ventana real que el hueco de §1 explotaba.
 *
 * El texto va como SVG rasterizado a JPEG (`sharp`, ya dependencia): fondo
 * blanco, letra grande y negra, sin ambigüedad para el OCR. No es contenido
 * explícito ni violento — es una imagen con una palabra escrita, la misma
 * categoría de fixture que ya usa la sección de arriba con texto TECLEADO,
 * solo que aquí la lee Vision por OCR en vez de leerse del título.
 */
async function subirFotoConOcrSucio(E, listingId, palabra) {
  const svg = `<svg width="640" height="220" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <text x="30" y="130" font-size="56" font-family="sans-serif" fill="black">${palabra}</text>
  </svg>`;
  const jpeg = await sharp(Buffer.from(svg)).jpeg().toBuffer();

  const storagePath = `${listingId}/${crypto.randomUUID()}.jpg`;

  const res = await fetch(`${E.API_URL}/storage/v1/object/listing-photos/${storagePath}`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'image/jpeg' },
    body: jpeg,
  });
  if (!res.ok) throw new Error(`subirFotoConOcrSucio: ${res.status} ${await res.text()}`);

  return storagePath;
}

async function estadoDe(E, id) {
  const res = await fetch(`${E.API_URL}/rest/v1/listings?id=eq.${id}&select=estado`, {
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
  });
  return (await res.json())[0]?.estado;
}

// `order=created_at.asc` no es cosmético: sin él, PostgREST no garantiza
// ningún orden, y `filas[0]` se usa más abajo para mirar la PRIMERA
// evaluación. Sin el order explícito esa aserción sería frágil por azar de
// implementación, no por diseño.
async function auditoriasDe(E, id) {
  const res = await fetch(
    `${E.API_URL}/rest/v1/listing_moderacion?listing_id=eq.${id}&select=veredicto,estado_resultante&order=created_at.asc`,
    { headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` } }
  );
  return res.ok ? await res.json() : [];
}

/** El reclamo del camino cliente de una publicación, o `undefined` si no hay. */
async function reclamoDe(E, id) {
  const res = await fetch(
    `${E.API_URL}/rest/v1/listing_moderacion_reclamos?listing_id=eq.${id}&select=reclamada_at,completada_at`,
    { headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` } }
  );
  if (!res.ok) throw new Error(`reclamoDe ${id}: ${res.status} ${await res.text()}`);
  return (await res.json())[0];
}

async function sembrarReclamo(E, id, reclamadaAt, completadaAt) {
  const res = await fetch(`${E.API_URL}/rest/v1/listing_moderacion_reclamos`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`,
               'Content-Type': 'application/json' },
    body: JSON.stringify({ listing_id: id, reclamada_at: reclamadaAt, completada_at: completadaAt }),
  });
  if (!res.ok) throw new Error(`sembrarReclamo ${id}: ${res.status} ${await res.text()}`);
}

const hace = (ms) => new Date(Date.now() - ms).toISOString();

/**
 * Las TRES formas de credencial que la función puede recibir, cada una en el
 * header que le corresponde de verdad:
 *  · `secret`      → `apikey` (NO `Bearer`: las secret keys modernas no son
 *                    JWT y la plataforma las rechazaría al parsearlas — §9).
 *  · `user`        → `Authorization: Bearer <access_token>`, con la
 *                    publishable en `apikey`, que es como pega el cliente real.
 *  · `publishable` → solo `apikey`, sin sesión.
 */
function headers(E, modo, tok) {
  const base = { 'Content-Type': 'application/json' };
  if (modo === 'ninguna') return base;
  if (modo === 'inventada') return { ...base, apikey: 'sb_secret_esto-no-existe' };
  if (modo === 'publishable') return { ...base, apikey: E.PUBLISHABLE };
  if (modo === 'secret') return { ...base, apikey: E.SECRET };
  if (modo === 'user') return { ...base, apikey: E.PUBLISHABLE, Authorization: `Bearer ${tok}` };
  throw new Error(`modo desconocido: ${modo}`);
}

async function llamar(E, modo, body, tok) {
  const res = await fetch(`${E.API_URL}/functions/v1/moderar-contenido`, {
    method: 'POST',
    headers: headers(E, modo, tok),
    body: JSON.stringify(body),
  });
  const texto = await res.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* respuestas de la plataforma no son JSON */ }
  return { status: res.status, json, texto };
}

// ---------------------------------------------------------------------------
// Sección 6: el trigger de Storage de verdad (RF-18, Ola 2)
// ---------------------------------------------------------------------------
//
// Para que el trigger llegue a ESTA función hay que apuntarle los dos secretos
// de Vault al `functions serve` local. Se repuntan aquí y se restauran en el
// `finally`.
//
// `host.docker.internal` Y NO `127.0.0.1`: quien hace el `net.http_post` es el
// contenedor de Postgres, y su loopback es él mismo. Medido (2026-09-18): con
// ese nombre, `net._http_response` da 200 y el destino recibe body y header.
// CLAUDE.md §9 documenta el mismo gotcha para el contenedor del edge runtime.
//
// Los helpers de Vault están DUPLICADOS con `probe-storage.mjs` a sabiendas.
// No es el acoplamiento que este repo persigue (`formatPrecio` ↔
// `formato_precio()`, `congelada()` ↔ su `using`): aquello son dos
// implementaciones de UNA MISMA REGLA que al desincronizarse mienten. Esto es
// andamiaje de pruebas, cada probe apunta a un destino distinto, y si una copia
// se rompe su propio script falla ruidosamente.
const DB_CONTAINER = 'supabase_db_relevo-marketplace';
const SECRETO_KEY = 'moderar_contenido_secret_key';
const SECRETO_URL = 'moderar_contenido_function_url';

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

const sqlDocker = (q) =>
  execFileSync(
    'docker',
    ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres',
     '-t', '-A', '-F', '|', '-c', q],
    { encoding: 'utf8' }
  ).trim();

function leerSecretos() {
  const out = {};
  const filas = sqlDocker(
    `select name, id, decrypted_secret from vault.decrypted_secrets
      where name in (${lit(SECRETO_KEY)}, ${lit(SECRETO_URL)})`
  );
  for (const f of filas.split('\n').filter(Boolean)) {
    const [name, id, secreto] = f.split('|');
    out[name] = { id, secreto };
  }
  return out;
}

const ponerSecreto = (previo, name, valor) =>
  previo[name]
    ? sqlDocker(`select vault.update_secret(${lit(previo[name].id)}::uuid, ${lit(valor)})`)
    : sqlDocker(`select vault.create_secret(${lit(valor)}, ${lit(name)})`);

const restaurarSecreto = (previo, name) =>
  previo[name]
    ? sqlDocker(`select vault.update_secret(${lit(previo[name].id)}::uuid, ${lit(previo[name].secreto)})`)
    : sqlDocker(`delete from vault.secrets where name = ${lit(name)}`);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * `pg_net` es fire-and-forget y la función tarda SEGUNDOS (Vision + OpenAI
 * reales), así que el efecto no está listo al volver del upload. Se pollea con
 * tope: rápido cuando sale bien, y sin volverse flaky si las APIs van lentas.
 */
async function esperarA(pred, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await pred()) return true;
    await dormir(500);
  }
  return false;
}

/** Como `auditoriasDe`, pero trayendo `detalle` — la sección 6 lo necesita. */
async function auditoriasConDetalle(E, id) {
  const res = await fetch(
    `${E.API_URL}/rest/v1/listing_moderacion?listing_id=eq.${id}` +
      `&select=veredicto,estado_resultante,detalle&order=created_at.asc`,
    { headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` } }
  );
  return res.ok ? await res.json() : [];
}

// Una entrada VERBATIM de `palabras-prohibidas.ts`. Es el eje DETERMINISTA, y
// por eso es el que dispara esta sección en vez de una imagen sucia: forzar
// `VERY_LIKELY` de Vision exigiría sourcear contenido sexual explícito o
// gráficamente violento, que este repo no hace ni para pruebas (mismo criterio
// ya aplicado al declinar el caso 4 de §6.3 y al mockear Vision en
// `probe-moderacion-avatares.mjs`).
//
// Y el veredicto es deterministo AUNQUE GPT sea un modelo: `peor()` es
// monótona, así que un acierto de lista en texto TECLEADO da `bloquear` diga lo
// que diga OpenAI. Ninguna señal absuelve a la otra — que es exactamente la
// propiedad que hace usable este fixture.
const PALABRA_PROHIBIDA = 'clonazepam';

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

  // Comprobación de arranque con mensaje propio: sin esto, TODAS las
  // aserciones fallarían con 404 y el motivo real ("no corriste `functions
  // serve`") quedaría enterrado bajo 12 líneas rojas.
  const vivo = await llamar(E, 'secret', {});
  if (vivo.texto.includes('Function not found')) {
    throw new Error(
      'La función no está servida. En otra terminal:\n' +
      '  supabase functions serve --env-file supabase/functions/.env'
    );
  }

  const correoDueno = `probe-mod-dueno-${RUN}@tec.mx`;
  const correoAjeno = `probe-mod-ajeno-${RUN}@tec.mx`;
  let dueno, ajeno, propia, ajena, enPendiente, fotoEnPendiente;
  let credencialSecret, credencialUser;
  // Fixtures propios de la sección 6 (el trigger de Storage).
  let escalable, fotoEscalable, previosVault;
  // Fixtures propios de la sección 7 (la foto SIN fila que dispara el trigger).
  let nuevaFotoListing, fotoNueva;
  // Fixtures propios de la sección 8 (el reclamo del camino cliente).
  let rConcurrente, fotoRConcurrente, rHuerfano, fotoRHuerfano, rCompletado,
      rEnVuelo, rSinFotos, rCarrera, fotoRCarrera;

  try {
    dueno = await crearUsuario(E, correoDueno);
    ajeno = await crearUsuario(E, correoAjeno);
    const tDueno = await token(E, correoDueno);

    // `propia` y `enPendiente` usan el par LIMPIO verificado, porque las
    // llamadas de las secciones 1, 2, 4 y 5 SÍ disparan evaluación real
    // contra ellas. `ajena` no necesita nada verificado: por diseño, ningún
    // llamador legítimo llega a evaluarla (la sección 2 prueba justo que se
    // rechaza ANTES de eso) — el título con `RUN` solo sirve para
    // distinguirla en un vistazo si algo sale mal.
    propia = await crearListing(E, dueno, TITULO_LIMPIO, 'activa', DESCRIPCION_LIMPIA);
    ajena = await crearListing(E, ajeno, `RLS ModHTTP ajena ${RUN}`, 'activa');
    enPendiente = await crearListing(E, dueno, TITULO_LIMPIO, 'pendiente', DESCRIPCION_LIMPIA);
    // DOS fixtures PROPIAS, no `propia`, y es una corrección respecto a antes
    // de esta tarea: con `nombreDisparador` ya cableado (§7), el `name` que
    // `conSecret` manda para probar la secret key deja de ser inerte. Es un
    // path que NO EXISTE en Storage a propósito (solo se prueba credenciales,
    // no evaluación), así que la descarga falla → `no_evaluable` → eje
    // 'revisar' → escala de `activa` a `pendiente`. Medido, en DOS capas:
    //   · reusar `propia` para esto dejaba esa fixture en `pendiente` para las
    //     secciones 2 y 4, que asumen que sigue `activa` — la lección de T11b
    //     (CLAUDE.md §3): no reutilizar fixtures entre secciones cuando el
    //     estado avanza.
    //   · y NI SIQUIERA `conSecret` y `conUser` pueden compartir UNA fixture
    //     entre sí: `conSecret` corre primero y la deja en `pendiente`, así
    //     que `conUser` (camino de usuario, limpio) intenta PROMOVERLA de
    //     vuelta a `activa` — y esa transición choca con
    //     `listings_enforce_activation_has_photos` (0 fotos reales) y
    //     `moderarListing()` no atrapa ese error de UPDATE: se propaga como
    //     `HTTP 500`. Medido exactamente así antes de separarlas.
    credencialSecret = await crearListing(E, dueno, `${TITULO_LIMPIO} credSecret`, 'activa', DESCRIPCION_LIMPIA);
    credencialUser = await crearListing(E, dueno, `${TITULO_LIMPIO} credUser`, 'activa', DESCRIPCION_LIMPIA);

    // `propia` NUNCA necesita foto: su estado no cambia (limpio sobre `activa`
    // es un no-op, ver sección 4), así que el `when` de
    // `listings_enforce_activation_has_photos` —que solo mira TRANSICIONES a
    // `activa`— nunca se dispara para ella. `enPendiente` SÍ va a promoverse
    // de verdad en la sección 5, y esa transición es exactamente la que el
    // trigger vigila.
    fotoEnPendiente = await subirFotoLimpia(E, enPendiente);

    // -----------------------------------------------------------------
    console.log('\n== 1. Las CINCO credenciales ==');
    // Las cuatro primeras son las que CLAUDE.md §9 ya documenta para
    // `send-push`; la quinta es nueva aquí y es la razón de ser de
    // `auth: ['secret','user']`.

    const sinLlave = await llamar(E, 'ninguna', { listing_id: propia });
    igual('sin llave → 401', sinLlave.status, 401);

    const inventada = await llamar(E, 'inventada', { listing_id: propia });
    igual('llave inventada → 401', inventada.status, 401);

    // La publishable es una llave VÁLIDA del proyecto, y aun así no autoriza:
    // no es `secret` ni trae sesión de usuario. Es la aserción que distingue
    // "la llave existe" de "la llave puede hacer esto".
    const publishable = await llamar(E, 'publishable', { listing_id: propia });
    igual('publishable (válida, pero sin sesión) → 401', publishable.status, 401);

    const conSecret = await llamar(E, 'secret', {
      bucket_id: 'listing-photos', name: `${credencialSecret}/x.jpg`, entity_id: String(credencialSecret),
    });
    ok('secret key → pasa', conSecret.status === 200, `HTTP ${conSecret.status}`);

    const conUser = await llamar(E, 'user', { listing_id: credencialUser }, tDueno);
    ok('JWT de usuario → pasa', conUser.status === 200, `HTTP ${conUser.status}`);

    // -----------------------------------------------------------------
    console.log('\n== 2. Ownership: el camino de usuario es solo para el dueño ==');

    const dePropia = await llamar(E, 'user', { listing_id: propia }, tDueno);
    ok('el dueño SÍ puede pedir moderar lo suyo', dePropia.status === 200,
       `HTTP ${dePropia.status}`);

    const deAjena = await llamar(E, 'user', { listing_id: ajena }, tDueno);
    ok('un tercero NO puede pedir moderar lo ajeno',
       deAjena.status === 404, `HTTP ${deAjena.status}`);

    // 404 y no 403 a propósito: un 403 confirmaría que esa publicación existe
    // y es de alguien más. La aserción mira el código, no solo que rechace.
    const inexistente = await llamar(E, 'user', { listing_id: 999999999 }, tDueno);
    ok('una publicación ajena y una inexistente se ven IGUAL desde afuera',
       deAjena.status === inexistente.status &&
         JSON.stringify(deAjena.json) === JSON.stringify(inexistente.json),
       `ajena ${deAjena.status} ${JSON.stringify(deAjena.json)} vs inexistente ${inexistente.status} ${JSON.stringify(inexistente.json)}`);

    // -----------------------------------------------------------------
    console.log('\n== 3. Forma del body ==');

    const sinListingId = await llamar(E, 'user', {}, tDueno);
    igual('camino de usuario sin listing_id → 400', sinListingId.status, 400);

    const triggerIncompleto = await llamar(E, 'secret', { bucket_id: 'avatars' });
    igual('payload de trigger incompleto → 400', triggerIncompleto.status, 400);

    const bucketRaro = await llamar(E, 'secret', {
      bucket_id: 'otro-bucket', name: 'x', entity_id: '1',
    });
    igual('bucket no moderado → 400', bucketRaro.status, 400);

    // -----------------------------------------------------------------
    console.log('\n== 4. Efectos sobre la base, con evaluación REAL ==');

    // `propia` empezó `activa` y `dePropia` (sección 2) la evaluó con el par
    // LIMPIO — es la ÚNICA llamada real que toca `propia` (las de la sección 1
    // ahora usan sus propias fixtures, `credencialSecret`/`credencialUser`, ver
    // arriba). Un veredicto `limpio` sobre una fila que YA es pública no es una
    // promoción — es un no-op — así que se queda `activa`. Si esto diera
    // `pendiente` o `bloqueada`, sería una señal real: o el texto dejó de
    // leerse limpio, o algo en el camino de escritura está mal.
    igual('una activa evaluada limpia se queda activa (no es promoción)',
          await estadoDe(E, propia), 'activa');

    // La auditoría se escribe SIEMPRE, incluso cuando el estado no se movió:
    // `listing_moderacion` es historial de EVALUACIONES, no de cambios.
    const filas = await auditoriasDe(E, propia);
    ok('la llamada dejó su fila en listing_moderacion',
       filas.length >= 1, `${filas.length} fila(s) tras 1 llamada`);
    ok('la fila guarda el veredicto REAL (limpio) y el estado resultante',
       filas.length > 0 && filas[0].veredicto === 'limpio' &&
         filas[0].estado_resultante === 'activa',
       JSON.stringify(filas[0]));

    // -----------------------------------------------------------------
    console.log('\n== 5. El trigger NO promueve — con una promoción real que bloquear ==');

    // `enPendiente` usa el MISMO par limpio: con evaluación real,
    // `decidirListing({...limpio}, 'pendiente')` SÍ propone `activa` — es la
    // única promoción que existe en todo el sistema. Por eso esta sección, a
    // diferencia de cuando la evaluación era un stub, YA NO puede pasar por
    // vacuidad: hay una promoción de verdad que el guard tiene que detener.

    const trigSobrePendiente = await llamar(E, 'secret', {
      bucket_id: 'listing-photos', name: `${enPendiente}/x.jpg`,
      entity_id: String(enPendiente),
    });
    ok('el TRIGGER sobre una pendiente LIMPIA → sigue pendiente (el guard actuó)',
       trigSobrePendiente.status === 200 &&
         (await estadoDe(E, enPendiente)) === 'pendiente',
       `HTTP ${trigSobrePendiente.status}`);

    // EL CONTROL POSITIVO, sobre la MISMA fila y el MISMO contenido: por el
    // camino de USUARIO (`puedePromover: true`) esa promoción SÍ ocurre. Sin
    // este segundo llamado, la aserción de arriba no distinguiría "el guard
    // bloqueó una promoción real" de "no había ninguna promoción que
    // bloquear" — es la diferencia entre una prueba real y una que solo LUCE
    // real. Va DESPUÉS a propósito: si fuera antes, `enPendiente` ya estaría
    // `activa` cuando el trigger la tocara, y la aserción de arriba pasaría
    // por una razón distinta (nunca promueve nada porque ya no está
    // `pendiente`).
    const porElDueno = await llamar(E, 'user', { listing_id: enPendiente }, tDueno);
    ok('la MISMA publicación, por el camino de usuario, SÍ promueve a activa',
       porElDueno.status === 200 &&
         (await estadoDe(E, enPendiente)) === 'activa',
       `HTTP ${porElDueno.status}, respuesta=${JSON.stringify(porElDueno.json)}`);


    // -----------------------------------------------------------------
    console.log('\n== 6. El TRIGGER de storage.objects escala de verdad ==');

    // Esta sección es la mitad cara del plan de Ola 2: `probe-storage.mjs`
    // prueba GRATIS que el trigger dispara con el payload correcto contra un
    // mock; aquí se prueba que, disparando contra la función DE VERDAD, el
    // estado de la publicación se mueve. Ninguna sustituye a la otra.
    //
    // EL ORDEN ES LOAD-BEARING: la publicación y su foto se crean ANTES de
    // repuntar Vault. Al revés, la subida inicial de la foto ya dispararía el
    // trigger y dejaría la fila `bloqueada` antes del overwrite — y la
    // aserción de abajo pasaría por la razón equivocada, sin haber ejercitado
    // la rama UPDATE en absoluto. Es la lección de `:C` en T11b (CLAUDE.md §3)
    // en su forma temporal: importa CUÁNDO corre cada paso, no solo qué afirma.
    escalable = await crearListing(
      E, dueno, `${PALABRA_PROHIBIDA} ${RUN}`, 'activa',
      `Publicación de prueba de RF-18 con ${PALABRA_PROHIBIDA} en el texto.`
    );
    fotoEscalable = await subirFotoLimpia(E, escalable);

    igual('control: antes de tocar nada la publicación está activa',
      await estadoDe(E, escalable), 'activa');

    previosVault = leerSecretos();
    ponerSecreto(previosVault, SECRETO_KEY, E.SECRET);
    ponerSecreto(previosVault, SECRETO_URL,
      `${E.API_URL.replace(/\/\/(127\.0\.0\.1|localhost)/, '//host.docker.internal')}` +
      `/functions/v1/moderar-contenido`);

    // EL OVERWRITE. `x-upsert: true` produce un UPDATE real sobre la misma fila
    // de `storage.objects` (F-spike del 2026-09-18), que es lo que despierta a
    // `objects_notify_moderacion_update`.
    const resOverwrite = await fetch(
      `${E.API_URL}/storage/v1/object/listing-photos/${fotoEscalable}`,
      {
        method: 'POST',
        headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`,
                   'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
        body: await sharp({
          create: { width: 320, height: 320, channels: 3, background: { r: 200, g: 200, b: 200 } },
        }).jpeg().toBuffer(),
      }
    );
    ok('el overwrite del objeto se acepta', resOverwrite.ok, `HTTP ${resOverwrite.status}`);

    const escalo = await esperarA(async () => (await estadoDe(E, escalable)) === 'bloqueada');
    ok('sobrescribir la foto de una publicación ACTIVA la escala a bloqueada',
      escalo, `estado final: ${await estadoDe(E, escalable)}`);

    // La auditoría no es decorado: es lo único que explica POR QUÉ se bloqueó,
    // y sin ella un revisor abre Studio y ve una fila `bloqueada` sin motivo
    // (migración 20260918000461).
    //
    // SE AFIRMA `lista_tecleada`, NO `eje_que_manda`, y la diferencia importa:
    // `ejeQueManda()` desempata por orden fijo con `vision` y `gptTexto` ANTES
    // que `listaTecleada`, así que si GPT también dice `bloquear` —probable con
    // este texto— el eje reportado sería `gptTexto`. Afirmarlo sería atar la
    // prueba a lo que conteste un modelo.
    const auditorias = await auditoriasConDetalle(E, escalable);
    const ultima = auditorias.at(-1);
    ok('la escalada dejó su fila de auditoría, con la palabra que la causó',
      ultima?.estado_resultante === 'bloqueada' &&
        Array.isArray(ultima?.detalle?.lista_tecleada) &&
        ultima.detalle.lista_tecleada.includes(PALABRA_PROHIBIDA),
      `${auditorias.length} fila(s), lista_tecleada=${JSON.stringify(ultima?.detalle?.lista_tecleada)}`);


    // -----------------------------------------------------------------
    console.log('\n== 7. La foto SIN FILA que dispara el trigger SE EVALÚA ==');

    // `.claude/rules/moderacion.md` §1: el objeto se sube ANTES de que exista
    // su fila en `listing_photos` — `storage.ts` sube y solo DESPUÉS
    // `guardarFotos()` la escribe. La sección 6 de arriba usa `x-upsert` sobre
    // una ruta YA registrada, que es el único caso donde eso coincide con "la
    // foto que dispara el trigger" y NO ejercita el hueco. Esta sección sí:
    // sube un objeto GENUINO (`upsert:false`, uuid nuevo, exactamente como
    // hace `storage.ts` de verdad) y NUNCA le escribe fila — es la ventana
    // real que el bug explotaba.
    //
    // POR QUÉ ESCALA A `pendiente` Y NO A `bloqueada`: la única forma de
    // llegar a `bloqueada` por el EJE DE LA FOTO es Vision SafeSearch en
    // `VERY_LIKELY`, contenido que este repo no sourcea ni genera ni para
    // pruebas (mismo criterio del caso 4 de la sección de arriba y de
    // `probe-moderacion-avatares.mjs`). La otra vía determinista —un acierto
    // de lista vía OCR— tiene TECHO en `pendiente` por diseño
    // (`decision.ts`, `nivelDeLista`, "EL TECHO NO ABRE UN HUECO"): nunca
    // bloquea solo. Por eso esta sección usa una foto con la palabra
    // prohibida IMPRESA como texto, que Vision lee por OCR real, y confirma
    // el mismo mecanismo (¿se incluyó ESA foto en el lote de Vision?) sin
    // tocar contenido explícito.
    //
    // Listing PROPIO de esta sección, no reusa `escalable`: aquel ya terminó
    // en `bloqueada`, terminal por la regla del piso — reusarlo
    // enmascararía si la foto nueva se evaluó o no. Título/descripción
    // LIMPIOS (verificados 5/5 GPT + 3/3 Vision), para que el único eje que
    // pueda mover el estado sea el de la foto.
    nuevaFotoListing = await crearListing(
      E, dueno, `${TITULO_LIMPIO} 7`, 'activa', DESCRIPCION_LIMPIA
    );

    igual('control: antes de subir nada la publicación está activa',
      await estadoDe(E, nuevaFotoListing), 'activa');

    fotoNueva = await subirFotoConOcrSucio(E, nuevaFotoListing, PALABRA_PROHIBIDA);

    const escaloPorOcr = await esperarA(
      async () => (await estadoDe(E, nuevaFotoListing)) === 'pendiente'
    );
    ok('la foto SIN fila escala la publicación de activa a pendiente',
      escaloPorOcr, `estado final: ${await estadoDe(E, nuevaFotoListing)}`);

    // La auditoría tiene que nombrar ESA foto específica, no una vieja —
    // `detalle.fotos` es la lista completa de lo que se evaluó, y sin la
    // unión esta foto simplemente no aparecería ahí.
    const auditoriasNueva = await auditoriasConDetalle(E, nuevaFotoListing);
    const ultimaNueva = auditoriasNueva.at(-1);
    const fotoEnDetalle = Array.isArray(ultimaNueva?.detalle?.fotos)
      ? ultimaNueva.detalle.fotos.find((f) => f.storage_path === fotoNueva)
      : undefined;
    ok('la foto SIN fila aparece en el detalle de auditoría, evaluada',
      ultimaNueva?.estado_resultante === 'pendiente' &&
        fotoEnDetalle?.estado === 'evaluada' &&
        Array.isArray(ultimaNueva?.detalle?.lista_ocr) &&
        ultimaNueva.detalle.lista_ocr.includes(PALABRA_PROHIBIDA),
      `foto=${JSON.stringify(fotoEnDetalle)}, lista_ocr=${JSON.stringify(ultimaNueva?.detalle?.lista_ocr)}`);

    // CONTROL NEGATIVO (corrido a mano, no automatizado — mismo criterio que
    // los casos 6/7/8 de `.claude/rules/moderacion.md` §6.3): comentando la
    // unión en `vision.ts` (`unirFotoDisparadora` devolviendo `pathsExistentes`
    // tal cual) y reiniciando `functions serve`, esta sección cae en las DOS
    // aserciones de arriba — la publicación se queda `activa` y no hay fila de
    // auditoría nueva con esta foto. Restaurado y reverificado en verde.
    // Resultado: 2026-09-19.

    // -----------------------------------------------------------------
    console.log('\n== 8. El reclamo: el camino cliente evalúa UNA vez, nunca dos a la vez ==');
    // `listing_moderacion_reclamos` (20260928000471). Cada fixture es PROPIA:
    // el reclamo es estado que avanza, y compartirlo entre casos haría que uno
    // pasara por el reclamo que dejó el anterior (la lección de T11b).

    // (a) DOS llamadas concurrentes del dueño sobre una pendiente limpia → UNA
    // sola evaluación. Las dos salen a la vez; la primera toma el reclamo en
    // milisegundos y la evaluación tarda segundos (1.6-5.0 s medidos), así que
    // la segunda encuentra el reclamo tomado.
    rConcurrente = await crearListing(E, dueno, `${TITULO_LIMPIO} reclamo`, 'pendiente', DESCRIPCION_LIMPIA);
    fotoRConcurrente = await subirFotoLimpia(E, rConcurrente);
    const [c1, c2] = await Promise.all([
      llamar(E, 'user', { listing_id: rConcurrente }, tDueno),
      llamar(E, 'user', { listing_id: rConcurrente }, tDueno),
    ]);
    const tomadas = [c1, c2].filter((c) => c.json?.sin_evaluar === 'reclamo_tomado').length;
    ok('dos llamadas concurrentes: las dos 200, UNA encontró el reclamo tomado',
      c1.status === 200 && c2.status === 200 && tomadas === 1,
      `HTTP ${c1.status}/${c2.status}, ${JSON.stringify(c1.json)} / ${JSON.stringify(c2.json)}`);
    igual('dos llamadas concurrentes → UNA sola fila de auditoría (se pagó una vez)',
      (await auditoriasDe(E, rConcurrente)).length, 1);
    const reclamoC = await reclamoDe(E, rConcurrente);
    ok('el reclamo de una evaluación COMPLETA queda con completada_at',
      reclamoC?.completada_at != null, JSON.stringify(reclamoC));

    // (b) Una TERCERA llamada, ya completada el alta → no evalúa. Es H2: un
    // dueño no puede re-tirar GPT por API sobre su propia publicación.
    const c3 = await llamar(E, 'user', { listing_id: rConcurrente }, tDueno);
    ok('una llamada posterior al alta completada NO evalúa',
      c3.status === 200 && c3.json?.sin_evaluar === 'reclamo_tomado',
      `HTTP ${c3.status} ${JSON.stringify(c3.json)}`);
    igual('…y no deja fila de auditoría nueva', (await auditoriasDe(E, rConcurrente)).length, 1);

    // (c) Reclamo HUÉRFANO (worker muerto): sin completar y de hace 2 min → el
    // TTL lo libera y se evalúa.
    rHuerfano = await crearListing(E, dueno, `${TITULO_LIMPIO} huerfano`, 'pendiente', DESCRIPCION_LIMPIA);
    fotoRHuerfano = await subirFotoLimpia(E, rHuerfano);
    await sembrarReclamo(E, rHuerfano, hace(120_000), null);
    const ch = await llamar(E, 'user', { listing_id: rHuerfano }, tDueno);
    ok('un reclamo huérfano (sin completar, > 60 s) se libera y SÍ se evalúa',
      ch.status === 200 && ch.json?.sin_evaluar === undefined &&
        (await auditoriasDe(E, rHuerfano)).length === 1,
      `HTTP ${ch.status} ${JSON.stringify(ch.json)}`);

    // (d) EL CONTROL DEL BUG que se cazó al diseñar: un reclamo COMPLETADO y
    // viejo NO lo toca el TTL. Sin `completada_at is null` en el delete, a los
    // 60 s cualquier llamada borraría la marca permanente y re-evaluaría.
    rCompletado = await crearListing(E, dueno, `${TITULO_LIMPIO} completado`, 'pendiente', DESCRIPCION_LIMPIA);
    await sembrarReclamo(E, rCompletado, hace(120_000), hace(110_000));
    const cc = await llamar(E, 'user', { listing_id: rCompletado }, tDueno);
    ok('un reclamo COMPLETADO y viejo NO se libera: no se evalúa',
      cc.status === 200 && cc.json?.sin_evaluar === 'reclamo_tomado' &&
        (await auditoriasDe(E, rCompletado)).length === 0,
      `HTTP ${cc.status} ${JSON.stringify(cc.json)}`);
    ok('…y el reclamo sigue ahí', (await reclamoDe(E, rCompletado))?.completada_at != null);

    // (e) Un reclamo EN VUELO (sin completar, recién tomado) → la llamada no
    // evalúa. Es el caso concurrente de (a), pero determinista.
    rEnVuelo = await crearListing(E, dueno, `${TITULO_LIMPIO} en vuelo`, 'pendiente', DESCRIPCION_LIMPIA);
    await sembrarReclamo(E, rEnVuelo, hace(0), null);
    const cv = await llamar(E, 'user', { listing_id: rEnVuelo }, tDueno);
    ok('un reclamo en vuelo (< 60 s) bloquea la segunda evaluación',
      cv.status === 200 && cv.json?.sin_evaluar === 'reclamo_tomado' &&
        (await auditoriasDe(E, rEnVuelo)).length === 0,
      `HTTP ${cv.status} ${JSON.stringify(cv.json)}`);

    // (f) FALLO MANEJADO → el reclamo se libera. Una pendiente limpia SIN FOTOS
    // intenta promoverse y choca con `listings_enforce_activation_has_photos`:
    // es el 500 conocido de `.claude/rules/moderacion.md` §9, usado aquí como
    // fallo determinista. Solo cuesta la llamada a OpenAI (no hay fotos).
    rSinFotos = await crearListing(E, dueno, `${TITULO_LIMPIO} sin fotos`, 'pendiente', DESCRIPCION_LIMPIA);
    const cf = await llamar(E, 'user', { listing_id: rSinFotos }, tDueno);
    ok('un fallo manejado (500) LIBERA el reclamo para el reintento',
      cf.status === 500 && (await reclamoDe(E, rSinFotos)) === undefined,
      `HTTP ${cf.status} ${JSON.stringify(cf.json)}, reclamo=${JSON.stringify(await reclamoDe(E, rSinFotos))}`);

    // (g) EL COMPARE-AND-SET. Mientras la evaluación corre (4-5 s en local),
    // "Studio" bloquea la publicación. Sin el CAS, el update de la función
    // pisaría esa `bloqueada` con `activa` — la transición que CLAUDE.md §3
    // dice que no ocurre por ningún camino. Con el CAS, el update afecta 0
    // filas, gana lo que ya estaba escrito y la auditoría lo anota.
    // Depende de TIEMPO: si la evaluación terminara antes de 0.5 s, la
    // aserción de control de abajo lo dice en vez de pasar en falso.
    rCarrera = await crearListing(E, dueno, `${TITULO_LIMPIO} carrera`, 'pendiente', DESCRIPCION_LIMPIA);
    fotoRCarrera = await subirFotoLimpia(E, rCarrera);
    const enCurso = llamar(E, 'user', { listing_id: rCarrera }, tDueno);
    await dormir(500);
    const antesDelBloqueo = await auditoriasDe(E, rCarrera);
    await fetch(`${E.API_URL}/rest/v1/listings?id=eq.${rCarrera}`, {
      method: 'PATCH',
      headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`,
                 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'bloqueada' }),
    });
    const cr = await enCurso;
    ok('control: el bloqueo llegó ANTES de que la evaluación escribiera',
      antesDelBloqueo.length === 0, `${antesDelBloqueo.length} fila(s) de auditoría antes del bloqueo`);
    igual('una bloqueada escrita durante la evaluación NO la pisa la promoción (CAS)',
      await estadoDe(E, rCarrera), 'bloqueada');
    const audCarrera = (await auditoriasConDetalle(E, rCarrera)).at(-1);
    ok('…la respuesta y la auditoría dicen el estado vigente y anotan la carrera',
      cr.json?.estado === 'bloqueada' && audCarrera?.estado_resultante === 'bloqueada' &&
        audCarrera?.detalle?.descartado_por_carrera === true &&
        audCarrera?.detalle?.estado_propuesto === 'activa',
      `respuesta=${JSON.stringify(cr.json)}, auditoría=${JSON.stringify({ r: audCarrera?.estado_resultante, c: audCarrera?.detalle?.descartado_por_carrera, p: audCarrera?.detalle?.estado_propuesto })}`);

  } finally {
    // Vault primero: un secreto repuntado que sobreviva a la corrida deja el
    // trigger llamando a un `functions serve` que ya no está.
    if (previosVault) {
      try { restaurarSecreto(previosVault, SECRETO_KEY); } catch { /* nada que hacer */ }
      try { restaurarSecreto(previosVault, SECRETO_URL); } catch { /* nada que hacer */ }
    }

    const del = (tabla, filtro) =>
      fetch(`${E.API_URL}/rest/v1/${tabla}?${filtro}`, {
        method: 'DELETE',
        headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      }).catch(() => {});

    // El objeto de Storage NO se borra solo al borrar el listing: la fila de
    // `listing_photos` sí cascadea (FK `on delete cascade`, confirmado contra
    // `pg_constraint`), pero `storage.objects` es un sistema aparte sin FK a
    // `listings`. Sin este borrado explícito, cada corrida deja un JPEG
    // huérfano en el bucket — mismo gotcha que CLAUDE.md §9 ya documenta.
    for (const ruta of [fotoEnPendiente, fotoEscalable, fotoNueva, fotoRConcurrente, fotoRHuerfano, fotoRCarrera]) {
      if (!ruta) continue;
      await fetch(`${E.API_URL}/storage/v1/object/listing-photos/${ruta}`, {
        method: 'DELETE',
        headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      }).catch(() => {});
    }

    for (const id of [propia, ajena, enPendiente, escalable, nuevaFotoListing,
                       credencialSecret, credencialUser, rConcurrente, rHuerfano,
                       rCompletado, rEnVuelo, rSinFotos, rCarrera]) {
      if (id) await del('listings', `id=eq.${id}`);
    }
    for (const id of [dueno, ajeno]) {
      if (id) {
        await fetch(`${E.API_URL}/auth/v1/admin/users/${id}`, {
          method: 'DELETE',
          headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
        }).catch(() => {});
      }
    }
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
