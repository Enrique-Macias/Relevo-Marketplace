/**
 * Favoritos + su estado vacío. Sin `PageHeader`: el frame usa `.page-heading`
 * a secas, sin chevron — esta pantalla es raíz de tab (como Feed y Buscar),
 * no una empujada, y `PageHeader` siempre dibuja `router.back()`.
 */

import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/Buttons';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { IconHeart } from '@/components/icons';
import { ProductCard } from '@/components/ProductCard';
import { Screen } from '@/components/Screen';
import { SkeletonGrid } from '@/components/Skeleton';
import { Colors, ScreenPadding, Typography } from '@/constants/theme';
import { useExplorarState } from '@/lib/explorar-state';
import { chunkRows } from '@/lib/grid';
import { fetchFavoritos, type ListingCard } from '@/lib/listings';
import { useSession } from '@/lib/session';

type Estado = 'loading' | 'ready' | 'error';

export default function FavoritosScreen() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const { favoritos, toggleFavorito } = useExplorarState();

  const [items, setItems] = useState<ListingCard[]>([]);
  const [estado, setEstado] = useState<Estado>('loading');
  const [recargas, setRecargas] = useState(0);

  /**
   * Reseteo a `'loading'` en RENDER, no en la primera línea del efecto —
   * mismo patrón que `useListings`/`useMisListings` (CLAUDE.md §9,
   * `react-hooks/set-state-in-effect`): comparar contra el valor anterior
   * durante el render y corregirlo ahí mismo evita un frame de contenido
   * viejo pintado bajo el estado "cargando".
   */
  const key = `${userId ?? ''}|${recargas}`;
  const [keyPintada, setKeyPintada] = useState(key);
  if (key !== keyPintada) {
    setKeyPintada(key);
    setEstado('loading');
  }

  useEffect(() => {
    if (!userId) return;

    let vigente = true;

    fetchFavoritos(userId)
      .then((data) => {
        if (!vigente) return;
        setItems(data);
        setEstado('ready');
      })
      .catch((e: any) => {
        if (!vigente) return;
        console.warn('[favoritos] falló la carga:', e?.message ?? e);
        setEstado('error');
      });

    return () => {
      vigente = false;
    };
  }, [userId, recargas]);

  const reintentar = useCallback(() => setRecargas((n) => n + 1), []);

  /**
   * Refetch al volver al tab, saltando el primer foco (ya cubierto por el
   * efecto de arriba) — mismo patrón que `mis-publicaciones.tsx`. Un
   * favorito puede haberse agregado desde Detalle, Búsqueda o el Feed
   * mientras el usuario no estaba en este tab.
   */
  const primerFoco = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primerFoco.current) {
        primerFoco.current = false;
        return;
      }
      reintentar();
    }, [reintentar])
  );

  /**
   * La lista que se pinta se DERIVA de `items` (los datos traídos) cruzados
   * con `favoritos` (el Set optimista de `useExplorarState`, la misma fuente
   * que ya gobierna el corazón en Feed/Búsqueda) — no un estado propio.
   *
   * Esto es lo que hace que tocar el corazón AQUÍ no necesite su propio
   * optimistic update: `toggleFavorito` ya lo hace de forma optimista con
   * rollback sobre `favoritos`, y como esta lista es un filtro derivado de
   * ese Set, la tarjeta desaparece sola en el siguiente render — y reaparece
   * sola si la escritura falla y el contexto revierte, porque `items` nunca
   * se tocó, solo se filtró.
   */
  const visibles = useMemo(
    () => items.filter((l) => favoritos.has(l.id)),
    [items, favoritos]
  );

  const vacio = estado === 'ready' && visibles.length === 0;

  return (
    <Screen>
      <Text style={styles.heading}>Favoritos</Text>

      {estado === 'error' ? (
        <ErrorState
          onRetry={reintentar}
          title="No pudimos cargar tus favoritos"
          sub="Revisa tu conexión e intenta de nuevo."
        />
      ) : estado === 'loading' ? (
        <SkeletonGrid tarjetas={4} style={styles.skeleton} />
      ) : vacio ? (
        <EmptyState
          icon={<IconHeart size={30} color={Colors.inkSoft} filled={false} />}
          title="Aún no tienes favoritos"
          sub="Toca el corazón en cualquier publicación para guardarla aquí y encontrarla rápido después."
        >
          <PrimaryButton label="Explorar catálogo" onPress={() => router.push('/(tabs)')} />
        </EmptyState>
      ) : (
        <View style={styles.grid}>
          {chunkRows(visibles, 2).map((row, i) => (
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

const styles = StyleSheet.create({
  // .page-heading{font-weight:600; font-size:19px; padding:16px 20px 4px;}
  heading: {
    ...Typography.pageHeading,
    color: Colors.ink,
    paddingTop: 16,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 4,
  },
  skeleton: {
    paddingTop: 14,
    paddingBottom: 90,
  },
  // .grid{padding:0 20px 90px;} — el frame le pone padding-top:14 inline.
  grid: {
    gap: 12,
    paddingTop: 14,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 90,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 12,
  },
  padCell: {
    flex: 1,
  },
});
