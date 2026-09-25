/**
 * Deduplicación pura de contactos por persona — "¿A quién le vendiste?"
 * (RF-12). Sin imports a propósito: `scripts/probe-contactos.mjs` lo carga
 * directo desde Node, sin bundler ni stack de Supabase — mismo criterio que
 * `src/lib/calificacion-pendiente.ts` / `src/lib/ubicacion.ts`. Un import de
 * React Native o de Supabase aquí hace que el probe deje de arrancar — esa es
 * la señal, no un error a silenciar.
 *
 * `listing_contacts` es un log append-only a propósito (auditoría, CLAUDE.md
 * §3): cada tap en "Contactar por WhatsApp" inserta su propia fila, así que
 * la misma persona puede aparecer varias veces. Este módulo no cambia eso —
 * solo decide cómo se ve en una lista de PERSONAS, no de eventos. El stat de
 * "contactos" de Detalle (`fetchStatsPropias()`, `src/lib/listings.ts`) sigue
 * contando eventos y no pasa por aquí.
 */

/**
 * Una fila por `userId`; de las repetidas, se queda con la de `createdAt` más
 * reciente — coincide con la lectura de "Te contactó hace Xh" en `BuyerRow`,
 * que lee como el ÚLTIMO contacto, no el primero.
 *
 * El resultado se ordena por `createdAt` descendente explícitamente, sin
 * asumir que `contactos` ya viene ordenado. Un solo recorrido con "mejor
 * hasta ahora" por persona, mismo estilo que `elegirPendiente()`
 * (`calificacion-pendiente.ts`) y `campusMasCercano()` (`ubicacion.ts`). No
 * muta `contactos`.
 *
 * Empate exacto de `createdAt` para la misma persona → gana el primero visto
 * en el arreglo de entrada (desempate determinista, sin significado de
 * negocio — mismo criterio que el resto del repo).
 */
export function deduplicarContactos<T extends { userId: string; createdAt: string }>(
  contactos: T[]
): T[] {
  const masReciente = new Map<string, T>();

  for (const c of contactos) {
    const actual = masReciente.get(c.userId);
    if (!actual || Date.parse(c.createdAt) > Date.parse(actual.createdAt)) {
      masReciente.set(c.userId, c);
    }
  }

  return [...masReciente.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
