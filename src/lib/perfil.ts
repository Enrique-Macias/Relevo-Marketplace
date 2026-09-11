/**
 * Teléfono del vendedor (RF-13) — normalización, escritura y la lectura acotada.
 *
 * El número es el único dato del perfil que NO se lee con un select: está fuera
 * del grant de columna (RNF-05, migración 20260910000448) y solo sale por la RPC
 * `seller_whatsapp`. Ese reparto es lo que hace que un autenticado no pueda
 * bajarse el directorio de teléfonos entero en un request, como sí podría si
 * `telefono` viviera junto a `nombre` y `carrera`.
 *
 * De este lado eso significa tres funciones y ninguna más: normalizar lo que el
 * usuario teclea, guardarlo, y pedir el de alguien más cuando hay que abrir
 * WhatsApp.
 */

import { supabase } from '@/lib/supabase';

/** Lada fija de México — ver la deuda consciente de CLAUDE.md §8. */
export const LADA = '+52';

/** Dígitos nacionales que espera el `check` de la base. */
const DIGITOS_NACIONALES = 10;

/**
 * Los dígitos que el usuario tecleó, sin nada más.
 *
 * El campo acepta que se escriba "81 1234 5678" o "81-1234-5678" porque es como
 * la gente dicta un número; lo que se guarda es E.164 sin separadores. Se quita
 * también un `+52` pegado al inicio: alguien que copia su número de WhatsApp lo
 * trae incluido, y sin esto quedarían 12 dígitos y el check lo rechazaría con un
 * mensaje que no explica nada.
 */
export function soloDigitos(texto: string): string {
  const limpio = texto.replace(/\D/g, '');
  return limpio.startsWith('52') && limpio.length > DIGITOS_NACIONALES
    ? limpio.slice(2)
    : limpio;
}

export function telefonoValido(texto: string): boolean {
  return soloDigitos(texto).length === DIGITOS_NACIONALES;
}

/**
 * A E.164, la forma en que vive en la base: `+52` + 10 dígitos.
 *
 * Se guarda CON el `+` aunque `wa.me` lo pida sin él (ver `urlWhatsapp`).
 * `+528111234567` es un número sin ambigüedad; `528111234567` es una cadena que
 * hay que saber interpretar.
 */
export function aE164(texto: string): string {
  return `${LADA}${soloDigitos(texto)}`;
}

/**
 * El deep link de RF-13. `wa.me` quiere el internacional SIN `+`, sin espacios
 * y sin guiones — de ahí el `slice(1)` sobre el E.164 y no un replace suelto.
 */
export function urlWhatsapp(e164: string, mensaje: string): string {
  return `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(mensaje)}`;
}

/**
 * Guarda el número del propio usuario.
 *
 * Solo la columna `telefono`: es la única del grant de update que toca esta
 * pantalla, y mandar cualquier otra —aunque sea con su mismo valor— rechaza el
 * statement completo con 42501. Misma trampa que ya documenta
 * `(onboarding)/completar-perfil.tsx`.
 */
export async function guardarTelefono(userId: string, texto: string): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ telefono: aE164(texto) })
    .eq('id', userId);

  if (error) throw error;
}

/**
 * El número de otro usuario, para abrir WhatsApp con él.
 *
 * Devuelve `null` en DOS casos que el llamador tiene que saber distinguir, y no
 * puede distinguirlos con esto solo:
 *  - el vendedor no tiene número guardado (publicaciones anteriores a que la
 *    columna existiera, o dadas de alta desde Studio);
 *  - QUIEN LLAMA está suspendido — un suspendido no puede contactar por
 *    WhatsApp (tabla de decisión de CLAUDE.md §3), y esta RPC es donde esa
 *    regla se hace cumplir.
 *
 * La distinción se hace arriba, con el `estado` de la propia sesión. No hay
 * forma de sacarla de aquí, y es a propósito: la función no dice por qué negó.
 */
export async function fetchTelefonoVendedor(userId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('seller_whatsapp', { p_user_id: userId });
  if (error) throw error;
  return data ?? null;
}
