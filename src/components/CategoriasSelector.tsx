/**
 * La rejilla de 3 de "Intereses" (onboarding) y "Editar intereses" (Cuenta):
 * las 12 categorías con `.cat-item.selected`, selección múltiple, sin tope.
 *
 * Es la misma geometría que "Ver todas (categorías)" (`(explorar)/categorias.tsx`,
 * gap 10 y relleno para la última fila), pero no se unifica con ella: esa
 * pantalla NAVEGA al tocar y esta ELIGE. Presentacional: el set de elegidas y
 * qué hacer al tocar son del dueño.
 */

import { StyleSheet, View } from 'react-native';

import { CategoryTile } from '@/components/CategoryTile';
import type { Categoria } from '@/lib/categorias';
import { chunkRows } from '@/lib/grid';

type CategoriasSelectorProps = {
  categorias: Categoria[];
  elegidas: Set<number>;
  onToggle: (categoriaId: number) => void;
};

export function CategoriasSelector({ categorias, elegidas, onToggle }: CategoriasSelectorProps) {
  return (
    <View style={styles.grid}>
      {chunkRows(categorias, 3).map((row, i) => (
        <View key={i} style={styles.row}>
          {row.map((categoria) => (
            <CategoryTile
              key={categoria.id}
              slug={categoria.slug}
              nombre={categoria.nombre}
              selected={elegidas.has(categoria.id)}
              onPress={() => onToggle(categoria.id)}
            />
          ))}
          {Array.from({ length: 3 - row.length }).map((_, j) => (
            <View key={`pad-${j}`} style={styles.pad} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Alterna una categoría en el set sin mutarlo (el set es estado de React). */
export function alternar(elegidas: Set<number>, categoriaId: number): Set<number> {
  const nuevo = new Set(elegidas);
  if (nuevo.has(categoriaId)) nuevo.delete(categoriaId);
  else nuevo.add(categoriaId);
  return nuevo;
}

const styles = StyleSheet.create({
  // .cat-grid con grid-template-columns:repeat(3, 1fr); gap:10px
  grid: {
    width: '100%',
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
