/**
 * Estado compartido entre las pantallas de Explorar — mismo patrón que el
 * `Draft` context de `(onboarding)/_layout.tsx`, pero montado en el
 * `_layout.tsx` raíz porque Filtros vive en `(explorar)/` y Búsqueda vive en
 * `(tabs)/`: son dos ramas distintas del Stack, así que sin un contexto por
 * encima de ambas, "Aplicar filtros" no tendría cómo afectar los resultados
 * de Búsqueda.
 *
 * Qué vive aquí y qué no, ahora que los datos son reales:
 *  - SÍ: los VALORES de filtro, el alcance elegido (campus, universidad o todo),
 *    el catálogo de campus y de categorías, y el set de favoritos. Todo eso lo
 *    comparten varias pantallas.
 *  - NO: la lógica de filtrado, que antes recorría el arreglo mock y ahora es
 *    una query (`src/lib/listings.ts`). El contexto dice *qué* filtrar; la
 *    query decide *cómo*.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  fetchCatalogoCampus,
  type Campus,
  type CampusCatalogo,
  type UniversidadCatalogo,
} from '@/lib/catalogos';
import { fetchCategorias, type Categoria } from '@/lib/categorias';
import { agregarFavorito, fetchFavoritoIds, quitarFavorito } from '@/lib/favoritos';
import type { AlcanceFiltro } from '@/lib/listings';
import { useSession } from '@/lib/session';

export type { Campus, CampusCatalogo, Categoria, UniversidadCatalogo };

/**
 * QUÉ parte del catálogo se está mirando (fase 2B). Lo siguen el Feed, Búsqueda
 * (las dos ramas) y Categoría; NO lo siguen Favoritos ni "Mis publicaciones",
 * que son listas personales.
 *
 * Unión discriminada para que un estado inválido no se pueda escribir: el
 * alcance "un campus" lleva el campus CON su universidad adentro
 * (`CampusCatalogo`), así que no existe la combinación "campus X de la
 * universidad Y" con Y equivocada, ni un campus sin universidad.
 *
 * Es solo NAVEGACIÓN: no toca el perfil ni dónde nace una publicación, que
 * siempre es el campus del perfil (`(publicar)/nueva.tsx`, y la base lo impone
 * con `listings_user_universidad_fkey`).
 */
export type Alcance =
  | { tipo: 'campus'; campus: CampusCatalogo }
  | { tipo: 'universidad'; universidad: { id: number; nombre: string } }
  | { tipo: 'todo' };

/** Lo que `fetchListings` necesita del alcance: solo ids. */
export function alcanceFiltro(a: Alcance): AlcanceFiltro {
  if (a.tipo === 'campus') return { tipo: 'campus', campusId: a.campus.id };
  if (a.tipo === 'universidad') return { tipo: 'universidad', universidadId: a.universidad.id };
  return { tipo: 'todo' };
}

/**
 * EL texto del alcance: el chip del Feed, el chip de Búsqueda y el
 * "N publicaciones en …" de Categoría usan este, para que las tres superficies
 * digan lo mismo (frame "Feed", variante "el chip según el alcance").
 *
 * Un campus de OTRA universidad lleva " · universidad"; el propio no. Esa
 * diferencia es la que avisa que no estás mirando tu universidad.
 */
export function etiquetaAlcance(a: Alcance, universidadPropiaId: number | null): string {
  if (a.tipo === 'campus') {
    return a.campus.universidad.id === universidadPropiaId
      ? a.campus.nombre
      : `${a.campus.nombre} · ${a.campus.universidad.nombre}`;
  }
  if (a.tipo === 'universidad') return `Todo ${a.universidad.nombre}`;
  return 'Todas las universidades';
}

/**
 * El lugar dentro de una frase ("Nadie ha publicado todavía en …", frame
 * "Feed (sin publicaciones)"): el campus a secas, o la universidad sin "Todo".
 */
export function lugarAlcance(a: Alcance): string {
  if (a.tipo === 'campus') return a.campus.nombre;
  if (a.tipo === 'universidad') return a.universidad.nombre;
  return 'Relevo';
}

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
  /** `null` hasta que cargan el catálogo y el perfil. */
  alcance: Alcance | null;
  setAlcance: (alcance: Alcance) => void;
  /** Todas las universidades con sus campus, ordenadas por nombre. */
  catalogo: UniversidadCatalogo[];
  /** Un campus del catálogo por id, de cualquier universidad. */
  getCampus: (id: number | null | undefined) => CampusCatalogo | undefined;
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

  const [catalogo, setCatalogo] = useState<UniversidadCatalogo[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoriasListas, setCategoriasListas] = useState(false);
  const [filtros, setFiltrosState] = useState<Filtros>(FILTROS_VACIOS);
  const [favoritos, setFavoritos] = useState<Set<number>>(new Set());
  // De quién es el Set que tenemos. Al cambiar de cuenta, esto es lo que evita
  // pintar los corazones del usuario anterior mientras carga el nuevo — sin
  // tener que limpiarlo con un setState sincrónico dentro del efecto.
  const [favoritosDe, setFavoritosDe] = useState<string | null>(null);

  /**
   * El catálogo NAVEGABLE: todas las universidades con sus campus (fase 2B).
   * Una consulta por sesión: universidades y campus solo cambian desde Studio.
   */
  useEffect(() => {
    if (!userId) return;

    let vigente = true;
    fetchCatalogoCampus()
      .then((lista) => {
        if (vigente) setCatalogo(lista);
      })
      .catch((e) => console.warn('[explorar] no se pudo leer el catálogo de campus:', e?.message ?? e));

    return () => {
      vigente = false;
    };
  }, [userId]);

  const universidadIdPerfil = profile?.universidad_id ?? null;
  const campusIdPerfil = profile?.campus_id ?? null;

  const getCampus = useCallback(
    (id: number | null | undefined) => {
      if (id == null) return undefined;
      for (const u of catalogo) {
        const c = u.campus.find((x) => x.id === id);
        if (c) return c;
      }
      return undefined;
    },
    [catalogo]
  );

  /**
   * El alcance por default: el campus DEL PERFIL (lo que el usuario ya declaró
   * en "Completar perfil"). Derivado, no guardado: así nunca queda desfasado de
   * un perfil que cambió.
   *
   * Si el perfil no tiene campus (la cuenta sin universidad asignada, que de
   * todos modos no pasa de "Completar perfil"), cae a su universidad entera y,
   * sin universidad, a todo. Antes caía al primer campus de la lista, que no
   * era de nadie en particular.
   *
   * Es `null` mientras falte el catálogo O el perfil: sin la segunda guarda, el
   * Feed pediría un instante "todo" (perfil aún sin campus) y luego el campus
   * propio — dos consultas y un parpadeo. Memoizado porque un objeto nuevo en
   * cada render invalidaría el `value` del contexto.
   */
  const perfilListo = profile != null;
  const alcancePorDefault = useMemo<Alcance | null>(() => {
    if (catalogo.length === 0 || !perfilListo) return null;
    const campusPerfil = getCampus(campusIdPerfil);
    if (campusPerfil) return { tipo: 'campus', campus: campusPerfil };
    const u = catalogo.find((x) => x.id === universidadIdPerfil);
    if (u) return { tipo: 'universidad', universidad: { id: u.id, nombre: u.nombre } };
    return { tipo: 'todo' };
  }, [catalogo, perfilListo, getCampus, campusIdPerfil, universidadIdPerfil]);

  /**
   * Lo que el usuario eligió en el selector, o `null` si no ha elegido nada. Vive
   * en memoria y nada más: al reabrir la app vuelve al campus del perfil
   * (decisión de producto, fase 2B).
   *
   * Se DESCARTA cuando cambia la cuenta o el campus del perfil ("Editar
   * perfil"): mudarse de campus debe notarse en el Feed de inmediato, y otra
   * cuenta en el mismo teléfono no hereda lo que miraba la anterior. El reseteo
   * va EN RENDER (el patrón de React para "ajustar estado cuando cambia una
   * prop", mismo que `useListings`), no en un efecto, para no pintar ni un frame
   * con la elección vieja. Sustituye al ref `campusPerfilAplicado`, que hacía lo
   * mismo cuando el campus elegido se guardaba en el estado.
   */
  const [eleccion, setEleccion] = useState<Alcance | null>(null);
  const clavePerfil = `${userId ?? ''}|${campusIdPerfil ?? ''}`;
  const [clavePerfilVista, setClavePerfilVista] = useState(clavePerfil);
  if (clavePerfil !== clavePerfilVista) {
    setClavePerfilVista(clavePerfil);
    setEleccion(null);
  }

  const alcance = eleccion ?? alcancePorDefault;

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
      alcance,
      setAlcance: setEleccion,
      catalogo,
      getCampus,
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
      alcance,
      catalogo,
      getCampus,
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
