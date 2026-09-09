/**
 * Frames "Publicar", "Publicar (subiendo imágenes)" y "Publicar (error de
 * subida)" — alta de publicación (RF-05). Un solo componente con tres estados,
 * como Categoría o Búsqueda.
 *
 * EL ALTA ES ATÓMICA: la publicación se crea `pausada`, suben todas sus fotos, y
 * solo si TODAS suben pasa a `activa`. Reemplaza al modelo de "publica ya,
 * recupera fotos después", donde un fallo parcial dejaba la publicación visible
 * con menos fotos de las que el usuario eligió y había que contárselo al final.
 *
 * Los dos estados nuevos existen porque eso vuelve la subida un momento con
 * duración y con posibilidad de fallar, del que el usuario tiene que enterarse
 * SIN salir de esta pantalla — que es donde se reintenta.
 */

import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/Buttons';
import { ListingFormFields } from '@/components/ListingFormFields';
import { FormHeader } from '@/components/ListRow';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Colors, ScreenPadding } from '@/constants/theme';
import { useExplorarState } from '@/lib/explorar-state';
import { elegirFotos, PermisoDenegadoError } from '@/lib/foto-picker';
import { useListingForm } from '@/lib/listing-form';
import { finalizarPublicacion, publicarListing, type ProgresoFoto } from '@/lib/publicar';
import { useSession } from '@/lib/session';
import { MAX_FOTOS } from '@/lib/storage';

/**
 * Los tres estados del frame. Un estado explícito y no dos booleanos sueltos:
 * "subiendo" y "error" son mutuamente excluyentes, y cada uno trae su propio
 * dato (el progreso, el texto del aviso) que no tiene sentido fuera de él.
 */
type Fase =
  | { t: 'form' }
  | { t: 'subiendo'; progreso: ProgresoFoto | null }
  | { t: 'error'; texto: string };

export default function PublicarScreen() {
  const insets = useSafeAreaInsets();
  const { session, profile } = useSession();
  const { categorias, campusDisponibles } = useExplorarState();
  const { mostrar } = useToast();

  const form = useListingForm();
  const [fase, setFase] = useState<Fase>({ t: 'form' });
  /**
   * El id de la publicación ya creada, si llegó a crearse.
   *
   * Es lo que separa un reintento de una segunda publicación: sin esto, tocar
   * "Reintentar" volvería a correr `crearListing` y dejaría una publicación
   * huérfana `pausada` por cada intento fallido.
   */
  const [listingId, setListingId] = useState<number | null>(null);

  const userId = session?.user.id ?? null;
  // La zona de entrega es el campus DEL PERFIL, no el que el usuario tenga
  // seleccionado en el Feed: ese selector cambia qué catálogo se mira, no dónde
  // se entrega lo que uno vende (CLAUDE.md §5).
  const campus = campusDisponibles.find((c) => c.id === profile?.campus_id);

  const listoParaGuardar =
    form.puedeGuardar && userId !== null && profile?.universidad_id != null && campus != null;

  // El formulario se congela en cuanto la publicación existe en la base: seguir
  // editando el texto en pantalla lo desincronizaría de lo ya guardado, y en el
  // estado de error los campos que se ven son los que la publicación YA tiene.
  const ocupado = fase.t !== 'form';

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
      console.warn('[publicar] no se pudo abrir el carrete:', e);
      mostrar('No pudimos abrir tus fotos', 'error');
    }
  }

  /** Publicar y reintentar son la MISMA función: lo que cambia es si ya hay id. */
  async function publicar() {
    if (!listoParaGuardar) return;

    setFase({ t: 'subiendo', progreso: null });
    const onProgreso = (progreso: ProgresoFoto) => setFase({ t: 'subiendo', progreso });

    try {
      const resultado =
        listingId === null
          ? await publicarListing({
              input: form.aInput(profile!.universidad_id!, campus!.id),
              userId: userId!,
              fotos: form.fotos,
              onProgreso,
              // Se guarda ANTES de subir, no al terminar: si la subida falla,
              // este id es lo único que hace posible el reintento.
              onListingCreado: setListingId,
            })
          : await finalizarPublicacion({ listingId, fotos: form.fotos, onProgreso });

      // Siempre, aun con fallidas: las que sí subieron pasan a ser 'storage' y
      // el próximo intento se las salta. Esto ES el reintento parcial.
      form.setFotos(resultado.fotos);

      if (resultado.fallidas.length > 0) {
        const n = resultado.fallidas.length;
        setFase({
          t: 'error',
          texto:
            `${n} de ${resultado.totalFotos} ${n === 1 ? 'foto no se subió' : 'fotos no se subieron'}. ` +
            'Tu publicación quedó en pausa.',
        });
        return;
      }

      // `replace` y no `push`: el formulario ya se envió, y "atrás" desde la
      // confirmación no debe devolver a una pantalla que volvería a publicar.
      router.replace({
        pathname: '/(publicar)/creada',
        params: { id: String(resultado.listingId) },
      });
    } catch (e: any) {
      console.warn('[publicar] no se pudo publicar:', e?.message ?? e);

      if (listingId === null) {
        // Falló el insert del listing: no se tocó Storage, no hay nada que
        // recuperar, y el formulario sigue completo. Vuelve al estado inicial.
        mostrar('No pudimos publicar tu artículo. Intenta de nuevo.', 'error');
        setFase({ t: 'form' });
        return;
      }

      // La publicación ya existe: reventó `guardarFotos` o la activación. El
      // mismo "Reintentar" los resuelve, porque `finalizarPublicacion` es
      // idempotente.
      setFase({
        t: 'error',
        texto: 'No pudimos terminar de publicar. Tu publicación quedó en pausa.',
      });
    }
  }

  return (
    <>
      <StatusBar style="dark" />
      <Screen
        header={
          <FormHeader
            title="Nueva publicación"
            leading="close"
            onLeadingPress={() => router.back()}
            trailing={{
              label: 'Guardar',
              onPress: publicar,
              disabled: !listoParaGuardar || ocupado,
            }}
          />
        }
        // El `.form-body` del prototipo reserva 100px abajo para no quedar
        // tapado por el `.sticky-cta`; aquí se suma el safe area real.
        contentStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        <ListingFormFields
          form={form}
          categorias={categorias}
          zonaEntrega={campus?.nombre}
          onAgregarFoto={agregarFoto}
          disabled={ocupado}
        />
      </Screen>

      {/* .sticky-cta — hermano del `.screen`, anclado abajo. Fuera del Screen
          para que no scrollee con el formulario. */}
      <View style={[styles.stickyCta, { paddingBottom: insets.bottom + 22 }]}>
        {/* El aviso vive junto al botón que lo arregla, no arriba del
            formulario: lo que informa y lo que se hace al respecto son lo
            mismo. Su margin-bottom se anula porque el gap del .sticky-cta ya
            separa (`.sticky-cta .notice{margin-bottom:0;}`). */}
        {fase.t === 'error' ? <Notice text={fase.texto} style={styles.notice} /> : null}

        <PrimaryButton
          label={
            fase.t === 'subiendo'
              ? 'Subiendo imágenes'
              : fase.t === 'error'
                ? 'Reintentar'
                : 'Publicar artículo'
          }
          busy={fase.t === 'subiendo'}
          onPress={publicar}
          disabled={!listoParaGuardar}
          style={styles.cta}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  // .sticky-cta{position:absolute; bottom:0; left:0; right:0; padding:14px 20px 22px;
  //   background:rgba(243,240,234,0.94); border-top:1px solid var(--line); gap:10px;}
  stickyCta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    gap: 10,
    paddingTop: 14,
    paddingHorizontal: ScreenPadding,
    // El prototipo usa `rgba(243,240,234,0.94)` + `backdrop-filter:blur(10px)`.
    // RN no tiene backdrop-filter (expo-glass-effect sí, pero es iOS 26+ y
    // aquí el efecto es decorativo), así que se toma el color plano: el
    // contenido de abajo queda cubierto igual, que es lo que la barra necesita.
    backgroundColor: Colors.paper,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  // `.sticky-cta.stacked{flex-direction:column;}` no necesita traducción: en CSS
  // el default de flex es `row` y el modificador lo voltea, pero en RN `column`
  // YA es el default de un View. Traerlo como estilo sería un no-op.
  //
  // .sticky-cta .notice{margin-bottom:0;}
  notice: {
    marginBottom: 0,
  },
  cta: {
    marginTop: 0, // el frame le pone `style="margin-top:0"` al .primary-btn
  },
});
