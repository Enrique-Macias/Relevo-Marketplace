/**
 * Cálculo puro de "qué compra pendiente de calificar mostrar, si alguna" —
 * auto-abrir "Calificar" al volver a la app (RF-12). Sin imports a propósito:
 * `scripts/probe-calificacion-pendiente.mjs` lo carga directo desde Node, sin
 * bundler ni stack de Supabase — mismo criterio que `src/lib/ubicacion.ts` /
 * `src/lib/validacion-perfil.ts`. Un import de React Native o de Supabase aquí
 * hace que el probe deje de arrancar — esa es la señal, no un error a
 * silenciar.
 *
 * Este módulo no decide QUÉ es una compra pendiente (eso lo hace
 * `fetchComprasPendientesDeCalificar()` en `confianza.ts`, contra la base) ni
 * CUÁNDO se ofrece (eso lo hace `useAutoAbrirCalificarPendiente()`, también en
 * `confianza.ts`). Solo elige UNA de una lista ya filtrada por elegibilidad.
 */

export type CompraPendiente = {
  listingId: number;
  sellerId: string;
  sellerName: string | null;
  sellerFotoUrl: string | null;
  /** ISO 8601, tal cual lo entrega `listing_sales.created_at` vía PostgREST. */
  createdAt: string;
};

/**
 * La compra pendiente a ofrecer, o `null` si no hay ninguna.
 *
 * Filtra las `omitidas` (compras que el usuario ya descartó a propósito, ver
 * `src/lib/calificar-omitidas.ts`) y, del resto, elige la de `createdAt` más
 * reciente — "solo la más reciente si hay varias", el requisito del auto-open.
 *
 * Empate exacto de `createdAt` → gana el de mayor `listingId`. Es un
 * desempate arbitrario pero determinista, sin ningún significado de negocio
 * (no debería ocurrir con la resolución de microsegundos de `timestamptz`,
 * pero la función tiene que ser determinista de todos modos) — mismo criterio
 * que "empate → gana el de menor id" en `campusMasCercano()`
 * (`src/lib/ubicacion.ts`).
 *
 * Un solo recorrido con "mejor hasta ahora", sin `sort()`, mismo estilo que
 * `campusMasCercano()`. No muta `candidatas` ni `omitidas`.
 */
export function elegirPendiente(
  candidatas: CompraPendiente[],
  omitidas: readonly number[]
): CompraPendiente | null {
  const omitidasSet = new Set(omitidas);

  let mejor: CompraPendiente | null = null;

  for (const c of candidatas) {
    if (omitidasSet.has(c.listingId)) continue;

    const esMejor =
      mejor === null ||
      Date.parse(c.createdAt) > Date.parse(mejor.createdAt) ||
      (Date.parse(c.createdAt) === Date.parse(mejor.createdAt) && c.listingId > mejor.listingId);

    if (esMejor) mejor = c;
  }

  return mejor;
}
