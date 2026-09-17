/**
 * Storage — subida, borrado y lectura de los DOS buckets del proyecto:
 * `listing-photos` (privado, fotos de publicaciones) y `avatars` (público,
 * foto de perfil).
 *
 * Que sean distintos no es organización: `listing-photos` autoriza por carpeta
 * `{listing_id}/` contra el dueño de una publicación, y un avatar no tiene
 * publicación. Y son de visibilidad opuesta a propósito — ver `BUCKET_AVATARS`.
 *
 * Lo de `listing-photos` depende de tres decisiones que ya están tomadas en la
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

/**
 * Foto de perfil (RF-03). Es PÚBLICO, al revés que `BUCKET` — y eso es una
 * decisión, no el default (`config.toml`, migración `20260916000456`).
 *
 * El motivo por el que `listing-photos` es privado no se traslada: allá el
 * criterio de lectura es VARIABLE (`estado <> 'pausada' or eres el dueño`) y un
 * bucket público lo saltaría. Para un avatar no hay estado equivalente —
 * `users_select` es `using (true)` y `fetchPerfilPublico()` ni filtra por
 * `estado`—, así que su policy de SELECT sería una constante: ceremonia, a
 * cambio de que las 9 superficies que pintan un avatar cargaran el header
 * `Authorization` y parpadearan a iniciales en cada arranque en frío.
 *
 * Consecuencia práctica: NO hay un `AvatarPhoto` con token. Ver `Avatar.tsx`.
 */
export const BUCKET_AVATARS = 'avatars';

/**
 * El `file_size_limit` del bucket `avatars`, en bytes. Mismo criterio que
 * `MAX_BYTES`: no se valida contra esto, sirve para poder DECIR el tope.
 *
 * Es 1 MiB y no 5: tras `normalizar()` a `LADO_MAXIMO_AVATAR` un avatar pesa
 * ~50-120 KB, así que sigue siendo un orden de magnitud de holgura.
 */
export const MAX_BYTES_AVATAR = 1 * 1024 * 1024;

/** Tope de `listing_photos.orden` (0-4) y del trigger `enforce_photo_limit()`. */
export const MAX_FOTOS = 5;

/**
 * El `file_size_limit` del bucket (`config.toml:131`), en bytes.
 *
 * No se valida contra esto antes de subir —el servicio de Storage lo aplica
 * igual, y duplicar el límite en el cliente sería una segunda fuente de verdad
 * que se desincroniza en cuanto alguien cambie `config.toml`. Está aquí para
 * poder DECIRLE al usuario cuál es el tope cuando Storage rechaza, en vez de
 * dejarlo adivinando.
 */
export const MAX_BYTES = 5 * 1024 * 1024;

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
 * El bucket rechazó la foto por tamaño.
 *
 * Hermano de `FormatoNoSoportadoError`, y por la misma razón: es un fallo
 * DETERMINISTA. El archivo pesa lo mismo en el segundo intento, así que
 * reintentarlo solo gasta red y le alarga la espera al usuario — medido en
 * producción, un incidente de 6 toques generó 12 requests porque el reintento
 * automático no distinguía este caso del de una conexión caída.
 */
export class FotoDemasiadoGrandeError extends Error {
  constructor() {
    super('La foto excede el tamaño máximo del bucket');
    this.name = 'FotoDemasiadoGrandeError';
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
 *
 * SOBRE EL ERROR DE TAMAÑO — se traduce a `FotoDemasiadoGrandeError` mirando
 * `code`, no el mensaje. `StorageApiError.code` viene del body de la respuesta
 * (`@supabase/storage-js@2.115.0`, `index.cjs:327`) y su propio `.d.ts` dice
 * para qué es: *"Use this to branch on the specific error rather than parsing
 * the message"* (`index.d.cts:37-47`). El `message` además llega en inglés.
 * El body real, capturado con curl contra el bucket:
 * `{"statusCode":"413","error":"Payload too large","message":"The object
 * exceeded the maximum allowed size","code":"EntityTooLarge"}` — ojo con el
 * 413: al cliente le llega como HTTP 400, así que el status no sirve para
 * distinguirlo de cualquier otro rechazo.
 */
export async function subirFoto(listingId: number, foto: FotoLocal): Promise<string> {
  const { mime, ext } = formatoDe(foto);
  const path = rutaFoto(listingId, ext);
  await subirObjeto(BUCKET, path, foto, mime);
  return path;
}

/** El mime de la foto y su extensión, o `FormatoNoSoportadoError`. */
function formatoDe(foto: FotoLocal): { mime: string; ext: string } {
  const mime = mimeDe(foto);
  const ext = MIME_A_EXT[mime];
  if (!ext) throw new FormatoNoSoportadoError(mime);
  return { mime, ext };
}

/**
 * El cuerpo de la subida, compartido por los dos buckets. Todo lo que explica
 * el bloque de arriba (ArrayBuffer, `contentType`, el `code`) vale igual aquí:
 * cambia el bucket y la ruta, no el mecanismo.
 */
async function subirObjeto(
  bucket: string,
  path: string,
  foto: FotoLocal,
  mime: string
): Promise<void> {
  const bytes = await new File(foto.uri).arrayBuffer();

  const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
    contentType: mime,
    // Cada subida estrena UUID, así que nunca hay colisión que sobrescribir.
    // Dejarlo en false convierte una colisión (que sería un bug nuestro) en un
    // error visible en vez de en una foto ajena pisada en silencio.
    upsert: false,
  });

  if (error) {
    if ((error as { code?: string }).code === 'EntityTooLarge') {
      throw new FotoDemasiadoGrandeError();
    }
    throw error;
  }
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

// ---------------------------------------------------------------------------
// Avatares (RF-03)
// ---------------------------------------------------------------------------

/**
 * `{user_id}/{uuid}.{ext}`.
 *
 * La carpeta es la llave de autorización, igual que en `rutaFoto()` — solo que
 * aquí las policies la comparan como TEXTO contra `auth.uid()::text`, sin
 * ningún cast que pueda fallar, así que este bucket no necesita el helper
 * `private.listing_id_from_object_name()` ni nada parecido.
 *
 * UUID NUEVO EN CADA SUBIDA, y no una ruta estable tipo `{user_id}/avatar.jpg`
 * con `upsert: true`: el bucket es público, así que el CDN cachea el objeto y
 * una ruta estable seguiría sirviendo la foto VIEJA hasta que expire. Un uuid
 * nuevo es cache-busting gratis, y a cambio obliga a borrar el anterior — que
 * es justo lo que le da consumidor a `avatars_objects_delete_own`.
 */
function rutaAvatar(userId: string, ext: string): string {
  return `${userId}/${Crypto.randomUUID()}.${ext}`;
}

/** Sube el avatar y devuelve su ruta, la que va en `users.foto_url`. */
export async function subirAvatar(userId: string, foto: FotoLocal): Promise<string> {
  const { mime, ext } = formatoDe(foto);
  const path = rutaAvatar(userId, ext);
  await subirObjeto(BUCKET_AVATARS, path, foto, mime);
  return path;
}

/**
 * Borra el avatar anterior. Best-effort como `borrarFotos()`, y por lo mismo:
 * quien llama ya escribió `foto_url` apuntando al nuevo, así que propagar el
 * fallo dejaría al usuario sin poder cambiar su foto por un problema de red.
 *
 * REVISA EL ARRAY, NO SOLO `error`, y eso NO es prolijidad — es un modo de
 * fallo medido. `remove()` resuelve primero qué objetos VE el invocante y borra
 * esos; si la RLS de SELECT no se los muestra, devuelve **HTTP 200 con `[]` y
 * `error` en null**, dejando el objeto intacto sin que nada se entere. Con un
 * `if (error)` a secas este caso sería invisible. Ver CLAUDE.md §9.
 */
export async function borrarAvatar(path: string): Promise<void> {
  const { data, error } = await supabase.storage.from(BUCKET_AVATARS).remove([path]);

  if (error) {
    console.warn(`[storage] no se pudo borrar el avatar ${path}: ${error.message}`);
    return;
  }
  if (!data || data.length === 0) {
    console.warn(
      `[storage] el borrado de ${path} no afectó ningún objeto (200 con lista vacía). ` +
        'Suele ser la policy de SELECT del bucket — ver CLAUDE.md §9.'
    );
  }
}

/**
 * URL de lectura del avatar. SIN header `Authorization`, al revés que
 * `urlFotoAutenticada()`: el bucket es público y este endpoint ni pasa por RLS.
 *
 * Esa es toda la simplificación que compra el bucket público, y la razón por la
 * que `Avatar.tsx` no necesita `useSession()`.
 */
export function urlAvatarPublica(storagePath: string): string {
  const segmentos = storagePath.split('/').map(encodeURIComponent).join('/');
  return `${env.supabaseUrl}/storage/v1/object/public/${BUCKET_AVATARS}/${segmentos}`;
}
