/**
 * Eliminar la cuenta propia (Apple 5.1.1(v), Google Play) — el lado del cliente.
 *
 * El borrado lo hace la Edge Function `eliminar-cuenta`: Storage primero, luego
 * `auth.admin.deleteUser`, y las cascadas/triggers de 20260929000474 hacen el
 * resto en la base. Aquí solo hay dos pasos y ninguno decide nada:
 *
 *   1. REAUTENTICAR con `signInWithPassword`. La función exige un JWT cuyo `amr`
 *      diga que la contraseña se escribió hace menos de 5 minutos
 *      (`supabase/functions/eliminar-cuenta/reautenticacion.ts`, medido: un
 *      refresh NO cuenta). La contraseña va a GoTrue y nunca a la función.
 *      Si falla, la sesión actual queda intacta (auth-js no la borra ante un
 *      error de login, `GoTrueClient.js:950`): un "contraseña incorrecta" no
 *      saca a nadie de la app.
 *   2. INVOCAR la función con ese token nuevo, que supabase-js adjunta solo.
 *
 * NO es autorización duplicada (CLAUDE.md §0 regla 7): la función rechaza igual
 * sin reautenticación, se haga aquí o no. Aquí solo se traduce cada fallo al
 * copy del frame "Confirmar eliminar cuenta".
 *
 * Reintentar es seguro: la función es idempotente y un segundo `invoke` sobre
 * una cuenta ya borrada devuelve 200 (medido en `probe-eliminar-cuenta.mjs`).
 */

import {
  FunctionsFetchError,
  FunctionsRelayError,
  isAuthApiError,
  isAuthRetryableFetchError,
} from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

// Copy persistente del frame "Confirmar eliminar cuenta" (design/relevo-app.html).
// Si cambia, cambia primero allá.
export const COPY_CONTRASENA_INCORRECTA = 'La contraseña no es correcta.';
export const COPY_SIN_CONEXION = 'No hay conexión. Tu cuenta no se borró; intenta de nuevo.';
export const COPY_FALLO_SERVIDOR = 'No pudimos eliminar tu cuenta. Intenta de nuevo.';

export type FalloEliminarCuenta = 'contrasena' | 'sin_conexion' | 'servidor';

export class EliminarCuentaError extends Error {
  constructor(
    readonly motivo: FalloEliminarCuenta,
    detalle: string,
  ) {
    super(detalle);
    this.name = 'EliminarCuentaError';
  }
}

export async function eliminarCuenta(correo: string, password: string): Promise<void> {
  const { error: errLogin } = await supabase.auth.signInWithPassword({ email: correo, password });
  if (errLogin) {
    if (isAuthRetryableFetchError(errLogin)) {
      throw new EliminarCuentaError('sin_conexion', errLogin.message);
    }
    if (isAuthApiError(errLogin) && errLogin.code === 'invalid_credentials') {
      throw new EliminarCuentaError('contrasena', errLogin.message);
    }
    throw new EliminarCuentaError('servidor', errLogin.message);
  }

  // Sin body: la función saca a quién borrar del JWT y lo ignora de todos modos.
  const { error: errFuncion } = await supabase.functions.invoke('eliminar-cuenta', { body: {} });
  if (errFuncion) {
    // `FunctionsFetchError` = la request no salió; `FunctionsRelayError` = no
    // llegó a la función. Las dos son de red, no un veredicto del servidor.
    const deRed = errFuncion instanceof FunctionsFetchError || errFuncion instanceof FunctionsRelayError;
    throw new EliminarCuentaError(deRed ? 'sin_conexion' : 'servidor', errFuncion.message);
  }
}

export function copyDeFallo(motivo: FalloEliminarCuenta): string {
  switch (motivo) {
    case 'contrasena':
      return COPY_CONTRASENA_INCORRECTA;
    case 'sin_conexion':
      return COPY_SIN_CONEXION;
    case 'servidor':
      return COPY_FALLO_SERVIDOR;
  }
}
