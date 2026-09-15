import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AuthBody, AuthHeadline, AuthLink, AuthLinkStrong, AuthLogo, AuthSub } from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { OTP_LENGTH, OtpInput } from '@/components/OtpInput';
import { Screen } from '@/components/Screen';
import { Colors, Typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

/**
 * Frame "Código de recuperación" — segundo paso de RF-04.
 *
 * DOS cosas que parecen copiables de "Código de verificación" y no lo son:
 *
 * 1. **No llama a `useRedirectSiPerfilCompleto()`**, al revés que su hermana. No
 *    es un olvido. `verifyOtp({type:'recovery'})` guarda una sesión REAL
 *    (auth-js `GoTrueClient.js:2062`) — el evento se llama `PASSWORD_RECOVERY`,
 *    pero la sesión es indistinguible de la de un login. Con ese guard puesto, el
 *    usuario saldría disparado al Feed en el instante en que el código se
 *    verifica, sin llegar nunca a cambiar su contraseña.
 * 2. **El correo llega por param de ruta, no por `usePerfilDraft()`**. Ese
 *    borrador es el del ALTA (`_layout.tsx`), y su campo `correo` lo escribe
 *    "Verificación". Compartirlo dejaría a los dos flujos peleándose por el mismo
 *    campo si alguien empieza un alta, vuelve atrás y entra aquí.
 */
export default function RecuperarCodigoScreen() {
  const { correo } = useLocalSearchParams<{ correo: string }>();
  const [code, setCode] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verificar = async () => {
    setVerificando(true);
    setError(null);
    // `type: 'recovery'` y NO `'email'`: son tokens distintos en GoTrue aunque la
    // fila de cajas sea la misma. Es también lo que hace que auth-js notifique
    // `PASSWORD_RECOVERY` en vez de `SIGNED_IN`.
    const { error: e } = await supabase.auth.verifyOtp({
      email: correo,
      token: code,
      type: 'recovery',
    });
    setVerificando(false);
    if (e) {
      setError(e.message);
      return;
    }
    // `replace` y no `push`: el código ya se consumió, así que volver aquí con el
    // gesto de atrás no llevaría a ningún lado. Y ya no hace falta pasar el
    // correo — a partir de aquí hay sesión.
    router.replace('/nueva-password');
  };

  const reenviar = async () => {
    setError(null);
    const { error: e } = await supabase.auth.resetPasswordForEmail(correo);
    if (e) setError(e.message);
  };

  return (
    <Screen>
      <StatusBar style="dark" />
      <AuthBody>
        {/* El candado en `--forest`, el mismo de "Recuperar contraseña": la
            identidad visual la marca el FLUJO. Quien viera aquí la "R" del alta
            no sabría en cuál de los dos está. */}
        <AuthLogo background={Colors.forest} />
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
