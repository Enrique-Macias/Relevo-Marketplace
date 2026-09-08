/** `.card` — tarjeta de producto (Feed, Búsqueda, Categoría). */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CategoryIcon } from '@/components/icons/categories';
import { IconHeart, IconMapPin } from '@/components/icons';
import { Colors, Radii, Typography } from '@/constants/theme';
import { useExplorarState } from '@/lib/explorar-state';
import { formatPrecio, formatRelativo } from '@/lib/format';
import type { ListingCard } from '@/lib/listings';

const TINT_BG: Record<string, string> = {
  brick: Colors.brickTint,
  slate: Colors.slateTint,
  gold: Colors.goldTint,
  forest: Colors.forestTint,
};

const TINT_FG: Record<string, string> = {
  brick: Colors.brick,
  slate: Colors.slate,
  gold: Colors.gold,
  forest: Colors.forest,
};

const CONDICION_LABEL: Record<string, string> = {
  nuevo: 'Nuevo',
  como_nuevo: 'Como nuevo',
};

type ProductCardProps = {
  listing: ListingCard;
  onPress: () => void;
  favorito: boolean;
  onToggleFavorito: () => void;
};

export function ProductCard({ listing, onPress, favorito, onToggleFavorito }: ProductCardProps) {
  // El slug y el tinte son presentación derivada del catálogo cargado, no
  // columnas de `listings` — ver `src/lib/categorias.ts`.
  const { getCategoria } = useExplorarState();
  const categoria = getCategoria(listing.categoriaId);
  const tint = categoria?.tint ?? 'brick';
  const badgeLabel = CONDICION_LABEL[listing.condicion];

  return (
    <Pressable style={styles.card} onPress={onPress}>
      <View style={[styles.thumb, { backgroundColor: TINT_BG[tint] }]}>
        <CategoryIcon categoriaId={categoria?.slug ?? ''} size={34} color={TINT_FG[tint]} />
        {badgeLabel ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badgeLabel}</Text>
          </View>
        ) : null}
        <Pressable style={styles.heart} onPress={onToggleFavorito} hitSlop={8} accessibilityRole="button">
          <IconHeart size={14} color={favorito ? Colors.brick : Colors.ink} filled={favorito} />
        </Pressable>
      </View>

      <View style={styles.info}>
        <Text style={styles.price}>{formatPrecio(listing.precio)}</Text>
        <Text style={styles.title} numberOfLines={1}>
          {listing.titulo}
        </Text>
        <View style={styles.meta}>
          <IconMapPin size={10} color={Colors.inkSoft} />
          <Text style={[styles.metaText, styles.metaCampus]} numberOfLines={1}>
            {listing.campusNombre}
          </Text>
          <Text style={styles.metaSep}>·</Text>
          <Text style={styles.metaText} numberOfLines={1}>
            {formatRelativo(new Date(listing.createdAt))}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.line,
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    aspectRatio: 4 / 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 9,
    left: 9,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  badgeText: {
    ...Typography.cardBadge,
    color: Colors.ink,
  },
  heart: {
    position: 'absolute',
    top: 9,
    right: 9,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    paddingTop: 11,
    paddingHorizontal: 12,
    paddingBottom: 13,
    flex: 1,
  },
  price: {
    ...Typography.price,
    color: Colors.ink,
    marginBottom: 5,
  },
  title: {
    ...Typography.bodyStrong,
    color: Colors.ink,
    marginBottom: 6,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 'auto',
  },
  metaText: {
    ...Typography.metaLight,
    color: Colors.inkSoft,
    flexShrink: 0,
  },
  metaCampus: {
    flexShrink: 1,
  },
  metaSep: {
    ...Typography.metaLight,
    color: Colors.line,
  },
});
