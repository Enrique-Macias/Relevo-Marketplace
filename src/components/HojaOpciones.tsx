/**
 * La hoja del menú "⋯" de "Perfil público (opciones)" y "Detalle (opciones)"
 * (UGC-1B): reportar y bloquear, como DOS filas separadas (nunca un botón
 * combinado).
 *
 * Mismo cascarón que `HojaAccionesListing` y `HojaSoporte` (backdrop,
 * `.sheet-card`, handle, header con ✕, `.status-row`), pero NO es una de las
 * dos: aquella decide sus filas por el estado y la venta de una publicación
 * propia; esta solo pinta las filas que le pasan. Un `Modal` de RN por el mismo
 * motivo que aquellas: quien la abre ya tiene en la mano a quién se reporta o
 * bloquea. El padding inferior suma el inset del sistema, como `HojaSoporte`
 * (la deuda de `HojaAccionesListing` en `componentes-compartidos.md`).
 */

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconChevronRight, IconClose } from '@/components/icons';
import { StatusRow } from '@/components/StatusRow';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';

export type OpcionHoja = {
  key: string;
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  /** `.status-row-text.danger`: Bloquear. */
  danger?: boolean;
  /** Chevron solo si la fila lleva a OTRA pantalla (Reportar). */
  chevron?: boolean;
};

type Props = {
  visible: boolean;
  /** `.sheet-title`: el título de la publicación o el nombre del perfil. */
  titulo: string;
  opciones: OpcionHoja[];
  onCerrar: () => void;
};

export function HojaOpciones({ visible, titulo, opciones, onCerrar }: Props) {
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCerrar}>
      <Pressable style={styles.backdrop} onPress={onCerrar}>
        {/* El onPress vacío hace que la tarjeta reclame el toque y no lo deje
            burbujear al backdrop (mismo recurso que `HojaAccionesListing`). */}
        <Pressable style={styles.sheetCard} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {titulo}
            </Text>
            <Pressable onPress={onCerrar} hitSlop={12} accessibilityRole="button">
              <IconClose size={18} color={Colors.ink} />
            </Pressable>
          </View>
          <View style={[styles.statusSection, { paddingBottom: insets.bottom + 24 }]}>
            {opciones.map((o, i) => (
              <StatusRow
                key={o.key}
                icon={o.icon}
                label={o.label}
                danger={o.danger}
                trailing={o.chevron ? <IconChevronRight size={14} color={Colors.inkSoft} /> : undefined}
                onPress={o.onPress}
                last={i === opciones.length - 1}
              />
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.backdrop,
    justifyContent: 'flex-end',
  },
  sheetCard: {
    width: '100%',
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    overflow: 'hidden',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.line,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 6,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  sheetTitle: {
    ...Typography.sheetTitle,
    color: Colors.ink,
    flex: 1,
  },
  // .status-section con el padding de la hoja (6/20/24); el 24 de abajo se suma
  // al inset del sistema en el render.
  statusSection: {
    paddingTop: 6,
    paddingHorizontal: ScreenPadding,
  },
});
