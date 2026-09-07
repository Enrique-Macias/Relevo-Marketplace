/** Detalle de publicación — 2 estados: vista comprador / vista vendedor. */

import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostButton, PrimaryButton } from '@/components/Buttons';
import { CategoryIcon } from '@/components/icons/categories';
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconFlag,
  IconHeart,
  IconKebab,
  IconMapPin,
  IconShare,
  IconWhatsapp,
} from '@/components/icons';
import { RoundIconButton } from '@/components/RoundIconButton';
import { Screen } from '@/components/Screen';
import { getCategoria } from '@/constants/mock/categorias';
import { getListingById, USUARIO_ACTUAL } from '@/constants/mock/listings';
import { Colors, Radii, Typography } from '@/constants/theme';
import { useExplorarState } from '@/lib/explorar-state';
import { formatPrecio, formatRelativo } from '@/lib/format';

const CONDICION_LABEL: Record<string, string> = {
  nuevo: 'Nuevo',
  como_nuevo: 'Como nuevo',
  buen_estado: 'Buen estado',
  usado: 'Usado',
};

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

export default function DetalleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listing = getListingById(id);
  const insets = useSafeAreaInsets();
  const { favoritos, toggleFavorito } = useExplorarState();

  if (!listing) return null;

  const categoria = getCategoria(listing.categoriaId);
  const tint = categoria?.tint ?? 'brick';
  const isOwner = listing.vendedor.id === USUARIO_ACTUAL.id;
  const favorito = favoritos.has(listing.id);

  return (
    <Screen contentStyle={{ paddingBottom: insets.bottom + 90 }}>
      <View style={[styles.photo, { backgroundColor: TINT_BG[tint] }]}>
        <CategoryIcon categoriaId={listing.categoriaId} size={64} color={TINT_FG[tint]} />

        <View style={styles.nav}>
          <RoundIconButton onPress={() => router.back()}>
            <IconChevronLeft size={16} color={Colors.ink} />
          </RoundIconButton>
          <View style={styles.navActions}>
            {/* compartir: backlog, no hay flujo de share nativo definido aún */}
            <RoundIconButton onPress={() => {}}>
              <IconShare size={15} color={Colors.ink} />
            </RoundIconButton>
            {isOwner ? (
              // más opciones: pendiente de (publicar)/(confianza)
              <RoundIconButton onPress={() => {}}>
                <IconKebab size={17} color={Colors.ink} />
              </RoundIconButton>
            ) : (
              // reportar: pendiente de (confianza)
              <RoundIconButton onPress={() => {}}>
                <IconFlag size={15} color={Colors.ink} />
              </RoundIconButton>
            )}
          </View>
        </View>

        <View style={styles.badge}>
          <Text style={styles.badgeText}>{CONDICION_LABEL[listing.condicion]}</Text>
        </View>

        <View style={styles.dots}>
          <View style={[styles.dot, styles.dotActive]} />
          <View style={styles.dot} />
          <View style={styles.dot} />
          <View style={styles.dot} />
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.price}>{formatPrecio(listing.precio)}</Text>
        <Text style={styles.title}>{listing.titulo}</Text>
        <View style={styles.meta}>
          <IconMapPin size={12} color={Colors.inkSoft} />
          <Text style={styles.metaText}>{listing.campus}</Text>
          <Text style={styles.metaSep}>·</Text>
          <Text style={styles.metaText}>{formatRelativo(listing.createdAt)}</Text>
          <Text style={styles.metaSep}>·</Text>
          <Text style={styles.metaText}>{listing.vistasCount} vistas</Text>
        </View>

        {!isOwner ? (
          // pendiente: "Perfil público" es otro grupo sin construir
          <View style={styles.sellerCard}>
            <View style={styles.sellerAvatar}>
              <Text style={styles.sellerAvatarText}>{listing.vendedor.iniciales}</Text>
            </View>
            <View style={styles.sellerInfo}>
              <View style={styles.sellerNameRow}>
                <Text style={styles.sellerName}>{listing.vendedor.nombre}</Text>
                {listing.vendedor.verificado ? (
                  <View style={styles.verifiedTick}>
                    <IconCheck size={8} color={Colors.paper} />
                  </View>
                ) : null}
              </View>
              <Text style={styles.sellerSub}>
                {listing.vendedor.carrera} · {listing.vendedor.ventas} ventas
              </Text>
            </View>
            <IconChevronRight size={16} color={Colors.inkSoft} />
          </View>
        ) : (
          <View style={styles.statRow}>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{listing.vistasCount}</Text>
              <Text style={styles.statLabel}>Vistas</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{listing.favoritosCount}</Text>
              <Text style={styles.statLabel}>Favoritos</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{listing.contactosCount}</Text>
              <Text style={styles.statLabel}>Contactos</Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Descripción</Text>
          <Text style={styles.desc}>{listing.descripcion}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Detalles</Text>
          <View style={styles.specRow}>
            <Text style={styles.specKey}>Categoría</Text>
            <Text style={styles.specVal}>{categoria?.nombre ?? listing.categoriaId}</Text>
          </View>
          <View style={styles.specRow}>
            <Text style={styles.specKey}>Condición</Text>
            <Text style={styles.specVal}>{CONDICION_LABEL[listing.condicion]}</Text>
          </View>
          <View style={styles.specRow}>
            <Text style={styles.specKey}>Zona de entrega</Text>
            <Text style={styles.specVal}>{listing.campus}</Text>
          </View>
          <View style={[styles.specRow, styles.specRowLast]}>
            <Text style={styles.specKey}>Publicado</Text>
            <Text style={styles.specVal}>{formatRelativo(listing.createdAt)}</Text>
          </View>
        </View>
      </View>

      <View style={[styles.cta, { paddingBottom: insets.bottom + 22 }]}>
        {!isOwner ? (
          <>
            <Pressable
              style={styles.favBtn}
              onPress={() => toggleFavorito(listing.id)}
              accessibilityRole="button"
            >
              <IconHeart size={18} color={favorito ? Colors.brick : Colors.ink} filled={favorito} />
            </Pressable>
            <Pressable
              style={styles.whatsappBtn}
              onPress={() =>
                Linking.openURL(
                  `https://wa.me/528111234567?text=${encodeURIComponent(
                    `Hola, vi tu publicación "${listing.titulo}" en Relevo`
                  )}`
                )
              }
              accessibilityRole="button"
            >
              <IconWhatsapp size={17} color={Colors.paper} />
              <Text style={styles.whatsappText}>Contactar por WhatsApp</Text>
            </Pressable>
          </>
        ) : (
          <>
            {/* pendiente: flujo real vive en (publicar)/(confianza) */}
            <GhostButton label="Marcar como vendida" onPress={() => {}} style={styles.flexBtn} />
            <PrimaryButton label="Editar publicación" onPress={() => {}} style={styles.editBtn} />
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: {
    width: '100%',
    height: 340,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nav: {
    position: 'absolute',
    top: 16,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  navActions: {
    flexDirection: 'row',
    gap: 8,
  },
  badge: {
    position: 'absolute',
    bottom: 34,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: Radii.sm,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  badgeText: {
    ...Typography.caption,
    color: Colors.ink,
  },
  dots: {
    position: 'absolute',
    bottom: 14,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  dotActive: {
    width: 16,
    borderRadius: 4,
    backgroundColor: '#fff',
  },
  body: {
    paddingTop: 18,
    paddingHorizontal: 20,
  },
  price: {
    ...Typography.priceLarge,
    color: Colors.ink,
    marginBottom: 6,
  },
  title: {
    ...Typography.detailTitle,
    color: Colors.ink,
    marginBottom: 10,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  metaText: {
    ...Typography.meta,
    color: Colors.inkSoft,
  },
  metaSep: {
    ...Typography.meta,
    color: Colors.line,
  },
  sellerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.xl,
    padding: 13,
    paddingHorizontal: 14,
    marginBottom: 20,
  },
  sellerAvatar: {
    width: 44,
    height: 44,
    borderRadius: Radii.full,
    backgroundColor: Colors.forestTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerAvatarText: {
    ...Typography.sellerAvatarInitials,
    color: Colors.forest,
  },
  sellerInfo: {
    flex: 1,
  },
  sellerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sellerName: {
    ...Typography.emphasis,
    color: Colors.ink,
  },
  verifiedTick: {
    width: 14,
    height: 14,
    borderRadius: Radii.full,
    backgroundColor: Colors.forest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerSub: {
    ...Typography.rowSub,
    color: Colors.inkSoft,
    marginTop: 2,
  },
  statRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 22,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.lg,
    paddingVertical: 13,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  statNum: {
    ...Typography.price,
    color: Colors.ink,
  },
  statLabel: {
    ...Typography.statLabel,
    color: Colors.inkSoft,
    marginTop: 3,
  },
  section: {
    marginBottom: 22,
  },
  sectionTitle: {
    ...Typography.emphasis,
    color: Colors.ink,
    marginBottom: 9,
  },
  desc: {
    ...Typography.paragraph,
    color: Colors.inkSoft,
  },
  specRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  specRowLast: {
    borderBottomWidth: 0,
  },
  specKey: {
    ...Typography.auth,
    lineHeight: undefined,
    color: Colors.inkSoft,
  },
  specVal: {
    ...Typography.bodyStrong,
    color: Colors.ink,
  },
  cta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 14,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(243,240,234,0.94)',
    borderTopWidth: 1,
    borderTopColor: Colors.line,
    flexDirection: 'row',
    gap: 10,
  },
  favBtn: {
    width: 48,
    height: 48,
    borderRadius: Radii.lg,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whatsappBtn: {
    flex: 1,
    borderRadius: Radii.lg,
    backgroundColor: Colors.brick,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  whatsappText: {
    ...Typography.buttonWhatsapp,
    color: Colors.paper,
  },
  flexBtn: {
    flex: 1,
    width: undefined,
  },
  editBtn: {
    flex: 1.2,
    width: undefined,
    marginTop: 0,
  },
});
