/**
 * Estado compartido entre las pantallas de Explorar — mismo patrón que el
 * `Draft` context de `(onboarding)/_layout.tsx`, pero montado en el
 * `_layout.tsx` raíz porque Filtros vive en `(explorar)/` y Búsqueda vive en
 * `(tabs)/`: son dos ramas distintas del Stack, así que sin un contexto por
 * encima de ambas, "Aplicar filtros" no tendría cómo afectar los resultados
 * de Búsqueda.
 *
 * Qué vive aquí y qué no, ahora que los datos son reales:
 *  - SÍ: los VALORES de filtro, el campus elegido, el catálogo de categorías y
 *    el set de favoritos. Todo eso lo comparten varias pantallas.
 *  - NO: la lógica de filtrado, que antes recorría el arreglo mock y ahora es
 *    una query (`src/lib/listings.ts`). El contexto dice *qué* filtrar; la
 *    query decide *cómo*.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { fetchCampus, type Campus } from '@/lib/catalogos';
import { fetchCategorias, type Categoria } from '@/lib/categorias';
import { agregarFavorito, fetchFavoritoIds, quitarFavorito } from '@/lib/favoritos';
import { useSession } from '@/lib/session';

export type { Campus, Categoria };

export type Condicion = 'nuevo' | 'como_nuevo' | 'buen_estado' | 'usado';

export type Orden = 'recientes' | 'precio_asc' | 'precio_desc' | 'mejor_calificados';

export type Filtros = {
  /** `categories.id` real, no un slug. */
  categoriaId?: number;
  precioMin?: string;
  precioMax?: string;
  condicion?: Condicion;
  orden: Orden;
};

const FILTROS_VACIOS: Filtros = { orden: 'recientes' };

// Identidad estable para el caso "todavía no sé de quién son los favoritos":
// un `new Set()` inline rompería la memoización en cada render.
const VACIO: Set<number> = new Set();

type ExplorarState = {
  /** `null` hasta que se resuelve el campus del perfil. */
  campusSeleccionado: Campus | null;
  campusDisponibles: Campus[];
  setCampusSeleccionado: (campus: Campus) => void;
  categorias: Categoria[];
  getCategoria: (id: number | undefined) => Categoria | undefined;
  categoriasListas: boolean;
  filtros: Filtros;
  setFiltros: (parcial: Partial<Filtros>) => void;
  limpiarFiltros: () => void;
  favoritos: Set<number>;
  toggleFavorito: (id: number) => void;
};

const Ctx = createContext<ExplorarState | null>(null);

export function useExplorarState(): ExplorarState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useExplorarState solo funciona dentro de ExplorarStateProvider');
  return ctx;
}

export function ExplorarStateProvider({ children }: { children: React.ReactNode }) {
  const { session, profile } = useSession();
  const userId = session?.user.id ?? null;

  const [campusDisponibles, setCampusDisponibles] = useState<Campus[]>([]);
  const [campusSeleccionado, setCampusSeleccionado] = useState<Campus | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoriasListas, setCategoriasListas] = useState(false);
  const [filtros, setFiltrosState] = useState<Filtros>(FILTROS_VACIOS);
  const [favoritos, setFavoritos] = useState<Set<number>>(new Set());
  // De quién es el Set que tenemos. Al cambiar de cuenta, esto es lo que evita
  // pintar los corazones del usuario anterior mientras carga el nuevo — sin
  // tener que limpiarlo con un setState sincrónico dentro del efecto.
  const [favoritosDe, setFavoritosDe] = useState<string | null>(null);

  /**
   * Catálogo de campus de la universidad del usuario, y campus inicial.
   *
   * El campus por default es el del perfil (elegido en "Completar perfil"), no
   * el primero de la lista: es el contexto que el usuario ya declaró. El
   * selector del Feed sirve para moverse entre los campus de SU universidad
   * (CLAUDE.md §5), de ahí el filtro por `universidad_id`.
   */
  const universidadId = profile?.universidad_id ?? null;
  const campusIdPerfil = profile?.campus_id ?? null;

  useEffect(() => {
    if (universidadId === null) return;

    let vigente = true;
    fetchCampus(universidadId)
      .then((lista) => {
        if (!vigente) return;
        setCampusDisponibles(lista);
        setCampusSeleccionado((actual) => {
          if (actual && lista.some((c) => c.id === actual.id)) return actual;
          return lista.find((c) => c.id === campusIdPerfil) ?? lista[0] ?? null;
        });
      })
      .catch((e) => console.warn('[explorar] no se pudo leer el catálogo de campus:', e?.message ?? e));

    return () => {
      vigente = false;
    };
  }, [universidadId, campusIdPerfil]);

  // Las categorías no dependen del campus ni del usuario: se cargan una vez.
  useEffect(() => {
    if (!userId) return;

    let vigente = true;
    fetchCategorias()
      .then((lista) => {
        if (!vigente) return;
        setCategorias(lista);
        setCategoriasListas(true);
      })
      .catch((e) => console.warn('[explorar] no se pudieron leer las categorías:', e?.message ?? e));

    return () => {
      vigente = false;
    };
  }, [userId]);

  // Hidratación de favoritos: una query al entrar, y de ahí en adelante el Set
  // local es la verdad optimista. Sin esto, cada tarjeta del grid necesitaría
  // su propia consulta para saber si su corazón va relleno.
  useEffect(() => {
    if (!userId) return;

    let vigente = true;
    fetchFavoritoIds(userId)
      .then((ids) => {
        if (!vigente) return;
        setFavoritos(new Set(ids));
        setFavoritosDe(userId);
      })
      .catch((e) => console.warn('[explorar] no se pudieron leer los favoritos:', e?.message ?? e));

    return () => {
      vigente = false;
    };
  }, [userId]);

  const setFiltros = useCallback((parcial: Partial<Filtros>) => {
    setFiltrosState((f) => ({ ...f, ...parcial }));
  }, []);

  const favoritosVigentes = favoritosDe === userId ? favoritos : VACIO;

  const limpiarFiltros = useCallback(() => {
    setFiltrosState(FILTROS_VACIOS);
  }, []);

  /**
   * Optimistic update con rollback.
   *
   * Por qué optimista y no esperar al servidor: la RLS de `favorites` es
   * `user_id = auth.uid()` sin `is_active_user()`, así que NO existe un rechazo
   * por política para una escritura bien formada sobre la propia fila. Los
   * únicos fallos posibles son de transporte, PK duplicada (doble tap, que el
   * `ON CONFLICT DO NOTHING` ya absorbe) o FK rota. O sea, el caso "el servidor
   * dice que no" —el que justificaría esperar confirmación— prácticamente no
   * ocurre, y el corazón se toca desde un grid en scroll donde un round-trip
   * visible por tap se siente roto.
   *
   * Si la escritura falla se revierte SOLO ese id, sin tocar el resto del Set:
   * el usuario pudo haber marcado otras tarjetas mientras esta iba en camino.
   */
  const toggleFavorito = useCallback(
    (id: number) => {
      if (!userId) return;

      const estabaMarcado = favoritosVigentes.has(id);

      setFavoritos((prev) => {
        const next = new Set(prev);
        if (estabaMarcado) next.delete(id);
        else next.add(id);
        return next;
      });

      const escritura = estabaMarcado ? quitarFavorito(id, userId) : agregarFavorito(id, userId);

      escritura.catch((e) => {
        console.warn('[favoritos] falló la escritura, revirtiendo:', e?.message ?? e);
        setFavoritos((prev) => {
          const next = new Set(prev);
          if (estabaMarcado) next.add(id);
          else next.delete(id);
          return next;
        });
      });
    },
    [favoritosVigentes, userId]
  );

  const getCategoria = useCallback(
    (id: number | undefined) => (id === undefined ? undefined : categorias.find((c) => c.id === id)),
    [categorias]
  );

  const value = useMemo<ExplorarState>(
    () => ({
      campusSeleccionado,
      campusDisponibles,
      setCampusSeleccionado,
      categorias,
      getCategoria,
      categoriasListas,
      filtros,
      setFiltros,
      limpiarFiltros,
      favoritos: favoritosVigentes,
      toggleFavorito,
    }),
    [
      campusSeleccionado,
      campusDisponibles,
      categorias,
      getCategoria,
      categoriasListas,
      filtros,
      setFiltros,
      limpiarFiltros,
      favoritosVigentes,
      toggleFavorito,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
