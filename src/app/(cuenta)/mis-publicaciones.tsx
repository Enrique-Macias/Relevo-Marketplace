/**
 * Frame "Mis publicaciones" (+ su estado vacío y su hoja de acciones).
 *
 * POR QUÉ EXISTE ESTA PANTALLA, que no es obvio viendo el diseño: el Feed
 * filtra `estado = 'activa'`, así que en cuanto alguien pausa una publicación
 * desde "Editar" deja de existir para la app — solo se llegaba a ella
 * escribiendo su ruta a mano. Lo mismo con una que quedó sin fotos por un fallo
 * parcial de subida. Esta lista es el único lugar donde ambas son alcanzables,
 * y es lo que desbloquea el modelo atómico de publicación (CLAUDE.md §8).
 */

import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/Buttons';
import { Chip } from '@/components/Chip';
import { ConfirmModal } from '@/components/ConfirmModal';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import {
  IconChevronRight,
  IconClose,
  IconKebab,
  IconPause,
  IconPencil,
  IconPlay,
  IconPlus,
  IconTrash,
} from '@/components/icons';
import { CategoryIcon } from '@/components/icons/categories';
import { ListingPhoto } from '@/components/ListingPhoto';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { SkeletonRows } from '@/components/Skeleton';
import { StatusRow } from '@/components/StatusRow';
import { useToast } from '@/components/Toast';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';
import { useExplorarState } from '@/lib/explorar-state';
import { formatPrecio, formatRelativo } from '@/lib/format';
import {
  borrarListing,
  cambiarEstadoListing,
  useMisListings,
  type MiListing,
} from '@/lib/listings';
import { useSession } from '@/lib/session';
import { borrarFotos } from '@/lib/storage';

type EstadoListing = 'activa' | 'pausada' | 'vendida';

/** Los `.chip` del frame. `undefined` es "Todas": no manda filtro a la query. */
const FILTROS: { label: string; value: EstadoListing | undefined }[] = [
  { label: 'Todas', value: undefined },
  { label: 'Activas', value: 'activa' },
  { label: 'Pausadas', value: 'pausada' },
  { label: 'Vendidas', value: 'vendida' },
];

const ESTADO_LABEL: Record<EstadoListing, string> = {
  activa: 'Activa',
  pausada: 'Pausada',
  vendida: 'Vendida',
};

const TINT_BG: Record<string, string> = {
  brick: Colors.brickTint,
  slate: Colors.slateTint,
  gold: Colors.goldTint,
  forest: Colors.forestTint,
};

const TINT_FG: Record<string, string> = {
  brick: Colors.brick,
  slate: Colors.slate,
  gold: Colors.gold,
  forest: Colors.forest,
};

export default function MisPublicacionesScreen() {
  const { session } = useSession();
  const { mostrar } = useToast();
  const userId = session?.user.id ?? null;

  const [filtro, setFiltro] = useState<EstadoListing | undefined>(undefined);
  const { items, setItems, estado, cargandoMas, hayMas, loadMore, recargar } = useMisListings(
    userId,
    filtro
  );

  /** La publicación cuyo kebab se tocó: es lo que hace visible la hoja. */
  const [acciones, setAcciones] = useState<MiListing | null>(null);
  const [porBorrar, setPorBorrar] = useState<MiListing | null>(null);
  const [borrando, setBorrando] = useState(false);

  /**
   * Recargar al volver a la pantalla.
   *
   * Editar publicación puede haber cambiado título, precio, fotos o estado, y no
   * hay caché compartida en el proyecto que se pueda invalidar (no hay
   * react-query): la lista se vuelve a pedir. Se salta el PRIMER foco porque
   * `useMisListings` ya está cargando para ese montaje — sin este ref, entrar a
   * la pantalla dispararía dos cargas idénticas.
   */
  const primerFoco = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primerFoco.current) {
        primerFoco.current = false;
        return;
      }
      recargar();
    }, [recargar])
  );

  /**
   * Pausar / reactivar. Optimista con rollback, mismo criterio que el toggle de
   * "Editar publicación" y que el corazón de favoritos: una publicación propia
   * siempre pasa `listings_update_own`, así que el único fallo posible es de
   * transporte.
   */
  async function alternarPausa(item: MiListing) {
    const nuevo: EstadoListing = item.estado === 'pausada' ? 'activa' : 'pausada';
    setAcciones(null);
    setItems((prev) => prev.map((l) => (l.id === item.id ? { ...l, estado: nuevo } : l)));

    try {
      await cambiarEstadoListing(item.id, nuevo);
      // Con un chip de estado activo, la fila que acaba de dejar de cumplirlo ya
      // no pertenece a esta lista. Sacarla es lo que hace que el filtro siga
      // diciendo la verdad sin recargar todo.
      if (filtro && nuevo !== filtro) {
        setItems((prev) => prev.filter((l) => l.id !== item.id));
      }
      mostrar(nuevo === 'pausada' ? 'Publicación pausada' : 'Publicación reactivada');
    } catch (e: any) {
      setItems((prev) => prev.map((l) => (l.id === item.id ? { ...l, estado: item.estado } : l)));
      console.warn('[mis-publicaciones] no se pudo cambiar el estado:', e?.message ?? e);
      mostrar('No pudimos cambiar el estado de la publicación', 'error');
    }
  }

  /**
   * ORDEN OBLIGATORIO: primero los archivos, después la fila — el mismo de
   * `editar/[id].tsx`. `listing_photos_objects_delete_own` exige que el listing
   * EXISTA para autorizar el borrado del objeto, así que al revés el
   * `on delete cascade` se lleva las filas de `listing_photos` y los archivos
   * quedan en el bucket, ya sin forma de borrarlos.
   *
   * Por eso `MiListing` trae TODAS las rutas y no solo la portada: aquí no hay
   * a quién preguntárselas después.
   */
  async function eliminar(item: MiListing) {
    setBorrando(true);
    try {
      await borrarFotos(item.fotos);
      await borrarListing(item.id);
      setItems((prev) => prev.filter((l) => l.id !== item.id));
      mostrar('Publicación eliminada');
    } catch (e: any) {
      console.warn('[mis-publicaciones] no se pudo eliminar:', e?.message ?? e);
      mostrar('No pudimos eliminar la publicación', 'error');
    } finally {
      setBorrando(false);
      setPorBorrar(null);
    }
  }

  const vacia = estado === 'ready' && items.length === 0;

  return (
    <>
      <Screen
        header={<PageHeader title="Mis publicaciones" />}
        onEndReached={hayMas ? loadMore : undefined}
      >
        <StatusBar style="dark" />

        {/* Mismo patrón que Categoría: sin `flexGrow:0` el ScrollView horizontal
            se estira con el `flexGrow:1` de `Screen`, y sin
            `alignItems:'flex-start'` cada Chip se estira a esa altura. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chips}
        >
          {FILTROS.map((f) => (
            <Chip
              key={f.label}
              label={f.label}
              active={filtro === f.value}
              onPress={() => setFiltro(f.value)}
            />
          ))}
        </ScrollView>

        {estado === 'error' ? (
          <ErrorState
            onRetry={recargar}
            title="No pudimos cargar tus publicaciones"
            sub="Revisa tu conexión e intenta de nuevo."
          />
        ) : estado === 'loading' ? (
          <SkeletonRows filas={4} style={styles.skeleton} />
        ) : vacia ? (
          <VacioSegunFiltro filtro={filtro} />
        ) : (
          <View style={styles.lista}>
            {items.map((item, i) => (
              <MiListingRow
                key={item.id}
                item={item}
                last={i === items.length - 1}
                onPress={() => router.push(`/detalle/${item.id}`)}
                onAcciones={() => setAcciones(item)}
              />
            ))}
            {/* Mismo afordance que Búsqueda y Categoría al paginar: el esqueleto
                de lo que viene, no un spinner. */}
            {cargandoMas ? <SkeletonRows filas={2} style={styles.skeletonMas} /> : null}
          </View>
        )}
      </Screen>

      <HojaAcciones
        item={acciones}
        onCerrar={() => setAcciones(null)}
        onAlternarPausa={alternarPausa}
        onEditar={(item) => {
          setAcciones(null);
          router.push(`/(publicar)/editar/${item.id}`);
        }}
        onEliminar={(item) => {
          setAcciones(null);
          setPorBorrar(item);
        }}
      />

      <ConfirmModal
        visible={porBorrar !== null}
        icon={<IconTrash size={22} color={Colors.brick} />}
        title="¿Eliminar publicación?"
        body="Se borrarán también sus fotos. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={() => porBorrar && eliminar(porBorrar)}
        onCancel={() => setPorBorrar(null)}
        confirming={borrando}
      />
    </>
  );
}

/**
 * Dos vacíos distintos: "nunca has publicado" pide una acción; "el chip no
 * encontró nada" no —el remedio es tocar otro chip, no publicar—, así que ese
 * no lleva CTA.
 */
function VacioSegunFiltro({ filtro }: { filtro: EstadoListing | undefined }) {
  if (filtro) {
    return (
      <EmptyState
        icon={<IconPause size={30} color={Colors.inkSoft} />}
        title="Nada por aquí"
        sub={`No tienes publicaciones ${ESTADO_LABEL[filtro].toLowerCase()}s en este momento.`}
      />
    );
  }

  return (
    <EmptyState
      icon={<IconPlus size={30} color={Colors.inkSoft} />}
      title="Aún no has publicado nada"
      sub="Lo que ya no usas le sirve a alguien de tu campus. Publicar toma menos de un minuto."
    >
      <PrimaryButton label="Publicar algo" onPress={() => router.push('/(publicar)/nueva')} />
    </EmptyState>
  );
}

/** `.mine-row` — miniatura + precio/título/meta + kebab. */
function MiListingRow({
  item,
  last,
  onPress,
  onAcciones,
}: {
  item: MiListing;
  last: boolean;
  onPress: () => void;
  onAcciones: () => void;
}) {
  // El slug y el tinte son presentación derivada del catálogo cargado, no
  // columnas de `listings` — igual que en `ProductCard`.
  const { getCategoria } = useExplorarState();
  const categoria = getCategoria(item.categoriaId);
  const tint = categoria?.tint ?? 'brick';
  const sinFotos = item.fotos.length === 0;

  return (
    <Pressable style={[styles.row, last && styles.rowLast]} onPress={onPress}>
      <View style={[styles.thumb, { backgroundColor: TINT_BG[tint] }]}>
        <ListingPhoto
          path={item.fotoPath}
          fallback={
            <CategoryIcon categoriaId={categoria?.slug ?? ''} size={26} color={TINT_FG[tint]} />
          }
          style={styles.foto}
          accessibilityLabel={item.titulo}
        />
        {/* .sold-badge — el mismo overlay que el grid del frame Perfil. */}
        {item.estado === 'vendida' ? (
          <View style={styles.soldBadge}>
            <Text style={styles.soldBadgeText}>Vendido</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.info}>
        <Text style={styles.precio}>{formatPrecio(item.precio)}</Text>
        <Text style={styles.titulo} numberOfLines={1}>
          {item.titulo}
        </Text>
        <View style={styles.meta}>
          {/* "Sin fotos" va PRIMERO y en --brick: es el caso que motiva esta
              pantalla, y en la miniatura no se distingue de una publicación
              cuya foto todavía no carga. */}
          {sinFotos ? (
            <>
              <Text style={[styles.estado, styles.estadoWarn]}>Sin fotos</Text>
              <Text style={styles.sep}>·</Text>
            </>
          ) : null}
          <Text style={[styles.estado, item.estado === 'activa' && styles.estadoActiva]}>
            {ESTADO_LABEL[item.estado]}
          </Text>
          <Text style={styles.sep}>·</Text>
          {/* Con 0 vistas el dato no dice nada; la fecha sí. */}
          {item.vistasCount > 0 ? (
            <>
              <Text style={styles.metaText}>{item.vistasCount} vistas</Text>
              <Text style={styles.sep}>·</Text>
            </>
          ) : null}
          <Text style={styles.metaText}>{formatRelativo(new Date(item.createdAt))}</Text>
        </View>
      </View>

      <Pressable onPress={onAcciones} hitSlop={12} accessibilityRole="button">
        <IconKebab size={16} color={Colors.inkSoft} />
      </Pressable>
    </Pressable>
  );
}

/**
 * La hoja de acciones — un `Modal` de RN, NO una ruta de Stack, y la diferencia
 * importa: eliminar necesita las rutas de Storage de ESTA fila, que ya están en
 * memoria. Una ruta aparte solo recibe params serializables y obligaría a
 * re-fetchear la publicación o a inventar un canal de vuelta hacia la lista.
 * Es el mismo criterio que separa `CampusBottomSheet` de `SheetScreen`
 * (CLAUDE.md §8b): son dos patrones de hoja para dos casos distintos.
 *
 * El contenido es la `.status-section` del frame "Editar publicación" tal cual,
 * por eso comparte `StatusRow` con esa pantalla.
 */
function HojaAcciones({
  item,
  onCerrar,
  onAlternarPausa,
  onEditar,
  onEliminar,
}: {
  item: MiListing | null;
  onCerrar: () => void;
  onAlternarPausa: (item: MiListing) => void;
  onEditar: (item: MiListing) => void;
  onEliminar: (item: MiListing) => void;
}) {
  if (!item) return null;

  // Una publicación vendida no se pausa ni se reactiva: ese estado es terminal
  // (RF-07 conserva el historial). La fila simplemente no se pinta.
  const puedeAlternar = item.estado !== 'vendida';

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
                onPress={() => onAlternarPausa(item)}
              />
            ) : null}

            <StatusRow
              icon={<IconPencil size={16} color={Colors.inkSoft} />}
              label="Editar publicación"
              trailing={<IconChevronRight size={14} color={Colors.inkSoft} />}
              onPress={() => onEditar(item)}
            />

            <StatusRow
              icon={<IconTrash size={16} color={Colors.brick} />}
              label="Eliminar publicación"
              danger
              onPress={() => onEliminar(item)}
              last
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  chipsScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  // .chips{display:flex; gap:8px; padding:14px 20px 4px;}
  chips: {
    alignItems: 'flex-start',
    gap: 8,
    paddingTop: 14,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 4,
  },
  skeleton: {
    paddingTop: 6,
  },
  // Ya va dentro de `.mine-list`, que aporta su propio padding horizontal.
  skeletonMas: {
    paddingHorizontal: 0,
  },
  // .mine-list{padding:6px 20px 100px;}
  lista: {
    paddingTop: 6,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 100,
  },
  // .mine-row{display:flex; align-items:center; gap:12px; padding:13px 0; border-bottom:1px solid var(--line);}
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  // .mine-row:last-child{border-bottom:none;}
  rowLast: {
    borderBottomWidth: 0,
  },
  // .mine-thumb{width:76px; height:76px; border-radius:14px; overflow:hidden;}
  thumb: {
    width: 76,
    height: 76,
    borderRadius: Radii.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  foto: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // .sold-badge{position:absolute; inset:0; background:rgba(34,31,28,0.55);}
  soldBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(34,31,28,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // .sold-badge{color:#fff; font-size:11px; font-weight:600; letter-spacing:0.03em;}
  soldBadgeText: {
    ...Typography.caption,
    color: '#FFFFFF',
    letterSpacing: 0.33,
  },
  // .mine-info{flex:1; min-width:0;}
  info: {
    flex: 1,
  },
  // .mine-price{font-size:19px; line-height:1;}
  precio: {
    ...Typography.price,
    color: Colors.ink,
    lineHeight: 19,
  },
  // .mine-title{font-size:13px; font-weight:500; margin-top:5px;}
  titulo: {
    ...Typography.bodyStrong,
    color: Colors.ink,
    marginTop: 5,
  },
  // .mine-meta{display:flex; align-items:center; gap:5px; font-size:11px; margin-top:6px;}
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
  },
  metaText: {
    ...Typography.metaLight,
    color: Colors.inkSoft,
  },
  // .mine-meta .sep{color:var(--line);}
  sep: {
    ...Typography.metaLight,
    color: Colors.line,
  },
  // .mine-state{font-weight:600;} — sin modificador hereda --ink-soft.
  estado: {
    ...Typography.caption,
    color: Colors.inkSoft,
  },
  // .mine-state.activa{color:var(--forest);}
  estadoActiva: {
    color: Colors.forest,
  },
  // .mine-state.warn{color:var(--brick);}
  estadoWarn: {
    color: Colors.brick,
  },
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
