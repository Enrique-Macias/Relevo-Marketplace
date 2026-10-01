// Relevo — la puerta del modal de TOTP del panel (RF-17, Ola 2).
//
//     node scripts/probe-puerta-totp.mjs
//
// Sin stack, sin red, sin credenciales: importa `admin/src/lib/puerta-totp.ts`
// REAL (módulo puro, sin imports; Node lo carga con type stripping, igual que
// probe-admin.mjs carga rechazos.ts).
//
// Primero REPRODUCE el bug que corrige: el patrón que tenía `App.tsx:65-68`
// (`setPideTotp(() => resolve)`, un solo lugar para el resolve) con dos
// llamadas concurrentes deja la primera promesa colgada para siempre. Después
// comprueba que con la puerta las dos terminan, con un solo modal.

import { registrarModal, pedirTotp } from '../admin/src/lib/puerta-totp.ts';

let pasadas = 0;
const fallos = [];
function ok(nombre, cond, detalle) {
  if (cond) { pasadas++; console.log(`  ok — ${nombre}${detalle ? ` (${detalle})` : ''}`); }
  else { fallos.push(nombre); console.log(`  FALLÓ — ${nombre}${detalle ? ` (${detalle})` : ''}`); }
}

const COLGADA = Symbol('colgada');
/** La promesa, o `COLGADA` si no terminó en `ms`. */
const terminaEn = (p, ms = 200) =>
  Promise.race([p, new Promise((r) => setTimeout(() => r(COLGADA), ms))]);

console.log('\n== 1. El bug, reproducido con el patrón viejo de App.tsx:65-68 ==');
{
  // Lo mismo que hacía App: un único "estado" con el resolve del modal.
  let pideTotp = null;
  const pedirViejo = () => new Promise((resolve) => { pideTotp = resolve; });
  const primera = pedirViejo();
  const segunda = pedirViejo();   // pisa el resolve de la primera
  pideTotp(true);                 // el modal confirma: resuelve SOLO el último
  const r1 = await terminaEn(primera);
  const r2 = await terminaEn(segunda);
  ok('patrón viejo: la SEGUNDA llamada termina', r2 === true, String(r2));
  ok('patrón viejo: la PRIMERA queda colgada (el bug)', r1 === COLGADA,
    r1 === COLGADA ? 'colgada tras 200 ms' : String(r1));
}

console.log('\n== 2. Con la puerta: un modal, todas terminan ==');
{
  let abiertos = 0;
  let responder = null;
  const soltar = registrarModal(() => {
    abiertos++;
    return new Promise((resolve) => { responder = resolve; });
  });

  const llamadas = [pedirTotp(), pedirTotp(), pedirTotp()];
  ok('tres llamadas concurrentes abren UN solo modal', abiertos === 1, `abiertos=${abiertos}`);
  ok('las tres comparten la misma promesa', llamadas[0] === llamadas[1] && llamadas[1] === llamadas[2]);
  responder(true);
  const rs = await Promise.all(llamadas.map((p) => terminaEn(p)));
  ok('al confirmar, las tres terminan con true', rs.every((r) => r === true), JSON.stringify(rs.map(String)));

  // (a) La promesa se limpia al resolverse: la siguiente abre un modal nuevo.
  const otra = pedirTotp();
  ok('después de resolver, la siguiente llamada abre un modal nuevo', abiertos === 2, `abiertos=${abiertos}`);
  responder(false); // cancelación
  const rc = await terminaEn(otra);
  ok('al cancelar, la llamada termina con false (no se cuelga)', rc === false, String(rc));
  const tercera = pedirTotp();
  ok('después de cancelar también se limpia: abre otro modal', abiertos === 3, `abiertos=${abiertos}`);
  responder(true);
  await tercera; // que su `finally` limpie la puerta antes del caso siguiente

  // (b) Un segundo dueño del modal lanza en vez de pisar al primero.
  let lanzo = false;
  try { registrarModal(() => Promise.resolve(true)); } catch { lanzo = true; }
  ok('un segundo dueño del modal lanza', lanzo);

  // Si el modal revienta, la llamada termina con false y la puerta se limpia.
  soltar();
  registrarModal(() => Promise.reject(new Error('el modal se desmontó')));
  const re = await terminaEn(pedirTotp());
  ok('si el modal falla, la llamada termina con false', re === false, String(re));
}

console.log('\n== 3. Sin dueño registrado no se abre nada ==');
{
  // El dueño del bloque 2 sigue registrado; se reemplaza el módulo con una
  // importación fresca para tener una puerta sin dueño.
  const m = await import(`../admin/src/lib/puerta-totp.ts?fresca=${Date.now()}`);
  const r = await terminaEn(m.pedirTotp());
  ok('sin dueño, pedirTotp responde false de inmediato', r === false, String(r));
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
