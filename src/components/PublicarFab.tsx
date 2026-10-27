/**
 * `.fab` — la acción flotante de "Publicar" que vive sobre el tab bar.
 *
 * ESTE COMPONENTE **NO DEBE RENDERIZARSE DENTRO DE UNA PANTALLA DE `NativeTabs`.**
 * Va como HERMANO del navegador, en `(tabs)/_layout.tsx`. No es una preferencia
 * de organización: dentro de una pantalla se pinta pero NO recibe el toque.
 * El porqué está en CLAUDE.md §9 ("Un elemento visualmente sobre NativeTabs…").
 *
 * En corto: `NativeTabs` monta un `Tabs.Host` de react-native-screens, cuyo
 * contenedor nativo en Android es un `FrameLayout` que hace
 * `addView(contentView)` y luego `addView(bottomNavigationView)`
 * (`TabsContainer.kt`). El hit-testing de un FrameLayout recorre sus hijos en
 * orden inverso, así que cualquier toque dentro del rectángulo del tab bar lo
 * reclama el tab bar ANTES de que el contenido lo vea. `elevation`/`zIndex` de
 * RN no ayudan: solo ordenan hermanos dentro del subárbol de RN, y el tab bar
 * no es uno de ellos.
 */

import { router } from 'expo-router';
import { Platform, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconPlus } from '@/components/icons';
import { Colors, Radii } from '@/constants/theme';
import { useExigirTerminos } from '@/lib/exigir-terminos';

/**
 * Altura del tab bar nativo, que hay que despejar a mano.
 *
 * `NativeTabs` no expone su altura: el `useBottomTabBarHeight()` de
 * react-navigation existe, pero es del navegador de tabs en JS, no de este —
 * aquí la barra la dibuja el sistema (`UITabBar` / `BottomNavigationView`) y su
 * medida no vuelve a JS. De ahí estas dos constantes; el inset inferior se suma
 * aparte porque la barra se asienta SOBRE la del sistema (el home indicator en
 * iOS, los botones o el gesto en Android).
 *
 * La de Android es la altura EFECTIVA medida, no un recurso. Material mide la
 * `BottomNavigationView` según su contenido y usa `m3_bottom_nav_min_height`
 * (64dp, `plugins/withCompactAndroidTabBar.js`) solo como piso: con los
 * recursos actuales, el item seleccionado suma 8 + 32 (indicador) + 4 + 16
 * (etiqueta) + 8 = 68dp, y eso es lo que se midió en un Redmi físico con
 * font_scale 1.0 (187 px a 2.75 px/dp, ANDROID-2K). Esta constante posiciona
 * el FAB respecto a esa altura: si cambian esos recursos, la etiqueta o el
 * indicador, hay que volver a medirla. Con la fuente del sistema agrandada la
 * barra crece y el FAB queda algo más cerca de ella.
 */
const ALTURA_TAB_BAR = Platform.select({ ios: 49, default: 68 });

/** Separación entre el FAB y el tab bar: los 96-78 del prototipo. */
const SEPARACION = 18;

export function PublicarFab() {
  const insets = useSafeAreaInsets();
  // PL-016: publicar exige haber aceptado los Términos (lo rechaza la base).
  const exigirTerminos = useExigirTerminos();

  return (
    <Pressable
      style={[styles.fab, { bottom: insets.bottom + ALTURA_TAB_BAR + SEPARACION }]}
      onPress={() => {
        if (exigirTerminos()) router.push('/(publicar)/nueva');
      }}
      accessibilityRole="button"
      accessibilityLabel="Publicar artículo"
    >
      <IconPlus size={22} color={Colors.paper} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // .fab{position:absolute; right:20px; bottom:96px; width:52px; height:52px;
  //   border-radius:50%; background:var(--brick); box-shadow:0 8px 18px rgba(0,0,0,0.22);}
  //
  // El `bottom` va inline, no aquí: el 96 del prototipo se mide en un lienzo que
  // INCLUYE el tab bar de 78px dibujado, y aquí la barra es nativa y de altura
  // variable por plataforma y safe area. La constante que se conserva es la
  // separación de 18px, no el 96.
  fab: {
    position: 'absolute',
    right: 20,
    width: 52,
    height: 52,
    borderRadius: Radii.full,
    backgroundColor: Colors.brick,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 6,
  },
});
