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

import type { FotoEnEdicion } from '@/components/PhotoRow';
import {
  actualizarListing,
  cambiarEstadoListing,
  crearListing,
  guardarFotos,
  type ListingInput,
} from '@/lib/listings';
import { borrarFotos, FormatoNoSoportadoError, subirFoto } from '@/lib/storage';

export type ResultadoGuardado = {
  listingId: number;
  /** Posiciones 1-based de las fotos que no se pudieron subir. Vacío = todo bien. */
  fallidas: number[];
  /** Cuántas fotos se intentaron, para poder decir "2 de 4". */
  totalFotos: number;
  /**
   * El mismo set de fotos, con las que SÍ subieron ya convertidas a
   * `{origen:'storage'}`. Es lo que hace posible el reintento parcial: quien
   * llama guarda esto en su formulario y la siguiente pasada salta lo ya subido
   * sin lógica extra, porque `subirPendientes` ignora las de origen 'storage'.
   */
  fotos: FotoEnEdicion[];
};

export type ProgresoFoto = { actual: number; total: number };

/**
 * Un reintento, y solo para fallos que pueden ser de transporte.
 *
 * Un formato no soportado no se reintenta: el bucket lo va a rechazar las veces
 * que haga falta, y reintentar solo alarga la espera del usuario.
 */
async function subirConReintento(listingId: number, foto: FotoEnEdicion): Promise<string> {
  if (foto.origen !== 'local') return foto.path;

  try {
    return await subirFoto(listingId, foto);
  } catch (e) {
    if (e instanceof FormatoNoSoportadoError) throw e;
    return await subirFoto(listingId, foto);
  }
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
 */
async function subirPendientes(
  listingId: number,
  fotos: FotoEnEdicion[],
  onProgreso?: (p: ProgresoFoto) => void
): Promise<{ paths: string[]; fallidas: number[]; fotos: FotoEnEdicion[] }> {
  const paths: string[] = [];
  const fallidas: number[] = [];
  const actualizadas: FotoEnEdicion[] = [];

  for (let i = 0; i < fotos.length; i++) {
    const foto = fotos[i];
    onProgreso?.({ actual: i + 1, total: fotos.length });

    if (foto.origen === 'storage') {
      paths.push(foto.path);
      actualizadas.push(foto);
      continue;
    }

    let path: string;
    try {
      path = await subirConReintento(listingId, foto);
    } catch (e: any) {
      console.warn(
        `[publicar] falló la subida de la foto ${i + 1} — listing_id=${listingId} ` +
          `code=${e?.statusCode ?? e?.code ?? '?'} message=${e?.message ?? e}`
      );
      fallidas.push(i + 1);
      // Se queda como estaba: sigue siendo local, y el reintento la vuelve a
      // tomar. Conservar su posición es lo que mantiene el orden que el usuario
      // eligió cuando la subida por fin funcione.
      actualizadas.push(foto);
      continue;
    }

    paths.push(path);
    actualizadas.push({ origen: 'storage', path });
  }

  return { paths, fallidas, fotos: actualizadas };
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
 * Que sea idempotente cubre además los fallos que NO son de subida: si revienta
 * `guardarFotos` o la activación, el mismo "Reintentar" los resuelve — las
 * subidas se saltan, el delete+insert se repite sin daño y activar dos veces da
 * lo mismo.
 */
export async function finalizarPublicacion(params: {
  listingId: number;
  fotos: FotoEnEdicion[];
  onProgreso?: (p: ProgresoFoto) => void;
}): Promise<ResultadoGuardado> {
  const { listingId } = params;

  const { paths, fallidas, fotos } = await subirPendientes(
    listingId,
    params.fotos,
    params.onProgreso
  );

  await guardarFotos(listingId, paths);

  const resultado: ResultadoGuardado = {
    listingId,
    fallidas,
    totalFotos: params.fotos.length,
    fotos,
  };

  if (fallidas.length > 0) return resultado;

  // El trigger `listings_enforce_activation_has_photos` exige al menos una fila
  // en `listing_photos`, y el paso anterior es justo el que la garantiza. El
  // orden entre esas dos llamadas no es negociable.
  await cambiarEstadoListing(listingId, 'activa');

  return resultado;
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
    return { listingId, fallidas: [], totalFotos: 0, fotos: params.fotos };
  }

  const { paths, fallidas, fotos } = await subirPendientes(
    listingId,
    params.fotos,
    params.onProgreso
  );

  await guardarFotos(listingId, paths);

  // Recién ahora se borran los archivos de las fotos que el usuario quitó: si
  // se hiciera antes y el `guardarFotos` fallara, las filas seguirían
  // apuntando a objetos ya borrados.
  const sobrantes = params.pathsOriginales.filter((p) => !paths.includes(p));
  await borrarFotos(sobrantes);

  const locales = params.fotos.filter((f) => f.origen === 'local').length;
  return { listingId, fallidas, totalFotos: locales, fotos };
}
