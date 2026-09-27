/**
 * ¿El usuario escribió su contraseña hace poco? La decisión pura de
 * `eliminar-cuenta`, separada de `index.ts` para que Node la cargue directo
 * (`scripts/probe-eliminar-cuenta.mjs`) — mismo criterio que
 * `moderar-contenido/decision.ts`. Sin imports: si alguien le mete uno que
 * arrastre Deno o Supabase, el probe deja de arrancar, y esa es la señal.
 *
 * POR QUÉ `amr` Y NO `iat`. Medido contra GoTrue local (B0, 2026-09-26): un
 * refresh de sesión emite un access token con `iat` NUEVO sin pedir nada, y
 * conserva intacto el `amr`:
 *
 *   login:   iat …353  amr [{ method: 'password', timestamp: …353 }]
 *   refresh: iat …356  amr [{ method: 'password', timestamp: …353 }]
 *   relogin: iat …358  amr [{ method: 'password', timestamp: …358 }]
 *   otp:     iat …358  amr [{ method: 'otp',      timestamp: …358 }]
 *
 * O sea que `iat` prueba "token reciente", y cualquier app abierta lo tiene
 * con solo esperar al refresh. `amr[].timestamp` del método `password` es la
 * hora en que se ESCRIBIÓ la contraseña, y solo un `signInWithPassword` lo
 * mueve. Una sesión que nació por OTP no trae `password` y no pasa.
 *
 * La contraseña nunca llega a la función: el cliente reautentica contra
 * GoTrue y manda el token resultante.
 */

/** Cuánto vale una reautenticación, en segundos. */
export const VENTANA_REAUTENTICACION_S = 300;

/**
 * Tolerancia hacia el FUTURO, por reloj desfasado entre GoTrue y el runtime de
 * la función. Un `timestamp` más adelantado que esto no es desfase, es un token
 * raro, y se rechaza.
 */
export const TOLERANCIA_RELOJ_S = 60;

export function reautenticacionReciente(
  amr: unknown,
  ahoraS: number,
  ventanaS: number = VENTANA_REAUTENTICACION_S,
): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((entrada) => {
    if (!entrada || typeof entrada !== 'object') return false;
    const { method, timestamp } = entrada as { method?: unknown; timestamp?: unknown };
    if (method !== 'password' || typeof timestamp !== 'number') return false;
    const edad = ahoraS - timestamp;
    return edad >= -TOLERANCIA_RELOJ_S && edad <= ventanaS;
  });
}
