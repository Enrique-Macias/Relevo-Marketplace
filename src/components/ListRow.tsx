/** `.form-header`, `.search-field`, `.list-row` y `.radio-circle` — el sistema de los dos selectores. */

import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';

import { IconChevronLeft, IconClose, IconSearch } from '@/components/icons';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';

type FormHeaderProps = {
  title: string;
  /**
   * Glifo de salida. Los dos selectores y "Editar publicación" usan el chevron
   * (`'back'`, el default); "Publicar" usa la X, porque cerrar un formulario
   * nuevo no es "volver a la pantalla anterior en una jerarquía" sino
   * abandonarlo — es la distinción que hace el prototipo.
   */
  leading?: 'back' | 'close';
  onLeadingPress?: () => void;
  /**
   * Acción de la derecha ("Guardar" en `--brick`). Sin ella se pinta el spacer
   * de 16px del prototipo, que es lo que centra el título.
   */
  trailing?: { label: string; onPress: () => void; disabled?: boolean };
};

/**
 * `.form-header`. En el HTML es hermano de `.screen`, no hijo — o sea que NO
 * scrollea con la lista. Se pasa por la prop `header` de `Screen`.
 */
export function FormHeader({
  title,
  leading = 'back',
  onLeadingPress,
  trailing,
}: FormHeaderProps) {
  return (
    <View style={styles.formHeader}>
      <Pressable
        onPress={onLeadingPress ?? (() => router.back())}
        accessibilityRole="button"
        hitSlop={12}
      >
        {leading === 'close' ? (
          <IconClose size={18} color={Colors.ink} />
        ) : (
          <IconChevronLeft size={16} color={Colors.ink} />
        )}
      </Pressable>
      <Text style={styles.formTitle}>{title}</Text>
      {trailing ? (
        <Pressable
          onPress={trailing.disabled ? undefined : trailing.onPress}
          disabled={trailing.disabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: trailing.disabled }}
          hitSlop={12}
        >
          <Text style={[styles.formAction, trailing.disabled && styles.formActionDisabled]}>
            {trailing.label}
          </Text>
        </Pressable>
      ) : (
        // El prototipo cierra con un span de 16px que balancea el chevron y centra el título.
        <View style={styles.headerSpacer} />
      )}
    </View>
  );
}

export function SearchField({
  placeholder,
  value,
  onChangeText,
  onSubmitEditing,
  containerStyle,
}: {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  onSubmitEditing?: () => void;
  /**
   * `.search-field` no tiene ancho propio en el CSS — hereda el del bloque
   * que lo contiene. Los usos a pantalla completa (Selector de universidad,
   * Selector de campus, Categoría) viven solos dentro de un contenedor en
   * columna, que por default ya estira sus hijos al ancho completo. Pero en
   * Feed/Búsqueda el campo va en una FILA junto al botón de filtro — sin
   * `flex:1` explícito ahí, un `TextInput` sin ancho definido se comprime al
   * tamaño de su contenido (casi cero), y el campo queda invisible e
   * intocable. De ahí este prop: quien lo use en una fila debe pasar
   * `{flex:1}`.
   */
  containerStyle?: ViewStyle;
}) {
  return (
    <View style={[styles.searchField, containerStyle]}>
      <IconSearch size={15} />
      <TextInput
        style={styles.searchInput}
        placeholder={placeholder}
        placeholderTextColor={Colors.placeholder}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={onSubmitEditing ? 'search' : undefined}
        autoCorrect={false}
      />
    </View>
  );
}

export function ListRow({
  name,
  sub,
  selected,
  last,
  onPress,
}: {
  name: string;
  sub: string;
  selected: boolean;
  last: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.listRow, last && styles.listRowLast]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <View>
        <Text style={styles.listRowName}>{name}</Text>
        <Text style={styles.listRowSub}>{sub}</Text>
      </View>
      <RadioCircle selected={selected} />
    </Pressable>
  );
}

export function RadioCircle({ selected }: { selected: boolean }) {
  return (
    <View style={[styles.radio, selected && styles.radioSelected]}>
      {/* .radio-circle.selected::after{inset:3px; border-radius:50%; background:var(--brick);} */}
      {selected ? <View style={styles.radioDot} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // .form-header{padding:16px 20px; border-bottom:1px solid var(--line);}
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: ScreenPadding,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  formTitle: {
    ...Typography.sectionTitle,
    color: Colors.ink,
  },
  headerSpacer: {
    width: 16,
  },
  // El `<span style="font-size:13px; font-weight:600; color:var(--brick)">Guardar</span>
  // de los frames de Publicar / Editar publicación. 13px/600 no coincide con
  // ningún rol de `Typography` existente (`label` es 12.5/600, `emphasis`
  // 13.5/600), así que se declara aquí en vez de forzar el parecido.
  formAction: {
    fontFamily: Typography.label.fontFamily,
    fontSize: 13,
    color: Colors.brick,
  },
  formActionDisabled: {
    opacity: 0.45,
  },
  // .search-field{display:flex; align-items:center; gap:8px; background:var(--card);
  //   border:1px solid var(--line); border-radius:14px; padding:11px 14px;}
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.lg,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  // .search-field input{border:none; background:transparent; font-size:14px;}
  searchInput: {
    flex: 1,
    ...Typography.input,
    color: Colors.ink,
    padding: 0, // RN mete padding propio en TextInput; el CSS no tiene ninguno aquí
  },
  // .list-row{padding:14px 0; border-bottom:1px solid var(--line);}
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  // .list-row:last-child{border-bottom:none;}
  listRowLast: {
    borderBottomWidth: 0,
  },
  listRowName: {
    ...Typography.emphasis,
    color: Colors.ink,
  },
  // .list-row-sub{font-size:11.5px; margin-top:2px;}
  listRowSub: {
    ...Typography.rowSub,
    color: Colors.inkSoft,
    marginTop: 2,
  },
  // .radio-circle{width:18px; height:18px; border-radius:50%; border:1.5px solid var(--line);}
  radio: {
    width: 18,
    height: 18,
    borderRadius: Radii.full,
    borderWidth: 1.5,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: Colors.brick,
  },
  // .radio-circle.selected::after{inset:3px}. En CSS `inset` de un absoluto se mide
  // contra el PADDING box del contenedor, no el border box: 18 - 2*1.5 = 15 de caja
  // interior, menos 3 por lado → 9. (Con 12 el punto llena el círculo y se pierde el aro.)
  radioDot: {
    width: 9,
    height: 9,
    borderRadius: Radii.full,
    backgroundColor: Colors.brick,
  },
});
