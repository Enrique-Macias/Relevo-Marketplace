/** Detalle de publicación — 2 estados: vista comprador / vista vendedor. */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { ErrorState } from '@/components/ErrorState';
import { ListingPhoto } from '@/components/ListingPhoto';
import { RoundIconButton } from '@/components/RoundIconButton';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Colors, Radii, Typography } from '@/constants/theme';
import { useExplorarState } from '@/lib/explorar-state';
import { formatPrecio, formatRelativo, iniciales } from '@/lib/format';
import {
  fetchListingById,
  fetchStatsPropias,
  fetchVentasVendedor,
  incrementListingView,
  registrarContacto,
  type ListingDetalle,
} from '@/lib/listings';
import { useSession } from '@/lib/session';

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
  const listingId = Number(id);
  const insets = useSafeAreaInsets();
  const { favoritos, toggleFavorito, getCategoria } = useExplorarState();
  const { session } = useSession();
  const { mostrar } = useToast();

  const [listing, setListing] = useState<ListingDetalle | null>(null);
  // De qué publicación es lo que tenemos cargado (o falló). Comparado contra
  // `listingId` da el estado sin necesidad de un setState sincrónico dentro del
  // efecto para "volver a loading" — mismo idioma que `perfilCargadoPara` en
  // `src/lib/session.tsx`.
  const [cargadoPara, setCargadoPara] = useState<number | null>(null);
  const [errorPara, setErrorPara] = useState<number | null>(null);
  const [ventas, setVentas] = useState(0);
  const [stats, setStats] = useState({ contactos: 0, favoritos: 0 });
  const [recargas, setRecargas] = useState(0);

  const userId = session?.user.id ?? null;
  const isOwner = !!listing && !!userId && listing.userId === userId;
  // Una ruta con id no numérico es un error derivado del param, no un estado
  // que haya que asentar con setState desde un efecto.
  const idValido = !Number.isNaN(listingId);

  useEffect(() => {
    if (!idValido) return;

    let vigente = true;

    fetchListingById(listingId)
      .then((data) => {
        if (!vigente) return;
        setListing(data);
        setCargadoPara(listingId);
      })
      .catch((e) => {
        if (!vigente) return;
        console.warn('[detalle] no se pudo leer la publicación:', e?.message ?? e);
        setErrorPara(listingId);
      });

    return () => {
      vigente = false;
    };
  }, [listingId, recargas, idValido]);

  const estado: 'loading' | 'ready' | 'error' =
    errorPara === listingId ? 'error' : cargadoPara === listingId ? 'ready' : 'loading';

  /**
   * Vistas (RF-09). Una sola vez por publicación abierta: el `ref` es lo que
   * evita que el doble montaje de desarrollo cuente dos veces.
   *
   * NO lleva `if (!isOwner)`. La exclusión del dueño ya vive dentro de la
   * función (`user_id is distinct from auth.uid()`, migración 20260906000442) y
   * repetirla aquí sería lógica de autorización duplicada en el cliente, que es
   * justo lo que prohíbe CLAUDE.md §0 regla 7. Tampoco se hace `await`: que la
   * pantalla pinte no depende del contador.
   */
  const vistaContada = useRef<number | null>(null);
  useEffect(() => {
    if (!idValido || vistaContada.current === listingId) return;
    vistaContada.current = listingId;
    void incrementListingView(listingId).catch((e) =>
      console.warn('[detalle] no se pudo contar la vista:', e?.message ?? e)
    );
  }, [listingId, idValido]);

  // Datos secundarios: los del vendedor si soy comprador, los stats si soy dueño.
  useEffect(() => {
    if (!listing) return;

    let vigente = true;
    if (isOwner) {
      fetchStatsPropias(listing.id)
        .then((s) => vigente && setStats(s))
        .catch((e) => console.warn('[detalle] no se pudieron leer los stats:', e?.message ?? e));
    } else {
      fetchVentasVendedor(listing.vendedor.id)
        .then((n) => vigente && setVentas(n))
        .catch((e) => console.warn('[detalle] no se pudieron contar las ventas:', e?.message ?? e));
    }

    return () => {
      vigente = false;
    };
  }, [listing, isOwner]);

  /**
   * RF-13. El registro va PRIMERO y con `await`, pero su fallo no cancela el
   * contacto: negarle al usuario abrir WhatsApp por un fallo de log sería peor
   * que perder la fila. Ahora bien, esa fila no es cosmética — alimenta
   * "¿A quién le vendiste?" y de ahí las calificaciones (RF-12) — así que el
   * fallo se le dice al usuario con un toast, además de quedar en consola con
   * los ids para poder correlacionarlo con los logs del proyecto.
   */
  async function contactarPorWhatsapp() {
    if (!listing) return;

    if (userId) {
      try {
        await registrarContacto(listing.id, userId);
      } catch (e: any) {
        console.warn(
          `[contacto] falló el registro — listing_id=${listing.id} user_id=${userId} ` +
            `code=${e?.code ?? '?'} message=${e?.message ?? e}`
        );
        mostrar('No pudimos registrar el contacto', 'error');
      }
    }

    // TODO(teléfono real): este número es un placeholder — el deep link no
    // llega al vendedor de verdad. No es un olvido, es un hueco del modelo de
    // datos, ya investigado:
    //   · `public.users` no tiene columna de teléfono
    //     (supabase/migrations/20260906000438_users_profiles.sql).
    //   · `docs/product-spec.md` §Modelo de datos tampoco la lista: RF-13
    //     ("botón que abre WhatsApp con el vendedor") y RF-05 la asumen, pero
    //     ninguna la define.
    //   · Ningún frame de `design/relevo-app.html` la captura — ni "Completar
    //     perfil" ni "Editar perfil" tienen ese campo.
    // O sea: resolverlo necesita migración + frame nuevo en el diseño + campo
    // en Onboarding, no solo cambiar esta línea. Anotado en CLAUDE.md §8 y en
    // product-spec.md como pendiente formal.
    const telefono = '528111234567';
    void Linking.openURL(
      `https://wa.me/${telefono}?text=${encodeURIComponent(
        `Hola, vi tu publicación "${listing.titulo}" en Relevo`
      )}`
    );
  }

  if (!idValido || estado === 'error') {
    return (
      <Screen>
        <ErrorState
          onRetry={() => {
            setErrorPara(null);
            setRecargas((n) => n + 1);
          }}
          title="No pudimos abrir la publicación"
          sub="Revisa tu conexión e intenta de nuevo."
        />
      </Screen>
    );
  }

  // Sin skeleton propio: el frame no tiene uno para Detalle y no se inventa.
  if (estado === 'loading' || !listing) return null;

  const categoria = getCategoria(listing.categoriaId);
  const tint = categoria?.tint ?? 'brick';
  const favorito = favoritos.has(listing.id);
  const createdAt = new Date(listing.createdAt);

  return (
    <Screen contentStyle={{ paddingBottom: insets.bottom + 90 }}>
      <View style={[styles.photo, { backgroundColor: TINT_BG[tint] }]}>
        {/* La primera foto de la publicación (`fotos` ya viene ordenada por
            `orden`). El frame no dibuja carrusel, así que se pinta solo la
            portada y no se inventa uno. El ícono de categoría tintado, que
            hasta ahora era el placeholder principal, quedó como fallback para
            publicaciones sin fotos. */}
        <ListingPhoto
          path={listing.fotos[0] ?? null}
          fallback={<CategoryIcon categoriaId={categoria?.slug ?? ''} size={64} color={TINT_FG[tint]} />}
          style={styles.fotoHero}
          accessibilityLabel={listing.titulo}
        />

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

        {/* Un punto por foto real; con el bucket pendiente eso es siempre 1. */}
        <View style={styles.dots}>
          {Array.from({ length: Math.max(listing.fotos.length, 1) }).map((_, i) => (
            <View key={i} style={[styles.dot, i === 0 && styles.dotActive]} />
          ))}
        </View>
      </View>

      <View style={styles.body}>
        <Text style={styles.price}>{formatPrecio(listing.precio)}</Text>
        <Text style={styles.title}>{listing.titulo}</Text>
        <View style={styles.meta}>
          <IconMapPin size={12} color={Colors.inkSoft} />
          <Text style={styles.metaText}>{listing.campusNombre}</Text>
          <Text style={styles.metaSep}>·</Text>
          <Text style={styles.metaText}>{formatRelativo(createdAt)}</Text>
          <Text style={styles.metaSep}>·</Text>
          <Text style={styles.metaText}>{listing.vistasCount} vistas</Text>
        </View>

        {!isOwner ? (
          // pendiente: "Perfil público" es otro grupo sin construir
          <View style={styles.sellerCard}>
            <View style={styles.sellerAvatar}>
              <Text style={styles.sellerAvatarText}>{iniciales(listing.vendedor.nombre)}</Text>
            </View>
            <View style={styles.sellerInfo}>
              <View style={styles.sellerNameRow}>
                <Text style={styles.sellerName}>{listing.vendedor.nombre ?? ''}</Text>
                {/* La palomita significa "verificado por correo institucional",
                    y toda fila de public.users llegó ahí pasando por el OTP:
                    no hay un usuario no verificado que mostrar. */}
                <View style={styles.verifiedTick}>
                  <IconCheck size={8} color={Colors.paper} />
                </View>
              </View>
              <Text style={styles.sellerSub}>
                {listing.vendedor.carrera ? `${listing.vendedor.carrera} · ` : ''}
                {ventas} {ventas === 1 ? 'venta' : 'ventas'}
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
            {/* Favoritos llega por RPC, no por query: la RLS de `favorites` es
                `user_id = auth.uid()`, así que ni el dueño de la publicación
                puede contarlos con un select. Ver la migración
                20260908000443. */}
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{stats.favoritos}</Text>
              <Text style={styles.statLabel}>Favoritos</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statNum}>{stats.contactos}</Text>
              <Text style={styles.statLabel}>Contactos</Text>
            </View>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Descripción</Text>
          <Text style={styles.desc}>{listing.descripcion ?? ''}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Detalles</Text>
          <View style={styles.specRow}>
            <Text style={styles.specKey}>Categoría</Text>
            <Text style={styles.specVal}>{categoria?.nombre ?? ''}</Text>
          </View>
          <View style={styles.specRow}>
            <Text style={styles.specKey}>Condición</Text>
            <Text style={styles.specVal}>{CONDICION_LABEL[listing.condicion]}</Text>
          </View>
          <View style={styles.specRow}>
            <Text style={styles.specKey}>Zona de entrega</Text>
            <Text style={styles.specVal}>{listing.campusNombre}</Text>
          </View>
          <View style={[styles.specRow, styles.specRowLast]}>
            <Text style={styles.specKey}>Publicado</Text>
            <Text style={styles.specVal}>{formatRelativo(createdAt)}</Text>
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
              onPress={() => void contactarPorWhatsapp()}
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
            <PrimaryButton
              label="Editar publicación"
              onPress={() => router.push(`/(publicar)/editar/${listing.id}`)}
              style={styles.editBtn}
            />
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
  // Ocupa el hero completo y queda POR DEBAJO de `.nav`, que es absoluto y se
  // declara después en el JSX.
  fotoHero: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
