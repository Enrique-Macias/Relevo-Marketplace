/**
 * Tokens de diseño de Relevo, extraídos directamente del CSS de
 * `/design/relevo-app.html` (fuente de verdad — ver CLAUDE.md §0 y §2).
 * No hay valores inventados aquí: todo lo que aparece abajo se repite en el
 * prototipo. El prototipo define una sola paleta (no hay variante dark).
 */

export const Colors = {
  ink: '#221F1C',
  inkSoft: '#6B6660',
  paper: '#F3F0EA',
  card: '#FFFFFF',
  line: 'rgba(34,31,28,0.10)',
  brick: '#C1440E',
  brickDark: '#87300A', // color-mix(in srgb, brick 70%, black)
  brickTint: '#F6E3DB', // color-mix(in srgb, brick 15%, white)
  forest: '#2F6B4F',
  forestTint: '#E0E9E5', // color-mix(in srgb, forest 15%, white)
  gold: '#D9A441',
  goldTint: '#F7ECD6', // literal en el CSS
  slate: '#5B6B78',
  slateTint: '#E3E9EC', // literal en el CSS
  // Gris de placeholder. No es una variable :root del prototipo — está escrito
  // a mano en cada regla que lo usa (.text-field::placeholder, .search-field
  // input::placeholder, el span vacío de .select-field, y .auth-terms).
  placeholder: '#A8A29A',
  // Paper con alfa sobre el gradiente del splash (.splash-tag, .splash-dot).
  paper65: 'rgba(243,240,234,0.65)',
  paper50: 'rgba(243,240,234,0.5)',
} as const;

export const Fonts = {
  display: 'Fraunces', // wordmark, precios, headlines de onboarding/auth — nunca UI genérica
  body: 'Inter', // todo lo demás
} as const;

// Casi todo el texto con énfasis explícito en el CSS usa 500 (medium) o 600
// (semibold) — pero varios elementos (inputs, párrafos, meta secundaria) no
// declaran font-weight en absoluto, y caen al regular (400) por defecto.
export const FontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
} as const;

/**
 * En CSS una familia y un peso son dos ejes independientes: `font-family:Inter`
 * + `font-weight:600` resuelve solo. React Native no funciona así — cada cara
 * se registra por separado en `useFonts()` de `src/app/_layout.tsx`, y la clave
 * que se le pasa ahí ES el nombre de familia que RN conoce. Pedir
 * `fontFamily:'Inter'` con `fontWeight:'600'` no matchea ninguna cara
 * registrada: el texto cae silenciosamente al font del sistema.
 *
 * Por eso los roles de abajo emiten el nombre de la cara ya resuelto
 * (`Inter_600SemiBold`) y NO llevan `fontWeight` — en Android un peso encima de
 * una cara que ya es semibold provoca bold sintético. `Fonts` y `FontWeights`
 * siguen siendo los tokens documentales; este helper es el único puente.
 */
const FACE_SUFFIX = {
  [FontWeights.regular]: 'Regular',
  [FontWeights.medium]: 'Medium',
  [FontWeights.semibold]: 'SemiBold',
} as const;

type Weight = (typeof FontWeights)[keyof typeof FontWeights];

const face = (family: (typeof Fonts)[keyof typeof Fonts], weight: Weight) =>
  `${family}_${weight}${FACE_SUFFIX[weight]}` as const;

// Radios reales observados en el CSS (agrupados por los valores que de verdad se repiten)
export const Radii = {
  sm: 8, // inputs pequeños / iconos de estado
  md: 12,
  lg: 14, // el más común: botones, inputs, chips
  xl: 16, // tarjetas de producto, category items
  xxl: 20, // hero, sheets, modal card
  full: 9999,
} as const;

// Único valor de spacing verdaderamente sistémico en el prototipo: el gutter
// horizontal de pantalla (padding/margin: * 20px) se repite en casi todas
// las pantallas. El resto del spacing es ad-hoc por componente y se lee
// directo del HTML pantalla por pantalla (ver CLAUDE.md §6).
export const ScreenPadding = 20;

/**
 * Tipografía real por rol. El prototipo no usa una escala tipográfica limpia
 * (hay pasos de 0.5px por componente), así que en vez de redondear/inventar,
 * cada rol toma el tamaño/peso/line-height exacto de la(s) clase(s) CSS que
 * lo usan — roles con el mismo valor numérico se dejan separados cuando el
 * prototipo los trata como cosas semánticamente distintas.
 *
 * Ojo con `lineHeight`: en CSS los valores del prototipo son multiplicadores
 * sin unidad (`line-height:1.6`), pero React Native lo interpreta en puntos
 * absolutos. Aquí ya van multiplicados por su fontSize — el ratio original
 * queda anotado al lado para poder rastrearlo al CSS.
 */
export const Typography = {
  // Fraunces — display: wordmark, precios, headlines de onboarding/auth
  splash: { fontFamily: face(Fonts.display, FontWeights.semibold), fontSize: 26 }, // .splash-word
  heroHeadline: {
    fontFamily: face(Fonts.display, FontWeights.medium),
    fontSize: 24,
    lineHeight: 27.6, // 24 × 1.15
  }, // .hero-headline
  wordmark: { fontFamily: face(Fonts.display, FontWeights.semibold), fontSize: 24 }, // .wordmark
  headline: { fontFamily: face(Fonts.display, FontWeights.medium), fontSize: 22 }, // .auth-headline, .onboard-headline
  logoMark: { fontFamily: face(Fonts.display, FontWeights.semibold), fontSize: 22 }, // .auth-logo span
  otp: { fontFamily: face(Fonts.display, FontWeights.semibold), fontSize: 20 }, // .otp-box
  priceLarge: { fontFamily: face(Fonts.display, FontWeights.semibold), fontSize: 28 }, // .detail-price, .splash-logo span
  price: { fontFamily: face(Fonts.display, FontWeights.semibold), fontSize: 19 }, // .price (card), .stat-num
  emptyTitle: { fontFamily: face(Fonts.display, FontWeights.medium), fontSize: 19 }, // .empty-title
  modalTitle: { fontFamily: face(Fonts.display, FontWeights.medium), fontSize: 17 }, // .modal-title

  // Inter — body: todo lo demás
  pageHeading: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 19 }, // .page-heading
  profileName: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 17 }, // .profile-name
  sheetTitle: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 16 }, // .sheet-title
  detailTitle: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 16 }, // .detail-title
  sectionTitle: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 15 }, // .section-title, .form-title
  buttonPrimary: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 14.5 }, // .primary-btn
  buttonWhatsapp: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 14 }, // .whatsapp-btn
  input: { fontFamily: face(Fonts.body, FontWeights.regular), fontSize: 14 }, // .text-field, .textarea-field, .select-field
  emphasis: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 13.5 }, // .detail-section-title, .seller-name, .ghost-btn, .list-row-name
  rowLabel: { fontFamily: face(Fonts.body, FontWeights.medium), fontSize: 13.5 }, // .menu-label, .status-row-text, .radio-label
  paragraph: {
    fontFamily: face(Fonts.body, FontWeights.regular),
    fontSize: 13.5,
    lineHeight: 21.6, // 13.5 × 1.6
  }, // .detail-desc, .onboard-sub
  bodyStrong: { fontFamily: face(Fonts.body, FontWeights.medium), fontSize: 13 }, // .title (card), .chip, .toast-text
  auth: {
    fontFamily: face(Fonts.body, FontWeights.regular),
    fontSize: 13,
    lineHeight: 20.15, // 13 × 1.55
  }, // .auth-sub, .empty-sub
  label: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 12.5 }, // .field-label, .section-link, .notif-title, .onboard-skip
  labelMuted: { fontFamily: face(Fonts.body, FontWeights.medium), fontSize: 12.5 }, // .segment
  meta: { fontFamily: face(Fonts.body, FontWeights.regular), fontSize: 12.5 }, // .results-count, .detail-meta, .auth-link, .splash-tag
  rowSub: { fontFamily: face(Fonts.body, FontWeights.regular), fontSize: 11.5 }, // .list-row-sub, .buyer-time
  heroStat: { fontFamily: face(Fonts.body, FontWeights.medium), fontSize: 11.5 }, // .hero-stat (chip del hero del Feed)
  caption: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 11 }, // .cat-label, .hero-eyebrow
  metaLight: { fontFamily: face(Fonts.body, FontWeights.regular), fontSize: 11 }, // .meta (product card)
  terms: {
    fontFamily: face(Fonts.body, FontWeights.regular),
    fontSize: 11,
    lineHeight: 16.5, // 11 × 1.5
  }, // .auth-terms
  tabLabel: { fontFamily: face(Fonts.body, FontWeights.medium), fontSize: 10 }, // .tab
} as const;
