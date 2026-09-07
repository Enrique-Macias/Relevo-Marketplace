/** `.field` + `.field-label` + `.text-field` / `.select-field`. */

import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { IconChevronDown } from '@/components/icons';
import { Colors, Radii, Typography } from '@/constants/theme';

type FieldProps = TextInputProps & {
  label: string;
  containerStyle?: ViewStyle;
};

export function Field({ label, containerStyle, style, ...inputProps }: FieldProps) {
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, style]}
        placeholderTextColor={Colors.placeholder}
        {...inputProps}
      />
    </View>
  );
}

type SelectFieldProps = {
  label: string;
  /** Texto elegido. Sin valor, se muestra el placeholder en `--placeholder`. */
  value?: string;
  placeholder: string;
  onPress: () => void;
  containerStyle?: ViewStyle;
};

export function SelectField({
  label,
  value,
  placeholder,
  onPress,
  containerStyle,
}: SelectFieldProps) {
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.select} onPress={onPress} accessibilityRole="button">
        <Text style={value ? styles.selectValue : styles.selectPlaceholder}>
          {value ?? placeholder}
        </Text>
        <IconChevronDown size={14} color={Colors.inkSoft} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // .field{width:100%; text-align:left; margin-bottom:16px;}
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
  // .text-field{background:var(--card); border:1px solid var(--line); border-radius:14px; padding:13px 14px; font-size:14px;}
  input: {
    width: '100%',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.lg,
    paddingVertical: 13,
    paddingHorizontal: 14,
    ...Typography.input,
    color: Colors.ink,
  },
  // .select-field{display:flex; align-items:center; justify-content:space-between;
  //   background:var(--card); border:1px solid var(--line); border-radius:14px; padding:13px 14px;}
  select: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.lg,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  selectValue: {
    ...Typography.input,
    color: Colors.ink,
  },
  selectPlaceholder: {
    ...Typography.input,
    color: Colors.placeholder,
  },
});
