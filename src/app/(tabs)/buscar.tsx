/** Búsqueda — 3 estados: recomendados (sin query/filtros) / resultados / sin resultados. */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { InteractionManager, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ActiveFilterChip } from '@/components/ActiveFilterChip';
import { GhostButton } from '@/components/Buttons';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { IconCampusFlag, IconFilterSliders, IconSearch } from '@/components/icons';
import { SearchField, type SearchFieldHandle } from '@/components/ListRow';
import { ProductCard } from '@/components/ProductCard';
import { Screen } from '@/components/Screen';
import { SectionHead } from '@/components/SectionHead';
import { SkeletonGrid } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';
import { alcanceFiltro, etiquetaAlcance, lugarAlcance, useExplorarState } from '@/lib/explorar-state';
import { chunkRows } from '@/lib/grid';
import { useListings } from '@/lib/listings';
import { useSession } from '@/lib/session';
import { useDebounce } from '@/lib/use-debounce';

const CONDICION_LABEL: Record<string, string> = {
  nuevo: 'Nuevo',
  como_nuevo: 'Como nuevo',
  buen_estado: 'Buen estado',
  usado: 'Usado',
};

export default function BuscarScreen() {
  const { q, autoFocus } = useLocalSearchParams<{ q?: string; autoFocus?: string }>();
  const [query, setQuery] = useState(q ?? '');
  const queryDiferida = useDebounce(query);

  // Búsqueda es la raíz del tab "Buscar" y NO se desmonta al cambiar de tab
  // (`expo-router/unstable-native-tabs` monta las 4 pantallas de una vez —
  // ver `.claude/rules/explorar.md`), así que `autoFocus` no puede disparar
  // el foco en cada `useFocusEffect`: se guarda el ÚLTIMO VALOR consumido
  // (no un booleano) para poder distinguir un tap nuevo del buscador del
  // Feed (valor distinto) de un simple regreso de tab con el mismo param ya
  // visto (mismo valor → no dispara).
  const searchFieldRef = useRef<SearchFieldHandle>(null);
  const autoFocusConsumido = useRef<string | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      if (!autoFocus || autoFocus === autoFocusConsumido.current) return;
      autoFocusConsumido.current = autoFocus;
      // El foco va DESPUÉS de que termine la transición de navegación, no
      // durante — `runAfterInteractions` evita que el teclado tire encima
      // de la animación de cambio de tab.
      const task = InteractionManager.runAfterInteractions(() => {
        searchFieldRef.current?.focus();
      });
      return () => task.cancel();
    }, [autoFocus])
  );
  const {
    filtros,
    setFiltros,
    limpiarFiltros,
    alcance,
    favoritos,
    toggleFavorito,
    getCategoria,
  } = useExplorarState();

  const hayFiltrosActivos = !!(filtros.categoriaId || filtros.condicion || filtros.precioMin || filtros.precioMax);
  const modoRecomendados = queryDiferida.trim() === '' && !hayFiltrosActivos;

  const { profile } = useSession();

  // Las dos ramas siguen el alcance elegido en el selector del Feed (fase 2B).
  const { items, estado, total, cargandoMas, loadMore, reintentar, refrescar } = useListings(
    alcance
      ? modoRecomendados
        ? { alcance: alcanceFiltro(alcance), orden: 'recientes' as const, limit: 4 }
        : {
            alcance: alcanceFiltro(alcance),
            q: queryDiferida,
            categoriaId: filtros.categoriaId,
            precioMin: filtros.precioMin ? Number(filtros.precioMin) : undefined,
            precioMax: filtros.precioMax ? Number(filtros.precioMax) : undefined,
            condicion: filtros.condicion,
            orden: filtros.orden,
            withCount: true,
          }
      : null
  );

  const cargando = estado === 'loading' || !alcance;

  const { mostrar } = useToast();
  const [refrescando, setRefrescando] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefrescando(true);
    try {
      await refrescar();
    } catch (e: any) {
      console.warn('[buscar] falló el refresh:', e?.message ?? e);
      mostrar('No se pudo actualizar. Intenta de nuevo.', 'error');
    } finally {
      setRefrescando(false);
    }
  }, [refrescar, mostrar]);
  const refreshControl = (
    <RefreshControl
      refreshing={refrescando}
      onRefresh={onRefresh}
      tintColor={Colors.brick}
      colors={[Colors.brick]}
    />
  );

  const buscador = (
    <View style={styles.searchRow}>
      <SearchField
        ref={searchFieldRef}
        placeholder="Busca libros, electrónica, muebles…"
        value={query}
        onChangeText={setQuery}
        containerStyle={styles.searchFieldFlex}
      />
      <Pressable style={styles.filterBtn} onPress={() => router.push('/filtros')} accessibilityRole="button">
        <IconFilterSliders size={16} color="#F3F0EA" />
      </Pressable>
    </View>
  );

  if (modoRecomendados) {
    return (
      <Screen refreshControl={refreshControl}>
        {buscador}
        <SectionHead title="Recomendado para ti" />
        {estado === 'error' ? (
          <ErrorState onRetry={reintentar} />
        ) : cargando ? (
          <SkeletonGrid tarjetas={4} style={styles.skeleton} />
        ) : items.length === 0 && alcance ? (
          // Mismo copy que "Feed (sin publicaciones)" — variante del frame
          // "Búsqueda (recomendados)".
          <EmptyState
            icon={<IconCampusFlag size={30} color={Colors.inkSoft} />}
            title={`Nadie ha publicado todavía en ${lugarAlcance(alcance)}`}
            sub="Prueba con otro campus o con toda la universidad."
            style={{ paddingTop: 10 }}
          >
            <GhostButton label="Cambiar campus" onPress={() => router.push('/selector-campus')} />
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
          </View>
        )}
      </Screen>
    );
  }

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filtros.categoriaId) {
    chips.push({
      key: 'cat',
      label: getCategoria(filtros.categoriaId)?.nombre ?? '',
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
    label: alcance ? etiquetaAlcance(alcance, profile?.universidad_id ?? null) : '',
    onRemove: () => router.push('/selector-campus'),
  });

  // El total del filtro, no el de la página cargada: con scroll infinito,
  // `items.length` solo diría cuántas van bajadas.
  const conteo = total ?? items.length;

  return (
    <Screen onEndReached={loadMore} refreshControl={refreshControl}>
      {buscador}

      <View style={styles.activeChips}>
        {chips.map((chip) => (
          <ActiveFilterChip key={chip.key} label={chip.label} onRemove={chip.onRemove} />
        ))}
      </View>

      <Text style={styles.resultsCount}>
        {queryDiferida.trim() !== ''
          ? `${conteo} ${conteo === 1 ? 'resultado' : 'resultados'} para "${queryDiferida}"`
          : `${conteo} ${conteo === 1 ? 'resultado' : 'resultados'}`}
      </Text>

      {estado === 'error' ? (
        <ErrorState onRetry={reintentar} />
      ) : cargando ? (
        <SkeletonGrid tarjetas={4} style={styles.skeleton} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<IconSearch size={30} color={Colors.inkSoft} />}
          title={queryDiferida.trim() !== '' ? `No encontramos "${queryDiferida}"` : 'No encontramos publicaciones'}
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
  skeleton: {
    paddingTop: 12,
    paddingBottom: 90,
  },
  skeletonMas: {
    paddingHorizontal: 0,
  },
});
