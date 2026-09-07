import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AuthBody, AuthHeadline, AuthLink, AuthLinkStrong, AuthLogo, AuthSub } from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { Colors, Typography } from '@/constants/theme';
import { useRedirectSiPerfilCompleto } from '@/lib/session';
import { supabase } from '@/lib/supabase';

/**
 * Frame "Iniciar sesión" — para quien ya terminó el onboarding y fijó su
 * contraseña en "Completar perfil" (RF-02).
 */
export default function IniciarSesionScreen() {
  const redirect = useRedirectSiPerfilCompleto();
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [entrando, setEntrando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (redirect) return redirect;

  const entrar = async () => {
    setEntrando(true);
    setError(null);
    const { error: e } = await supabase.auth.signInWithPassword({
      email: correo.trim(),
      password,
    });
    setEntrando(false);
    if (e) {
      setError(e.message);
      return;
    }
    // No se navega a mano: al cambiar la sesión, el gating decide el destino
    // (Feed si el perfil está completo, Completar perfil si quedó a medias).
    router.replace('/');
  };

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
          editable={!entrando}
        />
        <Field
          label="Contraseña"
          placeholder="••••••••"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!entrando}
        />

        <PrimaryButton
          label={entrando ? 'Entrando…' : 'Iniciar sesión'}
          onPress={entrar}
          disabled={!correo.trim() || !password || entrando}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <AuthLink>
          <AuthLinkStrong onPress={() => router.push('/recuperar-password')}>
            ¿Olvidaste tu contraseña?
          </AuthLinkStrong>
        </AuthLink>
        <AuthLink>
          ¿No tienes cuenta?{' '}
          <AuthLinkStrong onPress={() => router.push('/verificacion')}>
            Verifica tu correo institucional para crear una.
          </AuthLinkStrong>
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
