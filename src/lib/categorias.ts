/**
 * Catálogo de categorías desde Supabase.
 *
 * Reemplaza a `src/constants/mock/categorias.ts`. La tabla real es solo
 * `(id bigint, nombre text)` — no tiene slug ni color. El slug y el tinte no
 * son datos: son presentación derivada, y se conservan tal cual estaban
 * documentados en el mock:
 *
 *  - `slug` mapea cada categoría a su ícono en `components/icons/categories.tsx`,
 *    cuyas llaves (`libros`, `arte-y-manualidades`, …) salen de aplicar esta
 *    misma función a los 12 nombres de `supabase/seed.sql`.
 *  - `tint` es un ciclo determinista sobre los 4 tokens de tinte de `theme.ts`.
 *    El HTML alterna los 4 sin patrón por categoría, así que se fija uno.
 *
 * El ciclo va por posición en la lista ordenada por `id`, que es el orden de
 * inserción del seed — el mismo orden del frame "Ver todas (categorías)".
 */

import { supabase } from '@/lib/supabase';

export type CategoriaTint = 'brick' | 'slate' | 'gold' | 'forest';

export type Categoria = {
  /** `categories.id` real (bigint). Es lo que viaja en las rutas y en los filtros. */
  id: number;
  nombre: string;
  /** Llave de presentación: ícono en `icons/categories.tsx`. No existe en la BD. */
  slug: string;
  tint: CategoriaTint;
};

const TINTS: CategoriaTint[] = ['brick', 'slate', 'gold', 'forest'];

export function slugCategoria(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export async function fetchCategorias(): Promise<Categoria[]> {
  const { data, error } = await supabase.from('categories').select('id, nombre').order('id');

  if (error) throw error;

  return (data ?? []).map((c, i) => ({
    id: c.id,
    nombre: c.nombre,
    slug: slugCategoria(c.nombre),
    tint: TINTS[i % TINTS.length],
  }));
}

/** Las que muestra el grid abreviado del Feed; el tile "Más" cierra hacia "Ver todas". */
export function categoriasFeed(categorias: Categoria[]): Categoria[] {
  return categorias.slice(0, 7);
}

export function getCategoria(categorias: Categoria[], id: number | undefined): Categoria | undefined {
  if (id === undefined) return undefined;
  return categorias.find((c) => c.id === id);
}
