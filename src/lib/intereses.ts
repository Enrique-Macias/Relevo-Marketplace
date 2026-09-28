/**
 * Intereses del usuario (20260930000475): las categorías que ELIGE en el paso
 * "Intereses" del onboarding o en "Editar intereses" (Perfil → Mis intereses).
 *
 * Una fila por categoría en `user_intereses`, no un arreglo en `users`: se
 * escriben con insert/delete sobre las propias filas. La RLS es
 * `user_id = auth.uid()` en select, insert y delete — nadie ve ni toca los
 * intereses de otro — y no hay UPDATE (ni grant ni policy). Nada de eso se
 * repite aquí (CLAUDE.md §0 regla 7): el `userId` que se manda es el de la
 * sesión, y si no lo fuera, la base rechaza.
 *
 * Quién los lee: `public.recomendar_listings()` (Búsqueda, "Recomendados para
 * ti"), que les da el mayor peso del ranking. No aparecen en ningún otro lado.
 */

import { supabase } from '@/lib/supabase';

export async function fetchMisIntereses(userId: string): Promise<number[]> {
  const { data, error } = await supabase
    .from('user_intereses')
    .select('categoria_id')
    .eq('user_id', userId);

  if (error) throw error;
  return (data ?? []).map((r) => r.categoria_id);
}

/**
 * Deja los intereses EXACTAMENTE en `elegidas`: inserta las nuevas y borra las
 * que salieron, a partir de lo que hay HOY en la base (no de lo que la
 * pantalla creía que había).
 *
 * Al final RE-LEE y compara, y lanza si no coincide. No es desconfianza
 * gratuita: en este repo lo que no lanza es lo que hay que mirar dos veces
 * (CLAUDE.md §9) — un `delete` que la RLS filtra afecta 0 filas sin error, y
 * sin esta comprobación la pantalla diría "guardado" sobre algo que no se
 * escribió.
 *
 * El insert va con `ignoreDuplicates` (ON CONFLICT DO NOTHING), no con un
 * upsert normal: `user_intereses` no tiene grant de UPDATE, así que un
 * `DO UPDATE` fallaría con 42501 — mismo caso que `agregarFavorito`.
 */
export async function guardarIntereses(userId: string, elegidas: number[]): Promise<void> {
  const actuales = new Set(await fetchMisIntereses(userId));
  const deseadas = new Set(elegidas);

  const agregar = [...deseadas].filter((id) => !actuales.has(id));
  const quitar = [...actuales].filter((id) => !deseadas.has(id));

  if (agregar.length > 0) {
    const { error } = await supabase
      .from('user_intereses')
      .upsert(
        agregar.map((categoria_id) => ({ user_id: userId, categoria_id })),
        { onConflict: 'user_id,categoria_id', ignoreDuplicates: true }
      );
    if (error) throw error;
  }

  if (quitar.length > 0) {
    const { error } = await supabase
      .from('user_intereses')
      .delete()
      .eq('user_id', userId)
      .in('categoria_id', quitar);
    if (error) throw error;
  }

  const finales = await fetchMisIntereses(userId);
  const coincide = finales.length === deseadas.size && finales.every((id) => deseadas.has(id));
  if (!coincide) throw new Error('Los intereses no quedaron guardados como se eligieron');
}
