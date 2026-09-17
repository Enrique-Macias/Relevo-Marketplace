// ===========================================================================
// Relevo — genera los PNGs de los 4 íconos del tab bar nativo (Inicio/Buscar/
// Favoritos/Perfil), en sus 2 estados de color (activo/inactivo).
//
// POR QUÉ EXISTE: NativeTabs.Trigger.Icon no acepta un <Svg> de
// react-native-svg como `src` (node_modules/expo-router/build/native-tabs/
// utils/icon.js:50-67 — convertComponentSrcToImageSource solo soporta
// VectorIcon o el PromiseIcon interno, no exportado públicamente). La única
// vía soportada es `src: ImageSourcePropType`, así que horneamos el color de
// stroke en el bitmap en vez de usar `renderingMode:'template'` (documentado
// solo para iOS, sin garantía en Android). Ver CLAUDE.md §9.
//
// Las 4 shapes de abajo son transcripción literal de design/relevo-app.html,
// bloque `.tabbar` (líneas ~1322-1339) — viewBox, stroke-width, linecap y
// linejoin idénticos al HTML (ojo: Buscar y Perfil NO llevan
// stroke-linejoin en el HTML, a diferencia de Inicio y Favoritos — no es un
// descuido, es fiel al original). Buscar y Favoritos comparten el `d` con
// IconSearch/IconHeart de src/components/icons/index.tsx (líneas 148-155 y
// 213-226), pero esos componentes no llevan stroke-linecap/linejoin (sirven
// a otro frame) — aquí se agregan a propósito para matchear el HTML del tab
// bar, no el componente RN. Ver la nota de "tres lugares" en CLAUDE.md §9:
// esta copia NO se propaga sola si el HTML o esos componentes cambian.
//
// Corre una sola vez (o cuando cambie el diseño del tab bar):
//     node scripts/generate-tab-icons.mjs
// ===========================================================================

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const INACTIVO = '#A8A29A'; // Colors.placeholder (src/constants/theme.ts:26)
const ACTIVO = '#221F1C'; // Colors.ink (src/constants/theme.ts:9)

const OUT_DIR = path.join(process.cwd(), 'assets', 'images', 'tab-icons');
// Tamaño base = los 21px del HTML. IMPORTANTE (medido, no asumido): un PNG
// sin sufijo de densidad lo trata Metro como la versión @1x sin importar sus
// píxeles reales — un solo archivo de 84x84 se renderizó como un ícono de
// 84 PUNTOS en el simulador (enorme, desbordando la tab bar), no como un
// ícono de 21pt reescalado. Por eso hay que generar el trío @1x/@2x/@3x
// explícito: Metro elige el archivo correcto según la densidad del
// dispositivo y el ícono queda en 21pt en los tres casos.
const BASE_SIZE = 21;
const SCALES = [1, 2, 3];
// `density` sube la resolución con la que sharp/librsvg rasteriza el SVG
// ANTES del resize final — sin esto, un SVG con viewBox pequeño (24x24) se
// renderiza internamente a una resolución baja y el @3x sale borroso.
const DENSITY = 400;

const ICONS = {
  inicio: (stroke) => `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
         stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 11l9-8 9 8"/>
      <path d="M5 10v10h5v-6h4v6h5V10"/>
    </svg>`,
  buscar: (stroke) => `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
         stroke="${stroke}" stroke-width="2" stroke-linecap="round">
      <circle cx="11" cy="11" r="7"/>
      <path d="M21 21l-4.3-4.3"/>
    </svg>`,
  favoritos: (stroke) => `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
         stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/>
    </svg>`,
  perfil: (stroke) => `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
         stroke="${stroke}" stroke-width="2" stroke-linecap="round">
      <circle cx="12" cy="8" r="4"/>
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>
    </svg>`,
};

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const variantes = [
    { sufijo: 'inactivo', stroke: INACTIVO },
    { sufijo: 'activo', stroke: ACTIVO },
  ];

  for (const [nombre, construirSvg] of Object.entries(ICONS)) {
    for (const { sufijo, stroke } of variantes) {
      const svg = construirSvg(stroke);
      for (const scale of SCALES) {
        const size = BASE_SIZE * scale;
        const sufijoEscala = scale === 1 ? '' : `@${scale}x`;
        const outFile = path.join(OUT_DIR, `${nombre}-${sufijo}${sufijoEscala}.png`);
        await sharp(Buffer.from(svg), { density: DENSITY })
          .resize(size, size)
          .png()
          .toFile(outFile);
        console.log(`✓ ${outFile}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
