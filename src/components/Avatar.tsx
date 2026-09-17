/**
 * El avatar de un usuario — punto ÚNICO de contacto con el bucket `avatars`.
 *
 * Todo lo que pinte la foto de una persona pasa por aquí (header del Feed,
 * Perfil, Perfil público, reseñas, vendedor en Detalle, `BuyerRow`, Calificar y
 * el círculo de las dos pantallas de subida), para que cambiar el patrón de
 * lectura sea un archivo y no una cacería. Mismo rol que `ListingPhoto` para
 * `listing-photos`.
 *
 * LA DIFERENCIA CON `ListingPhoto` ES QUE AQUÍ NO HAY TOKEN, y no es un
 * descuido: el bucket `avatars` es PÚBLICO, así que `urlAvatarPublica()` pega a
 * `/object/public/` y ese endpoint no pasa por RLS. Ver `BUCKET_AVATARS`
 * (`src/lib/storage.ts`) para por qué la asimetría entre los dos buckets es
 * deliberada — en corto: el criterio de lectura de una foto de publicación es
 * VARIABLE (se esconde al pausar) y el de un avatar es constante, así que la
 * policy de SELECT de un `avatars` privado no sería un candado sino ceremonia,
 * a cambio de que ESTE componente necesitara `useSession()` y parpadeara a
 * iniciales en cada arranque en frío, mientras la sesión resuelve.
 *
 * Si alguien propone "unificarlo con `ListingPhoto` porque los dos pintan una
 * imagen de Storage": son dos semánticas de acceso distintas, y el único código
 * que compartirían es el `<Image>`.
 */

import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { iniciales } from '@/lib/format';
import { urlAvatarPublica } from '@/lib/storage';

type AvatarProps = {
  /** `users.foto_url` — la RUTA dentro del bucket, no una URL. */
  path: string | null | undefined;
  /** Para el fallback de iniciales. */
  nombre: string | null | undefined;
  /**
   * La caja: tamaño, `borderRadius` y el tinte de fondo. Cada sitio pasa el
   * suyo tal cual lo tenía — esto NO unifica escalas (son 6 roles distintos de
   * `Typography`, el racimo de CLAUDE.md §2).
   */
  style?: ViewStyle | ViewStyle[];
  /** El rol de `Typography` del sitio, con su color. */
  textStyle?: TextStyle;
  /**
   * Qué pintar sin foto, si NO son las iniciales. Hoy su único consumidor es
   * "Completar perfil", cuyo círculo vacío lleva el ícono de cámara porque en
   * el onboarding todavía no hay nombre que abreviar. Mismo recurso que el
   * prop `fallback` de `ListingPhoto`.
   */
  fallback?: React.ReactNode;
  /** Contenido extra SOBRE la foto (el scrim de "subiendo", el `.cam-badge`). */
  children?: React.ReactNode;
  accessibilityLabel?: string;
};

export function Avatar({
  path,
  nombre,
  style,
  textStyle,
  fallback,
  children,
  accessibilityLabel,
}: AvatarProps) {
  // Se guarda el PATH que falló, no un booleano: así una fila reciclada de una
  // lista (reseñas, `BuyerRow`) no hereda el error de la anterior. Mismo
  // criterio que `ListingPhoto`.
  const [pathFallido, setPathFallido] = useState<string | null>(null);

  const puedePintar = !!path && path !== pathFallido;

  return (
    <View style={[styles.contenedor, style]}>
      {puedePintar ? (
        <Image
          source={{ uri: urlAvatarPublica(path) }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          // El objeto es inmutable: cada cambio de avatar estrena uuid y escribe
          // `foto_url`, así que una URL cacheada nunca queda obsoleta — esa es
          // justamente la razón de no usar una ruta estable (ver `rutaAvatar`).
          cachePolicy="disk"
          transition={150}
          accessibilityLabel={accessibilityLabel}
          onError={() => setPathFallido(path)}
        />
      ) : (
        (fallback ?? <Text style={textStyle}>{iniciales(nombre)}</Text>)
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    alignItems: 'center',
    justifyContent: 'center',
    // Recorta la imagen al `borderRadius` que llega por `style` — sin esto, la
    // foto en `absoluteFill` saldría cuadrada dentro del círculo.
    overflow: 'hidden',
  },
});
