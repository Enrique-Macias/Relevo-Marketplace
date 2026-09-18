/**
 * moderar-contenido — moderación pre-publicación de RF-18.
 *
 * DOS LLAMADORES, UNA FUNCIÓN. Es la diferencia de fondo con `send-push`, que
 * solo tiene uno:
 *
 *   · el CLIENTE, al terminar de publicar (`publicar.ts`, Ola 3). Manda
 *     `{ listing_id }` con su JWT. Evalúa TODO —texto + todas las fotos— y es
 *     el ÚNICO que puede promover a `activa`.
 *   · el TRIGGER de `storage.objects`, en cada foto o avatar que entra (Ola 2).
 *     Manda el payload de la migración con la secret key en `apikey`. **Solo
 *     puede escalar**, nunca promover.
 *
 * EL DISCRIMINADOR ES `ctx.authMode`, NO LA FORMA DEL PAYLOAD. Un body se puede
 * escribir a mano; el modo de autorización lo determina la credencial que la
 * request trajo, y eso `withSupabase` lo verifica de verdad (el modo `'user'`
 * valida el JWT contra JWKS — ver `.claude/rules/moderacion.md` §2). Inferir el
 * llamador de la forma del body sería adivinar, y la asimetría de arriba es lo
 * único que impide que una foto sucia publique la publicación que ensucia.
 *
 * AUTORIZACIÓN — por qué `verify_jwt = false` no significa "abierta", y por qué
 * NO es el mismo motivo que en `send-push`: allá es porque las secret keys
 * modernas no son JWT y la verificación integrada las rechazaría. Aquí eso
 * sigue siendo cierto para el trigger, pero además el OTRO llamador manda un
 * JWT de usuario legítimo — o sea que **no hay un solo valor de `verify_jwt`
 * que sirva para los dos**. Quien autoriza es `auth: ['secret', 'user']` aquí
 * dentro. Ver supabase/config.toml.
 *
 * LA VERSIÓN DEL IMPORT VA PINEADA, al revés que `send-push:22`. Todo el
 * reparto de permisos de esta función depende de dos cosas del contrato de
 * `@supabase/server` —que `auth` acepte un arreglo y que `ctx.authMode`
 * exista—, y con un specifier sin versión un major futuro las cambiaría sin
 * que nada en el repo lo note. Pinear `send-push` también es un arreglo aparte,
 * anotado en `.claude/rules/moderacion.md`.
 *
 * ESTADO: Vision y OpenAI YA SE LLAMAN DE VERDAD para publicaciones (Olas 1.3,
 * 1.4, 1.5). Los avatares (Ola 1.6) siguen sin evaluación — `moderarAvatar()`
 * es un stub que conserva siempre. Ver `evaluarListing()` para el pipeline
 * completo y `.claude/rules/moderacion.md` §6 para los cuatro caminos de falla
 * segura, cada uno cableado a mano.
 */

import { encodeBase64 } from 'jsr:@std/encoding/base64';
import { withSupabase } from 'npm:@supabase/server@1.7.0';

import { resolverConfig, type ConfigModeracion } from './env.ts';
import {
  decidirAvatar,
  decidirListing,
  esPromocion,
  nivelDeLista,
  nivelDeTexto,
  peor,
  veredicto,
  type Ejes,
  type EstadoListing,
  type Nivel,
} from './decision.ts';
import { coincidencias } from './palabras-prohibidas.ts';
import {
  cuerpoVision,
  ejeVision,
  ENDPOINT_VISION,
  MAX_BYTES_POR_IMAGEN,
  particionar,
  resultadosDeLote,
  textoOcrDe,
  type ResultadoFoto,
  type RespuestaVision,
} from './vision.ts';
import {
  cuerpoOpenAI,
  ENDPOINT_OPENAI,
  parsearRespuestaOpenAI,
  type ParseTexto,
  type RespuestaOpenAI,
} from './openai.ts';

/**
 * A NIVEL DE MÓDULO, no dentro del handler, y no es estilo: el docblock de
 * `resolverConfig()` promete fallar "al ARRANCAR la función, no a media
 * petición". Moverlo adentro del `fetch` rompe esa promesa — la función
 * arrancaría bien, serviría requests, y reventaría a mitad de moderar una
 * publicación real.
 *
 * CON BINDING, y esta vez consumido de verdad — es la actualización que el
 * comentario anterior de este bloque prometía: `evaluarListing()` y las dos
 * llamadas HTTP que dispara necesitan `googleCloudVisionApiKey`/
 * `openaiApiKey`, así que ahora se pasa `config` como parámetro explícito en
 * vez de cerrar sobre la constante del módulo — mismo criterio que `db`, que
 * ya viaja explícito por las firmas en vez de leerse de `ctx` a media función.
 */
const config = resolverConfig();

/** Los dos buckets que el trigger vigila. `entity_id` significa distinto en cada uno. */
type Bucket = 'listing-photos' | 'avatars';

/**
 * El payload del trigger de `storage.objects` (`.claude/rules/moderacion.md` §1.4).
 *
 * `entity_id` es `listings.id` cuando `bucket_id = 'listing-photos'` y
 * `users.id` cuando es `'avatars'` — se llama así y no `listing_id`
 * precisamente para no mentir en el caso del avatar.
 *
 * `tg_op` y `version` llegan y esta función NO los usa: existen para el `WHEN`
 * del trigger, que es quien decide si vale la pena el POST. Se aceptan para que
 * el contrato quede documentado de los dos lados.
 */
type PayloadTrigger = {
  bucket_id: Bucket;
  name: string;
  entity_id: string;
  tg_op?: string;
  version?: string;
};

type Detalle = Record<string, unknown>;

/**
 * Ejes sin evaluar = `'revisar'`, nunca `'limpio'`.
 *
 * Es la falla segura de `.claude/rules/moderacion.md` §6: un eje que no se
 * pudo evaluar hace que `peor()` dé al menos `revisar`, sin que la función de
 * decisión se entere de que hubo fallo. `moderarAvatar()` (Ola 1.6, todavía
 * stub) es hoy el único que la usa directo — `evaluarListing()` ya no
 * necesita un `Ejes` completo de relleno: cada eje se resuelve por separado,
 * con su propio camino de falla segura.
 */
const NO_EVALUADO: Nivel = 'revisar';

const error = (mensaje: string, status: number) =>
  Response.json({ error: mensaje }, { status });

export default {
  fetch: withSupabase(
    { auth: ['secret', 'user'] },
    async (req: Request, ctx) => {
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== 'object') {
        return error('body inválido', 400);
      }

      const db = ctx.supabaseAdmin;

      // -------------------------------------------------------------------
      // Camino del TRIGGER. Solo escala.
      // -------------------------------------------------------------------
      if (ctx.authMode === 'secret') {
        const { bucket_id, name, entity_id } = body as PayloadTrigger;

        if (!bucket_id || !name || !entity_id) {
          return error('falta bucket_id, name o entity_id', 400);
        }

        if (bucket_id === 'avatars') {
          return await moderarAvatar(db, entity_id, name);
        }

        if (bucket_id === 'listing-photos') {
          return await moderarListing(db, Number(entity_id), config, { puedePromover: false });
        }

        // El `WHEN` del trigger ya filtra por bucket, así que llegar aquí
        // significa que alguien con la secret key llamó a mano. No es un 500:
        // no hay nada roto, simplemente no hay nada que moderar.
        return error(`bucket no moderado: ${bucket_id}`, 400);
      }

      // -------------------------------------------------------------------
      // Camino del CLIENTE. El único que puede promover.
      // -------------------------------------------------------------------
      const { listing_id } = body as { listing_id?: number };
      if (!listing_id) return error('falta listing_id', 400);

      // OWNERSHIP. Sin esto, cualquier autenticado pediría moderar —y por tanto
      // PROMOVER— una publicación ajena: bastaría con que la suya estuviera
      // limpia para sacar de `pendiente` la de otro. `ctx.supabaseAdmin` saltea
      // RLS, así que la base no lo va a frenar; el chequeo tiene que ser aquí.
      //
      // ES `.id`, NO `.sub`, y esto costó una corrida en rojo: `ctx.userClaims`
      // es el usuario YA NORMALIZADO por `@supabase/server`
      // (`{ id, role, email, appMetadata, userMetadata }`), no el JWT crudo. El
      // `sub` vive en `ctx.jwtClaims`, que es otra cosa. Escribir `.sub` aquí
      // typechea igual —el shim deja `ctx` sin tipar (`shims.d.ts`)— y falla en
      // runtime como un 401 "sin identidad", que se lee como un problema de
      // credenciales y no como lo que es: un nombre de campo equivocado.
      // Medido contra el runtime local, no deducido.
      const uid = ctx.userClaims?.id;
      if (!uid) return error('sin identidad en el JWT', 401);

      const { data: duenio, error: errDuenio } = await db
        .from('listings')
        .select('user_id')
        .eq('id', listing_id)
        .maybeSingle();

      if (errDuenio) return error(errDuenio.message, 500);
      if (!duenio) return error('no existe', 404);

      // 404 y no 403 a propósito: un 403 confirmaría que esa publicación existe
      // y es de alguien más. Mismo criterio que el resto del proyecto de no
      // filtrar la existencia de filas ajenas.
      if (duenio.user_id !== uid) return error('no existe', 404);

      return await moderarListing(db, listing_id, config, { puedePromover: true });
    }
  ),
};

// ---------------------------------------------------------------------------
// Publicaciones
// ---------------------------------------------------------------------------

async function moderarListing(
  // deno-lint-ignore no-explicit-any
  db: any,
  listingId: number,
  config: ConfigModeracion,
  { puedePromover }: { puedePromover: boolean }
): Promise<Response> {
  const { data: fila, error: errFila } = await db
    .from('listings')
    .select('id, user_id, titulo, descripcion, estado')
    .eq('id', listingId)
    .maybeSingle();

  if (errFila) return error(errFila.message, 500);
  if (!fila) return error('no existe', 404);

  const estadoActual = fila.estado as EstadoListing;

  const { ejes, detalle } = await evaluarListing(db, listingId, fila, config);

  const propuesto = decidirListing(ejes, estadoActual);

  // EL GUARD DE LA ASIMETRÍA. `decidirListing()` ya solo promueve desde
  // `pendiente`, así que hoy esto es redundante con ella — y se escribe igual,
  // porque sin él "el trigger no promueve" sería una propiedad emergente de
  // otra función. Ver el docblock de `esPromocion()`, cuya cobertura vive en
  // `scripts/probe-moderacion.mjs` (405 combinaciones) porque `deno` no está
  // instalado y nada de este archivo es verificable hoy.
  const bloqueadaPorGuard = !puedePromover && esPromocion(estadoActual, propuesto);
  const nuevoEstado = bloqueadaPorGuard ? estadoActual : propuesto;

  if (bloqueadaPorGuard) {
    console.warn(
      `[moderar-contenido] el trigger intentó promover ${listingId}: ${estadoActual} → ${propuesto}. Ignorado.`
    );
  }

  // EL `if` NO ES UNA OPTIMIZACIÓN. Un UPDATE que no cambia nada igual dispara
  // `set_updated_at`, y el vendedor vería "modificada hoy" algo que nadie
  // modificó — es la lección de T23 (b), y `decidirListing` lo pide explícito
  // en su docblock.
  if (nuevoEstado !== estadoActual) {
    const { error: errUpdate } = await db
      .from('listings')
      .update({ estado: nuevoEstado })
      .eq('id', listingId);

    if (errUpdate) return error(errUpdate.message, 500);
  }

  // La fila de auditoría se escribe SIEMPRE, incluso cuando el estado no se
  // movió: `listing_moderacion` es historial de EVALUACIONES, no de cambios
  // (migración 20260918000461). "Se revisó y salió limpia" es justo lo que un
  // revisor necesita saber de una publicación reincidente.
  const { error: errAudit } = await db.from('listing_moderacion').insert({
    listing_id: listingId,
    veredicto: veredicto(ejes),
    estado_resultante: nuevoEstado,
    detalle: { ...detalle, ejes, estado_anterior: estadoActual },
  });

  // Un fallo de auditoría NO tumba la moderación: el veredicto ya se aplicó y
  // negarle la respuesta al cliente por no poder escribir el log sería perder
  // lo importante por lo accesorio. Mismo criterio que el log de contactos
  // (CLAUDE.md §3) — pero aquí sí se grita, porque nadie más lo va a notar.
  if (errAudit) console.error('[moderar-contenido] auditoría', errAudit.message);

  return Response.json({ ok: true, estado: nuevoEstado });
}

const BUCKET_LISTING_PHOTOS: Bucket = 'listing-photos';

/**
 * Los cuatro ejes de una publicación real — Vision + OpenAI en `Promise.all`,
 * texto/OCR contra la lista en local (`.claude/rules/moderacion.md` §3 y §5).
 *
 * **Vision y OpenAI corren en paralelo**, no en serie: no hay dependencia
 * entre ellos — GPT evalúa título+descripción, que ya vienen completos de la
 * base, y no necesita nada que salga de Vision. El OCR **no** pasa por GPT
 * (CLAUDE.md §3): se compara contra la lista en local, después de que Vision
 * responde.
 *
 * **Los CUATRO caminos de falla segura**, cada uno cableado a mano y ninguno
 * propaga una excepción hacia arriba:
 *
 *  1. Vision falla (la llamada entera, no por foto) → ver `llamarLoteVision`.
 *  2. OpenAI falla → ver `evaluarTexto`.
 *  3. OpenAI responde 200 con un *refusal* → lo distingue
 *     `parsearRespuestaOpenAI` (`openai.ts`); aquí solo se traduce a
 *     `ejes.gptTexto = 'revisar'`.
 *  4. Falla la DESCARGA de una foto suelta → se construye su
 *     `ResultadoFoto` como `no_evaluable` y entra en `ejeVision()` igual que
 *     las demás; NO se filtra ni se salta.
 */
async function evaluarListing(
  // deno-lint-ignore no-explicit-any
  db: any,
  listingId: number,
  fila: { titulo: string; descripcion: string | null },
  config: ConfigModeracion
): Promise<{ ejes: Ejes; detalle: Detalle }> {
  const { data: fotos, error: errFotos } = await db
    .from('listing_photos')
    .select('storage_path')
    .eq('listing_id', listingId)
    .order('orden');

  if (errFotos) {
    console.error(
      `[moderar-contenido] no se pudieron leer listing_photos de ${listingId}`,
      errFotos.message
    );
  }

  const storagePaths: string[] = (fotos ?? []).map(
    (f: { storage_path: string }) => f.storage_path
  );

  const [fotosResultado, resultadoTexto] = await Promise.all([
    evaluarFotos(db, config, storagePaths),
    evaluarTexto(config, fila.titulo, fila.descripcion),
  ]);
  const { resultados: resultadosFotos, lotesVision } = fotosResultado;

  const textoTecleado = `${fila.titulo} ${fila.descripcion ?? ''}`;
  const matchesTecleado = coincidencias(textoTecleado);
  const matchesOcr = coincidencias(textoOcrDe(resultadosFotos));

  const ejes: Ejes = {
    vision: ejeVision(resultadosFotos),
    gptTexto: resultadoTexto.ok ? nivelDeTexto(resultadoTexto.veredicto) : NO_EVALUADO,
    listaTecleada: nivelDeLista(matchesTecleado, 'tecleado'),
    listaOcr: nivelDeLista(matchesOcr, 'ocr'),
  };

  // `detalle` guarda POR QUÉ se marcó cada publicación — es la razón de ser de
  // `listing_moderacion` (migración 20260918000461). SafeSearch por foto CON
  // su `storage_path`, las palabras macheadas en texto tecleado y en OCR POR
  // SEPARADO, el veredicto de GPT por categoría, y CUÁL eje mandó.
  const detalle: Detalle = {
    fotos: resultadosFotos.map((r) =>
      r.estado === 'evaluada'
        ? { storage_path: r.storagePath, estado: r.estado, safe_search: r.safeSearch }
        : { storage_path: r.storagePath, estado: r.estado, motivo: r.motivo }
    ),
    lista_tecleada: matchesTecleado,
    lista_ocr: matchesOcr,
    gpt: resultadoTexto.ok
      ? { veredicto: resultadoTexto.veredicto }
      : { motivo: resultadoTexto.motivo, detalle: resultadoTexto.detalle },
    eje_que_manda: ejeQueManda(ejes),
    // Cuántos requests a Vision se hicieron, no cuántas fotos hay — casi
    // siempre 1 (`.claude/rules/moderacion.md` §3: "UNA sola llamada en el
    // caso normal"). Es el único dato de `detalle` que existe para PROBAR el
    // sistema, no para explicar un veredicto: sin él, "¿se partió en más de
    // un lote?" no es observable desde afuera de la función.
    lotes_vision: lotesVision,
  };

  return { ejes, detalle };
}

/**
 * Descarga cada foto de Storage, las particiona con `particionar()` de
 * `vision.ts`, y manda un request por lote. Devuelve un `ResultadoFoto` por
 * cada `storagePath` de entrada —SIEMPRE, ninguna se pierde en el camino—,
 * más `lotesVision`: cuántos requests a Vision se hicieron de verdad.
 *
 * SIN FOTOS es un arreglo vacío, no un error: `ejeVision([])` ya lee eso como
 * `'limpio'` (`vision.ts`), y quien impide publicar sin fotos es el trigger
 * `listings_enforce_activation_has_photos`, no esta función.
 */
async function evaluarFotos(
  // deno-lint-ignore no-explicit-any
  db: any,
  config: ConfigModeracion,
  storagePaths: readonly string[]
): Promise<{ resultados: ResultadoFoto[]; lotesVision: number }> {
  if (storagePaths.length === 0) return { resultados: [], lotesVision: 0 };

  const descargadas: { storagePath: string; tamano: number; bytes: Uint8Array }[] = [];
  const fallosDeDescarga: ResultadoFoto[] = [];

  for (const storagePath of storagePaths) {
    try {
      const { data: blob, error: errDescarga } = await db.storage
        .from(BUCKET_LISTING_PHOTOS)
        .download(storagePath);

      // CAMINO 4 DE FALLA SEGURA: la descarga falla (path inválido, objeto
      // borrado entre que el trigger disparó y la función corre). Se
      // construye el `ResultadoFoto` aquí mismo — NO se salta el `continue` a
      // secas, que es la forma en la que este caso se implementaría mal: una
      // foto sucia que justo falle al descargarse se trataría como si no
      // existiera y la publicación saldría `activa`.
      if (errDescarga || !blob) {
        fallosDeDescarga.push({
          estado: 'no_evaluable',
          storagePath,
          motivo: `no se pudo descargar: ${errDescarga?.message ?? 'sin contenido'}`,
        });
        continue;
      }

      const bytes = new Uint8Array(await blob.arrayBuffer());
      descargadas.push({ storagePath, tamano: bytes.length, bytes });
    } catch (e) {
      fallosDeDescarga.push({
        estado: 'no_evaluable',
        storagePath,
        motivo: `excepción al descargar: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  const { lotes, demasiadoGrandes } = particionar(descargadas);

  // Las que pasan el tope POR IMAGEN de Vision no se mandan, pero TAMPOCO se
  // descartan en silencio — cuentan como no evaluables, igual que un fallo de
  // descarga (`vision.ts`, `Particion.demasiadoGrandes`).
  const demasiadoGrandesComoResultado: ResultadoFoto[] = demasiadoGrandes.map((f) => ({
    estado: 'no_evaluable',
    storagePath: f.storagePath,
    motivo: `excede el tope de Vision por imagen (${MAX_BYTES_POR_IMAGEN} bytes)`,
  }));

  const resultadosPorLote = await Promise.all(
    lotes.map((lote) => llamarLoteVision(config, lote))
  );

  return {
    resultados: [...fallosDeDescarga, ...demasiadoGrandesComoResultado, ...resultadosPorLote.flat()],
    lotesVision: lotes.length,
  };
}

/**
 * Un request a Vision por lote. Las fotos ya vienen descargadas —solo falta
 * codificarlas.
 *
 * `encodeBase64` de `jsr:@std/encoding/base64`, NO
 * `btoa(String.fromCharCode(...bytes))`: el spread de un array de varios MB
 * revienta con `RangeError: Maximum call stack size exceeded` (medido en
 * Node, `scripts/probe-moderacion.mjs`).
 *
 * La llave va en la QUERY STRING (`?key=`), no en un header — es el mecanismo
 * documentado de Vision para autenticar con una API key simple, distinto del
 * `apikey` que usa Supabase.
 *
 * CAMINO 1 DE FALLA SEGURA: si el `fetch` lanza, o la respuesta no es 2xx, el
 * lote ENTERO se trata como sin respuesta — `resultadosDeLote(lote, null)` ya
 * sabe convertir eso en un `no_evaluable` por cada foto del lote
 * (`vision.ts`, probado contra "respuesta nula"). Un error POR FOTO dentro de
 * un 200 lo distingue `resultadosDeLote` mirando el campo `error` de cada
 * entrada — no hay que duplicar esa lógica aquí.
 */
async function llamarLoteVision(
  config: ConfigModeracion,
  lote: readonly { storagePath: string; tamano: number; bytes: Uint8Array }[]
): Promise<ResultadoFoto[]> {
  try {
    const imagenesBase64 = lote.map((f) => encodeBase64(f.bytes));
    const cuerpo = cuerpoVision(imagenesBase64);

    const res = await fetch(`${ENDPOINT_VISION}?key=${config.googleCloudVisionApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });

    if (!res.ok) {
      console.error('[moderar-contenido] vision respondió', res.status, await res.text());
      return resultadosDeLote(lote, null);
    }

    const json = (await res.json()) as RespuestaVision;
    return resultadosDeLote(lote, json);
  } catch (e) {
    console.error('[moderar-contenido] vision', e instanceof Error ? e.message : e);
    return resultadosDeLote(lote, null);
  }
}

/**
 * El texto: título + descripción, vía OpenAI Responses API.
 *
 * CAMINOS 2 Y 3 DE FALLA SEGURA: un `fetch` que lanza o responde fuera de
 * 2xx se traduce aquí a `{ ok: false, motivo: 'error_http' }`; un 200 con
 * *refusal*, o cualquier forma que no cuadre con el schema, lo distingue
 * `parsearRespuestaOpenAI` (`openai.ts`) — esta función NO hace `JSON.parse` a
 * ciegas, delega el parseo entero a esa función pura.
 */
async function evaluarTexto(
  config: ConfigModeracion,
  titulo: string,
  descripcion: string | null
): Promise<ParseTexto> {
  try {
    const cuerpo = cuerpoOpenAI(titulo, descripcion);

    const res = await fetch(ENDPOINT_OPENAI, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify(cuerpo),
    });

    if (!res.ok) {
      const texto = await res.text();
      console.error('[moderar-contenido] openai respondió', res.status, texto);
      return { ok: false, motivo: 'error_http', detalle: `HTTP ${res.status}: ${texto.slice(0, 200)}` };
    }

    const json = (await res.json()) as RespuestaOpenAI;
    return parsearRespuestaOpenAI(json);
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    console.error('[moderar-contenido] openai', detalle);
    return { ok: false, motivo: 'error_http', detalle };
  }
}

/**
 * Cuál de los cuatro ejes es el que decide el veredicto — solo para el
 * `detalle` de auditoría, NO participa en `decidirListing()`.
 *
 * En caso de empate manda el PRIMERO en este orden fijo (`vision` primero),
 * que es una decisión de REPORTE y no de lógica: `veredicto()` usa `peor()`,
 * que es conmutativo, así que el resultado de `decidirListing` es idéntico
 * sin importar cuál de los empatados se reporte aquí.
 */
function ejeQueManda(ejes: Ejes): keyof Ejes {
  const max = peor(ejes.vision, ejes.gptTexto, ejes.listaTecleada, ejes.listaOcr);
  const orden: (keyof Ejes)[] = ['vision', 'gptTexto', 'listaTecleada', 'listaOcr'];
  return orden.find((k) => ejes[k] === max) ?? 'vision';
}

// ---------------------------------------------------------------------------
// Avatares
// ---------------------------------------------------------------------------

/**
 * TODAVÍA NO EVALÚA NADA — Ola 1.6.
 *
 * Aquí la falla segura es la CONTRARIA a la de las publicaciones, y no es una
 * inconsistencia: `decidirAvatar()` solo borra con `bloquear`, así que un eje
 * en `'revisar'` da `'conservar'`. Es la decisión de producto de CLAUDE.md §3
 * —un avatar dudoso no se borra— aplicada tal cual: sin evaluación, no se toca
 * nada. Un stub que borrara sería destructivo e irreversible.
 */
async function moderarAvatar(
  // deno-lint-ignore no-explicit-any
  _db: any,
  entityId: string,
  name: string
): Promise<Response> {
  console.warn(
    `[moderar-contenido] evaluación de avatar no implementada; ${name} se conserva`
  );

  const accion = decidirAvatar({
    vision: NO_EVALUADO,
    listaOcr: NO_EVALUADO,
  });

  // `accion` es `'conservar'` por construcción mientras el stub esté; la rama
  // de borrado (con su guard de carrera sobre `foto_url`) llega en la Ola 1.6.
  return Response.json({ ok: true, accion, user_id: entityId });
}
