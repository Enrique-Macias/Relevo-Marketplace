/**
 * `.photo-viewer` — el visor de foto a pantalla completa de Detalle.
 *
 * Frames: "Detalle (foto a pantalla completa)" y "Detalle (foto — cerrando)".
 *
 * Es un `Modal` de RN, NO una ruta de Stack, por el mismo criterio que la hoja
 * de acciones de "Mis publicaciones" y `CampusBottomSheet` (CLAUDE.md §8b):
 * necesita el ARRAY de fotos y el índice tocado en la mano, y una ruta aparte
 * solo recibe params serializables. De paso esquiva el gotcha de §9 sobre
 * `presentation` declarado en un Stack anidado.
 *
 * Lo monta `detalle/[id].tsx` de forma condicional, no con un prop `visible`:
 * así cada apertura es un montaje nuevo y `indiceInicial` vuelve a aplicarse.
 * Con el componente siempre montado, abrir en la foto 3 después de haber abierto
 * en la 1 no habría hecho nada — `useState(indiceInicial)` solo lee su
 * argumento al montar.
 *
 * Se cierra de TRES formas, y las tres llaman a `onCerrar` con el índice actual
 * para que ninguna se salte la sincronización con el hero: la X, el arrastre
 * hacia abajo y el botón atrás de Android (`onRequestClose`). Si algún día se
 * agrega una cuarta, tiene que pasar por ahí también.
 */

import { useEffect, useState } from 'react';
import { Animated, Dimensions, Modal, PanResponder, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconClose } from '@/components/icons';
import { PhotoCarousel, PhotoDots } from '@/components/PhotoCarousel';
import { RoundIconButton } from '@/components/RoundIconButton';
import { Colors } from '@/constants/theme';

/** Cuánto hay que arrastrar (o con cuánta velocidad) para que suelte y cierre. */
const UMBRAL_CIERRE = 120;
const VELOCIDAD_CIERRE = 0.8;
/** Recorrido sobre el que el fondo se desvanece y la foto se encoge. */
const RECORRIDO = 240;

type PhotoViewerProps = {
  /** Rutas de `listing_photos.storage_path`, ya ordenadas. */
  fotos: string[];
  /** La foto que se tocó en el hero. El visor abre AHÍ, no en la primera. */
  indiceInicial: number;
  /**
   * Recibe el índice donde quedó el usuario. Ese parámetro es lo que permite
   * que el hero de Detalle quede en la misma foto al volver — sin él, el visor
   * se lleva esa información al desmontarse. Ver CLAUDE.md §8b.
   */
  onCerrar: (indiceFinal: number) => void;
};

export function PhotoViewer({ fotos, indiceInicial, onCerrar }: PhotoViewerProps) {
  const insets = useSafeAreaInsets();

  const [indice, setIndice] = useState(indiceInicial);

  /**
   * El PanResponder se crea UNA sola vez —recrearlo a media gesto lo cancela—,
   * así que no puede leer `indice` ni `onCerrar` por clausura: se quedaría con
   * los valores del primer render y cerraría siempre reportando `indiceInicial`,
   * perdiendo justo la sincronización con el hero que este componente existe
   * para dar.
   *
   * Se resuelve SIN refs: el gesto solo levanta esta bandera, y un efecto —que
   * sí se re-crea en cada render, y por lo tanto ve el `indice` actual— es quien
   * llama a `onCerrar`. Un ref habría funcionado igual, pero `react-hooks/refs`
   * lo rechaza (no puede probar que el inicializador no lo lea en render) y esta
   * versión es además la que no tiene dos fuentes del mismo dato.
   */
  const [cerrando, setCerrando] = useState(false);
  useEffect(() => {
    if (!cerrando) return;
    onCerrar(indice);
  }, [cerrando, indice, onCerrar]);

  // `useState` con inicializador perezoso, no `useRef(...).current`: es el idiom
  // que ya usan `Toast`, `Skeleton` y `BlinkingDots` para su `Animated.Value`.
  const [arrastre] = useState(() => new Animated.Value(0));

  const [responder] = useState(() =>
    PanResponder.create({
      // El factor 2 es lo que reparte los dos ejes: un swipe entre fotos es
      // dominantemente horizontal y nunca cumple esto, así que el ScrollView se
      // queda con su gesto. El mínimo de 8px evita robarle el tap a las fotos.
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dy) > Math.abs(g.dx) * 2 && Math.abs(g.dy) > 8,

      // Solo hacia abajo: arrastrar hacia arriba no cierra nada, y dejar que la
      // foto se despegue por arriba sugeriría una acción que no existe.
      onPanResponderMove: (_, g) => arrastre.setValue(Math.max(0, g.dy)),

      onPanResponderRelease: (_, g) => {
        if (g.dy > UMBRAL_CIERRE || g.vy > VELOCIDAD_CIERRE) {
          Animated.timing(arrastre, {
            // Se lee al soltar, no en el primer render: el responder se crea una
            // sola vez y una altura capturada en clausura envejecería.
            toValue: Dimensions.get('window').height,
            duration: 180,
            useNativeDriver: true,
          }).start(() => setCerrando(true));
        } else {
          Animated.spring(arrastre, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
          }).start();
        }
      },

      // Si el sistema le quita el gesto (una llamada entrante, por ejemplo), la
      // foto vuelve a su sitio en vez de quedarse a medio camino.
      onPanResponderTerminate: () => {
        Animated.spring(arrastre, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    })
  );

  // `.photo-viewer.is-dismissing{background:rgba(16,14,12,0.45);}` — el fondo se
  // vuelve translúcido para dejar ver el Detalle al que se va a volver.
  const opacidadFondo = arrastre.interpolate({
    inputRange: [0, RECORRIDO],
    outputRange: [1, 0.45],
    extrapolate: 'clamp',
  });

  // `.photo-viewer.is-dismissing .viewer-track{transform:… scale(0.92);}`
  const escala = arrastre.interpolate({
    inputRange: [0, RECORRIDO],
    outputRange: [1, 0.92],
    extrapolate: 'clamp',
  });


  return (
    <Modal
      visible
      transparent
      animationType="fade"
      // Sin esto el negro se corta en la barra de estado en Android y el visor
      // deja de ser "a pantalla completa" justo arriba, donde vive la X.
      statusBarTranslucent
      onRequestClose={() => onCerrar(indice)}
    >
      <View style={styles.raiz}>
        {/* El fondo es una capa aparte de la foto: tiene que poder desvanecerse
            sin llevarse la foto con él. `transparent` en el Modal es lo que hace
            que al bajar esta opacidad se vea el Detalle de atrás. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.fondo, { opacity: opacidadFondo }]}
          pointerEvents="none"
        />

        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ translateY: arrastre }, { scale: escala }] },
          ]}
          {...responder.panHandlers}
        >
          <PhotoCarousel
            fotos={fotos}
            indiceInicial={indiceInicial}
            onIndiceChange={setIndice}
            // La foto entera, sin recortar: es la razón de abrir el visor. El
            // hero de Detalle usa 'cover' justo por lo contrario.
            contentFit="contain"
            fallback={null}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>

        {/* La X NO se esconde durante el arrastre: soltar a medio camino no debe
            dejar al usuario sin una salida evidente. */}
        <View style={[styles.cerrar, { top: insets.top + 16 }]}>
          <RoundIconButton onPress={() => onCerrar(indice)}>
            <IconClose size={18} color={Colors.ink} />
          </RoundIconButton>
        </View>

        <PhotoDots total={fotos.length} activo={indice} style={{ bottom: insets.bottom + 14 }} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  raiz: {
    flex: 1,
  },
  // #100E0C es el negro que ya usan `.device` y `.notch` en el prototipo, no un
  // token nuevo.
  fondo: {
    backgroundColor: '#100E0C',
  },
  // .viewer-close{position:absolute; top:16px; left:20px; z-index:3;} — el
  // `top` lo pone quien renderiza, sumándole el inset.
  cerrar: {
    position: 'absolute',
    left: 20,
  },
});
