/**
 * El frame "Selector de universidad", esta vez desde "Editar perfil".
 *
 * Gemela de `(onboarding)/selector-universidad.tsx` — mismo componente, mismo
 * catálogo — y por eso NO se llama `selector-universidad.tsx`: dos archivos con
 * ese nombre en dos grupos de primer nivel resolverían los dos a
 * `/selector-universidad`, que es el gotcha de rutas ambiguas documentado en
 * CLAUDE.md §8b (`(notificaciones)/index.tsx` contra `(tabs)/index.tsx`). Aquí
 * la ruta es `/editar-perfil/universidad`.
 */

import { StatusBar } from 'expo-status-bar';
import { useCallback } from 'react';

import { SelectorCatalogo } from '@/components/SelectorCatalogo';
import { fetchUniversidades } from '@/lib/catalogos';

import { useInstitucionalDraft } from './_layout';

export default function SelectorUniversidadPerfilScreen() {
  const { universidad, setUniversidad } = useInstitucionalDraft();

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
