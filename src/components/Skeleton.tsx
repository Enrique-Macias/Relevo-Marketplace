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
});
