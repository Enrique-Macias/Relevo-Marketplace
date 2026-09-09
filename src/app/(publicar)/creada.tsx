/**
 * Frame "Publicación creada".
 *
 * Tuvo un segundo estado —"Publicación creada (fotos faltantes)", con un
 * `.notice` persistente y un CTA que llevaba a Editar— y ya no lo tiene: bajo el
 * modelo atómico, llegar aquí SIGNIFICA que todas las fotos subieron y que la
 * publicación quedó activa. El camino "activa con fotos incompletas" dejó de
 * existir, así que su aviso no se quedó apagado por si acaso: se borró, junto
 * con su frame en `design/relevo-app.html`. Un fallo de subida ahora se resuelve
 * sin salir de "Publicar" (ver `nueva.tsx`), y el `.notice` se mudó allá.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { GhostButton, PrimaryButton } from '@/components/Buttons';
import { EmptyState } from '@/components/EmptyState';
import { IconCheck } from '@/components/icons';
import { Screen } from '@/components/Screen';
import { Colors } from '@/constants/theme';
import { fetchUniversidades } from '@/lib/catalogos';
import { fetchListingById } from '@/lib/listings';
import { useSession } from '@/lib/session';

export default function PublicacionCreadaScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listingId = Number(id);
  const { profile } = useSession();

  const [titulo, setTitulo] = useState<string | null>(null);
  const [universidad, setUniversidad] = useState<string | null>(null);

  useEffect(() => {
    if (Number.isNaN(listingId)) return;

    let vigente = true;
    fetchListingById(listingId)
      .then((l) => vigente && setTitulo(l?.titulo ?? null))
      .catch((e) => console.warn('[creada] no se pudo leer la publicación:', e?.message ?? e));

    return () => {
      vigente = false;
    };
  }, [listingId]);

  // El frame dice "…estudiantes de Tec de Monterrey": es la UNIVERSIDAD, no el
  // campus. El perfil solo guarda el id, así que hay que resolver el nombre.
  useEffect(() => {
    const universidadId = profile?.universidad_id;
    if (universidadId == null) return;

    let vigente = true;
    fetchUniversidades()
      .then((lista) => {
        if (!vigente) return;
        setUniversidad(lista.find((u) => u.id === universidadId)?.nombre ?? null);
      })
      .catch((e) => console.warn('[creada] no se pudo leer la universidad:', e?.message ?? e));

    return () => {
      vigente = false;
    };
  }, [profile?.universidad_id]);

  // Mientras el título o la universidad cargan, la frase se arma con lo que
  // haya: la confirmación no debe quedarse en blanco esperando un adorno.
  const sub = [
    titulo ? `"${titulo}"` : 'Tu publicación',
    'ya es visible para estudiantes',
    universidad ? `de ${universidad}.` : 'de tu universidad.',
  ].join(' ');

  return (
    <Screen>
      <StatusBar style="dark" />
      <EmptyState
        icon={<IconCheck size={30} color={Colors.forest} />}
        iconStyle={styles.iconoExito}
        style={styles.estado}
        title="¡Tu publicación ya está activa!"
        sub={sub}
      >
        <PrimaryButton
          label="Ver mi publicación"
          onPress={() => router.replace(`/detalle/${listingId}`)}
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
  // .empty-icon.success{background:var(--forest-tint); border:none;}
  iconoExito: {
    backgroundColor: Colors.forestTint,
    borderWidth: 0,
  },
  cta: {
    marginTop: 0,
  },
});
