/**
 * admin-reset-mfa — restablece la app autenticadora (factores TOTP) de OTRO
 * admin del panel (RF-17, Ola 3b).
 *
 * ESTA FUNCIÓN NO DECIDE NADA. Toda la autorización, las guardas y la
 * auditoría viven en dos RPC de la base (20261008000483), que se llaman con el
 * JWT del ejecutor (`ctx.supabase`), así que `private.exigir_admin()` —la misma
 * definición que `is_admin()`: activado + aal2 + TOTP de ≤12 h— es quien
 * autoriza. Lo ÚNICO que hace aquí la secret key es borrar factores en Auth,
 * que no tiene otra vía: la secret key nunca llega al navegador.
 *
 * EN ESTE ORDEN (fail-closed):
 *   1. `admin.restablecer_mfa_iniciar(user_id, motivo, intento_pendiente)`:
 *      en una transacción desactiva al objetivo y escribe el inicio, o reanuda
 *      / cierra un intento pendiente. Devuelve los ids de los TOTP VIEJOS
 *      (`factor_type = 'totp'`, verified o unverified, creados hasta el
 *      inicio). Cualquier rechazo se reenvía tal cual y no cambió nada.
 *   2. `auth.admin.mfa.deleteFactor` de cada id. Medido (B0, GoTrue local): un
 *      factor que ya no existe responde 404 `mfa_factor_not_found`, que aquí
 *      cuenta como hecho (otro ejecutor llegó antes). Otro error → 502
 *      `factores_pendientes` (S1): el objetivo ya no tiene acceso y el
 *      reintento reanuda el MISMO intento.
 *   3. `admin.restablecer_mfa_completar(accion_id)`: la base verifica que no
 *      queda ningún TOTP viejo y escribe el cierre. Si falla → 502
 *      `cierre_pendiente` (S2): el reintento cierra ese intento y termina.
 * WebAuthn, phone y un TOTP posterior al inicio nunca están en la lista.
 *
 * AUTORIZACIÓN DE TRANSPORTE: `verify_jwt = false` en config.toml, como sus
 * hermanas; `withSupabase({ auth: 'user' })` verifica el JWT (JWKS). Import
 * PINEADO a 1.7.0.
 */

import { withSupabase } from 'npm:@supabase/server@1.7.0';

/**
 * El mismo cuerpo que un error de PostgREST (`code`, `message`): el panel lo
 * pasa por `useLlamar`. En los 502 va también `accion_id`, para que el
 * reintento desde el modal mande `intento_pendiente` (protege de que un
 * reintento concurrente, ya cerrado por otro admin, abra un intento nuevo).
 */
const rechazo = (status: number, code: string, message: string, accionId?: number) =>
  Response.json(accionId === undefined ? { code, message } : { code, message, accion_id: accionId }, { status });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** HTTP de un rechazo de las RPC, por SQLSTATE. */
function statusDe(code: string | undefined): number {
  if (code === '42501') return 403;
  if (code === '22023') return 400;
  if (code === 'P0002') return 404;
  if (code === '55000') return 409;
  return 500;
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (req: Request, ctx) => {
    if (req.method !== 'POST') return rechazo(405, 'metodo', 'método no permitido');

    const uid: string | undefined = ctx.userClaims?.id;
    if (!uid) return rechazo(401, 'sin_identidad', 'sin identidad en el JWT');

    const body = await req.json().catch(() => null);
    const userId = body?.user_id;
    const motivo = body?.motivo;
    const pendiente = body?.intento_pendiente ?? null;
    if (typeof userId !== 'string' || !UUID.test(userId) || typeof motivo !== 'string'
        || (pendiente !== null && (!Number.isSafeInteger(pendiente) || pendiente <= 0))) {
      return rechazo(400, 'solicitud_invalida', 'solicitud_invalida');
    }

    // 1. La base decide (y desactiva) con el JWT del ejecutor.
    const ini = await ctx.supabase.schema('admin').rpc('restablecer_mfa_iniciar', {
      p_user_id: userId, p_motivo: motivo, p_intento_pendiente: pendiente,
    });
    if (ini.error) {
      const code = ini.error.code as string | undefined;
      if (statusDe(code) === 500) {
        console.error(`[admin-reset-mfa] ${uid} → ${userId}: iniciar: ${ini.error.message}`);
        return rechazo(500, 'error_interno', 'error_interno');
      }
      return rechazo(statusDe(code), code ?? '', ini.error.message);
    }
    const r = ini.data as { estado: string; accion_id: number; factores: string[]; desactivado: boolean };
    if (r.estado === 'ya_completado' || r.estado === 'cierre_recuperado') {
      console.log(`[admin-reset-mfa] ${uid} → ${userId}: intento ${r.accion_id} ${r.estado}`);
      return Response.json({ ok: true, estado: r.estado, desactivado: false });
    }

    // 2. Auth, con la secret key: solo los ids que dio la base.
    const db = ctx.supabaseAdmin;
    for (const id of r.factores) {
      const { error } = await db.auth.admin.mfa.deleteFactor({ id, userId });
      if (error && !(error.status === 404 && error.code === 'mfa_factor_not_found')) {
        console.error(`[admin-reset-mfa] ${uid} → ${userId}: intento ${r.accion_id}: deleteFactor ${id}: ` +
          `${error.status} ${error.code ?? ''} ${error.message}`);
        return rechazo(502, 'parcial', 'factores_pendientes', r.accion_id);
      }
    }

    // 3. La base verifica y cierra.
    const fin = await ctx.supabase.schema('admin').rpc('restablecer_mfa_completar', {
      p_accion_id: r.accion_id,
    });
    if (fin.error) {
      console.error(`[admin-reset-mfa] ${uid} → ${userId}: intento ${r.accion_id}: completar: ` +
        `${fin.error.code ?? ''} ${fin.error.message}`);
      if (fin.error.message === 'factores_pendientes') return rechazo(502, 'parcial', 'factores_pendientes', r.accion_id);
      return rechazo(502, 'parcial', 'cierre_pendiente', r.accion_id);
    }

    console.log(`[admin-reset-mfa] ${uid} → ${userId}: intento ${r.accion_id} ${r.estado}, ` +
      `${r.factores.length} factor(es) TOTP borrados en esta pasada`);
    return Response.json({ ok: true, estado: r.estado, desactivado: r.desactivado });
  }),
};
