/** `.chip` — chip de orden individual (fila horizontal en Categoría). */

import { Pressable, StyleSheet, Text } from 'react-native';

import { Colors, Radii, Typography } from '@/constants/theme';

type ChipProps = {
  label: string;
  active: boolean;
  onPress: () => void;
};

export function Chip({ label, active, onPress }: ChipProps) {
  return (
    <Pressable
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.text, active && styles.textActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // .chip{padding:8px 15px; border-radius:20px; border:1px solid var(--line); background:var(--card);}
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.card,
  },
  text: {
    ...Typography.bodyStrong,
    color: Colors.inkSoft,
  },
  // .chip.active{background:var(--ink); color:var(--paper); border-color:var(--ink);}
  chipActive: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  textActive: {
    color: Colors.paper,
  },
});
