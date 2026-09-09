/** Frame "Publicar" — alta de publicación (RF-05). */

import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/Buttons';
import { ListingFormFields } from '@/components/ListingFormFields';
import { FormHeader } from '@/components/ListRow';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Colors, ScreenPadding } from '@/constants/theme';
import { useExplorarState } from '@/lib/explorar-state';
import { elegirFotos, PermisoDenegadoError } from '@/lib/foto-picker';
import { useListingForm } from '@/lib/listing-form';
import { publicarListing, type ProgresoFoto } from '@/lib/publicar';
import { useSession } from '@/lib/session';
import { MAX_FOTOS } from '@/lib/storage';

export default function PublicarScreen() {
  const insets = useSafeAreaInsets();
  const { session, profile } = useSession();
  const { categorias, campusDisponibles } = useExplorarState();
  const { mostrar } = useToast();

  const form = useListingForm();
  const [guardando, setGuardando] = useState(false);
  const [progreso, setProgreso] = useState<ProgresoFoto | null>(null);

  const userId = session?.user.id ?? null;
  // La zona de entrega es el campus DEL PERFIL, no el que el usuario tenga
  // seleccionado en el Feed: ese selector cambia qué catálogo se mira, no dónde
  // se entrega lo que uno vende (CLAUDE.md §5).
  const campus = campusDisponibles.find((c) => c.id === profile?.campus_id);

  const listoParaGuardar =
    form.puedeGuardar && userId !== null && profile?.universidad_id != null && campus != null;

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

  async function publicar() {
    if (!listoParaGuardar) return;

    setGuardando(true);
    setProgreso(null);

    try {
      const resultado = await publicarListing({
        input: form.aInput(profile!.universidad_id!, campus!.id),
        userId: userId!,
        fotos: form.fotos,
        onProgreso: setProgreso,
      });

      // `replace` y no `push`: el formulario ya se envió, y "atrás" desde la
      // confirmación no debe devolver a una pantalla que volvería a publicar.
      router.replace({
        pathname: '/(publicar)/creada',
        params: {
          id: String(resultado.listingId),
          fallidas: resultado.fallidas.join(','),
          total: String(resultado.totalFotos),
        },
      });
    } catch (e: any) {
      // Solo llega aquí si falló la creación del listing: las fotos nunca
      // propagan (ver `publicarListing`). O sea que no se tocó Storage y el
      // formulario sigue completo — el usuario reintenta sin perder nada.
      console.warn('[publicar] no se pudo crear la publicación:', e?.message ?? e);
      mostrar('No pudimos publicar tu artículo. Intenta de nuevo.', 'error');
      setGuardando(false);
      setProgreso(null);
    }
  }

  const etiquetaBoton = !guardando
    ? 'Publicar artículo'
    : progreso
      ? `Subiendo foto ${progreso.actual} de ${progreso.total}…`
      : 'Publicando…';

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
              disabled: !listoParaGuardar || guardando,
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
          disabled={guardando}
        />
      </Screen>

      {/* .sticky-cta — hermano del `.screen`, anclado abajo. Fuera del Screen
          para que no scrollee con el formulario. */}
      <View style={[styles.stickyCta, { paddingBottom: insets.bottom + 22 }]}>
        <PrimaryButton
          label={etiquetaBoton}
          onPress={publicar}
          disabled={!listoParaGuardar || guardando}
          style={styles.cta}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  // .sticky-cta{position:absolute; bottom:0; left:0; right:0; padding:14px 20px 22px;
  //   background:rgba(243,240,234,0.94); border-top:1px solid var(--line);}
  stickyCta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
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
  cta: {
    marginTop: 0, // el frame le pone `style="margin-top:0"` al .primary-btn
  },
});
