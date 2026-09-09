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
import {
  componerAviso,
  esDeterminista,
  fallosDe,
  finalizarPublicacion,
  publicarListing,
  type ProgresoFoto,
} from '@/lib/publicar';
import { useSession } from '@/lib/session';
import { MAX_FOTOS } from '@/lib/storage';

/**
 * Ya no hay estado `error`: "hay error" se DERIVA de las fotos (§ el aviso, más
 * abajo). Lo único que hace falta guardar es si hay una subida en curso.
 */
type Fase = { t: 'form' } | { t: 'subiendo'; progreso: ProgresoFoto | null };

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
  /** El fallo que NO cuelga de ninguna foto: `guardarFotos()` o la activación. */
  const [falloGeneral, setFalloGeneral] = useState(false);

  const userId = session?.user.id ?? null;
  // La zona de entrega es el campus DEL PERFIL, no el que el usuario tenga
  // seleccionado en el Feed: ese selector cambia qué catálogo se mira, no dónde
  // se entrega lo que uno vende (CLAUDE.md §5).
  const campus = campusDisponibles.find((c) => c.id === profile?.campus_id);

  const listoParaGuardar =
    form.puedeGuardar && userId !== null && profile?.universidad_id != null && campus != null;

  const subiendo = fase.t === 'subiendo';

  /**
   * TODO ESTO SE DERIVA EN CADA RENDER, no se guarda.
   *
   * Es lo que hace que quitar una foto recomponga el aviso al instante y con las
   * posiciones al día: si el usuario quita la foto 2, la que era 4 pasa a ser 3
   * y el texto lo dice. Un texto congelado en estado seguiría nombrando una foto
   * que ya no está.
   */
  const fallos = fallosDe(form.fotos);
  const aviso = componerAviso(fallos, falloGeneral);
  const hayDeterminista = fallos.some((f) => esDeterminista(f.motivo));
  const hayTransitorio = fallos.some((f) => !esDeterminista(f.motivo)) || falloGeneral;

  // La publicación ya existe en la base con este texto y `finalizarPublicacion`
  // no lo reescribe, así que editarlo aquí se perdería en silencio. Las FOTOS sí
  // se pueden tocar mientras no haya una subida en curso — es la única salida
  // para un fallo determinista.
  const textoCongelado = listingId !== null || subiendo;

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
    setFalloGeneral(false);
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

      // Siempre: las que subieron pasan a 'storage' y las que fallaron quedan
      // marcadas con su motivo. De aquí sale el aviso en el próximo render.
      form.setFotos(resultado.fotos);
      setFalloGeneral(resultado.falloGeneral);
      setFase({ t: 'form' });

      if (resultado.falloGeneral || fallosDe(resultado.fotos).length > 0) return;

      // `replace` y no `push`: el formulario ya se envió, y "atrás" desde la
      // confirmación no debe devolver a una pantalla que volvería a publicar.
      router.replace({
        pathname: '/(publicar)/creada',
        params: { id: String(resultado.listingId) },
      });
    } catch (e: any) {
      // Solo llega aquí si falló `crearListing`: `finalizarPublicacion` no
      // propaga (devuelve `falloGeneral`). No se tocó Storage, no hay nada que
      // recuperar, y el formulario sigue completo.
      console.warn('[publicar] no se pudo crear la publicación:', e?.message ?? e);
      mostrar('No pudimos publicar tu artículo. Intenta de nuevo.', 'error');
      setFase({ t: 'form' });
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
              disabled: !listoParaGuardar || subiendo || (hayDeterminista && !hayTransitorio),
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
          disabled={textoCongelado}
          fotosDisabled={subiendo}
        />
      </Screen>

      {/* .sticky-cta — hermano del `.screen`, anclado abajo. Fuera del Screen
          para que no scrollee con el formulario. */}
      <View style={[styles.stickyCta, { paddingBottom: insets.bottom + 22 }]}>
        {/* El aviso vive junto al botón que lo arregla, no arriba del
            formulario: lo que informa y lo que se hace al respecto son lo
            mismo. Su margin-bottom se anula porque el gap del .sticky-cta ya
            separa (`.sticky-cta .notice{margin-bottom:0;}`). */}
        {aviso ? <Notice text={aviso} style={styles.notice} /> : null}

        {/*
          La etiqueta y el `disabled` salen del MISMO par de baldes que el
          aviso, así que texto y botón no se pueden contradecir:
           · hay algo transitorio → "Reintentar", y al tocarlo las deterministas
             se saltan sin red;
           · solo deterministas → no hay nada que reintentar, así que el botón
             se apaga hasta que el usuario quite la foto. Quitarla lo vuelve a
             encender en el mismo render en que desaparece del aviso.
        */}
        <PrimaryButton
          label={
            subiendo ? 'Subiendo imágenes' : hayTransitorio ? 'Reintentar' : 'Publicar artículo'
          }
          busy={subiendo}
          onPress={publicar}
          disabled={!listoParaGuardar || (hayDeterminista && !hayTransitorio)}
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
