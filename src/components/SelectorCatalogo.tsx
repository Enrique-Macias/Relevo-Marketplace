/**
 * Cuerpo compartido de los dos selectores de catálogo del onboarding.
 *
 * Los frames "Selector de universidad" y "Selector de campus (onboarding)" son
 * la misma pantalla con otro título y otros datos: `.form-header` fijo arriba,
 * `.form-body` con buscador y una lista de `.list-row` con `.radio-circle`.
 *
 * La selección se devuelve por el borrador del grupo (ver `(onboarding)/_layout.tsx`),
 * no por params de ruta.
 */

import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { FormHeader, ListRow, SearchField } from '@/components/ListRow';
import { Screen } from '@/components/Screen';
import { Colors, ScreenPadding, Typography } from '@/constants/theme';

export type ItemCatalogo = {
  id: number;
  nombre: string;
  /** `.list-row-sub`. Para universidades es la ciudad o "N campus"; para campus, la ciudad. */
  subtitulo: string;
};

type SelectorCatalogoProps = {
  title: string;
  searchPlaceholder: string;
  /** Carga diferida: ambas tablas solo se pueden leer con sesión activa. */
  load: () => Promise<ItemCatalogo[]>;
  selectedId: number | null;
  onSelect: (item: ItemCatalogo) => void;
  emptyText: string;
};

export function SelectorCatalogo({
  title,
  searchPlaceholder,
  load,
  selectedId,
  onSelect,
  emptyText,
}: SelectorCatalogoProps) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ItemCatalogo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    load()
      .then((data) => activo && setItems(data))
      .catch((e) => activo && setError(e.message ?? 'No se pudo cargar el catálogo'));
    return () => {
      activo = false;
    };
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!items) return [];
    if (!q) return items;
    return items.filter(
      (item) =>
        item.nombre.toLowerCase().includes(q) || item.subtitulo.toLowerCase().includes(q)
    );
  }, [items, query]);

  const elegir = (item: ItemCatalogo) => {
    onSelect(item);
    router.back();
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

        {items === null && !error ? (
          <ActivityIndicator style={styles.estado} color={Colors.inkSoft} />
        ) : null}

        {error ? <Text style={styles.estado}>{error}</Text> : null}

        {items !== null && filtered.length === 0 ? (
          <Text style={styles.estado}>{query ? 'Sin resultados' : emptyText}</Text>
        ) : null}

        {filtered.map((item, i) => (
          <ListRow
            key={item.id}
            name={item.nombre}
            sub={item.subtitulo}
            selected={item.id === selectedId}
            last={i === filtered.length - 1}
            onPress={() => elegir(item)}
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
  // El prototipo no dibuja estados de carga/vacío para estos dos frames; es
  // texto mínimo con los tokens existentes, no diseño nuevo.
  estado: {
    ...Typography.meta,
    color: Colors.inkSoft,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
