import { useCallback } from 'react';
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase.ts';
import { clasificarRechazo } from './rechazos.ts';
import { pedirTotp } from './puerta-totp.ts';

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: PostgrestError | null };

/**
 * Toda llamada a `admin.*` pasa por aquí (estaba dentro de Panel.tsx en la
 * Ola 1). SOLO `no_admin` cierra la sesión y SOLO `mfa_requerido`/
 * `totp_vencido` piden el TOTP —por la puerta única, `puerta-totp.ts`— y
 * reintentan UNA vez. Cualquier otro rechazo se devuelve para que la pantalla
 * lo muestre con `textoDeRechazo()`.
 */
export function useLlamar() {
  return useCallback(async <T,>(
    fn: () => PromiseLike<{ data: T | null; error: PostgrestError | null }>,
  ): Promise<Resultado<T>> => {
    for (let intento = 0; intento < 2; intento++) {
      const { data, error } = await fn();
      if (!error) return { ok: true, data: data as T };
      const accion = clasificarRechazo(error);
      if (accion === 'cerrar_sesion') { await supabase.auth.signOut(); return { ok: false, error: null }; }
      if (accion === 'pedir_totp' && intento === 0
          && (await pedirTotp(error.message === 'mfa_requerido' ? 'mfa_requerido' : 'totp_vencido'))) continue;
      return { ok: false, error };
    }
    return { ok: false, error: null };
  }, []);
}
