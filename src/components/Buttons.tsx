/** `.primary-btn` y `.ghost-btn`. */

import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { Colors, Radii, Typography } from '@/constants/theme';

export function PrimaryButton({
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
      style={({ pressed }) => [styles.primary, pressed && styles.pressed, style]}
      onPress={onPress}
      accessibilityRole="button"
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
});
