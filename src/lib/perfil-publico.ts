/**
 * "Perfil público" — el perfil de solo lectura de OTRO usuario.
 *
 * `correo` y `telefono` no se seleccionan aquí: siguen fuera del `grant select`
 * de `public.users` (RNF-05). El teléfono, cuando hace falta abrir WhatsApp,
 * sale por la misma RPC `seller_whatsapp` que usa Detalle (ver
 * `fetchTelefonoVendedor` en `src/lib/perfil.ts`).
 */

import { supabase } from '@/lib/supabase';

export type PerfilPublico = {
  id: string;
  nombre: string | null;
  /** RUTA dentro del bucket PÚBLICO `avatars`, o null. La pinta `Avatar`. */
  fotoUrl: string | null;
  carrera: string | null;
  ratingPromedio: number;
  estado: 'activo' | 'suspendido';
  createdAt: string;
  universidadNombre: string | null;
};

/**
 * Sin el problema de doble-FK que obliga a `users!listings_user_id_fkey` en
 * `src/lib/listings.ts`: ahí la ambigüedad viene de embeber `users` DESDE
 * `listings` (hay dos caminos). Aquí `users` es la tabla base, no un embed, así
 * que no aplica.
 */
export async function fetchPerfilPublico(userId: string): Promise<PerfilPublico | null> {
  const { data, error } = await supabase
    .from('users')
    .select(
      'id, nombre, foto_url, carrera, rating_promedio, estado, created_at, universidad:universidades(nombre)'
    )
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as any;
  return {
    id: row.id,
    nombre: row.nombre,
    fotoUrl: row.foto_url,
    carrera: row.carrera,
    ratingPromedio: Number(row.rating_promedio),
    estado: row.estado,
    createdAt: row.created_at,
    universidadNombre: row.universidad?.nombre ?? null,
  };
}

export type Review = {
  id: number;
  fromNombre: string | null;
  /** El avatar de quien escribió la reseña (`.review-avatar`, 26px). */
  fromFotoUrl: string | null;
  estrellas: number;
  comentario: string | null;
  createdAt: string;
};

/**
 * Sin paginación, con un tope — mismo criterio que el inbox de notificaciones
 * ("trae las últimas 100 y ya", CLAUDE.md §8): es una lista que crece por
 * evento, no un catálogo. `total` viene del mismo `count:'exact'` de la
 * consulta, no de `items.length`, para que el número de arriba
 * (`.profile-rating`) sea correcto aunque la lista se corte en el tope.
 *
 * `ratings_select` es `for select to authenticated using (true)`
 * (`supabase/migrations/20260906000440_favorites_contacts_ratings.sql:163-164`,
 * la misma migración donde nace la tabla) — leer reseñas de un usuario que no
 * es ninguna de las dos partes ya está permitido, sin policy nueva.
 *
 * OJO — `ratings` tiene DOS FKs a `users` (`from_user_id`, `to_user_id`), así
 * que embeber `users` sin desambiguar revienta con `PGRST201`, igual que
 * `VENDEDOR` en `src/lib/listings.ts`. Ninguna de las dos lleva nombre
 * explícito en la migración, así que Postgres usa el default
 * `ratings_from_user_id_fkey`.
 */
const REVIEWS_LIMIT = 100;

export async function fetchReviews(
  userId: string,
  limit = REVIEWS_LIMIT
): Promise<{ items: Review[]; total: number }> {
  const { data, error, count } = await supabase
    .from('ratings')
    .select(
      'id, estrellas, comentario, created_at, from_user:users!ratings_from_user_id_fkey(nombre, foto_url)',
      { count: 'exact' }
    )
    .eq('to_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  const items = (data ?? []).map((row: any) => ({
    id: row.id,
    fromNombre: row.from_user?.nombre ?? null,
    fromFotoUrl: row.from_user?.foto_url ?? null,
    estrellas: row.estrellas,
    comentario: row.comentario,
    createdAt: row.created_at,
  }));

  return { items, total: count ?? 0 };
}
