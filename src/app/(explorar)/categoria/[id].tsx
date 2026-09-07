/** Categoría (+ sin resultados) — publicaciones de una categoría, con búsqueda y orden. */

import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/Buttons';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { IconFilterSliders, IconSearch } from '@/components/icons';
import { SearchField } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { ProductCard } from '@/components/ProductCard';
import { RoundIconButton } from '@/components/RoundIconButton';
import { Screen } from '@/components/Screen';
import { getCategoria } from '@/constants/mock/categorias';
import { getListingsByCategoria } from '@/constants/mock/listings';
import { Colors, ScreenPadding, Typography } from '@/constants/theme';
import { useExplorarState } from '@/lib/explorar-state';
import { chunkRows } from '@/lib/grid';

const ORDEN_CHIPS = [
  { value: 'recientes', label: 'Recientes' },
  { value: 'precio_asc', label: 'Precio: menor' },
  { value: 'precio_desc', label: 'Precio: mayor' },
  { value: 'mejor_calificados', label: 'Mejor calificados' },
] as const;

export default function CategoriaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const categoria = getCategoria(id);
  const [query, setQuery] = useState('');
  const { filtros, setFiltros, campusSeleccionado, favoritos, toggleFavorito } = useExplorarState();

  const resultados = useMemo(() => {
    const q2 = query.trim().toLowerCase();
    const min = filtros.precioMin ? Number(filtros.precioMin) : undefined;
    const max = filtros.precioMax ? Number(filtros.precioMax) : undefined;

    const filtrados = getListingsByCategoria(id).filter((l) => {
      if (q2 && !l.titulo.toLowerCase().includes(q2)) return false;
      if (filtros.condicion && l.condicion !== filtros.condicion) return false;
      if (min !== undefined && !Number.isNaN(min) && l.precio < min) return false;
      if (max !== undefined && !Number.isNaN(max) && l.precio > max) return false;
      return true;
    });

    return [...filtrados].sort((a, b) => {
      switch (filtros.orden) {
        case 'precio_asc':
          return a.precio - b.precio;
        case 'precio_desc':
          return b.precio - a.precio;
        case 'mejor_calificados':
          return b.vendedor.ventas - a.vendedor.ventas;
        case 'recientes':
        default:
          return b.createdAt.getTime() - a.createdAt.getTime();
      }
    });
  }, [id, query, filtros]);

  return (
    <Screen
      header={
        <PageHeader
          title={categoria?.nombre ?? id}
          trailing={
            <RoundIconButton variant="bordered" onPress={() => router.push('/filtros')}>
              <IconFilterSliders size={15} color={Colors.ink} />
            </RoundIconButton>
          }
        />
      }
    >
      <View style={styles.searchRow}>
        <SearchField
          placeholder={`Busca dentro de ${categoria?.nombre ?? ''}…`}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      <Text style={styles.resultsCount}>
        {resultados.length} {resultados.length === 1 ? 'publicación' : 'publicaciones'} en{' '}
        {campusSeleccionado.nombre}
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chips}
      >
        {ORDEN_CHIPS.map((chip) => (
          <Chip
            key={chip.value}
            label={chip.label}
            active={filtros.orden === chip.value}
            onPress={() => setFiltros({ orden: chip.value })}
          />
        ))}
      </ScrollView>

      {resultados.length === 0 ? (
        <EmptyState
          icon={<IconSearch size={30} color={Colors.inkSoft} />}
          title={
            query.trim() !== ''
              ? `No encontramos "${query}" en ${categoria?.nombre ?? ''}`
              : `No encontramos publicaciones en ${categoria?.nombre ?? ''}`
          }
          sub="Nadie ha publicado eso en esta categoría todavía. Prueba buscando en todo el catálogo."
        >
          <PrimaryButton
            label="Buscar en todo Relevo"
            onPress={() => router.push({ pathname: '/buscar', params: { q: query } })}
          />
        </EmptyState>
      ) : (
        <View style={styles.grid}>
          {chunkRows(resultados, 2).map((row, i) => (
            <View key={i} style={styles.gridRow}>
              {row.map((listing) => (
                <ProductCard
                  key={listing.id}
                  listing={listing}
                  favorito={favoritos.has(listing.id)}
                  onToggleFavorito={() => toggleFavorito(listing.id)}
                  onPress={() => router.push(`/detalle/${listing.id}`)}
                />
              ))}
              {row.length < 2 ? <View style={styles.padCell} /> : null}
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    marginTop: 14,
    marginHorizontal: ScreenPadding,
  },
  resultsCount: {
    ...Typography.meta,
    color: Colors.inkSoft,
    paddingTop: 12,
    paddingHorizontal: ScreenPadding,
  },
  // Sin `flexGrow:0` aquí, el ScrollView horizontal hereda la altura sobrante
  // del `flexGrow:1` de `Screen` cuando el grid de abajo es corto (pocas
  // publicaciones) — y sin `alignItems:'flex-start'` en su content container,
  // el `stretch` (default de un flex-row) estira cada `Chip` a esa altura
  // completa, convirtiendo la píldora en un círculo gigante.
  chipsScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  chips: {
    alignItems: 'flex-start',
    gap: 8,
    paddingTop: 14,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 4,
  },
  grid: {
    gap: 12,
    paddingHorizontal: ScreenPadding,
    paddingTop: 12,
    paddingBottom: 90,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 12,
  },
  padCell: {
    flex: 1,
  },
});
