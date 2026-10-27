/**
 * `.legal-check` (PL-016): la casilla "Acepto los Términos de uso y leí el
 * Aviso de privacidad." de "Completar perfil" y "Términos actualizados".
 *
 * Una sola casilla, dos registros: la base guarda la aceptación de los
 * Términos y, aparte, que se PRESENTÓ el Aviso (leerlo no es consentir ningún
 * tratamiento). Eso lo decide `aceptar_terminos()`, no este componente.
 *
 * Toda la fila marca y desmarca; los dos enlaces son hermanos de la casilla,
 * con rol de enlace, y abren la versión exacta que se está aceptando.
 */

import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Colors, Radii, Typography } from '@/constants/theme';

export function LegalCheck({
  checked,
  onToggle,
  onTerminos,
  onAviso,
  disabled = false,
  style,
}: {
  checked: boolean;
  onToggle: () => void;
  onTerminos: () => void;
  onAviso: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const alternar = disabled ? undefined : onToggle;
  return (
    <View style={[styles.row, style]}>
      <Pressable
        onPress={alternar}
        disabled={disabled}
        hitSlop={12}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        accessibilityLabel="Acepto los Términos de uso y leí el Aviso de privacidad"
      >
        {/* .check-box / .check-box.is-checked */}
        <View style={[styles.box, checked ? styles.boxChecked : null]}>
          {checked ? (
            <Svg
              width={12}
              height={12}
              viewBox="0 0 24 24"
              fill="none"
              stroke={Colors.card}
              strokeWidth={3.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <Path d="M5 12.5l4.5 4.5L19 7.5" />
            </Svg>
          ) : null}
        </View>
      </Pressable>
      <Text
        style={styles.text}
        onPress={alternar}
        suppressHighlighting
      >
        Acepto los{' '}
        <Text style={styles.link} onPress={onTerminos} accessibilityRole="link" suppressHighlighting>
          Términos de uso
        </Text>{' '}
        y leí el{' '}
        <Text style={styles.link} onPress={onAviso} accessibilityRole="link" suppressHighlighting>
          Aviso de privacidad
        </Text>
        .
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // .legal-check{width:100%; display:flex; align-items:flex-start; gap:11px; margin-top:22px;}
  row: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 11,
    marginTop: 22,
  },
  // .check-box{width:20px; height:20px; border-radius:8px; border:1.5px solid var(--ink-muted); background:var(--card); margin-top:-1px;}
  box: {
    width: 20,
    height: 20,
    borderRadius: Radii.sm,
    borderWidth: 1.5,
    borderColor: Colors.placeholder, // --ink-muted
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -1,
  },
  // .check-box.is-checked{background:var(--brick); border-color:var(--brick);}
  boxChecked: {
    backgroundColor: Colors.brick,
    borderColor: Colors.brick,
  },
  // .legal-check-text{font-size:12.5px; line-height:1.5; color:var(--ink-soft);}
  text: {
    ...Typography.legalCheck,
    color: Colors.inkSoft,
    flex: 1,
    textAlign: 'left',
  },
  // .legal-link{color:var(--brick); font-weight:600; text-decoration:underline;}
  link: {
    fontFamily: Typography.label.fontFamily,
    color: Colors.brick,
    textDecorationLine: 'underline',
  },
});
