/**
 * El copy de los errores de Auth en las pantallas de onboarding.
 *
 * Antes cada pantalla pintaba `error.message` tal cual, y GoTrue lo manda en
 * inglés ("Invalid login credentials", "Token has expired or is invalid").
 * Aquí se traduce por `code`, que es estable; el `message` no se muestra nunca.
 * Lo que no esté en la tabla cae en el genérico.
 *
 * El copy es persistente: vive primero en las variantes de cada frame de
 * onboarding en `design/relevo-app.html` (clase `.auth-error`).
 *
 * Sin imports a propósito, igual que `registro.ts`: es una tabla pura.
 */

export const COPY_SIN_CONEXION = 'No hay conexión. Revisa tu internet e inténtalo de nuevo.';
export const COPY_ERROR_GENERICO = 'Algo salió mal. Inténtalo de nuevo.';

const COPY_POR_CODIGO: Record<string, string> = {
  invalid_credentials: 'El correo o la contraseña no son correctos.',
  // GoTrue usa el mismo código para un código vencido y para uno equivocado
  // ("Token has expired or is invalid"), así que el texto cubre los dos.
  otp_expired: 'El código no es válido o ya venció. Pide uno nuevo.',
  over_email_send_rate_limit:
    'Hiciste demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
  over_request_rate_limit: 'Hiciste demasiados intentos. Espera unos minutos y vuelve a intentarlo.',
  same_password: 'La nueva contraseña debe ser distinta a la anterior.',
  weak_password: 'La contraseña debe tener al menos 8 caracteres.',
  email_address_invalid: 'Revisa que el correo esté bien escrito.',
};

type ErrorConCodigo = {
  code?: string;
  status?: number;
  name?: string;
  message?: string;
} | null | undefined;

/**
 * El texto que se pinta para un error de auth-js (o de PostgREST, en
 * Completar perfil).
 *
 * "Sin conexión" se reconoce por la forma que da cada cliente cuando el
 * `fetch` ni siquiera llega: auth-js lanza `AuthRetryableFetchError` con
 * status 0 (`auth-js/lib/fetch.js`), y PostgREST devuelve un error cuyo
 * `message` empieza con el nombre del error de red (`TypeError: Network
 * request failed`, o `FetchError: …`).
 */
export function mensajeErrorAuth(e: ErrorConCodigo): string {
  if (!e) return COPY_ERROR_GENERICO;
  if (e.name === 'AuthRetryableFetchError' && e.status === 0) return COPY_SIN_CONEXION;
  if (/^(TypeError|FetchError)\b|Network request failed/.test(e.message ?? '')) {
    return COPY_SIN_CONEXION;
  }
  // Medido contra GoTrue local: un correo mal formado llega como
  // `validation_failed` ("Unable to validate email address: invalid format"),
  // no como `email_address_invalid`. Ese código también cubre otras
  // validaciones, así que solo se toma el del correo.
  if (e.code === 'validation_failed' && /email/i.test(e.message ?? '')) {
    return COPY_POR_CODIGO.email_address_invalid;
  }
  if (e.status === 429 && !(e.code && COPY_POR_CODIGO[e.code])) {
    return COPY_POR_CODIGO.over_request_rate_limit;
  }
  return (e.code && COPY_POR_CODIGO[e.code]) || COPY_ERROR_GENERICO;
}
