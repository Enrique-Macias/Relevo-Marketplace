/**
 * Qué hace el panel ante un rechazo de una RPC de `admin.*`. Módulo PURO, sin
 * imports, para que `scripts/probe-admin.mjs` (caso 7) lo importe tal cual y
 * lo amarre contra los mensajes REALES que devuelve la base.
 *
 * Solo los TRES mensajes de `private.exigir_admin()` (20260930000477) cambian
 * la sesión: `no_admin` la cierra; `mfa_requerido` y `totp_vencido` piden el
 * TOTP otra vez y reintentan. CUALQUIER otro error —incluidos los 42501 de las
 * guardas (`no_sobre_si_mismo`, `objetivo_es_admin`) y un 42501 genérico de
 * RLS— solo se muestra: cerrar la sesión por ellos echaría al admin por un
 * error suyo de operación.
 */

export const NO_ADMIN = 'no_admin';
export const MFA_REQUERIDO = 'mfa_requerido';
export const TOTP_VENCIDO = 'totp_vencido';

export type AccionRechazo = 'cerrar_sesion' | 'pedir_totp' | 'mostrar';

export interface ErrorRpc {
  code?: string | null;
  message?: string | null;
}

export function clasificarRechazo(err: ErrorRpc | null | undefined): AccionRechazo {
  if (!err || err.code !== '42501') return 'mostrar';
  if (err.message === NO_ADMIN) return 'cerrar_sesion';
  if (err.message === MFA_REQUERIDO || err.message === TOTP_VENCIDO) return 'pedir_totp';
  return 'mostrar';
}

/**
 * Texto para el admin. Los códigos los fijan 20260930000478 (guardas G1-G6),
 * 20260930000479 (reportes y bloqueo), 20261007000481 (aprobar) y 20261008000483 (restablecer la
 * app autenticadora, más los dos de la Edge Function `admin-reset-mfa`). Es copy PERSISTENTE (un `.notice`), así
 * que cada texto está dibujado en `design/admin-panel.html`.
 */
const TEXTOS: Record<string, string> = {
  motivo_invalido: 'El motivo debe tener entre 3 y 500 caracteres.',
  no_sobre_si_mismo: 'No puedes aplicar esta acción sobre tu propia cuenta.',
  objetivo_es_admin: 'Es una cuenta de admin: no se suspende desde aquí. Quitarle el acceso lo hace el admin técnico.',
  usuario_no_existe: 'La cuenta ya no existe.',
  estado_inesperado: 'La cuenta cambió de estado mientras tanto. Recarga el detalle.',
  // Ola 4 (20261007000481, `admin.aprobar_listing`): copy de las variantes del
  // modal "Aprobar publicación" de `design/admin-panel.html`.
  dueno_no_activo: 'La cuenta del dueño está suspendida: no se puede aprobar mientras siga así.',
  sin_fotos: 'La publicación no tiene fotos: no se puede aprobar.',
  moderacion_en_curso: 'La revisión automática de esta publicación sigue en curso. Inténtalo en unos minutos.',
  // Ola 3b (20261008000483 y `admin-reset-mfa`): copy de las variantes del
  // modal "Restablecer app autenticadora" de `design/admin-panel.html`.
  objetivo_no_es_admin: 'Esta cuenta ya no es de admin. Recarga el detalle.',
  factores_pendientes: 'Su acceso quedó desactivado, pero no pudimos eliminar la app autenticadora registrada en su cuenta. Inténtalo otra vez.',
  cierre_pendiente: 'La app autenticadora ya se eliminó, pero el restablecimiento quedó pendiente. Inténtalo de nuevo para completarlo.',
  [NO_ADMIN]: 'Esta cuenta no es admin del panel.',
  [MFA_REQUERIDO]: 'Falta confirmar tu código de la app autenticadora.',
  [TOTP_VENCIDO]: 'Tu código de la app autenticadora venció. Confírmalo otra vez.',
};

/**
 * Mensajes de `admin.*` que se muestran con el texto GENÉRICO a propósito: el
 * panel nunca los provoca (valida antes, o el objeto lo trae la propia lista), y
 * su copy no está en los frames. El caso 7c de `scripts/probe-admin.mjs` exige
 * que todo `raise` de `admin.*` esté en TEXTOS o aquí: un mensaje nuevo obliga
 * a decidir cuál.
 */
export const SIN_TEXTO_PROPIO: readonly string[] = [
  'estado_invalido', 'reporte_no_existe', 'listing_no_existe', 'auditoria_sin_actor',
  // `admin.restablecer_mfa_*`: el panel solo manda ids de intento que la base le dio
  // (las filas de auditoría no se borran), así que no lo provoca.
  'intento_no_existe',
];

export function tieneTextoDecidido(mensaje: string): boolean {
  return mensaje in TEXTOS || SIN_TEXTO_PROPIO.includes(mensaje);
}

/** `estado_inesperado` cambia de sujeto según qué cambió de estado. */
const ESTADO_INESPERADO_PUBLICACION = 'La publicación cambió de estado mientras tanto. Recarga el detalle.';

export function textoDeRechazo(
  err: ErrorRpc | null | undefined,
  sujeto: 'cuenta' | 'publicacion' = 'cuenta',
): string {
  const m = err?.message ?? '';
  if (m === 'estado_inesperado' && sujeto === 'publicacion') return ESTADO_INESPERADO_PUBLICACION;
  return TEXTOS[m] ?? `No se pudo completar la acción (${err?.code ?? 'sin código'}).`;
}
