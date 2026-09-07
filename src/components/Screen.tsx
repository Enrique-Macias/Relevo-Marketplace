/**
 * Reemplazo del chrome de la maqueta.
 *
 * En `relevo-app.html` cada pantalla vive dentro de `.device` (375×812, borde de
 * 10px, radio 44) con un `.notch` y una `.statusbar` falsa que dibuja "9:41" y
 * tres SVG de señal/wifi/batería. Nada de eso es UI de la app: en un teléfono
 * real lo da el hardware y la barra de estado del sistema. Lo que sí se traduce
 * es `.screen` (`flex:1; overflow-y:auto; padding-bottom:8px`) y el fondo
 * `--paper` del `.device`.
 */

import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';

type ScreenProps = {
  children: React.ReactNode;
  /** `.screen` tiene overflow-y:auto. Ponlo en false para pantallas que no scrollean (splash, carrusel). */
  scroll?: boolean;
  /** Contenido fijo por encima del área scrolleable — en el HTML es hermano de `.screen`, no hijo (ej. `.form-header`). */
  header?: React.ReactNode;
  contentStyle?: ViewStyle;
};

export function Screen({ children, scroll = true, header, contentStyle }: ScreenProps) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {header}
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.paper, // fondo de `.device`
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 8, // `.screen { padding-bottom: 8px }`
  },
});
