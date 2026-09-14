/**
 * `.skeleton` + `.sk-cat-icon` / `.sk-cat-label` / `.sk-thumb` / `.sk-line` del
 * frame "Loading / skeleton" (`design/relevo-app.html`, grupo `sistema`).
 *
 * En el HTML el brillo es un `linear-gradient` de 400% animado con
 * `background-position`. React Native no anima `background-position`, así que
 * el equivalente honesto es animar la opacidad de una pieza sólida del mismo
 * color base (`--line`) con la misma duración (1.4s). Es la traducción del
 * efecto, no un efecto nuevo: mismo color, mismo ritmo, mismos tamaños.
 */

import { useEffect, useState } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';

import { Colors, Radii, ScreenPadding } from '@/constants/theme';
import { chunkRows } from '@/lib/grid';

function usePulso() {
  // `useState` con inicializador perezoso, no `useRef().current`: el valor se
  // crea una sola vez y leerlo en render es legítimo (a diferencia de un ref).
  const [opacidad] = useState(() => new Animated.Value(0.45));

  useEffect(() => {
    const bucle = Animated.loop(
      Animated.sequence([
        Animated.timing(opacidad, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacidad, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ])
    );
    bucle.start();
    return () => bucle.stop();
  }, [opacidad]);

  return opacidad;
}

export function SkeletonPiece({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const opacidad = usePulso();
  return <Animated.View style={[styles.piece, style, { opacity: opacidad }]} />;
}

/** El grid de categorías del Feed mientras carga (`.cat-item` con piezas dentro). */
export function SkeletonCatGrid({ filas = 2, columnas = 4 }: { filas?: number; columnas?: number }) {
  return (
    <View style={styles.catGrid}>
      {Array.from({ length: filas }).map((_, i) => (
        <View key={i} style={styles.catGridRow}>
          {Array.from({ length: columnas }).map((_, j) => (
            <View key={j} style={styles.catItem}>
              <SkeletonPiece style={styles.skCatIcon} />
              <SkeletonPiece style={styles.skCatLabel} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** El grid de tarjetas de producto mientras carga. */
export function SkeletonGrid({ tarjetas = 4, style }: { tarjetas?: number; style?: ViewStyle }) {
  const celdas = Array.from({ length: tarjetas }, (_, i) => i);
  return (
    <View style={[styles.grid, style]}>
      {chunkRows(celdas, 2).map((row, i) => (
        <View key={i} style={styles.gridRow}>
          {row.map((c) => (
            <View key={c} style={styles.card}>
              <SkeletonPiece style={styles.skThumb} />
              <View style={styles.cardInfo}>
                <SkeletonPiece style={[styles.skLine, styles.skPrice]} />
                <SkeletonPiece style={[styles.skLine, styles.skTitle]} />
                <SkeletonPiece style={[styles.skLine, styles.skMeta]} />
              </View>
            </View>
          ))}
          {row.length < 2 ? <View style={styles.padCell} /> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * La lista plana de "Mis publicaciones" mientras carga: `.mine-row` sin
 * contenido.
 *
 * Existe en vez de reusar `SkeletonGrid` porque el esqueleto tiene que
 * anticipar la forma de lo que viene — un grid de dos columnas donde luego
 * aparecen filas horizontales produce un salto de layout justo al terminar de
 * cargar. Las piezas y sus medidas son las mismas del frame "Loading /
 * skeleton": lo único distinto es cómo se acomodan.
 */
export function SkeletonRows({ filas = 4, style }: { filas?: number; style?: ViewStyle }) {
  return (
    <View style={[styles.rows, style]}>
      {Array.from({ length: filas }).map((_, i) => (
        <View key={i} style={styles.row}>
          <SkeletonPiece style={styles.skRowThumb} />
          <View style={styles.rowInfo}>
            <SkeletonPiece style={[styles.skLine, styles.skPrice]} />
            <SkeletonPiece style={[styles.skLine, styles.skTitle]} />
            <SkeletonPiece style={[styles.skLine, styles.skMeta]} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * El inbox de notificaciones mientras carga: `.notif-row` sin contenido.
 *
 * Hermano de `SkeletonRows` y no una variante suya, por el mismo motivo por el
 * que aquella no reusó `SkeletonGrid`: la forma que anticipa es distinta —
 * círculo de 36px y DOS líneas, contra thumb cuadrado de 76px y tres— y un
 * esqueleto que anticipa la forma equivocada produce el salto de layout que
 * existe para evitar. Comparte el borde inferior de la fila real, que es lo que
 * hace que la lista no "aparezca" de golpe.
 */
export function SkeletonNotifRows({ filas = 5, style }: { filas?: number; style?: ViewStyle }) {
  return (
    <View style={style}>
      {Array.from({ length: filas }).map((_, i) => (
        <View key={i} style={styles.notifRow}>
          <SkeletonPiece style={styles.skNotifIcon} />
          <View style={styles.rowInfo}>
            <SkeletonPiece style={[styles.skLine, styles.skNotifTitle]} />
            <SkeletonPiece style={[styles.skLine, styles.skNotifDesc]} />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * "Editar perfil" mientras carga: el círculo de foto y los campos vacíos.
 *
 * Tercer hermano de `SkeletonRows`/`SkeletonNotifRows` por el mismo motivo que
 * aquellos: la forma que anticipa es otra —un círculo de 84px centrado y cajas
 * de campo de 44px con su etiqueta encima, no filas con miniatura—, y un
 * esqueleto que anticipa la forma equivocada produce justo el salto de layout
 * que existe para evitar.
 *
 * Cinco campos porque cinco tiene el frame (nombre, carrera, WhatsApp,
 * universidad, campus): los tres `.text-field`/`.phone-field` y los dos
 * `.select-field` miden exactamente lo mismo (padding 13 + 14px de texto), así
 * que una sola pieza los cubre a todos.
 */
export function SkeletonPerfilForm({ campos = 5 }: { campos?: number }) {
  return (
    <View style={styles.perfilForm}>
      <SkeletonPiece style={styles.skPhotoCircle} />
      {Array.from({ length: campos }).map((_, i) => (
        <View key={i} style={styles.perfilCampo}>
          <SkeletonPiece style={styles.skFieldLabel} />
          <SkeletonPiece style={styles.skFieldBox} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // .skeleton{border-radius:8px;} — el gradiente se traduce a color base + pulso.
  piece: {
    backgroundColor: Colors.line,
    borderRadius: Radii.sm,
  },
  // .cat-item, idéntico a CategoryTile pero sin contenido.
  catItem: {
    flex: 1,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.lg,
    paddingVertical: 10,
    paddingHorizontal: 6,
    height: 86,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catGrid: {
    gap: 9,
    paddingHorizontal: ScreenPadding,
  },
  catGridRow: {
    flexDirection: 'row',
    gap: 9,
  },
  // .sk-cat-icon{width:32px; height:32px; border-radius:8px; margin-bottom:7px;}
  skCatIcon: {
    width: 32,
    height: 32,
    marginBottom: 7,
  },
  // .sk-cat-label{width:70%; height:9px; border-radius:4px;}
  skCatLabel: {
    width: '70%',
    height: 9,
    borderRadius: 4,
  },
  grid: {
    gap: 12,
    paddingHorizontal: ScreenPadding,
  },
  // .mine-list / .mine-row de "Mis publicaciones", sin la línea inferior: entre
  // bloques grises un separador no aporta y sí ensucia.
  rows: {
    paddingHorizontal: ScreenPadding,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  // .mine-thumb{width:76px; height:76px; border-radius:14px;}
  skRowThumb: {
    width: 76,
    height: 76,
    borderRadius: Radii.lg,
  },
  rowInfo: {
    flex: 1,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 12,
  },
  padCell: {
    flex: 1,
  },
  // Mismo contenedor que `.card` de ProductCard.
  card: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.line,
    overflow: 'hidden',
  },
  // .sk-thumb{width:100%; aspect-ratio:4/5; border-radius:16px 16px 0 0;}
  skThumb: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: 0,
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
  },
  cardInfo: {
    paddingTop: 11,
    paddingHorizontal: 12,
    paddingBottom: 13,
  },
  // .sk-line{height:10px; border-radius:4px; margin-bottom:7px;}
  skLine: {
    height: 10,
    borderRadius: 4,
    marginBottom: 7,
  },
  // Los tres anchos del frame: 40% (con height:16px), 85% y 55% sin margen final.
  skPrice: {
    width: '40%',
    height: 16,
  },
  skTitle: {
    width: '85%',
  },
  skMeta: {
    width: '55%',
    marginBottom: 0,
  },
  // .notif-row{gap:12px; padding:14px 20px; border-bottom:1px solid var(--line);
  //            align-items:flex-start;}
  notifRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: ScreenPadding,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  // .notif-icon{width:36px; height:36px; border-radius:50%;}
  skNotifIcon: {
    width: 36,
    height: 36,
    borderRadius: Radii.full,
  },
  skNotifTitle: {
    width: '55%',
  },
  skNotifDesc: {
    width: '90%',
    marginBottom: 0,
  },
  // `.form-body{padding:18px 20px 100px;}` con el `align-items:center` del frame,
  // que es lo que centra el círculo.
  perfilForm: {
    paddingTop: 18,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 100,
    alignItems: 'center',
  },
  // .photo-upload-circle{width:84px; height:84px; border-radius:50%; margin-bottom:22px;}
  skPhotoCircle: {
    width: 84,
    height: 84,
    borderRadius: Radii.full,
    marginBottom: 22,
  },
  // .field{width:100%; margin-bottom:16px;}
  perfilCampo: {
    width: '100%',
    marginBottom: 16,
  },
  // .field-label — 12.5px de texto, con sus 7px de separación al campo.
  skFieldLabel: {
    width: '35%',
    height: 10,
    borderRadius: 4,
    marginBottom: 7,
  },
  // La caja de `.text-field`/`.select-field`: 13px de padding arriba y abajo
  // sobre 14px de texto (~18 de line-height) ≈ 44.
  skFieldBox: {
    width: '100%',
    height: 44,
    borderRadius: Radii.lg,
  },
});
