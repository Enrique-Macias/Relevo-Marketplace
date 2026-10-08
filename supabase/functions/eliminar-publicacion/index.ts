/**
 * eliminar-publicacion — elimina UNA publicación de quien llama y sus fotos
 * (RF-17 Ola 4, D5 = (a)). La app la usa para TODO borrado de publicación.
 *
 * POR QUÉ EXISTE. Desde 20261007000481 el dueño de una `bloqueada` ya no ve
 * los objetos de su carpeta, y `remove()` de Storage resuelve primero lo que el
 * invocante VE: con el cliente del usuario respondería `200 []` y dejaría los
 * objetos huérfanos en silencio (CLAUDE.md §9). LEGAL_FACTS §11-12 dice que al
 * eliminar una publicación sus fotos se borran físicamente. Así que el borrado
 * físico lo hace esta función con la secret key, y para TODAS las publicaciones
 * (no solo las bloqueadas): el estado que tiene la app puede estar desactualizado
 * (la bloquearon con la pantalla abierta).
 *
 * QUIÉN PUEDE BORRAR LO DECIDE LA BASE, no esta función. El paso 1 es un
 * DELETE con el JWT del usuario (`ctx.supabase`), así que manda
 * `listings_delete_own`: dueño + `is_active_user()`. Aquí no hay ni un `if`
 * de autorización (CLAUDE.md §0 regla 7).
 *
 * EN ESTE ORDEN (al revés que `eliminar-cuenta`, a propósito):
 *   1. DELETE de la fila con el JWT del usuario, `count: 'exact'`.
 *      · 1 fila → sigue. (Si era `bloqueada`, el trigger de 20261007000482
 *        guarda su registro mínimo de moderación antes de que se vaya.)
 *      · 0 filas → ¿la fila existe? (con la secret key). Si existe, la base la
 *        rechazó: 403 `no_borrable`, SIN tocar Storage. Si no existe, sigue:
 *        es un reintento, o la limpieza de una carpeta huérfana.
 *   2. Vacía `listing-photos/{id}/` con la secret key.
 *   Borrar la fila primero no rompe nada aquí: la carpeta se conoce por el id
 *   (no se enumera desde `listings`, como en eliminar-cuenta), y la secret key
 *   no pasa por RLS.
 *
 * IDEMPOTENTE, Y POR QUÉ ES SEGURO QUE CUALQUIERA LIMPIE UNA CARPETA SIN FILA:
 * la fila de `listings` se crea ANTES de subir fotos (publicar.ts) y la policy
 * de subida exige que exista; los ids son identity y no se reutilizan. Una
 * carpeta `{id}/` sin fila nunca es de nadie: es basura de un borrado anterior.
 *
 * SI STORAGE FALLA DESPUÉS DE BORRAR LA FILA: la publicación YA no existe, así
 * que la respuesta es 200 `{ ok: true, huerfanos: true }` (la app dice
 * "Publicación eliminada", que es cierto) y el id queda en el log para el
 * barrido semanal (docs/admin-runbook.md §7). Un 500 queda solo para fallos
 * ANTES de borrar la fila, donde "No pudimos eliminar" sí es cierto.
 *
 * AUTORIZACIÓN: `verify_jwt = false` en config.toml, como sus hermanas; quien
 * autoriza es `withSupabase({ auth: 'user' })` (JWKS). Import PINEADO a 1.7.0.
 */

import { withSupabase } from 'npm:@supabase/server@1.7.0';

const error = (mensaje: string, status: number) =>
  Response.json({ error: mensaje }, { status });

const BUCKET = 'listing-photos';

/** Tamaño de página de `list()`. */
const PAGINA = 100;

/**
 * Vacía una carpeta del bucket. COPIA de `vaciarCarpeta` de
 * `eliminar-cuenta/index.ts:49-75`, y no un módulo compartido, para no tocar ni
 * redesplegar aquella función en esta ola. Cuenta lo que `remove()` DICE que
 * borró, no su `error` (CLAUDE.md §9).
 */
// deno-lint-ignore no-explicit-any
async function vaciarCarpeta(db: any, carpeta: string): Promise<{ n: number; error?: string }> {
  let n = 0;
  for (;;) {
    const { data, error: errList } = await db.storage.from(BUCKET).list(carpeta, { limit: PAGINA });
    if (errList) return { n, error: `list ${BUCKET}/${carpeta}: ${errList.message}` };

    const rutas = (data ?? [])
      .filter((o: { id: string | null }) => o.id !== null)
      .map((o: { name: string }) => `${carpeta}/${o.name}`);
    if (rutas.length === 0) return { n };

    const { data: borrados, error: errRemove } = await db.storage.from(BUCKET).remove(rutas);
    if (errRemove) return { n, error: `remove ${BUCKET}/${carpeta}: ${errRemove.message}` };
    if ((borrados?.length ?? 0) !== rutas.length) {
      return { n, error: `remove ${BUCKET}/${carpeta}: pidió ${rutas.length}, borró ${borrados?.length ?? 0}` };
    }
    n += rutas.length;
  }
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req: Request, ctx) => {
    if (req.method !== 'POST') return error('método no permitido', 405);

    const uid: string | undefined = ctx.userClaims?.id;
    if (!uid) return error('sin identidad en el JWT', 401);

    const body = await req.json().catch(() => null);
    const id = body?.listing_id;
    if (!Number.isSafeInteger(id) || id <= 0) return error('listing_id inválido', 400);

    // 1. La fila, con el JWT del usuario: la base decide.
    const { error: errBorrar, count } = await ctx.supabase
      .from('listings')
      .delete({ count: 'exact' })
      .eq('id', id);
    if (errBorrar) {
      console.error(`[eliminar-publicacion] ${uid} ${id}: delete: ${errBorrar.message}`);
      return error('no se pudo eliminar la publicación; reintenta', 500);
    }

    const db = ctx.supabaseAdmin;
    const filaBorrada = (count ?? 0) > 0;
    if (!filaBorrada) {
      const { data: existe, error: errExiste } = await db
        .from('listings')
        .select('id')
        .eq('id', id)
        .maybeSingle();
      if (errExiste) {
        console.error(`[eliminar-publicacion] ${uid} ${id}: existe: ${errExiste.message}`);
        return error('no se pudo eliminar la publicación; reintenta', 500);
      }
      // Si no existe, sigue: un reintento, o la limpieza de una carpeta huérfana.
      if (existe) return error('no_borrable', 403);
    }

    // 2. Los objetos, con la secret key.
    const r = await vaciarCarpeta(db, String(id));
    if (r.error) {
      console.error(`[eliminar-publicacion] huérfanos listing-photos/${id}/ (dueño ${uid}): ${r.error}`);
      return Response.json({ ok: true, huerfanos: true });
    }

    console.log(
      `[eliminar-publicacion] ${uid} ${id}: ${filaBorrada ? 'fila borrada' : 'la fila ya no existía'}, ` +
        `${r.n} objeto(s) de Storage`,
    );
    return Response.json({ ok: true });
  }),
};
