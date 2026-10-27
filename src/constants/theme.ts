/**
 * Tokens de diseño de RLVO, extraídos directamente del CSS de
 * `/design/relevo-app.html` (fuente de verdad — ver CLAUDE.md §0 y §2).
 * No hay valores inventados aquí: todo lo que aparece abajo se repite en el
 * prototipo. El prototipo define una sola paleta (no hay variante dark).
 *
 * Paleta 06 (DESIGN-1, aprobada el 2026-10-25). Los nombres `brick`/`forest`/
 * `gold`/`slate` se conservan de la paleta anterior para no tocar cada estilo;
 * su VALOR cambió. Lo que es error o destructivo usa `danger`, NO `brick`: con
 * un primario verde, un error en `brick` se leería como acción.
 */

export const Colors = {
  // Paleta base (--mint-*). `mint400` es solo relleno/indicador, nunca texto
  // sobre fondo claro (1.88:1).
  mint900: '#183D39',
  mint700: '#23635C',
  mint400: '#78CDB5',
  mint100: '#DDF5ED',
  mint50: '#F5FAF8',

  ink: '#183D39', // --ink = --mint-900
  inkSoft: '#4F6B67', // derivado neutro: 5.5:1 sobre --paper
  paper: '#F5FAF8', // --paper = --mint-50
  card: '#FFFFFF',
  surfaceMuted: '#EAF8F3', // color-mix(in srgb, mint-100 45%, mint-50)
  line: 'rgba(24,61,57,0.12)',
  brick: '#23635C', // primario / CTA (= --mint-700)
  brickDark: '#183D39', // --brick-dark = --mint-900 (pressed, gradiente)
  brickTint: '#DDF5ED', // --brick-tint = --mint-100
  forest: '#23635C', // confianza / verificado: hoy mismo valor que el primario
  forestTint: '#DDF5ED',
  accent: '#78CDB5', // --accent = --mint-400
  gold: '#23635C', // --gold = --mint-700 (acento de categoría)
  goldTint: '#CCECE3', // color-mix(in srgb, mint-400 38%, white)
  slate: '#4F6B67', // --slate = --ink-soft
  slateTint: '#EAF8F3', // --slate-tint = --surface-muted
  // Excepción funcional fuera de la paleta: errores y acciones destructivas.
  danger: '#B42332',
  dangerBg: '#FCEBED',
  // --ink-muted: placeholders e ícono de lupa (3.35:1, no es texto de contenido).
  placeholder: '#7B918D',
  // Fondo del visor de fotos (.photo-viewer) y su capa translúcida.
  viewer: '#0E2321',
  viewer45: 'rgba(14,35,33,0.45)',
  // Telón de los modales y hojas: --ink al 55 %.
  backdrop: 'rgba(24,61,57,0.55)',
  // Paper al 50 %: `.splash-dot` sobre el primario (botón ocupado, scrims).
  paper50: 'rgba(245,250,248,0.5)',
  // "Editor de foto de perfil" (`.crop-*`, DESIGN-1 fase 5), sobre --mint-900.
  cropMascara: 'rgba(14,35,33,0.62)', // .crop-mask box-shadow (lo de fuera del círculo)
  cropAro: 'rgba(245,250,248,0.9)', // .crop-mask outline
  cropEnlace: 'rgba(245,250,248,0.82)', // .crop-link
  cropPista: 'rgba(245,250,248,0.78)', // .crop-hint
  cropBorde: 'rgba(245,250,248,0.35)', // .crop-actions .ghost-btn border-color
  cropAroPrevia: 'rgba(245,250,248,0.18)', // .crop-preview box-shadow
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
  profileWordmark: { fontFamily: face(Fonts.display, FontWeights.semibold), fontSize: 20 }, // .wordmark con el override inline `font-size:20px` del frame "Perfil" — mismo valor numérico que `otp` (display/600/20), pero rol distinto: son clases CSS distintas (`.wordmark` vs `.otp-box`) que podrían escalar por separado.
  headline: { fontFamily: face(Fonts.display, FontWeights.medium), fontSize: 22 }, // .auth-headline, .onboard-headline
  logoMark: { fontFamily: face(Fonts.display, FontWeights.semibold), fontSize: 22 }, // .auth-logo span
  rateAvatarInitials: { fontFamily: face(Fonts.display, FontWeights.semibold), fontSize: 22 }, // .rate-avatar (Calificar) — MISMOS valores que `logoMark`, pero otro rol: aquel es el cuadro de la "R" en auth. Si el avatar de Calificar cambia de escala, se cambia aquí y no allá.
  profileAvatarInitials: { fontFamily: face(Fonts.display, FontWeights.semibold), fontSize: 24 }, // .profile-avatar (Perfil público) — CERCANO a `rateAvatarInitials`/`logoMark` (22px) pero un rol distinto: 24px, no 22. Es un cuarto valor fácil de confundir con ese par — ver CLAUDE.md §2.
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
  campusChip: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 14 }, // .campus-chip (Feed) — mismo tamaño/peso que .whatsapp-btn pero es un rol distinto
  avatarInitials: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 13 }, // .avatar (iniciales del header del Feed)
  sellerAvatarInitials: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 14 }, // .seller-avatar (Detalle de publicación)
  editAvatarInitials: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 22 }, // .seller-avatar con el override inline `font-size:22px` del frame "Editar perfil" — el QUINTO vecino del racimo de avatares de CLAUDE.md §2, y el más traicionero: comparte CLASE con `sellerAvatarInitials` (que es 14) y comparte TAMAÑO con `rateAvatarInitials`/`logoMark` (que son 22 pero en fuente DISPLAY). Este es body/22. `profileAvatarInitials` es el otro vecino: display/24.
  reviewAvatarInitials: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 10 }, // .review-avatar (Perfil público)
  input: { fontFamily: face(Fonts.body, FontWeights.regular), fontSize: 14 }, // .text-field, .textarea-field, .select-field
  emphasis: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 13.5 }, // .detail-section-title, .seller-name, .ghost-btn, .list-row-name
  rowLabel: { fontFamily: face(Fonts.body, FontWeights.medium), fontSize: 13.5 }, // .menu-label, .status-row-text, .radio-label
  paragraph: {
    fontFamily: face(Fonts.body, FontWeights.regular),
    fontSize: 13.5,
    lineHeight: 21.6, // 13.5 × 1.6
  }, // .detail-desc, .onboard-sub
  bodyStrong: { fontFamily: face(Fonts.body, FontWeights.medium), fontSize: 13 }, // .title (card), .chip, .toast-text
  cardBadge: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 10.5 }, // .thumb .badge (overlay en la tarjeta de producto — no confundir con .detail-badge, que ya matchea `caption`)
  notifTime: { fontFamily: face(Fonts.body, FontWeights.regular), fontSize: 10.5 }, // .notif-time — mismo tamaño que `cardBadge` pero regular, no semibold
  activeChip: { fontFamily: face(Fonts.body, FontWeights.medium), fontSize: 12 }, // .active-chip
  notifDesc: {
    fontFamily: face(Fonts.body, FontWeights.regular),
    fontSize: 12,
    lineHeight: 16.8, // 12 × 1.4
  }, // .notif-desc — mismo tamaño que `activeChip`, pero regular y con line-height propio
  auth: {
    fontFamily: face(Fonts.body, FontWeights.regular),
    fontSize: 13,
    lineHeight: 20.15, // 13 × 1.55
  }, // .auth-sub, .empty-sub
  label: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 12.5 }, // .field-label, .section-link, .notif-title, .onboard-skip
  reviewName: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 12.5 }, // .review-name (Perfil público) — mismo tamaño/peso que `label`, rol distinto a propósito (mismo criterio que `campusChip` frente a `buttonWhatsapp`)
  labelMuted: { fontFamily: face(Fonts.body, FontWeights.medium), fontSize: 12.5 }, // .segment
  meta: { fontFamily: face(Fonts.body, FontWeights.regular), fontSize: 12.5 }, // .results-count, .detail-meta, .auth-link, .splash-tag
  modalSub: {
    fontFamily: face(Fonts.body, FontWeights.regular),
    fontSize: 12.5,
    lineHeight: 19.375, // 12.5 × 1.55
  }, // .modal-sub — mismo tamaño que `meta`, pero con line-height propio
  reviewText: {
    fontFamily: face(Fonts.body, FontWeights.regular),
    fontSize: 12.5,
    lineHeight: 18.75, // 12.5 × 1.5
  }, // .review-text (Perfil público) — mismo tamaño que `meta`/`modalSub`, pero su propio line-height (1.5, no 1.55)
  legalCheck: {
    fontFamily: face(Fonts.body, FontWeights.regular),
    fontSize: 12.5,
    lineHeight: 18.75, // 12.5 × 1.5
  }, // .legal-check-text (PL-016) — MISMOS valores que `reviewText`, rol distinto: si la casilla legal cambia de escala, las reseñas no.
  legalVersion: {
    fontFamily: face(Fonts.body, FontWeights.regular),
    fontSize: 11,
    lineHeight: 16.5, // 11 × 1.5
  }, // .legal-version (PL-016) — MISMOS valores que `terms` y `fieldError`, rol distinto
  textButton: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 13.5 }, // .text-btn ("Cerrar sesión", PL-016) — mismo tamaño y peso que `emphasis`, rol distinto
  rowSub: { fontFamily: face(Fonts.body, FontWeights.regular), fontSize: 11.5 }, // .list-row-sub, .buyer-time
  cropHint: { fontFamily: face(Fonts.body, FontWeights.regular), fontSize: 12 }, // .crop-hint — mismo tamaño que `activeChip`, pero regular
  sheetNote: {
    fontFamily: face(Fonts.body, FontWeights.regular),
    fontSize: 11.5,
    lineHeight: 16.675, // 11.5 × 1.45
  }, // .sheet-note (hojas "Agregar fotos"): mismo tamaño que `rowSub`, con line-height propio
  heroStat: { fontFamily: face(Fonts.body, FontWeights.medium), fontSize: 11.5 }, // .hero-stat (chip del hero del Feed)
  caption: { fontFamily: face(Fonts.body, FontWeights.semibold), fontSize: 11 }, // .cat-label, .hero-eyebrow
  metaLight: { fontFamily: face(Fonts.body, FontWeights.regular), fontSize: 11 }, // .meta (product card)
  terms: {
    fontFamily: face(Fonts.body, FontWeights.regular),
    fontSize: 11,
    lineHeight: 16.5, // 11 × 1.5
  }, // .auth-terms
  fieldError: {
    fontFamily: face(Fonts.body, FontWeights.regular),
    fontSize: 11,
    lineHeight: 16.5, // 11 × 1.5
  }, // .field-error — MISMOS valores que `terms`, rol distinto: aquel es letra chica gris de ayuda, este es el error de un campo en --brick. Si uno cambia de escala, el otro no tiene por qué.
  tabLabel: { fontFamily: face(Fonts.body, FontWeights.medium), fontSize: 10 }, // .tab
  statLabel: { fontFamily: face(Fonts.body, FontWeights.regular), fontSize: 10 }, // .stat-label — distinto de `tabLabel`, que es 10/medium
} as const;
