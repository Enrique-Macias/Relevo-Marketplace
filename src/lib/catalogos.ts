/**
 * Catálogos de universidades y campus desde Supabase.
 *
 * Reemplaza a `src/constants/mock/catalogos.ts`. Ambas tablas son de solo
 * lectura para el cliente y solo con sesión activa (`anon` no tiene ni un
 * grant) — lo cual está bien, porque los selectores viven después del OTP.
 */

import { supabase } from '@/lib/supabase';

/**
 * Lo mínimo para pintar un `SelectField` y poder escribir en `public.users`: el
 * id que va a la base y el nombre que lee el usuario. Lo usan "Completar perfil"
 * y "Editar perfil", las dos pantallas donde se elige el campus (la universidad
 * ya no se elige: la asigna el servidor, 20260924000466).
 */
export type OpcionCatalogo = { id: number; nombre: string };

export type Universidad = {
  id: number;
  nombre: string;
  /** `.list-row-sub` del frame. Ver `subtituloUniversidad` para cómo se arma. */
  subtitulo: string;
};

export type Campus = {
  id: number;
  nombre: string;
  ciudad: string;
  /** Nullable (CLAUDE.md §3): un campus sin coordenadas capturadas todavía
   * simplemente no participa en "Detectar campus más cercano"
   * (`campusMasCercano()`, `src/lib/ubicacion.ts`). */
  latitud: number | null;
  longitud: number | null;
};

/**
 * El frame del selector muestra una ciudad bajo cada universidad, pero
 * `universidades` solo tiene `(id, nombre)` — la ciudad vive en cada campus,
 * capturada por un admin desde Studio al dar de alta la universidad.
 *
 * Con varios campus en ciudades distintas (UANL entre Monterrey y San Nicolás,
 * por ejemplo) no hay una sola ciudad que elegir sin inventar un criterio, así
 * que:
 *  - 1 campus  → su ciudad (el caso del Tec hoy, idéntico al frame)
 *  - 2 o más   → la cuenta ("3 campus"), sin elegir ninguna
 *  - 0         → sin subtítulo
 * La ciudad concreta se ve sin ambigüedad en el paso siguiente, donde cada fila
 * del Selector de campus ya es un solo campus.
 */
function subtituloUniversidad(campus: { ciudad: string }[]): string {
  if (campus.length === 1) return campus[0].ciudad;
  if (campus.length > 1) return `${campus.length} campus`;
  return '';
}

export async function fetchUniversidades(): Promise<Universidad[]> {
  // Embedding de PostgREST por la FK campus.universidad_id → universidades.id.
  const { data, error } = await supabase
    .from('universidades')
    .select('id, nombre, campus(id, ciudad)')
    .order('nombre');

  if (error) throw error;

  return (data ?? []).map((u) => ({
    id: u.id,
    nombre: u.nombre,
    subtitulo: subtituloUniversidad(u.campus ?? []),
  }));
}

/**
 * La universidad del perfil, para PINTARLA (campo fijo de "Completar perfil").
 * No es una elección: la asigna el trigger de alta desde el dominio del correo
 * (20260924000466). La sesión solo trae el id (`PROFILE_COLUMNS`), de ahí esta
 * lectura.
 */
export async function fetchUniversidad(id: number): Promise<OpcionCatalogo | null> {
  const { data, error } = await supabase
    .from('universidades')
    .select('id, nombre')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Un campus del catálogo NAVEGABLE (fase 2B), con su universidad adentro.
 *
 * La universidad va como objeto dentro del campus y no como un `universidadId`
 * suelto a propósito: así el alcance "un campus" (`explorar-state.tsx`) no
 * puede representar un campus con la universidad equivocada, y el chip de un
 * campus de otra universidad tiene su nombre a mano sin buscarlo.
 */
export type CampusCatalogo = Campus & { universidad: { id: number; nombre: string } };

export type UniversidadCatalogo = {
  id: number;
  nombre: string;
  campus: CampusCatalogo[];
};

/**
 * TODO el catálogo de universidades con sus campus, en una sola consulta: el
 * "Selector de campus" del Feed navega cualquier universidad (fase 2B). Las
 * policies de `universidades` y `campus` son `using (true)` para
 * `authenticated`, así que no hay nada que la RLS esconda aquí.
 *
 * No reemplaza a `fetchCampus`: fijar el campus del PERFIL
 * (`CampusBottomSheet`) sigue acotado a la universidad propia.
 */
export async function fetchCatalogoCampus(): Promise<UniversidadCatalogo[]> {
  const { data, error } = await supabase
    .from('universidades')
    .select('id, nombre, campus(id, nombre, ciudad, latitud, longitud)')
    .order('nombre')
    .order('nombre', { referencedTable: 'campus' });

  if (error) throw error;

  return (data ?? []).map((u) => {
    const universidad = { id: u.id, nombre: u.nombre };
    return {
      ...universidad,
      campus: (u.campus ?? []).map((c) => ({ ...c, universidad })),
    };
  });
}

export async function fetchCampus(universidadId: number): Promise<Campus[]> {
  const { data, error } = await supabase
    .from('campus')
    .select('id, nombre, ciudad, latitud, longitud')
    .eq('universidad_id', universidadId)
    .order('nombre');

  if (error) throw error;
  return data ?? [];
}
