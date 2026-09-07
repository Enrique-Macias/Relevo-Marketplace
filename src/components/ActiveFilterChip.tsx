/** `.active-chip` — chip de filtro activo con X (Búsqueda). */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconClose } from '@/components/icons';
import { Colors, Radii, Typography } from '@/constants/theme';

type ActiveFilterChipProps = {
  label: string;
  onRemove: () => void;
};

export function ActiveFilterChip({ label, onRemove }: ActiveFilterChipProps) {
  return (
    <View style={styles.chip}>
      <Text style={styles.text}>{label}</Text>
      <Pressable onPress={onRemove} hitSlop={8} accessibilityRole="button">
        <IconClose size={12} color={Colors.paper} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // .active-chip{display:flex; align-items:center; gap:6px; padding:7px 8px 7px 13px; border-radius:20px; background:var(--ink);}
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingLeft: 13,
    paddingRight: 8,
    borderRadius: Radii.full,
    backgroundColor: Colors.ink,
  },
  text: {
    ...Typography.activeChip,
    color: Colors.paper,
  },
});
