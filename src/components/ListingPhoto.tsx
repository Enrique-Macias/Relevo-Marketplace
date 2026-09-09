/**
 * La foto de una publicación — punto ÚNICO de contacto con el bucket privado.
 *
 * Todo lo que pinte una foto de `listing_photos` pasa por aquí (ProductCard,
 * Detalle, PhotoRow), para que cambiar el patrón de lectura sea un archivo y no
 * una cacería.
 *
 * DOS COSAS QUE NO SON PREFERENCIAS DE ESTILO (CLAUDE.md §9):
 *
 *  1. `expo-image` y NO el `<Image>` de React Native. El de RN documenta
 *     `headers`, pero arrastra bugs abiertos en Android/Fresco, varios
 *     reportando que funcionan en la arquitectura vieja y no en la nueva — y
 *     este proyecto corre RN 0.86 con New Architecture.
 *  2. El endpoint AUTENTICADO con `Authorization: Bearer`, no una signed URL.
 *     Una signed URL evalúa la RLS al firmar, no al servir: seguiría entregando
 *     la foto de una publicación ya pausada hasta que caduque. Aquí la policy
 *     se re-evalúa en cada request. Ver `urlFotoAutenticada()`.
 */

import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { useSession } from '@/lib/session';
import { urlFotoAutenticada } from '@/lib/storage';

type ListingPhotoProps = {
  /** `listing_photos.storage_path`, o `null` si la publicación no tiene fotos. */
  path: string | null;
  /**
   * Qué pintar cuando no hay foto que mostrar. Hoy siempre es el ícono de
   * categoría tintado que ProductCard y Detalle usaban como imagen principal
   * antes de que existieran las fotos reales — pasó a ser el fallback, no el
   * default.
   */
  fallback: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  contentFit?: 'cover' | 'contain';
  accessibilityLabel?: string;
};

export function ListingPhoto({
  path,
  fallback,
  style,
  contentFit = 'cover',
  accessibilityLabel,
}: ListingPhotoProps) {
  const { session } = useSession();
  // Una foto que el servidor rechaza (403 de una pausada ajena, objeto borrado,
  // red caída) tiene que degradar al fallback, no dejar un hueco. Se guarda el
  // path que falló y no un booleano: así, al navegar a otra publicación, el
  // componente reciclado no hereda el error de la anterior.
  const [pathFallido, setPathFallido] = useState<string | null>(null);

  const token = session?.access_token ?? null;

  // Sin token no se puede ni intentar: la URL sin `Authorization` es un 401
  // seguro. Pasa durante el arranque, antes de que la sesión resuelva.
  const puedePintar = path !== null && token !== null && path !== pathFallido;

  return (
    // El centrado es del CONTENEDOR, no del fallback: así quien lo pasa manda
    // solo el ícono (`<CategoryIcon .../>`) sin envolverlo, y la imagen —que va
    // en absoluteFill— no se ve afectada.
    <View style={[styles.contenedor, style]}>
      {puedePintar ? (
        <Image
          source={{
            uri: urlFotoAutenticada(path),
            headers: { Authorization: `Bearer ${token}` },
          }}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          // El caché es POR DISPOSITIVO y solo alcanza a quien ya vio la foto
          // con permiso. Matiz honesto: si el vendedor pausa su publicación,
          // un comprador que ya la había abierto puede seguir viendo esa foto
          // desde su propio caché hasta que se invalide. El candado que importa
          // —que NADIE MÁS pueda pedirla— sigue intacto, porque cada request
          // nuevo sí re-evalúa la policy.
          cachePolicy="disk"
          // `transition` suaviza el pop de la carga; el prototipo no dibuja un
          // spinner sobre la miniatura, así que no se inventa uno.
          transition={150}
          accessibilityLabel={accessibilityLabel}
          onError={() => setPathFallido(path)}
        />
      ) : (
        fallback
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
