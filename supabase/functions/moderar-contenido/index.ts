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
 * ESTADO: Vision y OpenAI YA SE LLAMAN DE VERDAD, para publicaciones
 * (`evaluarListing()`, Olas 1.3-1.5) y para avatares (`moderarAvatar()`, Ola
 * 1.6, mismo pipeline de imagen vía `evaluarFotos()` parametrizada por
 * bucket). Ver `.claude/rules/moderacion.md` §6 para los caminos de falla
 * segura de cada uno, cada uno cableado a mano y verificado contra la
 * función viva.
 */

import { encodeBase64 } from 'jsr:@std/encoding/base64';
import { withSupabase } from 'npm:@supabase/server@1.7.0';

import { resolverConfig, type ConfigModeracion } from './env.ts';
import {
  decidirAvatar,
  decidirListing,
  esPromocion,
  evaluacionIncompleta,
  nivelDeLista,
  nivelDeTexto,
  nivelDeRekognition,
  etiquetasParaAuditoria,
  veredicto,
  type EtiquetaModeracion,
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
  unirFotoDisparadora,
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
import {
  amzDateDe,
  CONTENT_TYPE_AWS_JSON,
  cuerpoRekognition,
  ejeRekognition,
  firmarSigV4,
  hostRekognition,
  parsearRespuestaRekognition,
  SERVICIO_AWS,
  TARGET_DETECT_MODERATION,
} from './rekognition.ts';

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
          return await moderarAvatar(db, config, entity_id, name);
        }

        if (bucket_id === 'listing-photos') {
          // `nombreDisparador: name` es lo que cierra el hueco de
          // `.claude/rules/moderacion.md` §1: sin él, `evaluarListing()` solo
          // vería el set que `listing_photos` YA tenía, y la foto que acaba
          // de subir —cuya fila todavía no existe— no la evaluaría nadie.
          const { respuesta } = await moderarListing(db, Number(entity_id), config, {
            puedePromover: false,
            nombreDisparador: name,
          });
          return respuesta;
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

      // EL RECLAMO (migración 20260928000471). El camino cliente evalúa UNA vez
      // en la vida de la publicación y nunca dos a la vez: sin esto, un
      // "Reintentar" mientras la primera llamada sigue viva en el servidor
      // (1.6-5.0 s medidos) pagaba la evaluación dos veces, y un dueño podía
      // re-tirar GPT por API sobre una publicación que el trigger ya había
      // mandado a `pendiente`. El camino del TRIGGER no pasa por aquí: las
      // fotos editadas se siguen evaluando siempre.
      const reclamo = await reclamar(db, listing_id);
      if (reclamo.tipo === 'error') return error(reclamo.mensaje, 500);

      if (reclamo.tipo === 'ocupado') {
        // Otra llamada está evaluando, o el alta ya se evaluó. No se evalúa ni
        // se paga nada: se responde el estado vigente, que es lo que el
        // cliente necesita para saber a qué pantalla ir.
        const { data: vigente, error: errVigente } = await db
          .from('listings')
          .select('estado')
          .eq('id', listing_id)
          .maybeSingle();
        if (errVigente) return error(errVigente.message, 500);
        if (!vigente) return error('no existe', 404);
        return Response.json({ ok: true, estado: vigente.estado, sin_evaluar: 'reclamo_tomado' });
      }

      let resultado: ResultadoModeracion;
      try {
        resultado = await moderarListing(db, listing_id, config, { puedePromover: true });
      } catch (e) {
        await liberarReclamo(db, listing_id, reclamo.reclamadaAt);
        throw e;
      }

      // Completa → marca permanente. Cualquier otra cosa (500 manejado, eje
      // sin evaluar) → se libera el reclamo PROPIO, para que el reintento pueda
      // evaluar de inmediato en vez de esperar el TTL.
      if (resultado.completa) {
        await completarReclamo(db, listing_id, reclamo.reclamadaAt);
      } else {
        await liberarReclamo(db, listing_id, reclamo.reclamadaAt);
      }
      return resultado.respuesta;
    }
  ),
};

// ---------------------------------------------------------------------------
// El reclamo del camino cliente (`listing_moderacion_reclamos`)
// ---------------------------------------------------------------------------

/**
 * Más de 60 s sin completarse = el worker murió y el reclamo quedó huérfano.
 * Es 12 veces el máximo medido en producción (5,044 ms, function_edge_logs del
 * 2026-09-22, n=13). Si una evaluación legítima tardara más, una segunda podría
 * correr en paralelo, y la red de ese caso es el compare-and-set de
 * `moderarListing()`.
 *
 * El corte se calcula con el reloj de la función y se compara contra
 * `reclamada_at`, que pone la base: dos relojes de servidor sincronizados,
 * con una deriva despreciable frente a 60 s.
 */
const TTL_RECLAMO_MS = 60_000;

type Reclamo =
  | { tipo: 'propio'; reclamadaAt: string }
  | { tipo: 'ocupado' }
  | { tipo: 'error'; mensaje: string };

async function reclamar(
  // deno-lint-ignore no-explicit-any
  db: any,
  listingId: number
): Promise<Reclamo> {
  // 1. El TTL. `completada_at is null` es lo que impide que libere un reclamo
  //    EXITOSO: sin esa condición, pasados 60 s cualquier llamada borraría la
  //    marca permanente y el alta se volvería a evaluar.
  const limite = new Date(Date.now() - TTL_RECLAMO_MS).toISOString();
  const { error: errTtl } = await db
    .from('listing_moderacion_reclamos')
    .delete()
    .eq('listing_id', listingId)
    .is('completada_at', null)
    .lt('reclamada_at', limite);
  if (errTtl) return { tipo: 'error', mensaje: errTtl.message };

  // 2. El reclamo. `ignoreDuplicates` es `on conflict do nothing`, y con
  //    `.select()` devuelve SOLO la fila insertada: 1 fila = es nuestro, 0 =
  //    lo tiene otra llamada (o el alta ya se evaluó). La atomicidad es la de
  //    la PK: dos inserts concurrentes no pueden ganar los dos.
  const { data, error: errIns } = await db
    .from('listing_moderacion_reclamos')
    .upsert({ listing_id: listingId }, { onConflict: 'listing_id', ignoreDuplicates: true })
    .select('reclamada_at');
  if (errIns) return { tipo: 'error', mensaje: errIns.message };

  if (!data || data.length === 0) return { tipo: 'ocupado' };
  return { tipo: 'propio', reclamadaAt: data[0].reclamada_at };
}

/**
 * `eq('reclamada_at', …)` en las dos: si el TTL ya nos quitó el reclamo y otra
 * llamada tomó uno nuevo, no se toca el suyo. Ninguna de las dos lanza: un
 * fallo aquí se grita y no tumba la respuesta, porque el veredicto ya se aplicó.
 */
async function completarReclamo(
  // deno-lint-ignore no-explicit-any
  db: any,
  listingId: number,
  reclamadaAt: string
): Promise<void> {
  const { error: err } = await db
    .from('listing_moderacion_reclamos')
    .update({ completada_at: new Date().toISOString() })
    .eq('listing_id', listingId)
    .eq('reclamada_at', reclamadaAt);
  if (err) console.error('[moderar-contenido] no se pudo completar el reclamo', err.message);
}

async function liberarReclamo(
  // deno-lint-ignore no-explicit-any
  db: any,
  listingId: number,
  reclamadaAt: string
): Promise<void> {
  const { error: err } = await db
    .from('listing_moderacion_reclamos')
    .delete()
    .eq('listing_id', listingId)
    .is('completada_at', null)
    .eq('reclamada_at', reclamadaAt);
  if (err) console.error('[moderar-contenido] no se pudo liberar el reclamo', err.message);
}

// ---------------------------------------------------------------------------
// Publicaciones
// ---------------------------------------------------------------------------

async function moderarListing(
  // deno-lint-ignore no-explicit-any
  db: any,
  listingId: number,
  config: ConfigModeracion,
  {
    puedePromover,
    nombreDisparador,
  }: {
    puedePromover: boolean;
    /**
     * El `name` del objeto de Storage que disparó este evento, cuando lo hay
     * (camino del TRIGGER). `undefined` en el camino del CLIENTE: para
     * cuando ese llama, `guardarFotos()` ya escribió todas las filas, así que
     * no hay ninguna foto "todavía sin fila" que unir. Ver
     * `unirFotoDisparadora()` en `vision.ts`.
     */
    nombreDisparador?: string;
  }
): Promise<ResultadoModeracion> {
  const fallo = (respuesta: Response): ResultadoModeracion => ({ respuesta, completa: false });

  const { data: fila, error: errFila } = await db
    .from('listings')
    .select('id, user_id, titulo, descripcion, estado')
    .eq('id', listingId)
    .maybeSingle();

  if (errFila) return fallo(error(errFila.message, 500));
  if (!fila) return fallo(error('no existe', 404));

  const estadoActual = fila.estado as EstadoListing;

  const { ejes, detalle, incompleta } = await evaluarListing(
    db,
    listingId,
    fila,
    config,
    nombreDisparador
  );

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
  //
  // COMPARE-AND-SET: `.eq('estado', estadoActual)`. La evaluación tarda
  // segundos (1.6-5.0 s medidos) entre leer `estadoActual` y escribir, y dos
  // evaluaciones que se cruzan (un reintento, dos eventos del trigger)
  // escribían sin condición: ganaba la última, y como GPT no es determinista,
  // una `bloqueada` podía quedar pisada por `activa`. Con el CAS, si alguien
  // movió el estado mientras tanto, este update afecta 0 filas y manda la
  // decisión que ya se escribió.
  let estadoFinal: EstadoListing = nuevoEstado;
  let descartadoPorCarrera = false;

  if (nuevoEstado !== estadoActual) {
    const { error: errUpdate, count } = await db
      .from('listings')
      .update({ estado: nuevoEstado }, { count: 'exact' })
      .eq('id', listingId)
      .eq('estado', estadoActual);

    if (errUpdate) return fallo(error(errUpdate.message, 500));

    if ((count ?? 0) === 0) {
      descartadoPorCarrera = true;
      const { data: vigente } = await db
        .from('listings')
        .select('estado')
        .eq('id', listingId)
        .maybeSingle();
      estadoFinal = (vigente?.estado as EstadoListing | undefined) ?? estadoActual;
      console.warn(
        `[moderar-contenido] ${listingId}: el estado cambió durante la evaluación ` +
          `(${estadoActual} → ${estadoFinal}); se descarta ${nuevoEstado}`
      );
    }
  }

  // La fila de auditoría se escribe SIEMPRE, incluso cuando el estado no se
  // movió: `listing_moderacion` es historial de EVALUACIONES, no de cambios
  // (migración 20260918000461). "Se revisó y salió limpia" es justo lo que un
  // revisor necesita saber de una publicación reincidente. Una evaluación
  // descartada por la carrera también se registra: se pagó, y su veredicto es
  // información para el revisor aunque no se haya aplicado.
  const { error: errAudit } = await db.from('listing_moderacion').insert({
    listing_id: listingId,
    veredicto: veredicto(ejes),
    estado_resultante: estadoFinal,
    detalle: {
      ...detalle,
      ejes,
      estado_anterior: estadoActual,
      ...(descartadoPorCarrera ? { descartado_por_carrera: true, estado_propuesto: nuevoEstado } : {}),
    },
  });

  // Un fallo de auditoría NO tumba la moderación: el veredicto ya se aplicó y
  // negarle la respuesta al cliente por no poder escribir el log sería perder
  // lo importante por lo accesorio. Mismo criterio que el log de contactos
  // (CLAUDE.md §3) — pero aquí sí se grita, porque nadie más lo va a notar.
  if (errAudit) console.error('[moderar-contenido] auditoría', errAudit.message);

  return {
    respuesta: Response.json({ ok: true, estado: estadoFinal }),
    completa: !incompleta,
  };
}

/**
 * Lo que devuelve `moderarListing()`: la respuesta HTTP y si la evaluación
 * quedó COMPLETA. Esto último solo lo usa el camino CLIENTE para decidir si su
 * reclamo se marca como permanente o se libera (ver `evaluacionIncompleta()`
 * en `decision.ts`). El camino del trigger lo ignora.
 */
type ResultadoModeracion = { respuesta: Response; completa: boolean };

const BUCKET_LISTING_PHOTOS: Bucket = 'listing-photos';
const BUCKET_AVATARS: Bucket = 'avatars';

/** Una foto ya bajada de Storage, lista para ir a Vision y a Rekognition. */
type FotoDescargada = { storagePath: string; tamano: number; bytes: Uint8Array };

/**
 * Tope de Rekognition para bytes CRUDOS pasados como parámetro: **5 MB**
 * (`docs.aws.amazon.com/rekognition/latest/dg/limits.html`). Ojo: son 5 MB
 * decimales, y el bucket corta en 5 MiB (5,242,880), o sea que una foto en el
 * límite del bucket SÍ puede pasarse de este tope. No se descarta en
 * silencio — cuenta como no evaluable, igual que en Vision.
 */
const MAX_BYTES_REKOGNITION = 5_000_000;

/**
 * Los cinco ejes de una publicación real — Vision, Rekognition y OpenAI en
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
  config: ConfigModeracion,
  /** Ver el docblock de `moderarListing()` y de `unirFotoDisparadora()`. */
  nombreDisparador?: string
): Promise<{ ejes: Ejes; detalle: Detalle; incompleta: boolean }> {
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

  const storagePathsBase: string[] = (fotos ?? []).map(
    (f: { storage_path: string }) => f.storage_path
  );

  // La unión con la foto que disparó el evento — ver `unirFotoDisparadora()`
  // en `vision.ts` para el porqué. En el camino del CLIENTE
  // (`nombreDisparador` undefined) esto es un no-op: devuelve
  // `storagePathsBase` tal cual.
  const storagePaths = unirFotoDisparadora(storagePathsBase, nombreDisparador);

  // LA FORMA DE LA CONCURRENCIA, que cambió al entrar Rekognition: la
  // descarga se hace UNA vez y sus bytes alimentan a los dos servicios de
  // imagen, que corren en paralelo entre sí y en paralelo con OpenAI.
  // Latencia = max(descarga + max(vision, rekognition), gpt) — nada
  // secuencial nuevo en el camino del cliente, que espera el veredicto.
  const [imagen, resultadoTexto] = await Promise.all([
    (async () => {
      const { descargadas, fallosDeDescarga } = await descargarFotos(
        db,
        storagePaths,
        BUCKET_LISTING_PHOTOS
      );
      return await Promise.all([
        evaluarFotos(config, descargadas, fallosDeDescarga),
        evaluarRekognition(config, descargadas, fallosDeDescarga),
      ]);
    })(),
    evaluarTexto(config, fila.titulo, fila.descripcion),
  ]);
  const [fotosResultado, rekognitionResultado] = imagen;
  const { resultados: resultadosFotos, lotesVision } = fotosResultado;

  const textoTecleado = `${fila.titulo} ${fila.descripcion ?? ''}`;
  const matchesTecleado = coincidencias(textoTecleado);
  const matchesOcr = coincidencias(textoOcrDe(resultadosFotos));

  const ejes: Ejes = {
    vision: ejeVision(resultadosFotos),
    gptTexto: resultadoTexto.ok ? nivelDeTexto(resultadoTexto.veredicto) : NO_EVALUADO,
    listaTecleada: nivelDeLista(matchesTecleado, 'tecleado'),
    listaOcr: nivelDeLista(matchesOcr, 'ocr'),
    rekognition: rekognitionResultado.nivel,
  };

  // `detalle` guarda POR QUÉ se marcó cada publicación — es la razón de ser de
  // `listing_moderacion` (migración 20260918000461). SafeSearch por foto CON
  // su `storage_path`, las palabras macheadas en texto tecleado y en OCR POR
  // SEPARADO, el veredicto de GPT por categoría, y CUÁL eje mandó.
  // Las etiquetas de Rekognition se indexan por ruta para poder colgarlas de
  // la MISMA entrada de foto que su `safe_search`. Un revisor que abre una
  // fila de auditoría quiere ver los dos ejes de esa foto juntos, no dos
  // listas que hay que cruzar a mano.
  const rekognitionPorRuta = new Map(
    rekognitionResultado.resultados.map((r) => [r.storagePath, r])
  );
  const rekognitionDe = (ruta: string) => {
    const r = rekognitionPorRuta.get(ruta);
    if (!r) return undefined;
    return r.estado === 'evaluada' ? r.etiquetas : { estado: r.estado, motivo: r.motivo };
  };

  const detalle: Detalle = {
    fotos: resultadosFotos.map((r) =>
      r.estado === 'evaluada'
        ? {
            storage_path: r.storagePath,
            estado: r.estado,
            safe_search: r.safeSearch,
            rekognition: rekognitionDe(r.storagePath),
          }
        : {
            storage_path: r.storagePath,
            estado: r.estado,
            motivo: r.motivo,
            rekognition: rekognitionDe(r.storagePath),
          }
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

  // Si algún eje se quedó sin evaluar, el `'revisar'` que ya dejó en `ejes` es
  // la falla segura de siempre; esto solo le dice al camino cliente que el
  // reclamo NO se cierra (ver `evaluacionIncompleta()` en `decision.ts`).
  const incompleta = evaluacionIncompleta({
    fotosNoEvaluables: resultadosFotos.filter((r) => r.estado === 'no_evaluable').length,
    rekognitionNoEvaluables: rekognitionResultado.resultados.filter(
      (r) => r.estado === 'no_evaluable'
    ).length,
    textoSinVeredicto: !resultadoTexto.ok,
  });

  return { ejes, detalle, incompleta };
}

/**
 * Descarga cada foto de Storage, las particiona con `particionar()` de
 * `vision.ts`, y manda un request por lote. Devuelve un `ResultadoFoto` por
 * cada `storagePath` de entrada —SIEMPRE, ninguna se pierde en el camino—,
 * más `lotesVision`: cuántos requests a Vision se hicieron de verdad.
 *
 * `bucket` es un parámetro, NO `BUCKET_LISTING_PHOTOS` fijo: `moderarAvatar()`
 * reusa esta misma función con `BUCKET_AVATARS`. Es el mismo argumento por el
 * que la lista de palabras prohibidas es una sola (CLAUDE.md §3,
 * `.claude/rules/moderacion.md` §8) — separar el pipeline de imagen en dos
 * copias, una por bucket, duplicaría exactamente lo que no debe
 * desincronizarse: el particionado, la forma del request a Vision, y cómo se
 * interpreta cada una de las tres formas de foto no evaluable.
 *
 * SIN FOTOS es un arreglo vacío, no un error: `ejeVision([])` ya lee eso como
 * `'limpio'` (`vision.ts`), y quien impide publicar sin fotos es el trigger
 * `listings_enforce_activation_has_photos`, no esta función. (Para el camino
 * de avatares esto no aplica: `moderarAvatar()` siempre manda exactamente una
 * ruta.)
 */
async function descargarFotos(
  // deno-lint-ignore no-explicit-any
  db: any,
  storagePaths: readonly string[],
  bucket: Bucket
): Promise<{ descargadas: FotoDescargada[]; fallosDeDescarga: ResultadoFoto[] }> {
  const descargadas: FotoDescargada[] = [];
  const fallosDeDescarga: ResultadoFoto[] = [];

  for (const storagePath of storagePaths) {
    try {
      const { data: blob, error: errDescarga } = await db.storage
        .from(bucket)
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

  return { descargadas, fallosDeDescarga };
}

/**
 * Vision sobre fotos YA DESCARGADAS.
 *
 * La descarga se extrajo a `descargarFotos()` porque Rekognition necesita
 * EXACTAMENTE los mismos bytes: bajarlos dos veces pagaría el doble de
 * latencia de Storage por nada. Es el único motivo del corte.
 */
async function evaluarFotos(
  config: ConfigModeracion,
  descargadas: readonly FotoDescargada[],
  fallosDeDescarga: readonly ResultadoFoto[]
): Promise<{ resultados: ResultadoFoto[]; lotesVision: number }> {
  if (descargadas.length === 0 && fallosDeDescarga.length === 0) {
    return { resultados: [], lotesVision: 0 };
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

/** El veredicto de Rekognition para UNA foto. */
type ResultadoRekognitionFoto =
  | { estado: 'evaluada'; storagePath: string; etiquetas: EtiquetaModeracion[]; nivel: Nivel }
  | { estado: 'no_evaluable'; storagePath: string; motivo: string };

/**
 * Amazon Rekognition sobre fotos ya descargadas — el QUINTO eje.
 *
 * **UNA LLAMADA POR FOTO, en paralelo.** `DetectModerationLabels` no batchea,
 * al revés de `images:annotate` de Vision, que acepta un arreglo. No es una
 * elección: es la forma del API.
 *
 * LOS TRES CAMINOS DE FALLA SEGURA, y ninguno propaga excepción — el eje
 * queda en `NO_EVALUADO` (`'revisar'`), nunca en `'limpio'`:
 *
 *  1. La llamada falla (red, throttling, credenciales, firma mal hecha).
 *  2. `InvalidImageFormatException`: Rekognition acepta **solo JPEG y PNG**, y
 *     el bucket permite además `webp`. Una webp no es un bug, es una foto que
 *     este eje no puede ver. Hoy no es alcanzable desde la app —`normalizar()`
 *     entrega siempre JPEG, y las 46 fotos reales del bucket son `.jpg`,
 *     medido— pero sí desde una subida directa al Storage API o desde Studio.
 *  3. `ImageTooLargeException`: el tope de bytes crudos es 5 MB decimales y el
 *     bucket corta en 5 MiB, así que hay una franja real donde una foto pasa
 *     el bucket y no pasa a Rekognition. Se detecta ANTES de gastar la
 *     llamada, con `MAX_BYTES_REKOGNITION`.
 */
async function evaluarRekognition(
  config: ConfigModeracion,
  descargadas: readonly FotoDescargada[],
  fallosDeDescarga: readonly ResultadoFoto[]
): Promise<{ resultados: ResultadoRekognitionFoto[]; nivel: Nivel }> {
  const deDescarga: ResultadoRekognitionFoto[] = fallosDeDescarga.map((f) => ({
    estado: 'no_evaluable',
    storagePath: f.storagePath,
    motivo: f.estado === 'no_evaluable' ? f.motivo : 'no se pudo descargar',
  }));

  const propios = await Promise.all(
    descargadas.map((foto) => llamarRekognition(config, foto))
  );

  const resultados = [...deDescarga, ...propios];

  return {
    resultados,
    nivel: ejeRekognition(
      resultados.map((r) => (r.estado === 'evaluada' ? r.nivel : NO_EVALUADO))
    ),
  };
}

/** Una foto, una llamada firmada con SigV4. */
async function llamarRekognition(
  config: ConfigModeracion,
  foto: FotoDescargada
): Promise<ResultadoRekognitionFoto> {
  if (foto.tamano > MAX_BYTES_REKOGNITION) {
    return {
      estado: 'no_evaluable',
      storagePath: foto.storagePath,
      motivo: `excede el tope de Rekognition por imagen (${MAX_BYTES_REKOGNITION} bytes)`,
    };
  }

  try {
    const host = hostRekognition(config.awsRegion);
    const cuerpo = cuerpoRekognition(encodeBase64(foto.bytes));

    const firma = await firmarSigV4({
      metodo: 'POST',
      host,
      ruta: '/',
      query: '',
      headers: {
        'Content-Type': CONTENT_TYPE_AWS_JSON,
        'X-Amz-Target': TARGET_DETECT_MODERATION,
      },
      cuerpo,
      region: config.awsRegion,
      servicio: SERVICIO_AWS,
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey,
      amzDate: amzDateDe(new Date()),
    });

    const res = await fetch(`https://${host}/`, {
      method: 'POST',
      headers: {
        'Content-Type': CONTENT_TYPE_AWS_JSON,
        'X-Amz-Target': TARGET_DETECT_MODERATION,
        'X-Amz-Date': firma.amzDate,
        Authorization: firma.authorization,
      },
      body: cuerpo,
    });

    const json = await res.json().catch(() => null);
    const parseado = parsearRespuestaRekognition(json);

    if (!parseado.ok) {
      console.error(
        '[moderar-contenido] rekognition',
        res.status,
        parseado.motivo,
        parseado.detalle
      );
      return {
        estado: 'no_evaluable',
        storagePath: foto.storagePath,
        motivo: `${parseado.motivo}${parseado.detalle ? `: ${parseado.detalle}` : ''}`,
      };
    }

    return {
      estado: 'evaluada',
      storagePath: foto.storagePath,
      // A la AUDITORÍA van también las de la banda 50-70, que no mueven nada
      // — ver `etiquetasParaAuditoria()` en `decision.ts`.
      etiquetas: etiquetasParaAuditoria(parseado.etiquetas),
      nivel: nivelDeRekognition(parseado.etiquetas),
    };
  } catch (e) {
    console.error('[moderar-contenido] rekognition', e instanceof Error ? e.message : e);
    return {
      estado: 'no_evaluable',
      storagePath: foto.storagePath,
      motivo: `excepción: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
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
 * Cuál de los cinco ejes es el que decide el veredicto — solo para el
 * `detalle` de auditoría, NO participa en `decidirListing()`.
 *
 * En caso de empate manda el PRIMERO en este orden fijo (`vision` primero),
 * que es una decisión de REPORTE y no de lógica: `veredicto()` usa `peor()`,
 * que es conmutativo, así que el resultado de `decidirListing` es idéntico
 * sin importar cuál de los empatados se reporte aquí.
 */
function ejeQueManda(ejes: Ejes): keyof Ejes {
  // `veredicto(ejes)` y no `peor(...)` con la lista repetida a mano: eran dos
  // copias de la misma enumeración de ejes, y agregar el quinto obligaba a
  // tocar las dos. Desincronizarlas no da ningún error — solo hace que el eje
  // reportado en la auditoría no sea el que de verdad mandó.
  const max = veredicto(ejes);
  const orden: (keyof Ejes)[] = [
    'vision',
    'gptTexto',
    'listaTecleada',
    'listaOcr',
    'rekognition',
  ];
  return orden.find((k) => ejes[k] === max) ?? 'vision';
}

// ---------------------------------------------------------------------------
// Avatares
// ---------------------------------------------------------------------------

/**
 * El camino de avatares (Ola 1.6). Mismo pipeline de imagen que una foto de
 * publicación — descarga, particiona, Vision — vía `evaluarFotos(...,
 * BUCKET_AVATARS)`: es el mismo argumento por el que la lista de palabras
 * prohibidas es una sola (CLAUDE.md §3, `.claude/rules/moderacion.md` §8).
 *
 * SIN TEXTO. Un avatar no tiene título ni descripción, así que no hay eje
 * `gptTexto` ni `listaTecleada` — `decidirAvatar()` solo toma `vision` y
 * `listaOcr`, y ni siquiera se llama a OpenAI.
 *
 * LA FALLA SEGURA ES LA CONTRARIA a la de las publicaciones, y no es una
 * inconsistencia: `decidirAvatar()` solo borra con `bloquear`, así que un eje
 * en `'revisar'` —incluido "no se pudo evaluar", que es como `ejeVision()`
 * trata una foto `no_evaluable`— da `'conservar'`. Es la decisión de producto
 * de CLAUDE.md §3 aplicada tal cual, y sale gratis de reusar las mismas
 * piezas: no hace falta cablear ningún caso especial para fotos que no se
 * pudieron bajar o evaluar, la asimetría ya vive en `decision.ts`.
 *
 * SIN AUDITORÍA: `listing_moderacion` no tiene `listing_id` que ponerle a un
 * avatar, y el enforcement es inmediato —borrar o no hacer nada, sin cola que
 * revisar—. El rastro es el `console.error`/`console.warn`, no una fila
 * (`.claude/rules/moderacion.md` §7).
 */
async function moderarAvatar(
  // deno-lint-ignore no-explicit-any
  db: any,
  config: ConfigModeracion,
  entityId: string,
  name: string
): Promise<Response> {
  // SIN REKOGNITION, a propósito: drogas/alcohol/gambling es una señal de
  // CATÁLOGO, no de foto de perfil, y `decidirAvatar()` borra de forma
  // irreversible — un falso positivo aquí no tiene cola donde caer. Por eso
  // `decidirAvatar()` sigue tomando solo `vision` y `listaOcr`.
  const { descargadas, fallosDeDescarga } = await descargarFotos(db, [name], BUCKET_AVATARS);
  const { resultados } = await evaluarFotos(config, descargadas, fallosDeDescarga);

  const ejes: Pick<Ejes, 'vision' | 'listaOcr'> = {
    vision: ejeVision(resultados),
    listaOcr: nivelDeLista(coincidencias(textoOcrDe(resultados)), 'ocr'),
  };

  const accion = decidirAvatar(ejes);

  if (accion === 'conservar') {
    return Response.json({ ok: true, accion });
  }

  // BORRAR EL OBJETO, SIEMPRE — no lleva el guard de la carrera, y esto es a
  // propósito, no un descuido: cada subida de avatar estrena uuid
  // (`storage.ts`, `rutaAvatar()`), así que este objeto NUNCA es el avatar
  // vigente si `foto_url` ya cambió — el cliente ya intentó borrarlo
  // (`borrarAvatar()`, best-effort) al escribir el nuevo. Borrarlo aquí,
  // tarde, no daña nada: es la misma limpieza, solo que de un veredicto que
  // llegó después de que el usuario cambió de foto.
  //
  // MISMO GOTCHA QUE `borrarAvatar()` DEL CLIENTE (CLAUDE.md §9): `remove()`
  // no falla — devuelve 200 con un array VACÍO si el invocante no ve el
  // objeto, sin tocarlo. Con `ctx.supabaseAdmin` (bypassa RLS) esto no
  // debería pasar nunca; si pasa, es señal de algo raro y se grita, no se
  // asume éxito por el solo hecho de no haber `error`.
  const { data: borrados, error: errBorrado } = await db.storage
    .from(BUCKET_AVATARS)
    .remove([name]);

  if (errBorrado) {
    console.error(`[moderar-contenido] no se pudo borrar el avatar ${name}:`, errBorrado.message);
  } else if (!borrados || borrados.length === 0) {
    console.error(
      `[moderar-contenido] remove() de ${name} devolvió 200 con lista vacía — el objeto sigue en el bucket`
    );
  }

  // EL GUARD DE LA CARRERA, y este sí es obligatorio. Solo nulifica
  // `foto_url` SI SIGUE apuntando al objeto que se acaba de moderar: entre
  // que el trigger disparó y esta función corrió, el usuario pudo haber
  // subido un avatar NUEVO (otro uuid). Sin el `.eq('foto_url', name)`, el
  // veredicto tardío del avatar VIEJO le borraría la foto al avatar NUEVO
  // —posiblemente limpio— dejándolo sin foto por un error ajeno.
  // `.select('id')` es lo que permite distinguir "el guard bloqueó el
  // update" de "el update aplicó de verdad": un UPDATE cuyo `where` no
  // matchea ninguna fila no lanza (mismo gotcha de `listings_update_own`,
  // CLAUDE.md §3) — devuelve un array vacío, no un error.
  const { data: actualizado, error: errUpdate } = await db
    .from('users')
    .update({ foto_url: null })
    .eq('id', entityId)
    .eq('foto_url', name)
    .select('id');

  if (errUpdate) {
    console.error(
      `[moderar-contenido] no se pudo nulificar foto_url de ${entityId}:`,
      errUpdate.message
    );
  }

  const fotoUrlNulificado = !errUpdate && !!actualizado && actualizado.length > 0;
  if (!errUpdate && !fotoUrlNulificado) {
    console.warn(
      `[moderar-contenido] avatar bloqueado (${name}) pero foto_url de ${entityId} ya apuntaba a otro — el guard de la carrera lo dejó intacto`
    );
  }

  return Response.json({ ok: true, accion, foto_url_nulificado: fotoUrlNulificado });
}
