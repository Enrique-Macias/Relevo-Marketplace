/**
 * Traducción del rechazo de una Edge Function del panel (hoy solo
 * `admin-reset-mfa`, RF-17 Ola 3b) a la forma `{ code, message }` de un error
 * de PostgREST, para que pase por `useLlamar`: así un `totp_vencido` que la
 * función reenvía desde `exigir_admin()` abre el modal de TOTP y reintenta,
 * igual que con cualquier RPC.
 *
 * Módulo PURO, sin imports, para que `scripts/probe-admin-reset-mfa.mjs` lo
 * importe tal cual y lo amarre contra los cuerpos REALES que devuelve la
 * función.
 */

export interface RechazoFuncion {
  code: string;
  message: string;
  /** Solo en los 502 de un restablecimiento a medias: el intento a reanudar. */
  accion_id?: number;
}

/**
 * `status` es el HTTP de la respuesta (0 si ni siquiera hubo respuesta);
 * `cuerpo`, su JSON (o null). Un cuerpo sin `message` (un 401 de
 * `withSupabase`, una caída de red) queda como `http_<status>`, que
 * `textoDeRechazo` pinta con el texto genérico.
 */
export function rechazoDeFuncion(status: number, cuerpo: unknown): RechazoFuncion {
  const c = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as Record<string, unknown>;
  if (typeof c.message !== 'string' || c.message === '') {
    return { code: String(status), message: `http_${status}` };
  }
  const r: RechazoFuncion = {
    code: typeof c.code === 'string' && c.code !== '' ? c.code : String(status),
    message: c.message,
  };
  if (typeof c.accion_id === 'number' && Number.isSafeInteger(c.accion_id) && c.accion_id > 0) {
    r.accion_id = c.accion_id;
  }
  return r;
}
