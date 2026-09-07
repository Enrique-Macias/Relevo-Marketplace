/**
 * Catálogos de universidades y campus desde Supabase.
 *
 * Reemplaza a `src/constants/mock/catalogos.ts`. Ambas tablas son de solo
 * lectura para el cliente y solo con sesión activa (`anon` no tiene ni un
 * grant) — lo cual está bien, porque los selectores viven después del OTP.
 */

import { supabase } from '@/lib/supabase';

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

export async function fetchCampus(universidadId: number): Promise<Campus[]> {
  const { data, error } = await supabase
    .from('campus')
    .select('id, nombre, ciudad')
    .eq('universidad_id', universidadId)
    .order('nombre');

  if (error) throw error;
  return data ?? [];
}
