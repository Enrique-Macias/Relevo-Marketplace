/**
 * `.rate-stars` del frame "Calificar" — cinco estrellas de 30px con gap 9.
 *
 * El frame las pinta estáticas (4 llenas, 1 vacía) porque un mockup no puede
 * mostrar el gesto; aquí son tocables. Cada estrella es su propio `Pressable`
 * con `hitSlop`: a 30px con 9 de separación, el blanco entre una y otra es más
 * angosto que la yema de un dedo.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { IconStar } from '@/components/icons';
import { Colors } from '@/constants/theme';

const ESTRELLAS = [1, 2, 3, 4, 5];

export function StarRating({
  valor,
  onChange,
  disabled,
}: {
  /** 0 = sin calificar todavía, que es como nace la pantalla. */
  valor: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {ESTRELLAS.map((n) => (
        <Pressable
          key={n}
          onPress={disabled ? undefined : () => onChange(n)}
          disabled={disabled}
          hitSlop={6}
          accessibilityRole="radio"
          accessibilityState={{ selected: n <= valor, disabled }}
          accessibilityLabel={`${n} ${n === 1 ? 'estrella' : 'estrellas'}`}
        >
          <IconStar size={30} color={Colors.gold} filled={n <= valor} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // .rate-stars{display:flex; gap:9px; margin:20px 0 24px;}
  row: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 20,
    marginBottom: 24,
  },
});
