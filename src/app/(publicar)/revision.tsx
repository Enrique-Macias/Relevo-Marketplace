/**
 * Frame "Publicación en revisión" (RF-18).
 *
 * HERMANA de "Publicación creada", no un estado suyo: el cliente ESPERA el
 * veredicto de `moderar-contenido`, así que al terminar de publicar se navega a
 * UNA de las tres según el estado que devolvió la Edge Function. Por eso son
 * frames y no una variante etiquetada — el usuario se queda aquí y lo lee con
 * calma, o sea que no aplica la excepción de los toasts (CLAUDE.md §0 regla 4).
 *
 * Y ES LA ÚNICA DE LAS TRES QUE SIGUE ESPERANDO ALGO, que es lo que justifica
 * que sea también la única con Realtime: `pendiente` es literalmente la cola de
 * revisión (CLAUDE.md §3), así que el estado todavía puede moverse a `activa` o
 * a `bloqueada` mientras el usuario mira la pantalla. `useVeredictoEnVivo()`
 * trae el cambio por Realtime y, si el socket no conectó, por el refetch al
 * foco — Realtime es la vía rápida, el refetch es el que garantiza.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { GhostButton, PrimaryButton } from '@/components/Buttons';
import { EmptyState } from '@/components/EmptyState';
import { IconClock } from '@/components/icons';
import { Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { useVeredictoEnVivo } from '@/lib/moderacion';

export default function PublicacionEnRevisionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listingId = Number(id);

  const { titulo, estado } = useVeredictoEnVivo(listingId);

  /**
   * El veredicto que llegó DESPUÉS de aterrizar aquí.
   *
   * `replace` y no `push` por lo mismo que en "Publicar": estas tres pantallas
   * son terminales del alta, y "atrás" no debe devolver a una que ya no dice la
   * verdad. Un estado que no sea ninguno de los dos —`pendiente`, o el `null`
   * de mientras carga— no hace nada: esta pantalla ya es la correcta.
   */
  useEffect(() => {
    if (estado === 'activa') {
      router.replace({ pathname: '/(publicar)/creada', params: { id: String(listingId) } });
    } else if (estado === 'bloqueada') {
      router.replace({ pathname: '/(publicar)/no-aprobada', params: { id: String(listingId) } });
    }
  }, [estado, listingId]);

  // Mientras el título carga, la frase se arma con lo que haya — mismo criterio
  // que "Publicación creada": la confirmación no se queda en blanco esperando
  // un adorno.
  const sub = `${titulo ? `"${titulo}"` : 'Tu publicación'} se publicará en cuanto la revisemos. Suele tomar unas horas.`;

  return (
    <Screen>
      <StatusBar style="dark" />
      <EmptyState
        // Ícono NEUTRO, sin `iconStyle`: aquí no pasó nada bueno ni nada malo
        // todavía. Con el check en --forest diría que ya está publicada.
        icon={<IconClock size={30} color={Colors.inkSoft} />}
        style={styles.estado}
        title="Tu publicación está en revisión"
        sub={sub}
      >
        <PrimaryButton
          label="Ver mis publicaciones"
          onPress={() => router.replace('/(cuenta)/mis-publicaciones')}
          style={styles.cta}
        />
        <GhostButton label="Volver al inicio" onPress={() => router.replace('/(tabs)')} />
      </EmptyState>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // El frame le pone `style="padding-top:90px"` al .empty-state.
  estado: {
    paddingTop: 90,
  },
  cta: {
    marginTop: 0,
  },
});
