#!/usr/bin/env node
// DESIGN-1 — Genera design/rlvo-app-final-preview.html (Paleta 06) a partir de
// design/relevo-app.html, que NO se modifica: solo se lee.
//
//   node design/scripts/build-final-preview.mjs
//
// Cada reemplazo declara cuántas veces debe casar; si el original cambia y un
// patrón deja de casar lo esperado, el build aborta en vez de producir un
// prototipo a medias. Solo usa módulos incorporados de Node.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const designDir = join(here, '..');
const repoDir = join(designDir, '..');
const SRC = join(designDir, 'relevo-app.html');
const OUT = join(designDir, 'rlvo-app-final-preview.html');
const BRAND_SRC = join(repoDir, 'assets', 'brand');
const BRAND_OUT = join(designDir, 'rlvo-final-brand');

// ── Paleta 06 ──────────────────────────────────────────────────────────────
const P = {
  m900: '#183D39', // verde oscuro
  m700: '#23635C', // verde profundo
  m400: '#78CDB5', // verde menta
  m100: '#DDF5ED', // menta claro
  m50: '#F5FAF8', // fondo claro
};

// ── utilidades ─────────────────────────────────────────────────────────────
function count(str, find) {
  if (typeof find === 'string') return str.split(find).length - 1;
  return (str.match(new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags + 'g')) || []).length;
}
function rep(str, find, replacement, expected, what) {
  const n = count(str, find);
  if (expected !== undefined && n !== expected) {
    throw new Error(`[build] "${what || find}" casó ${n} veces, se esperaban ${expected}`);
  }
  if (typeof find === 'string') return str.split(find).join(replacement);
  return str.replace(find, replacement);
}

// Delimita un frame por su phone-label contando <div>…</div> (los comentarios
// se saltan: varios mencionan clases dentro de su texto).
function frameRange(html, label) {
  const marker = `<div class="phone-label">${label}</div>`;
  const at = html.indexOf(marker);
  if (at < 0 || html.indexOf(marker, at + 1) >= 0) throw new Error(`[build] frame "${label}" no es único o no existe`);
  const start = html.lastIndexOf('<div class="phone-block"', at);
  const re = /<!--[\s\S]*?-->|<div\b[^>]*>|<\/div>/g;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[0] === '</div>') depth--; else depth++;
    if (depth === 0) return { start, end: m.index + m[0].length };
  }
  throw new Error(`[build] frame "${label}" sin cierre`);
}
function getFrame(html, label) { const r = frameRange(html, label); return html.slice(r.start, r.end); }
function setFrame(html, label, fn) {
  const r = frameRange(html, label);
  return html.slice(0, r.start) + fn(html.slice(r.start, r.end)) + html.slice(r.end);
}
function insertAfter(html, label, block) {
  const r = frameRange(html, label);
  return html.slice(0, r.end) + '\n\n  ' + block.trim() + html.slice(r.end);
}
// Inserta un overlay como último hijo de .device (que es position:relative).
function intoDevice(block, overlay) {
  const pbClose = block.lastIndexOf('</div>');
  const devClose = block.lastIndexOf('</div>', pbClose - 1);
  return block.slice(0, devClose) + overlay + '\n    ' + block.slice(devClose);
}
function relabel(block, from, to) {
  return rep(block, `<div class="phone-label">${from}</div>`, `<div class="phone-label">${to}</div>`, 1);
}

// ── 1. Copias recoloreadas de los SVG oficiales (los originales no se tocan) ─
mkdirSync(BRAND_OUT, { recursive: true });
const brandCopies = [
  ['07_logo_horizontal_grafito_transparente.svg', 'rlvo-logo-horizontal-verde-oscuro.svg', '#191A23', P.m900],
  ['16_logo_vertical_lima_transparente.svg', 'rlvo-logo-vertical-menta.svg', '#B9FF66', P.m400],
  ['02_isotipo_lima_transparente.svg', 'rlvo-isotipo-menta.svg', '#B9FF66', P.m400],
];
for (const [src, dst, from, to] of brandCopies) {
  const svg = readFileSync(join(BRAND_SRC, src), 'utf8');
  if (!svg.includes(from)) throw new Error(`[build] ${src} no contiene ${from}`);
  const out = svg.split(from).join(to);
  if (/#191A23|#B9FF66|#F5F1EA/i.test(out)) throw new Error(`[build] ${dst} conserva un color de la paleta anterior`);
  writeFileSync(join(BRAND_OUT, dst), out);
}
writeFileSync(join(BRAND_OUT, 'LEEME.txt'), [
  'RLVO | Copias recoloreadas para el prototipo DESIGN-1 (Paleta 06)',
  '',
  'Generadas por design/scripts/build-final-preview.mjs a partir de assets/brand/.',
  'Solo cambia el color de relleno/trazo; la geometría es la del kit oficial.',
  'Los SVG oficiales de assets/brand/ NO se modificaron.',
  '',
  `rlvo-logo-horizontal-verde-oscuro.svg  <- 07_logo_horizontal_grafito_transparente.svg  (#191A23 -> ${P.m900})`,
  `rlvo-logo-vertical-menta.svg           <- 16_logo_vertical_lima_transparente.svg       (#B9FF66 -> ${P.m400})`,
  `rlvo-isotipo-menta.svg                 <- 02_isotipo_lima_transparente.svg             (#B9FF66 -> ${P.m400})`,
  '',
  'Propuesta pendiente de aprobación: no son logos oficiales.',
  '',
].join('\n'));

// ── 2. Base ────────────────────────────────────────────────────────────────
let html = readFileSync(SRC, 'utf8');

html = rep(html, '<title>Relevo — Feed</title>',
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex, nofollow">\n<title>RLVO — Prototipo final (Paleta 06)</title>', 1);

// Tokens: se reemplaza el :root entero. Se conservan los nombres históricos
// (--brick, --forest, --gold, --slate) porque todo el CSS y cientos de estilos
// inline los usan; su VALOR pasa a la Paleta 06.
const ROOT = `  :root{
    /* Paleta 06 — Gris + Verde Menta (propuesta DESIGN-1). */
    --mint-900:${P.m900};   /* verde oscuro: texto, superficies oscuras */
    --mint-700:${P.m700};   /* verde profundo: acción primaria, enlaces, verificado */
    --mint-400:${P.m400};   /* verde menta: rellenos e indicadores, NUNCA texto */
    --mint-100:${P.m100};   /* menta claro: selección, tintes, chips */
    --mint-50:${P.m50};    /* fondo claro */

    /* Semánticos */
    --ink:var(--mint-900);
    --ink-soft:#4F6B67;     /* derivado neutro de --mint-900: 5.5:1 sobre --paper */
    --ink-muted:#7B918D;    /* derivado: placeholders (3.3:1, no texto de contenido) */
    --paper:var(--mint-50);
    --card:#FFFFFF;
    --surface-muted:color-mix(in srgb, var(--mint-100) 45%, var(--mint-50));
    --line:rgba(24,61,57,0.12);
    --brick:${P.m700};      /* binding del editor: primario / CTA */
    --brick-dark:var(--mint-900);
    --brick-tint:var(--mint-100);
    --forest:${P.m700};     /* binding del editor: confianza / verificado */
    --forest-tint:var(--mint-100);
    --accent:var(--mint-400);
    --gold:var(--mint-700);
    --gold-tint:color-mix(in srgb, var(--mint-400) 38%, white);
    --slate:var(--ink-soft);
    --slate-tint:var(--surface-muted);
    /* Excepción funcional: un error no puede leerse como acción primaria. */
    --danger:#B42332;
    --danger-bg:#FCEBED;
    --font-display: 'Fraunces';
    --font-body: 'Inter';
  }
`;
html = rep(html, /  :root\{[\s\S]*?\n  \}\n/, ROOT, 1, ':root');

// Editor de estilo: valores iniciales y "Restablecer" con la paleta nueva.
for (const [from, to] of [
  ['id="c-primary" value="#c1440e"', 'id="c-primary" value="#23635c"'],
  ['id="c-secondary" value="#2f6b4f"', 'id="c-secondary" value="#23635c"'],
  ['id="c-bg" value="#f3f0ea"', 'id="c-bg" value="#f5faf8"'],
  ['id="c-text" value="#221f1c"', 'id="c-text" value="#183d39"'],
  ["'--brick': '#c1440e'", "'--brick': '#23635c'"],
  ["'--forest': '#2f6b4f'", "'--forest': '#23635c'"],
  ["'--paper': '#f3f0ea'", "'--paper': '#f5faf8'"],
  ["'--ink': '#221f1c'", "'--ink': '#183d39'"],
]) html = rep(html, from, to, 1);

// Colores escritos a mano (SVG de la barra de estado, íconos, chrome del
// prototipo) → su equivalente de la Paleta 06.
const HEX = {
  '221F1C': '183D39', '6B6660': '4F6B67', 'A8A29A': '7B918D', 'F3F0EA': 'F5FAF8',
  '8A8680': '6E8480', '100E0C': '0E2321', 'EAE6DD': 'E3EEEA', 'DAD5CB': 'D7E2DE', '57534E': '3F5551',
};
for (const [from, to] of Object.entries(HEX)) html = html.replace(new RegExp('#' + from + '\\b', 'gi'), '#' + to);
for (const [from, to] of [
  ['rgba(243,240,234,', 'rgba(245,250,248,'],
  ['rgba(34,31,28,', 'rgba(24,61,57,'],
  ['rgba(16,14,12,', 'rgba(14,35,33,'],
  ['rgba(218,213,203,', 'rgba(215,226,222,'],
]) html = rep(html, from, to);
for (const old of ['C1440E', '2F6B4F', 'D9A441', '5B6B78', 'F7ECD6', 'E3E9EC', '221F1C']) {
  if (new RegExp('#' + old, 'i').test(html)) throw new Error(`[build] quedó #${old}`);
}

// Nombre de marca en el copy visible: "Relevo" → "RLVO" (fuera de comentarios,
// <style> y <script>; los comentarios de documentación se conservan tal cual).
html = html.replace(/(<!--[\s\S]*?-->|<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>)|\bRelevo\b/g,
  (m, keep) => keep || 'RLVO');

// ── 3. Logos ───────────────────────────────────────────────────────────────
html = rep(html, '<div class="wordmark">RLVO</div>',
  '<div class="wordmark brand-logo"><img src="rlvo-final-brand/rlvo-logo-horizontal-verde-oscuro.svg" alt="RLVO" width="92" height="35"></div>', 3);
html = rep(html, '<div class="auth-logo"><span>R</span></div>',
  '<div class="auth-logo"><img src="rlvo-final-brand/rlvo-isotipo-menta.svg" alt="RLVO" width="38" height="38"></div>', 4);
html = rep(html, /<div class="splash-logo"><span>R<\/span><\/div>\s*<div class="splash-word">RLVO<\/div>/,
  '<div class="splash-logo"><img src="rlvo-final-brand/rlvo-logo-vertical-menta.svg" alt="RLVO" width="210" height="136"></div>', 1, 'splash');

// ── 4. Mostrar/ocultar contraseña ──────────────────────────────────────────
const EYE = '<svg class="eye-show" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
  + '<svg class="eye-hide" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.6 5.1A10.7 10.7 0 0112 5c6.4 0 10 7 10 7a17.6 17.6 0 01-3.2 4.1"/><path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a10 10 0 005.4-1.6"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/><path d="M3 3l18 18"/></svg>';
const pwField = (inputAttrs) =>
  `<div class="pw-field"><input class="text-field${inputAttrs.cls || ''}" type="password" ${inputAttrs.rest}>`
  + `<button type="button" class="pw-toggle" aria-label="Mostrar contraseña" aria-pressed="false">${EYE}</button></div>`;
html = rep(html,
  /(<label class="field-label">[^<]*ontraseña[^<]*<\/label>\s*)<input class="text-field" type="text" placeholder="••••••••">/g,
  (_, label) => label + pwField({ rest: 'placeholder="••••••••"' }), 10, 'campos de contraseña');
html = rep(html, '<input class="text-field is-invalid" type="text" value="••••••••">',
  pwField({ cls: ' is-invalid', rest: 'value="relevo123"' }), 1);

// ── 5. Categoría "Alimentos" ───────────────────────────────────────────────
const ALIM_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 7.5c-1.6-1.7-4.3-2-6-.5-2.2 2-1.7 6-.2 9 1.2 2.4 3 4.6 4.7 4 .7-.2.9-.6 1.5-.6s.8.4 1.5.6c1.7.6 3.5-1.6 4.7-4 1.5-3 2-7-.2-9-1.7-1.5-4.4-1.2-6 .5z"/><path d="M12 7.5c0-2.2 1-3.7 3-4.5"/></svg>';
html = rep(html,
  /( *)(<div class="cat-item">\s*<div class="cat-icon">\s*<svg[^\n]*<circle cx="5" cy="12" r="1.6"\/>[^\n]*\n\s*<\/div>\s*<div class="cat-label">Otros<\/div>)/g,
  (_, ind, otros) => `${ind}<div class="cat-item">\n${ind}  <div class="cat-icon">\n${ind}    ${ALIM_ICON}\n${ind}  </div>\n${ind}  <div class="cat-label">Alimentos</div>\n${ind}</div>\n${ind}${otros}`,
  3, 'tile Otros');
html = rep(html, /( *)<div class="segment">Deportes<\/div>/g,
  (m, ind) => `${m}\n${ind}<div class="segment">Alimentos</div>`, 8, 'segmento Deportes');

// ── 6. Confirmaciones destructivas vs. neutras ─────────────────────────────
html = setFrame(html, 'Confirmar cerrar sesión', (b) =>
  rep(rep(b, '<div class="modal-icon">', '<div class="modal-icon is-neutral">', 1),
    '<button class="danger-btn">', '<button class="danger-btn is-neutral">', 1));

// ── 7. Pantallas nuevas (7) ────────────────────────────────────────────────
const STATUS_LIGHT = `<div class="statusbar crop-statusbar">
        <span>9:41</span>
        <div class="icons">
          <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="0.5"/><rect x="4.5" y="5" width="3" height="6" rx="0.5"/><rect x="9" y="3" width="3" height="8" rx="0.5"/><rect x="13.5" y="0" width="3" height="11" rx="0.5"/></svg>
          <svg width="16" height="11" viewBox="0 0 24 16" fill="currentColor"><path d="M12 3C7 3 3.5 5 1 7.5L12 15L23 7.5C20.5 5 17 3 12 3Z"/></svg>
          <svg width="22" height="11" viewBox="0 0 25 12" fill="none"><rect x="1" y="1" width="20" height="10" rx="2.5" stroke="currentColor" stroke-width="1"/><rect x="2.5" y="2.5" width="16" height="7" rx="1.3" fill="currentColor"/><rect x="22" y="4" width="1.6" height="4" rx="0.8" fill="currentColor"/></svg>
        </div>
      </div>`;
// Retrato de ejemplo (no es una foto real: placeholder ilustrado, como el resto
// del prototipo).
const PORTRAIT = (cls = 'portrait') => `<svg class="${cls}" viewBox="0 0 120 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="120" height="150" fill="${P.m100}"/><circle cx="96" cy="26" r="30" fill="${P.m400}" opacity="0.35"/><path d="M14 150c3-31 22-47 46-47s43 16 46 47z" fill="${P.m700}"/><path d="M48 96h24v14a12 12 0 01-24 0z" fill="#E9C9A8"/><ellipse cx="60" cy="66" rx="22" ry="26" fill="#F2D6B8"/><path d="M37 62c0-18 10-28 24-28 13 0 23 9 23 26-6-8-16-11-28-11-8 0-14 5-19 13z" fill="${P.m900}"/></svg>`;
const ICON_CAMERA = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>';
const ICON_GALLERY = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>';
const CHEVRON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-soft)" stroke-width="2.2"><path d="M9 6l6 6-6 6"/></svg>';
const CLOSE_X = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const sourceSheet = ({ title, subGallery, note, kind }) => `
      <!-- DESIGN-1: hoja "elegir origen" (${kind}). Mismo cascarón que
           "Detalle (opciones)": .sheet-card + .status-row. -->
      <div class="modal-backdrop" style="align-items:flex-end; padding:0;" data-source-sheet="${kind}">
        <div class="sheet-card">
          <div class="sheet-handle"></div>
          <div class="sheet-header">
            <div class="sheet-title">${title}</div>
            <span class="sheet-close" role="button" aria-label="Cerrar">${CLOSE_X}</span>
          </div>
          <div class="status-section" style="padding:6px 20px 6px;">
            <div class="status-row" role="button" data-source="camera">
              <div class="status-row-label">
                <div class="status-row-icon">${ICON_CAMERA}</div>
                <span class="status-row-text">Tomar foto</span>
              </div>
              ${CHEVRON}
            </div>
            <div class="status-row" role="button" data-source="gallery">
              <div class="status-row-label">
                <div class="status-row-icon">${ICON_GALLERY}</div>
                <div><span class="status-row-text">Elegir de la galería</span><div class="status-row-sub">${subGallery}</div></div>
              </div>
              ${CHEVRON}
            </div>
          </div>
          ${note ? `<div class="sheet-note">${note}</div>` : ''}
          <div style="padding:6px 20px 22px;"><div class="ghost-btn sheet-cancel" style="display:block;">Cancelar</div></div>
        </div>
      </div>`;

// N1 — Iniciar sesión (contraseña visible)
{
  let b = getFrame(html, 'Iniciar sesión');
  b = relabel(b, 'Iniciar sesión', 'Iniciar sesión (contraseña visible)');
  b = rep(b, '<div class="pw-field"><input class="text-field" type="password" placeholder="••••••••">',
    '<div class="pw-field is-visible"><input class="text-field" type="text" placeholder="••••••••" value="Mercado2026">', 1);
  b = rep(b, 'aria-label="Mostrar contraseña" aria-pressed="false"', 'aria-label="Ocultar contraseña" aria-pressed="true"', 1);
  html = insertAfter(html, 'Iniciar sesión', b);
}

// N2 — Publicar (agregar fotos)
{
  let b = getFrame(html, 'Publicar');
  b = relabel(b, 'Publicar', 'Publicar (agregar fotos)');
  b = intoDevice(b, sourceSheet({
    kind: 'publicacion', title: 'Agregar fotos',
    subGallery: 'Puedes elegir hasta 4 más',
    note: 'Llevas 1 de 5 fotos. JPG o PNG; las convertimos antes de subirlas.',
  }));
  html = insertAfter(html, 'Publicar', b);
}

// N3 — Detalle (foto ampliada con zoom)
{
  let b = getFrame(html, 'Detalle (foto a pantalla completa)');
  b = relabel(b, 'Detalle (foto a pantalla completa)', 'Detalle (foto ampliada con zoom)');
  b = rep(b, '<div class="photo-viewer">', '<div class="photo-viewer" data-zoom-inicial="2.4,-34,22">', 1);
  b = rep(b, '<div class="detail-dots">',
    '<!-- DESIGN-1: estado ampliado (pellizco). Sin botones de zoom: dos dedos acercan/alejan, un dedo desplaza la foto ampliada y el doble toque la restablece. Mientras está ampliada, el deslizamiento horizontal mueve la foto, no cambia de foto. -->\n          <div class="detail-dots">', 1);
  html = insertAfter(html, 'Detalle (foto — cerrando)', b);
}

// Visor de una sola foto para un avatar (sin dots: es una foto).
const avatarViewer = (initials) => `
      <!-- DESIGN-1: foto de perfil ampliada. Mismo .photo-viewer que Detalle,
           con una sola foto: zoom por gestos, sin botones, sin dots. -->
      <div class="photo-viewer" data-zoom-inicial="1.6,0,-18" aria-label="Foto de perfil de ${initials}">
        <div class="viewer-track">
          <div class="viewer-slide"><div class="viewer-avatar">${PORTRAIT()}</div></div>
        </div>
        <div class="viewer-close">
          <div class="round-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </div>
        </div>
      </div>`;
const withPhotoAvatar = (b, initials) =>
  rep(b, `<div class="profile-avatar">${initials}</div>`,
    `<div class="profile-avatar has-photo" role="button" aria-label="Ver foto de perfil">${PORTRAIT()}</div>`, 1);

// N4 — Perfil público (foto ampliada)
{
  let b = getFrame(html, 'Perfil público');
  b = relabel(b, 'Perfil público', 'Perfil público (foto ampliada)');
  b = intoDevice(withPhotoAvatar(b, 'JM'), avatarViewer('Jorge Muñoz'));
  html = insertAfter(html, 'Perfil público', b);
}

// N5 — Perfil (foto ampliada)
{
  let b = getFrame(html, 'Perfil');
  b = relabel(b, 'Perfil', 'Perfil (foto ampliada)');
  b = intoDevice(withPhotoAvatar(b, 'EM'), avatarViewer('Enrique M.'));
  html = insertAfter(html, 'Perfil', b);
}

// N6 — Editar perfil (cambiar foto)
{
  let b = getFrame(html, 'Editar perfil');
  b = relabel(b, 'Editar perfil', 'Editar perfil (cambiar foto)');
  b = intoDevice(b, sourceSheet({
    kind: 'avatar', title: 'Foto de perfil',
    subGallery: 'Después la ajustas en un círculo',
    note: '',
  }));
  html = insertAfter(html, 'Editar perfil', b);
}

// N7 — Editor de foto de perfil (mover, zoom, recorte y vista previa circular)
{
  const b = `<div class="phone-block" data-cat="cuenta">
    <div class="phone-label">Editor de foto de perfil</div>
    <!-- DESIGN-1: llega desde "Editar perfil (cambiar foto)" tras tomar o
         elegir la foto. Arrastrar mueve, pellizcar acerca/aleja (en escritorio:
         Ctrl + rueda o pellizco del trackpad). El círculo ES el recorte final, y
         "Así se verá" repite ese recorte en los tamaños reales del avatar
         (Perfil 76 px, vendedor 44 px, reseñas 26 px). Cancelar descarta;
         Confirmar guarda solo lo que queda dentro del círculo. -->
    <div class="device crop-device">
      <div class="notch"></div>
      ${STATUS_LIGHT}
      <div class="crop-header">
        <span class="crop-link" data-crop-cancel role="button">Cancelar</span>
        <span class="crop-title">Ajusta tu foto</span>
        <span class="crop-link strong" data-crop-confirm role="button">Listo</span>
      </div>
      <div class="crop-stage" data-crop>
        <div class="crop-layer">${PORTRAIT('crop-img')}</div>
        <div class="crop-mask" aria-hidden="true"></div>
      </div>
      <div class="crop-hint">Arrastra para mover · pellizca para acercar</div>
      <div class="crop-preview-wrap">
        <div class="crop-preview-label">Así se verá</div>
        <div class="crop-previews">
          <div class="crop-preview" data-d="76"></div>
          <div class="crop-preview" data-d="44"></div>
          <div class="crop-preview" data-d="26"></div>
        </div>
      </div>
      <div class="crop-actions">
        <label class="ghost-btn crop-pick">Elegir otra<input type="file" accept="image/*" hidden></label>
        <button class="primary-btn" data-crop-confirm style="margin-top:0; flex:1.2;">Usar foto</button>
      </div>
    </div>
  </div>`;
  html = insertAfter(html, 'Editar perfil (cambiar foto)', b);
}

// ── 8. Selector de ancho del teléfono (herramienta del prototipo) ──────────
html = rep(html, '    <button class="reset-btn" id="reset-style">Restablecer</button>',
  `    <div class="ctrl-group" style="margin-top:18px;">
      <div class="ctrl-group-label">Ancho del teléfono</div>
      <div class="ctrl-row">
        <label for="device-w">Pantalla</label>
        <select id="device-w">
          <option value="360">360 px</option>
          <option value="375" selected>375 px (original)</option>
          <option value="390">390 px</option>
          <option value="430">430 px</option>
        </select>
      </div>
    </div>

    <button class="reset-btn" id="reset-style">Restablecer</button>`, 1);

// ── 9. Capa CSS Paleta 06 ──────────────────────────────────────────────────
const LAYER = `
  /* ═══ DESIGN-1 · Capa Paleta 06 ═══════════════════════════════════════
     Todo lo de arriba es el CSS de relevo-app.html con sus colores mapeados a
     la Paleta 06. Esta capa solo ajusta roles (error ≠ primario, selección
     suave, marca) y agrega lo que representan las 7 pantallas nuevas. */

  /* Ancho del dispositivo: 375 es el del original; el selector prueba 360/390/430. */
  .device{width:var(--device-w, 375px);}

  /* Marca */
  .wordmark.brand-logo{line-height:0; display:flex; align-items:center;}
  .wordmark.brand-logo img{display:block; width:92px; height:auto;}
  .auth-logo{background:var(--mint-900);}
  .auth-logo img{display:block; width:38px; height:38px;}
  .hero, .splash-screen{background:linear-gradient(135deg, var(--mint-900) 0%, var(--mint-700) 100%);}
  .hero-skyline path{fill:rgba(120,205,181,0.22);}
  .hero-eyebrow{color:var(--mint-400);}
  .splash-logo{background:transparent; width:auto; height:auto; border-radius:0; margin-bottom:14px;}
  .splash-logo img{display:block; width:210px; height:auto;}
  .splash-tag{color:rgba(221,245,237,0.82);}
  .splash-screen .splash-dot{background:var(--mint-400);}

  /* Navegación: el destino activo gana una cápsula menta claro. */
  .tab{color:var(--ink-soft);}
  .tab svg{stroke:var(--ink-soft);}
  .tab.active{color:var(--mint-900); font-weight:600;}
  .tab.active svg{stroke:var(--mint-900); background:var(--mint-100); box-sizing:content-box; padding:4px 15px; margin:-4px 0; border-radius:999px;}

  /* Selección suave: menta claro con borde verde profundo. Las tiles elegidas
     de Intereses se quedan en --ink porque su ícono se pinta en --paper. */
  .segment.active, .chip.active{background:var(--mint-100); color:var(--mint-900); border-color:var(--mint-700);}
  .onboard-dot.active{background:var(--mint-700);}
  .toggle.on{background:var(--mint-700);}

  /* Texto secundario pequeño: nunca el gris claro del original. */
  .auth-terms{color:var(--ink-soft);}
  .text-field::placeholder, .textarea-field::placeholder, .search-field input::placeholder{color:var(--ink-muted);}

  /* Errores y acciones destructivas: --danger, no el primario. */
  .text-field.is-invalid, .phone-field.is-invalid{border-color:var(--danger);}
  .field-error{color:var(--danger);}
  .status-row-text.danger{color:var(--danger);}
  .status-row-icon[style*="--brick"]{color:var(--danger) !important;}
  .danger-btn{background:var(--danger); color:#FFFFFF;}
  .danger-btn.is-neutral{background:var(--brick);}
  .modal-icon{background:var(--danger-bg);}
  .modal-icon:not(.is-neutral) [stroke="var(--brick)"]{stroke:var(--danger);}
  .modal-icon:not(.is-neutral) [fill="var(--brick)"]{fill:var(--danger);}
  .modal-icon.is-neutral{background:var(--mint-100);}
  .error-icon{background:var(--danger-bg);}
  .error-icon [stroke="var(--brick)"]{stroke:var(--danger);}
  .toast-icon{background:var(--mint-400);}
  .toast-icon:not(.is-error) svg{stroke:var(--mint-900);}
  .toast-icon.is-error{background:var(--danger);}

  /* Mostrar/ocultar contraseña */
  .pw-field{position:relative;}
  .pw-field .text-field{padding-right:46px;}
  .pw-toggle{position:absolute; top:50%; right:6px; transform:translateY(-50%); width:36px; height:36px; border:none; background:none; border-radius:10px; color:var(--ink-soft); display:flex; align-items:center; justify-content:center; cursor:pointer;}
  .pw-toggle:focus-visible{outline:2px solid var(--mint-700); outline-offset:1px;}
  .pw-toggle .eye-hide{display:none;}
  .pw-field.is-visible .pw-toggle .eye-show{display:none;}
  .pw-field.is-visible .pw-toggle .eye-hide{display:block;}
  .pw-field.is-visible .pw-toggle{color:var(--mint-700);}

  /* Hojas "elegir origen" */
  .status-row[role="button"], .sheet-close, .sheet-cancel{cursor:pointer;}
  .status-row-sub{font-size:11.5px; color:var(--ink-soft); margin-top:2px;}
  .sheet-note{font-size:11.5px; color:var(--ink-soft); line-height:1.45; padding:0 20px 8px;}
  .photo-add:not(.is-busy){cursor:pointer;}
  .photo-thumb.is-local{overflow:hidden; background:var(--surface-muted);}
  .photo-thumb.is-local img{width:100%; height:100%; object-fit:cover; border-radius:14px;}

  /* Visor: zoom por gestos (sin botones) */
  .detail-photo, .profile-avatar.has-photo, .profile-avatar{cursor:zoom-in;}
  .photo-viewer.is-closed{display:none;}
  .viewer-track{touch-action:pan-x; cursor:grab;}
  .viewer-slide{overflow:hidden; position:relative;}
  .zoom-content{display:flex; align-items:center; justify-content:center; width:100%; height:100%; transform-origin:50% 50%; transition:transform .18s ease-out; will-change:transform;}
  .zoom-content.is-live{transition:none;}
  .zoom-content > svg:not(.portrait){width:150px; height:150px;}
  .photo-viewer.is-zoomed .viewer-track{overflow:hidden; touch-action:none; cursor:move;}
  .photo-viewer.is-zoomed .detail-dots{opacity:.35;}
  .viewer-avatar{width:100%; aspect-ratio:4 / 5; max-height:78%;}
  .viewer-avatar .portrait, .profile-avatar .portrait{display:block; width:100%; height:100%;}
  .viewer-initials{width:220px; height:220px; border-radius:50%; background:var(--forest-tint); color:var(--forest); display:flex; align-items:center; justify-content:center; font-family:var(--font-display), serif; font-weight:600; font-size:72px;}
  .profile-avatar.has-photo{overflow:hidden; padding:0;}

  /* Editor de foto de perfil */
  .crop-device{background:var(--mint-900);}
  .crop-device .notch{background:#0E2321;}
  .crop-statusbar{color:var(--mint-50);}
  .crop-header{display:flex; align-items:center; justify-content:space-between; padding:14px 20px 12px; color:var(--mint-50); flex-shrink:0;}
  .crop-title{font-size:15px; font-weight:600;}
  .crop-link{font-size:13.5px; font-weight:500; color:rgba(245,250,248,0.82); cursor:pointer;}
  .crop-link.strong{color:var(--mint-400); font-weight:600;}
  .crop-stage{position:relative; width:100%; aspect-ratio:1 / 1; overflow:hidden; touch-action:none; cursor:grab; flex-shrink:0; background:#0E2321;}
  .crop-stage.is-dragging{cursor:grabbing;}
  .crop-layer{position:absolute; inset:0; pointer-events:none;}
  .crop-img{position:absolute; left:0; top:-12.5%; width:100%; height:125%; transform-origin:50% 50%; display:block; object-fit:cover;}
  .crop-mask{position:absolute; left:10%; top:10%; width:80%; height:80%; border-radius:50%; box-shadow:0 0 0 999px rgba(14,35,33,0.62); outline:2px solid rgba(245,250,248,0.9); outline-offset:-1px; pointer-events:none;}
  .crop-hint{text-align:center; font-size:12px; color:rgba(245,250,248,0.78); padding:12px 20px 0;}
  .crop-preview-wrap{padding:14px 20px 0; flex:1;}
  .crop-preview-label{font-size:11px; font-weight:600; letter-spacing:0.04em; text-transform:uppercase; color:var(--mint-400); margin-bottom:10px;}
  .crop-previews{display:flex; align-items:center; gap:18px;}
  .crop-preview{position:relative; border-radius:50%; overflow:hidden; background:var(--mint-100); flex-shrink:0; box-shadow:0 0 0 2px rgba(245,250,248,0.18);}
  .crop-preview-inner{position:absolute; left:0; top:0; transform-origin:0 0;}
  .crop-actions{display:flex; gap:10px; padding:14px 20px 26px; flex-shrink:0;}
  .crop-actions .ghost-btn{background:transparent; color:var(--mint-50); border-color:rgba(245,250,248,0.35); cursor:pointer;}
  .crop-actions .primary-btn{background:var(--mint-400); color:var(--mint-900); cursor:pointer;}
  .proto-toast{position:absolute; left:20px; right:20px; bottom:100px; z-index:30;}
`;
html = rep(html, '\n</style>', LAYER + '</style>', 1);

// ── 10. JavaScript de las mejoras ──────────────────────────────────────────
const JS = `
  /* ═══ DESIGN-1 · Interacciones nuevas (solo prototipo) ═════════════════ */

  // Ancho del teléfono
  document.getElementById('device-w').addEventListener('change', function(e){
    root.style.setProperty('--device-w', e.target.value + 'px');
    document.querySelectorAll('[data-crop]').forEach(function(s){ s._cropUpdate && s._cropUpdate(); });
    document.querySelectorAll('.viewer-track').forEach(function(t){
      var i = t._indice || 0; t.scrollLeft = i * t.clientWidth;
    });
  });

  // Mostrar / ocultar contraseña
  document.addEventListener('click', function(e){
    var btn = e.target.closest('.pw-toggle');
    if (!btn) return;
    var field = btn.closest('.pw-field');
    var input = field.querySelector('input');
    var visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    field.classList.toggle('is-visible', visible);
    btn.setAttribute('aria-pressed', visible ? 'true' : 'false');
    btn.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
  });

  // ── Visor de fotos con zoom por gestos ──
  var MAX_ZOOM = 4;
  var visorActivo = null;

  function slidesDe(track){ return Array.prototype.slice.call(track.querySelectorAll('.viewer-slide')); }
  function contenidoDe(slide){
    var z = slide.querySelector('.zoom-content');
    if (!z) {
      z = document.createElement('div');
      z.className = 'zoom-content';
      while (slide.firstChild) z.appendChild(slide.firstChild);
      slide.appendChild(z);
    }
    return z;
  }

  function prepararVisor(viewer){
    if (viewer._listo) return;
    viewer._listo = true;
    var track = viewer.querySelector('.viewer-track');
    var dots = viewer.querySelectorAll('.detail-dots span');
    var z = {s:1, x:0, y:0, el:null};
    viewer._zoom = z;
    slidesDe(track).forEach(contenidoDe);

    function indice(){ return Math.round(track.scrollLeft / Math.max(1, track.clientWidth)); }
    function limitar(){
      if (!z.el) return;
      var w = z.el.clientWidth, h = z.el.clientHeight;
      var mx = w * (z.s - 1) / 2, my = h * (z.s - 1) / 2;
      z.x = Math.max(-mx, Math.min(mx, z.x));
      z.y = Math.max(-my, Math.min(my, z.y));
    }
    function pintar(vivo){
      if (!z.el) return;
      limitar();
      z.el.classList.toggle('is-live', !!vivo);
      z.el.style.transform = 'translate(' + z.x + 'px,' + z.y + 'px) scale(' + z.s + ')';
      viewer.classList.toggle('is-zoomed', z.s > 1.01);
    }
    function restablecer(){
      if (z.el) { z.el.classList.remove('is-live'); z.el.style.transform = ''; }
      z.s = 1; z.x = 0; z.y = 0;
      viewer.classList.remove('is-zoomed');
    }
    function actual(){
      var s = slidesDe(track)[indice()];
      return s ? contenidoDe(s) : null;
    }
    function irA(i){
      var n = slidesDe(track).length;
      i = Math.max(0, Math.min(n - 1, i));
      restablecer();
      track.scrollTo({left: i * track.clientWidth, behavior: 'smooth'});
    }
    function cerrar(){
      restablecer();
      viewer.classList.remove('is-dismissing');
      viewer.querySelector('.viewer-track').style.transform = '';
      viewer.classList.add('is-closed');
      if (visorActivo === viewer) visorActivo = null;
    }
    viewer._irA = irA;
    viewer._cerrar = cerrar;
    viewer._aplicarZoom = function(s, x, y){ z.el = actual(); z.s = s; z.x = x; z.y = y; pintar(false); };

    track.addEventListener('scroll', function(){
      var i = indice();
      track._indice = i;
      dots.forEach(function(d, k){ d.classList.toggle('active', k === i); });
      if (z.el && z.el !== actual()) restablecer();
    });

    // Punteros: 2 = pellizco, 1 con zoom = desplazar, 1 sin zoom = arrastrar
    // hacia abajo para cerrar (y, con ratón, deslizar entre fotos).
    var punteros = new Map();
    var inicio = null;
    function distancia(){ var p = Array.from(punteros.values()); return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
    function centro(){ var p = Array.from(punteros.values()); return {x:(p[0].x + p[1].x) / 2, y:(p[0].y + p[1].y) / 2}; }

    track.addEventListener('pointerdown', function(e){
      visorActivo = viewer;
      if (e.target.closest('.viewer-close')) return;
      punteros.set(e.pointerId, {x:e.clientX, y:e.clientY});
      try { track.setPointerCapture(e.pointerId); } catch (err) {}
      if (!z.el || z.s <= 1.01) z.el = actual();
      if (punteros.size === 2) {
        inicio = {modo:'pellizco', d:distancia(), s:z.s, c:centro(), x:z.x, y:z.y};
      } else if (punteros.size === 1) {
        inicio = {modo: z.s > 1.01 ? 'desplazar' : 'libre', px:e.clientX, py:e.clientY, x:z.x, y:z.y, scroll:track.scrollLeft, tipo:e.pointerType};
      }
    });
    track.addEventListener('pointermove', function(e){
      if (!punteros.has(e.pointerId) || !inicio) return;
      punteros.set(e.pointerId, {x:e.clientX, y:e.clientY});
      if (inicio.modo === 'pellizco' && punteros.size === 2) {
        var c = centro();
        z.s = Math.max(1, Math.min(MAX_ZOOM, inicio.s * distancia() / inicio.d));
        z.x = inicio.x + (c.x - inicio.c.x);
        z.y = inicio.y + (c.y - inicio.c.y);
        pintar(true);
        e.preventDefault();
      } else if (inicio.modo === 'desplazar') {
        z.x = inicio.x + (e.clientX - inicio.px);
        z.y = inicio.y + (e.clientY - inicio.py);
        pintar(true);
        e.preventDefault();
      } else if (inicio.modo === 'libre') {
        var dx = e.clientX - inicio.px, dy = e.clientY - inicio.py;
        if (dy > 12 && dy > Math.abs(dx)) {
          inicio.modo = 'cerrando';
        } else if (inicio.tipo === 'mouse' && Math.abs(dx) > 6) {
          track.style.scrollSnapType = 'none';
          track.scrollLeft = inicio.scroll - dx;
        }
      }
      if (inicio.modo === 'cerrando') {
        var bajada = Math.max(0, e.clientY - inicio.py);
        viewer.classList.toggle('is-dismissing', bajada > 40);
        track.style.transform = 'translateY(' + bajada + 'px) scale(' + Math.max(0.85, 1 - bajada / 900) + ')';
      }
    });
    function soltar(e){
      if (!punteros.has(e.pointerId)) return;
      punteros.delete(e.pointerId);
      if (!inicio) return;
      if (inicio.modo === 'cerrando') {
        var bajada = e.clientY - inicio.py;
        track.style.transform = '';
        viewer.classList.remove('is-dismissing');
        if (bajada > 90) cerrar();
      } else if (inicio.modo === 'libre' && inicio.tipo === 'mouse') {
        track.style.scrollSnapType = '';
        var w = track.clientWidth, dx = e.clientX - inicio.px;
        var base = Math.round(inicio.scroll / w);
        irA(Math.abs(dx) > w * 0.18 ? base + (dx < 0 ? 1 : -1) : base);
      }
      if (z.s <= 1.01) restablecer(); else pintar(false);
      if (punteros.size === 1) {
        var p = Array.from(punteros.values())[0];
        inicio = {modo: z.s > 1.01 ? 'desplazar' : 'libre', px:p.x, py:p.y, x:z.x, y:z.y, scroll:track.scrollLeft, tipo:e.pointerType};
      } else if (punteros.size === 0) {
        inicio = null;
      }
    }
    track.addEventListener('pointerup', soltar);
    track.addEventListener('pointercancel', soltar);

    // Doble toque: alterna entre ampliado y tamaño normal (gesto, no botón).
    var ultimoToque = 0;
    track.addEventListener('pointerup', function(e){
      var ahora = Date.now();
      if (ahora - ultimoToque < 280) {
        z.el = actual();
        if (z.s > 1.01) { restablecer(); }
        else {
          var r = z.el.getBoundingClientRect();
          z.s = 2.5;
          z.x = (r.left + r.width / 2 - e.clientX) * 1.5;
          z.y = (r.top + r.height / 2 - e.clientY) * 1.5;
          pintar(false);
        }
        ultimoToque = 0;
      } else {
        ultimoToque = ahora;
      }
    });

    // Pellizco del trackpad (el navegador lo entrega como rueda + Ctrl).
    track.addEventListener('wheel', function(e){
      if (!e.ctrlKey) return;
      e.preventDefault();
      visorActivo = viewer;
      if (!z.el || z.s <= 1.01) z.el = actual();
      z.s = Math.max(1, Math.min(MAX_ZOOM, z.s * Math.exp(-e.deltaY / 300)));
      if (z.s <= 1.01) restablecer(); else pintar(false);
    }, {passive:false});

    var x = viewer.querySelector('.viewer-close');
    if (x) x.addEventListener('click', cerrar);
    viewer.addEventListener('pointerenter', function(){ visorActivo = viewer; });

    var zi = viewer.getAttribute('data-zoom-inicial');
    if (zi) {
      var v = zi.split(',').map(Number);
      requestAnimationFrame(function(){ viewer._aplicarZoom(v[0], v[1], v[2]); });
    }
  }

  function abrirVisor(viewer, i){
    viewer.classList.remove('is-closed');
    prepararVisor(viewer);
    visorActivo = viewer;
    var track = viewer.querySelector('.viewer-track');
    // Síncrono: leer clientWidth fuerza el layout tras quitar is-closed.
    track.scrollLeft = (i || 0) * track.clientWidth;
    track._indice = i || 0;
  }

  // Construye (una vez) un visor para un frame a partir de sus fotos.
  function visorPara(device, slidesHtml, conDots){
    var viewer = device.querySelector(':scope > .photo-viewer.is-generated');
    if (viewer) return viewer;
    viewer = document.createElement('div');
    viewer.className = 'photo-viewer is-generated is-closed';
    var dots = '';
    if (conDots && slidesHtml.length > 1) {
      dots = '<div class="detail-dots">' + slidesHtml.map(function(_, k){ return '<span' + (k === 0 ? ' class="active"' : '') + '></span>'; }).join('') + '</div>';
    }
    viewer.innerHTML = '<div class="viewer-track">' + slidesHtml.map(function(h){ return '<div class="viewer-slide">' + h + '</div>'; }).join('') + '</div>'
      + '<div class="viewer-close"><div class="round-btn"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></div></div>' + dots;
    device.appendChild(viewer);
    return viewer;
  }

  // Visores ya presentes en los frames (abiertos de inicio).
  document.querySelectorAll('.photo-viewer').forEach(prepararVisor);

  // Tocar la foto del Detalle abre el visor en esa foto.
  document.addEventListener('click', function(e){
    var hero = e.target.closest('.detail-photo');
    if (!hero || e.target.closest('.detail-nav, .round-btn, .detail-badge')) return;
    var device = hero.closest('.device');
    var existente = device.querySelector('.photo-viewer:not(.is-generated)');
    var trackHero = hero.querySelector('.detail-track');
    var i = trackHero ? Math.round(trackHero.scrollLeft / Math.max(1, trackHero.clientWidth)) : 0;
    if (existente) { abrirVisor(existente, existente.querySelector('.viewer-track')._indice || 0); return; }
    var fuentes = hero.querySelectorAll('.detail-slide');
    var slides = fuentes.length ? Array.prototype.map.call(fuentes, function(s){ return s.innerHTML; }) : [hero.innerHTML];
    abrirVisor(visorPara(device, slides, true), i);
  });

  // Tocar la foto de perfil (propia o del vendedor) la amplía.
  document.addEventListener('click', function(e){
    var av = e.target.closest('.profile-avatar');
    if (!av) return;
    var device = av.closest('.device');
    var existente = device.querySelector('.photo-viewer:not(.is-generated)');
    if (existente) { abrirVisor(existente, 0); return; }
    var contenido = av.classList.contains('has-photo')
      ? '<div class="viewer-avatar">' + av.innerHTML + '</div>'
      : '<div class="viewer-initials">' + av.textContent.trim() + '</div>';
    abrirVisor(visorPara(device, [contenido], false), 0);
  });

  // Teclado: flechas entre fotos, Esc cierra el visor activo.
  document.addEventListener('keydown', function(e){
    if (!visorActivo || visorActivo.classList.contains('is-closed')) return;
    var track = visorActivo.querySelector('.viewer-track');
    var i = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
    if (e.key === 'ArrowRight') { visorActivo._irA(i + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { visorActivo._irA(i - 1); e.preventDefault(); }
    else if (e.key === 'Escape') { visorActivo._cerrar(); }
  });

  // ── Hojas "Tomar foto / Elegir de la galería" ──
  var tplPublicacion = document.querySelector('[data-source-sheet="publicacion"]');
  var tplAvatar = document.querySelector('[data-source-sheet="avatar"]');

  function toastEn(device, texto){
    var t = document.createElement('div');
    t.className = 'toast proto-toast';
    t.innerHTML = '<div class="toast-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg></div><div class="toast-text"></div>';
    t.querySelector('.toast-text').textContent = texto;
    device.appendChild(t);
    setTimeout(function(){ t.remove(); }, 2200);
  }

  function elegirArchivos(origen, multiple, alElegir){
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (origen === 'camera') input.setAttribute('capture', 'environment');
    if (multiple) input.multiple = true;
    input.addEventListener('change', function(){ alElegir(Array.prototype.slice.call(input.files || [])); });
    input.click();
  }

  // Agrega fotos locales a la fila de un formulario respetando el tope de 5.
  function agregarFotos(device, archivos){
    var fila = device.querySelector('.photo-row');
    if (!fila || !archivos.length) return;
    var actuales = fila.querySelectorAll('.photo-thumb').length;
    var libres = Math.max(0, 5 - actuales);
    archivos.slice(0, libres).forEach(function(f){
      var th = document.createElement('div');
      th.className = 'photo-thumb is-local';
      th.innerHTML = '<img alt="">';
      th.querySelector('img').src = URL.createObjectURL(f);
      var add = fila.querySelector('.photo-add');
      fila.insertBefore(th, add || null);
    });
    var total = fila.querySelectorAll('.photo-thumb').length;
    var contador = device.querySelector('.photo-count');
    if (contador) contador.textContent = total + '/5';
    if (total >= 5) fila.querySelectorAll('.photo-add').forEach(function(a){ a.style.display = 'none'; });
    if (archivos.length > libres) toastEn(device, 'Solo puedes subir hasta 5 fotos.');
  }

  function elegirDesdeHoja(origen, device, tipo){
    if (tipo === 'publicacion') {
      elegirArchivos(origen, origen === 'gallery', function(fs){ agregarFotos(device, fs); });
      return;
    }
    elegirArchivos(origen, false, function(fs){
      var editor = document.querySelector('[data-crop]');
      if (!fs.length || !editor || !editor._cropCargar) return;
      editor._cropCargar(fs[0]);
      editor.closest('.phone-block').scrollIntoView({behavior:'smooth', block:'center'});
    });
  }

  // Las hojas que abre un toque se quitan al cerrar o al elegir origen.
  function cablearHoja(hoja, device, tipo){
    hoja.addEventListener('click', function(e){
      if (e.target === hoja || e.target.closest('.sheet-close, .sheet-cancel')) { hoja.remove(); return; }
      var fila = e.target.closest('[data-source]');
      if (!fila) return;
      hoja.remove();
      elegirDesdeHoja(fila.getAttribute('data-source'), device, tipo);
    });
  }

  // Las hojas fijas de los frames nuevos documentan un estado: no se cierran,
  // pero sus dos filas sí abren la cámara o la galería.
  [[tplPublicacion, 'publicacion'], [tplAvatar, 'avatar']].forEach(function(par){
    if (!par[0]) return;
    var device = par[0].closest('.device');
    par[0].addEventListener('click', function(e){
      var fila = e.target.closest('[data-source]');
      if (fila) elegirDesdeHoja(fila.getAttribute('data-source'), device, par[1]);
    });
  });

  // "+ Agregar" de Publicar/Editar y el círculo de Editar perfil abren su hoja.
  document.addEventListener('click', function(e){
    var add = e.target.closest('.photo-add:not(.is-busy)');
    var circulo = e.target.closest('.photo-upload-circle');
    var tpl = add ? tplPublicacion : (circulo ? tplAvatar : null);
    if (!tpl) return;
    var device = (add || circulo).closest('.device');
    if (device.querySelector('[data-source-sheet]')) return;
    var hoja = tpl.cloneNode(true);
    hoja.removeAttribute('data-source-sheet');
    hoja.setAttribute('data-source-sheet-copy', '');
    if (add) {
      var fila = device.querySelector('.photo-row');
      var libres = 5 - (fila ? fila.querySelectorAll('.photo-thumb').length : 0);
      var sub = hoja.querySelector('.status-row-sub');
      if (sub) sub.textContent = 'Puedes elegir hasta ' + libres + ' más';
      var nota = hoja.querySelector('.sheet-note');
      if (nota) nota.textContent = 'Llevas ' + (5 - libres) + ' de 5 fotos. JPG o PNG; las convertimos antes de subirlas.';
    }
    device.appendChild(hoja);
    cablearHoja(hoja, device, add ? 'publicacion' : 'avatar');
  });

  // ── Editor de foto de perfil: mover, zoom y recorte circular ──
  document.querySelectorAll('[data-crop]').forEach(function(stage){
    var device = stage.closest('.device');
    var capa = stage.querySelector('.crop-layer');
    var st = {s:1, x:0, y:0};
    var previews = device.querySelectorAll('.crop-preview');
    var original = capa.innerHTML;

    function medidas(){
      var W = stage.clientWidth;
      return {W:W, D:W * 0.8, H:W * 1.25};
    }
    function limitar(){
      var m = medidas();
      st.s = Math.max(1, Math.min(MAX_ZOOM, st.s));
      var mx = (m.W * st.s - m.D) / 2, my = (m.H * st.s - m.D) / 2;
      st.x = Math.max(-mx, Math.min(mx, st.x));
      st.y = Math.max(-my, Math.min(my, st.y));
    }
    function pintar(){
      limitar();
      var t = 'translate(' + st.x + 'px,' + st.y + 'px) scale(' + st.s + ')';
      var m = medidas();
      capa.querySelector('.crop-img').style.transform = t;
      previews.forEach(function(p){
        var d = +p.getAttribute('data-d');
        p.style.width = d + 'px'; p.style.height = d + 'px';
        var inner = p.querySelector('.crop-preview-inner');
        if (!inner) { inner = document.createElement('div'); inner.className = 'crop-preview-inner'; p.appendChild(inner); }
        if (inner._fuente !== capa.innerHTML.length + ':' + capa._version) {
          inner.innerHTML = capa.innerHTML;
          inner._fuente = capa.innerHTML.length + ':' + capa._version;
        }
        inner.style.width = m.W + 'px'; inner.style.height = m.W + 'px';
        var k = d / m.D, off = -(m.W - m.D) / 2;
        inner.style.transform = 'scale(' + k + ') translate(' + off + 'px,' + off + 'px)';
        var img = inner.querySelector('.crop-img');
        if (img) img.style.transform = t;
      });
    }
    stage._cropUpdate = pintar;
    capa._version = 0;
    stage._cropCargar = function(file){
      capa.innerHTML = '<img class="crop-img" alt="">';
      capa.querySelector('img').src = URL.createObjectURL(file);
      capa._version++;
      st = {s:1, x:0, y:0};
      pintar();
    };

    var punteros = new Map(), ini = null;
    function dist(){ var p = Array.from(punteros.values()); return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }
    stage.addEventListener('pointerdown', function(e){
      punteros.set(e.pointerId, {x:e.clientX, y:e.clientY});
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      stage.classList.add('is-dragging');
      ini = punteros.size === 2 ? {modo:'pellizco', d:dist(), s:st.s} : {modo:'mover', px:e.clientX, py:e.clientY, x:st.x, y:st.y};
    });
    stage.addEventListener('pointermove', function(e){
      if (!punteros.has(e.pointerId) || !ini) return;
      punteros.set(e.pointerId, {x:e.clientX, y:e.clientY});
      if (ini.modo === 'pellizco' && punteros.size === 2) st.s = ini.s * dist() / ini.d;
      else if (ini.modo === 'mover') { st.x = ini.x + e.clientX - ini.px; st.y = ini.y + e.clientY - ini.py; }
      pintar();
      e.preventDefault();
    });
    function soltar(e){
      punteros.delete(e.pointerId);
      if (punteros.size === 1) { var p = Array.from(punteros.values())[0]; ini = {modo:'mover', px:p.x, py:p.y, x:st.x, y:st.y}; }
      else if (!punteros.size) { ini = null; stage.classList.remove('is-dragging'); }
    }
    stage.addEventListener('pointerup', soltar);
    stage.addEventListener('pointercancel', soltar);
    stage.addEventListener('wheel', function(e){
      if (!e.ctrlKey) return;
      e.preventDefault();
      st.s = st.s * Math.exp(-e.deltaY / 300);
      pintar();
    }, {passive:false});

    var pick = device.querySelector('.crop-pick input');
    if (pick) pick.addEventListener('change', function(){ if (pick.files && pick.files[0]) stage._cropCargar(pick.files[0]); pick.value = ''; });
    device.querySelectorAll('[data-crop-confirm]').forEach(function(b){
      b.addEventListener('click', function(){ toastEn(device, 'Foto de perfil actualizada.'); });
    });
    device.querySelector('[data-crop-cancel]').addEventListener('click', function(){
      capa.innerHTML = original; capa._version++;
      st = {s:1, x:0, y:0}; pintar();
    });

    st = {s:1.15, x:0, y:6};
    requestAnimationFrame(pintar);
  });
`;
html = rep(html, '\n</script>', JS + '</script>', 1);

// ── 11. Comprobaciones del build ───────────────────────────────────────────
const labels = (s) => [...s.matchAll(/<div class="phone-label">([^<]*)<\/div>/g)].map((m) => m[1]);
const orig = labels(readFileSync(SRC, 'utf8')).map((l) => l.replace(/\bRelevo\b/g, 'RLVO'));
const nuevos = labels(html);
const faltan = orig.filter((l) => !nuevos.includes(l));
if (faltan.length) throw new Error('[build] faltan frames: ' + faltan.join(', '));
const agregados = nuevos.filter((l) => !orig.includes(l));
if (agregados.length !== 7) throw new Error('[build] se esperaban 7 frames nuevos y hay ' + agregados.length);
const bloques = count(html, /<div class="phone-block[^"]*" data-cat="[a-z]+"/g);
if (bloques !== orig.length + 7) throw new Error(`[build] phone-block: ${bloques}`);

writeFileSync(OUT, html);
console.log(`[build] ${OUT.replace(repoDir + '/', '')}: ${bloques} frames (${orig.length} originales + ${agregados.length} nuevos)`);
agregados.forEach((l) => console.log('  + ' + l));
