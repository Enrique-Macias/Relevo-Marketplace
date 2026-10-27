import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AuthBody, AuthHeadline, AuthLink, AuthLinkStrong, AuthLogo, AuthSub } from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { ErrorState } from '@/components/ErrorState';
import { OTP_LENGTH, OtpInput } from '@/components/OtpInput';
import { Screen } from '@/components/Screen';
import { Colors, Typography } from '@/constants/theme';
import { mensajeErrorAuth } from '@/lib/errores-auth';
import { useRedirectSiPerfilCompleto, useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

import { usePerfilDraft } from './_layout';

/**
 * Frame "Código de verificación".
 *
 * A dónde se va tras verificar lo decide el PERFIL REAL de la cuenta, no el
 * flujo (AUTH-1). `signInWithOtp` con `shouldCreateUser: true` sirve igual a un
 * correo nuevo que a uno con cuenta, y el cliente no puede distinguirlos antes
 * de verificar. Antes se navegaba siempre a "Completar perfil" en el instante
 * del `verifyOtp`, y una cuenta completa terminaba ahí, donde guardar le
 * sobrescribe contraseña, nombre y campus. Ahora la pantalla espera a que
 * `SessionProvider` resuelva el perfil de ESA cuenta y entonces:
 *   - completo → Feed (lo hace `useRedirectSiPerfilCompleto`, de abajo);
 *   - incompleto → "Completar perfil";
 *   - la lectura falló → error con "Reintentar". Nunca se asume incompleto.
 */
export default function CodigoScreen() {
  const redirect = useRedirectSiPerfilCompleto();
  const { status, session, isProfileComplete, profileError, refreshProfile } = useSession();
  const { correo } = usePerfilDraft();
  const [code, setCode] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // El usuario que devolvió el `verifyOtp` correcto. Puesto, la pantalla deja
  // de aceptar acciones y solo espera el perfil de ESTE usuario.
  const [verificadoPara, setVerificadoPara] = useState<string | null>(null);
  const [reintentando, setReintentando] = useState(false);

  // Completo → Feed. Va primero, igual que antes de AUTH-1.
  if (redirect) return redirect;

  // Defensa (AUTH-2): el código ya se verificó, la resolución terminó y NO hay
  // sesión (p. ej., la cuenta se borró justo después y `SessionProvider` cerró
  // la sesión local). Sin esto la pantalla se quedaría en "Verificando…".
  // No adelanta a la sesión: auth-js emite `SIGNED_IN` dentro de `verifyOtp`,
  // antes de que `verificadoPara` se fije, así que en el camino normal la
  // sesión ya existe cuando esto se evalúa. Splash decide a dónde va.
  if (verificadoPara !== null && status === 'ready' && session === null) {
    return <Redirect href="/splash" />;
  }

  // El perfil resuelto es el de la cuenta recién verificada: `status` solo es
  // `ready` cuando el perfil cargado es el del `userId` actual, y aquí además
  // se exige que ese `userId` sea el que verificó.
  const resuelto =
    verificadoPara !== null && session?.user.id === verificadoPara && status === 'ready' && !reintentando;

  if (resuelto && !profileError && !isProfileComplete) {
    return <Redirect href="/completar-perfil" />;
  }

  const reintentar = async () => {
    setReintentando(true);
    await refreshProfile();
    setReintentando(false);
  };

  if (resuelto && profileError) {
    return (
      <Screen>
        <StatusBar style="dark" />
        <ErrorState
          onRetry={() => void reintentar()}
          title="No pudimos cargar tu perfil"
          sub="Revisa tu conexión e intenta de nuevo."
        />
      </Screen>
    );
  }

  // Desde el éxito del `verifyOtp` hasta que hay destino: misma pantalla, con
  // el botón en "Verificando…" y sin acciones.
  const esperando = verificando || verificadoPara !== null;

  const verificar = async () => {
    setVerificando(true);
    setError(null);
    // `type: 'email'` es el que corresponde a un OTP pedido con signInWithOtp.
    // Si sale bien, la sesión ya existe aquí — antes de fijar contraseña.
    // (El de "Código de recuperación" usa `type: 'recovery'`; son tokens
    // distintos aunque la fila de cajas sea la misma.)
    const { data, error: e } = await supabase.auth.verifyOtp({
      email: correo.trim(),
      token: code,
      type: 'email',
    });
    setVerificando(false);
    if (e) {
      setError(mensajeErrorAuth(e));
      return;
    }
    const uid = data.user?.id ?? null;
    if (!uid) {
      // No debería pasar con `type: 'email'`. Si pasa, decide el splash, que
      // es la pantalla que resuelve a dónde va alguien según su sesión.
      router.replace('/splash');
      return;
    }
    setVerificadoPara(uid);
  };

  const reenviar = async () => {
    // Con el código ya verificado no hay nada que reenviar: la sesión existe.
    if (verificadoPara !== null) return;
    setError(null);
    const { error: e } = await supabase.auth.signInWithOtp({
      email: correo.trim(),
      options: { shouldCreateUser: true },
    });
    if (e) setError(mensajeErrorAuth(e));
  };

  return (
    <Screen>
      <StatusBar style="dark" />
      <AuthBody>
        <AuthLogo marca />
        <AuthHeadline>Ingresa el código</AuthHeadline>
        <AuthSub>Te enviamos un código de 6 dígitos a {correo}</AuthSub>

        <OtpInput value={code} onChangeText={setCode} />

        <PrimaryButton
          label={esperando ? 'Verificando…' : 'Verificar'}
          onPress={verificar}
          disabled={code.length !== OTP_LENGTH || esperando}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <AuthLink>
          ¿No llegó el código?{' '}
          <AuthLinkStrong onPress={reenviar}>Reenviar</AuthLinkStrong>
        </AuthLink>
      </AuthBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: {
    ...Typography.meta,
    color: Colors.danger,
    textAlign: 'center',
    marginTop: 12,
  },
});
