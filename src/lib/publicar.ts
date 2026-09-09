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
  crearListing,
  guardarFotos,
  insertarFoto,
  type ListingInput,
} from '@/lib/listings';
import { borrarFotos, FormatoNoSoportadoError, subirFoto } from '@/lib/storage';

export type ResultadoGuardado = {
  listingId: number;
  /** Posiciones 1-based de las fotos que no se pudieron subir. Vacío = todo bien. */
  fallidas: number[];
  /** Cuántas fotos se intentaron, para poder decir "2 de 4". */
  totalFotos: number;
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
 * Sube las fotos locales de una lista y devuelve los paths que sí quedaron,
 * en el mismo orden, más las posiciones que fallaron.
 *
 * Cuando la subida sale bien pero el insert de la fila falla, el objeto recién
 * subido se borra: así la ventana en la que existe un huérfano dura una
 * llamada, no para siempre.
 */
async function subirPendientes(
  listingId: number,
  fotos: FotoEnEdicion[],
  insertarFila: boolean,
  onProgreso?: (p: ProgresoFoto) => void
): Promise<{ paths: string[]; fallidas: number[] }> {
  const paths: string[] = [];
  const fallidas: number[] = [];

  for (let i = 0; i < fotos.length; i++) {
    const foto = fotos[i];
    onProgreso?.({ actual: i + 1, total: fotos.length });

    if (foto.origen === 'storage') {
      paths.push(foto.path);
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
      continue;
    }

    if (insertarFila) {
      try {
        // `orden` es la posición entre las que SÍ quedaron, no el índice
        // original: si la foto 2 falla, las demás siguen siendo 0,1,2 y no
        // dejan un hueco que la columna (check 0..4, unique por listing) no
        // necesita tolerar.
        await insertarFoto(listingId, path, paths.length);
      } catch (e: any) {
        console.warn(
          `[publicar] subió la foto ${i + 1} pero falló su fila — listing_id=${listingId} ` +
            `path=${path} message=${e?.message ?? e}`
        );
        await borrarFotos([path]);
        fallidas.push(i + 1);
        continue;
      }
    }

    paths.push(path);
  }

  return { paths, fallidas };
}

/**
 * RF-05. Crea la publicación y sube sus fotos.
 *
 * NO HACE ROLLBACK si alguna foto falla, y es deliberado: borrar el listing
 * destruiría todo lo que el usuario escribió y ni siquiera sería un rollback
 * limpio, porque el `on delete cascade` se lleva las filas de `listing_photos`
 * pero no los archivos ya subidos. Sería perder el contenido *y* dejar
 * huérfanos. La publicación queda activa y quien llama informa qué faltó.
 *
 * Si falla el `insert` del listing sí propaga: ahí no se tocó Storage todavía,
 * no hay nada que limpiar, y el usuario se queda en su formulario intacto.
 */
export async function publicarListing(params: {
  input: ListingInput;
  userId: string;
  fotos: FotoEnEdicion[];
  onProgreso?: (p: ProgresoFoto) => void;
}): Promise<ResultadoGuardado> {
  const listingId = await crearListing(params.input, params.userId);

  const { fallidas } = await subirPendientes(listingId, params.fotos, true, params.onProgreso);

  return { listingId, fallidas, totalFotos: params.fotos.length };
}

/**
 * RF-06. Actualiza campos y, si el set de fotos cambió, lo reescribe completo.
 *
 * El `if` de `fotosCambiaron` no es una optimización cosmética: `guardarFotos`
 * borra TODAS las filas antes de reinsertarlas (ver por qué en su propio
 * comentario — el trigger del tope de 5 hace inviable un upsert), y en esa
 * ventana la publicación queda sin fotos. Editar solo el precio no debe pagar
 * ese riesgo.
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
    return { listingId, fallidas: [], totalFotos: 0 };
  }

  // `insertarFila: false` — aquí las filas no se insertan de a una, las
  // reescribe `guardarFotos` de un golpe con el orden final ya conocido.
  const { paths, fallidas } = await subirPendientes(
    listingId,
    params.fotos,
    false,
    params.onProgreso
  );

  await guardarFotos(listingId, paths);

  // Recién ahora se borran los archivos de las fotos que el usuario quitó: si
  // se hiciera antes y el `guardarFotos` fallara, las filas seguirían
  // apuntando a objetos ya borrados.
  const sobrantes = params.pathsOriginales.filter((p) => !paths.includes(p));
  await borrarFotos(sobrantes);

  const locales = params.fotos.filter((f) => f.origen === 'local').length;
  return { listingId, fallidas, totalFotos: locales };
}
