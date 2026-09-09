/** `.primary-btn`, `.ghost-btn` y `.danger-btn`. */

import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { BlinkingDots } from '@/components/BlinkingDots';
import { Colors, Radii, Typography } from '@/constants/theme';

/**
 * `busy` y `disabled` son DOS COSAS DISTINTAS y por eso son dos props, no un
 * booleano con dos nombres:
 *
 *  · `disabled` (`.primary-btn.disabled`, opacidad 0.45) dice "todavía no
 *    puedes" — el formulario está incompleto.
 *  · `busy` (`.primary-btn.is-busy`) dice "está pasando". Va a COLOR PLENO a
 *    propósito: bajarlo a 0.45 apagaría justo los puntos que comunican el
 *    avance. Tampoco responde al toque, pero eso lo resuelve el
 *    comportamiento, no la opacidad.
 */
export function PrimaryButton({
  label,
  onPress,
  style,
  disabled = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  style?: ViewStyle;
  disabled?: boolean;
  busy?: boolean;
}) {
  const inerte = disabled || busy;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.primary,
        busy && styles.primaryBusy,
        pressed && !inerte && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
      onPress={inerte ? undefined : onPress}
      disabled={inerte}
      accessibilityRole="button"
      accessibilityState={{ disabled: inerte, busy }}
    >
      {busy ? <BlinkingDots style={styles.busyDots} /> : null}
      <Text style={styles.primaryLabel}>{label}</Text>
    </Pressable>
  );
}

export function GhostButton({
  label,
  onPress,
  style,
}: {
  label: string;
  onPress: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.ghost, pressed && styles.pressed, style]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={styles.ghostLabel}>{label}</Text>
    </Pressable>
  );
}

/**
 * `.danger-btn` — el botón destructivo de `.modal-actions` (Confirmar cerrar
 * sesión / Confirmar eliminar). A diferencia de `PrimaryButton`, no es
 * `width:100%`: vive en una fila junto a `GhostButton`, por eso acepta `flex`
 * en vez de asumir ancho completo.
 */
export function DangerButton({
  label,
  onPress,
  style,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  style?: ViewStyle;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.danger,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <Text style={styles.dangerLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // .primary-btn{width:100%; background:var(--brick); border-radius:14px; padding:15px 0; margin-top:4px;}
  primary: {
    width: '100%',
    backgroundColor: Colors.brick,
    borderRadius: Radii.lg,
    paddingVertical: 15,
    marginTop: 4,
    alignItems: 'center',
  },
  // .primary-btn.is-busy{display:flex; align-items:center; justify-content:center; gap:9px;}
  primaryBusy: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 9,
  },
  // .primary-btn.is-busy .splash-dots{margin-top:0;} — el margen del Splash solo
  // servía bajo el wordmark.
  busyDots: {
    marginTop: 0,
  },
  primaryLabel: {
    ...Typography.buttonPrimary,
    color: Colors.paper,
  },
  // .ghost-btn{background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px 0;}
  ghost: {
    width: '100%',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ghostLabel: {
    ...Typography.emphasis,
    color: Colors.ink,
  },
  // El prototipo no define estado :active — feedback táctil mínimo, no es diseño nuevo.
  pressed: {
    opacity: 0.85,
  },
  // `.primary-btn.disabled, .ghost-btn.disabled, .select-field.disabled,
  //  .text-field.disabled{ opacity:0.45; }` — regla compartida del prototipo.
  disabled: {
    opacity: 0.45,
  },
  // .danger-btn{flex:1.2; background:var(--brick); color:var(--paper); border-radius:14px; padding:13px 0;}
  danger: {
    flex: 1.2,
    backgroundColor: Colors.brick,
    borderRadius: Radii.lg,
    paddingVertical: 13,
    alignItems: 'center',
  },
  dangerLabel: {
    ...Typography.emphasis,
    color: Colors.paper,
  },
});
