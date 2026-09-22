/**
 * Relevo — el eje de Amazon Rekognition (RF-18), TODO lo puro.
 *
 * Cubre drogas, tabaco, alcohol y gambling en la IMAGEN, que es el hueco que
 * ni SafeSearch de Vision ni GPT sobre el texto miran. Es una CAPA NUEVA, no
 * un reemplazo: Vision sigue igual (SafeSearch + OCR intactos).
 *
 * ESTE ARCHIVO NO IMPORTA NADA FUERA DE `decision.ts`, y esa es la
 * precondición que lo hace verificable: `scripts/probe-moderacion.mjs` lo
 * carga desde Node y prueba la implementación REAL en vez de transcribirla
 * (CLAUDE.md §6, paso 4). El `fetch` vive en `index.ts`, del otro lado de la
 * línea, igual que en `vision.ts` y `openai.ts`.
 *
 * LA EXCEPCIÓN DELIBERADA ES EL FIRMADOR SigV4, que sí vive aquí aunque sea
 * "cosa de red". No usa `fetch` ni nada Deno-only —solo `crypto.subtle`, que
 * Node también tiene—, y ponerlo aquí es lo que permite verificarlo contra los
 * vectores de prueba oficiales de AWS. Se descartó `npm:aws4fetch` justamente
 * por eso: con una librería, la firma no tiene cobertura a ningún precio, y un
 * bug de firma se manifiesta como un **403 opaco**, indistinguible de una
 * credencial mal puesta, un permiso de IAM faltante o una región equivocada.
 */

import type { EtiquetaModeracion, Nivel } from './decision.ts';
import { peor } from './decision.ts';

export type { EtiquetaModeracion };

// ---------------------------------------------------------------------------
// El servicio
// ---------------------------------------------------------------------------

export const SERVICIO_AWS = 'rekognition';

/**
 * Rekognition habla JSON-1.1 con `X-Amz-Target`, no REST con rutas: la
 * operación va en un header y la ruta es siempre `/`.
 */
export const TARGET_DETECT_MODERATION = 'RekognitionService.DetectModerationLabels';
export const CONTENT_TYPE_AWS_JSON = 'application/x-amz-json-1.1';

/** El endpoint regional. Se deja como función para poder interceptarlo en pruebas. */
export function hostRekognition(region: string): string {
  return `rekognition.${region}.amazonaws.com`;
}

/**
 * **UNA IMAGEN POR LLAMADA.** `DetectModerationLabels` no batchea, al revés de
 * `images:annotate` de Vision, que acepta un arreglo. O sea que N fotos son N
 * llamadas — se hacen en paralelo desde `index.ts`, nunca en serie.
 *
 * `MinConfidence` se pide en 50 (el default de AWS) aunque se ACTÚE desde 70:
 * la banda 50-70 no mueve el veredicto pero sí se guarda en la auditoría, y
 * es el dataset con el que algún día se decide si subir el umbral a
 * `bloquear`. Ver `CONFIANZA_ACCION` en `decision.ts`.
 */
export const MIN_CONFIDENCE_PEDIDA = 50;

export function cuerpoRekognition(imagenBase64: string): string {
  return JSON.stringify({
    Image: { Bytes: imagenBase64 },
    MinConfidence: MIN_CONFIDENCE_PEDIDA,
  });
}

// ---------------------------------------------------------------------------
// Parseo
// ---------------------------------------------------------------------------

export type ResultadoRekognition =
  | { ok: true; etiquetas: EtiquetaModeracion[] }
  | { ok: false; motivo: string; detalle: string };

/**
 * La validación de forma NO sobra, por el mismo argumento que la de
 * `openai.ts`: si una respuesta rota entrara como `etiquetas: []`, se leería
 * como **imagen limpia** — el fallo silencioso más caro posible en este
 * archivo. Una respuesta que no se entiende es `ok: false`, y el llamador la
 * traduce a `'revisar'`, nunca a `'limpio'`.
 *
 * Ojo con el caso legítimo que SÍ es un arreglo vacío: una imagen sin ninguna
 * etiqueta por encima de `MinConfidence` devuelve `ModerationLabels: []`. Eso
 * es "evaluada y limpia" y se distingue de "no se entendió" porque la clave
 * EXISTE y es un arreglo.
 */
export function parsearRespuestaRekognition(json: unknown): ResultadoRekognition {
  if (typeof json !== 'object' || json === null) {
    return { ok: false, motivo: 'forma_invalida', detalle: 'la respuesta no es un objeto' };
  }

  const cuerpo = json as Record<string, unknown>;

  // Un error de AWS llega como 4xx/5xx con `__type` (p.ej.
  // `InvalidImageFormatException` para un webp, `ImageTooLargeException`).
  // `index.ts` ya mira el status, pero si el cuerpo trae `__type` se conserva
  // porque es lo único que dice CUÁL de los errores fue.
  if (typeof cuerpo.__type === 'string') {
    const mensaje = typeof cuerpo.message === 'string' ? cuerpo.message : '';
    return { ok: false, motivo: cuerpo.__type, detalle: mensaje };
  }

  const crudas = cuerpo.ModerationLabels;
  if (!Array.isArray(crudas)) {
    return {
      ok: false,
      motivo: 'forma_invalida',
      detalle: 'falta ModerationLabels o no es un arreglo',
    };
  }

  const etiquetas: EtiquetaModeracion[] = [];
  for (const cruda of crudas) {
    if (typeof cruda !== 'object' || cruda === null) {
      return { ok: false, motivo: 'forma_invalida', detalle: 'una etiqueta no es un objeto' };
    }
    const e = cruda as Record<string, unknown>;
    if (typeof e.Name !== 'string' || typeof e.Confidence !== 'number') {
      return {
        ok: false,
        motivo: 'forma_invalida',
        detalle: `etiqueta sin Name/Confidence: ${JSON.stringify(e)}`,
      };
    }
    etiquetas.push({
      name: e.Name,
      confidence: e.Confidence,
      // `TaxonomyLevel` es opcional en la doc; si no viene, se asume L1 para
      // no PERDER una etiqueta por un campo ausente — el filtro de categoría
      // de `decision.ts` ya acota a los tres nombres que nos importan, y esos
      // son L1 por definición.
      taxonomy_level: typeof e.TaxonomyLevel === 'number' ? e.TaxonomyLevel : 1,
    });
  }

  return { ok: true, etiquetas };
}

// ---------------------------------------------------------------------------
// El eje, agregando sobre TODAS las fotos
// ---------------------------------------------------------------------------

/**
 * Hermano de `ejeVision()`: el peor nivel sobre todas las fotos. Una foto no
 * evaluable ya viene como `'revisar'` desde `index.ts`, no se filtra.
 */
export function ejeRekognition(niveles: readonly Nivel[]): Nivel {
  return peor(...niveles);
}

// ---------------------------------------------------------------------------
// Firma SigV4
// ---------------------------------------------------------------------------

const ALGORITMO = 'AWS4-HMAC-SHA256';
const enc = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(texto));
  return hex(new Uint8Array(digest));
}

async function hmac(llave: Uint8Array, datos: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    'raw',
    llave as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(datos)));
}

export type PeticionFirmable = {
  metodo: string;
  host: string;
  /** Siempre `/` para Rekognition; parametrizado para poder correr los vectores. */
  ruta: string;
  /** Vacío para Rekognition; parametrizado por lo mismo. */
  query: string;
  /** SIN `host` ni `x-amz-date`: los agrega el firmador. */
  headers: Record<string, string>;
  cuerpo: string;
  region: string;
  servicio: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** `20150830T123600Z`. Parámetro y no `new Date()` adentro: si no, no hay vector que valga. */
  amzDate: string;
};

export type Firma = {
  authorization: string;
  /** Se devuelven los intermedios PARA PODER PROBARLOS contra los `.creq`/`.sts` oficiales. */
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
  amzDate: string;
};

/**
 * Implementa el procedimiento tal cual lo especifica
 * `docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html`.
 *
 * Los nombres de header van en minúsculas, los valores trimmeados, y ordenados
 * alfabéticamente — las tres cosas son requisito, no estilo: cualquiera de
 * ellas mal hecha da un 403 sin más pista.
 */
export async function firmarSigV4(p: PeticionFirmable): Promise<Firma> {
  const fecha = p.amzDate.slice(0, 8); // YYYYMMDD

  const todos: Record<string, string> = {
    ...p.headers,
    host: p.host,
    'x-amz-date': p.amzDate,
  };

  const nombres = Object.keys(todos)
    .map((n) => n.toLowerCase())
    .sort();
  const canonicalHeaders = nombres.map((n) => {
    const valor = todos[Object.keys(todos).find((k) => k.toLowerCase() === n)!];
    return `${n}:${valor.trim().replace(/\s+/g, ' ')}`;
  });
  const signedHeaders = nombres.join(';');

  const hashCuerpo = await sha256Hex(p.cuerpo);

  const canonicalRequest = [
    p.metodo,
    p.ruta,
    p.query,
    ...canonicalHeaders,
    '',
    signedHeaders,
    hashCuerpo,
  ].join('\n');

  const scope = `${fecha}/${p.region}/${p.servicio}/aws4_request`;
  const stringToSign = [
    ALGORITMO,
    p.amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  // La cadena de derivación: secreto → fecha → región → servicio → aws4_request.
  const kFecha = await hmac(enc.encode(`AWS4${p.secretAccessKey}`), fecha);
  const kRegion = await hmac(kFecha, p.region);
  const kServicio = await hmac(kRegion, p.servicio);
  const kFirma = await hmac(kServicio, 'aws4_request');

  const signature = hex(await hmac(kFirma, stringToSign));

  return {
    authorization:
      `${ALGORITMO} Credential=${p.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    canonicalRequest,
    stringToSign,
    signature,
    amzDate: p.amzDate,
  };
}

/** `20260921T143000Z` a partir de un `Date`. */
export function amzDateDe(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
