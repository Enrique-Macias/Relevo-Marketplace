// ===========================================================================
// Relevo — genera `src/lib/paises.ts`: la lista del "Selector de país" del
// campo de WhatsApp (código ISO, nombre en español y lada).
//
// Cómo correrlo (solo cuando se actualice libphonenumber-js):
//     node scripts/generate-paises.mjs
//
// POR QUÉ UN ARCHIVO GENERADO Y COMMITEADO, y no `Intl.DisplayNames` en la app:
// Node sí trae los nombres de región en español (ICU completo); el soporte de
// `Intl.DisplayNames` en Hermes no está garantizado, y un selector de país que
// dependa de él podría pintar códigos sueltos en un teléfono y nombres en otro.
// Estático, se ve igual en todas partes y el diff de una actualización se lee.
//
// Los países salen de la MISMA metadata que valida (`libphonenumber-js/min`),
// así que no puede haber un país en la lista que el validador no conozca. Se
// descartan los códigos sin nombre en español (Intl devuelve el código tal
// cual: territorios como AC o TA), porque una fila que dice "TA" no se puede
// buscar. SIN bandera emoji, a propósito: ver CLAUDE.md §3, bloque del teléfono.
// ===========================================================================

import { writeFileSync } from 'node:fs';

import { getCountries, getCountryCallingCode } from 'libphonenumber-js/min';

const nombres = new Intl.DisplayNames(['es'], { type: 'region' });

const paises = [];
const descartados = [];
for (const iso of getCountries()) {
  const nombre = nombres.of(iso);
  if (!nombre || nombre === iso) {
    descartados.push(iso);
    continue;
  }
  paises.push({ iso, nombre, lada: `+${getCountryCallingCode(iso)}` });
}

// México primero (default y caso común); el resto en orden alfabético español.
const cmp = new Intl.Collator('es').compare;
paises.sort((a, b) => (a.iso === 'MX' ? -1 : b.iso === 'MX' ? 1 : cmp(a.nombre, b.nombre)));

const filas = paises
  .map((p) => `  { iso: '${p.iso}', nombre: ${JSON.stringify(p.nombre)}, lada: '${p.lada}' },`)
  .join('\n');

writeFileSync(
  'src/lib/paises.ts',
  `// GENERADO por scripts/generate-paises.mjs — no editar a mano.
// Fuente: libphonenumber-js/min (países y ladas) + Intl.DisplayNames('es') de
// Node (nombres). ${paises.length} países; México primero, el resto en orden
// alfabético. Sin bandera emoji a propósito (CLAUDE.md §3, bloque del teléfono).

import type { CountryCode } from 'libphonenumber-js/min';

export type Pais = { iso: CountryCode; nombre: string; lada: string };

export const PAISES: readonly Pais[] = [
${filas}
];

/**
 * El país de un ISO, o México (el primero) si no está en la lista. El ISO sale
 * de \`separarE164()\`/\`paisDePegado()\` (\`src/lib/validacion-perfil.ts\`), que
 * usan la MISMA metadata, así que el fallback solo cubre una lista vieja.
 */
export function paisPorIso(iso: string): Pais {
  return PAISES.find((p) => p.iso === iso) ?? PAISES[0];
}
`
);

console.log(`src/lib/paises.ts: ${paises.length} países`);
console.log(`descartados sin nombre en español: ${descartados.join(', ') || '(ninguno)'}`);
