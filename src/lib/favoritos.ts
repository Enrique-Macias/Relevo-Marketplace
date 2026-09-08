/**
 * Favoritos (RF-15). Lista privada de cada usuario: la RLS de `favorites` es
 * `user_id = auth.uid()` en select, insert y delete — nadie ve ni toca los
 * favoritos de nadie más.
 *
 * Sin `is_active_user()` a propósito (ver la migración 20260906000440): un
 * usuario suspendido sí puede usar favoritos, porque es una lista privada sin
 * impacto en terceros ni en moderación.
 */

import { supabase } from '@/lib/supabase';

/**
 * Todos los ids favoritos del usuario, de un jalón al arrancar.
 *
 * Sin paginar a propósito: es la lista personal de un estudiante, no un
 * catálogo, y traerla completa es lo que permite que el corazón de cada tarjeta
 * del grid sepa su estado sin una query por tarjeta.
 */
export async function fetchFavoritoIds(userId: string): Promise<number[]> {
  const { data, error } = await supabase
    .from('favorites')
    .select('listing_id')
    .eq('user_id', userId);

  if (error) throw error;
  return (data ?? []).map((f) => f.listing_id);
}

export async function agregarFavorito(listingId: number, userId: string): Promise<void> {
  // `ignoreDuplicates` emite ON CONFLICT DO NOTHING, no DO UPDATE. La distinción
  // importa: `favorites` no tiene grant de UPDATE ni policy de update, así que
  // un upsert normal fallaría con 42501 en cada doble tap.
  const { error } = await supabase
    .from('favorites')
    .upsert({ listing_id: listingId, user_id: userId }, {
      onConflict: 'user_id,listing_id',
      ignoreDuplicates: true,
    });

  if (error) throw error;
}

export async function quitarFavorito(listingId: number, userId: string): Promise<void> {
  const { error } = await supabase
    .from('favorites')
    .delete()
    .eq('listing_id', listingId)
    .eq('user_id', userId);

  if (error) throw error;
}
