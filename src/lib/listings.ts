/**
 * Lectura y escritura de publicaciones contra Supabase.
 *
 * Reemplaza a `src/constants/mock/listings.ts`. Toda la lógica de filtrado que
 * antes corría sobre el arreglo mock en `explorar-state.tsx` vive ahora como
 * query — misma semántica, otra fuente de datos.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';

export type Condicion = 'nuevo' | 'como_nuevo' | 'buen_estado' | 'usado';

export type Orden = 'recientes' | 'precio_asc' | 'precio_desc' | 'mejor_calificados';

/**
 * OJO — desambiguación obligatoria de `users`.
 *
 * Entre `listings` y `users` hay DOS caminos: la FK directa
 * (`listings_user_id_fkey`) y un many-to-many vía `favorites`. Sin nombrar la
 * relación, PostgREST responde `PGRST201 Could not embed because more than one
 * relationship was found` y la query entera falla. Verificado contra el
 * proyecto remoto.
 *
 * El `!inner` no cambia la semántica (`listings.user_id` es NOT NULL, así que
 * todo listing tiene vendedor): está para que PostgREST acepte ordenar el
 * resultado de nivel superior por una columna del recurso embebido, que es lo
 * que necesita el orden "mejor calificados".
 */
const VENDEDOR = 'vendedor:users!listings_user_id_fkey!inner(id, nombre, carrera, rating_promedio)';

const SELECT_CARD = `
  id, titulo, precio, condicion, created_at, categoria_id, user_id,
  campus:campus(id, nombre, ciudad),
  ${VENDEDOR}
`;

const SELECT_DETALLE = `
  id, titulo, descripcion, precio, condicion, estado, vistas_count, created_at,
  categoria_id, user_id,
  campus:campus(id, nombre, ciudad),
  fotos:listing_photos(storage_path, orden),
  ${VENDEDOR}
`;

export type ListingCard = {
  id: number;
  titulo: string;
  precio: number;
  condicion: Condicion;
  createdAt: string;
  categoriaId: number;
  userId: string;
  campusNombre: string;
};

export type ListingDetalle = ListingCard & {
  descripcion: string | null;
  estado: 'activa' | 'pausada' | 'vendida';
  vistasCount: number;
  /**
   * RUTAS dentro del bucket privado `listing-photos` (`{listing_id}/{uuid}.jpg`),
   * no URLs: en un bucket privado no existe una URL pública. Ordenadas por
   * `listing_photos.orden`. Convertirlas en algo pintable es trabajo del
   * componente de imagen, no de la capa de datos.
   */
  fotos: string[];
  vendedor: {
    id: string;
    nombre: string | null;
    carrera: string | null;
    ratingPromedio: number;
  };
};

/**
 * Cursor opaco. Las pantallas lo reciben y lo devuelven sin mirarlo dentro:
 * cuál de los dos mecanismos corrió es decisión de `fetchListings`.
 */
export type ListingsCursor =
  | { tipo: 'keyset'; createdAt: string; id: number }
  | { tipo: 'offset'; offset: number };

export type ListingsPage = {
  items: ListingCard[];
  nextCursor: ListingsCursor | null;
  /** Total de resultados del filtro, no de la página. Solo si se pidió `withCount`. */
  total: number | null;
};

export type FetchListingsParams = {
  campusId: number;
  categoriaId?: number;
  q?: string;
  precioMin?: number;
  precioMax?: number;
  condicion?: Condicion;
  orden: Orden;
  limit?: number;
  cursor?: ListingsCursor | null;
  withCount?: boolean;
};

const PAGE_SIZE = 20;

function mapCard(row: any): ListingCard {
  return {
    id: row.id,
    titulo: row.titulo,
    precio: Number(row.precio),
    condicion: row.condicion,
    createdAt: row.created_at,
    categoriaId: row.categoria_id,
    userId: row.user_id,
    campusNombre: row.campus?.nombre ?? '',
  };
}

export async function fetchListings(p: FetchListingsParams): Promise<ListingsPage> {
  const limit = p.limit ?? PAGE_SIZE;
  const q = p.q?.trim();

  let query = supabase
    .from('listings')
    .select(SELECT_CARD, p.withCount ? { count: 'exact' } : undefined)
    .eq('campus_id', p.campusId)
    .eq('estado', 'activa');

  if (p.categoriaId !== undefined) query = query.eq('categoria_id', p.categoriaId);
  if (p.condicion) query = query.eq('condicion', p.condicion);
  if (p.precioMin !== undefined && !Number.isNaN(p.precioMin)) query = query.gte('precio', p.precioMin);
  if (p.precioMax !== undefined && !Number.isNaN(p.precioMax)) query = query.lte('precio', p.precioMax);

  if (q) {
    /**
     * RF-10, contra la columna generada `busqueda` (migración 20260908000444),
     * que materializa `to_tsvector('spanish', titulo || ' ' || descripcion)` y
     * está respaldada por el índice GIN `listings_busqueda_idx`.
     *
     * NO HACE FALTA ESCAPAR NADA AQUÍ, y esto sí es deliberado — antes vivía
     * un `escapaBusqueda()` de dos capas más un corto circuito para el `*`,
     * y ambos se borraron con la migración. Medido contra Postgres real:
     *   · `websearch_to_tsquery` NUNCA lanza error de sintaxis: está hecho para
     *     input crudo de usuario, a diferencia de `to_tsquery`.
     *   · `*` produce una tsquery VACÍA, que no casa con nada → 0 resultados
     *     solos, sin corto circuito. (Con `ilike` era el bug de "buscar * te
     *     devuelve el catálogo entero": ver el historial de este archivo antes
     *     de reintroducir un `replace` creyendo que hace falta.)
     *   · Una coma ya no delimita nada: `textSearch` manda un filtro suelto
     *     (`busqueda=wfts(spanish).…`), no un `or=(...)`.
     *
     * A cambio, la coincidencia es por PALABRA COMPLETA (raíz), no por
     * subcadena: teclear `calc` no encuentra "Cálculo", `calcul` sí. Es una
     * deuda conocida y medida, anotada en CLAUDE.md §8 con su disparador.
     */
    query = query.textSearch('busqueda', q, { type: 'websearch', config: 'spanish' });
  }

  if (p.orden === 'recientes') {
    // Keyset: el cursor es la última fila vista, no un desplazamiento. Camina
    // sobre listings_feed_idx (campus_id, estado, created_at desc) y es inmune
    // a que entren publicaciones nuevas mientras el usuario hace scroll.
    // El desempate por `id` importa: dos publicaciones con el mismo
    // `created_at` se saltarían con un `lt` simple.
    const c = p.cursor;
    if (c && c.tipo === 'keyset') {
      query = query.or(
        `created_at.lt."${c.createdAt}",and(created_at.eq."${c.createdAt}",id.lt.${c.id})`
      );
    }
    query = query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit);
  } else {
    // Offset: la llave de orden cambia y no hay índice compuesto que la
    // soporte, así que un keyset aquí sería el mismo scan con más código.
    const offset = p.cursor && p.cursor.tipo === 'offset' ? p.cursor.offset : 0;
    if (p.orden === 'precio_asc') query = query.order('precio', { ascending: true });
    else if (p.orden === 'precio_desc') query = query.order('precio', { ascending: false });
    else query = query.order('vendedor(rating_promedio)', { ascending: false });
    query = query.order('id', { ascending: false }).range(offset, offset + limit - 1);
  }

  const { data, error, count } = await query;
  if (error) throw error;

  const items = (data ?? []).map(mapCard);
  const hayMas = items.length === limit;

  let nextCursor: ListingsCursor | null = null;
  if (hayMas) {
    if (p.orden === 'recientes') {
      const ultimo = items[items.length - 1];
      nextCursor = { tipo: 'keyset', createdAt: ultimo.createdAt, id: ultimo.id };
    } else {
      const offset = p.cursor && p.cursor.tipo === 'offset' ? p.cursor.offset : 0;
      nextCursor = { tipo: 'offset', offset: offset + limit };
    }
  }

  return { items, nextCursor, total: count ?? null };
}

export async function fetchListingById(id: number): Promise<ListingDetalle | null> {
  const { data, error } = await supabase
    .from('listings')
    .select(SELECT_DETALLE)
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as any;
  return {
    ...mapCard(row),
    descripcion: row.descripcion,
    estado: row.estado,
    vistasCount: row.vistas_count,
    fotos: (row.fotos ?? [])
      .slice()
      .sort((a: any, b: any) => a.orden - b.orden)
      .map((f: any) => f.storage_path),
    vendedor: {
      id: row.vendedor.id,
      nombre: row.vendedor.nombre,
      carrera: row.vendedor.carrera,
      ratingPromedio: Number(row.vendedor.rating_promedio),
    },
  };
}

/** "12 ventas" de la tarjeta del vendedor: sus publicaciones ya vendidas. */
export async function fetchVentasVendedor(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('estado', 'vendida');

  if (error) throw error;
  return count ?? 0;
}

/**
 * Los 2 stats de "Detalle (vista vendedor)" que no vienen en la fila.
 *
 * `contactos` sale directo: la policy de listing_contacts ya deja al vendedor
 * ver quién lo contactó. `favoritos` NO: la RLS de favorites es
 * `user_id = auth.uid()`, así que el conteo llega por RPC.
 */
export async function fetchStatsPropias(
  listingId: number
): Promise<{ contactos: number; favoritos: number }> {
  const [contactos, favoritos] = await Promise.all([
    supabase
      .from('listing_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('listing_id', listingId),
    supabase.rpc('listing_favorites_count', { p_listing_id: listingId }),
  ]);

  if (contactos.error) throw contactos.error;
  if (favoritos.error) throw favoritos.error;

  return {
    contactos: contactos.count ?? 0,
    // null = el llamante no es el dueño; la UI solo pinta esta tarjeta al dueño.
    favoritos: Number(favoritos.data ?? 0),
  };
}

/**
 * No lleva `if (esDueño)`: la exclusión del dueño ya vive dentro de la función
 * (`user_id is distinct from auth.uid()`), y duplicarla aquí sería la lógica de
 * autorización en el cliente que prohíbe CLAUDE.md §0 regla 7.
 */
export async function incrementListingView(listingId: number): Promise<void> {
  const { error } = await supabase.rpc('increment_listing_view', { p_listing_id: listingId });
  if (error) throw error;
}

/** Un tap en "Contactar por WhatsApp" (RF-13). Alimenta "¿A quién le vendiste?" (RF-12). */
export async function registrarContacto(listingId: number, userId: string): Promise<void> {
  const { error } = await supabase
    .from('listing_contacts')
    .insert({ listing_id: listingId, user_id: userId });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Hook de lista paginada
// ---------------------------------------------------------------------------

type EstadoLista = 'loading' | 'ready' | 'error';

/**
 * Estado de una lista de publicaciones, con su paginación.
 *
 * No hay capa de caché en el proyecto (no hay react-query ni SWR, y no se
 * agrega una): cada pantalla tiene su propio estado y este hook lo maneja.
 *
 * El "invalidar al cambiar de campus" no es un mecanismo aparte — es este
 * efecto: `campusId` forma parte de `key`, así que cambiarlo redispara el
 * efecto, cuya primera línea limpia `items` y el cursor. La bandera `vigente`
 * es lo que evita la carrera clásica: si el usuario cambia de campus mientras
 * la página anterior está en vuelo, esa respuesta llega y se descarta en vez de
 * pintarse encima de la nueva. Mismo patrón que `session.tsx`.
 */
export function useListings(params: FetchListingsParams | null) {
  const [items, setItems] = useState<ListingCard[]>([]);
  const [cursor, setCursor] = useState<ListingsCursor | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [estado, setEstado] = useState<EstadoLista>('loading');
  const [cargandoMas, setCargandoMas] = useState(false);

  // Serializar los params es lo que hace que el efecto no se redispare en cada
  // render por identidad de objeto, pero sí cuando cambia cualquier valor.
  const key = params ? JSON.stringify(params) : null;

  // `loadMore` necesita los params más recientes sin volverse a crear en cada
  // render. La asignación va en un efecto, no en el cuerpo del render: este
  // efecto está declarado ANTES que el de carga, así que para cuando ese corre,
  // el ref ya trae los params de este render.
  const paramsRef = useRef(params);
  const keyRef = useRef(key);
  useEffect(() => {
    paramsRef.current = params;
    keyRef.current = key;
  });

  const enVuelo = useRef(false);
  const [recargas, setRecargas] = useState(0);

  useEffect(() => {
    if (!key || !paramsRef.current) return;

    let vigente = true;
    setItems([]);
    setCursor(null);
    setTotal(null);
    setEstado('loading');

    fetchListings({ ...paramsRef.current, cursor: null })
      .then((page) => {
        if (!vigente) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setTotal(page.total);
        setEstado('ready');
      })
      .catch((e) => {
        if (!vigente) return;
        console.warn('[listings] falló la carga:', e?.message ?? e);
        setEstado('error');
      });

    return () => {
      vigente = false;
    };
  }, [key, recargas]);

  /**
   * Página siguiente. Aparte del efecto a propósito: acumula en vez de
   * resetear. El `enVuelo` evita que el `onEndReached` del ScrollView —que se
   * dispara en cada frame de scroll— pida tres páginas de un tirón.
   */
  const loadMore = useCallback(() => {
    const p = paramsRef.current;
    if (!p || !cursor || enVuelo.current) return;

    enVuelo.current = true;
    setCargandoMas(true);
    const cursorPedido = cursor;
    const keyPedida = key;

    fetchListings({ ...p, cursor: cursorPedido, withCount: false })
      .then((page) => {
        // Si el usuario cambió de filtro mientras esto venía en camino, el
        // efecto de arriba ya reseteó la lista: descartar en vez de mezclar
        // resultados de dos filtros distintos.
        //
        // La comparación va contra un ref y NO dentro de un updater de
        // `setCursor`: meter `setItems` dentro de un updater lo convierte en
        // una función con efecto, y React puede invocarla dos veces (StrictMode
        // en desarrollo, o al descartar un render), duplicando la página en la
        // lista. Un ref se lee fuera del ciclo de render y no tiene ese riesgo.
        if (keyRef.current !== keyPedida) return;
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      })
      .catch((e) => console.warn('[listings] falló la página siguiente:', e?.message ?? e))
      .finally(() => {
        enVuelo.current = false;
        setCargandoMas(false);
      });
  }, [cursor, key]);

  const reintentar = useCallback(() => setRecargas((n) => n + 1), []);

  return { items, estado, total, cargandoMas, loadMore, reintentar };
}
