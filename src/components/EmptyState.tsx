/** `.empty-state` + `.empty-icon` + `.empty-title` + `.empty-sub` + `.empty-actions`. */

import { StyleSheet, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import { Colors, Radii, Typography } from '@/constants/theme';

type EmptyStateProps = {
  icon: React.ReactNode;
  title: string;
  sub: string;
  children?: React.ReactNode;
  style?: ViewStyle;
  /** `.error-icon` cambia el fondo del círculo a `--brick-tint`. Ver `ErrorState`. */
  iconStyle?: ViewStyle;
  /** Para ajustar el margen del `.empty-sub` cuando algo se intercala debajo. */
  subStyle?: TextStyle;
  /**
   * Contenido entre el subtítulo y los botones. Existe porque `children` cae
   * dentro de `.empty-actions`, que es la columna de CTAs con su propio gap:
   * un aviso metido ahí se leería como un botón más. Hoy lo usa el `.notice`
   * de "Publicación creada (fotos faltantes)".
   */
  belowSub?: React.ReactNode;
};

export function EmptyState({
  icon,
  title,
  sub,
  children,
  style,
  iconStyle,
  subStyle,
  belowSub,
}: EmptyStateProps) {
  return (
    <View style={[styles.state, style]}>
      <View style={[styles.icon, iconStyle]}>{icon}</View>
      <Text style={styles.title}>{title}</Text>
      <Text style={[styles.sub, subStyle]}>{sub}</Text>
      {belowSub}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // .empty-state{display:flex; flex-direction:column; align-items:center; text-align:center; padding:64px 30px 0;}
  state: {
    alignItems: 'center',
    paddingTop: 64,
    paddingHorizontal: 30,
  },
  // .empty-icon{width:72px; height:72px; border-radius:50%; background:var(--paper); border:1px solid var(--line);}
  icon: {
    width: 72,
    height: 72,
    borderRadius: Radii.full,
    backgroundColor: Colors.paper,
    borderWidth: 1,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  title: {
    ...Typography.emptyTitle,
    color: Colors.ink,
    textAlign: 'center',
    maxWidth: 240,
    marginBottom: 9,
  },
  sub: {
    ...Typography.auth,
    color: Colors.inkSoft,
    textAlign: 'center',
    maxWidth: 230,
    marginBottom: 24,
  },
  actions: {
    width: '100%',
    gap: 10,
  },
});
