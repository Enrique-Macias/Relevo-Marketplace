/**
 * Iconos del grupo Onboarding, transcritos literalmente de los `<svg>` inline de
 * `design/relevo-app.html`. Cada `d`, `cx`, `r` y `stroke-width` de abajo está
 * copiado del frame correspondiente — si alguno hay que cambiarlo, se cambia
 * primero en el prototipo (CLAUDE.md §0, regla 3).
 *
 * Todos comparten `viewBox="0 0 24 24"` y `fill="none"`: son iconos de trazo,
 * el color entra por `stroke`. El tamaño (`size`) es el `width`/`height` que el
 * frame le da a cada uso, no una escala propia.
 */

import { Circle, Path, Svg } from 'react-native-svg';

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
