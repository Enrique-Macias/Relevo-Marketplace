/**
 * Frame "Error de conexión" (`design/relevo-app.html`, grupo `sistema`).
 *
 * Es el `.empty-state` de siempre con `.empty-icon.error-icon` (fondo
 * `--brick-tint` en vez de `--paper`) y un `.primary-btn` de "Reintentar".
 * Se vuelve alcanzable ahora que las pantallas leen de la red.
 */

import { StyleSheet, type ViewStyle } from 'react-native';

import { PrimaryButton } from '@/components/Buttons';
import { EmptyState } from '@/components/EmptyState';
import { IconAlertCircle } from '@/components/icons';
import { Colors } from '@/constants/theme';

type ErrorStateProps = {
  onRetry: () => void;
  title?: string;
  sub?: string;
  style?: ViewStyle;
};

export function ErrorState({
  onRetry,
  title = 'Sin conexión a internet',
  sub = 'No pudimos cargar el catálogo. Revisa tu conexión e intenta de nuevo.',
  style,
}: ErrorStateProps) {
  return (
    <EmptyState
      icon={<IconAlertCircle size={30} color={Colors.brick} />}
      iconStyle={styles.errorIcon}
      title={title}
      sub={sub}
      style={style}
    >
      <PrimaryButton label="Reintentar" onPress={onRetry} style={styles.btn} />
    </EmptyState>
  );
}

const styles = StyleSheet.create({
  // .error-icon{background:var(--brick-tint);}
  errorIcon: {
    backgroundColor: Colors.brickTint,
  },
  // .empty-actions .primary-btn{margin-top:0;}
  btn: {
    marginTop: 0,
  },
});
