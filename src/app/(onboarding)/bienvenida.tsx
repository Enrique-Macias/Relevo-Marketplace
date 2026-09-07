import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/Buttons';
import { IconCheckCircle, IconPin, IconUsers } from '@/components/icons';
import { Colors, Radii, Typography } from '@/constants/theme';

/**
 * Frames "Onboarding 1/3", "2/3" y "3/3" en una sola ruta.
 *
 * Los tres frames comparten `.onboard-screen` completo — top, mid, bottom,
 * dots y botón — y solo cambian ilustración, copy y qué dot va activo. Así que
 * el chrome se monta una vez y los slides van en un pager horizontal.
 */

const SLIDES = [
  {
    Icon: IconUsers,
    tint: Colors.brickTint,
    stroke: Colors.brick,
    headline: 'Compra y vende con tu comunidad',
    sub: 'Un catálogo hecho solo para estudiantes: libros, electrónica, muebles y más, cerca de ti.',
  },
  {
    Icon: IconCheckCircle,
    tint: Colors.forestTint,
    stroke: Colors.forest,
    headline: 'Verificado, cero desconocidos',
    sub: 'Verificamos tu correo institucional para que sepas que del otro lado siempre hay otro estudiante real.',
  },
  {
    Icon: IconPin,
    tint: Colors.goldTint,
    stroke: Colors.gold,
    headline: 'Todo cerca, todo fácil',
    sub: 'Encuentra artículos por campus y ponte de acuerdo en persona — sin comisiones ni envíos.',
  },
] as const;

export default function BienvenidaScreen() {
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const isLast = index === SLIDES.length - 1;

  /**
   * El índice se deriva del offset en `onScroll`, no solo de
   * `onMomentumScrollEnd`: ese último no dispara en un arrastre lento sin
   * inercia ni cuando el offset se fija por código, y entonces los dots y la
   * etiqueta del botón se quedan en el slide anterior aunque en pantalla ya se
   * vea el siguiente.
   */
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index && next >= 0 && next < SLIDES.length) {
      setIndex(next);
    }
  };

  const onPrimaryPress = () => {
    if (isLast) {
      router.push('/verificacion');
      return;
    }
    scrollRef.current?.scrollTo({ x: (index + 1) * width, animated: true });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar style="dark" />

      {/* .onboard-top{justify-content:flex-end; padding:16px 20px 0;} */}
      <View style={styles.top}>
        {/*
          En el frame 3/3 el "Omitir" lleva `visibility:hidden`, que oculta pero
          CONSERVA el espacio. En RN eso es opacity:0 — con display:none el
          bloque de abajo se recorrería 16px hacia arriba en el último slide.
        */}
        <Text
          style={[styles.skip, isLast && styles.skipHidden]}
          onPress={isLast ? undefined : () => router.push('/verificacion')}
          suppressHighlighting
        >
          Omitir
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.pager}
      >
        {SLIDES.map((slide) => (
          // .onboard-mid{flex:1; align-items:center; justify-content:center; padding:0 32px;}
          <View key={slide.headline} style={[styles.mid, { width }]}>
            {/* .onboard-illustration{width:112px; height:112px; border-radius:50%; margin-bottom:30px;} */}
            <View style={[styles.illustration, { backgroundColor: slide.tint }]}>
              <slide.Icon size={48} color={slide.stroke} />
            </View>
            <Text style={styles.headline}>{slide.headline}</Text>
            <Text style={styles.sub}>{slide.sub}</Text>
          </View>
        ))}
      </ScrollView>

      {/* .onboard-bottom{padding:0 24px 30px;} */}
      <View style={styles.bottom}>
        <View style={styles.dots}>
          {SLIDES.map((slide, i) => (
            <View
              key={slide.headline}
              style={[styles.dot, i === index && styles.dotActive]}
            />
          ))}
        </View>
        <PrimaryButton label={isLast ? 'Comenzar' : 'Siguiente'} onPress={onPrimaryPress} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.paper,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: 16,
    paddingHorizontal: 20,
  },
  // .onboard-skip{font-size:12.5px; font-weight:600; color:var(--ink-soft);}
  skip: {
    ...Typography.label,
    color: Colors.inkSoft,
  },
  skipHidden: {
    opacity: 0,
  },
  pager: {
    flex: 1,
  },
  mid: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  illustration: {
    width: 112,
    height: 112,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  // .onboard-headline{font-size:22px; margin-bottom:11px; max-width:250px;}
  headline: {
    ...Typography.headline,
    color: Colors.ink,
    marginBottom: 11,
    maxWidth: 250,
    textAlign: 'center',
  },
  // .onboard-sub{font-size:13.5px; line-height:1.6; max-width:250px;}
  sub: {
    ...Typography.paragraph,
    color: Colors.inkSoft,
    maxWidth: 250,
    textAlign: 'center',
  },
  bottom: {
    paddingHorizontal: 24,
    paddingBottom: 30,
  },
  // .onboard-dots{justify-content:center; gap:6px; margin-bottom:20px;}
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginBottom: 20,
  },
  // .onboard-dot{width:6px; height:6px; border-radius:50%; background:var(--line);}
  dot: {
    width: 6,
    height: 6,
    borderRadius: Radii.full,
    backgroundColor: Colors.line,
  },
  // .onboard-dot.active{width:20px; border-radius:4px; background:var(--brick);}
  dotActive: {
    width: 20,
    borderRadius: 4,
    backgroundColor: Colors.brick,
  },
});
