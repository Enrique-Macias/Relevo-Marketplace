/**
 * `.photo-viewer` — el visor de foto a pantalla completa.
 *
 * Frames: "Detalle (foto a pantalla completa)", "Detalle (foto — cerrando)",
 * "Detalle (foto ampliada con zoom)", "Perfil (foto ampliada)" y "Perfil
 * público (foto ampliada)" (DESIGN-1, fase 3).
 *
 * Dos fuentes, un solo visor:
 * - `fotos` + `indiceInicial`: las de una publicación (bucket privado, vía
 *   `ListingPhoto`), con paginación y dots. Lo monta Detalle.
 * - `avatar`: UNA foto de perfil (bucket público, vía `Avatar`), en la caja 4:5
 *   de `.viewer-avatar`, sin dots. Lo montan Perfil y Perfil público.
 *
 * Es un `Modal` de RN, NO una ruta de Stack: necesita el ARRAY de fotos y el
 * índice tocado en la mano, y una ruta aparte solo recibe params serializables
 * (CLAUDE.md §8b). Quien lo monta lo hace de forma CONDICIONAL, así que cada
 * apertura es un montaje nuevo y `indiceInicial` vuelve a aplicarse.
 *
 * ZOOM SOLO POR GESTOS, sin botones (decisión de DESIGN-1): dos dedos acercan
 * de 1 a 4 (`MAX_ZOOM`, el mismo valor del prototipo), un dedo desplaza la foto
 * ampliada y el doble toque la restablece. El doble toque NO acerca: el frame
 * solo documenta "restablece".
 *
 * TODOS los gestos viven en un solo árbol de react-native-gesture-handler +
 * Reanimated, incluida la paginación. NO se reusa `PhotoCarousel` (un
 * `ScrollView` nativo) aquí, a propósito: con un `ScrollView` nativo debajo,
 * el pellizco y el scroll compiten por el toque y en iOS gana el que reconoce
 * primero, así que acercar con dos dedos a veces cambiaba de foto. Con un solo
 * árbol, qué hace cada arrastre lo decide este archivo, en `onStart` del pan:
 * - con la foto ampliada → mueve la foto (y el swipe NO cambia de foto);
 * - sin zoom y dominantemente hacia abajo → arrastra para cerrar;
 * - sin zoom y en cualquier otra dirección → pagina.
 * El hero de Detalle sigue con `PhotoCarousel`: ahí no hay zoom.
 *
 * El `Modal` lleva su PROPIO `GestureHandlerRootView`: en Android un `Modal`
 * es otra ventana nativa y, sin él, los gestos no le llegan (CLAUDE.md §9).
 *
 * Se cierra de TRES formas, y las tres llaman a `onCerrar` con el índice actual
 * para que el hero de Detalle quede en la misma foto: la X, el arrastre hacia
 * abajo y el botón atrás de Android (`onRequestClose`). Si algún día se agrega
 * una cuarta, tiene que pasar por ahí también.
 */

import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Avatar } from '@/components/Avatar';
import { IconClose } from '@/components/icons';
import { ListingPhoto } from '@/components/ListingPhoto';
import { PhotoDots } from '@/components/PhotoCarousel';
import { RoundIconButton } from '@/components/RoundIconButton';
import { Colors } from '@/constants/theme';

/** El tope del pellizco. `var MAX_ZOOM = 4` en el JS de `relevo-app.html`. */
const MAX_ZOOM = 4;
/** Cuánto hay que arrastrar (o con cuánta velocidad, en px/s) para cerrar. */
const UMBRAL_CIERRE = 120;
const VELOCIDAD_CIERRE = 800;
/** Recorrido sobre el que el fondo se desvanece y la foto se encoge. */
const RECORRIDO = 240;
/** Fracción del ancho (o velocidad, px/s) que basta para pasar de foto. */
const UMBRAL_PAGINA = 0.22;
const VELOCIDAD_PAGINA = 500;
/** Transiciones cortas y sin rebote: es un visor, no un juguete. */
const SUAVE = { duration: 200 };

type Modo = 'ninguno' | 'mover' | 'paginar' | 'cerrar';

type PhotoViewerProps = {
  /**
   * Recibe el índice donde quedó el usuario. Ese parámetro es lo que permite
   * que el hero de Detalle quede en la misma foto al volver. Con `avatar`
   * siempre es 0.
   */
  onCerrar: (indiceFinal: number) => void;
} & (
  | {
      /** Rutas de `listing_photos.storage_path`, ya ordenadas. */
      fotos: string[];
      /** La foto que se tocó en el hero. El visor abre AHÍ, no en la primera. */
      indiceInicial: number;
      avatar?: never;
    }
  | {
      /** `users.foto_url` (la ruta, no una URL) y el nombre, para el label. */
      avatar: { path: string; nombre: string | null };
      fotos?: never;
      indiceInicial?: never;
    }
);

export function PhotoViewer(props: PhotoViewerProps) {
  const { onCerrar, avatar } = props;
  const fotos = avatar ? [avatar.path] : props.fotos;
  const total = fotos.length;
  const indiceInicial = avatar ? 0 : Math.min(Math.max(props.indiceInicial, 0), total - 1);

  const insets = useSafeAreaInsets();

  // El tamaño de una página se MIDE (onLayout), no se asume: con
  // `statusBarTranslucent`, el alto de la ventana y el del Modal no coinciden
  // en todos los Android.
  const [medida, setMedida] = useState({ ancho: 0, alto: 0 });

  // Estado de React SOLO para lo que pinta React (los dots); la verdad de los
  // gestos vive en los shared values. Se actualiza al TERMINAR de paginar o al
  // cruzar el zoom 1, nunca por frame.
  const [indice, setIndice] = useState(indiceInicial);
  const [ampliada, setAmpliada] = useState(false);

  const ancho = useSharedValue(0);
  const alto = useSharedValue(0);
  const indiceSV = useSharedValue(indiceInicial);
  const paginaX = useSharedValue(0);
  const escala = useSharedValue(1);
  const escalaInicio = useSharedValue(1);
  const fotoX = useSharedValue(0);
  const fotoY = useSharedValue(0);
  const fotoXInicio = useSharedValue(0);
  const fotoYInicio = useSharedValue(0);
  const focoXInicio = useSharedValue(0);
  const focoYInicio = useSharedValue(0);
  const bajada = useSharedValue(0);
  const modo = useSharedValue<Modo>('ninguno');
  /**
   * ¿Hubo un pellizco dentro del toque actual? Los dos dedos casi nunca bajan
   * a la vez: el primero alcanza a activar el arrastre de un dedo (paginar o
   * mover la foto) y, sin esto, ese arrastre seguía escribiendo la posición
   * mientras el pellizco también la escribía, así que la foto se deslizaba
   * lejos de los dedos. Lo reporta el usuario en dispositivo (DESIGN-1 fase 3).
   * Se limpia en `onBegin` del pan, que solo dispara al bajar el PRIMER dedo de
   * un toque nuevo.
   */
  const huboPellizco = useSharedValue(false);

  function alMedir(w: number, h: number) {
    setMedida({ ancho: w, alto: h });
    ancho.set(w);
    alto.set(h);
    // Abre en la foto tocada. Al rotar o re-medir, conserva la actual.
    paginaX.set(-indiceSV.get() * w);
  }

  /** Lo que se le avisa a React cuando el zoom cruza el 1 (dots atenuados). */
  function avisarZoom(siEsta: boolean) {
    setAmpliada(siEsta);
  }

  // ---- Pellizco: escala anclada al punto medio de los dedos. ----
  const pellizco = Gesture.Pinch()
    .onStart((e) => {
      // El arrastre que el primer dedo alcanzó a empezar se deshace y deja de
      // escribir hasta que se levanten todos los dedos (ver `huboPellizco`).
      huboPellizco.set(true);
      const m = modo.get();
      if (m === 'paginar') paginaX.set(withTiming(-indiceSV.get() * ancho.get(), SUAVE));
      if (m === 'cerrar') bajada.set(withTiming(0, SUAVE));
      modo.set('ninguno');
      escalaInicio.set(escala.get());
      fotoXInicio.set(fotoX.get());
      fotoYInicio.set(fotoY.get());
      // El foco, relativo al CENTRO de la página: el transform escala desde ahí.
      focoXInicio.set(e.focalX - ancho.get() / 2);
      focoYInicio.set(e.focalY - alto.get() / 2);
    })
    .onUpdate((e) => {
      // Se deja bajar hasta 0.8 mientras los dedos siguen puestos (se siente
      // elástico); al soltar rebota a 1.
      const s = Math.min(Math.max(escalaInicio.get() * e.scale, 0.8), MAX_ZOOM);
      const fx = e.focalX - ancho.get() / 2;
      const fy = e.focalY - alto.get() / 2;
      // El punto de la foto que estaba bajo los dedos al empezar se queda bajo
      // los dedos: p = (foco0 − t0) / s0, y t = foco − s·p.
      fotoX.set(fx - (s * (focoXInicio.get() - fotoXInicio.get())) / escalaInicio.get());
      fotoY.set(fy - (s * (focoYInicio.get() - fotoYInicio.get())) / escalaInicio.get());
      const antes = escala.get() > 1.01;
      escala.set(s);
      const ahora = s > 1.01;
      if (antes !== ahora) scheduleOnRN(avisarZoom, ahora);
    })
    .onEnd(() => {
      if (escala.get() <= 1) {
        escala.set(withTiming(1, SUAVE));
        fotoX.set(withTiming(0, SUAVE));
        fotoY.set(withTiming(0, SUAVE));
        scheduleOnRN(avisarZoom, false);
        return;
      }
      fotoX.set(withTiming(limitar(fotoX.get(), escala.get(), ancho.get()), SUAVE));
      fotoY.set(withTiming(limitar(fotoY.get(), escala.get(), alto.get()), SUAVE));
    });

  // ---- Un dedo: mover la foto ampliada, paginar o arrastrar para cerrar. ----
  const arrastre = Gesture.Pan()
    .maxPointers(1)
    .minDistance(8)
    .onBegin(() => {
      huboPellizco.set(false);
    })
    .onStart((e) => {
      // Si el dedo que queda tras un pellizco activa el arrastre, su traslación
      // cuenta desde que bajó el primer dedo y la foto saltaría: se ignora el
      // resto de este toque.
      if (huboPellizco.get()) {
        modo.set('ninguno');
      } else if (escala.get() > 1.01) {
        modo.set('mover');
        fotoXInicio.set(fotoX.get());
        fotoYInicio.set(fotoY.get());
      } else if (e.translationY > 0 && Math.abs(e.translationY) > Math.abs(e.translationX) * 2) {
        // El mismo reparto de ejes que el PanResponder anterior: un swipe entre
        // fotos es dominantemente horizontal y nunca cumple esto.
        modo.set('cerrar');
      } else {
        modo.set('paginar');
      }
    })
    .onUpdate((e) => {
      const m = modo.get();
      if (huboPellizco.get()) return;
      if (m === 'mover') {
        fotoX.set(limitar(fotoXInicio.get() + e.translationX, escala.get(), ancho.get()));
        fotoY.set(limitar(fotoYInicio.get() + e.translationY, escala.get(), alto.get()));
      } else if (m === 'cerrar') {
        // Solo hacia abajo: dejar que la foto se despegue por arriba sugeriría
        // una acción que no existe.
        bajada.set(Math.max(0, e.translationY));
      } else if (m === 'paginar') {
        const base = -indiceSV.get() * ancho.get();
        let dx = e.translationX;
        // En la primera y la última, resistencia en vez de pista vacía.
        const enOrilla =
          (indiceSV.get() === 0 && dx > 0) || (indiceSV.get() === total - 1 && dx < 0);
        if (enOrilla) dx = dx / 3;
        paginaX.set(base + dx);
      }
    })
    .onEnd((e) => {
      const m = modo.get();
      modo.set('ninguno');
      if (m === 'cerrar') {
        if (e.translationY > UMBRAL_CIERRE || e.velocityY > VELOCIDAD_CIERRE) {
          const final = indiceSV.get();
          bajada.set(
            withTiming(alto.get(), { duration: 180 }, (terminado) => {
              if (terminado) scheduleOnRN(onCerrar, final);
            })
          );
        } else {
          bajada.set(withTiming(0, SUAVE));
        }
      } else if (m === 'paginar') {
        let destino = indiceSV.get();
        const w = ancho.get();
        if (e.translationX < -w * UMBRAL_PAGINA || e.velocityX < -VELOCIDAD_PAGINA) destino += 1;
        else if (e.translationX > w * UMBRAL_PAGINA || e.velocityX > VELOCIDAD_PAGINA) destino -= 1;
        destino = Math.min(Math.max(destino, 0), total - 1);
        paginaX.set(withTiming(-destino * w, SUAVE));
        if (destino !== indiceSV.get()) {
          indiceSV.set(destino);
          scheduleOnRN(setIndice, destino);
        }
      }
    });

  // ---- Doble toque: restablece el zoom. Sin zoom no hace nada. ----
  const dobleToque = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (escala.get() <= 1.01) return;
      escala.set(withTiming(1, SUAVE));
      fotoX.set(withTiming(0, SUAVE));
      fotoY.set(withTiming(0, SUAVE));
      scheduleOnRN(avisarZoom, false);
    });

  const gestos = Gesture.Simultaneous(pellizco, arrastre, dobleToque);

  // `.photo-viewer.is-dismissing{background:rgba(14,35,33,0.45);}` — el fondo se
  // vuelve translúcido para dejar ver la pantalla a la que se va a volver.
  const estiloFondo = useAnimatedStyle(() => ({
    opacity: interpolate(bajada.get(), [0, RECORRIDO], [1, 0.45], 'clamp'),
  }));
  // `.photo-viewer.is-dismissing .viewer-track{transform:… scale(0.92);}`
  const estiloEscena = useAnimatedStyle(() => ({
    transform: [
      { translateY: bajada.get() },
      { scale: interpolate(bajada.get(), [0, RECORRIDO], [1, 0.92], 'clamp') },
    ],
  }));
  const estiloPista = useAnimatedStyle(() => ({
    transform: [{ translateX: paginaX.get() }],
  }));

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
      <GestureHandlerRootView style={styles.raiz}>
        {/* El fondo es una capa aparte de la foto: tiene que poder desvanecerse
            sin llevarse la foto con él. `transparent` en el Modal es lo que hace
            que al bajar esta opacidad se vea la pantalla de atrás. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, styles.fondo, estiloFondo]}
          pointerEvents="none"
        />

        <GestureDetector gesture={gestos}>
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.escena, estiloEscena]}
            onLayout={(e) => alMedir(e.nativeEvent.layout.width, e.nativeEvent.layout.height)}
            accessibilityLabel={
              avatar ? `Foto de perfil de ${avatar.nombre ?? 'usuario'}` : undefined
            }
          >
            {medida.ancho > 0 ? (
              <Animated.View
                style={[styles.pista, { width: medida.ancho * total }, estiloPista]}
              >
                {fotos.map((path, i) => (
                  <Pagina
                    key={path}
                    i={i}
                    ancho={medida.ancho}
                    alto={medida.alto}
                    indiceSV={indiceSV}
                    escala={escala}
                    fotoX={fotoX}
                    fotoY={fotoY}
                  >
                    {avatar ? (
                      <Avatar
                        path={path}
                        nombre={avatar.nombre}
                        style={[styles.avatar, { maxHeight: medida.alto * 0.78 }]}
                        // Si la foto no carga, la caja menta vacía, igual que el
                        // `fallback={null}` de las fotos de publicación: el
                        // visor solo se abre con foto, y unas iniciales de 72
                        // serían un rol de `Typography` nuevo sin frame que lo
                        // pida (CLAUDE.md §2).
                        fallback={<View />}
                      />
                    ) : (
                      <ListingPhoto
                        path={path}
                        // La foto entera, sin recortar: es la razón de abrir el
                        // visor. El hero de Detalle usa 'cover' por lo contrario.
                        contentFit="contain"
                        fallback={null}
                        style={{ width: medida.ancho, height: medida.alto }}
                        accessibilityLabel={`Foto ${i + 1} de ${total}`}
                      />
                    )}
                  </Pagina>
                ))}
              </Animated.View>
            ) : null}
          </Animated.View>
        </GestureDetector>

        {/* La X NO se esconde durante el arrastre ni con zoom: soltar a medio
            camino no debe dejar al usuario sin una salida evidente. Va FUERA
            del GestureDetector, así que un toque en ella nunca es un gesto. */}
        <View style={[styles.cerrar, { top: insets.top + 16 }]}>
          <RoundIconButton onPress={() => onCerrar(indice)}>
            <IconClose size={18} color={Colors.ink} />
          </RoundIconButton>
        </View>

        {/* `.photo-viewer.is-zoomed .detail-dots{opacity:.35;}` */}
        <PhotoDots
          total={total}
          activo={indice}
          style={{ bottom: insets.bottom + 14, opacity: ampliada ? 0.35 : 1 }}
        />
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * Una página de la pista. Solo la página ACTUAL lleva el transform del zoom:
 * los shared values de escala y desplazamiento son uno solo para todo el visor,
 * y como solo se pagina con zoom 1, al cambiar de página la escala ya es 1 y
 * no hay salto.
 */
function Pagina({
  i,
  ancho,
  alto,
  indiceSV,
  escala,
  fotoX,
  fotoY,
  children,
}: {
  i: number;
  ancho: number;
  alto: number;
  indiceSV: SharedValue<number>;
  escala: SharedValue<number>;
  fotoX: SharedValue<number>;
  fotoY: SharedValue<number>;
  children: React.ReactNode;
}) {
  const estilo = useAnimatedStyle(() => {
    if (indiceSV.get() !== i) return { transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    return {
      transform: [
        { translateX: fotoX.get() },
        { translateY: fotoY.get() },
        { scale: escala.get() },
      ],
    };
  });
  return (
    <Animated.View style={[styles.pagina, { width: ancho, height: alto }, estilo]}>
      {children}
    </Animated.View>
  );
}

/**
 * El desplazamiento máximo con zoom `s` sobre una página de tamaño `lado`: la
 * foto ampliada no se puede sacar del cuadro (mismo cálculo que el prototipo).
 */
function limitar(valor: number, s: number, lado: number) {
  'worklet';
  const max = Math.max(0, ((s - 1) * lado) / 2);
  return Math.min(Math.max(valor, -max), max);
}

const styles = StyleSheet.create({
  raiz: {
    flex: 1,
  },
  // `Colors.viewer` (#0E2321) es el fondo de `.photo-viewer` en el prototipo.
  fondo: {
    backgroundColor: Colors.viewer,
  },
  escena: {
    overflow: 'hidden',
  },
  pista: {
    flex: 1,
    flexDirection: 'row',
  },
  pagina: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // .viewer-avatar{width:100%; aspect-ratio:4 / 5; max-height:78%;}
  avatar: {
    width: '100%',
    aspectRatio: 4 / 5,
    backgroundColor: Colors.mint100,
  },
  // .viewer-close{position:absolute; top:16px; left:20px; z-index:3;} — el
  // `top` lo pone quien renderiza, sumándole el inset.
  cerrar: {
    position: 'absolute',
    left: 20,
  },
});
