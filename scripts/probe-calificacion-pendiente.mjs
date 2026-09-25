// ===========================================================================
// Relevo — pruebas de TODO lo puro de "auto-abrir Calificar" (RF-12): qué
// compra pendiente ofrecer, si alguna. Cubre `src/lib/calificacion-pendiente.ts`:
// `elegirPendiente()`.
//
// Cómo correrlo:
//     node scripts/probe-calificacion-pendiente.mjs
//
// No necesita el stack local, ni red, ni credenciales — mismo criterio que
// `probe-ubicacion.mjs`/`probe-moderacion.mjs`: el módulo es puro a propósito
// (sin imports, CLAUDE.md §6), así que Node lo carga directo (type stripping,
// v22.6+). Si alguien le mete un import de React Native o de Supabase, este
// script deja de arrancar, y esa es la señal.
// ===========================================================================

import { elegirPendiente } from '../src/lib/calificacion-pendiente.ts';

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

function compra(listingId, createdAt) {
  return {
    listingId,
    sellerId: `vendedor-${listingId}`,
    sellerName: `Vendedor ${listingId}`,
    sellerFotoUrl: null,
    createdAt,
  };
}

// ---------------------------------------------------------------------------
// 1. Elige la más reciente entre varias, en los dos órdenes de arreglo.
// ---------------------------------------------------------------------------
{
  const a = compra(1, '2026-09-01T00:00:00.000Z');
  const b = compra(2, '2026-09-03T00:00:00.000Z'); // la más reciente
  const c = compra(3, '2026-09-02T00:00:00.000Z');

  const r1 = elegirPendiente([a, b, c], []);
  const r2 = elegirPendiente([c, a, b], []);
  ok(
    '(1) elige la más reciente, sin importar el orden del arreglo',
    r1?.listingId === 2 && r2?.listingId === 2,
    `orden [a,b,c] → listingId=${r1?.listingId}; orden [c,a,b] → listingId=${r2?.listingId}`
  );
}

// ---------------------------------------------------------------------------
// 2. Respeta la lista de omitidas: la más reciente está omitida → se elige la
//    siguiente más reciente no omitida.
// ---------------------------------------------------------------------------
{
  const a = compra(1, '2026-09-01T00:00:00.000Z');
  const b = compra(2, '2026-09-03T00:00:00.000Z'); // la más reciente, pero omitida
  const c = compra(3, '2026-09-02T00:00:00.000Z'); // la segunda más reciente

  const resultado = elegirPendiente([a, b, c], [2]);
  ok(
    '(2) la más reciente omitida → cae a la siguiente más reciente',
    resultado?.listingId === 3,
    `listingId=${resultado?.listingId}`
  );
}

// ---------------------------------------------------------------------------
// 3. Todas omitidas → null.
// ---------------------------------------------------------------------------
{
  const a = compra(1, '2026-09-01T00:00:00.000Z');
  const b = compra(2, '2026-09-02T00:00:00.000Z');

  const resultado = elegirPendiente([a, b], [1, 2]);
  ok('(3) todas las candidatas omitidas → null', resultado === null, `resultado=${resultado}`);
}

// ---------------------------------------------------------------------------
// 4. Candidatas vacías → null (con omitidas NO vacía, para no confundir
//    "vacío por candidatas" con "vacío por omitidas").
// ---------------------------------------------------------------------------
{
  const resultado = elegirPendiente([], [99, 100]);
  ok(
    '(4) candidatas vacías → null, sin mirar omitidas',
    resultado === null,
    `resultado=${resultado}`
  );
}

// ---------------------------------------------------------------------------
// 5. Una sola candidata NO omitida → esa misma.
// ---------------------------------------------------------------------------
{
  const a = compra(7, '2026-09-01T00:00:00.000Z');
  const resultado = elegirPendiente([a], []);
  ok('(5) una sola candidata no omitida → esa misma', resultado?.listingId === 7, `listingId=${resultado?.listingId}`);
}

// ---------------------------------------------------------------------------
// 6. Empate exacto en createdAt → desempate determinista por mayor listingId,
//    en los dos órdenes de arreglo.
// ---------------------------------------------------------------------------
{
  const mismaFecha = '2026-09-05T12:00:00.000Z';
  const a = compra(10, mismaFecha);
  const b = compra(20, mismaFecha); // mayor listingId, debe ganar

  const r1 = elegirPendiente([a, b], []);
  const r2 = elegirPendiente([b, a], []);
  ok(
    '(6) empate exacto en createdAt → gana el de mayor listingId, en cualquier orden',
    r1?.listingId === 20 && r2?.listingId === 20,
    `orden [a,b] → listingId=${r1?.listingId}; orden [b,a] → listingId=${r2?.listingId}`
  );
}

// ---------------------------------------------------------------------------
// 7. Un id en omitidas que no existe entre las candidatas → no filtra nada de
//    más; mismo resultado que sin esa entrada extra.
// ---------------------------------------------------------------------------
{
  const a = compra(1, '2026-09-01T00:00:00.000Z');
  const b = compra(2, '2026-09-02T00:00:00.000Z'); // la más reciente

  const sinExtra = elegirPendiente([a, b], []);
  const conExtra = elegirPendiente([a, b], [999]);
  ok(
    '(7) un id de omitidas ajeno a las candidatas es no-op',
    sinExtra?.listingId === conExtra?.listingId && conExtra?.listingId === 2,
    `sinExtra=${sinExtra?.listingId}, conExtra=${conExtra?.listingId}`
  );
}

// ---------------------------------------------------------------------------
// 8. Exactamente UNA candidata, y esa está omitida → null. Distinto del grupo
//    3 ("todas omitidas", plural): el caso degenerado de un solo elemento
//    filtrado también debe dar null, no esa misma candidata por un error de
//    índice en la reducción.
// ---------------------------------------------------------------------------
{
  const a = compra(42, '2026-09-01T00:00:00.000Z');
  const resultado = elegirPendiente([a], [42]);
  ok(
    '(8) una sola candidata, y está omitida → null',
    resultado === null,
    `resultado=${JSON.stringify(resultado)}`
  );
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
