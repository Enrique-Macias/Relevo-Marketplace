import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';

import { AuthBody, AuthHeadline, AuthLink, AuthLinkStrong, AuthLogo, AuthSub, AuthTerms } from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';

/** Frame "Verificación". */
export default function VerificacionScreen() {
  const [correo, setCorreo] = useState('');

  return (
    <Screen>
      <StatusBar style="dark" />
      <AuthBody>
        <AuthLogo mark="R" />
        <AuthHeadline>Verifica que eres estudiante</AuthHeadline>
        <AuthSub>
          Usa tu correo institucional para crear tu cuenta y acceder al catálogo de tu campus.
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

        <PrimaryButton
          label="Enviar código de verificación"
          onPress={() => router.push('/codigo')}
        />

        <AuthLink>
          ¿Ya tienes cuenta?{' '}
          <AuthLinkStrong onPress={() => router.push('/iniciar-sesion')}>
            Inicia sesión
          </AuthLinkStrong>
        </AuthLink>
        <AuthTerms>
          Al continuar aceptas los Términos de uso y el Aviso de privacidad de Relevo.
        </AuthTerms>
      </AuthBody>
    </Screen>
  );
}
