import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AuthBody, AuthHeadline, AuthLink, AuthLinkStrong, AuthLogo, AuthSub, AuthTerms } from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { Colors, Typography } from '@/constants/theme';
import { useRedirectSiPerfilCompleto } from '@/lib/session';
import { supabase } from '@/lib/supabase';

import { usePerfilDraft } from './_layout';

/** Un correo mínimamente válido; la validación real la hace Supabase Auth. */
const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Frame "Verificación". Registro passwordless: solo correo + OTP. */
export default function VerificacionScreen() {
  const redirect = useRedirectSiPerfilCompleto();
  const { correo, setCorreo } = usePerfilDraft();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (redirect) return redirect;

  const valido = CORREO_RE.test(correo.trim());

  const enviarCodigo = async () => {
    setEnviando(true);
    setError(null);
    // `shouldCreateUser: true` (el default) es lo que hace que este mismo
    // llamado sirva para registro: si el correo no existe, crea el usuario.
    const { error: e } = await supabase.auth.signInWithOtp({
      email: correo.trim(),
      options: { shouldCreateUser: true },
    });
    setEnviando(false);
    if (e) {
      setError(e.message);
      return;
    }
    router.push('/codigo');
  };

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
          editable={!enviando}
        />

        <PrimaryButton
          label={enviando ? 'Enviando…' : 'Enviar código de verificación'}
          onPress={enviarCodigo}
          disabled={!valido || enviando}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

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

// El prototipo no dibuja un estado de error para estas pantallas; se usa el rol
// tipográfico y el color de marca ya existentes, sin tokens nuevos.
const styles = StyleSheet.create({
  error: {
    ...Typography.meta,
    color: Colors.brick,
    textAlign: 'center',
    marginTop: 12,
  },
});
