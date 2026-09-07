import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { Colors, Radii, Typography } from '@/constants/theme';

/** Frame "Splash" de `design/relevo-app.html`. */
export default function SplashScreen() {
  useEffect(() => {
    const t = setTimeout(() => router.replace('/bienvenida'), 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    // .splash-screen{background:linear-gradient(135deg, var(--ink) 0%, var(--brick-dark) 100%);}
    // 135deg en CSS va de arriba-izquierda a abajo-derecha.
    <LinearGradient
      colors={[Colors.ink, Colors.brickDark]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.screen}
    >
      <StatusBar style="light" />
      {/* .splash-logo{width:64px; height:64px; border-radius:20px; background:var(--paper); margin-bottom:18px;} */}
      <View style={styles.logo}>
        <Text style={styles.logoMark}>R</Text>
      </View>
      <Text style={styles.word}>Relevo</Text>
      <Text style={styles.tag}>Tu campus, tu mercado</Text>
      <View style={styles.dots}>
        <BlinkingDot delay={0} />
        <BlinkingDot delay={200} />
        <BlinkingDot delay={400} />
      </View>
    </LinearGradient>
  );
}

/**
 * `@keyframes splash-blink{0%,80%,100%{opacity:0.3;} 40%{opacity:1;}}`
 * con `animation: splash-blink 1.2s infinite ease-in-out` y delays 0 / 0.2s /
 * 0.4s en los dots 1, 2 y 3. Traducido a los mismos tiempos: de 0.3 a 1 en el
 * 40% del ciclo (480ms), de vuelta a 0.3 en el siguiente 40%, y 20% en reposo.
 */
function BlinkingDot({ delay }: { delay: number }) {
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

  return <Animated.View style={[styles.dot, { opacity }]} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: Radii.xxl,
    backgroundColor: Colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  // .splash-logo span{font-size:28px; font-weight:600; color:var(--brick);}
  logoMark: {
    ...Typography.priceLarge,
    color: Colors.brick,
  },
  // .splash-word{font-size:26px; font-weight:600; color:var(--paper); margin-bottom:6px;}
  word: {
    ...Typography.splash,
    color: Colors.paper,
    marginBottom: 6,
  },
  // .splash-tag{font-size:12.5px; color:rgba(243,240,234,0.65);}
  tag: {
    ...Typography.meta,
    color: Colors.paper65,
  },
  // .splash-dots{display:flex; gap:6px; margin-top:36px;}
  dots: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 36,
  },
  // .splash-dot{width:6px; height:6px; border-radius:50%; background:rgba(243,240,234,0.5);}
  dot: {
    width: 6,
    height: 6,
    borderRadius: Radii.full,
    backgroundColor: Colors.paper50,
  },
});
