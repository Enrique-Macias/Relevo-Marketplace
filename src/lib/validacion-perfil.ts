/**
 * Las reglas de captura del perfil, del lado del cliente.
 *
 * El candado vive en la base: el `check` `users_nombre_valido` (migración
 * 20260927000469). Este módulo NO decide nada: normaliza lo que el usuario
 * teclea y le dice ANTES de guardar si la base lo va a rechazar, para pintar el
 * `.field-error` del frame en vez de un rechazo crudo (CLAUDE.md §0 regla 7).
 *
 * Sin imports a propósito, mismo patrón que `registro.ts`:
 * `scripts/probe-perfil.mjs` lo carga desde Node y corre los MISMOS casos
 * contra el check real. Ese es el amarre entre las dos copias de la regla.
 */

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
