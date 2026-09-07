/**
 * Bandera de "ya vi el carrusel de bienvenida", persistida por dispositivo.
 *
 * El carrusel (Onboarding 1/3–3/3) se muestra una sola vez: sin esto, un
 * usuario que cierra sesión o abandona el registro volvería a verlo cada vez
 * que abre la app sin sesión. Se marca al tocar "Comenzar" u "Omitir" al final
 * del carrusel, independientemente de si después completa el registro o no —
 * ya vio el material, ese es el punto.
 *
 * Vive en AsyncStorage y no en la base: es preferencia de dispositivo, no de
 * cuenta, y tiene que poder leerse antes de que haya sesión.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'hasSeenOnboarding';

export async function getHasSeenOnboarding(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'true';
  } catch {
    // Si el storage falla, es preferible mostrar el carrusel de más que
    // bloquear el arranque de la app.
    return false;
  }
}

export async function markOnboardingSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, 'true');
  } catch {
    // Silencioso a propósito: no poder recordar la bandera no debe impedir
    // que el usuario avance al registro.
  }
}
