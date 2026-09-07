/**
 * `.modal-backdrop > .modal-card > .modal-icon + .modal-title + .modal-sub +
 * .modal-actions(.ghost-btn + .danger-btn)` — el shell que comparten
 * "Confirmar cerrar sesión" y "Confirmar eliminar" en `relevo-app.html`
 * (`data-cat="sistema"`, líneas 3192 y 3250). Es un único componente
 * parametrizado por ícono/título/cuerpo/label — solo "cerrar sesión" lo usa
 * por ahora, pero queda listo para "Confirmar eliminar" cuando llegue.
 */

import { Modal, StyleSheet, Text, View } from 'react-native';

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
}: ConfirmModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      {/* .modal-backdrop{position:absolute; inset:0; background:rgba(34,31,28,0.55); align-items:center; padding:0 26px;} */}
      <View style={styles.backdrop}>
        {/* .modal-card{width:100%; background:var(--card); border-radius:20px; padding:24px 20px 20px; text-align:center;} */}
        <View style={styles.card}>
          {/* .modal-icon{width:50px; height:50px; border-radius:50%; background:var(--brick-tint); margin:0 auto 16px;} */}
          <View style={styles.icon}>{icon}</View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <View style={styles.actions}>
            {/* width:undefined cancela el 100% de GhostButton — aquí vive en fila, no solo. */}
            <GhostButton label="Cancelar" onPress={onCancel} style={styles.ghost} />
            <DangerButton
              label={confirming ? '…' : confirmLabel}
              onPress={onConfirm}
              disabled={confirming}
            />
          </View>
        </View>
      </View>
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
