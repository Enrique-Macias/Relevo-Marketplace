/** `.cat-item` — tile de categoría (grid 4 col del Feed / 3 col de "Ver todas"). */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CategoryIcon } from '@/components/icons/categories';
import { Colors, Radii, Typography } from '@/constants/theme';

type CategoryTileProps = {
  categoriaId: string;
  nombre: string;
  onPress: () => void;
};

export function CategoryTile({ categoriaId, nombre, onPress }: CategoryTileProps) {
  return (
    <Pressable style={styles.item} onPress={onPress}>
      <View style={styles.icon}>
        <CategoryIcon categoriaId={categoriaId} size={20} color={Colors.ink} />
      </View>
      <Text style={styles.label} numberOfLines={2}>
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
});
