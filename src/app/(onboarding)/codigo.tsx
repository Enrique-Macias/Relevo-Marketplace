import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AuthBody, AuthHeadline, AuthLink, AuthLinkStrong, AuthLogo, AuthSub } from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { OTP_LENGTH, OtpInput } from '@/components/OtpInput';
import { Screen } from '@/components/Screen';
import { Colors, Typography } from '@/constants/theme';
import { useRedirectSiPerfilCompleto } from '@/lib/session';
import { supabase } from '@/lib/supabase';

import { usePerfilDraft } from './_layout';

/** Frame "Código de verificación". */
export default function CodigoScreen() {
  const redirect = useRedirectSiPerfilCompleto();
  const { correo } = usePerfilDraft();
  const [code, setCode] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (redirect) return redirect;

  const verificar = async () => {
    setVerificando(true);
    setError(null);
    // `type: 'email'` es el que corresponde a un OTP pedido con signInWithOtp.
    // Si sale bien, la sesión ya existe aquí — antes de fijar contraseña.
    // (El de "Código de recuperación" usa `type: 'recovery'`; son tokens
    // distintos aunque la fila de cajas sea la misma.)
    const { error: e } = await supabase.auth.verifyOtp({
      email: correo.trim(),
      token: code,
      type: 'email',
    });
    setVerificando(false);
    if (e) {
      setError(e.message);
      return;
    }
    router.replace('/completar-perfil');
  };

  const reenviar = async () => {
    setError(null);
    const { error: e } = await supabase.auth.signInWithOtp({
      email: correo.trim(),
      options: { shouldCreateUser: true },
    });
    if (e) setError(e.message);
  };

  return (
    <Screen>
      <StatusBar style="dark" />
      <AuthBody>
        <AuthLogo mark="R" />
        <AuthHeadline>Ingresa el código</AuthHeadline>
        <AuthSub>Te enviamos un código de 6 dígitos a {correo}</AuthSub>

        <OtpInput value={code} onChangeText={setCode} />

        <PrimaryButton
          label={verificando ? 'Verificando…' : 'Verificar'}
          onPress={verificar}
          disabled={code.length !== OTP_LENGTH || verificando}
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
    color: Colors.brick,
    textAlign: 'center',
    marginTop: 12,
  },
});
