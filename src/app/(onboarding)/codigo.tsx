import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthBody, AuthHeadline, AuthLink, AuthLinkStrong, AuthLogo, AuthSub } from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { Screen } from '@/components/Screen';
import { Colors, Radii, Typography } from '@/constants/theme';
import { useRedirectSiPerfilCompleto } from '@/lib/session';
import { supabase } from '@/lib/supabase';

import { usePerfilDraft } from './_layout';

const OTP_LENGTH = 6; // `otp_length = 6` en supabase/config.toml, y 6 cajas en el frame

/** Frame "Código de verificación". */
export default function CodigoScreen() {
  const redirect = useRedirectSiPerfilCompleto();
  const { correo } = usePerfilDraft();
  const [code, setCode] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  if (redirect) return redirect;

  const verificar = async () => {
    setVerificando(true);
    setError(null);
    // `type: 'email'` es el que corresponde a un OTP pedido con signInWithOtp.
    // Si sale bien, la sesión ya existe aquí — antes de fijar contraseña.
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

        {/*
          El prototipo dibuja 6 cajas estáticas. Aquí son 6 cajas + un TextInput
          invisible que recibe el teclado: tocar cualquier caja lo enfoca.
        */}
        <Pressable style={styles.otpRow} onPress={() => inputRef.current?.focus()}>
          {Array.from({ length: OTP_LENGTH }).map((_, i) => {
            const char = code[i];
            return (
              <View key={i} style={[styles.otpBox, char ? styles.otpBoxFilled : null]}>
                {/* Las cajas vacías muestran un guion, como en el frame. */}
                <Text style={styles.otpChar}>{char ?? '–'}</Text>
              </View>
            );
          })}
        </Pressable>
        <TextInput
          ref={inputRef}
          style={styles.hiddenInput}
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, OTP_LENGTH))}
          keyboardType="number-pad"
          maxLength={OTP_LENGTH}
          autoFocus
        />

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
  // .otp-row{display:flex; gap:8px; margin-bottom:22px;}
  otpRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 22,
  },
  // .otp-box{width:42px; height:52px; border-radius:12px; background:var(--card); border:1.5px solid var(--line);}
  otpBox: {
    width: 42,
    height: 52,
    borderRadius: Radii.md,
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // .otp-box.filled{border-color:var(--brick);}
  otpBoxFilled: {
    borderColor: Colors.brick,
  },
  otpChar: {
    ...Typography.otp,
    color: Colors.ink,
  },
  // Fuera de pantalla en vez de opacity:0 — un input con opacidad 0 sigue
  // capturando taps encima de las cajas.
  hiddenInput: {
    position: 'absolute',
    left: -9999,
    width: 1,
    height: 1,
  },
  error: {
    ...Typography.meta,
    color: Colors.brick,
    textAlign: 'center',
    marginTop: 12,
  },
});
