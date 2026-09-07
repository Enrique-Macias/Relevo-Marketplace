/** `.round-btn` — botón circular (nav de Detalle, filtro de Categoría). */

import { Pressable, StyleSheet, View } from 'react-native';

import { Colors, Radii } from '@/constants/theme';

type RoundIconButtonProps = {
  children: React.ReactNode;
  onPress?: () => void;
  variant?: 'overlay' | 'bordered';
};

export function RoundIconButton({ children, onPress, variant = 'overlay' }: RoundIconButtonProps) {
  const style = [styles.btn, variant === 'bordered' ? styles.bordered : styles.overlay];
  if (!onPress) return <View style={style}>{children}</View>;
  return (
    <Pressable style={style} onPress={onPress} accessibilityRole="button" hitSlop={4}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // .round-btn{width:36px; height:36px; border-radius:50%;}
  btn: {
    width: 36,
    height: 36,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  // Override inline del HTML en Categoría: background:var(--card); border:1px solid var(--line);
  bordered: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
  },
});
