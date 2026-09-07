/** Búsqueda — 3 estados: recomendados (sin query/filtros) / resultados / sin resultados. */

import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActiveFilterChip } from '@/components/ActiveFilterChip';
import { EmptyState } from '@/components/EmptyState';
import { GhostButton } from '@/components/Buttons';
import { IconFilterSliders, IconSearch } from '@/components/icons';
import { SearchField } from '@/components/ListRow';
import { ProductCard } from '@/components/ProductCard';
import { Screen } from '@/components/Screen';
import { SectionHead } from '@/components/SectionHead';
import { getCategoria } from '@/constants/mock/categorias';
import { LISTINGS } from '@/constants/mock/listings';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';
import { useExplorarState } from '@/lib/explorar-state';
import { chunkRows } from '@/lib/grid';

const CONDICION_LABEL: Record<string, string> = {
  nuevo: 'Nuevo',
  como_nuevo: 'Como nuevo',
  buen_estado: 'Buen estado',
  usado: 'Usado',
};

export default function BuscarScreen() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(q ?? '');
  const { filtros, setFiltros, limpiarFiltros, campusSeleccionado, favoritos, toggleFavorito } =
    useExplorarState();

  const hayFiltrosActivos = !!(filtros.categoriaId || filtros.condicion || filtros.precioMin || filtros.precioMax);
  const modoRecomendados = query.trim() === '' && !hayFiltrosActivos;

  const resultados = useMemo(() => {
    if (modoRecomendados) return LISTINGS.slice(0, 4);

    const q2 = query.trim().toLowerCase();
    const min = filtros.precioMin ? Number(filtros.precioMin) : undefined;
    const max = filtros.precioMax ? Number(filtros.precioMax) : undefined;

    const filtrados = LISTINGS.filter((l) => {
      if (q2 && !l.titulo.toLowerCase().includes(q2)) return false;
      if (filtros.categoriaId && l.categoriaId !== filtros.categoriaId) return false;
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
        // El mock no tiene rating por publicación — se usa `vendedor.ventas`
        // como proxy razonable de "mejor calificados".
        case 'mejor_calificados':
          return b.vendedor.ventas - a.vendedor.ventas;
        case 'recientes':
        default:
          return b.createdAt.getTime() - a.createdAt.getTime();
      }
    });
  }, [modoRecomendados, query, filtros]);

  if (modoRecomendados) {
    return (
      <Screen>
        <View style={styles.searchRow}>
          <SearchField
            placeholder="Busca libros, electrónica, muebles…"
            value={query}
            onChangeText={setQuery}
            containerStyle={styles.searchFieldFlex}
          />
          <Pressable style={styles.filterBtn} onPress={() => router.push('/filtros')} accessibilityRole="button">
            <IconFilterSliders size={16} color="#F3F0EA" />
          </Pressable>
        </View>
        <SectionHead title="Recomendado para ti" />
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
      </Screen>
    );
  }

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filtros.categoriaId) {
    chips.push({
      key: 'cat',
      label: getCategoria(filtros.categoriaId)?.nombre ?? filtros.categoriaId,
      onRemove: () => setFiltros({ categoriaId: undefined }),
    });
  }
  if (filtros.precioMin || filtros.precioMax) {
    const label = filtros.precioMin && filtros.precioMax
      ? `$${filtros.precioMin} - $${filtros.precioMax}`
      : filtros.precioMax
        ? `Bajo $${filtros.precioMax}`
        : `Desde $${filtros.precioMin}`;
    chips.push({
      key: 'precio',
      label,
      onRemove: () => setFiltros({ precioMin: undefined, precioMax: undefined }),
    });
  }
  if (filtros.condicion) {
    chips.push({
      key: 'condicion',
      label: CONDICION_LABEL[filtros.condicion],
      onRemove: () => setFiltros({ condicion: undefined }),
    });
  }
  chips.push({
    key: 'campus',
    label: campusSeleccionado.nombre,
    onRemove: () => router.push('/selector-campus'),
  });

  return (
    <Screen>
      <View style={styles.searchRow}>
        <SearchField
          placeholder="Busca libros, electrónica, muebles…"
          value={query}
          onChangeText={setQuery}
          containerStyle={styles.searchFieldFlex}
        />
        <Pressable style={styles.filterBtn} onPress={() => router.push('/filtros')} accessibilityRole="button">
          <IconFilterSliders size={16} color="#F3F0EA" />
        </Pressable>
      </View>

      <View style={styles.activeChips}>
        {chips.map((chip) => (
          <ActiveFilterChip key={chip.key} label={chip.label} onRemove={chip.onRemove} />
        ))}
      </View>

      <Text style={styles.resultsCount}>
        {query.trim() !== ''
          ? `${resultados.length} ${resultados.length === 1 ? 'resultado' : 'resultados'} para "${query}"`
          : `${resultados.length} ${resultados.length === 1 ? 'resultado' : 'resultados'}`}
      </Text>

      {resultados.length === 0 ? (
        <EmptyState
          icon={<IconSearch size={30} color={Colors.inkSoft} />}
          title={query.trim() !== '' ? `No encontramos "${query}"` : 'No encontramos publicaciones'}
          sub="Intenta con otras palabras o quita algunos filtros para ver más resultados."
          style={{ paddingTop: 50 }}
        >
          <GhostButton
            label="Quitar filtros"
            onPress={() => {
              limpiarFiltros();
              setQuery('');
            }}
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
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    marginHorizontal: ScreenPadding,
  },
  // Sin esto, el TextInput (flex:1 relativo a ESTE contenedor) no tiene de
  // qué ancho tomar el 100% dentro de la fila junto al botón de filtro, y se
  // comprime casi a cero — bug real reportado: campo invisible e intocable.
  searchFieldFlex: {
    flex: 1,
  },
  filterBtn: {
    width: 42,
    height: 42,
    borderRadius: Radii.lg,
    backgroundColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingTop: 14,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 2,
  },
  resultsCount: {
    ...Typography.meta,
    color: Colors.inkSoft,
    paddingTop: 16,
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
