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

/** Texto para el admin. Los códigos los fija 20260930000478 (guardas G1-G6). */
const TEXTOS: Record<string, string> = {
  motivo_invalido: 'El motivo debe tener entre 3 y 500 caracteres.',
  no_sobre_si_mismo: 'No puedes aplicar esta acción sobre tu propia cuenta.',
  objetivo_es_admin: 'Esa cuenta es de un admin. Para quitarle el acceso, se borra su fila de admins.',
  usuario_no_existe: 'La cuenta ya no existe.',
  estado_inesperado: 'La cuenta cambió de estado mientras tanto. Recarga el detalle.',
  [NO_ADMIN]: 'Esta cuenta no es admin del panel.',
  [MFA_REQUERIDO]: 'Falta confirmar tu código de la app autenticadora.',
  [TOTP_VENCIDO]: 'Tu código de la app autenticadora venció. Confírmalo otra vez.',
};

export function textoDeRechazo(err: ErrorRpc | null | undefined): string {
  const m = err?.message ?? '';
  return TEXTOS[m] ?? `No se pudo completar la acción (${err?.code ?? 'sin código'}).`;
}
