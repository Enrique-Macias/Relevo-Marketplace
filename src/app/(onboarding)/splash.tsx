import { LinearGradient } from 'expo-linear-gradient';
import { Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BlinkingDots } from '@/components/BlinkingDots';
import { ErrorState } from '@/components/ErrorState';
import { Screen } from '@/components/Screen';
import { Colors, Radii, Typography } from '@/constants/theme';
import { getHasSeenOnboarding } from '@/lib/onboarding-flag';
import { useSession } from '@/lib/session';

/**
 * Frame "Splash" — y la pantalla que decide a dónde entra el usuario.
 *
 * Se queda visible mientras se resuelven las dos preguntas del gating (¿hay
 * sesión? ¿el perfil está completo?) más la bandera del carrusel. Sustituye al
 * `setTimeout` fijo de 1.5s que tenía antes: el tiempo que tarda es el que
 * tarde la sesión en cargar, ni más ni menos.
 */
export default function SplashScreen() {
  const { status, session, isProfileComplete, profileError, refreshProfile } = useSession();
  const [vioCarrusel, setVioCarrusel] = useState<boolean | null>(null);
  // Mientras "Reintentar" lee el perfil, el splash vuelve a su estado de
  // espera: no se decide nada con un perfil todavía no resuelto.
  const [reintentando, setReintentando] = useState(false);

  useEffect(() => {
    void getHasSeenOnboarding().then(setVioCarrusel);
  }, []);

  const listo = status === 'ready' && vioCarrusel !== null && !reintentando;

  const reintentar = async () => {
    setReintentando(true);
    await refreshProfile();
    setReintentando(false);
  };

  if (listo) {
    if (!session) {
      // Sin sesión: el carrusel solo la primera vez; después, directo al login.
      return <Redirect href={vioCarrusel ? '/iniciar-sesion' : '/bienvenida'} />;
    }
    if (!isProfileComplete) {
      // Perfil incompleto ≠ error al leer el perfil (AUTH-1b): sin poder
      // leerlo no se sabe si está completo, y mandar a "Completar perfil" a una
      // cuenta completa le dejaría sobrescribir contraseña, nombre y campus.
      if (profileError) {
        return (
          <Screen>
            <StatusBar style="dark" />
            <ErrorState
              onRetry={() => void reintentar()}
              title="No pudimos cargar tu perfil"
              sub="Revisa tu conexión e intenta de nuevo."
            />
          </Screen>
        );
      }
      return <Redirect href="/completar-perfil" />;
    }
    return <Redirect href="/(tabs)" />;
  }

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
      <BlinkingDots />
    </LinearGradient>
  );
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
});
