/**
 * Geolocalización aproximada, solo mientras se usa la app — fase 2C,
 * "Detectar campus más cercano" (`selector-campus.tsx`). Único punto de
 * contacto con `expo-location`.
 *
 * La ubicación NUNCA sale del dispositivo desde aquí: `obtenerUbicacionAproximada()`
 * resuelve un par de coordenadas y las devuelve al llamador, que las pasa a
 * `campusMasCercano()` (`src/lib/ubicacion.ts`, puro, sin red) y las
 * descarta. Este módulo no importa `supabase`, no llama a `fetch` y no
 * escribe en AsyncStorage/SecureStore — grep lo confirma (CLAUDE.md, la
 * verificación de privacidad de la fase 2C).
 *
 * El permiso se pide SOLO dentro de `obtenerUbicacionAproximada()`, o sea
 * solo cuando el llamador la invoca al tocar el botón — nunca al abrir la
 * app ni al abrir el selector.
 */

import type * as LocationType from 'expo-location';

/**
 * `expo-location` es un módulo NATIVO: un build que no lo tenga compilado
 * (se agregó a `package.json` sin reconstruir el dev build) revienta con
 * "Cannot find native module" en el `import` — por eso va como `require()`
 * dentro de un `try`, mismo patrón que `src/lib/push.ts`.
 *
 * A diferencia de aquel, el aviso va gateado a `__DEV__` y no es
 * incondicional: el `console.warn` de `push.ts` no evitó que la ausencia del
 * módulo por la exclusión de autolinking pasara desapercibida en la
 * práctica — costó una sesión real de debugging (CLAUDE.md §9). Aquí el
 * mensaje nombra la causa más probable (un build sin reconstruir) y solo se
 * imprime en desarrollo, para que sea imposible de ignorar sin volverse
 * ruido en producción.
 */
let Location: typeof LocationType | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Location = require('expo-location');
} catch (e) {
  if (__DEV__) {
    console.warn(
      '[geolocalizacion] módulo nativo de expo-location no disponible — ¿falta reconstruir el ' +
        'dev build tras agregarlo? Detalle:',
      (e as Error)?.message ?? e
    );
  }
}

/** Cuánto se considera "reciente" una posición ya conocida, antes de pedir una nueva. */
const UBICACION_RECIENTE_MS = 5 * 60 * 1000;

/** Tope de espera por una posición nueva — nunca un spinner infinito. */
const TIMEOUT_UBICACION_MS = 10_000;

const TIMEOUT = Symbol('timeout');

export type ResultadoUbicacion =
  | { estado: 'encontrado'; coords: { latitud: number; longitud: number } }
  | { estado: 'servicios_desactivados' }
  | { estado: 'permiso_denegado' }
  | { estado: 'permiso_denegado_permanente' }
  | { estado: 'timeout' }
  | { estado: 'error'; mensaje: string };

/**
 * ¿Hay soporte del módulo nativo en este build? El llamador la usa para
 * ocultar o deshabilitar el botón sin más ceremonia, en vez de dejar que
 * `obtenerUbicacionAproximada()` devuelva `'error'` recién al tocarlo.
 */
export function ubicacionDisponible(): boolean {
  return Location !== null;
}

/**
 * Obtiene una ubicación aproximada, pidiendo permiso si hace falta.
 *
 * El LLAMADOR es quien decide si este resultado, al llegar, todavía importa
 * — ver el token de "intento vigente" en `selector-campus.tsx`. Esta función
 * no sabe nada de eso: solo resuelve, o expira por su propio timeout de
 * `TIMEOUT_UBICACION_MS`, sin que eso cancele la petición nativa subyacente.
 */
export async function obtenerUbicacionAproximada(): Promise<ResultadoUbicacion> {
  if (!Location) return { estado: 'error', mensaje: 'módulo nativo no disponible' };

  const serviciosActivos = await Location.hasServicesEnabledAsync();
  if (!serviciosActivos) return { estado: 'servicios_desactivados' };

  // `getForegroundPermissionsAsync` primero: pedir de nuevo un permiso ya
  // DENEGADO no vuelve a mostrar el diálogo del sistema (mismo criterio que
  // `push.ts`), así que sin este paso no habría forma de distinguir "ya
  // estaba concedido" de "el usuario acaba de decir que sí".
  const previo = await Location.getForegroundPermissionsAsync();
  const permiso = previo.granted ? previo : await Location.requestForegroundPermissionsAsync();

  if (!permiso.granted) {
    return permiso.canAskAgain
      ? { estado: 'permiso_denegado' }
      : { estado: 'permiso_denegado_permanente' };
  }

  try {
    const reciente = await Location.getLastKnownPositionAsync();
    if (reciente && Date.now() - reciente.timestamp < UBICACION_RECIENTE_MS) {
      return {
        estado: 'encontrado',
        coords: { latitud: reciente.coords.latitude, longitud: reciente.coords.longitude },
      };
    }

    // `Accuracy.Balanced` (~100 m), no `High`/`Best`: es lo que hace
    // consistente la llamada con el permiso que de verdad se pidió —
    // Android solo declara `ACCESS_COARSE_LOCATION` (app.json), así que
    // pedir alta precisión aquí contradiría esa declaración.
    const actual = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), TIMEOUT_UBICACION_MS)),
    ]);

    if (actual === TIMEOUT) return { estado: 'timeout' };

    return {
      estado: 'encontrado',
      coords: { latitud: actual.coords.latitude, longitud: actual.coords.longitude },
    };
  } catch (e) {
    return { estado: 'error', mensaje: (e as Error)?.message ?? String(e) };
  }
}
