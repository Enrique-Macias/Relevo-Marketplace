import type { ReactNode } from 'react';

/**
 * Los íconos de categoría de la app (`src/components/icons/categories.tsx`),
 * para la lista y el selector de "Categorías". COPIA de los mismos paths, sin
 * import entre los dos (la app es React Native, el panel es DOM): si uno
 * cambia, cambia en `design/relevo-app.html` primero y después en los dos.
 * Las llaves son las de `categories.icono` (CHECK de `20261025000489`).
 */
const PATHS: Record<string, ReactNode> = {
  libros: (
    <>
      <path d="M4 4h11a2 2 0 012 2v14l-7.5-4L4 20V4z" />
      <path d="M17 4h1a2 2 0 012 2v14l-3-1.6" />
    </>
  ),
  electronica: (
    <>
      <rect x={3} y={4} width={18} height={12} rx={1.5} />
      <path d="M8 20h8M12 16v4" />
    </>
  ),
  muebles: (
    <>
      <path d="M4 20V10l8-6 8 6v10" />
      <path d="M9 20v-6h6v6" />
    </>
  ),
  ropa: <path d="M6 3l1.5 4h9L18 3M4 7h16l-1.5 12a2 2 0 01-2 1.8H7.5a2 2 0 01-2-1.8L4 7z" />,
  deportes: (
    <>
      <circle cx={12} cy={12} r={7} />
      <path d="M12 5v14M5 12h14" strokeWidth={1} />
    </>
  ),
  apuntes: <path d="M4 6h16M4 12h16M4 18h10" />,
  hogar: (
    <>
      <path d="M3 12l9-9 9 9" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  papeleria: (
    <>
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx={11} cy={11} r={2} />
    </>
  ),
  instrumentos: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx={6} cy={18} r={3} />
      <circle cx={18} cy={16} r={3} />
    </>
  ),
  'arte-y-manualidades': (
    <>
      <path d="M12 21a9 9 0 110-18c4 0 7 2.5 7 5.5 0 2-1.5 3-3 3h-2a1.5 1.5 0 000 3h.5a1.5 1.5 0 010 3H12z" />
      <circle cx={8} cy={10} r={1} />
      <circle cx={12} cy={7.5} r={1} />
      <circle cx={16} cy={10} r={1} />
    </>
  ),
  'boletos-y-eventos': (
    <>
      <path d="M3 9a2 2 0 100 6 2 2 0 010 4h16a2 2 0 010-4 2 2 0 100-6 2 2 0 010-4H3a2 2 0 010 4z" />
      <path d="M9 4v16" strokeDasharray="2 2" />
    </>
  ),
  alimentos: (
    <>
      <path
        d="M12 7.5c-1.6-1.7-4.3-2-6-.5-2.2 2-1.7 6-.2 9 1.2 2.4 3 4.6 4.7 4 .7-.2.9-.6 1.5-.6s.8.4 1.5.6c1.7.6 3.5-1.6 4.7-4 1.5-3 2-7-.2-9-1.7-1.5-4.4-1.2-6 .5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 7.5c0-2.2 1-3.7 3-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  otros: (
    <>
      <circle cx={5} cy={12} r={1.6} />
      <circle cx={12} cy={12} r={1.6} />
      <circle cx={19} cy={12} r={1.6} />
    </>
  ),
};

/** Las 13 llaves, en el orden del selector del frame "Categoría (modal)". */
export const ICONOS_CATEGORIA = Object.keys(PATHS);

export function IconoCategoria({ icono, tam = 18 }: { icono: string; tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
      {PATHS[icono] ?? PATHS.otros}
    </svg>
  );
}
