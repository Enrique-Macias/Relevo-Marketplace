/** Selector de campus — hoja del Feed para cambiar de contexto rápido. */

import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconLocationCrosshair } from '@/components/icons';
import { ListRow, SearchField } from '@/components/ListRow';
import { SheetScreen } from '@/components/SheetScreen';
import { CAMPUS } from '@/constants/mock/campus';
import { Colors, Typography } from '@/constants/theme';
import { useExplorarState } from '@/lib/explorar-state';

export default function SelectorCampusScreen() {
  const [busqueda, setBusqueda] = useState('');
  const { campusSeleccionado, setCampusSeleccionado } = useExplorarState();

  const q = busqueda.trim().toLowerCase();
  const filtrado = q
    ? CAMPUS.filter((c) => c.nombre.toLowerCase().includes(q) || c.ciudad.toLowerCase().includes(q))
    : CAMPUS;

  return (
    <SheetScreen title="Elige tu campus">
      <View style={{ marginBottom: 4 }}>
        <SearchField placeholder="Busca tu universidad o campus" value={busqueda} onChangeText={setBusqueda} />
      </View>

      {/* Geolocalización real: backlog menor, ver CLAUDE.md */}
      <Pressable style={styles.locRow} accessibilityRole="button">
        <IconLocationCrosshair size={16} color={Colors.brick} />
        <Text style={styles.locText}>Detectar campus más cercano</Text>
      </Pressable>

      <Text style={styles.sectionLabel}>Campus en Monterrey</Text>
      {filtrado.map((campus, i) => (
        <ListRow
          key={campus.id}
          name={campus.nombre}
          sub={campus.ciudad}
          selected={campus.id === campusSeleccionado.id}
          last={i === filtrado.length - 1}
          onPress={() => {
            setCampusSeleccionado(campus);
            router.back();
          }}
        />
      ))}
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  // .current-loc-row{display:flex; align-items:center; gap:10px; padding:13px 0; color:var(--brick); font-weight:600; font-size:13.5px;}
  locRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
  },
  locText: {
    ...Typography.emphasis,
    color: Colors.brick,
  },
  // .list-section-label{font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; padding:16px 0 4px;}
  sectionLabel: {
    ...Typography.caption,
    color: Colors.inkSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.44,
    paddingTop: 16,
    paddingBottom: 4,
  },
});
