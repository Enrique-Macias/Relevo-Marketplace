/**
 * Selección de fotos del carrete (RF-05).
 *
 * Vive aparte de `storage.ts` a propósito: elegir una foto y subirla son dos
 * momentos distintos del flujo —y en Publicar están separados por la creación
 * del listing, que es lo único que habilita la subida— así que mezclarlos en un
 * módulo invitaría a acoplarlos.
 */

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
 * Abre el carrete y devuelve las fotos elegidas, como máximo `disponibles`.
 *
 * `quality: 0.8` es SOLO peso, no formato — ver arriba por qué no convierte
 * nada por sí solo. Sirve para no acercarse al tope de 5 MiB del bucket con
 * fotos de 12 MP.
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
 */
export type Seleccion = { fotos: FotoElegida[]; descartadas: number };

export async function elegirFotos(disponibles: number): Promise<Seleccion> {
  const permiso = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permiso.granted) throw new PermisoDenegadoError();

  const resultado = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: disponibles > 1,
    selectionLimit: disponibles,
    quality: 0.8,
    preferredAssetRepresentationMode: MODO_REPRESENTACION,
  });

  if (resultado.canceled) return { fotos: [], descartadas: 0 };

  const elegidas = resultado.assets
    // El `selectionLimit` lo respeta el picker nativo, pero recortar aquí
    // también deja el tope garantizado del lado nuestro: es la misma regla
    // que el trigger `enforce_photo_limit()` aplica en la base.
    .slice(0, disponibles)
    .map((asset) => ({
      origen: 'local' as const,
      uri: asset.uri,
      mimeType: asset.mimeType,
    }));

  const fotos = elegidas.filter(formatoSoportado);
  if (fotos.length !== elegidas.length) {
    console.warn(
      '[picker] formatos descartados:',
      elegidas.filter((f) => !formatoSoportado(f)).map((f) => f.mimeType ?? f.uri)
    );
  }

  return { fotos, descartadas: elegidas.length - fotos.length };
}
