/** `.field` + `.field-label` + `.text-field` / `.select-field`. */

import { useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type FocusEvent,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { IconChevronDown } from '@/components/icons';
import { useScreenScrollViewRef } from '@/components/Screen';
import { Colors, Radii, Typography } from '@/constants/theme';
import { scrollToFocusedInput } from '@/lib/scroll-to-input';

type FieldProps = TextInputProps & {
  label: string;
  containerStyle?: ViewStyle;
};

/**
 * "Scroll to focused input" implementado a mano (ver `src/lib/scroll-to-input.ts`
 * para el porqué del mecanismo exacto). Dos alternativas que se consideraron y
 * se descartaron para este proyecto, por si se revisita más adelante:
 *
 * - `react-native-keyboard-aware-scroll-view`: sin mantenimiento activo, y con
 *   problemas documentados específicamente al usarse dentro de navegación por
 *   stack (Expo Router corre sobre React Navigation) — el mismo tipo de
 *   contenedor que envuelve estas pantallas.
 * - `react-native-keyboard-controller`: la alternativa moderna y sí mantenida,
 *   pero trae código nativo — no funciona en Expo Go, exige un development
 *   build. Hoy toda la app (incluida esta sesión de pruebas) corre en Expo
 *   Go; meter esa dependencia es un cambio de flujo de trabajo del proyecto
 *   entero, no algo a decidir de paso arreglando un campo de formulario.
 *
 * La implementación manual es puro JS: cero dependencias nuevas, funciona en
 * Expo Go tal como está, y es el patrón documentado de RN para esto mismo.
 */
export function Field({ label, containerStyle, style, onFocus, ...inputProps }: FieldProps) {
  const inputRef = useRef<TextInput>(null);
  const scrollViewRef = useScreenScrollViewRef();

  const handleFocus = (e: FocusEvent) => {
    onFocus?.(e);
    // El delay importa: si se mide en el mismo tick del focus, todavía no
    // corrió la compresión del KeyboardAvoidingView (ni terminó de animar el
    // teclado), así que `top` saldría con la posición DE ANTES de que la
    // pantalla se achique — el scroll apuntaría al lugar equivocado.
    setTimeout(() => scrollToFocusedInput(scrollViewRef, inputRef), 100);
  };

  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={inputRef}
        style={[styles.input, style]}
        placeholderTextColor={Colors.placeholder}
        onFocus={handleFocus}
        {...inputProps}
      />
    </View>
  );
}

type PhoneFieldProps = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  /** Letra chica bajo el campo (`.auth-terms`). Publicar la usa, Editar perfil no. */
  hint?: string;
  editable?: boolean;
  containerStyle?: ViewStyle;
};

/**
 * `.phone-field` — el campo de WhatsApp, con la lada fija fuera del input.
 *
 * El `+52` es parte del control y no un placeholder ni texto tecleable: hoy el
 * catálogo es mexicano (la deuda consciente de CLAUDE.md §8 tiene el disparador
 * para el día que deje de serlo), así que no hay nada que elegir, y sacándolo
 * del input se vuelve imposible borrarlo por accidente. Lo que el usuario
 * teclea son los 10 dígitos nacionales; `aE164()` (`src/lib/perfil.ts`) arma el
 * valor que va a la base.
 *
 * No filtra las teclas al escribir: `soloDigitos()` acepta "81 1234 5678" y
 * "81-1234-5678" porque es como la gente dicta un número, y pelearle al usuario
 * a media escritura es peor que limpiar al guardar — el mismo criterio que ya
 * usa `precio` en `listing-form.ts`.
 */
export function PhoneField({
  label,
  value,
  onChangeText,
  hint,
  editable = true,
  containerStyle,
}: PhoneFieldProps) {
  const inputRef = useRef<TextInput>(null);
  const scrollViewRef = useScreenScrollViewRef();

  // Mismo delay y mismo motivo que en `Field` — este campo lo necesita más que
  // ninguno: en Publicar es el último de la pantalla, justo encima del teclado.
  const handleFocus = () => {
    setTimeout(() => scrollToFocusedInput(scrollViewRef, inputRef), 100);
  };

  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.phone, !editable && styles.disabled]}>
        <Text style={styles.phonePrefix}>+52</Text>
        <TextInput
          ref={inputRef}
          style={styles.phoneInput}
          value={value}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          editable={editable}
          placeholder="81 1234 5678"
          placeholderTextColor={Colors.placeholder}
          keyboardType="phone-pad"
          // 16 y no 10: `soloDigitos()` tolera separadores y un +52 pegado al
          // inicio (quien copia su número de WhatsApp lo trae incluido), así que
          // el tope cuenta caracteres tecleados, no dígitos útiles.
          maxLength={16}
        />
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
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
  disabled?: boolean;
};

export function SelectField({
  label,
  value,
  placeholder,
  onPress,
  containerStyle,
  disabled = false,
}: SelectFieldProps) {
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={[styles.select, disabled && styles.disabled]}
        onPress={disabled ? undefined : onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
      >
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
  // .phone-field{display:flex; align-items:center; gap:8px; background:var(--card);
  //   border:1px solid var(--line); border-radius:14px; padding:13px 14px;}
  // Son exactamente los valores de `.text-field`; lo único propio es el reparto
  // en dos partes.
  phone: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.lg,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  // .phone-prefix{font-size:14px; color:var(--ink-soft);}
  phonePrefix: {
    ...Typography.input,
    color: Colors.inkSoft,
  },
  // .phone-field .text-field{flex:1; background:none; border:none; padding:0;}
  // Se despoja de la caja para no dibujar un borde dentro de otro.
  phoneInput: {
    flex: 1,
    padding: 0,
    ...Typography.input,
    color: Colors.ink,
  },
  // `.auth-terms` con los dos overrides inline del frame: sin su max-width de
  // 250px (existe para una columna centrada y aquí partiría el texto a media
  // pantalla) y pegada al campo en vez de los 18px que separan bloques.
  hint: {
    ...Typography.terms,
    color: Colors.placeholder,
    marginTop: 7,
  },
  // `.select-field.disabled{ opacity:0.45 }` — misma regla compartida del
  // prototipo que usa `.primary-btn.disabled`.
  disabled: {
    opacity: 0.45,
  },
});
