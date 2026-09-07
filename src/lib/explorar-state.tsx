/**
 * Estado compartido entre las pantallas de Explorar — mismo patrón que el
 * `Draft` context de `(onboarding)/_layout.tsx`, pero montado en el
 * `_layout.tsx` raíz porque Filtros vive en `(explorar)/` y Búsqueda vive en
 * `(tabs)/`: son dos ramas distintas del Stack, así que sin un contexto por
 * encima de ambas, "Aplicar filtros" no tendría cómo afectar los resultados
 * de Búsqueda.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { CAMPUS, type Campus } from '@/constants/mock/campus';

export type Condicion = 'nuevo' | 'como_nuevo' | 'buen_estado' | 'usado';

export type Orden = 'recientes' | 'precio_asc' | 'precio_desc' | 'mejor_calificados';

export type Filtros = {
  categoriaId?: string;
  precioMin?: string;
  precioMax?: string;
  condicion?: Condicion;
  orden: Orden;
};

const FILTROS_VACIOS: Filtros = { orden: 'recientes' };

type ExplorarState = {
  campusSeleccionado: Campus;
  setCampusSeleccionado: (campus: Campus) => void;
  filtros: Filtros;
  setFiltros: (parcial: Partial<Filtros>) => void;
  limpiarFiltros: () => void;
  favoritos: Set<string>;
  toggleFavorito: (id: string) => void;
};

const Ctx = createContext<ExplorarState | null>(null);

export function useExplorarState(): ExplorarState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useExplorarState solo funciona dentro de ExplorarStateProvider');
  return ctx;
}

export function ExplorarStateProvider({ children }: { children: React.ReactNode }) {
  const [campusSeleccionado, setCampusSeleccionado] = useState<Campus>(CAMPUS[0]);
  const [filtros, setFiltrosState] = useState<Filtros>(FILTROS_VACIOS);
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());

  const setFiltros = useCallback((parcial: Partial<Filtros>) => {
    setFiltrosState((f) => ({ ...f, ...parcial }));
  }, []);

  const limpiarFiltros = useCallback(() => {
    setFiltrosState(FILTROS_VACIOS);
  }, []);

  const toggleFavorito = useCallback((id: string) => {
    setFavoritos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const value = useMemo<ExplorarState>(
    () => ({
      campusSeleccionado,
      setCampusSeleccionado,
      filtros,
      setFiltros,
      limpiarFiltros,
      favoritos,
      toggleFavorito,
    }),
    [campusSeleccionado, filtros, setFiltros, limpiarFiltros, favoritos, toggleFavorito]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
