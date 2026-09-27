/**
 * `.modal-backdrop > .modal-card > .modal-icon + .modal-title + .modal-sub +
 * .modal-actions(.ghost-btn + .danger-btn)` — el shell que comparten
 * "Confirmar cerrar sesión" y "Confirmar eliminar" en `relevo-app.html`
 * (`data-cat="sistema"`, líneas 3192 y 3250). Es un único componente
 * parametrizado por ícono/título/cuerpo/label.
 *
 * `children` es el ÚNICO hueco, entre el cuerpo y los botones, y existe para
 * "Confirmar eliminar cuenta": el campo de contraseña y su error van dentro
 * del modal (frame en `data-cat="sistema"`). Quien no pasa hijos —"Cerrar
 * sesión"— se ve exactamente igual que antes.
 */

import { KeyboardAvoidingView, Modal, Platform, StyleSheet, Text, View } from 'react-native';

import { DangerButton, GhostButton } from '@/components/Buttons';
import { Colors, Radii, Typography } from '@/constants/theme';

type ConfirmModalProps = {
  visible: boolean;
  icon: React.ReactNode;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Deshabilita ambos botones y cambia el label del confirm mientras corre. */
  confirming?: boolean;
  /** Deshabilita solo el confirm (p. ej. sin contraseña escrita). */
  confirmDisabled?: boolean;
  /** Contenido entre el cuerpo y los botones. */
  children?: React.ReactNode;
};

export function ConfirmModal({
  visible,
  icon,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  confirming = false,
  confirmDisabled = false,
  children,
}: ConfirmModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/* .modal-backdrop{position:absolute; inset:0; background:rgba(34,31,28,0.55); align-items:center; padding:0 26px;} */}
      {/* Con un campo de texto dentro, el teclado taparía la tarjeta centrada.
          En iOS se empuja con padding; Android ya redimensiona la ventana. */}
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* .modal-card{width:100%; background:var(--card); border-radius:20px; padding:24px 20px 20px; text-align:center;} */}
        <View style={styles.card}>
          {/* .modal-icon{width:50px; height:50px; border-radius:50%; background:var(--brick-tint); margin:0 auto 16px;} */}
          <View style={styles.icon}>{icon}</View>
          <Text style={styles.title}>{title}</Text>
          <Text style={[styles.body, children ? styles.bodyConHijos : null]}>{body}</Text>
          {children ? <View style={styles.hijos}>{children}</View> : null}
          <View style={styles.actions}>
            {/* width:undefined cancela el 100% de GhostButton — aquí vive en fila, no solo. */}
            {/* Deshabilitado mientras `confirming`: "Cancelar" no puede
                cancelar una acción que ya está en curso (`onConfirm` no
                admite abortarse) — dejarlo tocable solo cierra el modal
                mientras la acción sigue corriendo de fondo y termina
                resolviendo sola, sin que el usuario sepa que va a pasar. */}
            <GhostButton
              label="Cancelar"
              onPress={onCancel}
              disabled={confirming}
              style={styles.ghost}
            />
            <DangerButton
              label={confirming ? '…' : confirmLabel}
              onPress={onConfirm}
              disabled={confirming || confirmDisabled}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(34,31,28,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 26,
  },
  card: {
    width: '100%',
    backgroundColor: Colors.card,
    borderRadius: Radii.xxl,
    paddingTop: 24,
    paddingHorizontal: 20,
    paddingBottom: 20,
    alignItems: 'center',
  },
  icon: {
    width: 50,
    height: 50,
    borderRadius: Radii.full,
    backgroundColor: Colors.brickTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    ...Typography.modalTitle,
    color: Colors.ink,
    marginBottom: 8,
    textAlign: 'center',
  },
  body: {
    ...Typography.modalSub,
    color: Colors.inkSoft,
    marginBottom: 20,
    textAlign: 'center',
  },
  // Frame "Confirmar eliminar cuenta": `.modal-sub` con `margin-bottom:16px`
  // inline, y el `.field` con `margin-bottom:20px` hasta los botones.
  bodyConHijos: {
    marginBottom: 16,
  },
  hijos: {
    width: '100%',
    marginBottom: 20,
  },
  // .modal-actions{display:flex; gap:10px;}
  actions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  ghost: {
    width: undefined,
    flex: 1,
  },
});
