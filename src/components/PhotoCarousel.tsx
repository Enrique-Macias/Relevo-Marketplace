/**
 * `.detail-track` / `.detail-slide` / `.detail-dots` — el carrusel horizontal de
 * fotos de una publicación, y sus puntos de paginación.
 *
 * Lo usan DOS pantallas con el mismo mecanismo y distinto chrome: el hero de
 * Detalle (340px, `cover`, con nav y badge encima) y el visor a pantalla
 * completa (`contain`, sobre negro). Ver `PhotoViewer.tsx`.
 *
 * El chrome NO vive aquí: `.detail-nav`, `.detail-badge` y los propios
 * `PhotoDots` son hermanos absolutos del carrusel en quien lo monta, para que no
 * viajen con el scroll horizontal.
 */

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
} from 'react-native';

import { ListingPhoto } from '@/components/ListingPhoto';

/**
 * Los puntos de paginación, extraídos tal cual de Detalle.
 *
 * `.detail-dots span{width:6px; height:6px; border-radius:50%;
 *  background:rgba(255,255,255,0.5);}` y
 * `.detail-dots span.active{background:#fff; width:16px; border-radius:4px;}`
 */
export function PhotoDots({
  total,
  activo,
  style,
}: {
  total: number;
  activo: number;
  style?: ViewStyle;
}) {
  // Un indicador de paginación de una sola página no indica nada. Antes se
  // pintaba igual (`Math.max(fotos.length, 1)`), y era razonable cuando el hero
  // no scrolleaba; con carrusel real, un punto único es ruido.
  if (total <= 1) return null;

  return (
    <View style={[styles.dots, style]} pointerEvents="none">
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={[styles.dot, i === activo && styles.dotActive]} />
      ))}
    </View>
  );
}

export type PhotoCarouselHandle = {
  /** Salta a una foto sin animar. Lo usa Detalle al cerrar el visor. */
  irA: (indice: number) => void;
};

type PhotoCarouselProps = {
  /** Rutas de `listing_photos.storage_path`, ya ordenadas por `orden`. */
  fotos: string[];
  /** En qué foto abre. Solo se aplica al montar — ver `posicionado` abajo. */
  indiceInicial?: number;
  onIndiceChange?: (indice: number) => void;
  /** `'cover'` recorta para llenar (hero); `'contain'` muestra la foto entera (visor). */
  contentFit?: 'cover' | 'contain';
  /** Qué pintar cuando la publicación no tiene ninguna foto. */
  fallback: React.ReactNode;
  /** Si se pasa, cada foto es tocable. Solo el hero lo usa. */
  onPressFoto?: (indice: number) => void;
  style?: ViewStyle | ViewStyle[];
};

export const PhotoCarousel = forwardRef<PhotoCarouselHandle, PhotoCarouselProps>(
  function PhotoCarousel(
    {
      fotos,
      indiceInicial = 0,
      onIndiceChange,
      contentFit = 'cover',
      fallback,
      onPressFoto,
      style,
    },
    ref
  ) {
    /**
     * El tamaño de una página se MIDE, no se asume.
     *
     * Se podría tomar `useWindowDimensions().width` —hoy los dos usos son a
     * ancho completo— pero el alto no sale de ahí: el hero mide 340 y el visor
     * la pantalla entera. Y un `height:'100%'` en cada página tampoco sirve,
     * porque dentro del contenedor de contenido de un ScrollView el porcentaje
     * se resuelve contra un padre de alto automático y puede colapsar a 0.
     * Midiendo, las dos dimensiones salen del mismo sitio y el componente deja
     * de depender de que quien lo monte sea full-bleed.
     */
    const [medida, setMedida] = useState({ ancho: 0, alto: 0 });
    const scrollRef = useRef<ScrollView>(null);
    // El posicionamiento inicial corre UNA sola vez. Sin este guard,
    // `onContentSizeChange` volvería a arrastrar al usuario a `indiceInicial`
    // cada vez que el contenido se remidiera.
    const posicionado = useRef(false);

    useImperativeHandle(
      ref,
      () => ({
        irA(indice: number) {
          scrollRef.current?.scrollTo({ x: indice * medida.ancho, y: 0, animated: false });
        },
      }),
      [medida.ancho]
    );

    // Sin fotos no hay nada que paginar: se pinta el fallback (el ícono de
    // categoría tintado) y no se monta el ScrollView. Es el caso de las
    // publicaciones creadas antes de que existiera la subida, o dadas de alta
    // desde Studio.
    if (fotos.length === 0) {
      return <View style={[styles.vacio, style]}>{fallback}</View>;
    }

    function alTerminarScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
      if (medida.ancho === 0) return;
      // Solo páginas asentadas: `onMomentumScrollEnd` nunca reporta un índice a
      // medio camino, así que el que sale de aquí siempre es entero y real.
      onIndiceChange?.(Math.round(e.nativeEvent.contentOffset.x / medida.ancho));
    }

    return (
      <View
        style={style}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setMedida({ ancho: width, alto: height });
        }}
      >
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={alTerminarScroll}
          /*
           * Por qué NO se usa el prop `contentOffset` para abrir en la foto
           * tocada: está declarado en `ScrollViewPropsIOS`
           * (`node_modules/react-native/Libraries/Components/ScrollView/ScrollView.d.ts:406`,
           * dentro de la interfaz que abre en la línea 336), o sea que es
           * iOS-only. En Android habría sido ignorado en silencio y el visor
           * siempre habría abierto en la primera foto — el requisito roto en la
           * mitad de las plataformas, sin error visible.
           */
          onContentSizeChange={() => {
            // `medida.ancho === 0` es el primer disparo, antes de que el layout
            // resuelva: posicionar ahí gastaría el tiro y dejaría el visor en la
            // foto 1, que es justo lo que hay que evitar.
            if (posicionado.current || indiceInicial === 0 || medida.ancho === 0) return;
            posicionado.current = true;
            scrollRef.current?.scrollTo({ x: indiceInicial * medida.ancho, y: 0, animated: false });
          }}
        >
          {fotos.map((path, i) => {
            const foto = (
              <ListingPhoto
                path={path}
                fallback={fallback}
                style={{ width: medida.ancho, height: medida.alto }}
                contentFit={contentFit}
                accessibilityLabel={`Foto ${i + 1} de ${fotos.length}`}
              />
            );

            // Un `Pressable` no le quita el scroll al `ScrollView`: solo dispara
            // si el dedo no se movió, así que deslizar entre fotos sigue
            // funcionando igual.
            return onPressFoto ? (
              <Pressable
                key={path}
                onPress={() => onPressFoto(i)}
                accessibilityRole="button"
                accessibilityLabel={`Ver foto ${i + 1} de ${fotos.length} en pantalla completa`}
              >
                {foto}
              </Pressable>
            ) : (
              <View key={path}>{foto}</View>
            );
          })}
        </ScrollView>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  vacio: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // .detail-dots{position:absolute; bottom:14px; left:0; right:0;
  //   display:flex; justify-content:center; gap:5px; z-index:3;}
  dots: {
    position: 'absolute',
    bottom: 14,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  dotActive: {
    width: 16,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
});
