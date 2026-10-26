// ===========================================================================
// Relevo — pruebas de la geometría del "Editor de foto de perfil" (DESIGN-1
// fase 5). Cubre `src/lib/recorte.ts`: la escala base, los límites del paneo
// y el rectángulo que se le pasa a `ImageManipulator.crop()`.
//
// Cómo correrlo:
//     node scripts/probe-recorte.mjs
//
// No necesita el stack local, ni red, ni credenciales — mismo criterio que
// `probe-ubicacion.mjs`: el módulo es puro a propósito (sin imports), así que
// Node lo carga directo (type stripping, v22.6+). Si alguien le mete un import
// de React Native, este script deja de arrancar, y esa es la señal.
//
// Los valores esperados están calculados A MANO en cada caso (escala base =
// lado / lado corto de la imagen; diámetro = 0.8 × lado), no con las mismas
// funciones que se prueban.
// ===========================================================================

import {
  acotarEncuadre,
  escalaBase,
  FRACCION_CIRCULO,
  limitesPaneo,
  rectRecorte,
  ZOOM_MAXIMO,
} from '../src/lib/recorte.ts';

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

const igual = (r, esperado) =>
  r.originX === esperado.originX &&
  r.originY === esperado.originY &&
  r.width === esperado.width &&
  r.height === esperado.height;
const txt = (r) => JSON.stringify(r);
const LADO = 300;

// 0. Las constantes del prototipo (`.crop-mask` 80 %, MAX_ZOOM 4).
ok('(0) el círculo mide 80 % del escenario y el zoom llega a 4', FRACCION_CIRCULO === 0.8 && ZOOM_MAXIMO === 4);

// 1. Foto cuadrada, centro, zoom 1: escala 0.3, círculo de 240 pt = 800 px.
{
  const r = rectRecorte(LADO, 1000, 1000, { escala: 1, x: 0, y: 0 });
  ok('(1) cuadrada al centro con zoom 1', igual(r, { originX: 100, originY: 100, width: 800, height: 800 }), txt(r));
}

// 2. Horizontal 1600×1200: escala 0.25 (el lado CORTO llena), mostrada 400×300.
{
  ok('(2a) la escala base sale del lado corto', escalaBase(LADO, 1600, 1200) === 0.25);
  const r = rectRecorte(LADO, 1600, 1200, { escala: 1, x: 0, y: 0 });
  ok('(2b) horizontal al centro', igual(r, { originX: 320, originY: 120, width: 960, height: 960 }), txt(r));
}

// 3. Vertical 1200×1600: el mismo caso girado.
{
  const r = rectRecorte(LADO, 1200, 1600, { escala: 1, x: 0, y: 0 });
  ok('(3) vertical al centro', igual(r, { originX: 120, originY: 320, width: 960, height: 960 }), txt(r));
}

// 4. Límites del paneo: (mostrada − diámetro) / 2 en cada eje.
{
  const l1 = limitesPaneo(LADO, 1000, 1000, 1);
  ok('(4a) cuadrada con zoom 1: 30 pt por lado', l1.maxX === 30 && l1.maxY === 30, txt(l1));
  const l2 = limitesPaneo(LADO, 1600, 1200, 1);
  ok('(4b) horizontal con zoom 1: 80 en x y 30 en y', l2.maxX === 80 && l2.maxY === 30, txt(l2));
  const l3 = limitesPaneo(LADO, 1000, 1000, 2);
  ok('(4c) con zoom 2 crece: (600 − 240) / 2 = 180', l3.maxX === 180 && l3.maxY === 180, txt(l3));
}

// 5. Los bordes: un paneo exagerado se acota y el recorte toca el borde de la
//    imagen sin salirse. Mover la imagen a la DERECHA muestra su lado IZQUIERDO.
{
  const r = rectRecorte(LADO, 1600, 1200, { escala: 1, x: 5000, y: 0 });
  ok('(5a) arrastrar a la derecha al tope: originX 0', igual(r, { originX: 0, originY: 120, width: 960, height: 960 }), txt(r));
  const r2 = rectRecorte(LADO, 1600, 1200, { escala: 1, x: -5000, y: -5000 });
  ok(
    '(5b) arrastrar arriba e izquierda al tope: el recorte termina en la esquina',
    igual(r2, { originX: 640, originY: 240, width: 960, height: 960 }),
    txt(r2)
  );
  const e = acotarEncuadre(LADO, 1600, 1200, { escala: 1, x: 5000, y: -5000 });
  ok('(5c) el encuadre acotado es el límite exacto', e.x === 80 && e.y === -30, txt(e));
}

// 6. Zoom 4 en una cuadrada: escala 1.2, círculo de 200 px, centrado en 400.
{
  const r = rectRecorte(LADO, 1000, 1000, { escala: 4, x: 0, y: 0 });
  ok('(6a) zoom 4 al centro', igual(r, { originX: 400, originY: 400, width: 200, height: 200 }), txt(r));
  const r2 = rectRecorte(LADO, 1000, 1000, { escala: 9, x: 0, y: 0 });
  ok('(6b) un zoom de más se acota a 4', igual(r2, r), txt(r2));
  const r3 = rectRecorte(LADO, 1000, 1000, { escala: 0.3, x: 0, y: 0 });
  ok('(6c) un zoom de menos se acota a 1', igual(r3, { originX: 100, originY: 100, width: 800, height: 800 }), txt(r3));
}

// 7. Entradas basura: NaN o Infinity no rompen ni sacan el recorte de la foto.
{
  const r = rectRecorte(LADO, 1000, 1000, { escala: Number.NaN, x: Number.NaN, y: Infinity });
  ok('(7) NaN e Infinity caen al centro con zoom 1', igual(r, { originX: 100, originY: 100, width: 800, height: 800 }), txt(r));
}

// 8. Redondeo: con dimensiones que no dan enteros, el recorte sigue siendo
//    entero, cuadrado y dentro de la imagen. Barrido determinista, no al azar.
{
  let malos = 0;
  let primero = null;
  const dims = [
    [1001, 667],
    [667, 1001],
    [1599, 1599],
    [513, 2000],
    [3024, 4032],
  ];
  for (const [w, h] of dims) {
    for (let escala = 1; escala <= 4; escala += 0.37) {
      for (const fx of [-1, -0.61, 0, 0.33, 1]) {
        for (const fy of [-1, -0.2, 0, 0.71, 1]) {
          const { maxX, maxY } = limitesPaneo(LADO, w, h, escala);
          const r = rectRecorte(LADO, w, h, { escala, x: fx * maxX, y: fy * maxY });
          const bien =
            Number.isInteger(r.originX) &&
            Number.isInteger(r.originY) &&
            r.width === r.height &&
            r.width >= 1 &&
            r.originX >= 0 &&
            r.originY >= 0 &&
            r.originX + r.width <= w &&
            r.originY + r.height <= h;
          if (!bien) {
            malos++;
            primero ??= `${w}×${h} escala ${escala} → ${txt(r)}`;
          }
        }
      }
    }
  }
  ok('(8) barrido: entero, cuadrado y dentro de la imagen siempre', malos === 0, primero ?? '0 fuera');
}

// 9. Lo que se ve es lo que se guarda: el centro del recorte coincide (±1 px)
//    con el píxel que queda bajo el centro del círculo, calculado aparte.
{
  let peor = 0;
  for (const [w, h, escala, x, y] of [
    [1600, 1200, 1, 50, -20],
    [1200, 1600, 2.5, -100, 140],
    [1000, 1000, 3.3, 200, 200],
  ]) {
    const e = acotarEncuadre(LADO, w, h, { escala, x, y });
    const s = (LADO / Math.min(w, h)) * e.escala;
    const esperadoX = w / 2 - e.x / s;
    const esperadoY = h / 2 - e.y / s;
    const r = rectRecorte(LADO, w, h, e);
    peor = Math.max(peor, Math.abs(r.originX + r.width / 2 - esperadoX), Math.abs(r.originY + r.height / 2 - esperadoY));
  }
  ok('(9) el centro del recorte es el centro del círculo', peor <= 1, `desvío máximo ${peor.toFixed(2)} px`);
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
