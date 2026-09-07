/**
 * `.page-heading-row` + `.page-heading` — header de Categoría/"Ver todas".
 * Distinto de `FormHeader` (`.form-header`, con borde inferior y spacer
 * simétrico): este no lleva borde y su slot derecho es una acción real, no
 * un balanceador vacío.
 */

import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconChevronLeft } from '@/components/icons';
import { Colors, ScreenPadding, Typography } from '@/constants/theme';

type PageHeaderProps = {
  title: string;
  trailing?: React.ReactNode;
};

export function PageHeader({ title, trailing }: PageHeaderProps) {
  return (
    <View style={[styles.row, trailing ? styles.spaceBetween : styles.gapOnly]}>
      <View style={styles.leading}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
          <IconChevronLeft size={16} color={Colors.ink} />
        </Pressable>
        <Text style={styles.title}>{title}</Text>
      </View>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  // .page-heading-row{display:flex; align-items:center; gap:12px; padding:16px 20px 4px;}
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 16,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 4,
  },
  gapOnly: {
    gap: 12,
  },
  spaceBetween: {
    justifyContent: 'space-between',
  },
  leading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    ...Typography.pageHeading,
    color: Colors.ink,
  },
});
