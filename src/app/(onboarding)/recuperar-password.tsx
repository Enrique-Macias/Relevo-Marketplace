import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AuthBody, AuthHeadline, AuthLink, AuthLinkStrong, AuthLogo, AuthSub } from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { Colors, Typography } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

import { CORREO_RE } from './verificacion';

/**
 * Frame "Recuperar contraseña" — primer paso de RF-04.
 *
 * El reset va por **OTP**, igual que el alta (RF-01), y NO por el enlace que
 * describía el diseño original. El motivo es de alcance: un enlace exige deep
 * linking (dominio propio + apple-app-site-association/assetlinks.json + una
 * página de respaldo para quien no tiene la app), que es su propio proyecto y
 * sigue sin montarse — ver la deuda de Compartir en CLAUDE.md §8. Un código que
 * se teclea no necesita nada de eso.
 */
export default function RecuperarPasswordScreen() {
  const [correo, setCorreo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valido = CORREO_RE.test(correo.trim());

  const enviarCodigo = async () => {
    setEnviando(true);
    setError(null);
    // Sin `redirectTo`: no hay a dónde redirigir (el código se teclea en la app)
    // y el cliente corre en flowType `implicit`, así que tampoco hay PKCE.
    //
    // OJO al leer la respuesta: GoTrue contesta 200 AUNQUE el correo no exista
    // —es anti-enumeración de cuentas, deliberado de su lado—, así que llegar a
    // la pantalla del código no prueba que haya cuenta. Por eso aquí no hay un
    // "ese correo no está registrado" que mostrar: no lo sabemos.
    const { error: e } = await supabase.auth.resetPasswordForEmail(correo.trim());
    setEnviando(false);
    if (e) {
      setError(e.message);
      return;
    }
    router.push({ pathname: '/recuperar-codigo', params: { correo: correo.trim() } });
  };

  return (
    <Screen>
      <StatusBar style="dark" />
      <AuthBody>
        {/* El frame pinta el logo en `--forest` y lo deja SIN letra. */}
        <AuthLogo background={Colors.forest} />
        <AuthHeadline>Recupera tu contraseña</AuthHeadline>
        <AuthSub>
          Te enviaremos un código de 6 dígitos a tu correo institucional para que la
          restablezcas.
        </AuthSub>

        <Field
          label="Correo institucional"
          placeholder="estudiante@institución.mx"
          value={correo}
          onChangeText={setCorreo}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!enviando}
        />

        <PrimaryButton
          label={enviando ? 'Enviando…' : 'Enviar código'}
          onPress={enviarCodigo}
          disabled={!valido || enviando}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <AuthLink>
          <AuthLinkStrong onPress={() => router.back()}>Volver a iniciar sesión</AuthLinkStrong>
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
