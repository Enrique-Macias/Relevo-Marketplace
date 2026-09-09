/** Feed — `header.top` (brand+campus+hero) + búsqueda + categorías + recomendados. */

import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Path, Svg } from 'react-native-svg';

import { CategoryTile } from '@/components/CategoryTile';
import { ErrorState } from '@/components/ErrorState';
import { IconBell, IconCampusFlag, IconChevronDown, IconFilterSliders, IconSearch } from '@/components/icons';
import { ProductCard } from '@/components/ProductCard';
import { Screen } from '@/components/Screen';
import { SectionHead } from '@/components/SectionHead';
import { SkeletonCatGrid, SkeletonGrid } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';
import { categoriasFeed } from '@/lib/categorias';
import { useExplorarState } from '@/lib/explorar-state';
import { iniciales } from '@/lib/format';
import { chunkRows } from '@/lib/grid';
import { useListings } from '@/lib/listings';
import { useSession } from '@/lib/session';

// El tile de cierre del grid. `id: null` lo distingue de una categoría real:
// no navega a `/categoria/<id>`, abre "Ver todas".
const TILE_MAS = { id: null, slug: 'otros', nombre: 'Más' } as const;

export default function InicioScreen() {
  const { profile } = useSession();
  const { campusSeleccionado, categorias, categoriasListas, favoritos, toggleFavorito } =
    useExplorarState();

  // El Feed no es una lista infinita: el frame muestra un grid de 6 con
  // "Ver todo" hacia Búsqueda, que es donde vive la paginación (RNF-01).
  const { items, estado, reintentar, refrescar } = useListings(
    campusSeleccionado
      ? { campusId: campusSeleccionado.id, orden: 'recientes' as const, limit: 6 }
      : null
  );

  const { mostrar } = useToast();
  const [refrescando, setRefrescando] = useState(false);

  // Pull-to-refresh: solo re-pide el grid de "recientes" (CLAUDE.md §8b).
  // Categorías y campus no se refrescan aquí — no cambian dentro de una
  // sesión y no tienen refetch expuesto.
  const onRefresh = useCallback(async () => {
    setRefrescando(true);
    try {
      await refrescar();
    } catch (e: any) {
      console.warn('[feed] falló el refresh:', e?.message ?? e);
      mostrar('No se pudo actualizar. Intenta de nuevo.', 'error');
    } finally {
      setRefrescando(false);
    }
  }, [refrescar, mostrar]);

  const tiles = [...categoriasFeed(categorias), TILE_MAS];
  const cargando = estado === 'loading' || !campusSeleccionado;

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={refrescando}
          onRefresh={onRefresh}
          tintColor={Colors.brick}
          colors={[Colors.brick]}
        />
      }
    >
      <View style={styles.top}>
        <View style={styles.brandRow}>
          <Text style={styles.wordmark}>Relevo</Text>
          <View style={styles.topActions}>
            {/* pendiente: (notificaciones) es un grupo vacío todavía */}
            <Pressable style={styles.iconBtn} accessibilityRole="button">
              <IconBell size={17} color={Colors.ink} />
              <View style={styles.dot} />
            </Pressable>
            <Pressable style={styles.avatar} onPress={() => router.push('/perfil')} accessibilityRole="button">
              <Text style={styles.avatarText}>{iniciales(profile?.nombre)}</Text>
            </Pressable>
          </View>
        </View>

        <Pressable style={styles.campusChip} onPress={() => router.push('/selector-campus')}>
          <IconCampusFlag size={14} color={Colors.brick} />
          <Text style={styles.campusChipText}>{campusSeleccionado?.nombre ?? ''}</Text>
          <IconChevronDown size={13} color={Colors.inkSoft} />
        </Pressable>

        <LinearGradient
          colors={[Colors.ink, Colors.brickDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <Text style={styles.heroEyebrow}>HECHO PARA ESTUDIANTES</Text>
          <Text style={styles.heroHeadline}>Compra y vende sin salir del campus.</Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatText}>800+ publicaciones</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatText}>Verificado por correo institucional</Text>
            </View>
          </View>
          <Svg
            style={styles.heroSkyline}
            width="100%"
            height={60}
            viewBox="0 0 335 60"
            preserveAspectRatio="none"
          >
            <Path
              fill="rgba(243,240,234,0.16)"
              d="M0 60 L0 38 L30 38 L34 24 L40 24 L46 12 L52 24 L60 24 L64 34 L90 34 L94 20 L102 20 L108 6 L114 20 L122 20 L126 40 L150 40 L154 30 L162 30 L168 44 L200 44 L206 18 L216 18 L224 4 L232 18 L242 18 L248 42 L280 42 L284 32 L294 32 L300 46 L335 46 L335 60 Z"
            />
          </Svg>
        </LinearGradient>
      </View>

      <View style={styles.searchRow}>
        {/* No es un input real: en Feed el buscador es un punto de entrada,
            no un campo editable — tocar en cualquier parte lleva a Búsqueda
            en su estado "recomendados" (sin query, sin filtros activos). El
            campo de texto de verdad vive solo en (tabs)/buscar.tsx. */}
        <Pressable
          style={styles.searchFieldFake}
          onPress={() => router.push('/buscar')}
          accessibilityRole="button"
          accessibilityLabel="Buscar"
        >
          <IconSearch size={15} />
          <Text style={styles.searchFieldFakeText}>Busca libros, electrónica, muebles…</Text>
        </Pressable>
        <Pressable style={styles.filterBtn} onPress={() => router.push('/filtros')} accessibilityRole="button">
          <IconFilterSliders size={16} color="#F3F0EA" />
        </Pressable>
      </View>

      <SectionHead
        title="Categorías"
        linkLabel="Ver todas"
        onPressLink={() => router.push('/categorias')}
        style={{ paddingTop: 20 }}
      />
      {!categoriasListas ? (
        <SkeletonCatGrid />
      ) : (
        <View style={styles.catGrid}>
          {chunkRows(tiles, 4).map((row, i) => (
            <View key={i} style={styles.catGridRow}>
              {row.map((categoria) => (
                <CategoryTile
                  key={categoria.id ?? 'mas'}
                  slug={categoria.slug}
                  nombre={categoria.nombre}
                  onPress={() =>
                    router.push(categoria.id === null ? '/categorias' : `/categoria/${categoria.id}`)
                  }
                />
              ))}
              {Array.from({ length: 4 - row.length }).map((_, j) => (
                <View key={`pad-${j}`} style={styles.padCell} />
              ))}
            </View>
          ))}
        </View>
      )}

      <SectionHead title="Recomendado para ti" linkLabel="Ver todo" onPressLink={() => router.push('/buscar')} />
      {estado === 'error' ? (
        <ErrorState onRetry={reintentar} style={styles.errorState} />
      ) : cargando ? (
        <SkeletonGrid tarjetas={6} style={styles.skeletonGrid} />
      ) : (
        <View style={styles.grid}>
          {chunkRows(items, 2).map((row, i) => (
            <View key={i} style={styles.productGridRow}>
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
  // header.top{padding:14px 20px 0;}
  top: {
    paddingTop: 14,
    paddingHorizontal: ScreenPadding,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  wordmark: {
    ...Typography.wordmark,
    color: Colors.ink,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconBtn: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: -1,
    right: 0,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.brick,
    borderWidth: 1.5,
    borderColor: Colors.paper,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: Radii.full,
    backgroundColor: Colors.forestTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    ...Typography.avatarInitials,
    color: Colors.forest,
  },
  campusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    marginTop: 8,
  },
  campusChipText: {
    ...Typography.campusChip,
    color: Colors.ink,
  },
  hero: {
    marginTop: 14,
    borderRadius: Radii.xxl,
    overflow: 'hidden',
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 54,
  },
  heroEyebrow: {
    ...Typography.caption,
    color: Colors.paper65,
    marginBottom: 8,
  },
  heroHeadline: {
    ...Typography.heroHeadline,
    color: Colors.paper,
    maxWidth: 220,
    marginBottom: 16,
  },
  heroStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    zIndex: 2,
  },
  heroStat: {
    backgroundColor: 'rgba(243,240,234,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(243,240,234,0.25)',
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: Radii.full,
  },
  heroStatText: {
    ...Typography.heroStat,
    color: Colors.paper,
  },
  heroSkyline: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    opacity: 0.9,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    marginHorizontal: ScreenPadding,
  },
  // Mismos valores que `.search-field` (ver `ListRow.tsx`) — acá es un
  // `Pressable` con texto estático en vez de un `TextInput`, así que `flex:1`
  // va directo en este estilo (no aplica el prop `containerStyle` de
  // `SearchField`, que aquí ni se usa).
  searchFieldFake: {
    flex: 1,
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
  searchFieldFakeText: {
    ...Typography.input,
    color: Colors.placeholder,
  },
  filterBtn: {
    width: 42,
    height: 42,
    borderRadius: Radii.lg,
    backgroundColor: Colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catGrid: {
    gap: 9,
    paddingHorizontal: ScreenPadding,
  },
  grid: {
    gap: 12,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 90,
  },
  catGridRow: {
    flexDirection: 'row',
    gap: 9,
  },
  productGridRow: {
    flexDirection: 'row',
    gap: 12,
  },
  padCell: {
    flex: 1,
  },
  errorState: {
    paddingTop: 30,
    paddingBottom: 90,
  },
  // Mismo colchón inferior que `grid`, para que el tab bar no tape la última
  // fila mientras carga.
  skeletonGrid: {
    paddingBottom: 90,
  },
});
