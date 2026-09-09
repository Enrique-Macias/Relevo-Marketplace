/**
 * Fotos de publicaciones — subida, borrado y lectura del bucket privado
 * `listing-photos`.
 *
 * Todo lo de este archivo depende de tres decisiones que ya están tomadas en la
 * base y NO son negociables desde el cliente (ver CLAUDE.md §3 y §9):
 *
 *  1. El bucket es PRIVADO. Es lo único que hace real la regla de que las fotos
 *     de una publicación pausada solo las vea su dueño.
 *  2. La CARPETA del objeto es la llave de autorización: las 4 policies sobre
 *     `storage.objects` traducen `{listing_id}/…` a un listing con
 *     `private.listing_id_from_object_name()` y comparan contra `auth.uid()`.
 *     De ahí el layout de ruta de `rutaFoto()`, que no es una convención de
 *     nombres sino un requisito de seguridad.
 *  3. La lectura va por el endpoint AUTENTICADO, no por signed URLs. Ver
 *     `urlFotoAutenticada()`.
 */

import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';

export const BUCKET = 'listing-photos';

/** Tope de `listing_photos.orden` (0-4) y del trigger `enforce_photo_limit()`. */
export const MAX_FOTOS = 5;

/**
 * Los mismos tres de `allowed_mime_types` en `config.toml`. El servicio de
 * Storage los aplica antes de escribir — esta lista no los reemplaza, sirve
 * para poder decirle al usuario qué pasó en vez de mostrarle un 400 opaco.
 */
const MIME_A_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export type FotoLocal = {
  /** URI local del picker (`file://…` o `content://…`). */
  uri: string;
  /** `ImagePickerAsset.mimeType`. Puede venir vacío en algunas rutas del picker. */
  mimeType?: string | null;
};

export class FormatoNoSoportadoError extends Error {
  constructor(readonly mime: string) {
    super(`Formato no soportado: ${mime}`);
    this.name = 'FormatoNoSoportadoError';
  }
}

/**
 * MIME de la foto elegida.
 *
 * El picker no siempre trae `mimeType`, así que hay un fallback por extensión.
 * OJO CON EL FALLBACK: antes caía a `image/jpeg` para cualquier extensión
 * desconocida, y eso es peor que fallar — un `.heic` sin `mimeType` se habría
 * subido ETIQUETADO COMO JPEG. El bucket valida el `content-type` que declara
 * el cliente, así que lo habría aceptado, y el archivo quedaría con bytes HEIC
 * bajo un nombre y un tipo que mienten; Android no lo podría pintar y el error
 * aparecería mucho después, lejos de su causa. Ahora las extensiones que sí
 * conocemos y no soportamos se nombran explícitamente, y lo desconocido cae a
 * jpeg solo como última opción.
 */
export function mimeDe(foto: FotoLocal): string {
  if (foto.mimeType) return foto.mimeType.toLowerCase();

  const ext = foto.uri.split('?')[0].split('.').pop()?.toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  if (ext === 'tiff' || ext === 'tif') return 'image/tiff';
  if (ext === 'avif') return 'image/avif';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'bmp') return 'image/bmp';
  return 'image/jpeg';
}

/** Si el bucket aceptaría esta foto. Se usa al ELEGIRLA, no al subirla. */
export function formatoSoportado(foto: FotoLocal): boolean {
  return mimeDe(foto) in MIME_A_EXT;
}

/**
 * `{listing_id}/{uuid}.{ext}`.
 *
 * El `orden` de la foto NO va en la ruta: vive en su columna de
 * `listing_photos`, así reordenar no obliga a mover archivos en Storage
 * (mismo razonamiento que la migración 20260908000446).
 */
function rutaFoto(listingId: number, ext: string): string {
  return `${listingId}/${Crypto.randomUUID()}.${ext}`;
}

/**
 * Sube una foto y devuelve su `storage_path`.
 *
 * SOBRE EL CUERPO — verificado contra el código instalado, no contra los docs:
 * se manda un `ArrayBuffer`, nunca un `Blob`/`File`/`FormData`. En
 * `@supabase/storage-js@2.115.0` (`dist/index.cjs:622`) la rama de FormData se
 * elige con `fileBody instanceof Blob`; el `File` de `expo-file-system@57.0.6`
 * declara `implements Blob` pero eso es estructural de TypeScript — en runtime
 * extiende el módulo nativo y NO pasa ese `instanceof`, así que caería a la
 * rama de cuerpo crudo de todas formas. Mandar el ArrayBuffer explícito es
 * decir lo mismo sin depender de un detalle de implementación.
 *
 * SOBRE `contentType` — no es cosmético: esa misma rama hace
 * `headers["content-type"] = options.contentType`, y el default de
 * `DEFAULT_FILE_OPTIONS` es `text/plain;charset=UTF-8`, que el bucket rechaza
 * por su `allowed_mime_types`. Sin esta línea, ninguna subida funciona.
 */
export async function subirFoto(listingId: number, foto: FotoLocal): Promise<string> {
  const mime = mimeDe(foto);
  const ext = MIME_A_EXT[mime];
  if (!ext) throw new FormatoNoSoportadoError(mime);

  const path = rutaFoto(listingId, ext);
  const bytes = await new File(foto.uri).arrayBuffer();

  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: mime,
    // Cada subida estrena UUID, así que nunca hay colisión que sobrescribir.
    // Dejarlo en false convierte una colisión (que sería un bug nuestro) en un
    // error visible en vez de en una foto ajena pisada en silencio.
    upsert: false,
  });
  if (error) throw error;

  return path;
}

/**
 * Borra objetos del bucket. Best-effort por diseño: quien llama ya decidió que
 * la fila se va, y un fallo aquí deja un archivo huérfano —caro, no incorrecto—
 * mientras que propagar el error dejaría al usuario sin poder borrar su
 * publicación.
 *
 * OJO CON EL ORDEN al borrar una publicación completa: esto tiene que correr
 * ANTES del `delete` de `listings`. La policy `listing_photos_objects_delete_own`
 * exige que el listing EXISTA para autorizar el borrado del objeto, así que al
 * revés los archivos quedan huérfanos y además sin forma de borrarlos.
 */
export async function borrarFotos(paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) {
    console.warn(
      `[storage] no se pudieron borrar ${paths.length} objeto(s): ${error.message}`
    );
  }
}

/**
 * URL de lectura de una foto. Va acompañada SIEMPRE del header
 * `Authorization: Bearer <access_token>` — ver `components/ListingPhoto.tsx`.
 *
 * POR QUÉ NO SIGNED URLS, aunque los docs de Supabase las llamen "the primary
 * way" para buckets privados: una signed URL evalúa la RLS **al firmar, no al
 * servir**. El permiso viaja dentro del token, así que una URL firmada antes de
 * que el vendedor pausara su publicación sigue entregando la foto hasta que
 * caduque — y los propios docs advierten que expirar el token no purga el caché
 * del CDN. Eso rompe exactamente la regla por la que el bucket es privado.
 * Con este endpoint la policy se re-evalúa en CADA request y pausar surte
 * efecto de inmediato.
 *
 * Si alguien propone migrar a signed URLs "para simplificar", la pregunta no es
 * "¿se ve igual?" sino "¿cuándo se evalúa el permiso?" (CLAUDE.md §9).
 */
export function urlFotoAutenticada(storagePath: string): string {
  const segmentos = storagePath.split('/').map(encodeURIComponent).join('/');
  return `${env.supabaseUrl}/storage/v1/object/authenticated/${BUCKET}/${segmentos}`;
}
