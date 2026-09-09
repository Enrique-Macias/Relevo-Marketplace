/**
 * `.notice` — aviso PERSISTENTE dentro del flujo.
 *
 * Es hermano del `Toast`, no una variante suya, y la diferencia es la razón de
 * que exista: el toast flota sobre la pantalla y se va solo a los 4s. Cuando el
 * aviso trae una acción asociada, irse mientras se lee es exactamente lo que no
 * debe hacer. Toma del toast el círculo `--brick` con el signo de admiración y
 * su tamaño de texto, pero va sobre `--card`, sin sombra y sin `position
 * absolute`: ocupa su lugar en la columna en vez de tapar algo.
 *
 * Vivió dentro de "Publicación creada (fotos faltantes)", el frame que el modelo
 * atómico de publicación eliminó. Hoy su único uso es el error de subida en el
 * `.sticky-cta` de Publicar, pegado al botón "Reintentar" que lo resuelve.
 */

import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { IconExclamation } from '@/components/icons';
import { Colors, Radii, Typography } from '@/constants/theme';

export function Notice({ text, style }: { text: string; style?: ViewStyle }) {
  return (
    <View style={[styles.notice, style]}>
      <View style={styles.icon}>
        <IconExclamation size={11} color={Colors.paper} />
      </View>
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // .notice{background:var(--card); border:1px solid var(--line); border-radius:14px;
  //   padding:12px 14px; gap:10px; margin-bottom:24px;}
  notice: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 24,
  },
  // .notice-icon{width:20px; height:20px; border-radius:50%; background:var(--brick);}
  icon: {
    width: 20,
    height: 20,
    borderRadius: Radii.full,
    backgroundColor: Colors.brick,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // .notice-text{font-size:12.5px; color:var(--ink-soft); line-height:1.45;}
  text: {
    ...Typography.meta,
    color: Colors.inkSoft,
    lineHeight: 18.125, // 12.5 × 1.45
    flex: 1,
    textAlign: 'left',
  },
});
