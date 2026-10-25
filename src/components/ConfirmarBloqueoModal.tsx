/**
 * Frame "Confirmar bloquear" (UGC-1B) — la ÚNICA confirmación de bloqueo.
 *
 * Se abre desde tres lugares y es la misma en los tres, a propósito
 * (UGC-1B.1): el menú "⋯" de "Perfil público", el de "Detalle" y el botón
 * "Bloquear" de "Reporte enviado (¿bloquear?)". Bloquear tiene efecto en las
 * dos direcciones, así que el texto que lo explica vive en un solo sitio.
 *
 * Es `ConfirmModal` tal cual (mismo shell que "Confirmar eliminar"), sin
 * hijos. Mientras `confirming`, los dos botones están apagados: el bloqueo no
 * se puede abortar a medio camino, y el doble tap no llega a la base.
 */

import { ConfirmModal } from '@/components/ConfirmModal';
import { IconBan } from '@/components/icons';
import { Colors } from '@/constants/theme';

type Props = {
  visible: boolean;
  /** Nombre del perfil; sin nombre, el título cae a "¿Bloquear a este usuario?". */
  nombre: string | null | undefined;
  confirming: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmarBloqueoModal({ visible, nombre, confirming, onConfirm, onCancel }: Props) {
  const limpio = nombre?.trim();
  return (
    <ConfirmModal
      visible={visible}
      icon={<IconBan size={22} color={Colors.danger} />}
      title={limpio ? `¿Bloquear a ${limpio}?` : '¿Bloquear a este usuario?'}
      body="Ninguno de los dos verá las publicaciones del otro y no podrán contactarse desde la app. No le avisaremos. Puedes desbloquearlo cuando quieras desde Configuración."
      confirmLabel="Bloquear"
      onConfirm={onConfirm}
      // También es el "atrás" de Android (`onRequestClose`): con el bloqueo en
      // curso no hay nada que cancelar.
      onCancel={() => {
        if (!confirming) onCancel();
      }}
      confirming={confirming}
    />
  );
}
