/**
 * Datos de prueba del onboarding — copiados literalmente de los frames
 * "Selector de universidad" y "Selector de campus (onboarding)" de
 * `design/relevo-app.html`.
 *
 * Temporal por diseño: cuando llegue el auth gating, esto se reemplaza por
 * `supabase.from('universidades').select()` y `.from('campus')`. Vive aparte de
 * las pantallas justamente para que ese cambio sea de una línea por pantalla.
 * Ojo: el proyecto remoto hoy solo tiene sembrado el Tec y el campus Monterrey
 * (ver seed.sql) — esta lista es más larga que el catálogo real.
 */

export type Catalogo = {
  id: string;
  nombre: string;
  /** `.list-row-sub` — la ciudad bajo el nombre. */
  ciudad: string;
};

export const UNIVERSIDADES: Catalogo[] = [
  { id: 'tec', nombre: 'Tecnológico de Monterrey', ciudad: 'Monterrey, N.L.' },
  { id: 'uanl', nombre: 'UANL', ciudad: 'San Nicolás de la Garza, N.L.' },
  { id: 'udem', nombre: 'UDEM', ciudad: 'San Pedro Garza García, N.L.' },
  { id: 'uanl-fime', nombre: 'UANL — FIME', ciudad: 'San Nicolás de la Garza, N.L.' },
  { id: 'udg', nombre: 'Universidad de Guadalajara', ciudad: 'Guadalajara, Jal.' },
  { id: 'iteso', nombre: 'ITESO', ciudad: 'Guadalajara, Jal.' },
  { id: 'unam', nombre: 'UNAM', ciudad: 'Ciudad de México' },
  { id: 'up', nombre: 'Universidad Panamericana', ciudad: 'Ciudad de México' },
  { id: 'anahuac', nombre: 'Anáhuac', ciudad: 'Ciudad de México' },
];

export const CAMPUS: Catalogo[] = [
  { id: 'mty', nombre: 'Monterrey', ciudad: 'Monterrey, N.L.' },
  { id: 'santafe', nombre: 'Santa Fe', ciudad: 'Ciudad de México' },
  { id: 'gdl', nombre: 'Guadalajara', ciudad: 'Zapopan, Jal.' },
  { id: 'pue', nombre: 'Puebla', ciudad: 'Puebla, Pue.' },
  { id: 'qro', nombre: 'Querétaro', ciudad: 'Querétaro, Qro.' },
  { id: 'tol', nombre: 'Toluca', ciudad: 'Metepec, Méx.' },
  { id: 'leon', nombre: 'León', ciudad: 'León, Gto.' },
  { id: 'chih', nombre: 'Chihuahua', ciudad: 'Chihuahua, Chih.' },
];
