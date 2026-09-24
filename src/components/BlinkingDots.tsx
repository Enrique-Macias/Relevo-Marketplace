/**
 * `.splash-dots` + `.splash-dot` — los tres puntos que parpadean.
 *
 * Nacieron en el frame "Splash" y viven aquí desde que el botón "Subiendo
 * imágenes" de Publicar los necesitó: son el ÚNICO indicador de espera que
 * tiene el sistema de diseño, así que un spinner nuevo habría sido inventar un
 * token (CLAUDE.md §0 regla 2) teniendo uno.
 *
 * Que funcionen igual de bien sobre `--brick` que sobre el degradado del Splash
 * no es suerte: `.splash-dot` es `rgba(243,240,234,0.5)`, o sea `--paper` al
 * 50%, el mismo color del texto de `.primary-btn`.
 */

import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';

import { Colors, Radii } from '@/constants/theme';

/**
 * `@keyframes splash-blink{0%,80%,100%{opacity:0.3;} 40%{opacity:1;}}`
 * con `animation: splash-blink 1.2s infinite ease-in-out` y delays 0 / 0.2s /
 * 0.4s en los dots 1, 2 y 3. Traducido a los mismos tiempos: de 0.3 a 1 en el
 * 40% del ciclo (480ms), de vuelta a 0.3 en el siguiente 40%, y 20% en reposo.
 */
function BlinkingDot({ delay, color }: { delay: number; color: string }) {
  // useState con inicializador lazy, no `useRef(...).current`: con React Compiler
  // activado, leer `.current` durante el render es un error de lint (react-hooks/refs).
  const [opacity] = useState(() => new Animated.Value(0.3));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 480,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 480,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(240),
      ])
    );
    const t = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(t);
      loop.stop();
    };
  }, [delay, opacity]);

  return <Animated.View style={[styles.dot, { opacity, backgroundColor: color }]} />;
}

/**
 * La fila completa. `style` existe porque `.splash-dots` trae un `margin-top:36`
 * que solo tiene sentido bajo el wordmark del Splash; dentro de un botón se
 * anula (`.primary-btn.is-busy .splash-dots{margin-top:0;}`).
 *
 * `dotColor` es opcional y por default es el mismo `--paper` al 50% de
 * siempre — pensado para el caso nuevo de "Selector de campus (detectando
 * ubicación)": ahí los puntos van sobre `--paper`, no dentro de un botón
 * `--brick`, así que necesitan el color opuesto (`--brick`) para leerse.
 */
export function BlinkingDots({ style, dotColor = Colors.paper50 }: { style?: ViewStyle; dotColor?: string }) {
  return (
    <View style={[styles.dots, style]}>
      <BlinkingDot delay={0} color={dotColor} />
      <BlinkingDot delay={200} color={dotColor} />
      <BlinkingDot delay={400} color={dotColor} />
    </View>
  );
}

const styles = StyleSheet.create({
  // .splash-dots{display:flex; gap:6px; margin-top:36px;}
  dots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 36,
  },
  // .splash-dot{width:6px; height:6px; border-radius:50%;} — el color va inline
  // (prop `dotColor` de `BlinkingDots`), no aquí.
  dot: {
    width: 6,
    height: 6,
    borderRadius: Radii.full,
  },
});
