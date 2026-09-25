/**
 * Bandera de "esta compra se omitió a propósito en el auto-open de
 * Calificar", persistida por CUENTA (RF-12).
 *
 * Modelado en `src/lib/onboarding-flag.ts`, con una diferencia deliberada: ahí
 * la clave es plana porque es preferencia de DISPOSITIVO, previa a cualquier
 * sesión (el carrusel de bienvenida). Aquí la clave va por `userId` porque es
 * preferencia de CUENTA: un dispositivo puede tener varias cuentas por
 * login/logout sucesivos, y la lista de "esto ya lo omití" de la cuenta A no
 * debe filtrar el auto-open de la cuenta B, ni perderse si A vuelve a iniciar
 * sesión después de B.
 *
 * Sin función de limpieza/borrado a propósito: sobrevivir a un logout es el
 * comportamiento querido, no un cache que invalidar.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIJO = 'calificarOmitidas:';

export async function getListingsOmitidos(userId: string): Promise<number[]> {
  try {
    const crudo = await AsyncStorage.getItem(PREFIJO + userId);
    if (!crudo) return [];

    const parseado = JSON.parse(crudo);
    if (!Array.isArray(parseado) || !parseado.every((n) => typeof n === 'number')) {
      return [];
    }
    return parseado;
  } catch {
    // Si el storage falla o el dato está corrupto, es preferible ofrecer el
    // auto-open de más (el usuario puede volver a omitir) que perderlo del
    // todo por un dato ilegible.
    return [];
  }
}

export async function marcarListingOmitido(userId: string, listingId: number): Promise<void> {
  try {
    const actuales = await getListingsOmitidos(userId);
    if (actuales.includes(listingId)) return;

    await AsyncStorage.setItem(PREFIJO + userId, JSON.stringify([...actuales, listingId]));
  } catch {
    // Silencioso a propósito: no poder recordar la omisión no debe impedir
    // volver a la pantalla anterior.
  }
}
