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
// Los 13 casos numerados son la tabla de verificación del plan de RF-18 (el 13
// se agregó después: el plan traía 12, y de ahí salió el bug de `pausada`+
// `revisar` que el bloque de más abajo documenta y corrige). Los que van
// después de los numerados cubren el módulo de la lista, que es una unidad
// distinta.
//
// DOS AVISOS ESPERADOS, ninguno es un problema:
//  · Node imprime `MODULE_TYPELESS_PACKAGE_JSON` al cargar los `.ts`. Sugiere
//    agregar `"type": "module"` al package.json de la RAÍZ — NO lo hagas: ese
//    package.json es el de la app de Expo y Metro, y el aviso solo dice que
//    reparsear cuesta unos milisegundos en un script que corre en menos de uno.
//  · Estos dos módulos NO los cubre `npx tsc --noEmit` de la app:
//    `tsconfig.json` de la raíz excluye `supabase/functions` porque esa carpeta
//    es Deno (ver `notificaciones-push.md`). **Desde 2026-09-18 sí los cubre
//    `npm run check:functions`**, que es la config propia que aquella nota
//    decía que había que darles — y que en su primera corrida encontró un error
//    de tipos real y preexistente en `env.ts`. Los dos chequeos son
//    complementarios, no redundantes: el compilador mira formas, este script
//    mira DECISIONES. `decidirListing({...todo limpio}, 'pausada')` typechea
//    perfecto y devolver `'activa'` sería el bug que aquí se caza.
// ===========================================================================

import {
  decidirListing,
  decidirAvatar,
  nivelDeSafeSearch,
  nivelDeTexto,
  nivelDeLista,
  peor,
  esPromocion,
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

// (11) `vendida` SÍ escala con `bloquear`. La otra mitad —que `listing_sales`
// no se toca— no se puede probar aquí: esta función no escribe nada. Lo que sí
// se prueba es que la decisión no inventa un estado que arrastre la venta.
igual(
  '11. estadoActual vendida + veredicto bloquear → bloqueada (sí escala)',
  decidirListing(ejes({ listaTecleada: 'bloquear' }), 'vendida'),
  'bloqueada'
);

// (13) EL GEMELO DE (11), y no es simetría por estética: `pausada` tiene que
// escalar con `bloquear` exactamente igual que `vendida`, por la misma razón
// —`bloqueada` nunca se promueve, así que escalar aquí no abre ningún camino
// de vuelta a `activa`—. Sin este caso, una implementación que excluyera a
// `pausada` del `bloquear` (tratándola como a `vendida` en TODO, no solo en
// `revisar`) pasaría inadvertida.
igual(
  '13. estadoActual pausada + veredicto bloquear → bloqueada (sí escala, gemelo de 11)',
  decidirListing(ejes({ listaTecleada: 'bloquear' }), 'pausada'),
  'bloqueada'
);

// ---------------------------------------------------------------------------
console.log('\n== `revisar` NO escala ni `pausada` ni `vendida`, y es EL MISMO carve-out ==');

// La primera versión de esta función solo se lo daba a `vendida`, razonando
// "no puede volver a ser pública" — y trataba a `pausada` distinto, "para que
// pausar no fuera un escondite". Es la corrección de un bug real, no una
// preferencia de test: si `revisar` escala `pausada` a `pendiente`, y después
// otra evaluación sobre esa misma fila da limpio (otra foto sube, el trigger
// corre de nuevo), la regla de promoción —que solo mira si el estado ES
// `pendiente`— la manda a `activa` SOLA, publicando algo que el vendedor pausó
// a propósito. Es el mismo invariante que ya protegía a `vendida`
// ("la promoción sale ÚNICAMENTE de `pendiente`"); lo que faltaba era
// aplicárselo también a `pausada`. Las dos aserciones de abajo son el mismo
// caso por partida doble: sin la de `pausada`, el bug queda sin red.
igual(
  'vendida + veredicto revisar → vendida (no se toca)',
  decidirListing(ejes({ vision: 'revisar' }), 'vendida'),
  'vendida'
);
igual(
  'pausada + veredicto revisar → pausada (no se toca — el bug que este test cierra)',
  decidirListing(ejes({ vision: 'revisar' }), 'pausada'),
  'pausada'
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
console.log('\n== `esPromocion()`: el guard de "el trigger solo escala" ==');

// El guard lo aplica `index.ts` cuando `ctx.authMode === 'secret'`, pero la
// lógica vive aquí para que tenga cobertura: `deno` no está instalado, así que
// nada de `index.ts` es verificable hoy (ver el docblock de `esPromocion`).

igual('pendiente → activa SÍ es promoción', esPromocion('pendiente', 'activa'), true);
igual('activa → pendiente NO lo es', esPromocion('activa', 'pendiente'), false);
igual('activa → activa (no-op) NO lo es', esPromocion('activa', 'activa'), false);
igual('bloqueada → activa NO lo es', esPromocion('bloqueada', 'activa'), false);

// LA ASERCIÓN QUE DE VERDAD IMPORTA, y es exhaustiva a propósito: recorre TODO
// el producto cartesiano de ejes × estados y confirma que el único cambio de
// estado que `decidirListing()` puede producir y que vuelve la publicación más
// pública es el par que `esPromocion()` reconoce.
//
// Sin esto, `esPromocion` sería una lista de pares escrita a mano que se
// desincroniza en silencio: alguien agrega una promoción nueva a
// `decidirListing` (digamos `pausada → activa` "para que el vendedor no tenga
// que reactivar a mano"), el guard no la reconoce, y el TRIGGER pasa a poder
// publicar. Es justo el fallo que el guard existe para impedir, y las cuatro
// aserciones de arriba lo dejarían pasar enteras.
//
// TRES CONTROLES NEGATIVOS, corridos uno a la vez — y el tercero es el que
// justifica que esta aserción exista, porque es el único que NADIE MÁS caza:
//
//   A. `esPromocion()` deja de reconocer el par (`return false`)
//        → cae aquí Y en "pendiente → activa SÍ es promoción"
//   B. `decidirListing()` gana `pausada + limpio → activa`
//        → cae aquí Y en el caso numerado 9
//   C. `decidirListing()` devuelve `activa` en la rama `revisar` de una
//      publicación `bloqueada`
//        → **cae SOLO aquí**
//
// El C destapó un hueco real de la cobertura numerada, no un caso inventado:
// el docblock de `decidirListing` afirma que «`bloqueada → activa` no ocurre
// por ningún camino», y los 13 casos numerados solo ejercitan `bloqueada` con
// veredicto `limpio` (el caso 8). La rama `revisar` de ese mismo estado no la
// probaba nadie. Es la lección de (c) en T21 otra vez (CLAUDE.md §3): una
// invariante que se da por probada porque "ya hay un caso de eso".
const NIVELES = ['limpio', 'revisar', 'bloquear'];
const ESTADOS = ['activa', 'pausada', 'vendida', 'pendiente', 'bloqueada'];
// Qué tan pública es cada una. Solo se comparan entre sí; los números no
// significan nada fuera de este orden.
const VISIBILIDAD = { bloqueada: 0, pendiente: 1, pausada: 2, vendida: 3, activa: 4 };

const promocionesNoReconocidas = [];
for (const vision of NIVELES)
  for (const gptTexto of NIVELES)
    for (const listaTecleada of NIVELES)
      for (const listaOcr of NIVELES)
        for (const estado of ESTADOS) {
          const nuevo = decidirListing(
            { vision, gptTexto, listaTecleada, listaOcr },
            estado
          );
          const subeVisibilidad = VISIBILIDAD[nuevo] > VISIBILIDAD[estado];
          if (subeVisibilidad !== esPromocion(estado, nuevo)) {
            promocionesNoReconocidas.push(`${estado} → ${nuevo}`);
          }
        }

ok(
  'esPromocion() reconoce TODO cambio que suba la visibilidad (405 combinaciones)',
  promocionesNoReconocidas.length === 0,
  promocionesNoReconocidas.length
    ? `sin reconocer: ${JSON.stringify([...new Set(promocionesNoReconocidas)])}`
    : '0 discrepancias'
);

// El control de la anterior: que el barrido de verdad ENCUENTRE la promoción
// que sí existe. Sin esto, un `decidirListing` que nunca promoviera —o un
// barrido mal escrito que no visitara `pendiente`— daría verde arriba por
// vacuidad, que es la lección de `:C` en T11b (CLAUDE.md §3).
ok(
  'el barrido sí visita la promoción real (pendiente + limpio → activa)',
  decidirListing(LIMPIO, 'pendiente') === 'activa' &&
    VISIBILIDAD['activa'] > VISIBILIDAD['pendiente']
);

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
