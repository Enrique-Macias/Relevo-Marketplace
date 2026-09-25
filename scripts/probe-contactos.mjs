// ===========================================================================
// Relevo — pruebas de TODO lo puro de la lista de contactos de
// "¿A quién le vendiste?" (RF-12): deduplicar por persona un log append-only.
// Cubre `src/lib/contactos.ts`: `deduplicarContactos()`.
//
// Cómo correrlo:
//     node scripts/probe-contactos.mjs
//
// No necesita el stack local, ni red, ni credenciales — mismo criterio que
// `probe-calificacion-pendiente.mjs`/`probe-ubicacion.mjs`: el módulo es puro
// a propósito (sin imports, CLAUDE.md §6), así que Node lo carga directo
// (type stripping, v22.6+). Si alguien le mete un import de React Native o de
// Supabase, este script deja de arrancar, y esa es la señal.
// ===========================================================================

import { deduplicarContactos } from '../src/lib/contactos.ts';

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

function contacto(userId, createdAt) {
  return { userId, nombre: `Nombre ${userId}`, fotoUrl: null, createdAt };
}

// ---------------------------------------------------------------------------
// 1. Un solo contacto → se queda igual.
// ---------------------------------------------------------------------------
{
  const a = contacto('u1', '2026-09-01T00:00:00.000Z');
  const resultado = deduplicarContactos([a]);
  ok(
    '(1) un solo contacto se queda igual',
    resultado.length === 1 && resultado[0].userId === 'u1',
    `resultado=${JSON.stringify(resultado.map((c) => c.userId))}`
  );
}

// ---------------------------------------------------------------------------
// 2. Dos taps de la misma persona → una sola fila, con el createdAt MÁS
//    RECIENTE de las dos, sin importar el orden de entrada.
// ---------------------------------------------------------------------------
{
  const viejo = contacto('u1', '2026-09-01T00:00:00.000Z');
  const reciente = contacto('u1', '2026-09-03T00:00:00.000Z');

  const r1 = deduplicarContactos([reciente, viejo]); // recién-primero
  const r2 = deduplicarContactos([viejo, reciente]); // viejo-primero

  ok(
    '(2) dos taps de la misma persona colapsan a una fila con el createdAt más reciente',
    r1.length === 1 &&
      r2.length === 1 &&
      r1[0].createdAt === reciente.createdAt &&
      r2[0].createdAt === reciente.createdAt,
    `orden [reciente,viejo] → ${JSON.stringify(r1.map((c) => c.createdAt))}; ` +
      `orden [viejo,reciente] → ${JSON.stringify(r2.map((c) => c.createdAt))}`
  );
}

// ---------------------------------------------------------------------------
// 3. Contactos de personas distintas → todos se conservan, sin fusionarse,
//    ordenados por createdAt descendente.
// ---------------------------------------------------------------------------
{
  const a = contacto('u1', '2026-09-01T00:00:00.000Z');
  const b = contacto('u2', '2026-09-03T00:00:00.000Z'); // más reciente
  const c = contacto('u3', '2026-09-02T00:00:00.000Z');

  const resultado = deduplicarContactos([a, b, c]);
  ok(
    '(3) contactos de personas distintas se conservan todos, ordenados por createdAt desc',
    resultado.length === 3 && resultado.map((r) => r.userId).join(',') === 'u2,u3,u1',
    `orden=${resultado.map((r) => r.userId).join(',')}`
  );
}

// ---------------------------------------------------------------------------
// 4. Tres taps de la misma persona intercalados con otra persona → una fila
//    por persona, cada una con su createdAt más reciente.
// ---------------------------------------------------------------------------
{
  const u1a = contacto('u1', '2026-09-01T00:00:00.000Z');
  const u2a = contacto('u2', '2026-09-02T00:00:00.000Z');
  const u1b = contacto('u1', '2026-09-04T00:00:00.000Z'); // la más reciente de u1
  const u1c = contacto('u1', '2026-09-03T00:00:00.000Z');

  const resultado = deduplicarContactos([u1a, u2a, u1b, u1c]);
  const u1 = resultado.find((c) => c.userId === 'u1');
  const u2 = resultado.find((c) => c.userId === 'u2');

  ok(
    '(4) tres taps de la misma persona intercalados con otra → una fila por persona',
    resultado.length === 2 && u1?.createdAt === u1b.createdAt && u2?.createdAt === u2a.createdAt,
    `resultado=${JSON.stringify(resultado.map((c) => [c.userId, c.createdAt]))}`
  );
}

// ---------------------------------------------------------------------------
// 5. Empate exacto de createdAt para la misma persona → gana el primero visto
//    en el arreglo de entrada (desempate determinista).
// ---------------------------------------------------------------------------
{
  const mismaFecha = '2026-09-05T12:00:00.000Z';
  const primero = { userId: 'u1', nombre: 'Primero', fotoUrl: null, createdAt: mismaFecha };
  const segundo = { userId: 'u1', nombre: 'Segundo', fotoUrl: null, createdAt: mismaFecha };

  const resultado = deduplicarContactos([primero, segundo]);
  ok(
    '(5) empate exacto de createdAt → gana el primero visto en el arreglo',
    resultado.length === 1 && resultado[0].nombre === 'Primero',
    `nombre=${resultado[0]?.nombre}`
  );
}

// ---------------------------------------------------------------------------
// 6. Arreglo vacío → arreglo vacío.
// ---------------------------------------------------------------------------
{
  const resultado = deduplicarContactos([]);
  ok('(6) arreglo vacío → arreglo vacío', resultado.length === 0, `resultado=${JSON.stringify(resultado)}`);
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
