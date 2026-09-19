/**
 * Frame "Publicación no aprobada" (RF-18).
 *
 * Hermana de "Publicación creada" y de "en revisión" — ver el docblock de
 * `revision.tsx` para por qué son tres pantallas y no una con estados.
 *
 * ESTA NO LLEVA REALTIME, y no es un olvido: `bloqueada → activa` no ocurre por
 * ningún camino (CLAUDE.md §3), así que no hay nada que esperar. Se lee una vez
 * el título y ya.
 *
 * Y NO OFRECE "EDITAR PUBLICACIÓN", que es el CTA que pide el instinto para que
 * el usuario la arregle. No se puede: `listings_update_own` excluye `bloqueada`
 * de su `using` (20260917000459), así que ese botón afectaría 0 filas y fallaría
 * SIN LANZAR. Sobre una bloqueada al dueño solo le quedan verla y eliminarla,
 * así que el CTA lleva a "Mis publicaciones" —donde la hoja de acciones ya tiene
 * el borrado con su confirmación— en vez de estrenar aquí una acción destructiva
 * en una pantalla que ya trae malas noticias.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { GhostButton, PrimaryButton } from '@/components/Buttons';
import { EmptyState } from '@/components/EmptyState';
import { IconXCircle } from '@/components/icons';
import { Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { fetchListingById } from '@/lib/listings';

export default function PublicacionNoAprobadaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listingId = Number(id);

  const [titulo, setTitulo] = useState<string | null>(null);

  useEffect(() => {
    if (Number.isNaN(listingId)) return;

    let vigente = true;
    fetchListingById(listingId)
      .then((l) => vigente && setTitulo(l?.titulo ?? null))
      .catch((e) =>
        console.warn('[no-aprobada] no se pudo leer la publicación:', e?.message ?? e)
      );

    return () => {
      vigente = false;
    };
  }, [listingId]);

  /*
    El copy NO dice cuál regla se rompió, y el frame lo documenta: hoy no hay
    dónde guardar ese motivo de forma que el dueño pueda leerlo —`listings` no
    tiene columna para eso, y `listing_moderacion` no tiene ni grants ni policies
    (20260918000461)—, así que prometerlo aquí sería copy que el código no puede
    llenar.
  */
  const sub = `${titulo ? `"${titulo}"` : 'Tu publicación'} no cumple con las reglas de la comunidad, así que no se publicó.`;

  return (
    <Screen>
      <StatusBar style="dark" />
      <EmptyState
        icon={<IconXCircle size={30} color={Colors.brick} />}
        // `.empty-icon.error-icon` — aquí SÍ, al revés que "en revisión": esto
        // es un rechazo, no un estado de espera.
        iconStyle={styles.iconoError}
        style={styles.estado}
        title="Tu publicación no fue aprobada"
        sub={sub}
      >
        <PrimaryButton
          label="Ver mis publicaciones"
          onPress={() => router.replace('/(cuenta)/mis-publicaciones')}
          style={styles.cta}
        />
        <GhostButton label="Volver al inicio" onPress={() => router.replace('/(tabs)')} />
      </EmptyState>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // El frame le pone `style="padding-top:90px"` al .empty-state.
  estado: {
    paddingTop: 90,
  },
  // .error-icon{background:var(--brick-tint);} — y CONSERVA el borde, al revés
  // que `.empty-icon.success`, que sí lleva `border:none`. Mismo estilo que
  // `ErrorState`, medido contra el CSS del frame y no copiado de `creada.tsx`.
  iconoError: {
    backgroundColor: Colors.brickTint,
  },
  cta: {
    marginTop: 0,
  },
});
