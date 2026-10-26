// ===========================================================================
// RLVO — genera los PNG del ícono de la app (iOS y Android) en Paleta 06.
//
// Fuente: los isotipos de assets/brand-paleta-06/ (copias recoloreadas del
// kit oficial). Variante elegida por el usuario el 2026-10-26: verde #183D39
// sobre menta #78CDB5, o sea la traducción directa del ícono anterior
// (grafito sobre lima).
//
// Qué genera, todo en assets/images/ (las rutas que ya usa app.json):
//   - app-icon-ios-rlvo.png  1024, SIN alfa (App Store rechaza un ícono con
//                            transparencia). Es 04_isotipo_verde_sobre_menta
//                            tal cual: medido, el ícono anterior era
//                            exactamente el isotipo 04 a 1024 (mismo bbox del
//                            símbolo, 204,121 a 787,838).
//   - icon.png               el mismo, para `expo.icon` (respaldo).
//   - android-icon-foreground.png  1024, el símbolo verde sobre transparente,
//                            a 2/3 del tamaño de iOS y centrado. El ícono
//                            adaptativo mide 108dp y el launcher enseña los
//                            72dp del centro (2/3), así que el símbolo se ve
//                            del mismo tamaño que en iOS y cae dentro del
//                            círculo seguro de 66dp con cualquier máscara.
//   - android-icon-background.png  1024, menta sólido (igual a
//                            `adaptiveIcon.backgroundColor`).
//   - android-icon-monochrome.png  1024, el símbolo en blanco (Android 13+
//                            usa solo el alfa para el ícono temático).
//   - splash-icon.png        1024, el isotipo menta sobre transparente, para
//                            el splash NATIVO (expo-splash-screen en app.json,
//                            fondo #183D39). Es la pantalla breve antes de que
//                            cargue el JS; el Splash de la app (degradado
//                            900→700 con el logo vertical menta) va después.
//                            El tamaño en pantalla lo fija `imageWidth`.
//   - notification-icon.png  96, el símbolo blanco sobre transparente, para el
//                            ícono chico de las notificaciones de Android
//                            (expo-notifications `icon`). Android solo usa el
//                            alfa y lo tiñe con `color`; sin él dibujaba el
//                            ícono de la app, opaco, como un cuadro blanco. 96
//                            es el tamaño que pide Expo (24dp a xxxhdpi); el
//                            símbolo se recorta a su contorno y ocupa 88 px,
//                            con 4 px de margen, para que no se vea diminuto.
//
// Los íconos nativos solo cambian con un build nativo nuevo (EAS o
// `expo run`); Metro no los toca.
//
//     node scripts/generate-app-icons.mjs
// ===========================================================================

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const MENTA = '#78CDB5';
const LADO = 1024;
const FACTOR_ANDROID = 2 / 3;
const BRAND = path.join(process.cwd(), 'assets', 'brand-paleta-06');
const OUT = path.join(process.cwd(), 'assets', 'images');

const svg = (nombre) => readFile(path.join(BRAND, nombre));
// `density` alta para que librsvg rasterice el viewBox de 300 a más
// resolución de la final antes del resize (si no, sale borroso).
const raster = (buf, lado) =>
  sharp(buf, { density: 600 }).resize(lado, lado).png().toBuffer();

const conFondo = await svg('04_isotipo_verde_sobre_menta.svg');
const ios = await sharp(await raster(conFondo, LADO)).removeAlpha().png().toBuffer();
await sharp(ios).toFile(path.join(OUT, 'app-icon-ios-rlvo.png'));
await sharp(ios).toFile(path.join(OUT, 'icon.png'));

const enCanvas = async (nombre) => {
  const lado = Math.round(LADO * FACTOR_ANDROID);
  const simbolo = await raster(await svg(nombre), lado);
  const margen = Math.round((LADO - lado) / 2);
  return sharp({
    create: { width: LADO, height: LADO, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: simbolo, left: margen, top: margen }])
    .png();
};
await (await enCanvas('01_isotipo_verde_transparente.svg')).toFile(
  path.join(OUT, 'android-icon-foreground.png'),
);
await (await enCanvas('03_isotipo_blanco_transparente.svg')).toFile(
  path.join(OUT, 'android-icon-monochrome.png'),
);
await sharp({ create: { width: LADO, height: LADO, channels: 3, background: MENTA } })
  .png()
  .toFile(path.join(OUT, 'android-icon-background.png'));

await sharp(await raster(await svg('02_isotipo_menta_transparente.svg'), LADO)).toFile(
  path.join(OUT, 'splash-icon.png'),
);

const NOTIF = 96;
const NOTIF_MARGEN = 4;
const simboloBlanco = await sharp(
  await raster(await svg('03_isotipo_blanco_transparente.svg'), LADO),
)
  .trim()
  .toBuffer();
await sharp(simboloBlanco)
  .resize(NOTIF - 2 * NOTIF_MARGEN, NOTIF - 2 * NOTIF_MARGEN, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .extend({
    top: NOTIF_MARGEN,
    bottom: NOTIF_MARGEN,
    left: NOTIF_MARGEN,
    right: NOTIF_MARGEN,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toFile(path.join(OUT, 'notification-icon.png'));

console.log('Íconos generados en assets/images/.');
