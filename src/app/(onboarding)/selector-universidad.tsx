import { StatusBar } from 'expo-status-bar';
import { useCallback } from 'react';

import { SelectorCatalogo } from '@/components/SelectorCatalogo';
import { fetchUniversidades } from '@/lib/catalogos';

import { usePerfilDraft } from './_layout';

/** Frame "Selector de universidad". */
export default function SelectorUniversidadScreen() {
  const { universidad, setUniversidad } = usePerfilDraft();

  const load = useCallback(async () => {
    const data = await fetchUniversidades();
    return data.map((u) => ({ id: u.id, nombre: u.nombre, subtitulo: u.subtitulo }));
  }, []);

  return (
    <>
      <StatusBar style="dark" />
      <SelectorCatalogo
        title="Tu universidad"
        searchPlaceholder="Busca tu universidad"
        load={load}
        selectedId={universidad?.id ?? null}
        onSelect={(item) => setUniversidad({ id: item.id, nombre: item.nombre })}
        emptyText="Todavía no hay universidades dadas de alta."
      />
    </>
  );
}
