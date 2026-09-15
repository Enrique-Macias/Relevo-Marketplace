import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import {
  AuthBody,
  AuthHeadline,
  AuthLink,
  AuthLinkStrong,
  AuthLogo,
  AuthSub,
  AuthTerms,
} from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Colors, Typography } from '@/constants/theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

import { MIN_PASSWORD } from './completar-perfil';

/**
 * Frame "Nueva contraseña" — último paso de RF-04.
 *
 * Igual que "Código de recuperación", NO llama a `useRedirectSiPerfilCompleto()`:
 * a esta pantalla se llega ya con sesión (la que dejó `verifyOtp`), así que ese
 * guard la volvería inalcanzable. Ver el comentario de aquel archivo.
 */
export default function NuevaPasswordScreen() {
  const { status, session, signOut } = useSession();
  const { mostrar } = useToast();
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sin sesión no hay nada que actualizar: `updateUser` fallaría con un 401 y el
  // usuario vería un error críptico. Pasa si se entra por deep link, o si la app
  // se reinició entre el código y esta pantalla.
  if (status === 'ready' && !session) return <Redirect href="/recuperar-password" />;

  const puedeGuardar = password.length >= MIN_PASSWORD && password === passwordConfirm;

  const guardar = async () => {
    setGuardando(true);
    setError(null);

    const { error: e } = await supabase.auth.updateUser({ password });
    if (e) {
      setGuardando(false);
      // El caso esperable es teclear la contraseña ACTUAL: GoTrue responde "New
      // password should be different from the old password". Se muestra tal cual,
      // como en el resto de las pantallas de auth.
      setError(e.message);
      return;
    }

    // El toast ANTES del signOut y de navegar: el ToastProvider vive en el layout
    // raíz, así que sobrevive a las dos cosas. Copy del frame "Toast de éxito".
    mostrar('Contraseña actualizada');

    // El `signOut` de useSession y NO `supabase.auth.signOut()` directo: aquél
    // borra el push token ANTES de cerrar sesión, y ese orden es obligatorio (la
    // policy de delete es `user_id = auth.uid()`).
    //
    // Se cierra sesión a propósito aunque la de recuperación sea válida: obliga a
    // estrenar la contraseña nueva, así que el usuario COMPRUEBA que funciona
    // antes de salir del flujo.
    await signOut();
    setGuardando(false);
    router.replace('/iniciar-sesion');
  };

  /**
   * "Volver a iniciar sesión" — la salida del frame, para quien se arrepiente.
   *
   * Cierra sesión y NO solo navega, por dos razones distintas. La primera es que
   * sin eso no funcionaría: `iniciar-sesion.tsx` llama a
   * `useRedirectSiPerfilCompleto()`, que con la sesión de recuperación todavía
   * viva rebotaría al Feed en vez de mostrar el formulario. La segunda es que deja
   * el estado limpio — abandonar aquí a propósito no debe dejar al usuario dentro
   * de la app con la contraseña que venía a cambiar.
   */
  const volver = async () => {
    setGuardando(true);
    await signOut();
    setGuardando(false);
    router.replace('/iniciar-sesion');
  };

  return (
    <Screen>
      <StatusBar style="dark" />
      <AuthBody>
        <AuthLogo background={Colors.forest} />
        <AuthHeadline>Crea una contraseña nueva</AuthHeadline>
        <AuthSub>Elige una contraseña que no hayas usado antes en Relevo.</AuthSub>

        <Field
          label="Nueva contraseña"
          placeholder="••••••••"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!guardando}
        />
        {/* El último `.field` del frame lleva `style="margin-bottom:0"`. */}
        <Field
          label="Confirma tu contraseña"
          placeholder="••••••••"
          value={passwordConfirm}
          onChangeText={setPasswordConfirm}
          secureTextEntry
          editable={!guardando}
          containerStyle={styles.lastField}
        />
        {/* `.auth-terms` con `style="margin-top:6px"`, como en el frame. */}
        <AuthTerms style={styles.hint}>Usa al menos {MIN_PASSWORD} caracteres.</AuthTerms>

        {/* El frame le pone `style="margin-top:28px"` al botón. */}
        <PrimaryButton
          label={guardando ? 'Guardando…' : 'Guardar contraseña'}
          onPress={guardar}
          disabled={!puedeGuardar || guardando}
          style={styles.submit}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <AuthLink>
          <AuthLinkStrong onPress={volver}>Volver a iniciar sesión</AuthLinkStrong>
        </AuthLink>
      </AuthBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lastField: {
    marginBottom: 0,
  },
  hint: {
    marginTop: 6,
  },
  submit: {
    marginTop: 28,
  },
  error: {
    ...Typography.meta,
    color: Colors.brick,
    textAlign: 'center',
    marginTop: 12,
  },
});
