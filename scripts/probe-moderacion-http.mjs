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
      bucket_id: 'listing-photos', name: `${propia}/x.jpg`, entity_id: String(propia),
    });
    ok('secret key → pasa', conSecret.status === 200, `HTTP ${conSecret.status}`);

    const conUser = await llamar(E, 'user', { listing_id: propia }, tDueno);
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

    // `propia` empezó `activa` y las tres llamadas de arriba (conSecret,
    // conUser, dePropia) la evaluaron con el par LIMPIO. Un veredicto `limpio`
    // sobre una fila que YA es pública no es una promoción — es un no-op — así
    // que se queda `activa`. Si esto diera `pendiente` o `bloqueada`, sería
    // una señal real: o el texto dejó de leerse limpio, o algo en el camino de
    // escritura está mal.
    igual('una activa evaluada limpia se queda activa (no es promoción)',
          await estadoDe(E, propia), 'activa');

    // La auditoría se escribe SIEMPRE, incluso cuando el estado no se movió:
    // `listing_moderacion` es historial de EVALUACIONES, no de cambios.
    const filas = await auditoriasDe(E, propia);
    ok('cada llamada deja su fila en listing_moderacion',
       filas.length >= 3, `${filas.length} fila(s) tras 3 llamadas`);
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

  } finally {
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
    if (fotoEnPendiente) {
      await fetch(`${E.API_URL}/storage/v1/object/listing-photos/${fotoEnPendiente}`, {
        method: 'DELETE',
        headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      }).catch(() => {});
    }

    for (const id of [propia, ajena, enPendiente]) {
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
