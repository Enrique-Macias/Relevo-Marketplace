/**
 * Relevo — la parte PURA de la llamada a Google Cloud Vision (RF-18, Ola 1.3).
 *
 * QUÉ VIVE AQUÍ Y QUÉ NO, que es la decisión de diseño del archivo: aquí está
 * todo lo que se puede probar sin red y sin credenciales —el particionado por
 * tamaño, la forma del request, el parseo de la respuesta y la derivación del
 * eje—, y NO está el `fetch` ni la descarga desde Storage ni el
 * `encodeBase64`. Es el mismo reparto que ya usa `decision.ts` frente a
 * `index.ts`, y por el mismo motivo: `deno` no está instalado en esta máquina,
 * así que lo que viva en el módulo Deno-only es hoy inverificable. Este archivo
 * no importa nada fuera de `./decision.ts` (que a su vez no importa nada), así
 * que `scripts/probe-moderacion.mjs` lo carga de verdad desde Node.
 *
 * Si alguien le mete aquí un `import` de Deno o de Supabase, el probe deja de
 * arrancar — esa es la señal, no un inconveniente.
 */

import { peor, type Nivel, type SafeSearch } from './decision.ts';

// ---------------------------------------------------------------------------
// Los tres límites de Vision, y cuál es el que muerde
// ---------------------------------------------------------------------------

/**
 * `docs.cloud.google.com/vision/quotas` documenta TRES topes para
 * `images:annotate`, y conviene saber cuál pega primero:
 *
 *   · 16 imágenes por request
 *   · 20 MB por imagen
 *   · **10 MB por objeto JSON del request**  ← el que muerde
 *
 * El tercero manda porque base64 infla los bytes crudos en 4/3 (medido, no
 * estimado: 6 MiB crudos → 8,388,608 caracteres, exactamente `ceil(n/3)*4`).
 * O sea que el presupuesto real de bytes CRUDOS por request ronda los 7.4 MB,
 * muy por debajo de lo que el bucket permite subir: 5 MiB por foto × 5 fotos
 * = 25 MiB crudos ≈ 33 MB de JSON, **3.3× por encima del límite**.
 *
 * En el caso normal nada de esto se activa —`normalizar()` de
 * `foto-picker.ts` deja cada foto en cientos de KB y las cinco caben en un
 * solo request—, pero la función también va a ver fotos que nunca pasaron por
 * ahí: subidas directas al Storage API, Studio, y filas viejas.
 */
export const MAX_IMAGENES_POR_LOTE = 16;

/**
 * 6 MiB de bytes CRUDOS por lote, con holgura deliberada bajo los ~7.4 MB
 * efectivos. La holgura no es superstición: el JSON lleva además el array
 * `requests`, los objetos de `features` y las comillas de cada campo, y nada
 * de eso entra en este número. `probe-moderacion.mjs` verifica que un lote
 * lleno a tope quepa en el límite de 10 MB una vez codificado.
 */
export const MAX_BYTES_POR_LOTE = 6 * 1024 * 1024;

/**
 * Tope de Vision POR IMAGEN. Una foto que lo pase no se manda: no hay forma de
 * partirla, así que cuenta como eje no evaluable → `revisar` (ver `ejeVision`).
 */
export const MAX_BYTES_POR_IMAGEN = 20 * 1024 * 1024;

/** Lo que Vision acepta en un `requests[]` de 10 MB, en bytes. */
export const MAX_BYTES_JSON_REQUEST = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// La foto que disparó el trigger, unida al set que ya existe
// ---------------------------------------------------------------------------

/**
 * Une el path del objeto que disparó el trigger de `storage.objects` al set
 * de rutas que ya trae `listing_photos`, sin duplicarlo si la fila YA está
 * (el caso `x-upsert` sobre una ruta existente: la fila anterior sigue ahí).
 *
 * EXISTE PORQUE EL OBJETO SE SUBE ANTES DE QUE EXISTA SU FILA. `storage.ts`
 * sube el archivo (`subirObjeto()`) y solo DESPUÉS `guardarFotos()` (fotos de
 * publicación) o `update foto_url` (avatar) escriben la fila que lo apunta —
 * es el mismo orden que `publicar.ts` documenta como load-bearing (regla 2 de
 * su docblock). En el instante en que el trigger dispara, `listing_photos`
 * TODAVÍA NO tiene la foto que lo disparó.
 *
 * Sin esta unión, `evaluarListing()` lee solo lo que `listing_photos` YA
 * tenía — el set ANTERIOR — y la foto que acaba de entrar queda evaluada por
 * NADIE: no la ve este evento (no está en la tabla todavía) ni ninguno
 * posterior (nada vuelve a disparar sobre ella una vez que su fila existe).
 *
 * ES PURA A PROPÓSITO, como el resto de este archivo (CLAUDE.md §9,
 * `.claude/rules/moderacion.md` §6): decide QUÉ paths se evalúan, un paso
 * antes de que `particionar()` decida CÓMO se agrupan. Vivir aquí y no inline
 * en `index.ts` es lo que le permite a `scripts/probe-moderacion.mjs`
 * cubrirla sin pagar un solo request a Vision.
 */
export function unirFotoDisparadora(
  pathsExistentes: readonly string[],
  nombreDisparador?: string
): string[] {
  if (!nombreDisparador || pathsExistentes.includes(nombreDisparador)) {
    return [...pathsExistentes];
  }
  return [...pathsExistentes, nombreDisparador];
}

/**
 * El largo EXACTO en caracteres de codificar `bytes` bytes en base64.
 *
 * No es una aproximación: base64 empaqueta de a 3 bytes en 4 caracteres y
 * rellena con `=`, así que el resultado es siempre `ceil(n/3)*4`. Verificado
 * contra `Buffer.from(...).toString('base64')` en el probe, porque una
 * "constante de inflación" de 1.33 redondeada hacia abajo haría que el
 * particionado creyera que cabe algo que no cabe.
 */
export function tamanoBase64(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

// ---------------------------------------------------------------------------
// Particionado
// ---------------------------------------------------------------------------

/** Lo mínimo que el particionado necesita saber de una foto. */
export type FotoConTamano = {
  /** La ruta dentro del bucket, para poder reportar cuál falló. */
  storagePath: string;
  /** Bytes CRUDOS, antes de base64. */
  tamano: number;
};

export type Particion<T> = {
  /** Cada lote es un request a Vision. En el caso normal hay exactamente uno. */
  lotes: T[][];
  /**
   * Las que superan `MAX_BYTES_POR_IMAGEN`. **No se descartan en silencio** —
   * el llamador las tiene que pasar a `ejeVision` como no evaluables, que es
   * lo que las convierte en `revisar`. Devolverlas por separado en vez de
   * filtrarlas es justo lo que impide el fallo silencioso.
   */
  demasiadoGrandes: T[];
};

/**
 * Agrupa las fotos en lotes que quepan en un request de Vision.
 *
 * Acumula hasta `MAX_BYTES_POR_LOTE` de bytes crudos o `MAX_IMAGENES_POR_LOTE`
 * imágenes, lo que ocurra primero. Es greedy y conserva el orden: no intenta
 * empacar óptimo, porque el caso normal es "todo cabe en uno" y un bin packing
 * de verdad solo agregaría formas de equivocarse.
 *
 * UNA FOTO QUE POR SÍ SOLA PASA DEL LÍMITE DEL LOTE VA EN SU PROPIO LOTE (no
 * se descarta), siempre que no pase el tope por imagen.
 *
 * De ahí el `actual.length > 0` del corte, y lo que pasa sin él está MEDIDO,
 * no supuesto — esta nota decía antes que el bucle "no termina nunca", y es
 * falso: el bucle termina igual. Lo que sale es un **lote VACÍO** al frente
 * (`[0, 1, 1]` en vez de `[1, 1]`), o sea un request a Vision con cero
 * imágenes: una llamada de red desperdiciada, y una respuesta sin entradas que
 * `resultadosDeLote` leería como "sin respuesta para esta imagen". Solo ocurre
 * cuando la PRIMERA foto es la que no cabe, que es justo el caso que la
 * primera versión de las pruebas no cubría.
 */
export function particionar<T extends FotoConTamano>(
  fotos: readonly T[]
): Particion<T> {
  const demasiadoGrandes: T[] = [];
  const lotes: T[][] = [];
  let actual: T[] = [];
  let bytesActual = 0;

  for (const foto of fotos) {
    if (foto.tamano > MAX_BYTES_POR_IMAGEN) {
      demasiadoGrandes.push(foto);
      continue;
    }

    const noCabePorBytes = bytesActual + foto.tamano > MAX_BYTES_POR_LOTE;
    const noCabePorConteo = actual.length >= MAX_IMAGENES_POR_LOTE;

    // El `actual.length > 0` es lo que evita el bucle infinito descrito arriba:
    // una foto que no cabe en un lote VACÍO igual entra, sola.
    if (actual.length > 0 && (noCabePorBytes || noCabePorConteo)) {
      lotes.push(actual);
      actual = [];
      bytesActual = 0;
    }

    actual.push(foto);
    bytesActual += foto.tamano;
  }

  if (actual.length > 0) lotes.push(actual);

  return { lotes, demasiadoGrandes };
}

// ---------------------------------------------------------------------------
// El request
// ---------------------------------------------------------------------------

export const ENDPOINT_VISION = 'https://vision.googleapis.com/v1/images:annotate';

export type CuerpoVision = {
  requests: {
    image: { content: string };
    features: { type: 'SAFE_SEARCH_DETECTION' | 'TEXT_DETECTION' }[];
  }[];
};

/**
 * El body de un lote. Las DOS features van en la misma entrada por imagen —
 * SafeSearch y el OCR— porque Vision las cobra y las resuelve en la misma
 * pasada; pedirlas en dos requests separados duplicaría el costo sin ganar
 * nada.
 */
export function cuerpoVision(imagenesBase64: readonly string[]): CuerpoVision {
  return {
    requests: imagenesBase64.map((content) => ({
      image: { content },
      features: [{ type: 'SAFE_SEARCH_DETECTION' }, { type: 'TEXT_DETECTION' }],
    })),
  };
}

// ---------------------------------------------------------------------------
// La respuesta
// ---------------------------------------------------------------------------

/** La forma de la respuesta de Vision, acotada a lo que este código lee. */
export type RespuestaVision = {
  responses?: {
    safeSearchAnnotation?: Partial<SafeSearch>;
    fullTextAnnotation?: { text?: string };
    /** Vision reporta fallos POR IMAGEN dentro de un lote que salió 200. */
    error?: { message?: string };
  }[];
};

/**
 * El resultado por foto. Es una unión discriminada y no un objeto con campos
 * opcionales a propósito: `no_evaluable` tiene que ser imposible de confundir
 * con "evaluada y limpia", que es exactamente el fallo que `ejeVision` existe
 * para impedir.
 */
export type ResultadoFoto =
  | { estado: 'evaluada'; storagePath: string; safeSearch: SafeSearch; textoOcr: string }
  | { estado: 'no_evaluable'; storagePath: string; motivo: string };

/** Un campo que Vision no reportó es `UNKNOWN`, que `nivelDeSafeSearch` lee como limpio. */
function completarSafeSearch(parcial: Partial<SafeSearch>): SafeSearch {
  return {
    adult: parcial.adult ?? 'UNKNOWN',
    violence: parcial.violence ?? 'UNKNOWN',
    racy: parcial.racy ?? 'UNKNOWN',
  };
}

/**
 * Empareja un lote con su respuesta, POR ÍNDICE, que es como Vision las
 * devuelve.
 *
 * Tres formas de que una foto salga `no_evaluable`, y las tres son fallas
 * seguras que suben el eje a `revisar` en vez de dejarla pasar:
 *
 *  1. La respuesta trae MENOS entradas que el lote (o ninguna). El emparejado
 *     por índice lo detecta solo; sin este caso, un lote truncado se leería
 *     como "las que faltan salieron limpias".
 *  2. La entrada trae `error` — Vision falla por imagen dentro de un lote que
 *     respondió 200. Es el caso que más fácil se pierde, porque el status HTTP
 *     dice que todo salió bien.
 *  3. No hay `safeSearchAnnotation`. La feature no corrió, así que no hay
 *     veredicto; distinto de que haya corrido y no haya encontrado nada, que
 *     llega como `VERY_UNLIKELY`.
 *
 * El OCR ausente NO es motivo de `no_evaluable`: una foto sin texto legible es
 * el caso normal, y se representa como cadena vacía.
 */
export function resultadosDeLote<T extends FotoConTamano>(
  lote: readonly T[],
  respuesta: RespuestaVision | null
): ResultadoFoto[] {
  const entradas = respuesta?.responses ?? [];

  return lote.map((foto, i) => {
    const entrada = entradas[i];

    if (!entrada) {
      return {
        estado: 'no_evaluable',
        storagePath: foto.storagePath,
        motivo: 'sin respuesta de Vision para esta imagen',
      };
    }
    if (entrada.error) {
      return {
        estado: 'no_evaluable',
        storagePath: foto.storagePath,
        motivo: `Vision devolvió error: ${entrada.error.message ?? 'sin mensaje'}`,
      };
    }
    if (!entrada.safeSearchAnnotation) {
      return {
        estado: 'no_evaluable',
        storagePath: foto.storagePath,
        motivo: 'la respuesta no trae safeSearchAnnotation',
      };
    }

    return {
      estado: 'evaluada',
      storagePath: foto.storagePath,
      safeSearch: completarSafeSearch(entrada.safeSearchAnnotation),
      textoOcr: entrada.fullTextAnnotation?.text ?? '',
    };
  });
}

// ---------------------------------------------------------------------------
// El eje
// ---------------------------------------------------------------------------

/**
 * El nivel del eje `vision`, sobre TODAS las fotos.
 *
 * **Una foto no evaluable cuenta como `revisar`, no se filtra.** Es la falla
 * segura de `.claude/rules/moderacion.md` §6 y el punto entero de que
 * `ResultadoFoto` sea una unión: lo natural al escribir esto es quedarse solo
 * con las evaluadas y sacarles el `peor()`, y eso significa que una foto sucia
 * que justo falle al descargarse se trata como si no existiera y la
 * publicación sale `activa`.
 *
 * SIN FOTOS es `limpio`, no `revisar`, y la distinción es deliberada: una lista
 * vacía no es un fallo de evaluación, es que no hay nada que evaluar. Además
 * una publicación no llega a `activa` sin al menos una foto —lo impone el
 * trigger `listings_enforce_activation_has_photos`, no esta función— así que
 * devolver `revisar` aquí solo mandaría a la cola publicaciones que el trigger
 * ya frena por otro lado.
 */
export function ejeVision(resultados: readonly ResultadoFoto[]): Nivel {
  const niveles = resultados.map((r): Nivel =>
    r.estado === 'no_evaluable' ? 'revisar' : nivelDeUnaFoto(r.safeSearch)
  );
  return peor(...niveles);
}

/** Separado para que `ejeVision` no dependa del orden de los imports. */
function nivelDeUnaFoto(ss: SafeSearch): Nivel {
  const deUna = (l: SafeSearch['adult']): Nivel =>
    l === 'VERY_LIKELY' ? 'bloquear' : l === 'LIKELY' ? 'revisar' : 'limpio';
  return peor(deUna(ss.adult), deUna(ss.violence), deUna(ss.racy));
}

/**
 * Todo el texto que el OCR sacó de TODAS las fotos, concatenado, para pasarlo
 * por `coincidencias()` UNA sola vez.
 *
 * Va junto y no foto por foto porque la consecuencia es la misma —el eje
 * `listaOcr` tiene techo en `revisar` sin importar en cuál foto apareció— y
 * una sola pasada evita que la misma palabra en dos fotos se reporte dos
 * veces. El separador es un salto de línea para que no se peguen dos palabras
 * de fotos distintas y formen una tercera que nadie escribió.
 */
export function textoOcrDe(resultados: readonly ResultadoFoto[]): string {
  return resultados
    .filter((r): r is Extract<ResultadoFoto, { estado: 'evaluada' }> => r.estado === 'evaluada')
    .map((r) => r.textoOcr)
    .filter((t) => t.length > 0)
    .join('\n');
}
