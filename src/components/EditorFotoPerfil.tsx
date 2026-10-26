/**
 * "Editor de foto de perfil" (DESIGN-1 fase 5): el recorte circular de la foto
 * de perfil, antes de subirla. Lo abre `useFotoPerfil()` (`src/lib/perfil.ts`)
 * después de tomar o elegir la foto, desde "Editar perfil" y desde "Completar
 * perfil" (D1 de `docs/design-1-fase5-plan.md`).
 *
 * Arrastrar mueve y pellizcar acerca, de 1 a `ZOOM_MAXIMO`, SOLO por gestos
 * (mismo criterio que `PhotoViewer`). El paneo se acota en vivo para que el
 * círculo quede siempre cubierto por la foto: la geometría entera vive en
 * `src/lib/recorte.ts`, pura y cubierta por `scripts/probe-recorte.mjs`. Lo que
 * se ve dentro del círculo es exactamente lo que se guarda.
 *
 * "Listo" y "Usar foto" confirman lo mismo (como en el prototipo), "Cancelar"
 * descarta sin subir nada y "Elegir otra" abre la galería y reinicia el
 * encuadre. Este componente no sube: le entrega el rectángulo a quien lo monta.
 *
 * Es un `Modal` con su PROPIO `GestureHandlerRootView` (CLAUDE.md §9). Los dos
 * dedos casi nunca bajan a la vez, así que se repite la defensa de
 * `PhotoViewer` (`huboPellizco`): tras un pellizco, el arrastre de un dedo se
 * ignora hasta que se levanten todos, o la foto se deslizaría lejos de los dedos.
 */

import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Image as RNImage, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Circle, Path, Svg } from 'react-native-svg';

import { HojaOrigenFoto } from '@/components/HojaOrigenFoto';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';
import { type ModalesFotoPerfilEstado } from '@/lib/perfil';
import {
  FRACCION_CIRCULO,
  ZOOM_MAXIMO,
  acotarEncuadre,
  escalaBase,
  rectRecorte,
  type Rect,
} from '@/lib/recorte';

/** "Así se verá": los tamaños reales del avatar (Perfil, vendedor, reseñas). */
const PREVIAS = [76, 44, 26];

type Props = {
  /** La foto ya normalizada (`normalizar()`), la que se recorta. */
  uri: string;
  onCancelar: () => void;
  onElegirOtra: () => void;
  onUsar: (rect: Rect) => void;
};

export function EditorFotoPerfil({ uri, onCancelar, onElegirOtra, onUsar }: Props) {
  const insets = useSafeAreaInsets();
  const [lado, setLado] = useState(0);
  // Las dimensiones en PÍXELES de la foto, que es en lo que `crop()` mide.
  const [dims, setDims] = useState<{ uri: string; w: number; h: number } | null>(null);
  const listas = dims !== null && dims.uri === uri;

  const ladoSV = useSharedValue(0);
  const anchoSV = useSharedValue(0);
  const altoSV = useSharedValue(0);
  const escala = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const escalaInicio = useSharedValue(1);
  const xInicio = useSharedValue(0);
  const yInicio = useSharedValue(0);
  const focoXInicio = useSharedValue(0);
  const focoYInicio = useSharedValue(0);
  const huboPellizco = useSharedValue(false);

  // Una foto nueva ("Elegir otra") vuelve al encuadre inicial: centrada, zoom 1.
  useEffect(() => {
    let vivo = true;
    escala.set(1);
    x.set(0);
    y.set(0);
    RNImage.getSize(
      uri,
      (w, h) => {
        if (!vivo) return;
        anchoSV.set(w);
        altoSV.set(h);
        setDims({ uri, w, h });
      },
      (e) => console.warn('[editor-foto] no se pudo medir la foto:', e)
    );
    return () => {
      vivo = false;
    };
  }, [uri, anchoSV, altoSV, escala, x, y]);

  const pellizco = Gesture.Pinch()
    .onStart((e) => {
      huboPellizco.set(true);
      escalaInicio.set(escala.get());
      xInicio.set(x.get());
      yInicio.set(y.get());
      // El foco, relativo al CENTRO del escenario: ahí está el centro de la foto
      // cuando x = y = 0, y desde ahí escala el transform.
      focoXInicio.set(e.focalX - ladoSV.get() / 2);
      focoYInicio.set(e.focalY - ladoSV.get() / 2);
    })
    .onUpdate((e) => {
      const w = anchoSV.get();
      const h = altoSV.get();
      const l = ladoSV.get();
      if (w === 0 || l === 0) return;
      const s0 = escalaInicio.get();
      const s = Math.min(ZOOM_MAXIMO, Math.max(1, s0 * e.scale));
      const fx = e.focalX - l / 2;
      const fy = e.focalY - l / 2;
      // El punto de la foto que estaba bajo los dedos se queda bajo los dedos
      // (mismo cálculo que `PhotoViewer`), y después se acota.
      const acotado = acotarEncuadre(l, w, h, {
        escala: s,
        x: fx - (s * (focoXInicio.get() - xInicio.get())) / s0,
        y: fy - (s * (focoYInicio.get() - yInicio.get())) / s0,
      });
      escala.set(acotado.escala);
      x.set(acotado.x);
      y.set(acotado.y);
    });

  const arrastre = Gesture.Pan()
    .maxPointers(1)
    .onBegin(() => {
      huboPellizco.set(false);
    })
    .onStart(() => {
      xInicio.set(x.get());
      yInicio.set(y.get());
    })
    .onUpdate((e) => {
      if (huboPellizco.get() || anchoSV.get() === 0) return;
      const acotado = acotarEncuadre(ladoSV.get(), anchoSV.get(), altoSV.get(), {
        escala: escala.get(),
        x: xInicio.get() + e.translationX,
        y: yInicio.get() + e.translationY,
      });
      x.set(acotado.x);
      y.set(acotado.y);
    });

  const gestos = Gesture.Simultaneous(pellizco, arrastre);

  const usar = () => {
    if (!listas || lado === 0) return;
    onUsar(rectRecorte(lado, dims.w, dims.h, { escala: escala.get(), x: x.get(), y: y.get() }));
  };

  // La foto con zoom 1 CUBRE el escenario (`object-fit: cover` del prototipo).
  const base = listas && lado > 0 ? escalaBase(lado, dims.w, dims.h) : 0;
  const foto = listas && lado > 0 ? { uri, w: dims.w * base, h: dims.h * base } : null;

  return (
    <Modal
      visible
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onCancelar}
    >
      <GestureHandlerRootView style={[styles.raiz, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <Pressable onPress={onCancelar} hitSlop={10} accessibilityRole="button">
            <Text style={styles.enlace}>Cancelar</Text>
          </Pressable>
          <Text style={styles.titulo}>Ajusta tu foto</Text>
          <Pressable onPress={usar} disabled={!listas} hitSlop={10} accessibilityRole="button">
            <Text style={[styles.enlace, styles.enlaceFuerte]}>Listo</Text>
          </Pressable>
        </View>

        <GestureDetector gesture={gestos}>
          <View
            style={styles.escenario}
            onLayout={(e) => {
              const l = e.nativeEvent.layout.width;
              setLado(l);
              ladoSV.set(l);
            }}
            accessibilityLabel="Foto de perfil. Arrastra para mover, pellizca para acercar."
          >
            {foto ? <CapaFoto foto={foto} lado={lado} escala={escala} x={x} y={y} /> : null}
            {lado > 0 ? <Mascara lado={lado} /> : null}
          </View>
        </GestureDetector>

        <Text style={styles.pista}>Arrastra para mover · pellizca para acercar</Text>

        <View style={styles.previasWrap}>
          <Text style={styles.previasLabel}>Así se verá</Text>
          <View style={styles.previas}>
            {PREVIAS.map((d) => (
              <Previa key={d} d={d} foto={foto} lado={lado} escala={escala} x={x} y={y} />
            ))}
          </View>
        </View>

        <View style={[styles.acciones, { paddingBottom: insets.bottom + 26 }]}>
          <Pressable
            style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}
            onPress={onElegirOtra}
            accessibilityRole="button"
          >
            <Text style={styles.ghostLabel}>Elegir otra</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.primary,
              pressed && listas && styles.pressed,
              !listas && styles.disabled,
            ]}
            onPress={usar}
            disabled={!listas}
            accessibilityRole="button"
            accessibilityState={{ disabled: !listas }}
          >
            <Text style={styles.primaryLabel}>Usar foto</Text>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * La hoja "Foto de perfil" y el editor, juntos, para las DOS pantallas del
 * círculo de foto ("Editar perfil" y "Completar perfil", D1). El estado lo arma
 * `useFotoPerfil()`; aquí solo vive el copy del frame "Editar perfil (cambiar
 * foto)", en UN sitio.
 */
export function ModalesFotoPerfil({ estado }: { estado: ModalesFotoPerfilEstado }) {
  return (
    <>
      <HojaOrigenFoto
        visible={estado.hojaVisible}
        titulo="Foto de perfil"
        subGaleria="Después la ajustas en un círculo"
        onCamara={estado.elegirCamara}
        onGaleria={estado.elegirGaleria}
        onCerrar={estado.cerrarHoja}
      />
      {estado.editorUri ? (
        <EditorFotoPerfil
          uri={estado.editorUri}
          onCancelar={estado.cancelarEditor}
          onElegirOtra={estado.elegirOtra}
          onUsar={estado.usar}
        />
      ) : null}
    </>
  );
}

type Foto = { uri: string; w: number; h: number };
type Transform = {
  escala: SharedValue<number>;
  x: SharedValue<number>;
  y: SharedValue<number>;
};

/**
 * La foto, centrada en un escenario de `lado` y movida por el encuadre. El
 * transform escala desde el centro de la propia foto, que es el modelo de
 * `recorte.ts` (centro de la foto = centro del escenario + x, y).
 */
function CapaFoto({ foto, lado, escala, x, y }: { foto: Foto; lado: number } & Transform) {
  const estilo = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: escala.get() }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.capaFoto,
        { width: foto.w, height: foto.h, left: (lado - foto.w) / 2, top: (lado - foto.h) / 2 },
        estilo,
      ]}
    >
      <Image source={{ uri: foto.uri }} style={StyleSheet.absoluteFill} contentFit="fill" />
    </Animated.View>
  );
}

/**
 * `.crop-mask`: lo de fuera del círculo oscurecido y el aro. RN no tiene el
 * `box-shadow` de 999px del prototipo, así que es un trazado con `evenodd`.
 */
function Mascara({ lado }: { lado: number }) {
  const r = (FRACCION_CIRCULO * lado) / 2;
  const c = lado / 2;
  const d = `M0 0H${lado}V${lado}H0Z M${c - r} ${c}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none" width={lado} height={lado}>
      <Path d={d} fill={Colors.cropMascara} fillRule="evenodd" />
      <Circle cx={c} cy={c} r={r - 1} stroke={Colors.cropAro} strokeWidth={2} fill="none" />
    </Svg>
  );
}

/**
 * Una vista previa: el MISMO escenario encogido para que el círculo mida `d`.
 * Escalar un cuadro de `lado` desde su centro lo deja con la esquina en
 * `lado·(1−k)/2`; el `left`/`top` lo corre para que el círculo caiga en (0, 0).
 */
function Previa({ d, foto, lado, ...t }: { d: number; foto: Foto | null; lado: number } & Transform) {
  if (!foto || lado === 0) return <View style={[styles.previa, { width: d, height: d }]} />;
  const k = d / (FRACCION_CIRCULO * lado);
  const desplazamiento = -((1 - FRACCION_CIRCULO) / 2) * lado * k - (lado * (1 - k)) / 2;
  return (
    <View style={[styles.previa, { width: d, height: d }]}>
      <View
        style={{
          position: 'absolute',
          width: lado,
          height: lado,
          left: desplazamiento,
          top: desplazamiento,
          transform: [{ scale: k }],
        }}
      >
        <CapaFoto foto={foto} lado={lado} {...t} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // .crop-device{background:var(--mint-900);}
  raiz: {
    flex: 1,
    backgroundColor: Colors.mint900,
  },
  // .crop-header{padding:14px 20px 12px;}
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 14,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 12,
  },
  // .crop-title{font-size:15px; font-weight:600;} sobre --mint-50
  titulo: {
    ...Typography.sectionTitle,
    color: Colors.mint50,
  },
  // .crop-link{font-size:13.5px; font-weight:500;}
  enlace: {
    ...Typography.rowLabel,
    color: Colors.cropEnlace,
  },
  // .crop-link.strong{color:var(--mint-400); font-weight:600;}
  enlaceFuerte: {
    ...Typography.emphasis,
    color: Colors.mint400,
  },
  // .crop-stage{width:100%; aspect-ratio:1/1; overflow:hidden; background:#0E2321;}
  escenario: {
    width: '100%',
    aspectRatio: 1,
    overflow: 'hidden',
    backgroundColor: Colors.viewer,
  },
  capaFoto: {
    position: 'absolute',
  },
  // .crop-hint{text-align:center; padding:12px 20px 0;}
  pista: {
    ...Typography.cropHint,
    color: Colors.cropPista,
    textAlign: 'center',
    paddingTop: 12,
    paddingHorizontal: ScreenPadding,
  },
  // .crop-preview-wrap{padding:14px 20px 0; flex:1;}
  previasWrap: {
    flex: 1,
    paddingTop: 14,
    paddingHorizontal: ScreenPadding,
  },
  // .crop-preview-label{font-size:11px; font-weight:600; letter-spacing:0.04em;
  // text-transform:uppercase; color:var(--mint-400); margin-bottom:10px;}
  previasLabel: {
    ...Typography.caption,
    letterSpacing: 0.44,
    textTransform: 'uppercase',
    color: Colors.mint400,
    marginBottom: 10,
  },
  // .crop-previews{display:flex; align-items:center; gap:18px;}
  previas: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  // .crop-preview{border-radius:50%; overflow:hidden; background:var(--mint-100);
  // box-shadow:0 0 0 2px rgba(245,250,248,0.18);} — el aro va como borde.
  previa: {
    borderRadius: Radii.full,
    overflow: 'hidden',
    backgroundColor: Colors.mint100,
    borderWidth: 2,
    borderColor: Colors.cropAroPrevia,
  },
  // .crop-actions{display:flex; gap:10px; padding:14px 20px 26px;}
  acciones: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 14,
    paddingHorizontal: ScreenPadding,
  },
  // .crop-actions .ghost-btn{background:transparent; color:var(--mint-50);
  // border-color:rgba(245,250,248,0.35);} sobre los valores de `.ghost-btn`.
  ghost: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.cropBorde,
    borderRadius: Radii.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ghostLabel: {
    ...Typography.emphasis,
    color: Colors.mint50,
  },
  // .crop-actions .primary-btn{background:var(--mint-400); color:var(--mint-900);}
  // con `flex:1.2` inline.
  primary: {
    flex: 1.2,
    backgroundColor: Colors.mint400,
    borderRadius: Radii.lg,
    paddingVertical: 15,
    alignItems: 'center',
  },
  primaryLabel: {
    ...Typography.buttonPrimary,
    color: Colors.mint900,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.45,
  },
});
