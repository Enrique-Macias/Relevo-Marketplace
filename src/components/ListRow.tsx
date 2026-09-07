/** `.form-header`, `.search-field`, `.list-row` y `.radio-circle` — el sistema de los dos selectores. */

import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { IconChevronLeft, IconSearch } from '@/components/icons';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';

/**
 * `.form-header`. En el HTML es hermano de `.screen`, no hijo — o sea que NO
 * scrollea con la lista. Se pasa por la prop `header` de `Screen`.
 */
export function FormHeader({ title }: { title: string }) {
  return (
    <View style={styles.formHeader}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
        <IconChevronLeft size={16} color={Colors.ink} />
      </Pressable>
      <Text style={styles.formTitle}>{title}</Text>
      {/* El prototipo cierra con un span de 16px que balancea el chevron y centra el título. */}
      <View style={styles.headerSpacer} />
    </View>
  );
}

export function SearchField({
  placeholder,
  value,
  onChangeText,
}: {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
}) {
  return (
    <View style={styles.searchField}>
      <IconSearch size={15} />
      <TextInput
        style={styles.searchInput}
        placeholder={placeholder}
        placeholderTextColor={Colors.placeholder}
        value={value}
        onChangeText={onChangeText}
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
