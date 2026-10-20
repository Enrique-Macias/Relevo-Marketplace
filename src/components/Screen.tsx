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

import { createContext, useContext, useRef } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type RefreshControlProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';

/**
 * El `ScrollView` de la pantalla, expuesto a cualquier `Field` que quede
 * anidado dentro (sin importar cuántos `View` intermedios haya) — es lo que
 * usa `scrollToFocusedInput` para llevar el campo con foco a una zona visible
 * cuando el teclado tapa la parte baja del formulario. `null` fuera de un
 * `Screen` con `scroll` (o dentro de uno con `scroll={false}`).
 */
const ScrollViewRefContext = createContext<React.RefObject<ScrollView | null> | null>(null);

export function useScreenScrollViewRef() {
  return useContext(ScrollViewRefContext);
}

type ScreenProps = {
  children: React.ReactNode;
  /** `.screen` tiene overflow-y:auto. Ponlo en false para pantallas que no scrollean (splash, carrusel). */
  scroll?: boolean;
  /** Contenido fijo por encima del área scrolleable — en el HTML es hermano de `.screen`, no hijo (ej. `.form-header`). */
  header?: React.ReactNode;
  contentStyle?: ViewStyle;
  /**
   * Scroll infinito: se dispara al acercarse al final del contenido. El hook
   * que lo recibe (`useListings.loadMore`) ya ignora llamadas mientras hay una
   * página en vuelo, así que no hace falta debounce aquí.
   *
   * DEUDA CONSCIENTE — esto NO virtualiza. El grid usa `chunkRows()` dentro de
   * este ScrollView, así que todas las filas cargadas quedan montadas: no hay
   * reciclaje de vistas como el de FlatList/FlashList. Ver CLAUDE.md §8 para el
   * disparador concreto de cuándo migrar.
   */
  onEndReached?: () => void;
  /** Pass-through al `refreshControl` del `ScrollView` interno (pull-to-refresh). */
  refreshControl?: React.ReactElement<RefreshControlProps>;
  /**
   * Si aplica el safe area INFERIOR (default true; el superior siempre se aplica).
   *
   * Las pantallas de `NativeTabs` en Android lo apagan explícitamente: ahí
   * expo-router ya envuelve cada pantalla en un `SafeAreaView` de
   * react-native-screens que la termina ENCIMA de la `BottomNavigationView`
   * (que a su vez ya despeja la barra del sistema). Este `SafeAreaView` no mide
   * su propia posición: toma el inset del `SafeAreaProvider` raíz, que es la
   * ventana entera, así que volvía a restar la barra del sistema y dejaba una
   * franja vacía de su misma altura sobre las tabs (130 px = 47dp medidos en un
   * Redmi, ANDROID-2K/2L). En iOS y fuera de las tabs se queda en true.
   */
  bordeInferior?: boolean;
};

// Distancia al final a partir de la cual se pide la página siguiente: poco más
// de una fila de tarjetas, para que la siguiente ya esté ahí al llegar.
const UMBRAL_FIN = 400;

export function Screen({
  children,
  scroll = true,
  header,
  contentStyle,
  onEndReached,
  refreshControl,
  bordeInferior = true,
}: ScreenProps) {
  const scrollRef = useRef<ScrollView>(null);

  const handleScroll = onEndReached
    ? ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
        const restante = contentSize.height - (contentOffset.y + layoutMeasurement.height);
        if (restante < UMBRAL_FIN) onEndReached();
      }
    : undefined;

  return (
    <SafeAreaView style={styles.safe} edges={bordeInferior ? ['top', 'bottom'] : ['top']}>
      {header}
      {scroll ? (
        // Sin este KeyboardAvoidingView, en iOS el teclado se dibuja ENCIMA
        // del ScrollView sin reducir su viewport visible — nada dentro se
        // reacomoda, así que "hacer scroll hasta el campo" no alcanza por sí
        // solo si el campo terminaría de cualquier forma detrás del teclado.
        // En Android no se especifica `behavior` a propósito: el
        // `windowSoftInputMode="adjustResize"` que ya trae Expo por default
        // redimensiona la ventana solo; agregar `"height"` aquí comprimiría
        // dos veces.
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollViewRefContext.Provider value={scrollRef}>
            <ScrollView
              ref={scrollRef}
              style={styles.flex}
              contentContainerStyle={[styles.scrollContent, contentStyle]}
              keyboardShouldPersistTaps="handled"
              onScroll={handleScroll}
              scrollEventThrottle={16}
              refreshControl={refreshControl}
            >
              {children}
            </ScrollView>
          </ScrollViewRefContext.Provider>
        </KeyboardAvoidingView>
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
