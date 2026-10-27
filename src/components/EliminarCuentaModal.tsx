/**
 * Frame "Confirmar eliminar cuenta" (data-cat="sistema"): la ÚNICA confirmación
 * de borrado de cuenta. La abren "Eliminar cuenta" de Configuración y "Eliminar
 * mi cuenta" de "Términos actualizados", que no se puede saltar (PL-016) y por
 * eso necesita esta salida (Apple 5.1.1(v)).
 *
 * `useEliminarCuenta()` devuelve `abrir` y el `modal` ya armado, que la pantalla
 * pinta donde quiera. El estado vive aquí para que las dos pantallas no lo
 * dupliquen.
 *
 * Al terminar, la salida la hace el guard global (`src/lib/salida-sesion.ts`):
 * se pide aterrizar en "Cuenta eliminada" y se cierra la sesión local.
 */

import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { ConfirmModal } from '@/components/ConfirmModal';
import { Field } from '@/components/Field';
import { IconTrash } from '@/components/icons';
import { Notice } from '@/components/Notice';
import { Colors } from '@/constants/theme';
import {
  copyDeFallo,
  EliminarCuentaError,
  eliminarCuenta,
  type FalloEliminarCuenta,
} from '@/lib/eliminar-cuenta';
import { salirHacia } from '@/lib/salida-sesion';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export function useEliminarCuenta() {
  const { session } = useSession();
  const [visible, setVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [eliminando, setEliminando] = useState(false);
  const [fallo, setFallo] = useState<FalloEliminarCuenta | null>(null);

  function abrir() {
    // Todo se resetea al ABRIR, no solo al cerrar: un intento anterior que
    // Fast Refresh preservó a medias dejaría el modal sin salida (el mismo bug
    // de "Cerrar sesión", cuenta-perfil.md).
    setPassword('');
    setFallo(null);
    setEliminando(false);
    setVisible(true);
  }

  async function confirmar() {
    const correo = session?.user.email;
    if (!correo || !password) return;
    setEliminando(true);
    setFallo(null);
    try {
      await eliminarCuenta(correo, password);
    } catch (e) {
      setFallo(e instanceof EliminarCuentaError ? e.motivo : 'servidor');
      if (!(e instanceof EliminarCuentaError)) console.error('[eliminar-cuenta]', e);
      setEliminando(false);
      return;
    }
    // La cuenta ya no existe. Cerrar la sesión LOCAL es lo que dispara la
    // salida: el guard global ve la sesión desaparecer y aterriza en "Cuenta
    // eliminada". `signOut` limpia el storage aunque el servidor conteste
    // 401/404 (la sesión ya no existe allá; auth-js lo ignora,
    // `GoTrueClient.js:3424-3440`). El push token no se borra desde aquí: se fue
    // con la cascada de `push_tokens` al borrar la cuenta.
    salirHacia('cuenta-eliminada');
    await supabase.auth.signOut({ scope: 'local' });
  }

  // La contraseña ES la confirmación. Los errores van dentro del modal: son
  // copy persistente que se lee mientras se corrige (§0 regla 4).
  const modal = (
    <ConfirmModal
      visible={visible}
      icon={<IconTrash size={22} color={Colors.danger} />}
      title="¿Eliminar tu cuenta?"
      body="Se borrarán tu perfil y tus publicaciones de inmediato. Esta acción no se puede deshacer."
      confirmLabel="Eliminar"
      onConfirm={() => void confirmar()}
      // `onCancel` también es el "atrás" de Android (`onRequestClose`): con el
      // borrado en curso no hay nada que cancelar.
      onCancel={() => {
        if (!eliminando) setVisible(false);
      }}
      confirming={eliminando}
      confirmDisabled={password.length === 0}
    >
      <Field
        label="Confirma con tu contraseña"
        placeholder="••••••••"
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          // El error de contraseña habla de la que se mandó.
          if (fallo === 'contrasena') setFallo(null);
        }}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
        editable={!eliminando}
        error={fallo === 'contrasena' ? copyDeFallo('contrasena') : null}
        containerStyle={styles.campo}
      />
      {fallo && fallo !== 'contrasena' ? <Notice text={copyDeFallo(fallo)} style={styles.notice} /> : null}
    </ConfirmModal>
  );

  return { abrir, modal };
}

const styles = StyleSheet.create({
  campo: {
    marginBottom: 0,
  },
  // .notice trae margin-bottom:24px para el .sticky-cta; dentro del modal lo
  // separa el hueco de `children` (20px) de los botones.
  notice: {
    marginTop: 12,
    marginBottom: 0,
  },
});
