import { Redirect, usePathname } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { View, StyleSheet } from 'react-native';

import { PublicarFab } from '@/components/PublicarFab';
import { Colors } from '@/constants/theme';
import { useSession } from '@/lib/session';

// Tab bar de Relevo: 4 ítems fijos, sin botón central de "+"
// (publicar vive como FAB en Perfil — ver CLAUDE.md §0.6).
// Sin íconos todavía: se deciden al construir esta pantalla de verdad
// (SF Symbol vs. el SVG de línea de relevo-app.html exportado a PNG).
export default function TabsLayout() {
  const { status, session, isProfileComplete } = useSession();
  const pathname = usePathname();

  // Guard del gating: aquí es literalmente "no puedes entrar al Feed".
  // Va en este layout y no en el root porque el usuario con perfil a medias
  // debe poder seguir moviéndose dentro de (onboarding) — incluida la pantalla
  // de notificaciones, que se visita justo cuando el perfil ya quedó completo.
  if (status === 'ready') {
    if (!session) return <Redirect href="/splash" />;
    if (!isProfileComplete) return <Redirect href="/completar-perfil" />;
  }

  /**
   * EL FAB VIVE AQUÍ, NO DENTRO DE `perfil.tsx`, Y ES OBLIGATORIO.
   *
   * Dentro del contenido de una pantalla de `NativeTabs` el FAB se PINTA sobre
   * el tab bar pero no recibe el toque: el tab bar es una vista nativa hermana
   * del contenedor del contenido, y se lleva el hit-test de todo su rectángulo
   * antes de que el contenido lo vea (detalle en `PublicarFab.tsx` y en
   * CLAUDE.md §9). Como hermano del navegador sí queda en la misma jerarquía de
   * RN que el host de tabs, y después de él, así que recibe el toque.
   *
   * El diseño lo pone solo en Perfil, de ahí el `pathname`. Envolver el
   * navegador en un `View` no le molesta a Expo Router — la ruta se arma desde
   * el sistema de archivos y los `Trigger`, no desde la posición del navegador
   * en el JSX.
   */
  const enPerfil = pathname === '/perfil';

  return (
    <View style={styles.contenedor}>
      <NativeTabs backgroundColor={Colors.paper} labelStyle={{ selected: { color: Colors.ink } }}>
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Label>Inicio</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="buscar">
          <NativeTabs.Trigger.Label>Buscar</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="favoritos">
          <NativeTabs.Trigger.Label>Favoritos</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="perfil">
          <NativeTabs.Trigger.Label>Perfil</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>

      {enPerfil ? <PublicarFab /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    flex: 1,
  },
});
