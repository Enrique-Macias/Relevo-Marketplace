/** `.section-head` + `.section-title` + `.section-link`. */

import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { IconArrowRight } from '@/components/icons';
import { Colors, ScreenPadding, Typography } from '@/constants/theme';

type SectionHeadProps = {
  title: string;
  linkLabel?: string;
  onPressLink?: () => void;
  style?: ViewStyle;
};

export function SectionHead({ title, linkLabel, onPressLink, style }: SectionHeadProps) {
  return (
    <View style={[styles.head, style]}>
      <Text style={styles.title}>{title}</Text>
      {linkLabel ? (
        <Pressable style={styles.link} onPress={onPressLink} hitSlop={8} accessibilityRole="button">
          <Text style={styles.linkText}>{linkLabel}</Text>
          <IconArrowRight size={11} color={Colors.brick} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // .section-head{display:flex; align-items:baseline; justify-content:space-between; padding:22px 20px 12px;}
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingTop: 22,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 12,
  },
  title: {
    ...Typography.sectionTitle,
    color: Colors.ink,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  linkText: {
    ...Typography.label,
    color: Colors.brick,
  },
});
