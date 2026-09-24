// ===========================================================================
// Relevo — pruebas de TODO lo puro de la moderación de contenido (RF-18).
//
// Cómo correrlo:
//     node scripts/probe-moderacion.mjs
//
// No necesita el stack local, ni red, ni credenciales: las piezas que prueba
// son puras a propósito. Cubre CINCO módulos:
//
//   decision.ts           los umbrales y la regla del piso
//   palabras-prohibidas.ts  la lista y su normalización
//   vision.ts             particionado, forma del request, parseo, el eje
//   openai.ts             schema, body, parseo (incluido el refusal)
//   rekognition.ts        cuerpo, parseo, el eje, y la FIRMA SigV4 contra los
//                         vectores oficiales de AWS
//
// QUE SEAN CUATRO Y NO UNO ES LA DECISIÓN DE DISEÑO QUE HACE POSIBLE ESTE
// ARCHIVO. `vision.ts` y `openai.ts` existen separados de `index.ts`
// precisamente para que lo Deno-only —el `fetch`, la descarga de Storage, el
// `encodeBase64`— quede del otro lado de la línea. Si esa lógica viviera en
// `index.ts`, sería hoy inverificable: `deno` no está instalado en esta
// máquina y no hay credenciales de Vision ni de OpenAI.
//
// IMPORTA LA IMPLEMENTACIÓN REAL, NO UNA TRANSCRIPCIÓN — y esa diferencia con
// `probe-venta.mjs` vale la pena entenderla. Allá `congeladaSegunCliente()`
// transcribe la query porque `src/lib/confianza.ts` no es cargable desde Node
// (arrastra `expo-secure-store`, `expo-crypto`, AsyncStorage), así que el probe
// prueba la semántica pero NO prueba que la app use esa semántica — de ahí que
// necesite además un tripwire sobre el fuente. Aquí no hace falta nada de eso:
// ninguno de los cuatro importa nada fuera de `decision.ts` (que a su vez no
// importa nada), así que Node los carga directo (type stripping, v22.6+) y lo
// que se prueba es exactamente lo que va a correr en Deno. Si algún día alguien
// le mete un import de Supabase o de Deno a cualquiera de los cuatro, este
// script deja de arrancar — y eso es la señal, no un inconveniente.
//
// Los 13 casos numerados son la tabla de verificación del plan de RF-18 (el 13
// se agregó después: el plan traía 12, y de ahí salió el bug de `pausada`+
// `revisar` que el bloque de más abajo documenta y corrige). Los que van
// después de los numerados cubren los otros tres módulos, cada uno su unidad.
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
  evaluacionIncompleta,
  nivelDeRekognition,
  etiquetasParaAuditoria,
  CATEGORIAS_REKOGNITION,
  CONFIANZA_ACCION,
} from '../supabase/functions/moderar-contenido/decision.ts';
import {
  coincidencias,
  normalizar,
  PALABRAS_PARA_PRUEBA,
  DESCARTADOS_POR_AMBIGUOS,
} from '../supabase/functions/moderar-contenido/palabras-prohibidas.ts';
import {
  particionar,
  tamanoBase64,
  cuerpoVision,
  resultadosDeLote,
  ejeVision,
  textoOcrDe,
  unirFotoDisparadora,
  MAX_BYTES_POR_LOTE,
  MAX_IMAGENES_POR_LOTE,
  MAX_BYTES_POR_IMAGEN,
  MAX_BYTES_JSON_REQUEST,
} from '../supabase/functions/moderar-contenido/vision.ts';
import {
  CATEGORIAS,
  SCHEMA,
  MODELO,
  NOMBRE_SCHEMA,
  cuerpoOpenAI,
  parsearRespuestaOpenAI,
} from '../supabase/functions/moderar-contenido/openai.ts';
import {
  cuerpoRekognition,
  parsearRespuestaRekognition,
  ejeRekognition,
  firmarSigV4,
  amzDateDe,
  MIN_CONFIDENCE_PEDIDA,
  SERVICIO_AWS,
  TARGET_DETECT_MODERATION,
  hostRekognition,
} from '../supabase/functions/moderar-contenido/rekognition.ts';

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
  rekognition: 'limpio',
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

console.log('\n== `evaluacionIncompleta()`: si el reclamo del camino cliente se cierra ==');
// Decide si el reclamo de `listing_moderacion_reclamos` se marca PERMANENTE
// (completa) o se LIBERA para que un reintento vuelva a evaluar (incompleta).
// Cada eje por separado: una implementación que solo mirara uno de los tres
// dejaría cerrado para siempre un alta que ni siquiera se pudo evaluar.
const COMPLETA = { fotosNoEvaluables: 0, rekognitionNoEvaluables: 0, textoSinVeredicto: false };
igual('todo evaluado → completa', evaluacionIncompleta(COMPLETA), false);
igual('una foto sin evaluar en Vision → incompleta',
  evaluacionIncompleta({ ...COMPLETA, fotosNoEvaluables: 1 }), true);
igual('una foto sin evaluar en Rekognition → incompleta',
  evaluacionIncompleta({ ...COMPLETA, rekognitionNoEvaluables: 1 }), true);
igual('texto sin veredicto (OpenAI caído o refusal) → incompleta',
  evaluacionIncompleta({ ...COMPLETA, textoSinVeredicto: true }), true);

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
        for (const rekognition of NIVELES)
          for (const estado of ESTADOS) {
            const nuevo = decidirListing(
              { vision, gptTexto, listaTecleada, listaOcr, rekognition },
              estado
            );
            const subeVisibilidad = VISIBILIDAD[nuevo] > VISIBILIDAD[estado];
            if (subeVisibilidad !== esPromocion(estado, nuevo)) {
              promocionesNoReconocidas.push(`${estado} → ${nuevo}`);
            }
          }

ok(
  'esPromocion() reconoce TODO cambio que suba la visibilidad (1215 combinaciones)',
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
console.log('\n== Vision: particionado por tamaño acumulado ==');

const foto = (tamano, n = 0) => ({ storagePath: `l/${n}.jpg`, tamano });
const KB = 1024;
const MB = 1024 * 1024;

// EL CASO NORMAL, que es el que importa que NO se parta: cinco fotos ya
// normalizadas por `foto-picker.ts` (cientos de KB) caben en un solo request.
{
  const fotos = [300, 250, 400, 180, 320].map((kb, i) => foto(kb * KB, i));
  const { lotes, demasiadoGrandes } = particionar(fotos);
  igual('5 fotos normalizadas → UN solo lote', lotes.length, 1);
  igual('  …con las 5 adentro', lotes[0].length, 5);
  igual('  …y ninguna descartada', demasiadoGrandes.length, 0);
}

// El tope por CONTEO, independiente del de bytes: 17 fotos minúsculas no pesan
// nada y aun así no caben en un request.
{
  const fotos = Array.from({ length: 17 }, (_, i) => foto(1 * KB, i));
  const { lotes } = particionar(fotos);
  igual('17 fotos de 1 KB → se parten por CONTEO', lotes.length, 2);
  igual(`  …primer lote lleno a ${MAX_IMAGENES_POR_LOTE}`, lotes[0].length, MAX_IMAGENES_POR_LOTE);
  igual('  …y la sobrante sola', lotes[1].length, 1);
}

// El tope por BYTES: dos fotos de 4 MB suman 8 MB, por encima del lote.
{
  const fotos = [foto(4 * MB, 0), foto(4 * MB, 1)];
  const { lotes } = particionar(fotos);
  igual('2 fotos de 4 MB → se parten por BYTES', lotes.length, 2);
}

// Una foto que por sí sola no cabe en un lote, pero sí está bajo el tope por
// imagen: sale en su propio lote, no se descarta.
{
  const fotos = [foto(1 * MB, 0), foto(9 * MB, 1), foto(1 * MB, 2)];
  const { lotes, demasiadoGrandes } = particionar(fotos);
  igual('una foto > lote pero < tope por imagen va SOLA en su lote', lotes.length, 3);
  igual('  …y no se descarta', demasiadoGrandes.length, 0);
  ok(
    '  …en el lote de en medio, ella sola',
    lotes[1].length === 1 && lotes[1][0].tamano === 9 * MB
  );
}

// EL CASO QUE EL GUARD `actual.length > 0` PROTEGE, y que la primera versión de
// estas pruebas NO cubría: que la foto grande sea la PRIMERA. Ahí el corte se
// evalúa con el lote todavía vacío, y sin el guard se empuja un lote VACÍO —un
// request a Vision con cero imágenes—. Lo destapó el control negativo, que no
// hizo fallar nada: el caso de arriba empieza con una foto chica, así que el
// guard nunca se ejercitaba. Medido, no deducido: sin el guard salen lotes de
// tamaños [0, 1, 1] en vez de [1, 1].
{
  const { lotes } = particionar([foto(9 * MB, 0), foto(1 * MB, 1)]);
  igual('si la foto grande es la PRIMERA no se abre un lote vacío', lotes.length, 2);
  ok(
    '  …ningún lote queda vacío',
    lotes.every((l) => l.length > 0),
    JSON.stringify(lotes.map((l) => l.length))
  );
}

// La invariante general, sobre un barrido: NINGÚN lote puede salir vacío, con
// cualquier combinación de tamaños. Un lote vacío es una llamada de red tirada
// a la basura y una respuesta que `resultadosDeLote` no sabría interpretar.
{
  const tamanos = [1 * KB, 1 * MB, 5 * MB, 7 * MB, 19 * MB, 25 * MB];
  const vacios = [];
  for (const a of tamanos)
    for (const b of tamanos)
      for (const c of tamanos) {
        const { lotes } = particionar([foto(a, 0), foto(b, 1), foto(c, 2)]);
        if (lotes.some((l) => l.length === 0)) vacios.push([a, b, c]);
      }
  ok(
    'ningún lote sale vacío en 216 combinaciones de tamaños',
    vacios.length === 0,
    vacios.length ? `vacíos con ${JSON.stringify(vacios[0])}` : '0 vacíos'
  );
}

// Y la que pasa el tope POR IMAGEN no se manda — pero tampoco desaparece: sale
// por `demasiadoGrandes` para que el llamador la cuente como no evaluable.
{
  const fotos = [foto(1 * MB, 0), foto(25 * MB, 1)];
  const { lotes, demasiadoGrandes } = particionar(fotos);
  igual('una foto > 20 MB no entra en ningún lote', lotes.length, 1);
  igual('  …y sale reportada, no filtrada en silencio', demasiadoGrandes.length, 1);
  igual('  …con su ruta, para poder decir cuál fue', demasiadoGrandes[0].storagePath, 'l/1.jpg');
}

igual('sin fotos no hay lotes', particionar([]).lotes.length, 0);

// ---------------------------------------------------------------------------
console.log('\n== unirFotoDisparadora(): la foto que dispara el trigger ==');

// El caso que motiva la función: el objeto se sube ANTES de que exista su
// fila en `listing_photos` (`.claude/rules/moderacion.md` §1). Sin la unión,
// esa foto queda fuera del set que se evalúa — la aserción de abajo es
// exactamente esa consecuencia, corregida.
igual(
  'arreglo vacío + disparador → un solo elemento',
  JSON.stringify(unirFotoDisparadora([], 'a/1.jpg')),
  JSON.stringify(['a/1.jpg'])
);

// El caso realista de Editar: varias fotos ya existentes (las viejas, que
// `listing_photos` SÍ tiene) más la que acaba de subir. Con esto cubierto
// aquí, gratis, no hace falta pagar un segundo request a Vision para probar
// que el union con 3+ elementos queda bien formado.
igual(
  'set existente (3) + disparador nuevo → 4, el nuevo al final',
  JSON.stringify(unirFotoDisparadora(['a/1.jpg', 'a/2.jpg', 'a/3.jpg'], 'a/4.jpg')),
  JSON.stringify(['a/1.jpg', 'a/2.jpg', 'a/3.jpg', 'a/4.jpg'])
);

// El caso `x-upsert` de la sección de moderación de `probe-storage.mjs`: la
// fila YA existe (es un overwrite, no un alta). Sin este guard, esa foto se
// evaluaría DOS VECES en el mismo lote.
igual(
  'el disparador YA está en el set → igual, SIN duplicar',
  JSON.stringify(unirFotoDisparadora(['a/1.jpg', 'a/2.jpg'], 'a/1.jpg')),
  JSON.stringify(['a/1.jpg', 'a/2.jpg'])
);

// El camino del CLIENTE (`moderarListing({ puedePromover: true })`) no manda
// `nombreDisparador`: para cuando llama, `guardarFotos()` ya escribió todo.
igual(
  'sin disparador (undefined) → el set intacto',
  JSON.stringify(unirFotoDisparadora(['a/1.jpg'], undefined)),
  JSON.stringify(['a/1.jpg'])
);

// ---------------------------------------------------------------------------
console.log('\n== Vision: el umbral de 6 MB es CORRECTO, no arbitrario ==');

// `tamanoBase64` tiene que ser exacto, no una constante de 1.33 redondeada: si
// subestima, el particionado cree que cabe algo que no cabe y Vision rechaza el
// request entero.
{
  const casos = [0, 1, 2, 3, 4, 1000, 6 * MB];
  const malos = casos.filter(
    (n) => tamanoBase64(n) !== Buffer.from(new Uint8Array(n)).toString('base64').length
  );
  ok(
    'tamanoBase64() coincide con Buffer.toString("base64") exacto',
    malos.length === 0,
    malos.length ? `difieren en ${JSON.stringify(malos)}` : `${casos.length} tamaños`
  );
}

// LA ASERCIÓN QUE JUSTIFICA EL 6 MB. Un lote lleno a tope, ya codificado, tiene
// que caber en el límite de 10 MB del JSON de Vision — con espacio de sobra
// para el andamiaje del propio JSON (el array `requests`, los `features`, las
// comillas), que no entra en el conteo de bytes crudos.
{
  const codificado = tamanoBase64(MAX_BYTES_POR_LOTE);
  const holgura = MAX_BYTES_JSON_REQUEST - codificado;
  ok(
    'un lote lleno (6 MiB crudos) cabe codificado en el JSON de 10 MB',
    codificado < MAX_BYTES_JSON_REQUEST,
    `${codificado} chars, holgura ${(holgura / MB).toFixed(2)} MB`
  );
  ok(
    '  …y la holgura alcanza para el andamiaje del JSON (>1 MB)',
    holgura > 1 * MB,
    `${(holgura / MB).toFixed(2)} MB`
  );
}

// El control de la anterior: que el umbral NO esté puesto tan alto que el
// cálculo pase por casualidad. Con 8 MiB crudos ya no cabría.
ok(
  'el control: 8 MiB crudos NO cabrían (el margen es real, no casual)',
  tamanoBase64(8 * MB) > MAX_BYTES_JSON_REQUEST,
  `${tamanoBase64(8 * MB)} chars > ${MAX_BYTES_JSON_REQUEST}`
);

// ---------------------------------------------------------------------------
console.log('\n== Vision: el body pide las DOS features por imagen ==');

{
  const cuerpo = cuerpoVision(['AAAA', 'BBBB']);
  igual('una entrada por imagen', cuerpo.requests.length, 2);
  igual('el base64 va en image.content', cuerpo.requests[0].image.content, 'AAAA');
  const tipos = cuerpo.requests[0].features.map((f) => f.type).sort();
  ok(
    'cada imagen pide SafeSearch Y el OCR en la misma pasada',
    JSON.stringify(tipos) === JSON.stringify(['SAFE_SEARCH_DETECTION', 'TEXT_DETECTION']),
    JSON.stringify(tipos)
  );
}

// ---------------------------------------------------------------------------
console.log('\n== Vision: las TRES formas de foto no evaluable ==');

const lote2 = [foto(1 * KB, 0), foto(1 * KB, 1)];
const ssLimpio = { adult: 'VERY_UNLIKELY', violence: 'VERY_UNLIKELY', racy: 'VERY_UNLIKELY' };

// 1. La respuesta trae MENOS entradas que el lote. Sin el emparejado por
//    índice, las que faltan se leerían como limpias.
{
  const r = resultadosDeLote(lote2, { responses: [{ safeSearchAnnotation: ssLimpio }] });
  igual('respuesta truncada: la que falta es no_evaluable', r[1].estado, 'no_evaluable');
  igual('  …y la que sí vino se evalúa normal', r[0].estado, 'evaluada');
  igual('  …y el eje sube a revisar por la que faltó', ejeVision(r), 'revisar');
}

// 2. Error POR IMAGEN dentro de un lote que respondió 200. Es el que más fácil
//    se pierde: el status HTTP dice que todo salió bien.
{
  const r = resultadosDeLote(lote2, {
    responses: [{ safeSearchAnnotation: ssLimpio }, { error: { message: 'IMAGE_TOO_LARGE' } }],
  });
  igual('error por imagen dentro de un 200: no_evaluable', r[1].estado, 'no_evaluable');
  ok('  …conservando el mensaje de Vision', r[1].motivo.includes('IMAGE_TOO_LARGE'), r[1].motivo);
  igual('  …y el eje sube a revisar', ejeVision(r), 'revisar');
}

// 3. Sin `safeSearchAnnotation`: la feature no corrió. Distinto de que haya
//    corrido y no encontrado nada, que llega como VERY_UNLIKELY.
{
  const r = resultadosDeLote([foto(1 * KB, 0)], { responses: [{ fullTextAnnotation: { text: 'x' } }] });
  igual('sin safeSearchAnnotation: no_evaluable', r[0].estado, 'no_evaluable');
  igual('  …y el eje sube a revisar', ejeVision(r), 'revisar');
}

// Respuesta nula entera (el `catch` del fetch) → todas no evaluables.
{
  const r = resultadosDeLote(lote2, null);
  ok('respuesta nula: las dos no_evaluable', r.every((x) => x.estado === 'no_evaluable'));
  igual('  …y el eje sube a revisar', ejeVision(r), 'revisar');
}

// Un campo suelto ausente NO es no_evaluable: es UNKNOWN, que se lee limpio.
{
  const r = resultadosDeLote([foto(1 * KB, 0)], {
    responses: [{ safeSearchAnnotation: { adult: 'VERY_UNLIKELY' } }],
  });
  igual('un campo suelto ausente sí se evalúa', r[0].estado, 'evaluada');
  igual('  …completado a UNKNOWN', r[0].safeSearch.violence, 'UNKNOWN');
  igual('  …que nivelDeSafeSearch lee como limpio', nivelDeSafeSearch(r[0].safeSearch), 'limpio');
}

// ---------------------------------------------------------------------------
console.log('\n== Vision: el eje y el OCR ==');

{
  const r = resultadosDeLote(lote2, {
    responses: [
      { safeSearchAnnotation: ssLimpio },
      { safeSearchAnnotation: { ...ssLimpio, racy: 'VERY_LIKELY' } },
    ],
  });
  igual('una foto VERY_LIKELY bloquea el eje entero', ejeVision(r), 'bloquear');
}

// SIN FOTOS es limpio, no revisar: una lista vacía no es un fallo de
// evaluación. Quien impide publicar sin fotos es el trigger, no esta función.
igual('sin fotos el eje es limpio, no revisar', ejeVision([]), 'limpio');

{
  const r = resultadosDeLote(lote2, {
    responses: [
      { safeSearchAnnotation: ssLimpio, fullTextAnnotation: { text: 'hola' } },
      { safeSearchAnnotation: ssLimpio, fullTextAnnotation: { text: 'mundo' } },
    ],
  });
  igual('el OCR de todas las fotos se concatena', textoOcrDe(r), 'hola\nmundo');
}

// El separador es un salto de línea y no vacío: sin él, el final de una foto y
// el principio de otra formarían una palabra que nadie escribió.
{
  const r = resultadosDeLote(lote2, {
    responses: [
      { safeSearchAnnotation: ssLimpio, fullTextAnnotation: { text: 'coca' } },
      { safeSearchAnnotation: ssLimpio, fullTextAnnotation: { text: 'ina' } },
    ],
  });
  igual('dos fotos no forman una palabra inventada al concatenarse', coincidencias(textoOcrDe(r)).length, 0);
}

// ---------------------------------------------------------------------------
console.log('\n== OpenAI: el schema espeja VeredictoTexto ==');

igual('seis categorías, ni una más', CATEGORIAS.length, 6);
ok(
  'required lista EXACTAMENTE las mismas que properties',
  JSON.stringify([...SCHEMA.required].sort()) ===
    JSON.stringify(Object.keys(SCHEMA.properties).sort()),
  JSON.stringify(SCHEMA.required)
);
igual('additionalProperties: false (lo exige strict)', SCHEMA.additionalProperties, false);
igual('la raíz es un object (lo exige strict)', SCHEMA.type, 'object');
ok(
  'cada categoría es un enum de los tres grados',
  CATEGORIAS.every(
    (c) =>
      JSON.stringify(SCHEMA.properties[c].enum) ===
      JSON.stringify(['ninguno', 'posible', 'claro'])
  )
);

// LA ASERCIÓN QUE AMARRA EL SCHEMA CON EL CONSUMIDOR, y no es la misma que las
// de arriba: aquellas miran la FORMA del schema contra sí mismo. Esta prueba
// que cada categoría que el schema declara la LEE de verdad `nivelDeTexto()`.
// Una categoría declarada que nadie consume sería una señal que el modelo
// reporta y nosotros tiramos, sin ningún error a la vista.
{
  const todoNinguno = Object.fromEntries(CATEGORIAS.map((c) => [c, 'ninguno']));
  igual('con las seis en "ninguno" el texto es limpio', nivelDeTexto(todoNinguno), 'limpio');

  const sordas = CATEGORIAS.filter(
    (c) => nivelDeTexto({ ...todoNinguno, [c]: 'claro' }) === 'limpio'
  );
  ok(
    'las seis categorías del schema mueven el veredicto (ninguna es decorativa)',
    sordas.length === 0,
    sordas.length ? `sordas: ${sordas.join(', ')}` : 'las 6 se consumen'
  );
}

// ---------------------------------------------------------------------------
console.log('\n== OpenAI: el body ==');

{
  const cuerpo = cuerpoOpenAI('Libro de Cálculo', 'Novena edición');
  igual('model va SIEMPRE (la referencia no lo lista, los ejemplos sí)', cuerpo.model, MODELO);
  igual('input es el arreglo system + user', cuerpo.input.length, 2);
  igual('  …system primero', cuerpo.input[0].role, 'system');
  igual('  …user después', cuerpo.input[1].role, 'user');
  ok(
    'el texto del vendedor va SOLO en el mensaje de usuario, nunca en el de sistema',
    cuerpo.input[1].content.includes('Libro de Cálculo') &&
      !cuerpo.input[0].content.includes('Libro de Cálculo')
  );
  igual('text.format.type', cuerpo.text.format.type, 'json_schema');
  igual('text.format.name', cuerpo.text.format.name, NOMBRE_SCHEMA);
  igual('text.format.strict', cuerpo.text.format.strict, true);
  ok('text.format.schema es el schema', cuerpo.text.format.schema === SCHEMA);
}

// Una descripción nula no rompe el body ni inyecta "null" como texto.
{
  const cuerpo = cuerpoOpenAI('Silla', null);
  ok(
    'descripción nula queda vacía, no la cadena "null"',
    !cuerpo.input[1].content.includes('null'),
    cuerpo.input[1].content.replace(/\n/g, ' | ')
  );
}

// ---------------------------------------------------------------------------
console.log('\n== OpenAI: el parseo, y sobre todo el refusal ==');

const veredictoJson = JSON.stringify({
  contenido_sexual: 'ninguno',
  violencia: 'ninguno',
  odio_discriminacion: 'ninguno',
  articulo_prohibido: 'claro',
  estafa_spam: 'ninguno',
  datos_contacto: 'posible',
});

{
  const r = parsearRespuestaOpenAI({ output_text: veredictoJson });
  ok('camino feliz por output_text', r.ok === true);
  igual('  …con el grado leído', r.ok && r.veredicto.articulo_prohibido, 'claro');
  igual('  …y nivelDeTexto lo consume', r.ok && nivelDeTexto(r.veredicto), 'bloquear');
}

// El camino largo, por si `output_text` no viene.
{
  const r = parsearRespuestaOpenAI({
    output: [{ type: 'message', content: [{ type: 'output_text', text: veredictoJson }] }],
  });
  ok('camino largo recorriendo output[]', r.ok === true);
}

// EL CASO QUE SE OLVIDA: 200, pero con refusal en vez del JSON. Un JSON.parse a
// ciegas revienta aquí y se lleva la petición entera.
{
  const r = parsearRespuestaOpenAI({
    output: [
      { type: 'message', content: [{ type: 'refusal', refusal: 'No puedo ayudar con eso.' }] },
    ],
  });
  ok('un refusal NO lanza', r.ok === false);
  igual('  …y se distingue de los otros fallos', r.ok === false && r.motivo, 'refusal');
}

igual(
  'JSON inválido no lanza',
  (() => {
    const r = parsearRespuestaOpenAI({ output_text: 'esto no es json' });
    return r.ok === false && r.motivo;
  })(),
  'json_invalido'
);

igual(
  'respuesta nula (el catch del fetch) no lanza',
  (() => {
    const r = parsearRespuestaOpenAI(null);
    return r.ok === false && r.motivo;
  })(),
  'sin_contenido'
);

// LA VALIDACIÓN DE FORMA NO SOBRA AUNQUE strict LA PROMETA: sin ella, un objeto
// al que le falta una categoría entra con `undefined` en ese campo, `deGrado`
// cae en la rama de 'ninguno', y una respuesta rota se lee como texto limpio.
{
  const incompleto = JSON.parse(veredictoJson);
  delete incompleto.estafa_spam;
  const r = parsearRespuestaOpenAI({ output_text: JSON.stringify(incompleto) });
  ok('un veredicto al que le falta una categoría se rechaza', r.ok === false);
  igual('  …como forma_invalida', r.ok === false && r.motivo, 'forma_invalida');
  ok('  …diciendo cuál faltó', r.ok === false && r.detalle.includes('estafa_spam'), r.ok === false ? r.detalle : '');
}

{
  const raro = { ...JSON.parse(veredictoJson), violencia: 'muchisimo' };
  const r = parsearRespuestaOpenAI({ output_text: JSON.stringify(raro) });
  igual('un grado fuera del enum se rechaza', r.ok === false && r.motivo, 'forma_invalida');
}

// ===========================================================================
// REKOGNITION — el quinto eje
// ===========================================================================

const etq = (name, confidence, taxonomy_level = 1) => ({ name, confidence, taxonomy_level });

// Los dos números CLAVADOS, no comparados entre sí. Casi todas las aserciones
// de abajo usan `CONFIANZA_ACCION` de forma simbólica —`CONFIANZA_ACCION - 1`
// y demás—, así que se MUEVEN con él y no pueden cazar un cambio de umbral.
// Se descubrió corriendo el control negativo de bajar el umbral a 50: caía una
// sola aserción, y por la razón lateral. Estas dos son las que lo fijan: los
// umbrales son SPEC (CLAUDE.md §3), así que cambiarlos tiene que costar tocar
// una prueba a propósito, no pasar solo.
igual('el umbral de ACCIÓN de Rekognition es 70', CONFIANZA_ACCION, 70);
igual('…y a AWS se le piden las etiquetas desde 50', MIN_CONFIDENCE_PEDIDA, 50);
igual(
  'las categorías vigiladas son exactamente esas tres',
  [...CATEGORIAS_REKOGNITION].join(' | '),
  'Drugs & Tobacco | Alcohol | Gambling'
);

// --- umbrales -------------------------------------------------------------

for (const categoria of CATEGORIAS_REKOGNITION) {
  igual(
    `Rekognition: "${categoria}" a ${CONFIANZA_ACCION} mueve el eje`,
    nivelDeRekognition([etq(categoria, CONFIANZA_ACCION)]),
    'revisar'
  );
}

// LA aserción que protege la decisión de esta tarea. Su control negativo es
// quitar el `techo()` de `nivelDeRekognition`.
igual(
  'Rekognition NUNCA bloquea: las tres categorías a 99 siguen en revisar',
  nivelDeRekognition(CATEGORIAS_REKOGNITION.map((c) => etq(c, 99))),
  'revisar'
);

// La banda 50-70: DOS aserciones, y no son la misma. La primera dice que no
// actúa; la segunda, que igual se guarda. Sin la segunda, un parseo que
// descartara esas etiquetas pasaría en verde y dejaría la deuda de §9 sin
// forma de calcularse nunca.
igual(
  'Rekognition: la banda 50-70 NO mueve el veredicto',
  nivelDeRekognition([etq('Alcohol', CONFIANZA_ACCION - 1)]),
  'limpio'
);
igual(
  'Rekognition: …pero la banda 50-70 SÍ va a la auditoría',
  etiquetasParaAuditoria([etq('Alcohol', CONFIANZA_ACCION - 1)]).length,
  1
);

igual(
  'Rekognition: una categoría que no vigilamos no mueve nada ni a 99',
  nivelDeRekognition([etq('Violence', 99)]),
  'limpio'
);
igual(
  'Rekognition: una etiqueta L2 no cuenta (solo miramos L1)',
  nivelDeRekognition([etq('Alcohol', 99, 2)]),
  'limpio'
);
igual('Rekognition: sin etiquetas es limpio', nivelDeRekognition([]), 'limpio');
igual(
  'Rekognition: la auditoría tampoco guarda categorías ajenas',
  etiquetasParaAuditoria([etq('Violence', 99), etq('Gambling', 55)]).length,
  1
);

// --- el eje dentro del veredicto -----------------------------------------

igual(
  'Rekognition solo manda una activa a pendiente',
  decidirListing(ejes({ rekognition: 'revisar' }), 'activa'),
  'pendiente'
);
// `peor()` en las dos direcciones, como los casos 4a/4b: con un solo orden,
// una implementación que devolviera el último eje evaluado pasaría igual.
igual(
  'Rekognition revisar + GPT claro = bloqueada (gana el peor)',
  decidirListing(
    ejes({ rekognition: 'revisar', gptTexto: nivelDeTexto({ ...TXT_LIMPIO, articulo_prohibido: 'claro' }) }),
    'activa'
  ),
  'bloqueada'
);
igual(
  'lista tecleada bloquea + Rekognition limpio = bloqueada (gana el peor)',
  decidirListing(
    ejes({ rekognition: 'limpio', listaTecleada: nivelDeLista(['pistola'], 'tecleado') }),
    'activa'
  ),
  'bloqueada'
);

// Que el techo no se pueda esquivar por NINGUNA combinación de entradas.
{
  const confianzas = [0, 49, 50, 69, 70, 90, 99, 100];
  let peorVisto = 'limpio';
  for (const c of confianzas)
    for (const cat of CATEGORIAS_REKOGNITION)
      for (const nivelTax of [1, 2, 3])
        peorVisto = peor(peorVisto, nivelDeRekognition([etq(cat, c, nivelTax)]));
  igual(
    `el eje de Rekognition jamás llega a bloquear (${confianzas.length * CATEGORIAS_REKOGNITION.length * 3} combinaciones)`,
    peorVisto,
    'revisar'
  );
}

igual('ejeRekognition toma el peor de las fotos', ejeRekognition(['limpio', 'revisar', 'limpio']), 'revisar');
igual('ejeRekognition sin fotos es limpio', ejeRekognition([]), 'limpio');

// --- cuerpo y parseo ------------------------------------------------------

{
  const cuerpo = JSON.parse(cuerpoRekognition('QUJD'));
  igual('el cuerpo pide MinConfidence 50, no 70', cuerpo.MinConfidence, MIN_CONFIDENCE_PEDIDA);
  igual('  …y 50 es MENOR que el umbral de acción', MIN_CONFIDENCE_PEDIDA < CONFIANZA_ACCION, true);
  igual('el cuerpo lleva la imagen en Image.Bytes', cuerpo.Image.Bytes, 'QUJD');
}

{
  const r = parsearRespuestaRekognition({
    ModerationLabels: [{ Name: 'Alcohol', Confidence: 81.25, TaxonomyLevel: 1 }],
  });
  ok('parseo: una respuesta bien formada se acepta', r.ok === true);
  igual('  …con la confianza intacta', r.ok === true && r.etiquetas[0].confidence, 81.25);
}
{
  const r = parsearRespuestaRekognition({ ModerationLabels: [] });
  ok('parseo: sin etiquetas es EVALUADA Y LIMPIA, no un fallo', r.ok === true && r.etiquetas.length === 0);
}
{
  const r = parsearRespuestaRekognition({ otraCosa: 1 });
  ok('parseo: sin ModerationLabels se RECHAZA (no se lee como limpia)', r.ok === false);
}
{
  const r = parsearRespuestaRekognition({ ModerationLabels: [{ Name: 'Alcohol' }] });
  ok('parseo: una etiqueta sin Confidence se rechaza', r.ok === false);
}
{
  const r = parsearRespuestaRekognition({
    __type: 'InvalidImageFormatException',
    message: 'Request has invalid image format',
  });
  igual('parseo: un error de AWS conserva su __type', r.ok === false && r.motivo, 'InvalidImageFormatException');
}

// --- firma SigV4, contra los vectores OFICIALES de AWS --------------------
//
// Los vectores salen de `aws-sig-v4-test-suite`, la suite oficial de AWS. Son
// la razón por la que el firmador se escribió a mano en vez de usar
// `npm:aws4fetch`: con una librería, la firma no tiene cobertura, y un bug de
// firma se ve como un 403 opaco.
//
// Credenciales fijas de la suite — son de ejemplo y públicas, no un secreto.

const V4 = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  servicio: 'service',
  amzDate: '20150830T123600Z',
  host: 'example.amazonaws.com',
};

{
  const f = await firmarSigV4({
    ...V4,
    metodo: 'GET',
    ruta: '/',
    query: '',
    headers: {},
    cuerpo: '',
  });

  igual(
    'SigV4 get-vanilla: canonical request exacto',
    f.canonicalRequest,
    'GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n' +
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  igual(
    'SigV4 get-vanilla: string to sign exacto',
    f.stringToSign,
    'AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n' +
      'bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63'
  );
  igual(
    'SigV4 get-vanilla: Authorization exacto (la firma completa)',
    f.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
      'SignedHeaders=host;x-amz-date, ' +
      'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'
  );
}

// El caso con CUERPO, que es la forma real de Rekognition (POST con JSON).
//
// OJO, Y ESTO ES UNA TRAMPA DE LA SUITE, NO UN BUG NUESTRO — **medido, no
// deducido**: el `.creq` oficial de este caso incluye `content-length` entre
// los headers firmados, pero su `.sts` y su `.authz` se calcularon SIN él
// (`SignedHeaders=content-type;host;x-amz-date`). O sea que los tres ficheros
// de AWS no son consistentes entre sí; es el mismo desacuerdo que reportó
// aws/aws-sdk-js#853.
//
// Cómo se comprobó, porque la primera versión de esta prueba falló aquí y la
// tentación era "ajustar el esperado hasta que pase": se firmó el caso con y
// sin `content-length` y se comparó cada variante contra los tres ficheros.
// CON content-length reproduce el `.creq` y ningún otro; SIN content-length
// reproduce el `.sts` Y el `.authz` exactos. Dos de tres ficheros mandan, y
// además son los dos que dependen de la cadena HMAC completa.
//
// Se firma entonces SIN `content-length`, que es entre otras cosas la forma
// correcta: AWS no exige firmar `content-length`, y nuestra petición real a
// Rekognition tampoco lo firma.
{
  const f = await firmarSigV4({
    ...V4,
    metodo: 'POST',
    ruta: '/',
    query: '',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    cuerpo: 'Param1=value1',
  });

  // El hash del CUERPO, que es lo que get-vanilla no puede probar (su payload
  // es la cadena vacía). Este valor sí viene del `.creq` oficial.
  ok(
    'SigV4 post-con-cuerpo: el hash del cuerpo es el del vector oficial',
    f.canonicalRequest.endsWith(
      '9095672bbd1f56dfc5b65f3e153adc8731a4a654192329106275f4c7b24d0b6e'
    ),
    f.canonicalRequest
  );
  igual(
    'SigV4 post-con-cuerpo: string to sign exacto',
    f.stringToSign,
    'AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\n' +
      '42a5e5bb34198acb3e84da4f085bb7927f2bc277ca766e6d19c73c2154021281'
  );
  igual(
    'SigV4 post-con-cuerpo: Authorization exacto (segundo vector completo, con cuerpo)',
    f.authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
      'SignedHeaders=content-type;host;x-amz-date, ' +
      'Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a'
  );
}

// La forma real con la que se va a llamar a Rekognition.
{
  const f = await firmarSigV4({
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    region: 'us-east-2',
    servicio: SERVICIO_AWS,
    amzDate: '20260921T120000Z',
    host: hostRekognition('us-east-2'),
    metodo: 'POST',
    ruta: '/',
    query: '',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': TARGET_DETECT_MODERATION },
    cuerpo: cuerpoRekognition('QUJD'),
  });
  ok(
    'la petición real firma x-amz-target (sin él, AWS no sabe qué operación es)',
    f.canonicalRequest.includes('x-amz-target:RekognitionService.DetectModerationLabels'),
    f.canonicalRequest
  );
  ok(
    '  …y el host regional entra en la firma',
    f.canonicalRequest.includes('host:rekognition.us-east-2.amazonaws.com')
  );
  ok('  …con scope de la región correcta', f.authorization.includes('/us-east-2/rekognition/aws4_request'));
}

igual('amzDateDe produce el formato de AWS', amzDateDe(new Date(Date.UTC(2026, 8, 21, 14, 30, 0))), '20260921T143000Z');

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
