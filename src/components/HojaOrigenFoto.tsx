/**
 * Las hojas "Agregar fotos" ("Publicar (agregar fotos)") y "Foto de perfil"
 * ("Editar perfil (cambiar foto)"), de DESIGN-1 fase 5: Tomar foto o Elegir de
 * la galería, con la nota opcional y el "Cancelar" del frame.
 *
 * Mismo cascarón que `HojaOpciones` (backdrop, `.sheet-card`, handle, header
 * con ✕), pero NO es una variante suya: suma la `.sheet-note` y el ghost
 * "Cancelar", y sus filas llevan la línea secundaria DENTRO del área tocable.
 * Por eso tampoco usa `StatusRow`, cuyo `sub` es texto seleccionable fuera del
 * `Pressable` (lo necesita `HojaSoporte` para copiar el correo).
 *
 * EL PICKER SE ABRE CUANDO LA HOJA YA SE CERRÓ, y no es estética: iOS no
 * presenta un view controller (cámara o galería) mientras otro, el `Modal`, se
 * está desmontando, y el picker simplemente no aparece. Por eso la hoja recuerda
 * qué fila se tocó, se cierra, y la ejecuta en `onDismiss` (iOS). En Android el
 * `Modal` no tiene ese problema y la acción corre al terminar la interacción.
 * El temporizador de respaldo cubre un `onDismiss` que no llegue; el ref
 * garantiza que la acción corra una sola vez.
 */

import { useRef } from 'react';
import {
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostButton } from '@/components/Buttons';
import { IconChevronRight, IconClose, IconGaleria, IconTomarFoto } from '@/components/icons';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';

/** Respaldo si `onDismiss` no llega en iOS. Más que la animación `fade`. */
const RESPALDO_MS = 700;

type Props = {
  visible: boolean;
  /** `.sheet-title`: "Agregar fotos" o "Foto de perfil". */
  titulo: string;
  /** `.status-row-sub` de "Elegir de la galería". */
  subGaleria: string;
  /** `.sheet-note`, solo en "Agregar fotos". */
  nota?: string;
  onCamara: () => void;
  onGaleria: () => void;
  /** Cerrar sin elegir (✕, Cancelar, backdrop o atrás de Android). */
  onCerrar: () => void;
};

export function HojaOrigenFoto({
  visible,
  titulo,
  subGaleria,
  nota,
  onCamara,
  onGaleria,
  onCerrar,
}: Props) {
  const insets = useSafeAreaInsets();
  const pendiente = useRef<(() => void) | null>(null);

  const ejecutarPendiente = () => {
    const accion = pendiente.current;
    pendiente.current = null;
    accion?.();
  };

  const elegir = (accion: () => void) => {
    if (pendiente.current) return;
    pendiente.current = accion;
    onCerrar();
    if (Platform.OS === 'ios') {
      setTimeout(ejecutarPendiente, RESPALDO_MS);
    } else {
      InteractionManager.runAfterInteractions(ejecutarPendiente);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCerrar}
      onDismiss={ejecutarPendiente}
    >
      <Pressable style={styles.backdrop} onPress={onCerrar}>
        {/* El onPress vacío hace que la tarjeta reclame el toque y no lo deje
            burbujear al backdrop (mismo recurso que `HojaOpciones`). */}
        <Pressable style={styles.sheetCard} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {titulo}
            </Text>
            <Pressable
              onPress={onCerrar}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Cerrar"
            >
              <IconClose size={18} color={Colors.ink} />
            </Pressable>
          </View>
          <View style={styles.statusSection}>
            <Fila
              icon={<IconTomarFoto size={16} color={Colors.ink} />}
              label="Tomar foto"
              onPress={() => elegir(onCamara)}
            />
            <Fila
              icon={<IconGaleria size={16} color={Colors.ink} />}
              label="Elegir de la galería"
              sub={subGaleria}
              onPress={() => elegir(onGaleria)}
              last
            />
          </View>
          {nota ? <Text style={styles.sheetNote}>{nota}</Text> : null}
          <View style={[styles.cancelWrap, { paddingBottom: insets.bottom + 22 }]}>
            <GhostButton label="Cancelar" onPress={onCerrar} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * "Agregar fotos" de Publicar y Editar publicación, con el copy del frame en UN
 * sitio. `llevas` son las fotos que ya tiene el formulario; con 5 no se abre
 * (el `.photo-add` ya no existe), así que siempre queda al menos un lugar.
 */
export function HojaAgregarFotos({
  visible,
  llevas,
  max,
  onCamara,
  onGaleria,
  onCerrar,
}: {
  visible: boolean;
  llevas: number;
  max: number;
  onCamara: () => void;
  onGaleria: () => void;
  onCerrar: () => void;
}) {
  const quedan = Math.max(1, max - llevas);
  return (
    <HojaOrigenFoto
      visible={visible}
      titulo="Agregar fotos"
      subGaleria={quedan === 1 ? 'Puedes elegir 1 más' : `Puedes elegir hasta ${quedan} más`}
      nota={`Llevas ${llevas} de ${max} fotos. JPG o PNG; las convertimos antes de subirlas.`}
      onCamara={onCamara}
      onGaleria={onGaleria}
      onCerrar={onCerrar}
    />
  );
}

function Fila({
  icon,
  label,
  sub,
  onPress,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, last && styles.rowLast, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
    >
      <View style={styles.label}>
        <View style={styles.icon}>{icon}</View>
        <View style={styles.textos}>
          <Text style={styles.text}>{label}</Text>
          {sub ? <Text style={styles.sub}>{sub}</Text> : null}
        </View>
      </View>
      <IconChevronRight size={14} color={Colors.inkSoft} />
    </Pressable>
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
  // .status-section con `padding:6px 20px 6px` inline en el frame.
  statusSection: {
    paddingVertical: 6,
    paddingHorizontal: ScreenPadding,
  },
  // Los valores de `.status-row` (StatusRow.tsx), con la línea secundaria dentro.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    flex: 1,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textos: {
    flex: 1,
  },
  text: {
    ...Typography.rowLabel,
    color: Colors.ink,
  },
  // .status-row-sub{font-size:11.5px; color:var(--ink-soft); margin-top:2px;}
  sub: {
    ...Typography.rowSub,
    color: Colors.inkSoft,
    marginTop: 2,
  },
  // .sheet-note{font-size:11.5px; line-height:1.45; padding:0 20px 8px;}
  sheetNote: {
    ...Typography.sheetNote,
    color: Colors.inkSoft,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 8,
  },
  // `padding:6px 20px 22px` inline en el frame; el 22 se suma al inset.
  cancelWrap: {
    paddingTop: 6,
    paddingHorizontal: ScreenPadding,
  },
});
