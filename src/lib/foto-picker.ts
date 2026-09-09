/**
 * Selección de fotos del carrete (RF-05), y su normalización.
 *
 * Vive aparte de `storage.ts` a propósito: elegir una foto y subirla son dos
 * momentos distintos del flujo —y en Publicar están separados por la creación
 * del listing, que es lo único que habilita la subida— así que mezclarlos en un
 * módulo invitaría a acoplarlos.
 */

import {
  ImageManipulator,
  SaveFormat,
  type ImageManipulatorContext,
  type ImageRef,
} from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { FotoElegida } from '@/components/PhotoRow';
import { formatoSoportado } from '@/lib/storage';

export class PermisoDenegadoError extends Error {
  constructor() {
    super('Sin permiso para leer el carrete');
    this.name = 'PermisoDenegadoError';
  }
}

/**
 * EL AJUSTE QUE HACE QUE LAS FOTOS DE UN iPHONE FUNCIONEN. No lo quites.
 *
 * La cámara del iPhone guarda en HEIC, y el bucket solo acepta jpeg/png/webp.
 * Sin esta opción, elegir una foto tomada con el teléfono falla de dos maneras
 * distintas, ambas vistas en dispositivo real:
 *   · `FailedToReadImageException: Cannot load representation of type
 *     public.heic` al leerla, o
 *   · si sí se lee, llega con `mimeType: image/heic` y el Storage la rechaza.
 *
 * POR QUÉ, leído en el código nativo del paquete instalado
 * (`expo-image-picker@57.0.16`) y no en sus docs, que aquí se contradicen:
 *
 *  1. `ios/ImagePickerOptions.swift:44` — el default REAL es
 *     `.current`, no `.automatic` como afirma el JSDoc de
 *     `ImagePicker.types.d.ts`. Y `.current` significa literalmente "usa la
 *     representación actual para evitar transcodificar": entrega el HEIC crudo.
 *  2. `ios/ImageUtils.swift`, `readDataAndFileExtension()` — el switch sobre
 *     `itemProvider.registeredTypeIdentifiers.first` tiene una rama explícita
 *     `case UTType.heic.identifier: return (rawData, ".heic")`. O sea que el
 *     HEIC sale tal cual **sin importar el `quality`**: la conversión a JPEG
 *     solo ocurre en la rama `default`.
 *
 * `.compatible` mapea a `PHPickerConfiguration.AssetRepresentationMode.compatible`
 * (`ImagePickerOptions.swift:142`), con lo que iOS entrega una representación
 * JPEG: `registeredTypeIdentifiers.first` pasa a ser `public.jpeg`, cae en el
 * `default` del switch y sale `.jpg`. De paso desaparece el
 * `FailedToReadImageException`, que venía de pedirle al sistema una
 * representación HEIC que no siempre puede vender (típico con fotos en iCloud
 * con "Optimizar almacenamiento").
 *
 * Es iOS-only; en Android el campo se ignora sin efecto.
 */
const MODO_REPRESENTACION = ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible;

/**
 * Lado mayor al que se encoge una foto antes de subirla.
 *
 * El frame mide 375 pt de ancho (`.device` en `relevo-app.html`) y la imagen
 * más grande que la app llega a pintar es el hero de Detalle a ancho completo:
 * 1125 px en un dispositivo 3x. 1600 deja margen sin ser gratis.
 */
const LADO_MAXIMO = 1600;

/** Compresión JPEG de salida. `1` = sin comprimir, `0` = máxima compresión. */
const CALIDAD_JPEG = 0.8;

/**
 * Deja la foto lista para el bucket: JPEG comprimido y, si hace falta, encogida.
 *
 * POR QUÉ EXISTE, y por qué el `quality` del picker no basta: el bucket tiene un
 * `file_size_limit` de 5 MiB y lo aplica el servicio de Storage, no el cliente.
 * Un screenshot de iPhone es un PNG de 6+ MB y **el `quality` del picker no le
 * hace absolutamente nada** — en `expo-image-picker@57.0.16`,
 * `ios/ImageUtils.swift:130-132`, la rama de PNG es `image.pngData()`, sin
 * parámetro de compresión; `options.quality` solo se aplica en la rama
 * `default`, vía `image.jpegData(compressionQuality:)`. O sea que cualquier
 * screenshot fallaba SIEMPRE con `EntityTooLarge`, y no por mala suerte. Es
 * hermano del gotcha de HEIC/`quality` de CLAUDE.md §9: misma falsa premisa,
 * otra rama del mismo `switch`.
 *
 * SIEMPRE SALE JPEG, sin condicionar. De los tres formatos que acepta el bucket
 * es el único donde la perilla de compresión de verdad reduce bytes: PNG es sin
 * pérdida (esa ES la causa raíz) y el soporte de WEBP es desigual entre
 * plataformas. La transparencia que se pierde no aplica a fotos de producto.
 *
 * EL RESIZE ES CONDICIONAL y el `width`/`height` del asset puede venir en 0
 * (`ImagePicker.types.d.ts:248-254` lo advierte). Cuando no se conocen las
 * dimensiones NO se redimensiona: pasarle solo `width` a `resize()` escalaría
 * hacia ARRIBA una foto más angosta que el tope, que es peor que no tocarla. El
 * re-encode por sí solo ya resuelve el caso que motivó todo esto.
 *
 * Si algo falla se devuelve la URI original en vez de descartar la foto: puede
 * que ya fuera lo bastante chica. Quien la sube distingue el fallo determinista
 * y lo reporta con su motivo (ver `subirFoto`), así que hay red abajo.
 */
async function normalizar(asset: ImagePicker.ImagePickerAsset): Promise<FotoElegida> {
  let contexto: ImageManipulatorContext | null = null;
  let render: ImageRef | null = null;

  try {
    contexto = ImageManipulator.manipulate(asset.uri);

    const ladoMayor = Math.max(asset.width, asset.height);
    if (ladoMayor > LADO_MAXIMO) {
      // Se fija SOLO el lado mayor; el otro lo calcula el módulo conservando la
      // proporción (`ImageManipulatorContext.resize`).
      contexto.resize(
        asset.width >= asset.height ? { width: LADO_MAXIMO } : { height: LADO_MAXIMO }
      );
    }

    render = await contexto.renderAsync();
    const salida = await render.saveAsync({ format: SaveFormat.JPEG, compress: CALIDAD_JPEG });

    return { origen: 'local', uri: salida.uri, mimeType: 'image/jpeg' };
  } catch (e: any) {
    console.warn(`[picker] no se pudo normalizar la foto: ${e?.message ?? e}`);
    return { origen: 'local', uri: asset.uri, mimeType: asset.mimeType };
  } finally {
    // Son objetos nativos (`SharedObject`). Los creados por hooks se liberan
    // solos; estos son imperativos, así que se liberan a mano — importa al
    // recorrer hasta 5 fotos seguidas.
    render?.release();
    contexto?.release();
  }
}

/**
 * Abre el carrete y devuelve las fotos elegidas, como máximo `disponibles`, ya
 * normalizadas.
 *
 * `quality: 1` en el picker NO es un descuido: la compresión la hace
 * `normalizar()` una sola vez. Dejarlo en 0.8 encadenaría dos pasadas con
 * pérdida sobre la misma foto sin ganar nada. Y con `quality >= 1.0` el picker
 * ni siquiera re-codifica —`ImageUtils.swift` devuelve `rawData` tal cual en su
 * rama `default`—, así que además es el camino rápido.
 *
 * `fotos` vacío y `descartadas: 0` = el usuario canceló, que no es un error.
 *
 * `descartadas` cuenta las que llegaron en un formato que el bucket no acepta.
 * Con `.compatible` esto no debería pasar nunca, y justamente por eso se
 * reporta AL ELEGIR y no al subir: si vuelve a ocurrir, el usuario se entera en
 * el momento —con la foto todavía a la vista y pudiendo elegir otra— en vez de
 * descubrir después de publicar que le faltó una. Es la red por si aparece un
 * formato que no previmos (un TIFF traído de iCloud, un AVIF de Android nuevo),
 * no la defensa principal.
 *
 * EL ORDEN IMPORTA: se filtra por formato ANTES de normalizar. Al revés, el
 * manipulator convertiría ese TIFF a JPEG y este filtro quedaría muerto — pero
 * si el manipulator falla justo con ese formato exótico, caeríamos a la URI
 * original y subiríamos algo que el bucket rechaza, con el error apareciendo
 * lejos de su causa (CLAUDE.md §9). Filtrar primero conserva la garantía.
 */
export type Seleccion = { fotos: FotoElegida[]; descartadas: number };

export async function elegirFotos(disponibles: number): Promise<Seleccion> {
  const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permiso.granted) throw new PermisoDenegadoError();

  const resultado = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: disponibles > 1,
    selectionLimit: disponibles,
    quality: 1,
    preferredAssetRepresentationMode: MODO_REPRESENTACION,
  });

  if (resultado.canceled) return { fotos: [], descartadas: 0 };

  const elegidas = resultado.assets
    // El `selectionLimit` lo respeta el picker nativo, pero recortar aquí
    // también deja el tope garantizado del lado nuestro: es la misma regla
    // que el trigger `enforce_photo_limit()` aplica en la base.
    .slice(0, disponibles);

  const soportadas = elegidas.filter((asset) => formatoSoportado(asset));
  if (soportadas.length !== elegidas.length) {
    console.warn(
      '[picker] formatos descartados:',
      elegidas.filter((a) => !formatoSoportado(a)).map((a) => a.mimeType ?? a.uri)
    );
  }

  // Secuencial y no `Promise.all`: normalizar es trabajo nativo sobre imágenes
  // grandes, y cinco a la vez es un pico de memoria que no compra nada — el
  // usuario espera lo mismo de todos modos.
  const fotos: FotoElegida[] = [];
  for (const asset of soportadas) {
    fotos.push(await normalizar(asset));
  }

  return { fotos, descartadas: elegidas.length - soportadas.length };
}
