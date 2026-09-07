import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';

import { AuthBody, AuthHeadline, AuthLink, AuthLinkStrong, AuthLogo, AuthSub } from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';

/**
 * Frame "Recuperar contraseña". Nótese que el reset aquí es por **enlace**, no
 * por OTP — es la única pantalla de auth que no usa código.
 */
export default function RecuperarPasswordScreen() {
  const [correo, setCorreo] = useState('');

  return (
    <Screen>
      <StatusBar style="dark" />
      <AuthBody>
        {/* El frame pinta el logo en `--forest` y lo deja SIN letra. */}
        <AuthLogo background={Colors.forest} />
        <AuthHeadline>Recupera tu contraseña</AuthHeadline>
        <AuthSub>
          Te enviaremos un enlace a tu correo institucional para que la restablezcas.
        </AuthSub>

        <Field
          label="Correo institucional"
          placeholder="nombre@estudiante.tec.mx"
          value={correo}
          onChangeText={setCorreo}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <PrimaryButton label="Enviar enlace" onPress={() => router.back()} />

        <AuthLink>
          <AuthLinkStrong onPress={() => router.back()}>Volver a iniciar sesión</AuthLinkStrong>
        </AuthLink>
      </AuthBody>
    </Screen>
  );
}
