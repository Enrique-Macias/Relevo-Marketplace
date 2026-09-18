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
 * ESTADO: ESQUELETO. El ruteo, la autorización y la escritura del resultado
 * están completos; la EVALUACIÓN todavía no llama a Vision ni a OpenAI (Olas
 * 1.3 y 1.4 del plan). Mientras tanto los ejes se reportan como no evaluables,
 * o sea `'revisar'`, que es la misma falla segura que aplica cuando una API
 * externa se cae — no un valor de relleno. La consecuencia es que hoy esta
 * función manda todo a `pendiente` y no promueve nada: inútil, pero nunca
 * peligrosa.
 */

import { withSupabase } from 'npm:@supabase/server@1.7.0';

import { resolverConfig } from './env.ts';
import {
  decidirAvatar,
  decidirListing,
  esPromocion,
  veredicto,
  type Ejes,
  type EstadoListing,
  type Nivel,
} from './decision.ts';

/**
 * A NIVEL DE MÓDULO, no dentro del handler, y no es estilo: el docblock de
 * `resolverConfig()` promete fallar "al ARRANCAR la función, no a media
 * petición". Moverlo adentro del `fetch` rompe esa promesa — la función
 * arrancaría bien, serviría requests, y reventaría a mitad de moderar una
 * publicación real.
 *
 * SIN BINDING a propósito, y no por descuido: mientras `evaluarListing()` y
 * `moderarAvatar()` sean stubs (Olas 1.3/1.4 todavía no llaman a Vision ni a
 * OpenAI), nada consume el valor — solo importa el efecto de fail-fast. Un
 * `const config = ` sin uso lo marca `@typescript-eslint/no-unused-vars`
 * (encontrado corriendo `npx eslint` directo sobre esta carpeta, que
 * `npm run lint` no cubría hasta ahora — ver CLAUDE.md §9). Cuando esas dos
 * funciones empiecen a llamar a las APIs reales, van a necesitar
 * `googleCloudVisionApiKey`/`openaiApiKey`, y ahí vuelve el binding, esta vez
 * consumido de verdad.
 */
resolverConfig();

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
 * Es la falla segura de `.claude/rules/moderacion.md` §6, y está escrita como
 * constante para que la use tanto el esqueleto de hoy como los `catch` de
 * Vision y OpenAI mañana: un eje que no se pudo evaluar hace que `peor()` dé al
 * menos `revisar`, sin que la función de decisión se entere de que hubo fallo.
 */
const NO_EVALUADO: Nivel = 'revisar';

const SIN_EVALUAR: Ejes = {
  vision: NO_EVALUADO,
  gptTexto: NO_EVALUADO,
  listaTecleada: NO_EVALUADO,
  listaOcr: NO_EVALUADO,
};

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
          return await moderarListing(db, Number(entity_id), { puedePromover: false });
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

      return await moderarListing(db, listing_id, { puedePromover: true });
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

  const { ejes, detalle } = await evaluarListing(db, listingId, fila);

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

/**
 * TODAVÍA NO EVALÚA NADA — Olas 1.3 (Vision) y 1.4 (OpenAI).
 *
 * Devuelve los cuatro ejes como no evaluables, que es `'revisar'`: la misma
 * falla segura que aplicará cuando Vision u OpenAI se caigan. O sea que el
 * esqueleto manda todo a `pendiente` y no promueve nada. Es inútil y es
 * seguro, en ese orden — un stub que devolviera `'limpio'` publicaría sin
 * mirar.
 */
async function evaluarListing(
  // deno-lint-ignore no-explicit-any
  _db: any,
  listingId: number,
  _fila: { titulo: string; descripcion: string | null }
): Promise<{ ejes: Ejes; detalle: Detalle }> {
  console.warn(
    `[moderar-contenido] evaluación no implementada; ${listingId} va a pendiente por falla segura`
  );
  return { ejes: SIN_EVALUAR, detalle: { sin_implementar: true } };
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
