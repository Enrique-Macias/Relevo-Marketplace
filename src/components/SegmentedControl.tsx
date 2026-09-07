/** `.field`+`.field-label` + `.segmented`/`.segment` — grupo de pills de un solo select (Filtros). */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Radii, Typography } from '@/constants/theme';

type SegmentedControlProps = {
  label: string;
  options: { value: string; label: string }[];
  value: string | undefined;
  onChange: (value: string) => void;
};

export function SegmentedControl({ label, options, value, onChange }: SegmentedControlProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.segmented}>
        {options.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              style={[styles.segment, active && styles.segmentActive]}
              onPress={() => onChange(option.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // .field{width:100%; margin-bottom:16px;}
  field: {
    width: '100%',
    marginBottom: 16,
  },
  // .field-label{font-size:12.5px; font-weight:600; margin-bottom:7px;}
  label: {
    ...Typography.label,
    color: Colors.ink,
    marginBottom: 7,
  },
  // .segmented{display:flex; gap:8px; flex-wrap:wrap;}
  segmented: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // .segment{padding:9px 14px; border-radius:20px; border:1px solid var(--line); background:var(--card);}
  segment: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: Radii.full,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.card,
  },
  segmentText: {
    ...Typography.labelMuted,
    color: Colors.inkSoft,
  },
  // .segment.active{background:var(--ink); color:var(--paper); border-color:var(--ink);}
  segmentActive: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  segmentTextActive: {
    color: Colors.paper,
  },
});
