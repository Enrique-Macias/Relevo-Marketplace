/** Categoría (+ sin resultados) — publicaciones de una categoría, con búsqueda y orden. */

import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/Buttons';
import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { IconFilterSliders, IconSearch } from '@/components/icons';
import { SearchField } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { ProductCard } from '@/components/ProductCard';
import { RoundIconButton } from '@/components/RoundIconButton';
import { Screen } from '@/components/Screen';
import { SkeletonGrid } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { Colors, ScreenPadding, Typography } from '@/constants/theme';
import { useDebounce } from '@/lib/use-debounce';
import { alcanceFiltro, etiquetaAlcance, useExplorarState } from '@/lib/explorar-state';
import { chunkRows } from '@/lib/grid';
import { useListings } from '@/lib/listings';
import { useSession } from '@/lib/session';

const ORDEN_CHIPS = [
  { value: 'recientes', label: 'Recientes' },
  { value: 'precio_asc', label: 'Precio: menor' },
  { value: 'precio_desc', label: 'Precio: mayor' },
  { value: 'mejor_calificados', label: 'Mejor calificados' },
] as const;

export default function CategoriaScreen() {
  // El param llega como string desde la ruta; el id real es bigint.
  const { id } = useLocalSearchParams<{ id: string }>();
  const categoriaId = Number(id);
  const [query, setQuery] = useState('');
  const queryDiferida = useDebounce(query);
  const { filtros, setFiltros, alcance, favoritos, toggleFavorito, getCategoria } = useExplorarState();
  const { profile } = useSession();

  const categoria = getCategoria(categoriaId);

  // Misma semántica que tenía el filtrado sobre el mock: la categoría la fija
  // la ruta (no el filtro), y precio/condición/orden salen del contexto.
  const { items, estado, total, cargandoMas, loadMore, reintentar, refrescar } = useListings(
    alcance
      ? {
          alcance: alcanceFiltro(alcance),
          categoriaId,
          q: queryDiferida,
          precioMin: filtros.precioMin ? Number(filtros.precioMin) : undefined,
          precioMax: filtros.precioMax ? Number(filtros.precioMax) : undefined,
          condicion: filtros.condicion,
          orden: filtros.orden,
          withCount: true,
        }
      : null
  );

  const cargando = estado === 'loading' || !alcance;
  const conteo = total ?? items.length;

  const { mostrar } = useToast();
  const [refrescando, setRefrescando] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefrescando(true);
    try {
      await refrescar();
    } catch (e: any) {
      console.warn('[categoria] falló el refresh:', e?.message ?? e);
      mostrar('No se pudo actualizar. Intenta de nuevo.', 'error');
    } finally {
      setRefrescando(false);
    }
  }, [refrescar, mostrar]);

  return (
    <Screen
      onEndReached={loadMore}
      refreshControl={
        <RefreshControl
          refreshing={refrescando}
          onRefresh={onRefresh}
          tintColor={Colors.brick}
          colors={[Colors.brick]}
        />
      }
      header={
        <PageHeader
          title={categoria?.nombre ?? ''}
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
        {conteo} {conteo === 1 ? 'publicación' : 'publicaciones'} en{' '}
        {alcance ? etiquetaAlcance(alcance, profile?.universidad_id ?? null) : ''}
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

      {estado === 'error' ? (
        <ErrorState onRetry={reintentar} />
      ) : cargando ? (
        <SkeletonGrid tarjetas={4} style={styles.skeleton} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<IconSearch size={30} color={Colors.inkSoft} />}
          title={
            queryDiferida.trim() !== ''
              ? `No encontramos "${queryDiferida}" en ${categoria?.nombre ?? ''}`
              : `No encontramos publicaciones en ${categoria?.nombre ?? ''}`
          }
          sub="Nadie ha publicado eso en esta categoría todavía. Prueba buscando en todas las categorías."
        >
          {/* Quita la CATEGORÍA y conserva el alcance. Antes decía "Buscar en
              todo Relevo", que con alcances se leía como "todas las
              universidades" (fase 2B). */}
          <PrimaryButton
            label="Buscar en todas las categorías"
            onPress={() => router.push({ pathname: '/buscar', params: { q: query } })}
          />
        </EmptyState>
      ) : (
        <View style={styles.grid}>
          {chunkRows(items, 2).map((row, i) => (
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
          {cargandoMas ? <SkeletonGrid tarjetas={2} style={styles.skeletonMas} /> : null}
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
  skeleton: {
    paddingTop: 12,
    paddingBottom: 90,
  },
  // Ya va dentro de `grid`, que aporta el padding horizontal y el inferior.
  skeletonMas: {
    paddingHorizontal: 0,
  },
});
