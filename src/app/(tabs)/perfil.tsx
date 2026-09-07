import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConfirmModal } from '@/components/ConfirmModal';
import { IconLogout } from '@/components/icons';
import { Colors, Typography } from '@/constants/theme';
import { useSession } from '@/lib/session';

/**
 * Placeholder deliberado: la pantalla real "Perfil" (avatar, stats, "Mis
 * publicaciones", el resto del `.menu-list`) necesita datos de `listings` que
 * todavía no están conectados — es otra tarea. Por ahora solo se conecta el
 * afordance de "Cerrar sesión" al modal ya construido, sin intentar machear
 * el frame completo (decisión explícita, ver el plan de esta tarea).
 */
export default function PerfilScreen() {
  const { signOut } = useSession();
  const [confirmando, setConfirmando] = useState(false);
  const [cerrandoSesion, setCerrandoSesion] = useState(false);

  const cerrarSesion = async () => {
    setCerrandoSesion(true);
    await signOut();
    // No hay que navegar a mano ni cerrar el modal aquí: cambiar la sesión
    // dispara el guard de (tabs)/_layout.tsx, que ya redirige a /splash — el
    // desmontaje de esta pantalla se encarga de todo lo demás.
  };

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Perfil</Text>

      <Pressable
        style={styles.logoutRow}
        onPress={() => setConfirmando(true)}
        accessibilityRole="button"
      >
        <Text style={styles.logoutLabel}>Cerrar sesión</Text>
      </Pressable>

      <ConfirmModal
        visible={confirmando}
        icon={<IconLogout size={22} color={Colors.brick} />}
        title="¿Cerrar sesión?"
        body="Tendrás que verificar tu correo de nuevo la próxima vez que quieras entrar a Relevo."
        confirmLabel="Cerrar sesión"
        onConfirm={cerrarSesion}
        onCancel={() => setConfirmando(false)}
        confirming={cerrandoSesion}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    backgroundColor: Colors.paper,
  },
  text: {
    ...Typography.pageHeading,
    color: Colors.ink,
  },
  logoutRow: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  logoutLabel: {
    ...Typography.emphasis,
    color: Colors.brick,
  },
});
