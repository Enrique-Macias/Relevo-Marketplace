import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';

import { AuthBody, AuthHeadline, AuthLink, AuthLinkStrong, AuthLogo, AuthSub, AuthTerms } from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';

/** Frame "Iniciar sesión". */
export default function IniciarSesionScreen() {
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');

  return (
    <Screen>
      <StatusBar style="dark" />
      <AuthBody>
        <AuthLogo mark="R" />
        <AuthHeadline>Qué bueno verte de nuevo</AuthHeadline>
        <AuthSub>
          Inicia sesión con tu cuenta de Relevo para seguir comprando y vendiendo en tu campus.
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
        <Field
          label="Contraseña"
          placeholder="••••••••"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <PrimaryButton label="Iniciar sesión" onPress={() => router.replace('/(tabs)')} />

        <AuthLink>
          <AuthLinkStrong onPress={() => router.push('/recuperar-password')}>
            ¿Olvidaste tu contraseña?
          </AuthLinkStrong>
        </AuthLink>
        <AuthTerms>
          ¿No tienes cuenta? Verifica tu correo institucional para crear una.
        </AuthTerms>
      </AuthBody>
    </Screen>
  );
}
