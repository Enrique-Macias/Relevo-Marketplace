/**
 * Frame "Cuenta eliminada" — lo que ve el usuario al terminar de borrar su
 * cuenta desde "Configuración".
 *
 * Vive en `(onboarding)` porque ya no hay sesión: se llega aquí por el guard
 * global (`src/lib/salida-sesion.ts`), que reinicia la navegación con esta
 * pantalla como única ruta, así que no queda nada con sesión debajo. Mismo
 * esqueleto que "Publicación creada" (`EmptyState` + ícono de éxito).
 *
 * "Entendido" va a `/splash` y no a "Bienvenida": splash es el único que decide
 * a dónde va alguien sin sesión, y así esta pantalla no duplica esa regla.
 */

import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';

import { PrimaryButton } from '@/components/Buttons';
import { EmptyState } from '@/components/EmptyState';
import { IconCheck } from '@/components/icons';
import { Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';

export default function CuentaEliminadaScreen() {
  return (
    <Screen>
      <StatusBar style="dark" />
      <EmptyState
        icon={<IconCheck size={30} color={Colors.forest} />}
        iconStyle={styles.iconoExito}
        style={styles.estado}
        title="Tu cuenta fue eliminada"
        sub="Borramos tu perfil, tus publicaciones y sus fotos. Gracias por haber usado Relevo."
      >
        <PrimaryButton label="Entendido" onPress={() => router.replace('/splash')} style={styles.cta} />
      </EmptyState>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // El frame le pone `padding-top:110px` inline al .empty-state.
  estado: {
    paddingTop: 110,
  },
  iconoExito: {
    backgroundColor: Colors.forestTint,
    borderWidth: 0,
  },
  cta: {
    marginTop: 0,
  },
});
