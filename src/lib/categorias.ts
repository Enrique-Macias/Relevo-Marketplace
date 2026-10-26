/**
 * Catálogo de categorías desde Supabase.
 *
 * Desde `20261025000489` la tabla trae `orden`, `icono` y `activa`, que se
 * administran desde el panel (RF-17). Lo que sigue siendo presentación:
 *
 *  - `slug` es la llave del ícono en `components/icons/categories.tsx`. Sale de
 *    `categories.icono` (un CHECK de la base la limita a las que la app sabe
 *    pintar); una llave que este build no conozca cae a `otros` al pintarse.
 *  - `tint` es un ciclo determinista sobre los 4 tokens de tinte de `theme.ts`,
 *    por posición en la lista COMPLETA ordenada por `orden`, así que
 *    desactivar una categoría no le cambia el tinte a las demás.
 *
 * `activa` no se hace cumplir aquí: la base rechaza elegir una inactiva
 * (`55000 categoria_inactiva`). El cliente solo la esconde de los selectores.
 */

import { supabase } from '@/lib/supabase';

export type CategoriaTint = 'brick' | 'slate' | 'gold' | 'forest';

export type Categoria = {
  /** `categories.id` real (bigint). Es lo que viaja en las rutas y en los filtros. */
  id: number;
  nombre: string;
  /** Llave del ícono en `icons/categories.tsx` (`categories.icono`). */
  slug: string;
  tint: CategoriaTint;
  /** Una inactiva no se elige (Publicar, Filtros, Intereses), pero se sigue mostrando. */
  activa: boolean;
};

const TINTS: CategoriaTint[] = ['brick', 'slate', 'gold', 'forest'];

export async function fetchCategorias(): Promise<Categoria[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, nombre, icono, activa')
    .order('orden');

  if (error) throw error;

  return (data ?? []).map((c, i) => ({
    id: c.id,
    nombre: c.nombre,
    slug: c.icono,
    tint: TINTS[i % TINTS.length],
    activa: c.activa,
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

/** El rechazo del trigger `exige_categoria_activa` (`20261025000489`). */
export function esCategoriaInactiva(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '55000' &&
    (error as { message?: unknown }).message === 'categoria_inactiva'
  );
}
