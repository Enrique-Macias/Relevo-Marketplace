/**
 * Un ícono por categoría (`.cat-icon`, Feed y "Ver todas"), transcritos
 * literalmente de `design/relevo-app.html`. Todos comparten
 * `viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6}` salvo
 * el segundo trazo de "Deportes", que en el HTML lleva su propio
 * `stroke-width="1"`.
 *
 * Las llaves son las de `categories.icono`, que un CHECK de la base
 * (`20261025000489`) limita a estas 13. Agregar una exige las dos cosas.
 */

import { Circle, Path, Rect, Svg } from 'react-native-svg';

const PATHS: Record<string, React.ReactNode> = {
  libros: (
    <>
      <Path d="M4 4h11a2 2 0 012 2v14l-7.5-4L4 20V4z" />
      <Path d="M17 4h1a2 2 0 012 2v14l-3-1.6" />
    </>
  ),
  electronica: (
    <>
      <Rect x={3} y={4} width={18} height={12} rx={1.5} />
      <Path d="M8 20h8M12 16v4" />
    </>
  ),
  muebles: (
    <>
      <Path d="M4 20V10l8-6 8 6v10" />
      <Path d="M9 20v-6h6v6" />
    </>
  ),
  ropa: <Path d="M6 3l1.5 4h9L18 3M4 7h16l-1.5 12a2 2 0 01-2 1.8H7.5a2 2 0 01-2-1.8L4 7z" />,
  deportes: (
    <>
      <Circle cx={12} cy={12} r={7} />
      <Path d="M12 5v14M5 12h14" strokeWidth={1} />
    </>
  ),
  apuntes: <Path d="M4 6h16M4 12h16M4 18h10" />,
  hogar: (
    <>
      <Path d="M3 12l9-9 9 9" />
      <Path d="M5 10v10h14V10" />
    </>
  ),
  papeleria: (
    <>
      <Path d="M12 19l7-7 3 3-7 7-3-3z" />
      <Path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <Path d="M2 2l7.586 7.586" />
      <Circle cx={11} cy={11} r={2} />
    </>
  ),
  instrumentos: (
    <>
      <Path d="M9 18V5l12-2v13" />
      <Circle cx={6} cy={18} r={3} />
      <Circle cx={18} cy={16} r={3} />
    </>
  ),
  'arte-y-manualidades': (
    <>
      <Path d="M12 21a9 9 0 110-18c4 0 7 2.5 7 5.5 0 2-1.5 3-3 3h-2a1.5 1.5 0 000 3h.5a1.5 1.5 0 010 3H12z" />
      <Circle cx={8} cy={10} r={1} />
      <Circle cx={12} cy={7.5} r={1} />
      <Circle cx={16} cy={10} r={1} />
    </>
  ),
  'boletos-y-eventos': (
    <>
      <Path d="M3 9a2 2 0 100 6 2 2 0 010 4h16a2 2 0 010-4 2 2 0 100-6 2 2 0 010-4H3a2 2 0 010 4z" />
      <Path d="M9 4v16" strokeDasharray="2 2" />
    </>
  ),
  // Es el único del set con `stroke-linecap/linejoin="round"` en el HTML
  // (`design/relevo-app.html:6820`), por eso lo llevan sus trazos y no el `Svg`.
  alimentos: (
    <>
      <Path
        d="M12 7.5c-1.6-1.7-4.3-2-6-.5-2.2 2-1.7 6-.2 9 1.2 2.4 3 4.6 4.7 4 .7-.2.9-.6 1.5-.6s.8.4 1.5.6c1.7.6 3.5-1.6 4.7-4 1.5-3 2-7-.2-9-1.7-1.5-4.4-1.2-6 .5z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M12 7.5c0-2.2 1-3.7 3-4.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  otros: (
    <>
      <Circle cx={5} cy={12} r={1.6} />
      <Circle cx={12} cy={12} r={1.6} />
      <Circle cx={19} cy={12} r={1.6} />
    </>
  ),
};

export function CategoryIcon({
  categoriaId,
  size,
  color,
}: {
  categoriaId: string;
  size: number;
  color: string;
}) {
  const content = PATHS[categoriaId] ?? PATHS.otros;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6}>
      {content}
    </Svg>
  );
}
