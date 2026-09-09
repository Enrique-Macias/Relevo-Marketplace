/**
 * Frames "Publicación creada" y "Publicación creada (fotos faltantes)" — un
 * solo componente con dos estados, como Categoría o Búsqueda.
 *
 * El segundo estado no es decorativo: la subida de fotos ocurre DESPUÉS de
 * crear la publicación (no puede ser antes, ver `publicarListing`), así que un
 * fallo parcial deja la publicación activa con menos fotos de las que el
 * usuario eligió. Enterarse por un toast de 4s no alcanza —se va mientras uno
 * lo lee, y no deja acción— así que el aviso vive aquí, fijo, con el botón que
 * lo arregla.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GhostButton, PrimaryButton } from '@/components/Buttons';
import { EmptyState } from '@/components/EmptyState';
import { IconCheck, IconExclamation } from '@/components/icons';
import { Screen } from '@/components/Screen';
import { Colors, Radii, Typography } from '@/constants/theme';
import { fetchUniversidades } from '@/lib/catalogos';
import { fetchListingById } from '@/lib/listings';
import { useSession } from '@/lib/session';

export default function PublicacionCreadaScreen() {
  const { id, fallidas, total } = useLocalSearchParams<{
    id: string;
    fallidas?: string;
    total?: string;
  }>();
  const listingId = Number(id);
  const { profile } = useSession();

  const [titulo, setTitulo] = useState<string | null>(null);
  const [universidad, setUniversidad] = useState<string | null>(null);

  // Posiciones 1-based de las fotos que no subieron. Se pasan por param en vez
  // de recalcularse: solo el flujo que acaba de publicar sabe cuáles eran.
  const posicionesFallidas = (fallidas ?? '').split(',').filter(Boolean);
  const totalFotos = Number(total ?? '0');
  const hayFallidas = posicionesFallidas.length > 0;

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
        subStyle={hayFallidas ? styles.subConAviso : undefined}
        belowSub={
          hayFallidas ? (
            <View style={styles.notice}>
              <View style={styles.noticeIcon}>
                <IconExclamation size={11} color={Colors.paper} />
              </View>
              <Text style={styles.noticeText}>
                {posicionesFallidas.length} de {totalFotos} fotos no se subieron. Puedes agregarlas
                ahora.
              </Text>
            </View>
          ) : null
        }
      >
        <PrimaryButton
          label="Ver mi publicación"
          onPress={() => router.replace(`/detalle/${listingId}`)}
          style={styles.cta}
        />
        {/*
          La acción secundaria cambia con el estado: sin fotos faltantes lleva al
          Feed, y con ellas al formulario que las arregla. Es lo que vuelve el
          aviso accionable en vez de informativo.
        */}
        <GhostButton
          label={hayFallidas ? 'Agregar fotos faltantes' : 'Volver al inicio'}
          onPress={() =>
            hayFallidas
              ? router.replace(`/(publicar)/editar/${listingId}`)
              : router.replace('/(tabs)')
          }
        />
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
  subConAviso: {
    marginBottom: 14,
  },
  // .notice{background:var(--card); border:1px solid var(--line); border-radius:14px;
  //   padding:12px 14px; gap:10px; margin-bottom:24px;}
  notice: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 24,
  },
  noticeIcon: {
    width: 20,
    height: 20,
    borderRadius: Radii.full,
    backgroundColor: Colors.brick,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // .notice-text{font-size:12.5px; color:var(--ink-soft); line-height:1.45;}
  noticeText: {
    ...Typography.meta,
    color: Colors.inkSoft,
    lineHeight: 18.125, // 12.5 × 1.45
    flex: 1,
    textAlign: 'left',
  },
  cta: {
    marginTop: 0,
  },
});
