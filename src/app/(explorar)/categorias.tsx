/** Ver todas (categorías) — grid completo de las 12 categorías. */

import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { CategoryTile } from '@/components/CategoryTile';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { CATEGORIAS } from '@/constants/mock/categorias';
import { ScreenPadding } from '@/constants/theme';
import { chunkRows } from '@/lib/grid';

export default function CategoriasScreen() {
  return (
    <Screen header={<PageHeader title="Categorías" />} contentStyle={styles.content}>
      <View style={styles.grid}>
        {chunkRows(CATEGORIAS, 3).map((row, i) => (
          <View key={i} style={styles.row}>
            {row.map((categoria) => (
              <CategoryTile
                key={categoria.id}
                categoriaId={categoria.id}
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
