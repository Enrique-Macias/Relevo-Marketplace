/**
 * La hoja de "Ayuda y soporte": WhatsApp (si hay número) y Correo. Encapsulada:
 * quien la monta solo pasa `visible`, `onCerrar` y el correo del usuario; los
 * handlers, el aviso de correo fallido y el toast de WhatsApp viven AQUÍ.
 *
 * Es un `Modal` de RN, mismo patrón y mismos estilos de tarjeta que
 * `HojaAccionesListing` (tap fuera y botón atrás de Android cierran), pero NO es
 * un consumidor de ella: no comparte nada de su lógica de estado/venta.
 *
 * NO DEPENDE DE `profile.estado`, y no debe: es el único canal de apelación de
 * una cuenta suspendida. Ni la fila que la abre ni ningún botón de esta hoja se
 * gatean por estado "por consistencia" con otras acciones de un suspendido.
 *
 * Usa `useToast()` (el toast vive en el layout raíz, por debajo de un `Modal`,
 * que abre una ventana nativa encima): por eso el toast de WhatsApp se dispara
 * DESPUÉS de cerrar la hoja, y el fallo del correo NO usa toast sino un
 * `Notice` dentro de la hoja.
 */

import { useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconChevronRight, IconClose, IconMail, IconWhatsapp } from '@/components/icons';
import { Notice } from '@/components/Notice';
import { StatusRow } from '@/components/StatusRow';
import { useToast } from '@/components/Toast';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';
import {
  CORREO_SOPORTE,
  urlSoporteCorreo,
  urlSoporteWhatsapp,
  whatsappSoporteDisponible,
} from '@/lib/configuracion';

type Props = {
  visible: boolean;
  onCerrar: () => void;
  /** Correo de la sesión del usuario, para prellenar el mensaje. */
  correoUsuario?: string | null;
};

export function HojaSoporte({ visible, onCerrar, correoUsuario }: Props) {
  const { mostrar } = useToast();
  const insets = useSafeAreaInsets();
  const [errorCorreo, setErrorCorreo] = useState(false);

  // Todos los caminos de cierre pasan por aquí: reabrir la hoja nace sin el
  // aviso de un intento anterior.
  function cerrar() {
    setErrorCorreo(false);
    onCerrar();
  }

  async function abrirWhatsapp() {
    cerrar();
    try {
      await Linking.openURL(urlSoporteWhatsapp(correoUsuario));
    } catch {
      mostrar('No pudimos abrir WhatsApp. Intenta de nuevo.', 'error');
    }
  }

  async function abrirCorreo() {
    setErrorCorreo(false);
    try {
      await Linking.openURL(urlSoporteCorreo(correoUsuario));
      cerrar();
    } catch {
      // La hoja se queda abierta: la dirección seleccionable de abajo es la
      // salida, y un toast quedaría tapado por este mismo Modal.
      setErrorCorreo(true);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cerrar}>
      <Pressable style={styles.backdrop} onPress={cerrar}>
        {/* onPress vacío: ver `HojaAccionesListing` — evita que tocar la propia
            tarjeta burbujee al backdrop y la cierre. */}
        <Pressable style={styles.sheetCard} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Ayuda y soporte</Text>
            <Pressable onPress={cerrar} hitSlop={12} accessibilityRole="button">
              <IconClose size={18} color={Colors.ink} />
            </Pressable>
          </View>

          <View style={[styles.statusSection, { paddingBottom: insets.bottom + 24 }]}>
            {whatsappSoporteDisponible() ? (
              <StatusRow
                icon={<IconWhatsapp size={16} color={Colors.inkSoft} />}
                label="WhatsApp"
                trailing={<IconChevronRight size={14} color={Colors.inkSoft} />}
                onPress={() => void abrirWhatsapp()}
              />
            ) : null}

            {/* La dirección es el `sub` de la fila: segunda línea bajo el label,
                seleccionable y FUERA del área de toque (ver `StatusRow`). */}
            <StatusRow
              icon={<IconMail size={16} color={Colors.inkSoft} />}
              label="Correo"
              trailing={<IconChevronRight size={14} color={Colors.inkSoft} />}
              onPress={() => void abrirCorreo()}
              sub={CORREO_SOPORTE}
              last
            />

            {errorCorreo ? (
              <Notice
                style={styles.notice}
                text="No encontramos una app de correo. Mantén presionada la dirección para copiarla."
              />
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // .modal-backdrop con align-items:flex-end — ancla la hoja abajo.
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(34,31,28,0.55)',
    justifyContent: 'flex-end',
  },
  // .sheet-card{width:100%; background:var(--card); border-radius:20px 20px 0 0;}
  sheetCard: {
    width: '100%',
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    overflow: 'hidden',
  },
  // .sheet-handle{width:36px; height:4px; border-radius:2px; margin:10px auto 6px;}
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.line,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  // .sheet-header{padding:6px 20px 14px; border-bottom:1px solid var(--line);}
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
  // .status-section (padding:6px 20px 24px). El padding inferior (24 + el inset
  // del dispositivo) se calcula en el render: el indicador de inicio de iOS se
  // encimaba con la última fila.
  statusSection: {
    paddingTop: 6,
    paddingHorizontal: ScreenPadding,
  },
  // `Notice` trae margin-bottom:24 (su uso en flujo); aquí va sobre la dirección.
  notice: {
    marginTop: 14,
    marginBottom: 0,
  },
});
