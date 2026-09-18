// ===========================================================================
// Relevo — pruebas de la función de decisión de moderación (RF-18).
//
// Cómo correrlo:
//     node scripts/probe-moderacion.mjs
//
// No necesita el stack local, ni red, ni credenciales: la pieza que prueba es
// pura a propósito.
//
// IMPORTA LA IMPLEMENTACIÓN REAL, NO UNA TRANSCRIPCIÓN — y esa diferencia con
// `probe-venta.mjs` vale la pena entenderla. Allá `congeladaSegunCliente()`
// transcribe la query porque `src/lib/confianza.ts` no es cargable desde Node
// (arrastra `expo-secure-store`, `expo-crypto`, AsyncStorage), así que el probe
// prueba la semántica pero NO prueba que la app use esa semántica — de ahí que
// necesite además un tripwire sobre el fuente. Aquí no hace falta nada de eso:
// `decision.ts` y `palabras-prohibidas.ts` no importan absolutamente nada, así
// que Node los carga directo (type stripping, v22.6+) y lo que se prueba es
// exactamente lo que va a correr en Deno. Si algún día alguien le mete un
// import de Supabase a `decision.ts`, este script deja de arrancar — y eso es
// la señal, no un inconveniente.
//
// Los 12 casos numerados son la tabla de verificación del plan de RF-18. Los
// que van después cubren el módulo de la lista, que es una unidad distinta.
//
// DOS AVISOS ESPERADOS, ninguno es un problema:
//  · Node imprime `MODULE_TYPELESS_PACKAGE_JSON` al cargar los `.ts`. Sugiere
//    agregar `"type": "module"` al package.json de la RAÍZ — NO lo hagas: ese
//    package.json es el de la app de Expo y Metro, y el aviso solo dice que
//    reparsear cuesta unos milisegundos en un script que corre en menos de uno.
//  · Estos dos módulos NO los cubre `npx tsc --noEmit`: `tsconfig.json` excluye
//    `supabase/functions` porque esa carpeta es Deno (ver
//    `notificaciones-push.md`, que además dice que lo correcto si algún día se
//    quiere typechear es darle su propia config de Deno, no devolverla al
//    tsconfig de React Native). O sea que la red de estos archivos son estas
//    42 aserciones, no el compilador.
// ===========================================================================

import {
  decidirListing,
  decidirAvatar,
  nivelDeSafeSearch,
  nivelDeTexto,
  nivelDeLista,
  peor,
} from '../supabase/functions/moderar-contenido/decision.ts';
import {
  coincidencias,
  normalizar,
  PALABRAS_PARA_PRUEBA,
  DESCARTADOS_POR_AMBIGUOS,
} from '../supabase/functions/moderar-contenido/palabras-prohibidas.ts';

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

// Ejes en limpio, para ir ensuciando de a uno. Que el default sea todo limpio
// es lo que hace que cada caso pruebe UN eje y no una mezcla accidental.
const LIMPIO = {
  vision: 'limpio',
  gptTexto: 'limpio',
  listaTecleada: 'limpio',
  listaOcr: 'limpio',
};
const ejes = (parcial) => ({ ...LIMPIO, ...parcial });

const SS_LIMPIO = { adult: 'VERY_UNLIKELY', violence: 'UNLIKELY', racy: 'UNLIKELY' };
const TXT_LIMPIO = {
  contenido_sexual: 'ninguno',
  violencia: 'ninguno',
  odio_discriminacion: 'ninguno',
  articulo_prohibido: 'ninguno',
  estafa_spam: 'ninguno',
  datos_contacto: 'ninguno',
};

// ---------------------------------------------------------------------------
console.log('\n== Los 12 casos de la tabla del plan ==');

// (1) El eje de lista bloquea solo, cuando el texto es TECLEADO.
igual(
  '1. match de lista tecleado, resto limpio → bloqueada',
  decidirListing(ejes({ listaTecleada: nivelDeLista(['pistola'], 'tecleado') }), 'pendiente'),
  'bloqueada'
);

// (2) EL TECHO DEL OCR. El mismo acierto, por el otro camino, no bloquea.
igual(
  '2. match de lista vía OCR, resto limpio → pendiente (techo)',
  decidirListing(ejes({ listaOcr: nivelDeLista(['pistola'], 'ocr') }), 'pendiente'),
  'pendiente'
);

// (3) El eje de GPT bloquea solo, sin que la lista opine.
igual(
  '3. GPT `claro`, texto sin match de lista → bloqueada',
  decidirListing(
    ejes({ gptTexto: nivelDeTexto({ ...TXT_LIMPIO, articulo_prohibido: 'claro' }) }),
    'pendiente'
  ),
  'bloqueada'
);

// (4a)(4b) GANA EL PEOR, y van DOS casos y no uno a propósito: con un solo
// orden, una implementación que devolviera siempre el último eje evaluado
// pasaría igual.
igual(
  '4a. match OCR (revisar) + GPT claro (bloquear) → bloqueada',
  decidirListing(
    ejes({
      listaOcr: nivelDeLista(['pistola'], 'ocr'),
      gptTexto: nivelDeTexto({ ...TXT_LIMPIO, violencia: 'claro' }),
    }),
    'pendiente'
  ),
  'bloqueada'
);
igual(
  '4b. match tecleado (bloquear) + GPT posible (revisar) → bloqueada',
  decidirListing(
    ejes({
      listaTecleada: nivelDeLista(['pistola'], 'tecleado'),
      gptTexto: nivelDeTexto({ ...TXT_LIMPIO, estafa_spam: 'posible' }),
    }),
    'pendiente'
  ),
  'bloqueada'
);

// (5)(6) Los dos umbrales de Vision.
igual(
  '5. Vision VERY_LIKELY, texto limpio → bloqueada',
  decidirListing(
    ejes({ vision: nivelDeSafeSearch({ ...SS_LIMPIO, adult: 'VERY_LIKELY' }) }),
    'pendiente'
  ),
  'bloqueada'
);
igual(
  '6. Vision LIKELY, texto limpio → pendiente',
  decidirListing(
    ejes({ vision: nivelDeSafeSearch({ ...SS_LIMPIO, racy: 'LIKELY' }) }),
    'pendiente'
  ),
  'pendiente'
);

// (7) La promoción, y es el ÚNICO camino que existe hacia `activa`.
igual(
  '7. todo limpio desde pendiente → activa',
  decidirListing(ejes({}), 'pendiente'),
  'activa'
);

// (8) LA REGLA DEL PISO. El caso que motiva que la regla exista: el trigger ya
// escaló por una foto sucia y la llamada final llega con el texto limpio.
igual(
  '8. estadoActual bloqueada + veredicto limpio → bloqueada (piso)',
  decidirListing(ejes({}), 'bloqueada'),
  'bloqueada'
);

// (9)(12) EL PAR QUE DEFINE LA ASIMETRÍA DE `pausada`, y ninguno sirve solo:
// con solo (9), una implementación que jamás tocara `pausada` pasaría en verde
// y dejaría abierto el escondite; con solo (12), una que la tratara como
// cualquier otro estado también pasaría, y despausaría publicaciones ajenas.
igual(
  '9. estadoActual pausada + veredicto limpio → pausada (no la despausa)',
  decidirListing(ejes({}), 'pausada'),
  'pausada'
);
igual(
  '12. estadoActual pausada + veredicto bloquear → bloqueada (sí escala)',
  decidirListing(ejes({ vision: 'bloquear' }), 'pausada'),
  'bloqueada'
);

// (10) El techo de `datos_contacto`, que es el otro que nunca bloquea.
igual(
  '10. datos_contacto claro solo → pendiente (techo)',
  decidirListing(
    ejes({ gptTexto: nivelDeTexto({ ...TXT_LIMPIO, datos_contacto: 'claro' }) }),
    'pendiente'
  ),
  'pendiente'
);

// (11) `vendida` SÍ escala. La otra mitad —que `listing_sales` no se toca— no
// se puede probar aquí: esta función no escribe nada. Lo que sí se prueba es
// que la decisión no inventa un estado que arrastre la venta.
igual(
  '11. estadoActual vendida + veredicto bloquear → bloqueada (sí escala)',
  decidirListing(ejes({ listaTecleada: 'bloquear' }), 'vendida'),
  'bloqueada'
);

// ---------------------------------------------------------------------------
console.log('\n== La otra mitad de la asimetría de `vendida` ==');

// Su gemelo: `revisar` NO la toca, porque una vendida ya no puede volverse
// pública (`listings_update_own` la hace terminal), así que quitarle el control
// al vendedor por una señal incierta no compra nada. Sin esta aserción, tratar
// a `vendida` igual que a `pausada` pasaría inadvertido.
igual(
  'vendida + veredicto revisar → vendida (no se toca)',
  decidirListing(ejes({ vision: 'revisar' }), 'vendida'),
  'vendida'
);

// Y el que prueba que la promoción es de verdad exclusiva de `pendiente`.
igual(
  'activa + veredicto limpio → activa (no hay nada que promover)',
  decidirListing(ejes({}), 'activa'),
  'activa'
);

// La escalada sobre una publicación YA PÚBLICA — el caso de evasión que motiva
// la rama UPDATE del trigger de Storage.
igual(
  'activa + veredicto revisar → pendiente (la saca del catálogo)',
  decidirListing(ejes({ vision: 'revisar' }), 'activa'),
  'pendiente'
);

// ---------------------------------------------------------------------------
console.log('\n== Avatares: solo VERY_LIKELY borra ==');

igual(
  'avatar VERY_LIKELY → borrar',
  decidirAvatar({ vision: nivelDeSafeSearch({ ...SS_LIMPIO, adult: 'VERY_LIKELY' }), listaOcr: 'limpio' }),
  'borrar'
);
igual(
  'avatar LIKELY → conservar (no hay dónde encolarlo)',
  decidirAvatar({ vision: nivelDeSafeSearch({ ...SS_LIMPIO, adult: 'LIKELY' }), listaOcr: 'limpio' }),
  'conservar'
);
igual(
  'avatar con match de lista por OCR → conservar (el techo también aplica aquí)',
  decidirAvatar({ vision: 'limpio', listaOcr: nivelDeLista(['pistola'], 'ocr') }),
  'conservar'
);

// ---------------------------------------------------------------------------
console.log('\n== `UNKNOWN` de Vision no es una señal ==');

// "No pude evaluar" no es "encontré algo". Tratarlo como sospechoso mandaría a
// revisión cada imagen que Vision no supo clasificar.
igual(
  'SafeSearch UNKNOWN en las tres → limpio',
  nivelDeSafeSearch({ adult: 'UNKNOWN', violence: 'UNKNOWN', racy: 'UNKNOWN' }),
  'limpio'
);
igual(
  'POSSIBLE todavía no llega a revisar',
  nivelDeSafeSearch({ ...SS_LIMPIO, violence: 'POSSIBLE' }),
  'limpio'
);

// ---------------------------------------------------------------------------
console.log('\n== La lista de palabras ==');

// LA FRONTERA DE PALABRA, que es lo que separa esta lista de una máquina de
// falsos positivos. Si alguien cambia el patrón por un `includes()`, cae aquí.
ok(
  'una entrada DENTRO de otra palabra no machea (fayuquero ≠ fayuca)',
  coincidencias('soy fayuquero de profesión').length === 0,
  JSON.stringify(coincidencias('soy fayuquero de profesión'))
);
ok(
  'el término suelto sí machea',
  coincidencias('vendo fayuca').includes('fayuca')
);

// LOS CUATRO AMBIGUOS. Esta es la aserción que de verdad importa de este
// bloque: el primer intento de esta lista los traía y habría bloqueado
// automáticamente publicaciones legítimas de este catálogo. La frontera de
// palabra NO los salva —en las tres frases de abajo el término está suelto y
// bien escrito—, así que la única defensa es no tenerlos.
for (const amb of DESCARTADOS_POR_AMBIGUOS) {
  ok(
    `\`${amb}\` NO está en la lista (necesita contexto: es trabajo de GPT y de Vision)`,
    !PALABRAS_PARA_PRUEBA.includes(amb)
  );
}
for (const legitima of [
  'Vendo guía de viaje de Granada, España',
  'Pistola de silicón para manualidades, poco uso',
  'Cartuchos de tinta HP 664, sellados',
  'Batidora para revolver mezcla de repostería',
]) {
  ok(
    `publicación legítima no dispara: "${legitima.slice(0, 34)}…"`,
    coincidencias(legitima).length === 0,
    JSON.stringify(coincidencias(legitima))
  );
}
ok(
  'acentos y mayúsculas no la esquivan',
  coincidencias('COCAÍNA').includes('cocaina'),
  JSON.stringify(coincidencias('COCAÍNA'))
);
ok(
  'una frase de varias palabras machea como frase',
  coincidencias('hola, resuelvo tareas de cálculo').includes('resuelvo tareas')
);
ok(
  'devuelve CUÁLES y sin repetir (el revisor necesita saber qué disparó)',
  JSON.stringify(coincidencias('fayuca y más fayuca').sort()) === JSON.stringify(['fayuca']),
  JSON.stringify(coincidencias('fayuca y más fayuca'))
);
ok(
  'con dos términos distintos devuelve los dos',
  JSON.stringify(coincidencias('vendo cocaína y fayuca').sort()) ===
    JSON.stringify(['cocaina', 'fayuca']),
  JSON.stringify(coincidencias('vendo cocaína y fayuca').sort())
);
ok('texto vacío no machea nada', coincidencias('').length === 0);
ok(
  'texto legítimo de este catálogo no dispara',
  coincidencias('Libro de Cálculo de Larson, novena edición, buen estado').length === 0
);

// La lista misma tiene que estar en la forma que `normalizar()` produce, o una
// entrada nunca machearía — y sería un fallo silencioso, no un error.
const malFormadas = PALABRAS_PARA_PRUEBA.filter((p) => normalizar(p) !== p);
ok(
  'todas las entradas de la lista están normalizadas (minúsculas, sin acentos)',
  malFormadas.length === 0,
  malFormadas.length ? `mal formadas: ${JSON.stringify(malFormadas)}` : undefined
);

// ---------------------------------------------------------------------------
console.log('\n== `peor()`: ningún eje absuelve a otro ==');

igual('peor(limpio, bloquear) = bloquear', peor('limpio', 'bloquear'), 'bloquear');
igual('peor(bloquear, limpio) = bloquear', peor('bloquear', 'limpio'), 'bloquear');
igual('peor(revisar, limpio) = revisar', peor('revisar', 'limpio'), 'revisar');
igual('peor() sin argumentos = limpio', peor(), 'limpio');

// ---------------------------------------------------------------------------
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
