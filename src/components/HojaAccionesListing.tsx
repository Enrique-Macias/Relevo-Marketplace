/**
 * La hoja de acciones de una publicación (pausar/reactivar, editar, marcar
 * como vendida/cambiar comprador, eliminar) — compartida por "Mis
 * publicaciones" y por el kebab de "Detalle (vista vendedor)".
 *
 * Es un `Modal` de RN, NO una ruta de Stack: el llamador ya tiene el estado y
 * las rutas de Storage de la publicación en memoria (o los puede resolver
 * él mismo), y una ruta aparte solo recibiría params serializables —
 * obligaría a re-fetchear o a inventar un canal de vuelta. Mismo criterio que
 * separa `CampusBottomSheet` de `SheetScreen` (CLAUDE.md §8).
 *
 * Las decisiones de qué fila mostrar viven AQUÍ, no en cada llamador:
 * `puedeAlternarPausa()`, `puedeEditarListing()` y `accionVenta()` se calculan
 * una sola vez, adentro, a partir de `estado` y `venta` — nunca recalculadas
 * afuera con un `estado === 'activa' || estado === 'pausada'` inline.
 */

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  IconCheckCircle,
  IconChevronRight,
  IconClose,
  IconPause,
  IconPencil,
  IconPlay,
  IconTrash,
} from '@/components/icons';
import { StatusRow } from '@/components/StatusRow';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';
import { accionVenta, LABEL_ACCION_VENTA, type Venta } from '@/lib/confianza';
import { puedeAlternarPausa, puedeEditarListing, type EstadoListing } from '@/lib/listings';

type Props = {
  item: { titulo: string; estado: EstadoListing } | null;
  venta: Venta | null;
  onCerrar: () => void;
  onAlternarPausa: () => void;
  onEditar: () => void;
  onVenta: () => void;
  onEliminar: () => void;
};

export function HojaAccionesListing({
  item,
  venta,
  onCerrar,
  onAlternarPausa,
  onEditar,
  onVenta,
  onEliminar,
}: Props) {
  if (!item) return null;

  const puedeAlternar = puedeAlternarPausa(item.estado);
  const puedeEditar = puedeEditarListing(item.estado);
  const accion = accionVenta(item.estado, venta);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCerrar}>
      <Pressable style={styles.backdrop} onPress={onCerrar}>
        {/* El onPress vacío NO es un descuido: es lo que hace que este Pressable
            se vuelva responder del toque y no lo deje burbujear al backdrop, que
            cerraría la hoja al tocar su propio contenido. Sin él, un Pressable
            sin handler no reclama el gesto. */}
        <Pressable style={styles.sheetCard} onPress={() => {}}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {item.titulo}
            </Text>
            <Pressable onPress={onCerrar} hitSlop={12} accessibilityRole="button">
              <IconClose size={18} color={Colors.ink} />
            </Pressable>
          </View>

          <View style={styles.statusSection}>
            {puedeAlternar ? (
              <StatusRow
                icon={
                  item.estado === 'pausada' ? (
                    <IconPlay size={16} color={Colors.inkSoft} />
                  ) : (
                    <IconPause size={16} color={Colors.inkSoft} />
                  )
                }
                label={
                  item.estado === 'pausada' ? 'Reactivar publicación' : 'Pausar publicación'
                }
                onPress={onAlternarPausa}
              />
            ) : null}

            {puedeEditar ? (
              <StatusRow
                icon={<IconPencil size={16} color={Colors.inkSoft} />}
                label="Editar publicación"
                trailing={<IconChevronRight size={14} color={Colors.inkSoft} />}
                onPress={onEditar}
              />
            ) : null}

            {/* La fila de venta, con el MISMO derivado de tres estados que usa
                "Editar publicación" y el `.sticky-cta` de Detalle — por eso vive
                en `src/lib/confianza.ts` y no se recalcula por pantalla. */}
            {accion ? (
              <StatusRow
                icon={<IconCheckCircle size={16} color={Colors.inkSoft} />}
                label={LABEL_ACCION_VENTA[accion]}
                trailing={<IconChevronRight size={14} color={Colors.inkSoft} />}
                onPress={onVenta}
              />
            ) : null}

            <StatusRow
              icon={<IconTrash size={16} color={Colors.brick} />}
              label="Eliminar publicación"
              danger
              onPress={onEliminar}
              last
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // .modal-backdrop con align-items:flex-end — ancla la hoja abajo.
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(34,31,28,0.55)',
    justifyContent: 'flex-end',
  },
  // .sheet-card{width:100%; background:var(--card); border-radius:20px 20px 0 0;}
  sheetCard: {
    width: '100%',
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    overflow: 'hidden',
  },
  // .sheet-handle{width:36px; height:4px; border-radius:2px; margin:10px auto 6px;}
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.line,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  // .sheet-header{padding:6px 20px 14px; border-bottom:1px solid var(--line);}
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 6,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  sheetTitle: {
    ...Typography.sheetTitle,
    color: Colors.ink,
    flex: 1,
  },
  // .status-section, con el padding inferior de la hoja (24) en vez del de
  // Editar (100): aquí la tarjeta termina donde termina el contenido.
  statusSection: {
    paddingTop: 6,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 24,
  },
});
