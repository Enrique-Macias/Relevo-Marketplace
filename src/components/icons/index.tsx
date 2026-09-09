/**
 * Iconos transcritos literalmente de los `<svg>` inline de
 * `design/relevo-app.html` (originalmente solo Onboarding, ahora también
 * Sistema). Cada `d`, `cx`, `r` y `stroke-width` de abajo está copiado del
 * frame correspondiente — si alguno hay que cambiarlo, se cambia primero en
 * el prototipo (CLAUDE.md §0, regla 3).
 *
 * Todos comparten `viewBox="0 0 24 24"` y `fill="none"`: son iconos de trazo,
 * el color entra por `stroke`. El tamaño (`size`) es el `width`/`height` que el
 * frame le da a cada uso, no una escala propia.
 */

import { Circle, Path, Rect, Svg } from 'react-native-svg';

import { Colors } from '@/constants/theme';

type IconProps = {
  size: number;
  color: string;
};

// Onboarding 1/3 — "Compra y vende con tu comunidad"
export function IconUsers({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.4}>
      <Circle cx={9} cy={8} r={3} />
      <Path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <Circle cx={18} cy={9} r={2.4} />
      <Path d="M15.5 20a4.5 4.5 0 018 0" />
    </Svg>
  );
}

// Onboarding 2/3 — "Verificado, cero desconocidos"
export function IconCheckCircle({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.4}>
      <Path d="M9 12l2 2 4-4" />
      <Circle cx={12} cy={12} r={9} />
    </Svg>
  );
}

// Onboarding 3/3 — "Todo cerca, todo fácil"
export function IconPin({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.4}>
      <Path d="M12 21s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z" />
      <Circle cx={12} cy={9} r={2.3} />
    </Svg>
  );
}

// Pin de ubicación SIN el círculo interior (`.meta` de tarjeta de producto y
// `.detail-meta` de Detalle) — distinto de `IconPin`, que sí lo lleva
// (Onboarding 3/3). El propio HTML usa dos SVG distintos para esto.
export function IconMapPin({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.5}>
      <Path d="M12 21s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z" />
    </Svg>
  );
}

// Completar perfil — dentro del círculo punteado de foto
export function IconCamera({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8}>
      <Circle cx={12} cy={13} r={4} />
      <Path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
    </Svg>
  );
}

// Completar perfil — dentro del badge `brick` de la esquina del círculo
export function IconPlus({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.4}
      strokeLinecap="round"
    >
      <Path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

// Chevron de regreso del `.form-header` (selectores de universidad y campus)
export function IconChevronLeft({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M15 18l-6-6 6-6" />
    </Svg>
  );
}

// X de cerrar del `.sheet-header` (Filtros, Reportar publicación, Selector de
// campus, y ahora el bottom sheet de campus de Completar perfil)
export function IconClose({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
    >
      <Path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

// Chevron de los `.select-field` (Universidad / Campus)
export function IconChevronDown({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M6 9l6 6 6-6" />
    </Svg>
  );
}

// Lupa del `.search-field`. En el prototipo su stroke es el gris de placeholder
// escrito a mano (#A8A29A), no `--ink-soft` — de ahí el default.
export function IconSearch({ size, color = Colors.placeholder }: Partial<IconProps> & { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Circle cx={11} cy={11} r={7} />
      <Path d="M21 21l-4.3-4.3" />
    </Svg>
  );
}

// Permiso de notificaciones — campana dentro del círculo `brick-tint`
export function IconBell({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <Path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <Path d="M13.7 21a2 2 0 01-3.4 0" />
    </Svg>
  );
}

// "Confirmar cerrar sesión" (sistema) — el ícono dentro de `.modal-icon`
export function IconLogout({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
    </Svg>
  );
}

// Flecha de `.section-link` ("Ver todas"/"Ver todo" en Feed)
export function IconArrowRight({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.4}>
      <Path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

// Sliders del `.filter-btn` (Feed/Búsqueda) y el botón redondo de filtro en Categoría
export function IconFilterSliders({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
      <Path d="M4 6h16M7 12h10M10 18h4" />
    </Svg>
  );
}

// Corazón de favorito (`.heart`, `.fav-btn`). El HTML ya trae ambos estados
// (contorno y relleno) — `filled` alterna entre ellos, mismo `d` en los dos.
export function IconHeart({ size, color, filled }: IconProps & { filled?: boolean }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : 'none'}
      stroke={color}
      strokeWidth={2}
    >
      <Path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z" />
    </Svg>
  );
}

// Compartir, en `.detail-nav` de Detalle de publicación
export function IconShare({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Circle cx={18} cy={5} r={2.6} />
      <Circle cx={6} cy={12} r={2.6} />
      <Circle cx={18} cy={19} r={2.6} />
      <Path d="M8.4 10.6l7.2-4.2M8.4 13.4l7.2 4.2" />
    </Svg>
  );
}

// Reportar — solo en la vista comprador de Detalle (la vendedora usa `IconKebab`)
export function IconFlag({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M5 21V4" />
      <Path d="M5 4h13l-3.5 5L18 14H5" />
    </Svg>
  );
}

// Menú de "más opciones" — solo en la vista vendedora de Detalle. Relleno
// sólido, sin trazo — distinto de `IconDots3` (el trío de "más categorías"),
// que es puro trazo aunque visualmente sea parecido.
export function IconKebab({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Circle cx={12} cy={5} r={2} />
      <Circle cx={12} cy={12} r={2} />
      <Circle cx={12} cy={19} r={2} />
    </Svg>
  );
}

// Crosshair de "Detectar campus más cercano" (Selector de campus)
export function IconLocationCrosshair({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Circle cx={12} cy={12} r={3} />
      <Path d="M12 2v3M12 19v3M22 12h-3M5 12H2" />
    </Svg>
  );
}

// Birrete del `.campus-chip` en el header del Feed
export function IconCampusFlag({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8}>
      <Path d="M12 3L2 8l10 5 10-5-10-5z" />
      <Path d="M6 10.5V15c0 1 2.5 2.5 6 2.5s6-1.5 6-2.5v-4.5" />
    </Svg>
  );
}

// Tick del `.verified-tick` — el círculo `forest` es un `View`, esto es solo el check
export function IconCheck({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M5 13l4 4L19 7" />
    </Svg>
  );
}

// `.whatsapp-btn` de Detalle de publicación
export function IconWhatsapp({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M21 11.5a8.5 8.5 0 01-12.4 7.5L4 20l1.1-4.4A8.5 8.5 0 1121 11.5z" />
      <Path d="M8.5 10.5c0 3 2.5 5.5 5.5 5.5" />
    </Svg>
  );
}

// `.seller-chevron` de la fila de vendedor en Detalle de publicación
export function IconChevronRight({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M9 6l6 6-6 6" />
    </Svg>
  );
}

// Trío de "más categorías" (tile "Más" del Feed, categoría "Otros"). Solo
// trazo, sin relleno — así está en el HTML aunque visualmente sea un aro
// fino, no un punto sólido. Distinto de `IconKebab`.
export function IconDots3({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.6}>
      <Circle cx={5} cy={12} r={1.6} />
      <Circle cx={12} cy={12} r={1.6} />
      <Circle cx={19} cy={12} r={1.6} />
    </Svg>
  );
}

// Frame "Error de conexión" (grupo sistema) — `.empty-icon.error-icon`.
// stroke-width 1.8 y solo stroke-linecap="round" (sin linejoin), tal cual el HTML.
export function IconAlertCircle({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <Path d="M12 9v4" />
      <Path d="M12 17h.01" />
      <Circle cx={12} cy={12} r={9} />
    </Svg>
  );
}

// Frame "Toast de error" — va dentro del círculo de `.toast-icon.is-error`, así
// que no lleva el círculo propio: el fondo del contenedor ya lo es. Mismo
// stroke-width 3 que la palomita del toast de éxito.
export function IconExclamation({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M12 8v5M12 17h.01" />
    </Svg>
  );
}

// `.status-row-icon` de "Pausar publicación" (frame "Editar publicación"):
// dos barras redondeadas. Es rect+rect en el HTML, no un path.
export function IconPause({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8}>
      <Rect x={6} y={4} width={4} height={16} rx={1} />
      <Rect x={14} y={4} width={4} height={16} rx={1} />
    </Svg>
  );
}

// Etiqueta de precio — el `.menu-icon` de "Mis publicaciones" en el frame
// Perfil. El punto del agujero va como `Path` de un solo trazo con
// strokeLinecap="round", no como `Circle`: es como lo dibuja el HTML.
export function IconTag({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7.2-7.2a2 2 0 01-.6-1.4V4a1 1 0 011-1h8a2 2 0 011.4.6l7.4 7.4a2 2 0 010 2.8z" />
      <Path d="M7.5 7.5h.01" />
    </Svg>
  );
}

// Lápiz de "Editar" — el `.menu-icon` de "Editar perfil" en el frame Perfil y
// el `.status-row-icon` de "Editar publicación" en la hoja de acciones.
export function IconPencil({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
    </Svg>
  );
}

// `.status-row-icon` de "Reactivar publicación" (hoja de acciones de "Mis
// publicaciones"): el reverso de `IconPause`, mismo peso de trazo y misma caja.
export function IconPlay({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinejoin="round"
    >
      <Path d="M7 4l12 8-12 8V4z" />
    </Svg>
  );
}

// `.status-row-icon` de "Eliminar publicación", y el mismo bote va en el
// `.modal-icon` de "Confirmar eliminar".
export function IconTrash({ size, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" />
    </Svg>
  );
}
