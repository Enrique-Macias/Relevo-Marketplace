import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';
import { useSession } from '@/lib/session';

// Tab bar de Relevo: 4 ítems fijos, sin botón central de "+"
// (publicar vive como FAB en Perfil — ver CLAUDE.md §0.6).
// Sin íconos todavía: se deciden al construir esta pantalla de verdad
// (SF Symbol vs. el SVG de línea de relevo-app.html exportado a PNG).
export default function TabsLayout() {
  const { status, session, isProfileComplete } = useSession();

  // Guard del gating: aquí es literalmente "no puedes entrar al Feed".
  // Va en este layout y no en el root porque el usuario con perfil a medias
  // debe poder seguir moviéndose dentro de (onboarding) — incluida la pantalla
  // de notificaciones, que se visita justo cuando el perfil ya quedó completo.
  if (status === 'ready') {
    if (!session) return <Redirect href="/splash" />;
    if (!isProfileComplete) return <Redirect href="/completar-perfil" />;
  }

  return (
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
  );
}
