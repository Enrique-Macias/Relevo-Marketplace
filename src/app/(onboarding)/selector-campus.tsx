import { StatusBar } from 'expo-status-bar';
import { useCallback } from 'react';

import { SelectorCatalogo } from '@/components/SelectorCatalogo';
import { fetchCampus } from '@/lib/catalogos';

import { usePerfilDraft } from './_layout';

/**
 * Frame "Selector de campus (onboarding)".
 *
 * Solo se llega aquí con universidad ya elegida — el select de Campus está
 * deshabilitado hasta entonces — así que `universidad` nunca debería ser null.
 */
export default function SelectorCampusScreen() {
  const { universidad, campus, setCampus } = usePerfilDraft();

  const load = useCallback(async () => {
    if (!universidad) return [];
    const data = await fetchCampus(universidad.id);
    return data.map((c) => ({ id: c.id, nombre: c.nombre, subtitulo: c.ciudad }));
  }, [universidad]);

  return (
    <>
      <StatusBar style="dark" />
      <SelectorCatalogo
        title="Tu campus"
        searchPlaceholder="Busca tu campus"
        load={load}
        selectedId={campus?.id ?? null}
        onSelect={(item) => setCampus({ id: item.id, nombre: item.nombre })}
        emptyText="Esta universidad todavía no tiene campus dados de alta."
      />
    </>
  );
}
