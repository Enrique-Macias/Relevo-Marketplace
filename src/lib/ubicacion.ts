/**
 * Cálculo puro de distancia y "campus más cercano" — fase 2C, "Detectar
 * campus más cercano" (`selector-campus.tsx`). Sin imports a propósito:
 * `scripts/probe-ubicacion.mjs` lo carga directo desde Node, sin bundler ni
 * stack de Supabase — mismo criterio que `src/lib/registro.ts`.
 *
 * La ubicación del dispositivo nunca pasa por aquí camino de la red: este
 * módulo solo hace aritmética sobre los números que le pasan y devuelve un
 * id. Quien obtiene la ubicación (`src/lib/geolocalizacion.ts`) es un módulo
 * aparte, impuro, que este no importa.
 */

export type Coordenadas = { latitud: number; longitud: number };

/** Lo mínimo que `campusMasCercano()` necesita de un campus del catálogo. */
export type CampusConCoordenadas = {
  id: number;
  latitud: number | null;
  longitud: number | null;
};

/** Umbral de lejanía (CLAUDE.md §3, decisión de la fase 2C): cubre una zona
 * metropolitana completa (~50 km de extremo a extremo) sin aceptar como
 * "cercano" un campus de otra ciudad. */
export const UMBRAL_CERCANIA_KM = 50;

const RADIO_TIERRA_KM = 6371;

function gradosARadianes(grados: number): number {
  return (grados * Math.PI) / 180;
}

/**
 * Distancia en km entre dos puntos, fórmula de haversine. `Math.min(1, …)`
 * en el argumento de `asin` no es ceremonia: en puntos casi idénticos o casi
 * antipodales, el error de punto flotante puede empujar `h` un poco fuera de
 * `[0, 1]` y `Math.asin` de un valor > 1 devuelve `NaN`.
 */
export function distanciaKm(a: Coordenadas, b: Coordenadas): number {
  const dLat = gradosARadianes(b.latitud - a.latitud);
  const dLon = gradosARadianes(b.longitud - a.longitud);
  const lat1 = gradosARadianes(a.latitud);
  const lat2 = gradosARadianes(b.latitud);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type CampusCercano = { id: number; distanciaKm: number };

/**
 * El campus con coordenadas más cercano a `origen`, o `null` si ninguno tiene
 * coordenadas o el más cercano está más allá de `umbralKm`. Un campus sin
 * `latitud`/`longitud` (nullable en la base, CLAUDE.md §3) simplemente no
 * participa — no es un error.
 *
 * Empate → gana el de menor `id`, sin importar el orden del arreglo de
 * entrada: en cada empate se compara contra el `mejor` actual, así que el id
 * más bajo termina ganando sin importar en qué orden llegaron los candidatos.
 */
export function campusMasCercano(
  origen: Coordenadas,
  campus: CampusConCoordenadas[],
  umbralKm: number = UMBRAL_CERCANIA_KM
): CampusCercano | null {
  let mejor: CampusCercano | null = null;

  for (const c of campus) {
    if (c.latitud == null || c.longitud == null) continue;

    const d = distanciaKm(origen, { latitud: c.latitud, longitud: c.longitud });
    const esMejor =
      mejor === null || d < mejor.distanciaKm || (d === mejor.distanciaKm && c.id < mejor.id);

    if (esMejor) mejor = { id: c.id, distanciaKm: d };
  }

  if (mejor === null || mejor.distanciaKm > umbralKm) return null;
  return mejor;
}
