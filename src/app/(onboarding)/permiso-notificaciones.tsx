import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GhostButton, PrimaryButton } from '@/components/Buttons';
import { IconBell } from '@/components/icons';
import { Screen } from '@/components/Screen';
import { Colors, Radii, Typography } from '@/constants/theme';
import { registrarPushToken } from '@/lib/push';
import { useSession } from '@/lib/session';

/** Frame "Permiso de notificaciones". */
export default function NotificacionesScreen() {
  const { session } = useSession();
  const [pidiendo, setPidiendo] = useState(false);

  const irAlFeed = () => router.replace('/(tabs)');

  /**
   * Pide el permiso real del sistema y guarda el token (RF-16).
   *
   * Se entra al Feed pase lo que pase, incluso si el usuario dice que no en el
   * diálogo del sistema: esta pantalla es el último paso del onboarding, y
   * dejarlo atorado aquí por no querer notificaciones sería absurdo. El
   * resultado no se usa para nada más que no volver a pedirlo — el efecto de
   * `SessionProvider` reintenta en cada arranque, que es lo que cubre a las
   * cuentas que nunca vieron esta pantalla.
   */
  const activar = async () => {
    setPidiendo(true);
    if (session?.user.id) await registrarPushToken(session.user.id);
    irAlFeed();
  };

  return (
    <Screen>
      <StatusBar style="dark" />
      {/* .empty-state{align-items:center; padding:64px 30px 0;} + `padding-top:80px` del frame */}
      <View style={styles.emptyState}>
        {/* .empty-icon{width:72px; height:72px; border-radius:50%;} + .notif-permission-icon{background:var(--brick-tint);} */}
        <View style={styles.icon}>
          <IconBell size={30} color={Colors.brick} />
        </View>
        <Text style={styles.title}>No te pierdas nada</Text>
        <Text style={styles.sub}>
          Te avisamos cuando baje el precio de un favorito o alguien te contacte por una
          publicación.
        </Text>
        {/* .empty-actions{width:100%; flex-direction:column; gap:10px;} */}
        <View style={styles.actions}>
          {/* El frame le pone `style="margin-top:0"` al primary, anulando los 4px de la clase. */}
          <PrimaryButton
            label="Activar notificaciones"
            onPress={activar}
            busy={pidiendo}
            style={styles.primary}
          />
          <GhostButton label="Ahora no" onPress={irAlFeed} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    alignItems: 'center',
    paddingTop: 80,
    paddingHorizontal: 30,
  },
  icon: {
    width: 72,
    height: 72,
    borderRadius: Radii.full,
    backgroundColor: Colors.brickTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  // .empty-title{font-size:19px; margin-bottom:9px; max-width:240px;}
  title: {
    ...Typography.emptyTitle,
    color: Colors.ink,
    marginBottom: 9,
    maxWidth: 240,
    textAlign: 'center',
  },
  // .empty-sub{font-size:13px; line-height:1.55; max-width:230px; margin-bottom:24px;}
  sub: {
    ...Typography.auth,
    color: Colors.inkSoft,
    maxWidth: 230,
    marginBottom: 24,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    gap: 10,
  },
  primary: {
    marginTop: 0,
  },
});
