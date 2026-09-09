/**
 * Frame "Editar publicación" (RF-06, RF-08).
 *
 * El formulario es el MISMO componente que "Publicar" (`ListingFormFields`):
 * tras actualizar el diseño, los dos frames tienen los mismos campos en el
 * mismo orden. Lo propio de esta pantalla es la `.status-section` de abajo.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConfirmModal } from '@/components/ConfirmModal';
import { ErrorState } from '@/components/ErrorState';
import { IconCheckCircle, IconChevronRight, IconPause, IconTrash } from '@/components/icons';
import { ListingFormFields } from '@/components/ListingFormFields';
import { FormHeader } from '@/components/ListRow';
import { idFoto, type FotoEnEdicion } from '@/components/PhotoRow';
import { Screen } from '@/components/Screen';
import { SectionHead } from '@/components/SectionHead';
import { SkeletonGrid } from '@/components/Skeleton';
import { StatusRow } from '@/components/StatusRow';
import { useToast } from '@/components/Toast';
import { Colors, Radii, ScreenPadding } from '@/constants/theme';
import { useExplorarState } from '@/lib/explorar-state';
import { elegirFotos, PermisoDenegadoError } from '@/lib/foto-picker';
import { useListingForm } from '@/lib/listing-form';
import {
  borrarListing,
  cambiarEstadoListing,
  fetchListingParaEditar,
  type ListingDetalle,
} from '@/lib/listings';
import { guardarEdicion, type ProgresoFoto } from '@/lib/publicar';
import { useSession } from '@/lib/session';
import { borrarFotos, MAX_FOTOS } from '@/lib/storage';

export default function EditarPublicacionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listingId = Number(id);

  const [listing, setListing] = useState<ListingDetalle | null>(null);
  // Mismo idioma que Detalle y `session.tsx`: de qué publicación es lo que
  // tenemos, en vez de un flag que habría que limpiar dentro del efecto.
  const [cargadoPara, setCargadoPara] = useState<number | null>(null);
  const [errorPara, setErrorPara] = useState<number | null>(null);
  const [recargas, setRecargas] = useState(0);

  const idValido = !Number.isNaN(listingId);

  useEffect(() => {
    if (!idValido) return;

    let vigente = true;
    fetchListingParaEditar(listingId)
      .then((data) => {
        if (!vigente) return;
        setListing(data);
        setCargadoPara(listingId);
      })
      .catch((e) => {
        if (!vigente) return;
        console.warn('[editar] no se pudo leer la publicación:', e?.message ?? e);
        setErrorPara(listingId);
      });

    return () => {
      vigente = false;
    };
  }, [listingId, recargas, idValido]);

  const estado: 'loading' | 'ready' | 'error' =
    !idValido || errorPara === listingId
      ? 'error'
      : cargadoPara === listingId && listing
        ? 'ready'
        : 'loading';

  if (estado === 'ready' && listing) {
    // `key` fuerza el remontaje al cambiar de publicación: `useListingForm` toma
    // sus valores iniciales en el primer render, así que reusar la instancia
    // dejaría los campos de la publicación anterior.
    return <FormularioCargado key={listing.id} listing={listing} />;
  }

  return (
    <Screen header={<FormHeader title="Editar publicación" />}>
      <StatusBar style="dark" />
      {estado === 'error' ? (
        <ErrorState
          onRetry={() => setRecargas((n) => n + 1)}
          title="No pudimos abrir la publicación"
          sub="Revisa tu conexión e intenta de nuevo."
        />
      ) : (
        <SkeletonGrid tarjetas={2} style={styles.skeleton} />
      )}
    </Screen>
  );
}

/**
 * El formulario, montado solo cuando ya hay datos.
 *
 * Todo el estado de edición vive AQUÍ y no en el componente de ruta: al
 * remontarse por `key` con cada publicación, se reinicia solo. Subirlo un nivel
 * obligaría a limpiarlo a mano en cada cambio de id.
 */
function FormularioCargado({ listing }: { listing: ListingDetalle }) {
  const { session, profile } = useSession();
  const { categorias, campusDisponibles } = useExplorarState();
  const { mostrar } = useToast();

  const [guardando, setGuardando] = useState(false);
  const [progreso, setProgreso] = useState<ProgresoFoto | null>(null);
  const [pausada, setPausada] = useState(listing.estado === 'pausada');
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const [borrando, setBorrando] = useState(false);

  const userId = session?.user.id ?? null;
  const universidadId = profile?.universidad_id ?? null;
  const campusId = profile?.campus_id ?? null;
  const campusNombre = campusDisponibles.find((c) => c.id === campusId)?.nombre;

  const fotosIniciales: FotoEnEdicion[] = useMemo(
    () => listing.fotos.map((path) => ({ origen: 'storage' as const, path })),
    [listing.fotos]
  );

  const form = useListingForm({
    titulo: listing.titulo,
    precio: String(listing.precio),
    descripcion: listing.descripcion ?? '',
    categoriaId: listing.categoriaId,
    condicion: listing.condicion,
    fotos: fotosIniciales,
  });

  // Solo si el set cambió se reescribe `listing_photos` — ver por qué importa
  // en `guardarEdicion()`: esa reescritura borra todas las filas antes de
  // reinsertarlas, y editar solo el precio no debe pagar ese riesgo.
  const firmaInicial = useMemo(() => fotosIniciales.map(idFoto).join('|'), [fotosIniciales]);
  const fotosCambiaron = form.firmaFotos !== firmaInicial;

  /**
   * Guard de NAVEGACIÓN, no de autorización — la autorización sigue viviendo en
   * `listings_update_own`, que es la que de verdad rechaza (CLAUDE.md §0 regla
   * 7). Esto solo evita pintarle a un no-dueño un formulario que fallaría con
   * 42501 al guardar: `listings_select` deja leer las publicaciones ajenas no
   * pausadas, así que la ruta es alcanzable escribiéndola a mano.
   */
  const esDueno = userId !== null && listing.userId === userId;

  const ocupado = guardando || borrando;

  async function agregarFoto() {
    try {
      const { fotos, descartadas } = await elegirFotos(MAX_FOTOS - form.fotos.length);
      form.agregarFotos(fotos);
      if (descartadas > 0) {
        mostrar(
          descartadas === 1
            ? 'Una foto está en un formato que no podemos usar'
            : `${descartadas} fotos están en un formato que no podemos usar`,
          'error'
        );
      }
    } catch (e) {
      if (e instanceof PermisoDenegadoError) {
        mostrar('Necesitamos acceso a tus fotos para agregarlas', 'error');
        return;
      }
      console.warn('[editar] no se pudo abrir el carrete:', e);
      mostrar('No pudimos abrir tus fotos', 'error');
    }
  }

  async function guardar() {
    if (!form.puedeGuardar || universidadId == null || campusId == null) return;

    setGuardando(true);
    setProgreso(null);

    try {
      const resultado = await guardarEdicion({
        listingId: listing.id,
        input: form.aInput(universidadId, campusId),
        fotos: form.fotos,
        pathsOriginales: listing.fotos,
        fotosCambiaron,
        onProgreso: setProgreso,
      });

      if (resultado.fallidas.length > 0) {
        // No se navega: el usuario se queda en el formulario, que sigue siendo
        // el lugar donde puede volver a intentarlo.
        mostrar(
          `Se guardó, pero ${resultado.fallidas.length} de ${resultado.totalFotos} fotos no se subieron`,
          'error'
        );
        setGuardando(false);
        setProgreso(null);
        return;
      }

      mostrar('Publicación actualizada');
      router.back();
    } catch (e: any) {
      console.warn('[editar] no se pudo guardar:', e?.message ?? e);
      mostrar('No pudimos guardar los cambios. Intenta de nuevo.', 'error');
      setGuardando(false);
      setProgreso(null);
    }
  }

  async function alternarPausa() {
    const anterior = pausada;
    // Optimista, mismo criterio que el corazón de favoritos: una publicación
    // propia siempre pasa `listings_update_own`, así que el único fallo posible
    // es de transporte. Se revierte si ocurre.
    setPausada(!anterior);
    try {
      await cambiarEstadoListing(listing.id, anterior ? 'activa' : 'pausada');
    } catch (e: any) {
      setPausada(anterior);
      console.warn('[editar] no se pudo cambiar el estado:', e?.message ?? e);
      mostrar('No pudimos cambiar el estado de la publicación', 'error');
    }
  }

  /**
   * ORDEN OBLIGATORIO: primero los archivos, después la fila.
   *
   * `listing_photos_objects_delete_own` exige que el listing EXISTA para
   * autorizar el borrado del objeto. Si se borrara el listing primero, el
   * `on delete cascade` se llevaría las filas de `listing_photos` pero los
   * archivos quedarían en el bucket, y ya sin forma de borrarlos porque la
   * policy no tendría contra qué validar. Esto es lo que cierra la deuda
   * "borrar una publicación no borra sus fotos de Storage" de CLAUDE.md §8.
   */
  async function eliminar() {
    setBorrando(true);
    try {
      await borrarFotos(listing.fotos);
      await borrarListing(listing.id);
      mostrar('Publicación eliminada');
      router.replace('/(tabs)');
    } catch (e: any) {
      console.warn('[editar] no se pudo eliminar:', e?.message ?? e);
      mostrar('No pudimos eliminar la publicación', 'error');
      setBorrando(false);
      setConfirmandoBorrado(false);
    }
  }

  if (!esDueno) {
    return (
      <Screen header={<FormHeader title="Editar publicación" />}>
        <StatusBar style="dark" />
        <ErrorState
          onRetry={() => router.back()}
          title="Esta publicación no es tuya"
          sub="Solo puedes editar las publicaciones que tú creaste."
        />
      </Screen>
    );
  }

  const etiquetaGuardar = !guardando
    ? 'Guardar'
    : progreso
      ? `${progreso.actual}/${progreso.total}`
      : 'Guardando…';

  return (
    <>
      <Screen
        header={
          <FormHeader
            title="Editar publicación"
            trailing={{
              label: etiquetaGuardar,
              onPress: guardar,
              disabled: !form.puedeGuardar || ocupado,
            }}
          />
        }
      >
        <StatusBar style="dark" />

        <ListingFormFields
          form={form}
          categorias={categorias}
          zonaEntrega={campusNombre}
          onAgregarFoto={agregarFoto}
          disabled={ocupado}
        />

        {/* El frame le pone `style="padding-top:4px"` al .section-head. */}
        <SectionHead title="Estado de la publicación" style={styles.sectionHead} />

        <View style={styles.statusSection}>
          <StatusRow
            icon={<IconPause size={16} color={Colors.inkSoft} />}
            label="Pausar publicación"
            onPress={ocupado ? undefined : alternarPausa}
            trailing={<Toggle on={pausada} />}
          />

          {/*
            "Marcar como vendida" queda INERTE a propósito: dispara el flujo
            "¿A quién le vendiste?" del grupo Confianza, fuera del alcance de
            esta tarea. Cablearla como un update suelto a 'vendida' saltándose
            ese paso rompería RF-12 —el vendedor nunca elegiría comprador y
            nadie podría calificar— así que es mejor que no haga nada a que
            haga lo incorrecto.
          */}
          <StatusRow
            icon={<IconCheckCircle size={16} color={Colors.inkSoft} />}
            label="Marcar como vendida"
            trailing={<IconChevronRight size={14} color={Colors.inkSoft} />}
          />

          <StatusRow
            icon={<IconTrash size={16} color={Colors.brick} />}
            label="Eliminar publicación"
            danger
            onPress={ocupado ? undefined : () => setConfirmandoBorrado(true)}
            last
          />
        </View>
      </Screen>

      <ConfirmModal
        visible={confirmandoBorrado}
        icon={<IconTrash size={22} color={Colors.brick} />}
        title="¿Eliminar publicación?"
        body="Se borrarán también sus fotos. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={eliminar}
        onCancel={() => setConfirmandoBorrado(false)}
        confirming={borrando}
      />
    </>
  );
}

/** `.toggle` + `.toggle-knob`. */
function Toggle({ on }: { on: boolean }) {
  return (
    <View style={[styles.toggle, on && styles.toggleOn]}>
      <View style={[styles.toggleKnob, on && styles.toggleKnobOn]} />
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: {
    paddingTop: 18,
  },
  sectionHead: {
    paddingTop: 4,
  },
  // .status-section{padding:6px 20px 100px;}
  statusSection: {
    paddingTop: 6,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 100,
  },
  // .toggle{width:40px; height:24px; border-radius:12px; background:var(--line);}
  toggle: {
    width: 40,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.line,
  },
  // .toggle.on{background:var(--forest);}
  toggleOn: {
    backgroundColor: Colors.forest,
  },
  // .toggle-knob{top:2px; left:2px; width:20px; height:20px; border-radius:50%; background:#fff;}
  toggleKnob: {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 20,
    height: 20,
    borderRadius: Radii.full,
    backgroundColor: '#FFFFFF',
  },
  // .toggle.on .toggle-knob{left:18px;}
  toggleKnobOn: {
    left: 18,
  },
});
