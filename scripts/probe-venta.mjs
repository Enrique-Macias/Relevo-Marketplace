// ===========================================================================
// Relevo — amarre entre la condición de congelamiento del CLIENTE y la policy
// `listing_sales_update_seller` (RF-07/RF-12).
//
// Cómo correrlo (local, con el stack arriba):
//     supabase start           # o supabase db reset
//     node scripts/probe-venta.mjs
//
// POR QUÉ EXISTE, SI YA HAY UNA SUITE DE RLS:
// `supabase/tests/rls.sql` (T19) prueba la POLICY. Este script prueba que la
// condición que el cliente evalúa para DECIDIR SI PINTAR "Cambiar comprador"
// coincida con la que la base usa para PERMITIRLO. Son la misma condición
// escrita dos veces, en dos runtimes distintos, y desincronizarlas no produce
// ningún error: solo una fila de menú que desaparece de más, dejando al
// vendedor sin forma de corregir un comprador mal elegido.
//
// ES EL PARALELO DIRECTO DE T18 CON formatPrecio / private.formato_precio(),
// pero con una diferencia que obliga a que viva aquí y no en la suite: allá las
// dos implementaciones producen EL MISMO STRING, así que una aserción SQL puede
// compararlo carácter por carácter. Aquí un lado es una query del cliente y el
// otro una cláusula `using` — no hay salida común observable desde SQL. El
// amarre tiene que ser un script que ejecute LOS DOS LADOS contra el mismo
// estado.
//
// LO QUE CADA ESCENARIO ATRAPA:
//   · Escenario 1 (califica el COMPRADOR registrado) — la ventana sigue
//     abierta. Es el que caza la variante bidireccional, la que se evaluó y se
//     descartó: con ella, el cliente esconde "Cambiar comprador" y la policy
//     bloquea el update, dejando incorregible un error del vendedor por un acto
//     de un tercero.
//   · Escenario 2 (califica el VENDEDOR) — la ventana se cierra. Es el control
//     positivo: sin él, una condición que devolviera "congelado" SIEMPRE también
//     pasaría el escenario 1... no, pasaría solo la mitad. Y una que devolviera
//     "nunca congelado" pasaría el 1 entero. Van los dos o ninguno sirve.
//
// Sin dependencias: fetch nativo contra PostgREST, igual que probe-storage.mjs.
// `src/lib/confianza.ts` NO se puede importar desde Node —arrastra
// expo-secure-store, expo-crypto y AsyncStorage— así que su condición va
// transcrita abajo en FILTROS_CONGELAMIENTO, con un tripwire sobre el fuente
// para que esa transcripción no pueda desviarse en silencio.
//
// EL TRIPWIRE Y EL ESCENARIO 3 NO SON REDUNDANTES — no borres uno pensando que
// el otro ya cubre todo. Se reparten el trabajo:
//   · el escenario 3 vigila la LÓGICA (¿la condición está bien pensada?),
//     ejecutándola contra la base en las dos polaridades;
//   · el tripwire vigila la FIRMA Y EL CABLEADO (¿la app usa esa condición?),
//     leyendo el fuente.
// Como aquí se TRANSCRIBE la query en vez de importar la función, el escenario 3
// prueba la semántica pero no que la app la use. MEDIDO: al reintroducir a
// propósito el bug de derivar el vendedor de la sesión, el escenario 3 pasó en
// verde y lo cazó únicamente el tripwire. Ver CLAUDE.md §3.
//
// Crea sus propios usuarios y publicaciones, con correos únicos por corrida, y
// limpia en un `finally`. Si una corrida muere de golpe puede dejar basura en la
// base LOCAL; `supabase db reset` la borra.
// ===========================================================================

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

function ok(nombre, cond, detalle) {
  if (cond) {
    pasadas++;
    console.log(`  ok — ${nombre}${detalle ? ` (${detalle})` : ''}`);
  } else {
    fallos.push(nombre);
    console.log(`  FALLÓ — ${nombre}${detalle ? ` (${detalle})` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// LA CONDICIÓN DEL CLIENTE, transcrita
// ---------------------------------------------------------------------------

// Esto es `congelada()` de src/lib/confianza.ts, escrito como querystring de
// PostgREST. Las TRES igualdades son el punto: es DIRECCIONAL — `from_user_id`
// es el VENDEDOR y `to_user_id` el comprador registrado. Un `or=(...)` aquí, o
// quitar cualquiera de los dos filtros de persona, es la variante que se
// descartó.
const FILTROS_CONGELAMIENTO = (listingId, vendedorId, compradorId) =>
  `listing_id=eq.${listingId}&from_user_id=eq.${vendedorId}&to_user_id=eq.${compradorId}`;

// TRIPWIRE SOBRE EL FUENTE. Sin esto, la transcripción de arriba y el
// `congelada()` real podrían desviarse sin que nadie se entere: el script
// seguiría en verde probando una condición que la app ya no usa. No es un
// chequeo semántico —no puede serlo desde aquí— sino de FORMA: que sigan
// estando los dos filtros de persona y que no haya aparecido un `.or(`, que es
// como se escribiría la variante bidireccional en supabase-js.
function verificarFuenteDelCliente() {
  const src = readFileSync(new URL('../src/lib/confianza.ts', import.meta.url), 'utf8');
  const cuerpo = src.slice(src.indexOf('async function congelada('));
  const fin = cuerpo.indexOf('\n}');
  const congelada = cuerpo.slice(0, fin);

  ok('congelada() sigue filtrando por from_user_id (el vendedor)',
    congelada.includes("'from_user_id'"));
  ok('congelada() sigue filtrando por to_user_id (el comprador registrado)',
    congelada.includes("'to_user_id'"));
  ok('congelada() NO usa un `.or(` — sería la variante bidireccional descartada',
    !congelada.includes('.or('));

  // El vendedor entra COMO PARÁMETRO, no se deriva de la sesión. Derivarlo hace
  // que la ruta del comprador (`useVentaDetalle`) pregunte "¿me califiqué a mí
  // mismo?" y devuelva false siempre. Lo prueba el escenario 3; esto lo caza en
  // el fuente, antes de llegar a la red.
  ok('congelada() recibe vendedorId como parámetro, no de la sesión',
    congelada.includes('vendedorId: string') && !congelada.includes('auth.getUser()'));
}

// ---------------------------------------------------------------------------
// Llamadas a la API
// ---------------------------------------------------------------------------

async function crearUsuario(E, correo) {
  const res = await fetch(`${E.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`,
               'Content-Type': 'application/json' },
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

/** Con la secret key: `authenticated` no puede insertar en nombre de otro. */
async function comoAdmin(E, ruta, body, method = 'POST') {
  const res = await fetch(`${E.API_URL}/rest/v1/${ruta}`, {
    method,
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`,
               'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${ruta}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const crearListing = (E, userId, titulo) =>
  comoAdmin(E, 'listings', { user_id: userId, categoria_id: 1, universidad_id: 1,
                             campus_id: 1, titulo, precio: 100, condicion: 'nuevo',
                             estado: 'activa' }).then((r) => r[0].id);

/** LADO CLIENTE: la lectura exacta que hace `congelada()`. */
async function congeladaSegunCliente(E, tok, listingId, vendedorId, compradorId) {
  const res = await fetch(
    `${E.API_URL}/rest/v1/ratings?select=id&${FILTROS_CONGELAMIENTO(listingId, vendedorId, compradorId)}`,
    { headers: { apikey: E.PUBLISHABLE, Authorization: `Bearer ${tok}` } }
  );
  if (!res.ok) throw new Error(`congelada: ${res.status} ${await res.text()}`);
  return (await res.json()).length > 0;
}

/**
 * LADO BASE: la escritura exacta de `corregirComprador()`.
 *
 * Devuelve cuántas filas afectó. Un rechazo por congelamiento NO lanza: el
 * `using` de la policy filtra, así que el update afecta 0 y sale HTTP 200. Es
 * justo por eso que el cliente tiene que contar en vez de confiar en el error.
 */
async function corregirComprador(E, tok, listingId, compradorId) {
  const res = await fetch(`${E.API_URL}/rest/v1/listing_sales?listing_id=eq.${listingId}`, {
    method: 'PATCH',
    headers: { apikey: E.PUBLISHABLE, Authorization: `Bearer ${tok}`,
               'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ comprador_id: compradorId }),
  });
  if (!res.ok) throw new Error(`corregirComprador: ${res.status} ${await res.text()}`);
  return (await res.json()).length;
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

  console.log('\n== La transcripción sigue reflejando a congelada() ==');
  verificarFuenteDelCliente();

  // Mismo reparto que T19: vendedor, comprador real, y un tercero que preguntó
  // y no compró (el destino de la corrección).
  const correos = {
    v: `probe-vendedor-${RUN}@tec.mx`,
    c: `probe-comprador-${RUN}@tec.mx`,
    t: `probe-tercero-${RUN}@tec.mx`,
  };
  let vendedor, comprador, tercero, uno, dos;

  try {
    vendedor = await crearUsuario(E, correos.v);
    comprador = await crearUsuario(E, correos.c);
    tercero = await crearUsuario(E, correos.t);
    const tVendedor = await token(E, correos.v);
    const tComprador = await token(E, correos.c);

    // Dos publicaciones: una por escenario. Autocontenidas entre sí, misma
    // moraleja que las secciones de la suite SQL — compartirlas haría que el
    // segundo escenario dependiera del estado que dejó el primero.
    uno = await crearListing(E, vendedor, `Probe venta A ${RUN}`);
    dos = await crearListing(E, vendedor, `Probe venta B ${RUN}`);

    for (const id of [uno, dos]) {
      await comoAdmin(E, 'listing_contacts', [
        { user_id: comprador, listing_id: id },
        { user_id: tercero, listing_id: id },
      ]);
      await comoAdmin(E, 'listing_sales', { listing_id: id, comprador_id: comprador });
      await comoAdmin(E, `listings?id=eq.${id}`, { estado: 'vendida' }, 'PATCH');
    }

    // -----------------------------------------------------------------------
    console.log('\n== Escenario 1 — califica el COMPRADOR registrado ==');
    // Va como el comprador de verdad, no con la secret key: can_rate() lo
    // autoriza (es el comprador acreditado) y así se ejercita ese camino.
    const resRating = await fetch(`${E.API_URL}/rest/v1/ratings`, {
      method: 'POST',
      headers: { apikey: E.PUBLISHABLE, Authorization: `Bearer ${tComprador}`,
                 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_user_id: comprador, to_user_id: vendedor,
                             listing_id: uno, estrellas: 4 }),
    });
    ok('el comprador registrado SÍ puede calificar al vendedor',
      resRating.ok, `HTTP ${resRating.status}`);

    ok('LADO CLIENTE: congelada === false — no se disparó por la dirección equivocada',
      (await congeladaSegunCliente(E, tVendedor, uno, vendedor, comprador)) === false);

    ok('LADO BASE: corregirComprador() SÍ tiene éxito (afectó 1 fila)',
      (await corregirComprador(E, tVendedor, uno, tercero)) === 1);

    // -----------------------------------------------------------------------
    console.log('\n== Escenario 2 — califica el VENDEDOR ==');
    await comoAdmin(E, 'ratings', { from_user_id: vendedor, to_user_id: comprador,
                                    listing_id: dos, estrellas: 5 });

    ok('LADO CLIENTE: congelada === true',
      (await congeladaSegunCliente(E, tVendedor, dos, vendedor, comprador)) === true);

    ok('LADO BASE: corregirComprador() afecta 0 filas (la policy filtró, sin error)',
      (await corregirComprador(E, tVendedor, dos, tercero)) === 0);

    ok('y el comprador registrado no cambió',
      (await comoAdmin(E, `listing_sales?listing_id=eq.${dos}&select=comprador_id`,
                       undefined, 'GET'))[0].comprador_id === comprador);

    // -----------------------------------------------------------------------
    console.log('\n== Escenario 3 — la MISMA condición por la ruta del COMPRADOR ==');
    // `useVentaDetalle` también llama a fetchVenta, y ahí QUIEN LLAMA NO ES EL
    // VENDEDOR. `vendedorId` tiene que ser el dueño del listing, no la sesión.
    //
    // Este escenario existe por un bug real: `congelada()` derivaba el vendedor
    // de `supabase.auth.getUser()`, así que por esta ruta preguntaba "¿me
    // califiqué a mí mismo?" y devolvía false SIEMPRE. No reventaba y nadie lo
    // leía todavía, o sea que era invisible — exactamente lo que este script
    // existe para que no vuelva a pasar. Por eso no basta con "no truena": se
    // comprueban LAS DOS POLARIDADES desde el token del comprador.

    // Polaridad true. ESTA es la aserción que caza la regresión: con el
    // vendedor derivado de la sesión, la query sería (comprador→comprador) y
    // daría false.
    ok('ruta comprador, polaridad true: la reseña del VENDEDOR congela',
      (await congeladaSegunCliente(E, tComprador, dos, vendedor, comprador)) === true);

    // Polaridad false, sobre `uno`: ahí el escenario 1 dejó a `tercero` como
    // comprador registrado y la única reseña es comprador→vendedor, así que
    // (vendedor→tercero) no existe.
    ok('ruta comprador, polaridad false: sin reseña del vendedor no congela',
      (await congeladaSegunCliente(E, tComprador, uno, vendedor, tercero)) === false);

    // Y el contraste explícito con el bug: pasar a quien llama en vez del dueño
    // devuelve el valor EQUIVOCADO sobre el mismo estado. Si algún día esta
    // aserción empieza a fallar es que `fetchVenta` volvió a derivar el
    // vendedor de la sesión y las dos llamadas dejaron de distinguirse.
    ok('pasar a quien llama en vez del dueño da el valor equivocado (el bug corregido)',
      (await congeladaSegunCliente(E, tComprador, dos, comprador, comprador)) === false);
  } finally {
    for (const id of [uno, dos]) {
      if (id) await fetch(`${E.API_URL}/rest/v1/listings?id=eq.${id}`, {
        method: 'DELETE', headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      }).catch(() => {});
    }
    for (const id of [vendedor, comprador, tercero]) {
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
