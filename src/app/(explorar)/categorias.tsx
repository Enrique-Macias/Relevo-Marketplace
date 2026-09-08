/** Ver todas (categorías) — grid completo de las 12 categorías. */

import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { CategoryTile } from '@/components/CategoryTile';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { SkeletonCatGrid } from '@/components/Skeleton';
import { ScreenPadding } from '@/constants/theme';
import { useExplorarState } from '@/lib/explorar-state';
import { chunkRows } from '@/lib/grid';

export default function CategoriasScreen() {
  const { categorias, categoriasListas } = useExplorarState();

  if (!categoriasListas) {
    return (
      <Screen header={<PageHeader title="Categorías" />} contentStyle={styles.content}>
        <SkeletonCatGrid filas={4} columnas={3} />
      </Screen>
    );
  }

  return (
    <Screen header={<PageHeader title="Categorías" />} contentStyle={styles.content}>
      <View style={styles.grid}>
        {chunkRows(categorias, 3).map((row, i) => (
          <View key={i} style={styles.row}>
            {row.map((categoria) => (
              <CategoryTile
                key={categoria.id}
                slug={categoria.slug}
                nombre={categoria.nombre}
                onPress={() => router.push(`/categoria/${categoria.id}`)}
              />
            ))}
            {Array.from({ length: 3 - row.length }).map((_, j) => (
              <View key={`pad-${j}`} style={styles.pad} />
            ))}
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: 16,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 100,
  },
  grid: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  pad: {
    flex: 1,
  },
});
