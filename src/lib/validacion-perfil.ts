/**
 * Las reglas de captura del perfil, del lado del cliente.
 *
 * El candado vive en la base: el `check` `users_nombre_valido` (migración
 * 20260927000469). Este módulo NO decide nada: normaliza lo que el usuario
 * teclea y le dice ANTES de guardar si la base lo va a rechazar, para pintar el
 * `.field-error` del frame en vez de un rechazo crudo (CLAUDE.md §0 regla 7).
 *
 * El teléfono tiene su propio candado, `users_telefono_e164` (migración
 * 20260927000470). Aquí se captura por país con libphonenumber-js.
 *
 * Su ÚNICO import es `libphonenumber-js/min`, JS puro que Node también carga:
 * `scripts/probe-perfil.mjs` importa este módulo desde Node y corre los MISMOS
 * casos contra los checks reales. Ese es el amarre entre las dos copias de cada
 * regla. No le metas imports de Expo, React Native ni Supabase: el probe dejaría
 * de arrancar (mismo criterio que `registro.ts`).
 */

import {
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/min';

/**
 * Qué es una "letra", ESCRITO IGUAL que en el `check` de la base — con escapes
 * `\uXXXX`, que el regex de JS y el ARE de Postgres entienden igual. El probe
 * busca este string literal en `pg_get_constraintdef('users_nombre_valido')`:
 * si alguien cambia un lado sin el otro, cae ahí.
 *
 * `String.raw` NO es estilo: en un literal normal, JS decodifica cada escape al
 * PARSEAR, y el valor en runtime sería la letra (`À-Ö…`), no el escape — el
 * probe no la encontraría en la definición viva y el amarre caería siempre.
 * `new RegExp` sí interpreta el escape, así que la regla es la misma.
 *
 * Es un conjunto EXPLÍCITO y no `\p{L}` (ni `[[:alpha:]]` en SQL) porque esos
 * dos no coinciden entre sí, y el de Postgres además depende del ctype de la
 * base. Qué cubre cada rango, en la cabecera de la migración.
 */
export const CLASE_LETRA =
  String.raw`A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF\u0100-\u017F`;

/** Letras, y un separador (espacio, ', ’ o -) solo ENTRE letras. */
const NOMBRE_RE = new RegExp(`^[${CLASE_LETRA}]+([ '’-][${CLASE_LETRA}]+)*$`);

export const NOMBRE_MIN = 2;
export const NOMBRE_MAX = 50;

/**
 * Copy persistente de la variante "nombre no válido" de "Completar perfil" y
 * "Editar perfil". Si cambia, cambia primero en `design/relevo-app.html`.
 */
export const COPY_NOMBRE_INVALIDO =
  'Usa solo letras, espacios, apóstrofes y guiones, de 2 a 50 caracteres.';

/**
 * Lo que se guarda: NFC, sin espacios al borde y sin dobles.
 *
 * El NFC no es cosmético. La base rechaza una "é" escrita como e + acento
 * combinante (NFD), porque la marca combinante no es una letra del conjunto, y
 * un nombre pegado de otra app puede llegar así. Cualquier espacio en blanco
 * (tab, salto, no-separable) se colapsa a un espacio normal: ninguno de esos
 * está en la regla.
 */
export function normalizarNombre(texto: string): string {
  return texto.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/**
 * ¿La base aceptaría este nombre una vez normalizado? Evalúa sobre el
 * normalizado a propósito: un espacio final mientras se teclea no es un error,
 * porque se va a quitar al guardar.
 *
 * La longitud se cuenta en caracteres (`[...s]`, puntos de código), como
 * `char_length` en Postgres — no en unidades UTF-16.
 */
export function nombreValido(texto: string): boolean {
  const n = normalizarNombre(texto);
  const largo = [...n].length;
  return largo >= NOMBRE_MIN && largo <= NOMBRE_MAX && NOMBRE_RE.test(n);
}

// ---------------------------------------------------------------------------
// Teléfono (WhatsApp)
// ---------------------------------------------------------------------------

/** México por default: es el caso común, y el único país hasta 20260927000470. */
export const PAIS_DEFAULT: CountryCode = 'MX';

/**
 * Gemelo del check `users_telefono_e164`: E.164 genérico (lada sin 0 inicial,
 * 8 a 15 dígitos en total) y, si la lada es +52, exactamente 10 después.
 *
 * Existe para que lo que acepta el cliente sea SUBCONJUNTO de lo que acepta la
 * base: libphonenumber valida por país, pero su metadata no es la regla de la
 * base, y un número que la librería diera por bueno y el check rechazara sería
 * un rechazo crudo al guardar. El probe comprueba esa inclusión con los números
 * de ejemplo de todos los países.
 */
export function formaE164Valida(e164: string): boolean {
  return /^\+[1-9][0-9]{7,14}$/.test(e164) && (!e164.startsWith('+52') || /^\+52[0-9]{10}$/.test(e164));
}

/**
 * Lo que el usuario tecleó en el campo, interpretado en el país elegido.
 *
 * No se filtran las teclas al escribir ("81 1234 5678", "81-1234-5678", una
 * lada pegada sin `+`): libphonenumber entiende todo eso, y pelearle al usuario
 * a media escritura es peor que limpiar al guardar. Tampoco se toca el prefijo
 * troncal (el 0 de "07911 123456" en Reino Unido): la librería lo quita.
 */
function interpretar(pais: CountryCode, texto: string) {
  return parsePhoneNumberFromString(texto, pais);
}

/**
 * ¿La base aceptaría este número, y es válido para el país elegido?
 *
 * "Para el país" significa su LADA: con Canadá elegido, un número de Estados
 * Unidos (+1 también) es válido, porque es el mismo plan de numeración y el
 * E.164 resultante es correcto. Lo que se rechaza es un número que no existe en
 * esa lada (8 dígitos con México, un prefijo imposible).
 */
export function telefonoValido(pais: CountryCode, texto: string): boolean {
  const n = interpretar(pais, texto);
  return (
    !!n &&
    n.isValid() &&
    n.countryCallingCode === getCountryCallingCode(pais) &&
    formaE164Valida(n.number)
  );
}

/**
 * A E.164, la forma en que vive en la base. Solo se llama con un número que
 * pasó `telefonoValido()`: si no, se arma a mano con la lada y los dígitos, y la
 * base lo rechaza (que es lo correcto: el candado es ella).
 *
 * Se guarda CON el `+` aunque `wa.me` lo pida sin él (ver `urlWhatsapp` en
 * `perfil.ts`): `+528111234567` es un número sin ambigüedad.
 */
export function aE164(pais: CountryCode, texto: string): string {
  return (
    interpretar(pais, texto)?.number ??
    `+${getCountryCallingCode(pais)}${texto.replace(/\D/g, '')}`
  );
}

/**
 * Del E.164 guardado al par que pinta el campo: país y número nacional con el
 * agrupado de ese país (`+528112345678` → MX, "81 1234 5678", igual que antes).
 *
 * Con ladas COMPARTIDAS (+1, +44, +7…) el país es el que la metadata le asigna
 * al número, que puede no ser el que el usuario eligió al guardarlo
 * (`07911 123456` guardado con Reino Unido vuelve como Guernsey). No se pierde
 * nada: el E.164 es el mismo, y la base no guarda el país. Si ni así se sabe
 * (un número que la metadata ya no reconoce), el primer país posible de su lada;
 * y si no se puede ni interpretar, México con los dígitos tal cual, en vez de
 * inventar una agrupación.
 */
export function separarE164(e164: string): { pais: CountryCode; nacional: string } {
  const n = parsePhoneNumberFromString(e164);
  if (!n) return { pais: PAIS_DEFAULT, nacional: e164.replace(/\D/g, '') };
  const pais = n.country ?? n.getPossibleCountries()[0] ?? PAIS_DEFAULT;
  return { pais, nacional: n.formatNational() };
}

/**
 * Si el usuario PEGA un número internacional ("+34 612 34 56 78") en el campo,
 * el país que ese número dice. `null` si el texto no empieza con `+` o no se
 * puede interpretar: entonces se queda el país que ya estaba elegido.
 */
export function paisDePegado(texto: string): { pais: CountryCode; nacional: string } | null {
  if (!texto.trim().startsWith('+')) return null;
  const n = parsePhoneNumberFromString(texto);
  if (!n) return null;
  const pais = n.country ?? n.getPossibleCountries()[0];
  if (!pais) return null;
  return { pais, nacional: n.formatNational() };
}

/**
 * Copy persistente de la variante "número no válido" de "Editar perfil" y
 * "Publicar (falta teléfono)". El país va en el texto porque el error depende
 * de él. Si cambia, cambia primero en `design/relevo-app.html`.
 */
export function copyTelefonoInvalido(nombrePais: string): string {
  return `Ese número no es válido para ${nombrePais}.`;
}
