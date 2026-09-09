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
};

export function StatusRow({
  icon,
  label,
  trailing,
  onPress,
  danger = false,
  last = false,
}: StatusRowProps) {
  return (
    <Pressable
      style={[styles.row, last && styles.rowLast]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
    >
      <View style={styles.label}>
        {/* .status-row-icon lleva `color:var(--brick)` inline en la fila de
            eliminar; aquí el color va en el ícono, que es quien lo pinta. */}
        <View style={styles.icon}>{icon}</View>
        <Text style={[styles.text, danger && styles.textDanger]}>{label}</Text>
      </View>
      {trailing}
    </Pressable>
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
  // .status-row:last-child{border-bottom:none;}
  rowLast: {
    borderBottomWidth: 0,
  },
  // .status-row-label{display:flex; align-items:center; gap:11px;}
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  // .status-row-icon{width:34px; height:34px; border-radius:10px; background:var(--paper);}
  icon: {
    width: 34,
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
