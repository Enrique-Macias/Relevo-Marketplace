/**
 * Los 5 campus del frame "Selector de campus" — dato de demo para esa
 * pantalla, independiente del único campus sembrado hoy en el proyecto
 * remoto (Tec de Monterrey / Monterrey, per CLAUDE.md §8).
 */

export type Campus = {
  id: string;
  nombre: string;
  ciudad: string;
};

export const CAMPUS: Campus[] = [
  { id: 'tec', nombre: 'Tec de Monterrey', ciudad: 'Monterrey, N.L.' },
  { id: 'uanl', nombre: 'UANL', ciudad: 'San Nicolás de la Garza, N.L.' },
  { id: 'udem', nombre: 'UDEM', ciudad: 'San Pedro Garza García, N.L.' },
  { id: 'uerre', nombre: 'U-ERRE', ciudad: 'Monterrey, N.L.' },
  { id: 'uvm', nombre: 'UVM', ciudad: 'San Pedro Garza García, N.L.' },
];
