// ===========================================================================
// Relevo — pruebas de TODO lo puro de "Detectar campus más cercano" (fase
// 2C). Cubre `src/lib/ubicacion.ts`: haversine y `campusMasCercano()`.
//
// Cómo correrlo:
//     node scripts/probe-ubicacion.mjs
//
// No necesita el stack local, ni red, ni credenciales — mismo criterio que
// `probe-moderacion.mjs`: el módulo es puro a propósito (sin imports,
// CLAUDE.md §6), así que Node lo carga directo (type stripping, v22.6+). Si
// alguien le mete un import de React Native o de Supabase, este script deja
// de arrancar, y esa es la señal.
// ===========================================================================

import { campusMasCercano, distanciaKm, UMBRAL_CERCANIA_KM } from '../src/lib/ubicacion.ts';

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
// 1. Punto DENTRO de un campus: distancia casi cero, y ES el elegido.
// ---------------------------------------------------------------------------
{
  const monterrey = { id: 1, latitud: 25.6514, longitud: -100.2895 };
  const otro = { id: 2, latitud: 19.4326, longitud: -99.1332 }; // CDMX, lejos
  const origen = { latitud: 25.6514, longitud: -100.2895 };

  const resultado = campusMasCercano(origen, [otro, monterrey]);
  ok(
    '(1) un punto dentro de un campus lo elige a él, distancia ~0',
    resultado !== null && resultado.id === 1 && resultado.distanciaKm < 0.01,
    `id=${resultado?.id}, distanciaKm=${resultado?.distanciaKm}`
  );
}

// ---------------------------------------------------------------------------
// 2. Punto EQUIDISTANTE entre dos campus: tie-break por menor id, sin
//    importar el orden en que llegan en el arreglo.
// ---------------------------------------------------------------------------
{
  // 0.1° de longitud en el ecuador ≈ 11 km — dentro del umbral default de
  // 50 km, para no confundir "cayó fuera del umbral" con "el tie-break falló".
  const origen = { latitud: 0, longitud: 0 };
  const a = { id: 5, latitud: 0, longitud: 0.1 };
  const b = { id: 3, latitud: 0, longitud: -0.1 };

  const dA = distanciaKm(origen, { latitud: a.latitud, longitud: a.longitud });
  const dB = distanciaKm(origen, { latitud: b.latitud, longitud: b.longitud });
  ok('(2) precondición: los dos puntos SÍ quedan a la misma distancia', dA === dB, `dA=${dA}, dB=${dB}`);

  const r1 = campusMasCercano(origen, [a, b]); // a primero en el arreglo
  const r2 = campusMasCercano(origen, [b, a]); // b primero en el arreglo
  ok(
    '(2) empate → gana el de menor id, en cualquier orden del arreglo',
    r1?.id === 3 && r2?.id === 3,
    `orden [a,b] → id=${r1?.id}; orden [b,a] → id=${r2?.id}`
  );
}

// ---------------------------------------------------------------------------
// 3. Ningún campus con coordenadas → null, no un error.
// ---------------------------------------------------------------------------
{
  const origen = { latitud: 25.6514, longitud: -100.2895 };
  const sinCoords = [
    { id: 1, latitud: null, longitud: null },
    { id: 2, latitud: null, longitud: null },
  ];
  const resultado = campusMasCercano(origen, sinCoords);
  ok('(3) ningún campus con coordenadas devuelve null', resultado === null, `resultado=${resultado}`);
}

// ---------------------------------------------------------------------------
// 4. Todos los campus (con coordenadas) fuera del umbral → null.
// ---------------------------------------------------------------------------
{
  const origen = { latitud: 25.6514, longitud: -100.2895 }; // Monterrey
  const lejos = [
    { id: 1, latitud: 19.4326, longitud: -99.1332 }, // CDMX, ~700+ km
    { id: 2, latitud: 20.6597, longitud: -103.3496 }, // Guadalajara, ~500+ km
  ];
  const resultado = campusMasCercano(origen, lejos, UMBRAL_CERCANIA_KM);
  ok(
    '(4) todos los campus fuera del umbral (50 km) devuelven null',
    resultado === null,
    `resultado=${JSON.stringify(resultado)}`
  );

  // Control positivo: con un umbral generoso, SÍ hay que encontrar el más
  // cercano de los dos — para no confundir "null por umbral" con "null porque
  // campusMasCercano está roto".
  const conUmbralGeneroso = campusMasCercano(origen, lejos, 100000);
  ok(
    '(4) control: el mismo caso con umbral gigante SÍ devuelve un campus',
    conUmbralGeneroso !== null,
    `resultado=${JSON.stringify(conUmbralGeneroso)}`
  );
}

// ---------------------------------------------------------------------------
// 5. Coordenadas en los BORDES de rango (±90/±180), como INPUT del cálculo
//    (no de la base — eso ya lo cubre T29 de rls.sql). `distanciaKm` no debe
//    devolver NaN en ningún borde.
// ---------------------------------------------------------------------------
{
  const norte = { latitud: 90, longitud: 0 };
  const sur = { latitud: -90, longitud: 0 };
  const dPolos = distanciaKm(norte, sur);
  const circunferenciaMedia = Math.PI * 6371; // medio meridiano, en km
  ok(
    '(5) polo norte a polo sur: ~media circunferencia, sin NaN',
    !Number.isNaN(dPolos) && Math.abs(dPolos - circunferenciaMedia) < 1,
    `distanciaKm=${dPolos}, esperado≈${circunferenciaMedia.toFixed(2)}`
  );

  // El polo norte es el MISMO punto físico sin importar la longitud —
  // ±180 de longitud no debe romper nada ni dar una distancia distinta de 0.
  const norteOeste = { latitud: 90, longitud: -180 };
  const norteEste = { latitud: 90, longitud: 180 };
  const dPoloConsigo = distanciaKm(norteOeste, norteEste);
  ok(
    '(5) el polo norte a ±180° de longitud sigue siendo el mismo punto (~0), sin NaN',
    !Number.isNaN(dPoloConsigo) && dPoloConsigo < 0.01,
    `distanciaKm=${dPoloConsigo}`
  );

  // campusMasCercano con un origen en un borde extremo y un campus también
  // en el borde: no debe reventar ni devolver NaN como "distancia".
  const resultado = campusMasCercano(norte, [{ id: 9, latitud: 90, longitud: 180 }]);
  ok(
    '(5) campusMasCercano con origen y campus en el borde no rompe',
    resultado !== null && !Number.isNaN(resultado.distanciaKm),
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
