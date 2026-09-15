/**
 * `.otp-row` — las N cajas del código de 6 dígitos.
 *
 * Nació dentro de "Código de verificación" (RF-01) y se extrajo al construir
 * "Código de recuperación" (RF-04), que dibuja exactamente la misma fila.
 *
 * Es PURAMENTE presentacional a propósito: no sabe de `verifyOtp`, ni de
 * `signInWithOtp`, ni de si el código es de alta o de recuperación. Esa lógica se
 * queda en cada pantalla — lo único compartido es el mecanismo de captura.
 */

import { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, Radii, Typography } from '@/constants/theme';

/** `otp_length = 6` en supabase/config.toml, y 6 cajas en el frame. */
export const OTP_LENGTH = 6;

export function OtpInput({
  value,
  onChangeText,
  length = OTP_LENGTH,
  autoFocus = true,
}: {
  value: string;
  onChangeText: (v: string) => void;
  length?: number;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<TextInput>(null);

  return (
    <>
      {/*
        El prototipo dibuja 6 cajas estáticas. Aquí son 6 cajas + un TextInput
        invisible que recibe el teclado: tocar cualquier caja lo enfoca.
      */}
      <Pressable style={styles.otpRow} onPress={() => inputRef.current?.focus()}>
        {Array.from({ length }).map((_, i) => {
          const char = value[i];
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
        value={value}
        // Saneamiento del input, no regla de negocio: el frame son cajas de un
        // dígito, así que cualquier otra cosa no tendría dónde pintarse.
        onChangeText={(t) => onChangeText(t.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        maxLength={length}
        autoFocus={autoFocus}
      />
    </>
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
});
