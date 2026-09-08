/** Filtros — hoja con categoría, precio, condición y orden. */

import { router } from 'expo-router';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { GhostButton, PrimaryButton } from '@/components/Buttons';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SheetScreen } from '@/components/SheetScreen';
import { Colors, Radii, Typography } from '@/constants/theme';
import { type Condicion, type Orden, useExplorarState } from '@/lib/explorar-state';

const CONDICION_OPTIONS = [
  { value: 'nuevo', label: 'Nuevo' },
  { value: 'como_nuevo', label: 'Como nuevo' },
  { value: 'buen_estado', label: 'Buen estado' },
  { value: 'usado', label: 'Usado' },
];

const ORDEN_OPTIONS = [
  { value: 'recientes', label: 'Recientes' },
  { value: 'precio_asc', label: 'Precio: menor' },
  { value: 'precio_desc', label: 'Precio: mayor' },
];

export default function FiltrosScreen() {
  const { filtros, setFiltros, limpiarFiltros, categorias } = useExplorarState();

  return (
    <SheetScreen
      title="Filtros"
      footer={
        <>
          <GhostButton label="Limpiar todo" onPress={limpiarFiltros} style={styles.flex1} />
          <PrimaryButton
            label="Aplicar filtros"
            onPress={() => router.back()}
            style={styles.applyBtn}
          />
        </>
      }
    >
      {/* `SegmentedControl` trabaja con strings; el id real es bigint, así que
          se serializa en la opción y se parsea de vuelta al elegir. */}
      <SegmentedControl
        label="Categoría"
        options={categorias.map((c) => ({ value: String(c.id), label: c.nombre }))}
        value={filtros.categoriaId === undefined ? undefined : String(filtros.categoriaId)}
        onChange={(v) => setFiltros({ categoriaId: Number(v) })}
      />

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Precio</Text>
        <View style={styles.priceRow}>
          <TextInput
            style={styles.priceInput}
            placeholder="Mínimo"
            placeholderTextColor={Colors.placeholder}
            keyboardType="numeric"
            value={filtros.precioMin ?? ''}
            onChangeText={(t) => setFiltros({ precioMin: t })}
          />
          <TextInput
            style={styles.priceInput}
            placeholder="Máximo"
            placeholderTextColor={Colors.placeholder}
            keyboardType="numeric"
            value={filtros.precioMax ?? ''}
            onChangeText={(t) => setFiltros({ precioMax: t })}
          />
        </View>
      </View>

      <SegmentedControl
        label="Condición"
        options={CONDICION_OPTIONS}
        value={filtros.condicion}
        onChange={(v) => setFiltros({ condicion: v as Condicion })}
      />

      <SegmentedControl
        label="Ordenar por"
        options={ORDEN_OPTIONS}
        value={filtros.orden}
        onChange={(v) => setFiltros({ orden: v as Orden })}
      />
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  flex1: {
    flex: 1,
  },
  applyBtn: {
    flex: 1.4,
    marginTop: 0,
  },
  // .field{width:100%; margin-bottom:16px;}
  field: {
    width: '100%',
    marginBottom: 16,
  },
  fieldLabel: {
    ...Typography.label,
    color: Colors.ink,
    marginBottom: 7,
  },
  // .price-row{display:flex; gap:10px;}
  priceRow: {
    flexDirection: 'row',
    gap: 10,
  },
  // .text-field{background:var(--card); border:1px solid var(--line); border-radius:14px; padding:13px 14px; font-size:14px;}
  priceInput: {
    flex: 1,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.lg,
    paddingVertical: 13,
    paddingHorizontal: 14,
    ...Typography.input,
    color: Colors.ink,
  },
});
