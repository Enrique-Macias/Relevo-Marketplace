import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { Colors } from '@/constants/theme';

// Tab bar de Relevo: 4 ítems fijos, sin botón central de "+"
// (publicar vive como FAB en Perfil — ver CLAUDE.md §0.6).
// Sin íconos todavía: se deciden al construir esta pantalla de verdad
// (SF Symbol vs. el SVG de línea de relevo-app.html exportado a PNG).
export default function TabsLayout() {
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
