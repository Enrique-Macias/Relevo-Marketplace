/**
 * Relevo — la lista de palabras prohibidas de RF-18.
 *
 * ES UNA SOLA LISTA, COMPARTIDA POR LOS DOS CAMINOS: el texto que teclea el
 * vendedor (título + descripción) y el que Vision saca por OCR de las fotos.
 * No dos listas. Dos copias de la misma regla se desincronizan sin dar ningún
 * error — es exactamente el acoplamiento que este repo ya documenta para
 * `formatPrecio` ↔ `private.formato_precio()` y para `congelada()` ↔ el `using`
 * de `listing_sales_update_seller` (CLAUDE.md §3).
 *
 * Lo que SÍ cambia entre los dos caminos es la CONSECUENCIA, no la lista: un
 * acierto en texto tecleado puede bloquear, uno vía OCR tiene techo en
 * `pendiente`. Esa asimetría vive en `decision.ts`, no aquí — este módulo solo
 * responde "¿qué palabras de la lista aparecen?".
 *
 * SIN IMPORTS, A PROPÓSITO. Este archivo y `decision.ts` son código puro, y eso
 * es lo que permite que `scripts/probe-moderacion.mjs` importe la
 * implementación REAL en vez de transcribirla. Ver la cabecera de ese script.
 */

/**
 * Semilla, no una lista cerrada. Crecerá con lo que aparezca en la cola de
 * revisión.
 *
 * TODO va en minúsculas y SIN acentos: `normalizar()` deja el texto de entrada
 * en esa forma antes de comparar, así que una entrada acentuada aquí no
 * machearía nunca. Es un fallo silencioso, y por eso hay una aserción que lo
 * vigila en el probe.
 *
 * ================================================================
 * LA REGLA DE ADMISIÓN: SOLO TÉRMINOS QUE NO NECESITAN CONTEXTO
 * ================================================================
 * Un acierto en texto TECLEADO bloquea automáticamente (`decision.ts`), así que
 * una entrada ambigua aquí no es un falso positivo molesto: es una publicación
 * legítima bloqueada sin que nadie la mire. Por eso la lista solo admite
 * términos que significan una cosa.
 *
 * EN ESPAÑOL, Y EN ESTE CATÁLOGO EN PARTICULAR, LAS ARMAS CASI TODAS FALLAN ESA
 * PRUEBA. La primera versión de esta lista las traía y el probe cazó la
 * primera; auditando salieron cuatro, y todas colisionan con cosas que un
 * estudiante de verdad vende:
 *
 *   · `granada`   → la fruta, y la ciudad (una guía de viaje de Granada)
 *   · `pistola`   → de silicón, de calor — manualidades y electrónica
 *   · `cartuchos` → de tinta, para impresora
 *   · `revolver`  → el verbo; `normalizar()` le quita el acento a "revólver",
 *                   así que "revolver la mezcla" queda idéntico al arma
 *
 * La frontera de palabra NO salva ninguno de esos: en los cuatro casos el
 * término aparece suelto y bien escrito. No hay patrón que los distinga, porque
 * lo que los distingue es el CONTEXTO.
 *
 * Y ahí está el reparto que justifica que existan los dos ejes: **lo que
 * necesita contexto es trabajo de GPT** (`articulo_prohibido`, que sí lee la
 * frase entera) **y de Vision** (un arma en la foto se ve). La lista es el eje
 * determinista y auditable precisamente porque no juzga: solo reconoce
 * términos que no admiten otra lectura. Si alguien vuelve a agregar `pistola`
 * "porque obviamente es un arma", el probe lo caza.
 */
const PALABRAS: readonly string[] = [
  // Sustancias — nombres que no significan otra cosa
  'cocaina',
  'marihuana',
  'mariguana',
  'metanfetamina',
  'fentanilo',
  'heroina',
  'lsd',
  'mdma',
  // Armas — solo lo inequívoco. Ver la regla de admisión arriba.
  'arma de fuego',
  'municiones',
  // Medicamento controlado — nombres genéricos, sin otra lectura
  'clonazepam',
  'alprazolam',
  'tramadol',
  'oxicodona',
  // Fraude académico — específico de un marketplace entre estudiantes, y por
  // eso no lo trae ninguna lista genérica. Van como FRASE: "tareas" o "tesis"
  // sueltas son media conversación de este catálogo.
  'vendo examen',
  'venta de examen',
  'resuelvo tareas',
  'hago tareas',
  'hago tu tesis',
  'titulo falso',
  'certificado falso',
  // Falsificación
  'tarjetas clonadas',
  'replica aaa',
  'fayuca',
];

/**
 * Los términos que se PROBARON y se descartaron por ambiguos. No es
 * documentación: el probe afirma que ninguno está en `PALABRAS`, para que
 * volver a agregarlos sea un fallo y no un descuido.
 */
export const DESCARTADOS_POR_AMBIGUOS: readonly string[] = [
  'granada',
  'pistola',
  'cartuchos',
  'revolver',
];

/**
 * Minúsculas y sin diacríticos.
 *
 * El `NFD` + quitar marcas combinantes es lo que hace que `Cocaína` y `cocaina`
 * sean el mismo texto — y de paso convierte `ñ` en `n`, porque `ñ` se
 * descompone en `n` + tilde combinante. Eso NO es un efecto colateral molesto:
 * deja el texto en ASCII, que es justo lo que hace seguro usar `\b` más abajo
 * (`\b` trata a `ñ` como frontera de palabra y partiría cualquier término que
 * la llevara).
 */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Escapa lo que sea metacarácter de regex antes de armar el patrón. */
function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * EL PATRÓN VA CON FRONTERA DE PALABRA (`\b`), Y NO ES PRECAUCIÓN TEÓRICA.
 *
 * Con un `includes()` a secas, `pistola` no macharía nada raro pero `granada`
 * caza "Granada" (la ciudad), `lsd` caza cualquier cosa que lleve esas tres
 * letras seguidas, y una lista que creciera con palabras cortas empezaría a
 * cazar dentro de palabras legítimas — `arma` dentro de `armario`, `alarma`,
 * `armado`. Es la misma familia del gotcha de §9 sobre el comodín de búsqueda
 * reemplazado por un espacio: la pregunta correcta no es "¿está el término?"
 * sino "¿qué tan seguido aparece ese término DENTRO de texto legítimo?".
 *
 * Se arma una sola vez a nivel de módulo: la Edge Function lo usa por cada foto
 * y por cada publicación, y recompilar el regex en cada llamada sería gratis de
 * escribir y caro de correr.
 */
const PATRON = new RegExp(
  `\\b(${PALABRAS.map(escapar).join('|')})\\b`,
  'g'
);

/**
 * Las palabras de la lista que aparecen en el texto, sin repetir.
 *
 * Devuelve CUÁLES y no un booleano a propósito: el revisor humano en Studio
 * necesita poder ver qué disparó el veredicto, y "la lista dio positivo" no se
 * lo dice. Es la ventaja que la lista tiene sobre el veredicto de GPT —
 * determinista y señalable— y se perdería devolviendo solo `true`.
 */
export function coincidencias(texto: string): string[] {
  if (!texto) return [];
  const encontradas = new Set<string>();
  for (const m of normalizar(texto).matchAll(PATRON)) {
    encontradas.add(m[1]);
  }
  return [...encontradas];
}

/** Solo para el probe: que nadie meta una entrada acentuada o en mayúsculas. */
export const PALABRAS_PARA_PRUEBA: readonly string[] = PALABRAS;
