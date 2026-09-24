/**
 * `.notif-row` del frame "Notificaciones".
 *
 * El ícono y su tinte salen del `tipo`, que es la única razón por la que esa
 * columna existe: el texto ya viene resuelto de la base (lo materializa el
 * trigger, porque el precio anterior no sobrevive al UPDATE que lo dispara), así
 * que lo ÚNICO que el cliente decide aquí es cómo se ve.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  IconBan,
  IconBell,
  IconCheckCircle,
  IconHeart,
  IconMail,
  IconStar,
  IconTag,
  IconUser,
} from '@/components/icons';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';
import { formatRelativo } from '@/lib/format';
import type { Notificacion, TipoNotificacion } from '@/lib/notificaciones';

/**
 * Transcrito del frame: la fila de precio usa el corazón RELLENO en
 * `--brick`/`--brick-tint` y la de reporte el sobre de trazo en
 * `--slate`/`--slate-tint`. Un `Record` sobre `TipoNotificacion`, así que
 * agregar un tipo sin su estilo no compila.
 */
const ESTILO_POR_TIPO: Record<
  TipoNotificacion,
  { color: string; fondo: string; icono: (color: string) => React.ReactNode }
> = {
  precio_favorito: {
    color: Colors.brick,
    fondo: Colors.brickTint,
    icono: (color) => <IconHeart size={16} color={color} filled />,
  },
  reporte_resuelto: {
    color: Colors.slate,
    fondo: Colors.slateTint,
    icono: (color) => <IconMail size={16} color={color} />,
  },
  // `--gold` porque es el color de las estrellas (`.rate-stars`), que es a
  // donde lleva el tap: pasa por el Detalle, donde vive "Calificar al vendedor".
  compra_calificable: {
    color: Colors.gold,
    fondo: Colors.goldTint,
    icono: (color) => <IconStar size={16} color={color} filled />,
  },
  // RF-16, tanda 2 — transcritas del frame. Solo hay cuatro tintes, así que el
  // ÍCONO es lo que separa filas que comparten color.
  // El check en círculo en --forest: el mismo par que la fila "Tu correo fue
  // verificado" del frame, que no tiene disparador.
  publicacion_aprobada: {
    color: Colors.forest,
    fondo: Colors.forestTint,
    icono: (color) => <IconCheckCircle size={16} color={color} strokeWidth={2} />,
  },
  // Las dos variantes de copy ("no fue aprobada" / "Retiramos") son el MISMO
  // tipo, así que comparten ícono. El círculo tachado la separa del corazón de
  // "Bajó el precio", que también es --brick.
  publicacion_bloqueada: {
    color: Colors.brick,
    fondo: Colors.brickTint,
    icono: (color) => <IconBan size={16} color={color} />,
  },
  // Estrella de TRAZO: "Califica tu compra" usa la rellena, en el mismo --gold.
  calificacion_recibida: {
    color: Colors.gold,
    fondo: Colors.goldTint,
    icono: (color) => <IconStar size={16} color={color} strokeWidth={2} />,
  },
  favorito_vendido: {
    color: Colors.slate,
    fondo: Colors.slateTint,
    icono: (color) => <IconTag size={16} color={color} strokeWidth={2} />,
  },
  avatar_eliminado: {
    color: Colors.brick,
    fondo: Colors.brickTint,
    icono: (color) => <IconUser size={16} color={color} />,
  },
};

/**
 * Para un `tipo` que este build no conoce. No es teórico: el enum vive en la
 * base y un build viejo puede leer filas de un tipo que se agregó después (el
 * runbook de §8 lo deja escrito). Sin esto, `ESTILO_POR_TIPO[tipo]` es
 * `undefined` y la fila revienta al leer `.fondo`, tumbando el inbox entero
 * por un aviso. Neutro a propósito: la campana en --slate no afirma nada.
 */
const ESTILO_DESCONOCIDO = {
  color: Colors.slate,
  fondo: Colors.slateTint,
  icono: (color: string) => <IconBell size={16} color={color} />,
};

type NotifRowProps = {
  notificacion: Notificacion;
  onPress?: () => void;
};

export function NotifRow({ notificacion, onPress }: NotifRowProps) {
  const estilo = ESTILO_POR_TIPO[notificacion.tipo] ?? ESTILO_DESCONOCIDO;

  // Sin `onPress` no es tocable NI se anuncia como botón: una notificación de
  // reporte no lleva a ningún lado (su `listing_id` es null a propósito — el tap
  // devolvería al reportante al contenido que denunció).
  const tocable = onPress !== undefined;

  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      disabled={!tocable}
      accessibilityRole={tocable ? 'button' : undefined}
    >
      {/* .notif-icon{width:36px; height:36px; border-radius:50%;} */}
      <View style={[styles.icon, { backgroundColor: estilo.fondo }]}>
        {estilo.icono(estilo.color)}
      </View>

      {/* .notif-text{flex:1; min-width:0;} */}
      <View style={styles.text}>
        {/* .notif-top{align-items:baseline; justify-content:space-between; gap:8px;} */}
        <View style={styles.top}>
          <Text style={styles.title} numberOfLines={1}>
            {notificacion.titulo}
          </Text>
          {/* .notif-time{white-space:nowrap;} — en RN el equivalente es no
              dejar que el flex lo encoja, o el título largo lo partiría. */}
          <Text style={styles.time} numberOfLines={1}>
            {formatRelativo(new Date(notificacion.createdAt))}
          </Text>
        </View>
        <Text style={styles.desc}>{notificacion.cuerpo}</Text>
      </View>

      {/* .notif-unread — el punto solo existe mientras no se ha leído; el frame
          lo omite entero en las filas leídas, no lo pinta en otro color. */}
      {notificacion.leida ? null : <View style={styles.unread} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // .notif-row{display:flex; gap:12px; padding:14px 20px;
  //            border-bottom:1px solid var(--line); align-items:flex-start;}
  row: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: ScreenPadding,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
    alignItems: 'flex-start',
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: Radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  // .notif-title{font-size:12.5px; font-weight:600;}
  title: {
    ...Typography.label,
    color: Colors.ink,
    flexShrink: 1,
  },
  // .notif-time{font-size:10.5px; color:var(--ink-soft);}
  time: {
    ...Typography.notifTime,
    color: Colors.inkSoft,
    flexShrink: 0,
  },
  // .notif-desc{font-size:12px; color:var(--ink-soft); margin-top:2px; line-height:1.4;}
  desc: {
    ...Typography.notifDesc,
    color: Colors.inkSoft,
    marginTop: 2,
  },
  // .notif-unread{width:7px; height:7px; border-radius:50%;
  //               background:var(--brick); margin-top:6px;}
  unread: {
    width: 7,
    height: 7,
    borderRadius: Radii.full,
    backgroundColor: Colors.brick,
    flexShrink: 0,
    marginTop: 6,
  },
});
