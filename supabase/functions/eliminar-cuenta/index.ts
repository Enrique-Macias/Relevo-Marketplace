/**
 * eliminar-cuenta — borra la cuenta de QUIEN LLAMA (Apple 5.1.1(v), Google Play).
 *
 * QUIÉN: sale SOLO del JWT verificado (`ctx.userClaims.id`). El body se ignora
 * entero, así que no hay forma de pedir el borrado de otra cuenta: no existe
 * el parámetro. `.id` y NO `.sub` — `userClaims` es el usuario ya normalizado
 * por `@supabase/server`; el `sub` vive en `ctx.jwtClaims` (CLAUDE.md §9).
 *
 * CONTRASEÑA: exige que el token venga de un `signInWithPassword` de hace
 * menos de 5 minutos, leyendo `amr` (no `iat`, que un refresh renueva solo).
 * El porqué y la medición, en `reautenticacion.ts`. La contraseña nunca viaja
 * aquí ni se loguea.
 *
 * QUÉ BORRA, EN ESTE ORDEN:
 *   1. Los objetos de Storage: `avatars/{uid}/` y `listing-photos/{id}/` de
 *      cada publicación suya. `storage.objects` no tiene FK hacia nada, así que
 *      ninguna cascada los alcanza. Van PRIMERO porque las carpetas de fotos se
 *      enumeran desde `listings`, que el paso 2 borra.
 *   2. `auth.admin.deleteUser(uid)`. Las cascadas y los triggers de
 *      20260929000474 hacen el resto en la base: publicaciones, favoritos,
 *      avisos, push tokens; reseñas escritas y reportes anonimizados.
 *
 * IDEMPOTENTE: un corte a la mitad deja un estado desde el que la misma
 * llamada termina. Storage se vuelve a listar (lo ya borrado no aparece) y un
 * `deleteUser` sobre una cuenta que ya no existe cuenta como hecho.
 *
 * AUTORIZACIÓN: `verify_jwt = false` en config.toml por el mismo motivo que
 * `moderar-contenido`; quien autoriza es `withSupabase({ auth: 'user' })`, que
 * verifica el JWT contra JWKS. Import PINEADO a 1.7.0, igual que allá.
 */

import { withSupabase } from 'npm:@supabase/server@1.7.0';

import { reautenticacionReciente } from './reautenticacion.ts';

const error = (mensaje: string, status: number) =>
  Response.json({ error: mensaje }, { status });

/** Tamaño de página de `list()`. */
const PAGINA = 100;

/**
 * Vacía una carpeta de un bucket. Cuenta lo que `remove()` DICE que borró, no
 * su `error`: con la RLS equivocada `remove()` responde 200 con `[]` y
 * `error: null` (CLAUDE.md §9). Aquí corre con la secret key, que salta la RLS,
 * pero la comprobación es barata y convierte un huérfano silencioso en un 500
 * que el cliente reintenta.
 */
async function vaciarCarpeta(
  db: any,
  bucket: string,
  carpeta: string,
): Promise<{ n: number; error?: string }> {
  let n = 0;
  // Sin offset: cada vuelta borra la página que acaba de listar, así que la
  // siguiente lista empieza otra vez desde el principio.
  for (;;) {
    const { data, error: errList } = await db.storage.from(bucket).list(carpeta, { limit: PAGINA });
    if (errList) return { n, error: `list ${bucket}/${carpeta}: ${errList.message}` };

    // `id === null` es una "carpeta" virtual, no un objeto. Las rutas de este
    // proyecto son planas (`{carpeta}/{uuid}.jpg`), así que no debería haber.
    const rutas = (data ?? [])
      .filter((o: { id: string | null }) => o.id !== null)
      .map((o: { name: string }) => `${carpeta}/${o.name}`);
    if (rutas.length === 0) return { n };

    const { data: borrados, error: errRemove } = await db.storage.from(bucket).remove(rutas);
    if (errRemove) return { n, error: `remove ${bucket}/${carpeta}: ${errRemove.message}` };
    if ((borrados?.length ?? 0) !== rutas.length) {
      return { n, error: `remove ${bucket}/${carpeta}: pidió ${rutas.length}, borró ${borrados?.length ?? 0}` };
    }
    n += rutas.length;
  }
}

/** `deleteUser` sobre una cuenta que ya no existe: el trabajo ya estaba hecho. */
const esNoEncontrado = (e: { status?: number; code?: string }) =>
  e.status === 404 || e.code === 'user_not_found';

export default {
  fetch: withSupabase({ auth: 'user' }, async (req: Request, ctx) => {
    if (req.method !== 'POST') return error('método no permitido', 405);

    const uid: string | undefined = ctx.userClaims?.id;
    if (!uid) return error('sin identidad en el JWT', 401);

    if (!reautenticacionReciente(ctx.jwtClaims?.amr, Math.floor(Date.now() / 1000))) {
      return error('reautenticacion_requerida', 401);
    }

    const db = ctx.supabaseAdmin;

    // 1. Storage.
    const { data: listings, error: errListings } = await db
      .from('listings')
      .select('id')
      .eq('user_id', uid);
    if (errListings) return error(errListings.message, 500);

    const carpetas: [string, string][] = [
      ['avatars', uid],
      ...(listings ?? []).map((l: { id: number }): [string, string] => ['listing-photos', String(l.id)]),
    ];

    let objetos = 0;
    for (const [bucket, carpeta] of carpetas) {
      const r = await vaciarCarpeta(db, bucket, carpeta);
      objetos += r.n;
      if (r.error) {
        console.error(`[eliminar-cuenta] ${uid}: ${r.error}`);
        return error('no se pudieron borrar los archivos; reintenta', 500);
      }
    }

    // 2. La cuenta. Las cascadas hacen el resto.
    const { error: errBorrar } = await db.auth.admin.deleteUser(uid);
    if (errBorrar && !esNoEncontrado(errBorrar)) {
      console.error(`[eliminar-cuenta] ${uid}: deleteUser: ${errBorrar.message}`);
      return error('no se pudo borrar la cuenta; reintenta', 500);
    }

    console.log(
      `[eliminar-cuenta] ${uid}: ${objetos} objeto(s) de Storage, ${carpetas.length} carpeta(s)` +
        (errBorrar ? ', la cuenta ya no existía' : ''),
    );
    return Response.json({ ok: true });
  }),
};
