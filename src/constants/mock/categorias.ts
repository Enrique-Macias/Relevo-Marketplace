/**
 * Las 12 categorías reales del seed (CLAUDE.md §3, `supabase/seed.sql`),
 * mismo orden que el frame "Ver todas (categorías)". `tint` es una decisión
 * de mock: el HTML alterna los 4 tintes de tarjeta sin un patrón claro por
 * categoría, así que aquí se fija un ciclo determinista sobre los 4 tokens
 * de tinte que ya existen en `theme.ts` — no es un color nuevo, solo una
 * asignación fija de cuál le toca a cada categoría.
 */

export type CategoriaTint = 'brick' | 'slate' | 'gold' | 'forest';

export type Categoria = {
  id: string;
  nombre: string;
  tint: CategoriaTint;
};

const TINTS: CategoriaTint[] = ['brick', 'slate', 'gold', 'forest'];

const NOMBRES = [
  'Libros',
  'Electrónica',
  'Muebles',
  'Ropa',
  'Deportes',
  'Apuntes',
  'Hogar',
  'Papelería',
  'Instrumentos',
  'Arte y manualidades',
  'Boletos y eventos',
  'Otros',
] as const;

const slug = (nombre: string) =>
  nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

export const CATEGORIAS: Categoria[] = NOMBRES.map((nombre, i) => ({
  id: slug(nombre),
  nombre,
  tint: TINTS[i % TINTS.length],
}));

// Las 8 que muestra el Feed (grid abreviado) + "Más" cierra hacia "Ver todas".
export const CATEGORIAS_FEED = CATEGORIAS.slice(0, 7);

export function getCategoria(id: string): Categoria | undefined {
  return CATEGORIAS.find((c) => c.id === id);
}
