/**
 * `.buyer-row` del frame "¿A quién le vendiste?" — avatar, nombre, cuándo
 * contactó, y el radio de selección.
 *
 * NO reusa `ListRow` (`src/components/ListRow.tsx`) aunque se parezcan: aquel es
 * `.list-row`, no tiene avatar y su padding vertical es 14, no 13. Lo que SÍ
 * comparten es `RadioCircle`, que ya estaba exportado de ahí — el aro y el punto
 * de `--brick` son literalmente el mismo componente.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RadioCircle } from '@/components/ListRow';
import { Colors, Radii, Typography } from '@/constants/theme';
import { Avatar } from '@/components/Avatar';
import { formatRelativo } from '@/lib/format';

type BuyerRowProps = {
  nombre: string | null;
  /** `users.foto_url` del contacto. Ignorado si se pasa `leading`. */
  fotoUrl?: string | null;
  /** Cuándo tocó "Contactar por WhatsApp". Ausente en la fila de salida. */
  contactoAt?: string;
  selected: boolean;
  last?: boolean;
  onPress: () => void;
  /**
   * La fila "No fue a través de Relevo": mismo layout, avatar en `--paper` con
   * el glifo de cerrar en vez de iniciales, y sin `.buyer-time`.
   */
  leading?: React.ReactNode;
};

export function BuyerRow({
  nombre,
  fotoUrl,
  contactoAt,
  selected,
  last,
  onPress,
  leading,
}: BuyerRowProps) {
  return (
    <Pressable
      style={[styles.row, last && styles.rowLast]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      {leading ?? (
        <Avatar
          path={fotoUrl}
          nombre={nombre}
          style={styles.avatar}
          textStyle={styles.avatarText}
        />
      )}

      <View style={styles.info}>
        <Text style={styles.nombre} numberOfLines={1}>
          {nombre ?? 'Sin nombre'}
        </Text>
        {contactoAt ? (
          <Text style={styles.time}>Te contactó {formatRelativo(new Date(contactoAt))}</Text>
        ) : null}
      </View>

      <RadioCircle selected={selected} />
    </Pressable>
  );
}

/** El avatar de la fila de salida: `--paper` con el glifo que se le pase. */
export function BuyerRowAvatarNeutro({ children }: { children: React.ReactNode }) {
  return <View style={[styles.avatar, styles.avatarNeutro]}>{children}</View>;
}

const styles = StyleSheet.create({
  // .buyer-row{display:flex; align-items:center; gap:12px; padding:13px 0;
  //            border-bottom:1px solid var(--line);}
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  // .buyer-row:last-child{border-bottom:none;}
  rowLast: {
    borderBottomWidth: 0,
  },
  // .buyer-avatar{width:38px; height:38px; border-radius:50%;
  //               background:var(--slate-tint); color:var(--slate);}
  avatar: {
    width: 38,
    height: 38,
    borderRadius: Radii.full,
    backgroundColor: Colors.slateTint,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  // style="background:var(--paper); color:var(--ink-soft);"
  avatarNeutro: {
    backgroundColor: Colors.paper,
  },
  // .buyer-avatar{font-size:13px; font-weight:600;} — coincide con `avatarInitials`,
  // que es el mismo rol (.avatar del header del Feed) en el mismo tamaño.
  avatarText: {
    ...Typography.avatarInitials,
    color: Colors.slate,
  },
  // .buyer-info{flex:1; min-width:0;}
  info: {
    flex: 1,
    minWidth: 0,
  },
  // .buyer-name{font-size:13.5px; font-weight:600;}
  nombre: {
    ...Typography.emphasis,
    color: Colors.ink,
  },
  // .buyer-time{font-size:11.5px; color:var(--ink-soft); margin-top:2px;}
  time: {
    ...Typography.rowSub,
    color: Colors.inkSoft,
    marginTop: 2,
  },
});
