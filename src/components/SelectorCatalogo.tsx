/**
 * Cuerpo compartido de los dos selectores de catálogo del onboarding.
 *
 * Los frames "Selector de universidad" y "Selector de campus (onboarding)" son
 * la misma pantalla con otro título y otros datos: `.form-header` fijo arriba,
 * `.form-body` con buscador y una lista de `.list-row` con `.radio-circle`.
 * La selección se devuelve a "Completar perfil" por query param.
 */

import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { FormHeader, ListRow, SearchField } from '@/components/ListRow';
import { Screen } from '@/components/Screen';
import { ScreenPadding } from '@/constants/theme';
import type { Catalogo } from '@/constants/mock/catalogos';

type SelectorCatalogoProps = {
  title: string;
  searchPlaceholder: string;
  items: Catalogo[];
  /** El frame dibuja una fila ya seleccionada; se respeta como estado inicial. */
  initialSelectedId: string;
  paramKey: 'universidad' | 'campus';
};

export function SelectorCatalogo({
  title,
  searchPlaceholder,
  items,
  initialSelectedId,
  paramKey,
}: SelectorCatalogoProps) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(initialSelectedId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.nombre.toLowerCase().includes(q) || item.ciudad.toLowerCase().includes(q)
    );
  }, [items, query]);

  const onSelect = (item: Catalogo) => {
    setSelectedId(item.id);
    router.back();
    router.setParams({ [paramKey]: item.nombre });
  };

  return (
    <Screen header={<FormHeader title={title} />}>
      {/* .form-body{padding:18px 20px 100px;} + el `padding-top:16px` del frame */}
      <View style={styles.body}>
        {/* El frame le pone `style="margin-bottom:6px"` al buscador. */}
        <View style={styles.search}>
          <SearchField
            placeholder={searchPlaceholder}
            value={query}
            onChangeText={setQuery}
          />
        </View>

        {filtered.map((item, i) => (
          <ListRow
            key={item.id}
            name={item.nombre}
            sub={item.ciudad}
            selected={item.id === selectedId}
            last={i === filtered.length - 1}
            onPress={() => onSelect(item)}
          />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingTop: 16,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 100,
  },
  search: {
    marginBottom: 6,
  },
});
