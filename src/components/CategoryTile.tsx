/**
 * `.cat-item` — tile de categoría (grid 4 col del Feed / 3 col de "Ver todas").
 *
 * `selected` es `.cat-item.selected` (pasos "Intereses" y "Editar intereses"):
 * el `active` de siempre del sistema, fondo --ink y texto/ícono --paper. Sin
 * la prop, la tile se ve y se anuncia igual que antes: el Feed y "Ver todas"
 * navegan, no eligen.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CategoryIcon } from '@/components/icons/categories';
import { Colors, Radii, Typography } from '@/constants/theme';

type CategoryTileProps = {
  /** Slug de presentación (`libros`, `arte-y-manualidades`), no el id de la BD:
      es la llave del ícono en `icons/categories.tsx`. Ver `src/lib/categorias.ts`. */
  slug: string;
  nombre: string;
  onPress: () => void;
  /** Solo en una selección múltiple. `undefined` = la tile navega (no es un checkbox). */
  selected?: boolean;
};

export function CategoryTile({ slug, nombre, onPress, selected }: CategoryTileProps) {
  const elegible = selected !== undefined;
  return (
    <Pressable
      style={[styles.item, selected && styles.itemSelected]}
      onPress={onPress}
      accessibilityRole={elegible ? 'checkbox' : undefined}
      accessibilityState={elegible ? { checked: selected } : undefined}
    >
      <View style={styles.icon}>
        <CategoryIcon categoriaId={slug} size={20} color={selected ? Colors.paper : Colors.ink} />
      </View>
      <Text style={[styles.label, selected && styles.labelSelected]} numberOfLines={2}>
        {nombre}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // .cat-item{background:var(--card); border:1px solid var(--line); border-radius:14px; padding:10px 6px; height:86px;}
  item: {
    flex: 1,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.lg,
    paddingVertical: 10,
    paddingHorizontal: 6,
    height: 86,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  // .cat-item.selected{background:var(--ink); border-color:var(--ink);}
  itemSelected: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  // .cat-icon{width:32px; height:32px;}
  icon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...Typography.caption,
    color: Colors.ink,
    textAlign: 'center',
    lineHeight: 13.75, // 11 × 1.25
  },
  // .cat-item.selected .cat-label{color:var(--paper);}
  labelSelected: {
    color: Colors.paper,
  },
});
