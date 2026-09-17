import { Redirect, usePathname } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { View, StyleSheet } from 'react-native';

import { PublicarFab } from '@/components/PublicarFab';
import { Colors } from '@/constants/theme';
import { useRespuestaANotificacion } from '@/lib/push';
import { useSession } from '@/lib/session';

// Tab bar de Relevo: 4 ítems fijos, sin botón central de "+"
// (publicar vive como FAB en Perfil — ver CLAUDE.md §0.6).
// Íconos: PNGs con el color de stroke horneado por estado (activo/inactivo),
// generados por scripts/generate-tab-icons.mjs a partir de las mismas formas
// de design/relevo-app.html — NativeTabs.Trigger.Icon no acepta un <Svg> de
// react-native-svg como `src` (solo VectorIcon), ver CLAUDE.md §9.
export default function TabsLayout() {
  const { status, session, isProfileComplete } = useSession();
  const pathname = usePathname();

  /**
   * El tap sobre un push navega desde AQUÍ, y no desde el layout raíz.
   *
   * Dos razones, las dos de orden: este layout solo se monta cuando el gating ya
   * pasó (hay sesión y el perfil está completo), que es la única situación en la
   * que `/detalle/<id>` es un destino alcanzable; y el raíz devuelve `null`
   * mientras cargan las fuentes, así que una navegación disparada ahí podría
   * ejecutarse antes de que exista el navegador y perderse sin dejar rastro.
   *
   * Y sigue montado bajo las pantallas que se empujan encima (Detalle, Editar),
   * así que el listener no se pierde al navegar.
   */
  useRespuestaANotificacion();

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
      <NativeTabs
        backgroundColor={Colors.paper}
        labelStyle={{ color: Colors.placeholder, selected: { color: Colors.ink } }}
      >
        <NativeTabs.Trigger name="index">
          <NativeTabs.Trigger.Icon
            src={{
              default: require('../../../assets/images/tab-icons/inicio-inactivo.png'),
              selected: require('../../../assets/images/tab-icons/inicio-activo.png'),
            }}
          />
          <NativeTabs.Trigger.Label>Inicio</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="buscar">
          <NativeTabs.Trigger.Icon
            src={{
              default: require('../../../assets/images/tab-icons/buscar-inactivo.png'),
              selected: require('../../../assets/images/tab-icons/buscar-activo.png'),
            }}
          />
          <NativeTabs.Trigger.Label>Buscar</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="favoritos">
          <NativeTabs.Trigger.Icon
            src={{
              default: require('../../../assets/images/tab-icons/favoritos-inactivo.png'),
              selected: require('../../../assets/images/tab-icons/favoritos-activo.png'),
            }}
          />
          <NativeTabs.Trigger.Label>Favoritos</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="perfil">
          <NativeTabs.Trigger.Icon
            src={{
              default: require('../../../assets/images/tab-icons/perfil-inactivo.png'),
              selected: require('../../../assets/images/tab-icons/perfil-activo.png'),
            }}
          />
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
