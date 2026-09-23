/**
 * El rechazo de registro por dominio no participante, del lado del cliente.
 *
 * El candado vive en el servidor: el Auth Hook "Before User Created"
 * (`public.hook_before_user_created`, migración 20260923000465) rechaza el alta
 * si el dominio del correo no está en `public.universidad_dominios`. Este
 * módulo solo RECONOCE ese rechazo para traducirlo a copy. No valida nada: no
 * hay lista de dominios en el cliente, y no debe haberla (CLAUDE.md §0 regla 7).
 *
 * Sin imports a propósito: `scripts/probe-registro.mjs` lo carga desde Node y
 * compara `DOMINIO_NO_PARTICIPANTE` contra lo que GoTrue devuelve de verdad. Ese
 * es el amarre con el string que escribe la función SQL; si alguien cambia uno
 * sin el otro, el aviso deja de salir y el usuario vuelve a ver el código crudo.
 */

/** El `message` estable que devuelve el hook. Es un código, no copy. */
export const DOMINIO_NO_PARTICIPANTE = 'dominio_no_participante';

/**
 * Copy persistente del frame "Verificación (correo no participante)". Si el
 * texto cambia, cambia primero en `design/relevo-app.html`.
 */
export const COPY_DOMINIO_NO_PARTICIPANTE =
  'Ese correo no pertenece a una universidad participante. Usa el correo que te dio tu universidad.';

/**
 * ¿Es este error el rechazo del hook?
 *
 * Medido contra GoTrue v2.196.0: el hook responde `403` con
 * `{"code":403,"error_code":"unknown","msg":"dominio_no_participante"}`, y
 * auth-js pasa `msg` a `error.message` y el status a `error.status`. Se miran
 * las dos cosas: el `error_code` es `unknown`, así que no sirve para
 * distinguirlo.
 */
export function esDominioNoParticipante(
  e: { message?: string; status?: number } | null | undefined,
): boolean {
  return e?.status === 403 && e.message === DOMINIO_NO_PARTICIPANTE;
}
