/**
 * ¿Este error de `supabase.auth.getUser()` dice que la cuenta de esta sesión YA
 * NO EXISTE en el servidor? (AUTH-2, estado D.)
 *
 * Es la ÚNICA condición con la que la app cierra sesión por su cuenta: una
 * sesión local que sobrevive al borrado de su cuenta (el access token sigue
 * verificando por firma hasta su `exp`, CLAUDE.md §9) haría que la cuenta
 * borrada se viera como "perfil incompleto". Por eso es deliberadamente
 * estrecha, y solo acepta lo MEDIDO contra GoTrue v2.197.0 local
 * (`scripts/probe-sesion-huerfana.mjs`):
 *
 *   - `AuthApiError` con `code === 'user_not_found'`: el 403 "User from sub
 *     claim in JWT does not exist" de `GET /user` tras borrar la cuenta.
 *   - `AuthSessionMissingError`: auth-js traduce así el `session_not_found` de
 *     GoTrue (`auth-js/dist/main/lib/fetch.js`), una sesión revocada o borrada.
 *
 * NO cuentan, a propósito: cualquier otro 401/403 (p. ej. `bad_jwt`), los 5xx
 * ni `AuthRetryableFetchError` (sin red). Cerrar sesión por un fallo de red
 * echaría a un usuario válido; esos casos son "error al leer el perfil".
 *
 * Sin imports a propósito: el probe la carga desde Node y la compara contra el
 * error REAL que devuelve auth-js, como `src/lib/registro.ts` con su probe.
 * Se identifica por `name`/`code` y no con `instanceof` para no importar
 * auth-js aquí.
 */
export function esCuentaInexistente(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  if (name === 'AuthSessionMissingError') return true;
  return name === 'AuthApiError' && code === 'user_not_found';
}
