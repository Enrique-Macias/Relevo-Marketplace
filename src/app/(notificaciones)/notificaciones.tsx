/**
 * Frame "Notificaciones" (+ su estado vacío).
 *
 * Es un INBOX PERSISTIDO, no un espejo del push, y esa distinción es la que
 * decidió toda la arquitectura de RF-16: como las filas tienen que existir de
 * todos modos para pintarse aquí con su hora y su punto de no leído, la tabla
 * `notifications` es también el outbox desde el que sale el push. Si el push
 * falla, el aviso sigue estando aquí.
 */

import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { IconBell } from '@/components/icons';
import { NotifRow } from '@/components/NotifRow';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { SkeletonNotifRows } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { Colors } from '@/constants/theme';
import { useNotificaciones } from '@/lib/notificaciones';
import { useSession } from '@/lib/session';

export default function NotificacionesScreen() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const { items, estado, marcarLeidas, recargar, refrescar } = useNotificaciones(userId);
  const { mostrar } = useToast();
  const [refrescando, setRefrescando] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefrescando(true);
    try {
      await refrescar();
    } catch (e: any) {
      console.warn('[notificaciones] falló el refresh:', e?.message ?? e);
      mostrar('No se pudo actualizar. Intenta de nuevo.', 'error');
    } finally {
      setRefrescando(false);
    }
  }, [refrescar, mostrar]);

  /**
   * Se marcan leídas al terminar de cargar, no al montar: antes de eso `items`
   * está vacío y `marcarLeidas` no tendría nada que marcar.
   *
   * Depende de `marcarLeidas`, que a su vez depende de `items` — pero no es un
   * bucle: la función corta sola en su primera línea si ya no queda ninguna sin
   * leer, que es exactamente el estado en el que la deja su propio update
   * optimista.
   */
  useEffect(() => {
    if (estado !== 'ready') return;
    void marcarLeidas();
  }, [estado, marcarLeidas]);

  return (
    <Screen
      header={<PageHeader title="Notificaciones" />}
      refreshControl={
        <RefreshControl
          refreshing={refrescando}
          onRefresh={onRefresh}
          tintColor={Colors.brick}
          colors={[Colors.brick]}
        />
      }
    >
      <StatusBar style="dark" />

      {estado === 'error' ? (
        <ErrorState
          onRetry={recargar}
          title="No pudimos cargar tus notificaciones"
          sub="Revisa tu conexión e intenta de nuevo."
        />
      ) : estado === 'loading' ? (
        <SkeletonNotifRows filas={5} />
      ) : items.length === 0 ? (
        // Frame "Notificaciones vacío". No es un caso borde: toda cuenta nueva
        // abre esta pantalla así, porque las notificaciones solo nacen de
        // eventos que todavía no ocurrieron.
        <EmptyState
          icon={<IconBell size={30} color={Colors.inkSoft} />}
          title="Todavía no hay avisos"
          sub="Te avisamos aquí cuando baje el precio de algo que guardaste o cuando respondamos a un reporte tuyo."
        />
      ) : (
        <View style={styles.lista}>
          {items.map((n) => (
            <NotifRow
              key={n.id}
              notificacion={n}
              // Sin `listing_id` no se pasa `onPress`, y así la fila ni siquiera
              // se anuncia como botón. Es el caso de las de reporte, que lo
              // traen null a propósito, y el de una publicación ya borrada
              // (la FK es `on delete set null`).
              onPress={
                n.listingId === null
                  ? undefined
                  : () => router.push(`/detalle/${n.listingId}`)
              }
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // El borde inferior lo pone cada `.notif-row`, así que la lista no lleva
  // padding propio: las filas van de borde a borde y el suyo es horizontal.
  lista: {
    paddingBottom: 8,
  },
});
