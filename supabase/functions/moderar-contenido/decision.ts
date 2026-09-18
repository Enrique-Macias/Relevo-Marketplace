/**
 * Relevo — la función de decisión de RF-18.
 *
 * AQUÍ VIVEN TODOS LOS UMBRALES, en un solo lugar y sin red de por medio. Es
 * deliberado: es la pieza que decide si una publicación se ve o no, así que
 * tiene que ser la más fácil de probar de todo el flujo. No importa nada —ni
 * Supabase, ni Vision, ni OpenAI— y por eso `scripts/probe-moderacion.mjs`
 * puede importar ESTA implementación en vez de transcribirla.
 *
 * La spec de la que sale está en CLAUDE.md §3, bloque RF-18. Si cambias un
 * umbral aquí, ese bloque deja de ser cierto.
 */

// ---------------------------------------------------------------------------
// Niveles
// ---------------------------------------------------------------------------

/**
 * Tres niveles, no cinco. Vision trae una escala nativa de cinco
 * (`VERY_UNLIKELY … VERY_LIKELY`) pero GPT no, y fingir cinco niveles
 * calibrados en un LLM es precisión falsa. Se colapsa a lo que de verdad
 * tiene consecuencia distinta.
 */
export type Nivel = 'limpio' | 'revisar' | 'bloquear';

const SEVERIDAD: Record<Nivel, number> = {
  limpio: 0,
  revisar: 1,
  bloquear: 2,
};

/**
 * El peor de los niveles dados.
 *
 * ES EL OPERADOR DE TODO ESTE MÓDULO, y la propiedad que garantiza es la que
 * importa: **ningún eje puede absolver a otro**. Un veredicto limpio de GPT no
 * rescata un acierto de la lista de palabras, ni al revés.
 */
export function peor(...niveles: Nivel[]): Nivel {
  let out: Nivel = 'limpio';
  for (const n of niveles) {
    if (SEVERIDAD[n] > SEVERIDAD[out]) out = n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Vision
// ---------------------------------------------------------------------------

/** La escala de SafeSearch, tal cual la devuelve Google Cloud Vision. */
export type Likelihood =
  | 'UNKNOWN'
  | 'VERY_UNLIKELY'
  | 'UNLIKELY'
  | 'POSSIBLE'
  | 'LIKELY'
  | 'VERY_LIKELY';

/**
 * Las TRES categorías que miramos. `spoof` y `medical` quedan fuera a
 * propósito (CLAUDE.md §3): `spoof` no es una señal de seguridad —mide si la
 * imagen es una versión alterada de una canónica— y `medical` es una fábrica
 * de falsos positivos en ESTE catálogo, donde se venden libros de anatomía,
 * batas, estetoscopios y muletas.
 */
export type SafeSearch = {
  adult: Likelihood;
  violence: Likelihood;
  racy: Likelihood;
};

/**
 * `VERY_LIKELY → bloquear`, `LIKELY → revisar`, el resto pasa.
 *
 * `UNKNOWN` se trata como limpio y no como sospechoso: es "no pude evaluar",
 * no "encontré algo". Tratarlo como señal mandaría a revisión cada imagen que
 * Vision no supo clasificar.
 */
export function nivelDeSafeSearch(ss: SafeSearch): Nivel {
  const deUna = (l: Likelihood): Nivel =>
    l === 'VERY_LIKELY' ? 'bloquear' : l === 'LIKELY' ? 'revisar' : 'limpio';
  return peor(deUna(ss.adult), deUna(ss.violence), deUna(ss.racy));
}

// ---------------------------------------------------------------------------
// Texto (GPT-4o-mini)
// ---------------------------------------------------------------------------

/** Lo que el Structured Output de GPT devuelve por categoría. */
export type Grado = 'ninguno' | 'posible' | 'claro';

export type VeredictoTexto = {
  contenido_sexual: Grado;
  violencia: Grado;
  odio_discriminacion: Grado;
  articulo_prohibido: Grado;
  estafa_spam: Grado;
  /** Teléfono, correo, @usuario, `wa.me/…`. Ver el techo abajo. */
  datos_contacto: Grado;
};

const deGrado = (g: Grado): Nivel =>
  g === 'claro' ? 'bloquear' : g === 'posible' ? 'revisar' : 'limpio';

/**
 * `datos_contacto` TIENE TECHO EN `revisar`: nunca bloquea, por muy `claro` que
 * lo vea el modelo.
 *
 * Existe porque un vendedor que escriba su WhatsApp en la descripción salta
 * entero el control de `seller_whatsapp()`, que valida suspensión en las dos
 * direcciones (CLAUDE.md §3). Pero un número de modelo, un año o una talla lo
 * disparan igual, así que bloquear por esto sería castigar publicaciones
 * legítimas con altísima frecuencia.
 */
export function nivelDeTexto(v: VeredictoTexto): Nivel {
  return peor(
    deGrado(v.contenido_sexual),
    deGrado(v.violencia),
    deGrado(v.odio_discriminacion),
    deGrado(v.articulo_prohibido),
    deGrado(v.estafa_spam),
    techo(deGrado(v.datos_contacto), 'revisar')
  );
}

/** Baja un nivel hasta el máximo permitido. */
function techo(n: Nivel, maximo: Nivel): Nivel {
  return SEVERIDAD[n] > SEVERIDAD[maximo] ? maximo : n;
}

// ---------------------------------------------------------------------------
// Lista de palabras
// ---------------------------------------------------------------------------

/**
 * El acierto de lista según DÓNDE apareció.
 *
 * Misma lista, distinta consecuencia, y la razón es la intención: teclear una
 * palabra en la descripción es deliberado; que Vision la lea de la portada de
 * un libro, de un póster de fondo o de una playera es incidental. Igualar las
 * dos consecuencias convierte el ruido del OCR en bloqueos.
 *
 * EL TECHO NO ABRE UN HUECO, que es la objeción obvia: el caso de evasión
 * —escribir el texto prohibido DENTRO de la imagen para esquivar la moderación
 * de texto— sigue cayendo en `revisar`, y `revisar` no es "publicado" sino "no
 * se publica hasta que una persona lo mire". El evasor no gana nada.
 */
export function nivelDeLista(
  aciertos: string[],
  origen: 'tecleado' | 'ocr'
): Nivel {
  if (aciertos.length === 0) return 'limpio';
  return origen === 'tecleado' ? 'bloquear' : 'revisar';
}

// ---------------------------------------------------------------------------
// La decisión
// ---------------------------------------------------------------------------

export type EstadoListing =
  | 'activa'
  | 'pausada'
  | 'vendida'
  | 'pendiente'
  | 'bloqueada';

/** Los cuatro ejes, ya reducidos a nivel. Ninguno absuelve a los otros. */
export type Ejes = {
  /** Peor de las TRES categorías sobre TODAS las fotos. */
  vision: Nivel;
  /** Veredicto de GPT sobre título + descripción. */
  gptTexto: Nivel;
  /** Lista contra el texto tecleado. */
  listaTecleada: Nivel;
  /** Lista contra el texto de OCR. Ya viene con su techo aplicado. */
  listaOcr: Nivel;
};

export function veredicto(ejes: Ejes): Nivel {
  return peor(ejes.vision, ejes.gptTexto, ejes.listaTecleada, ejes.listaOcr);
}

/**
 * El estado en el que debe quedar la publicación.
 *
 * REGLA DEL PISO — el estado actual nunca baja de nivel. Es lo que hace que una
 * escalada del trigger de Storage sobreviva a la llamada final: si el trigger
 * ya bloqueó por una foto sucia, una llamada final con el texto limpio NO
 * devuelve la publicación a `activa`. **`bloqueada → activa` no ocurre por
 * ningún camino.**
 *
 * Y la parte asimétrica, que es la menos obvia (CLAUDE.md §3):
 *
 *  - `bloquear` escala desde CUALQUIER estado, `vendida` y `pausada`
 *    incluidas. Una vendida la ve el campus entero, así que el contenido
 *    sucio sigue expuesto; escalarla no toca `listing_sales`, la venta vive
 *    en otra tabla. `bloqueada` no se promueve nunca, así que escalar una
 *    `pausada` a `bloqueada` no abre ningún camino de vuelta a `activa` — el
 *    riesgo de abajo no aplica aquí, solo aplica a `revisar`.
 *  - `revisar` **NO escala ni `pausada` ni `vendida`.** Las dos tienen el
 *    mismo carve-out y por la MISMA razón, que no es simetría cosmética: la
 *    promoción a `activa` sale ÚNICAMENTE de `pendiente` (la regla de abajo),
 *    así que escalar cualquier otro estado A `pendiente` abre una vía de
 *    vuelta a `activa` que no debería existir para un estado que no es de
 *    moderación. Se pensó primero solo para `vendida` ("no puede volver a ser
 *    pública") y se escribió aquí mismo, en una versión anterior de este
 *    comentario, que `pausada` SÍ debía escalar con `revisar` —"si no, pausar
 *    sería un escondite"— sin ver la consecuencia: `pausada` →(revisar)→
 *    `pendiente` →(una foto más, veredicto limpio)→ **`activa`**, publicando
 *    sola una publicación que el vendedor pausó a propósito. Es el mismo
 *    invariante que protege a `vendida`, y con `pausada` faltaba aplicarlo.
 *    **Consecuencia que SÍ queda abierta, a propósito:** un acierto de nivel
 *    `revisar` sobre una publicación pausada no dispara ninguna cola — se
 *    queda sin marcar hasta que algo más la toque (`bloquear` si empeora, o
 *    el vendedor la reactiva a mano). No hay urgencia real: mientras está
 *    pausada, nadie la ve.
 *  - La promoción a `activa` ocurre ÚNICAMENTE desde `pendiente`. `pausada` y
 *    `vendida` no son estados de moderación sino decisiones del vendedor:
 *    promoverlos despausaría la publicación de alguien que la pausó a
 *    propósito, o resucitaría una venta.
 *
 * OJO AL LLAMAR: si el resultado es igual al estado actual, NO escribas. Un
 * UPDATE que no cambia nada igual dispara `set_updated_at` y el vendedor vería
 * "modificada hoy" algo que nadie modificó — es la lección de T23 (b).
 */
export function decidirListing(
  ejes: Ejes,
  estadoActual: EstadoListing
): EstadoListing {
  const v = veredicto(ejes);

  if (v === 'bloquear') return 'bloqueada';

  if (v === 'revisar') {
    if (estadoActual === 'bloqueada') return 'bloqueada'; // el piso
    if (estadoActual === 'vendida') return 'vendida'; // terminal, no se toca
    if (estadoActual === 'pausada') return 'pausada'; // decisión del vendedor, no se toca
    return 'pendiente'; // activa | pendiente
  }

  // Limpio: el único camino de promoción.
  return estadoActual === 'pendiente' ? 'activa' : estadoActual;
}

// ---------------------------------------------------------------------------
// Avatares
// ---------------------------------------------------------------------------

/**
 * Qué hacer con el avatar. Binario, y **solo `bloquear` borra**.
 *
 * Un `revisar` NO HACE NADA, y no es un olvido: no hay dónde encolarlo —`users`
 * no tiene columna de estado para la foto y el bucket es público, así que no
 * existe un "subido pero no visible"— y se prefiere el riesgo de un avatar
 * dudoso sin resolver antes que borrar contenido legítimo sin poder revertirlo.
 *
 * El texto no participa: un avatar no tiene título ni descripción. Los ejes que
 * llegan son los de imagen (`vision`, `listaOcr`).
 */
export function decidirAvatar(ejes: Pick<Ejes, 'vision' | 'listaOcr'>): 'conservar' | 'borrar' {
  return peor(ejes.vision, ejes.listaOcr) === 'bloquear' ? 'borrar' : 'conservar';
}
