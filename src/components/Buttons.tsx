/** `.primary-btn`, `.ghost-btn` y `.danger-btn`. */

import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { Colors, Radii, Typography } from '@/constants/theme';

export function PrimaryButton({
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
        styles.primary,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
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
