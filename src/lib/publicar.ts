/**
 * Orquestación de alta y edición de publicaciones — la secuencia que toca
 * `listings`, Storage y `listing_photos` en el orden correcto.
 *
 * Vive aparte de las pantallas porque el orden de las llamadas ES la parte
 * delicada, y no debería estar enterrado en un handler de botón junto al
 * `setState`.
 *
 * LAS TRES REGLAS DE ORDEN, todas impuestas por la base y no por gusto:
 *
 *  1. **El listing va primero, siempre.** La carpeta del objeto es
 *     `{listing_id}/` y `listing_photos_objects_insert_own` exige que ese
 *     listing exista y sea del invocante. No hay forma de subir antes.
 *  2. **Subir el objeto, y recién entonces insertar su fila.** Al revés
 *     dejaría una fila apuntando a un objeto inexistente: una tarjeta rota en
 *     el feed. Un objeto sin fila solo cuesta almacenamiento.
 *  3. **Borrar objetos ANTES de borrar el listing.** La policy de delete de
 *     `storage.objects` exige que el listing exista para autorizar el borrado.
 */

import type { FotoEnEdicion, MotivoFallo } from '@/components/PhotoRow';
import {
  actualizarListing,
  cambiarEstadoListing,
  crearListing,
  guardarFotos,
  type ListingInput,
} from '@/lib/listings';
import {
  borrarFotos,
  FormatoNoSoportadoError,
  FotoDemasiadoGrandeError,
  MAX_BYTES,
  subirFoto,
} from '@/lib/storage';

export type ResultadoGuardado = {
  listingId: number;
  /**
   * El mismo set de fotos, con las que SÍ subieron convertidas a
   * `{origen:'storage'}` y las que fallaron marcadas con su `fallo`.
   *
   * Es la ÚNICA fuente de verdad sobre qué salió mal, y por eso no hay además
   * una lista `fallidas` aparte: una lista se desincronizaría en cuanto el
   * usuario quite una foto, y el aviso terminaría nombrando fotos que ya no
   * existen. Quien necesite recorrerlos usa `fallosDe()`.
   *
   * Hace también posible el reintento parcial sin lógica extra: la siguiente
   * pasada salta lo ya subido porque `subirPendientes` ignora las de origen
   * 'storage', y salta lo determinista por su marca.
   */
  fotos: FotoEnEdicion[];
  /**
   * Falló algo que NO pertenece a ninguna foto: `guardarFotos()` o la
   * activación. Llega por retorno y no como excepción a propósito — ver
   * `finalizarPublicacion`.
   */
  falloGeneral: boolean;
};

export type ProgresoFoto = { actual: number; total: number };

/** Un fallo con la posición 1-based que la foto ocupa AHORA en el formulario. */
export type FalloFoto = { pos: number; motivo: MotivoFallo };

/**
 * Los fallos del set actual, derivados en el momento.
 *
 * Se llama en cada render (no se guarda su resultado), que es lo que mantiene
 * las posiciones al día: quitar una foto renumera las demás y el aviso lo
 * refleja sin que nadie tenga que invalidar nada.
 */
export function fallosDe(fotos: FotoEnEdicion[]): FalloFoto[] {
  return fotos.flatMap((foto, i) =>
    foto.origen === 'local' && foto.fallo ? [{ pos: i + 1, motivo: foto.fallo }] : []
  );
}

/** Si este motivo se arregla reintentando o solo cambiando la foto. */
export function esDeterminista(motivo: MotivoFallo): boolean {
  return motivo === 'tamaño' || motivo === 'formato';
}

// ---------------------------------------------------------------------------
// El aviso
// ---------------------------------------------------------------------------

/** Join en español: `a`, `a y b`, `a, b y c`. */
function unir(frases: string[]): string {
  if (frases.length <= 1) return frases[0] ?? '';
  return `${frases.slice(0, -1).join(', ')} y ${frases[frases.length - 1]}`;
}

function mayuscula(frase: string): string {
  return frase.charAt(0).toUpperCase() + frase.slice(1);
}

/** `la foto 2` / `2 fotos`, según cuántas sean. */
function sujeto(fallos: FalloFoto[], singular: string, plural: string): string {
  return fallos.length === 1
    ? `la foto ${fallos[0].pos} ${singular}`
    : `${fallos.length} fotos ${plural}`;
}

const MB = Math.round(MAX_BYTES / (1024 * 1024));

/**
 * El texto del aviso, compuesto por partes.
 *
 * NO SE GUARDA: quien llama lo recalcula en cada render a partir de
 * `fallosDe(form.fotos)`. Guardarlo dejaría el aviso nombrando fotos que el
 * usuario ya quitó y —peor— con las posiciones corridas, porque quitar la foto 2
 * convierte la 4 en la 3.
 *
 * DOS BALDES, NO TRES, y el criterio no es de dónde viene el fallo sino qué
 * puede hacer el usuario: los deterministas se arreglan quitando la foto, y todo
 * lo demás —incluido `falloGeneral`, que no cuelga de ninguna foto— se arregla
 * reintentando. Por eso `falloGeneral` entra en el mismo balde que 'transporte'
 * en vez de necesitar un caso especial.
 *
 * El determinista va PRIMERO porque es el que trae una acción. Y el balde
 * transitorio no se puede omitir cuando ya hay frases deterministas, aunque
 * tiente por brevedad: es lo único que justifica que el botón siga ofreciendo
 * "Reintentar" (ver el CTA en `nueva.tsx`). Las dos mitades del texto se
 * corresponden una a una con las dos mitades del botón.
 */
export function componerAviso(fallos: FalloFoto[], falloGeneral: boolean): string | null {
  const det = fallos.filter((f) => esDeterminista(f.motivo));
  const transporte = fallos.filter((f) => f.motivo === 'transporte');

  if (det.length === 0 && transporte.length === 0 && !falloGeneral) return null;

  const partes: string[] = [];

  if (det.length > 0) {
    const porTamaño = det.filter((f) => f.motivo === 'tamaño');
    const porFormato = det.filter((f) => f.motivo === 'formato');

    const frases: string[] = [];
    if (porTamaño.length > 0) {
      frases.push(sujeto(porTamaño, `pesa más de ${MB} MB`, `pesan más de ${MB} MB`));
    }
    if (porFormato.length > 0) {
      frases.push(
        sujeto(
          porFormato,
          'está en un formato que no podemos usar',
          'están en un formato que no podemos usar'
        )
      );
    }

    const accion = det.length === 1 ? 'Quítala o elige otra' : 'Quítalas o elige otras';
    partes.push(`${mayuscula(unir(frases))}. ${accion}.`);
  }

  const transitorias: string[] = [];
  if (transporte.length > 0) {
    transitorias.push(sujeto(transporte, 'no subió', 'no subieron'));
  }
  if (falloGeneral) {
    transitorias.push('no pudimos guardar los cambios');
  }
  if (transitorias.length > 0) {
    partes.push(`${mayuscula(unir(transitorias))}, puede ser tu conexión.`);
  }

  return partes.join(' ');
}

/**
 * Un reintento, y solo para fallos que pueden ser de transporte.
 *
 * Ni un formato no soportado ni una foto demasiado grande se reintentan: el
 * bucket los va a rechazar las veces que haga falta —el archivo no cambia entre
 * intentos— y reintentar solo alarga la espera del usuario. Medido en
 * producción antes de esta distinción: un incidente de 6 toques generó 12
 * requests, la mitad de ellos condenados de antemano.
 */
async function subirConReintento(listingId: number, foto: FotoEnEdicion): Promise<string> {
  if (foto.origen !== 'local') return foto.path;

  try {
    return await subirFoto(listingId, foto);
  } catch (e) {
    if (e instanceof FormatoNoSoportadoError || e instanceof FotoDemasiadoGrandeError) throw e;
    return await subirFoto(listingId, foto);
  }
}

/** Traduce lo que lanzó la subida al motivo que se guarda en la foto. */
function motivoDe(e: unknown): MotivoFallo {
  if (e instanceof FotoDemasiadoGrandeError) return 'tamaño';
  if (e instanceof FormatoNoSoportadoError) return 'formato';
  return 'transporte';
}

/**
 * Sube las fotos locales de una lista y devuelve los paths que sí quedaron, en
 * el mismo orden, más las posiciones que fallaron y el set con las ya subidas
 * marcadas como `'storage'`.
 *
 * NO ESCRIBE FILAS DE `listing_photos`, y eso es deliberado. Insertarlas de a
 * una parece natural —subo, guardo su fila, sigo— pero el `orden` que calcula
 * cada foto colisiona en cuanto hay un reintento parcial: si de 3 fotos falla la
 * 2ª, las que quedaron toman `orden` 0 y 1; al reintentar, la foto 2 se
 * insertaría con `orden = 1`, que ya está tomado, y revienta contra
 * `unique (listing_id, orden)`. La única numeración correcta es la del set final
 * completo, así que las filas las escribe `guardarFotos()` de un golpe, después.
 * Si vuelves a ver un insert por foto aquí, es esa regresión.
 *
 * SALTA LAS QUE YA SE SABEN MALAS. Una foto que viene marcada con un `fallo`
 * determinista no vuelve a la red: se reporta con su mismo motivo y listo. Sin
 * esto, el caso mixto —una foto muy grande y otra que falló por conexión—
 * reintroduce el desperdicio que esta función existe para evitar, porque
 * "Reintentar" es legítimo por la segunda y arrastraría a la primera.
 */
async function subirPendientes(
  listingId: number,
  fotos: FotoEnEdicion[],
  onProgreso?: (p: ProgresoFoto) => void
): Promise<{ paths: string[]; hayFallos: boolean; fotos: FotoEnEdicion[] }> {
  const paths: string[] = [];
  const actualizadas: FotoEnEdicion[] = [];
  let hayFallos = false;

  for (let i = 0; i < fotos.length; i++) {
    const foto = fotos[i];
    onProgreso?.({ actual: i + 1, total: fotos.length });

    if (foto.origen === 'storage') {
      paths.push(foto.path);
      actualizadas.push(foto);
      continue;
    }

    if (foto.fallo && esDeterminista(foto.fallo)) {
      hayFallos = true;
      actualizadas.push(foto);
      continue;
    }

    let path: string;
    try {
      path = await subirConReintento(listingId, foto);
    } catch (e: any) {
      const motivo = motivoDe(e);
      console.warn(
        `[publicar] falló la subida de la foto ${i + 1} (${motivo}) — listing_id=${listingId} ` +
          `code=${e?.statusCode ?? e?.code ?? '?'} message=${e?.message ?? e}`
      );
      hayFallos = true;
      // Se queda local y con su motivo anotado: el reintento la vuelve a tomar
      // si fue de transporte, y la salta si no. Conservar su POSICIÓN es lo que
      // mantiene el orden que el usuario eligió para cuando por fin suba.
      actualizadas.push({ ...foto, fallo: motivo });
      continue;
    }

    paths.push(path);
    actualizadas.push({ origen: 'storage', path });
  }

  return { paths, hayFallos, fotos: actualizadas };
}

/**
 * RF-05, primer tramo del alta ATÓMICA: crea la publicación `pausada` y arranca
 * la subida.
 *
 * POR QUÉ NACE PAUSADA: la subida no puede ocurrir antes del insert (regla 1
 * arriba), así que la publicación existe durante un rato en el que todavía no se
 * sabe si va a tener sus fotos. Crearla `activa` la hace visible en el feed en
 * ese hueco, y si alguna foto falla queda publicada incompleta — que es el
 * modelo viejo, "publica ya, recupera fotos después". Naciendo `pausada` solo la
 * ve su dueño hasta que `finalizarPublicacion` la activa.
 *
 * `onListingCreado` no es un adorno: si la subida falla, quien llama NECESITA el
 * id para reintentar sobre la misma publicación. Devolverlo solo al final lo
 * perdería justo en el caso que lo necesita, y el reintento crearía una segunda.
 *
 * Si falla el `insert` del listing, propaga: ahí no se tocó Storage todavía, no
 * hay nada que limpiar, y el usuario se queda en su formulario intacto.
 */
export async function publicarListing(params: {
  input: ListingInput;
  userId: string;
  fotos: FotoEnEdicion[];
  onProgreso?: (p: ProgresoFoto) => void;
  onListingCreado?: (listingId: number) => void;
}): Promise<ResultadoGuardado> {
  const listingId = await crearListing(params.input, params.userId, 'pausada');
  params.onListingCreado?.(listingId);

  return finalizarPublicacion({
    listingId,
    fotos: params.fotos,
    onProgreso: params.onProgreso,
  });
}

/**
 * Segundo tramo del alta, y TAMBIÉN la entrada del reintento. Es idempotente a
 * propósito: correrla de nuevo sobre la misma publicación es el reintento.
 *
 *  1. Sube lo que falte (las de origen 'local'); las ya subidas se saltan solas.
 *  2. Escribe `listing_photos` con lo que haya, INCLUSO si algo falló.
 *  3. Si algo falló, devuelve sin activar: la publicación se queda `pausada`.
 *  4. Si no, la activa.
 *
 * EL PASO 2 CORRE TAMBIÉN EN EL CAMINO DE FALLO, y no es por prolijidad: sin él,
 * los objetos que sí subieron quedarían sin fila, y si el usuario abandona la
 * pantalla en el estado de error, "Mis publicaciones" no tendría de dónde leer
 * sus rutas para borrarlos (lee `listing_photos`) — huérfanos permanentes en un
 * bucket que se paga. Con las filas escritas, eliminar desde ahí limpia todo.
 *
 * NO PROPAGA el fallo del paso 2 ni el del 4: los devuelve en `falloGeneral`.
 * Tiene UN SOLO camino de retorno a propósito, y esto es lo que arregla: como el
 * paso 2 corre antes del early return, una excepción ahí se llevaba consigo el
 * resultado entero — y con él las marcas de las fotos que ya se sabían malas. La
 * pantalla nunca llegaba a guardarlas, el usuario veía solo el error genérico y
 * cada "Reintentar" volvía a subir la foto condenada. Reordenar no es opción
 * (rompe la regla de huérfanos de arriba), así que la salida es que la función
 * devuelva todo lo que sabe en vez de lanzarlo.
 *
 * Que sea idempotente cubre además esos mismos fallos: el mismo "Reintentar" los
 * resuelve — las subidas se saltan, el delete+insert se repite sin daño y
 * activar dos veces da lo mismo.
 */
export async function finalizarPublicacion(params: {
  listingId: number;
  fotos: FotoEnEdicion[];
  onProgreso?: (p: ProgresoFoto) => void;
}): Promise<ResultadoGuardado> {
  const { listingId } = params;

  const { paths, hayFallos, fotos } = await subirPendientes(
    listingId,
    params.fotos,
    params.onProgreso
  );

  try {
    await guardarFotos(listingId, paths);

    if (hayFallos) return { listingId, fotos, falloGeneral: false };

    // El trigger `listings_enforce_activation_has_photos` exige al menos una
    // fila en `listing_photos`, y el paso anterior es justo el que la garantiza.
    // El orden entre esas dos llamadas no es negociable.
    await cambiarEstadoListing(listingId, 'activa');
  } catch (e: any) {
    console.warn(
      `[publicar] no se pudo terminar de publicar — listing_id=${listingId} ` +
        `message=${e?.message ?? e}`
    );
    return { listingId, fotos, falloGeneral: true };
  }

  return { listingId, fotos, falloGeneral: false };
}

/**
 * RF-06. Actualiza campos y, si el set de fotos cambió, lo reescribe completo.
 *
 * El `if` de `fotosCambiaron` no es una optimización cosmética: `guardarFotos`
 * borra TODAS las filas antes de reinsertarlas (ver por qué en su propio
 * comentario — el trigger del tope de 5 hace inviable un upsert), y en esa
 * ventana la publicación queda sin fotos. Editar solo el precio no debe pagar
 * ese riesgo.
 *
 * A diferencia del alta, aquí un fallo parcial NO deja la publicación en un
 * estado a medio terminar: ya existía y ya era del usuario, así que se guarda lo
 * que se pudo y quien llama avisa. Tampoco toca `estado`: pausar y reactivar son
 * el toggle de la `.status-section`, no el guardado.
 */
export async function guardarEdicion(params: {
  listingId: number;
  input: ListingInput;
  fotos: FotoEnEdicion[];
  /** Los `storage_path` que tenía la publicación al abrir el formulario. */
  pathsOriginales: string[];
  fotosCambiaron: boolean;
  onProgreso?: (p: ProgresoFoto) => void;
}): Promise<ResultadoGuardado> {
  const { listingId } = params;

  await actualizarListing(listingId, params.input);

  if (!params.fotosCambiaron) {
    return { listingId, fotos: params.fotos, falloGeneral: false };
  }

  const { paths, fotos } = await subirPendientes(listingId, params.fotos, params.onProgreso);

  await guardarFotos(listingId, paths);

  // Recién ahora se borran los archivos de las fotos que el usuario quitó: si
  // se hiciera antes y el `guardarFotos` fallara, las filas seguirían
  // apuntando a objetos ya borrados.
  const sobrantes = params.pathsOriginales.filter((p) => !paths.includes(p));
  await borrarFotos(sobrantes);

  return { listingId, fotos, falloGeneral: false };
}
