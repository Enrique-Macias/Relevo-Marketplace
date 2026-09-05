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
 */
export const Typography = {
  // Fraunces — display: wordmark, precios, headlines de onboarding/auth
  splash: { fontFamily: Fonts.display, fontSize: 26, fontWeight: FontWeights.semibold }, // .splash-word
  heroHeadline: {
    fontFamily: Fonts.display,
    fontSize: 24,
    fontWeight: FontWeights.medium,
    lineHeight: 1.15,
  }, // .hero-headline
  wordmark: { fontFamily: Fonts.display, fontSize: 24, fontWeight: FontWeights.semibold }, // .wordmark
  headline: { fontFamily: Fonts.display, fontSize: 22, fontWeight: FontWeights.medium }, // .auth-headline, .onboard-headline
  otp: { fontFamily: Fonts.display, fontSize: 20, fontWeight: FontWeights.semibold }, // .otp-box
  priceLarge: { fontFamily: Fonts.display, fontSize: 28, fontWeight: FontWeights.semibold }, // .detail-price
  price: { fontFamily: Fonts.display, fontSize: 19, fontWeight: FontWeights.semibold }, // .price (card), .stat-num
  emptyTitle: { fontFamily: Fonts.display, fontSize: 19, fontWeight: FontWeights.medium }, // .empty-title
  modalTitle: { fontFamily: Fonts.display, fontSize: 17, fontWeight: FontWeights.medium }, // .modal-title

  // Inter — body: todo lo demás
  pageHeading: { fontFamily: Fonts.body, fontSize: 19, fontWeight: FontWeights.semibold }, // .page-heading
  profileName: { fontFamily: Fonts.body, fontSize: 17, fontWeight: FontWeights.semibold }, // .profile-name
  sheetTitle: { fontFamily: Fonts.body, fontSize: 16, fontWeight: FontWeights.semibold }, // .sheet-title
  detailTitle: { fontFamily: Fonts.body, fontSize: 16, fontWeight: FontWeights.semibold }, // .detail-title
  sectionTitle: { fontFamily: Fonts.body, fontSize: 15, fontWeight: FontWeights.semibold }, // .section-title, .form-title
  buttonPrimary: { fontFamily: Fonts.body, fontSize: 14.5, fontWeight: FontWeights.semibold }, // .primary-btn
  buttonWhatsapp: { fontFamily: Fonts.body, fontSize: 14, fontWeight: FontWeights.semibold }, // .whatsapp-btn
  input: { fontFamily: Fonts.body, fontSize: 14, fontWeight: FontWeights.regular }, // .text-field, .textarea-field, .select-field
  emphasis: { fontFamily: Fonts.body, fontSize: 13.5, fontWeight: FontWeights.semibold }, // .detail-section-title, .seller-name, .ghost-btn, .list-row-name
  rowLabel: { fontFamily: Fonts.body, fontSize: 13.5, fontWeight: FontWeights.medium }, // .menu-label, .status-row-text, .radio-label
  paragraph: {
    fontFamily: Fonts.body,
    fontSize: 13.5,
    fontWeight: FontWeights.regular,
    lineHeight: 1.6,
  }, // .detail-desc, .onboard-sub
  bodyStrong: { fontFamily: Fonts.body, fontSize: 13, fontWeight: FontWeights.medium }, // .title (card), .chip, .toast-text
  auth: {
    fontFamily: Fonts.body,
    fontSize: 13,
    fontWeight: FontWeights.regular,
    lineHeight: 1.55,
  }, // .auth-sub, .empty-sub
  label: { fontFamily: Fonts.body, fontSize: 12.5, fontWeight: FontWeights.semibold }, // .field-label, .section-link, .notif-title
  labelMuted: { fontFamily: Fonts.body, fontSize: 12.5, fontWeight: FontWeights.medium }, // .segment
  meta: { fontFamily: Fonts.body, fontSize: 12.5, fontWeight: FontWeights.regular }, // .results-count, .detail-meta, .auth-link, .splash-tag
  caption: { fontFamily: Fonts.body, fontSize: 11, fontWeight: FontWeights.semibold }, // .cat-label, .hero-eyebrow
  metaLight: { fontFamily: Fonts.body, fontSize: 11, fontWeight: FontWeights.regular }, // .meta (product card)
  heroStat: { fontFamily: Fonts.body, fontSize: 11.5, fontWeight: FontWeights.medium }, // .hero-stat (chip del hero del Feed)
  tabLabel: { fontFamily: Fonts.body, fontSize: 10, fontWeight: FontWeights.medium }, // .tab
} as const;
