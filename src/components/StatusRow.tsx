/**
 * `.status-row` + `.status-row-label` + `.status-row-icon` + `.status-row-text`.
 *
 * Vivía como componente local de `(publicar)/editar/[id].tsx`, que fue quien lo
 * necesitó primero. Se extrajo al agregar "Mis publicaciones": su hoja de
 * acciones es literalmente la misma `.status-section` del frame de Editar
 * —mismo ícono de 34px, mismo label, misma fila danger— movida a un
 * `.sheet-card`. Duplicarlo garantizaba que se desincronizaran.
 *
 * El CONTENEDOR no vive aquí: `.status-section` tiene padding distinto según
 * dónde caiga (100px de fondo en Editar, para despejar el teclado y el borde;
 * 24px en la hoja, que ya termina donde termina la tarjeta).
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '@/constants/theme';

// `.status-row-icon{width:34px}` y `.status-row-label{gap:11px}`. `sub` se alinea
// con el label sumando las dos, así que sigue a estas constantes.
const ICONO_ANCHO = 34;
const LABEL_GAP = 11;

type StatusRowProps = {
  icon: React.ReactNode;
  label: string;
  /** Toggle, chevron, o nada. */
  trailing?: React.ReactNode;
  /** Sin `onPress` la fila queda inerte a propósito (ver "Marcar como vendida"). */
  onPress?: () => void;
  /** `.status-row-text.danger` — el label en `--brick`. */
  danger?: boolean;
  /** `.status-row:last-child{border-bottom:none;}` */
  last?: boolean;
  /**
   * Segunda línea bajo el label (dirección de correo de `HojaSoporte`). Va
   * como `Text selectable` HERMANO del `Pressable`, no hijo: así la pulsación
   * larga que selecciona el texto no compite con el `onPress` de la fila. Queda
   * dentro del mismo borde inferior, pero no es área de toque. Sin `sub`, el
   * render es el de siempre (el `Pressable` es la raíz y lleva el borde).
   */
  sub?: string;
};

export function StatusRow({
  icon,
  label,
  trailing,
  onPress,
  danger = false,
  last = false,
  sub,
}: StatusRowProps) {
  const contenido = (
    <>
      <View style={styles.label}>
        {/* .status-row-icon lleva `color:var(--brick)` inline en la fila de
            eliminar; aquí el color va en el ícono, que es quien lo pinta. */}
        <View style={styles.icon}>{icon}</View>
        <Text style={[styles.text, danger && styles.textDanger]}>{label}</Text>
      </View>
      {trailing}
    </>
  );

  if (!sub) {
    return (
      <Pressable
        style={[styles.row, last && styles.rowLast]}
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole="button"
      >
        {contenido}
      </Pressable>
    );
  }

  return (
    <View style={[styles.wrap, last && styles.rowLast]}>
      <Pressable
        style={styles.rowConSub}
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole="button"
      >
        {contenido}
      </Pressable>
      <Text selectable style={styles.sub}>
        {sub}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // .status-row{padding:14px 0; border-bottom:1px solid var(--line);}
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  // Con `sub`: el borde lo lleva la View raíz y la fila solo el padding de arriba.
  wrap: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  rowConSub: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 13,
  },
  // .auth-link (12.5px, --ink-soft) con `flex-basis:100%; padding-left:45px;
  // margin-top:2px` en el frame. El padding es ICONO_ANCHO + LABEL_GAP (34 + 11
  // = 45): el frame lo escribe como 45, el código lo deriva.
  sub: {
    ...Typography.meta,
    color: Colors.inkSoft,
    paddingLeft: ICONO_ANCHO + LABEL_GAP,
    marginTop: 2,
    paddingBottom: 13,
  },
  // .status-row:last-child{border-bottom:none;}
  rowLast: {
    borderBottomWidth: 0,
  },
  // .status-row-label{display:flex; align-items:center; gap:11px;}
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: LABEL_GAP,
  },
  // .status-row-icon{width:34px; height:34px; border-radius:10px; background:var(--paper);}
  icon: {
    width: ICONO_ANCHO,
    height: 34,
    // El 10px que CLAUDE.md §2 anota como el radio que quedó fuera de `Radii`.
    borderRadius: 10,
    backgroundColor: Colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // .status-row-text{font-size:13.5px; font-weight:500;}
  text: {
    ...Typography.rowLabel,
    color: Colors.ink,
  },
  // .status-row-text.danger{color:var(--brick);}
  textDanger: {
    color: Colors.brick,
  },
});
