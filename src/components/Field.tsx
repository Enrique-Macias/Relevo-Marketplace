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
import { type Pais } from '@/lib/paises';
import { scrollToFocusedInput } from '@/lib/scroll-to-input';

type FieldProps = TextInputProps & {
  label: string;
  containerStyle?: ViewStyle;
  /**
   * `.field-error` bajo el campo, y el borde en `--brick` (`.text-field.is-invalid`).
   * Copy PERSISTENTE: el texto tiene que existir antes en `relevo-app.html`
   * (§0 regla 4). Hoy lo usa el nombre del perfil (`COPY_NOMBRE_INVALIDO`).
   */
  error?: string | null;
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
export function Field({
  label,
  containerStyle,
  style,
  onFocus,
  error,
  ...inputProps
}: FieldProps) {
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
        style={[styles.input, error ? styles.inputInvalid : null, style]}
        placeholderTextColor={Colors.placeholder}
        onFocus={handleFocus}
        {...inputProps}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

type PhoneFieldProps = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  /** El país elegido: su ISO y su lada se pintan en `.phone-country`. */
  pais: Pais;
  /** Abre el "Selector de país" (`PaisBottomSheet`). */
  onPaisPress: () => void;
  /** Letra chica bajo el campo (`.auth-terms`). Publicar la usa, Editar perfil no. */
  hint?: string;
  /**
   * `.field-error` + borde `--brick` (`.phone-field.is-invalid`): la variante
   * "número no válido" del frame. Copy persistente: `copyTelefonoInvalido()`.
   */
  error?: string | null;
  editable?: boolean;
  containerStyle?: ViewStyle;
};

/**
 * `.phone-field` — el campo de WhatsApp, con el país como BOTÓN fuera del input.
 *
 * Hasta 20260927000470 la lada era un `+52` inerte; ahora `.phone-country` abre
 * el selector de país (México por default). Sigue fuera del input a propósito:
 * no se puede borrar por accidente, y lo que el usuario teclea es solo el número
 * nacional — `aE164()` (`src/lib/validacion-perfil.ts`) arma el valor que va a
 * la base.
 *
 * SIN bandera emoji: el ISO en texto ("MX +52"), porque el emoji de bandera no
 * se renderiza de forma confiable en Android (CLAUDE.md §3, bloque del
 * teléfono).
 *
 * No filtra las teclas al escribir: libphonenumber acepta "81 1234 5678",
 * "81-1234-5678" o "(202) 555-0123", y pelearle al usuario a media escritura es
 * peor que limpiar al guardar — el mismo criterio que ya usa `precio` en
 * `listing-form.ts`.
 */
export function PhoneField({
  label,
  value,
  onChangeText,
  pais,
  onPaisPress,
  hint,
  error,
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
      <View style={[styles.phone, error ? styles.inputInvalid : null, !editable && styles.disabled]}>
        {/* .phone-country: ISO en --ink 600, lada y chevron en --ink-soft, y el
            separador --line a la derecha. */}
        <Pressable
          style={styles.phoneCountry}
          onPress={onPaisPress}
          disabled={!editable}
          accessibilityRole="button"
          accessibilityLabel={`País: ${pais.nombre}, ${pais.lada}. Cambiar país`}
          hitSlop={8}
        >
          <Text style={styles.phoneIso}>{pais.iso}</Text>
          <Text style={styles.phonePrefix}>{pais.lada}</Text>
          <IconChevronDown size={12} color={Colors.inkSoft} />
        </Pressable>
        <TextInput
          ref={inputRef}
          style={styles.phoneInput}
          value={value}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          editable={editable}
          // El ejemplo del frame es de México; para otro país no se inventa uno
          // (sería copy sin frame), así que el campo queda sin placeholder.
          placeholder={pais.iso === 'MX' ? '81 1234 5678' : undefined}
          placeholderTextColor={Colors.placeholder}
          keyboardType="phone-pad"
          // Cuenta caracteres tecleados, no dígitos útiles: separadores,
          // paréntesis y un número internacional pegado ("+44 7911 123456") caben.
          maxLength={20}
        />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
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

type FixedFieldProps = {
  label: string;
  /** Sin valor, se muestra el placeholder en `--placeholder`. */
  value?: string;
  placeholder: string;
  containerStyle?: ViewStyle;
};

/**
 * Un valor que se MUESTRA y no se elige: `.select-field.disabled` SIN chevron
 * (frames "Completar perfil" y "Editar perfil", campo Universidad). Hoy es la
 * universidad, que la asigna el servidor desde el dominio del correo
 * (20260924000466).
 *
 * No es un `SelectField` con `disabled`, aunque se vea parecido: aquél dice
 * "todavía no puedes elegir" y conserva el chevron y el rol de botón. Éste no
 * abre nada nunca, así que es un `View`, sin chevron y sin
 * `accessibilityRole="button"` (el mismo criterio del tile de espera de
 * `PhotoRow`: si no pasa nada, no se anuncia como botón).
 *
 * "Zona de entrega" de Publicar NO usa este componente: su frame sí conserva el
 * chevron.
 */
export function FixedField({ label, value, placeholder, containerStyle }: FixedFieldProps) {
  return (
    <View style={[styles.field, containerStyle]}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.select, styles.disabled]}>
        <Text style={value ? styles.selectValue : styles.selectPlaceholder}>
          {value ?? placeholder}
        </Text>
      </View>
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
  // .text-field.is-invalid{border-color:var(--brick);}
  inputInvalid: {
    borderColor: Colors.brick,
  },
  // .field-error{font-size:11px; line-height:1.5; color:var(--brick); margin-top:6px;}
  error: {
    ...Typography.fieldError,
    color: Colors.brick,
    marginTop: 6,
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
  // .phone-field{display:flex; align-items:center; gap:10px; background:var(--card);
  //   border:1px solid var(--line); border-radius:14px; padding:13px 14px;}
  // Son exactamente los valores de `.text-field`; lo único propio es el reparto
  // en dos partes.
  phone: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.lg,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  // .phone-country{display:flex; align-items:center; gap:5px; padding-right:10px;
  //   border-right:1px solid var(--line);}
  phoneCountry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingRight: 10,
    borderRightWidth: 1,
    borderRightColor: Colors.line,
  },
  // .phone-country b{font-weight:600; color:var(--ink);} — `emphasis` es 13.5,
  // así que se toma `input` (14) con el peso de `label`: mismo tamaño que la
  // lada de al lado, solo cambia el peso.
  phoneIso: {
    ...Typography.input,
    fontFamily: Typography.label.fontFamily,
    color: Colors.ink,
  },
  // .phone-country{font-size:14px; color:var(--ink-soft);}
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
