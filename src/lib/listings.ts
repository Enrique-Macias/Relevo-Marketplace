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

/**
 * OJO — este embed NO lleva `!inner`, al revés que `VENDEDOR`.
 *
 * Un `!inner` filtra las filas PADRE. En `VENDEDOR` eso es lo que se quiere
 * (habilita ordenar por `vendedor(rating_promedio)` y todo listing tiene
 * vendedor). Aquí haría desaparecer del feed toda publicación sin foto — las
 * creadas antes de que existiera la subida, y cualquiera dada de alta desde
 * Studio. Sin `!inner` el embed devuelve `[]` y `ListingPhoto` cae a su
 * fallback.
 *
 * La foto se acota a UNA con `.order`/`.limit` por `referencedTable` en
 * `fetchListings()`, no con un `.eq('fotos.orden', 0)`: `orden` puede tener
 * huecos en cuanto alguien borre su primera foto desde Editar, y entonces un
 * filtro por 0 dejaría la tarjeta sin imagen aunque la publicación sí tenga
 * fotos. "La de menor orden" es la regla correcta.
 */
const FOTO_PORTADA = 'fotos:listing_photos(storage_path, orden)';

const SELECT_CARD = `
  id, titulo, precio, condicion, created_at, categoria_id, user_id,
  campus:campus(id, nombre, ciudad),
  ${FOTO_PORTADA},
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
  /**
   * RUTA de la foto de portada dentro del bucket privado, o `null` si la
   * publicación no tiene ninguna. No es una URL — ver `ListingDetalle.fotos`.
   */
  fotoPath: string | null;
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
 * Una publicación PROPIA, tal como la pinta "Mis publicaciones".
 *
 * Tres campos más que `ListingCard`, y ninguno es de adorno:
 *  - `estado`: es la razón de ser de la pantalla. El Feed filtra
 *    `estado = 'activa'`, así que una pausada solo se ve aquí.
 *  - `vistasCount`: la línea `.mine-meta` del frame lo pinta. Viene en la misma
 *    fila y está dentro del `grant select` de la tabla (solo el UPDATE lo
 *    excluye), así que no cuesta una query aparte.
 *  - `fotos`: TODAS las rutas, no solo la portada. Eliminar necesita cada una,
 *    porque los objetos de Storage hay que borrarlos ANTES que el listing (ver
 *    `borrarListing`), y para entonces ya no habría de dónde leerlas.
 */
export type MiListing = ListingCard & {
  estado: 'activa' | 'pausada' | 'vendida';
  vistasCount: number;
  fotos: string[];
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
    // `fotos` viene ya acotado a 1 por el `.limit(referencedTable)` de
    // `fetchListings`. `fetchListingById` usa otro select y no pasa por aquí
    // para las fotos: ahí se leen todas.
    fotoPath: row.fotos?.[0]?.storage_path ?? null,
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

  /**
   * Acota el embed de fotos a la de menor `orden` — la portada de la tarjeta.
   *
   * ESTO NO TOCA LA PAGINACIÓN, que es lo que importa aquí: `referencedTable`
   * hace que PostgREST emita `fotos.order=…` y `fotos.limit=1`, que aplican
   * DENTRO de la subconsulta lateral del embed, una por fila padre ya
   * seleccionada. El `order`/`limit`/`range` y el predicado keyset de nivel
   * superior (más abajo) siguen decidiendo el conjunto exactamente igual que
   * antes, y `items.length === limit` sigue siendo un test válido de "hay más"
   * porque un embed devuelve un arreglo anidado por listing, no filas
   * multiplicadas — que es justo lo que sí haría un join plano contra
   * `listing_photos`.
   */
  query = query
    .order('orden', { referencedTable: 'fotos', ascending: true })
    .limit(1, { referencedTable: 'fotos' });

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
  // Aquí el embed NO viene acotado ni ordenado por el servidor (eso solo pasa
  // en `fetchListings`, que pide una sola foto): Detalle las quiere todas, así
  // que el orden se aplica en cliente y `fotoPath` se recalcula sobre la lista
  // ya ordenada — el que trae `mapCard` sería el primero que devolvió Postgres,
  // que no tiene por qué ser el de menor `orden`.
  const fotos: string[] = (row.fotos ?? [])
    .slice()
    .sort((a: any, b: any) => a.orden - b.orden)
    .map((f: any) => f.storage_path);

  return {
    ...mapCard(row),
    fotoPath: fotos[0] ?? null,
    descripcion: row.descripcion,
    estado: row.estado,
    vistasCount: row.vistas_count,
    fotos,
    vendedor: {
      id: row.vendedor.id,
      nombre: row.vendedor.nombre,
      carrera: row.vendedor.carrera,
      ratingPromedio: Number(row.vendedor.rating_promedio),
    },
  };
}

/**
 * Lo que necesita el formulario de Editar.
 *
 * No hay un select propio: `fetchListingById` ya trae todo (incluidas las fotos
 * ordenadas) y su RLS es la correcta —`listings_select` deja al dueño ver su
 * publicación aunque esté pausada—. El alias existe para que la pantalla diga
 * qué está pidiendo y para tener dónde colgar esta nota si algún día divergen.
 */
export const fetchListingParaEditar = fetchListingById;

/**
 * OJO — este select NO embebe al vendedor, al revés que `SELECT_CARD`.
 *
 * Todas estas filas son mías, así que el dato no aporta nada; de paso el
 * `PGRST201` de la doble relación `listings↔users` (la FK directa y el
 * many-to-many vía `favorites`) ni se plantea aquí, y no hace falta la
 * desambiguación `users!listings_user_id_fkey`.
 *
 * El embed de fotos tampoco se acota: `fetchListings()` lo limita a 1 porque la
 * tarjeta solo pinta la portada, pero aquí se necesitan TODAS las rutas para el
 * borrado. Son ≤5 por publicación (`enforce_photo_limit()`), así que el costo es
 * despreciable. Sin `!inner`, igual que allá: una publicación con 0 fotos es
 * justo la que esta pantalla existe para rescatar.
 */
const SELECT_MIAS = `
  id, titulo, precio, condicion, estado, vistas_count, created_at,
  categoria_id, user_id,
  campus:campus(id, nombre, ciudad),
  fotos:listing_photos(storage_path, orden)
`;

export type MisListingsPage = {
  items: MiListing[];
  nextCursor: ListingsCursor | null;
};

export type FetchMisListingsParams = {
  userId: string;
  /** El chip de filtro. Sin él, las tres. */
  estado?: 'activa' | 'pausada' | 'vendida';
  limit?: number;
  cursor?: ListingsCursor | null;
};

/**
 * Las publicaciones del usuario, en TODOS sus estados (RF-06/RF-08).
 *
 * No hay filtro de campus —son mías las vea desde donde las vea— ni de estado
 * salvo el que pida el chip. Que las pausadas aparezcan no es una excepción que
 * haya que codificar: `listings_select` ya deja al dueño ver las suyas
 * (`estado <> 'pausada' or user_id = auth.uid()`), así que el `.eq('user_id')`
 * de abajo es el filtro de la CONSULTA, y la RLS el candado — no se duplica una
 * regla de autorización en el cliente (CLAUDE.md §0 regla 7).
 *
 * Paginación keyset con el mismo cursor compuesto `(created_at, id)` del orden
 * "recientes" de `fetchListings()`: es la misma lista append-heavy, y publicar
 * algo nuevo mientras se hace scroll no debe repetir filas.
 */
export async function fetchMisListings(p: FetchMisListingsParams): Promise<MisListingsPage> {
  const limit = p.limit ?? PAGE_SIZE;

  let query = supabase.from('listings').select(SELECT_MIAS).eq('user_id', p.userId);

  if (p.estado) query = query.eq('estado', p.estado);

  const c = p.cursor;
  if (c && c.tipo === 'keyset') {
    query = query.or(
      `created_at.lt."${c.createdAt}",and(created_at.eq."${c.createdAt}",id.lt.${c.id})`
    );
  }

  query = query
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  const { data, error } = await query;
  if (error) throw error;

  const items = (data ?? []).map(mapMia);
  const ultimo = items[items.length - 1];

  return {
    items,
    nextCursor:
      items.length === limit && ultimo
        ? { tipo: 'keyset', createdAt: ultimo.createdAt, id: ultimo.id }
        : null,
  };
}

function mapMia(row: any): MiListing {
  // El embed NO viene ordenado por el servidor (eso solo se pide en
  // `fetchListings`), así que se ordena aquí y `fotoPath` se recalcula sobre la
  // lista ya ordenada — el de `mapCard` sería el primero que devolvió Postgres,
  // que no tiene por qué ser el de menor `orden`. Mismo criterio que
  // `fetchListingById`.
  const fotos: string[] = (row.fotos ?? [])
    .slice()
    .sort((a: any, b: any) => a.orden - b.orden)
    .map((f: any) => f.storage_path);

  return {
    ...mapCard(row),
    fotoPath: fotos[0] ?? null,
    estado: row.estado,
    vistasCount: row.vistas_count,
    fotos,
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
// Escrituras — grupo Publicar (RF-05, RF-06, RF-08)
// ---------------------------------------------------------------------------

/**
 * Los campos que el formulario de Publicar/Editar realmente controla.
 *
 * NO incluye `user_id`, `vistas_count`, `created_at` ni `updated_at`, y eso es
 * el contrato con la base, no una omisión: el `grant update` de columna de la
 * migración 20260906000439 los deja fuera a propósito (no se transfiere una
 * publicación, el dueño no infla sus vistas, las fechas las mantiene el
 * trigger). Mandar cualquiera de ellos —aunque sea con el mismo valor que ya
 * tienen— rechaza el statement COMPLETO con 42501, no lo ignora. Es la misma
 * trampa que ya documenta `(onboarding)/completar-perfil.tsx` para `users`.
 */
export type ListingInput = {
  titulo: string;
  descripcion: string | null;
  precio: number;
  categoriaId: number;
  condicion: Condicion;
  universidadId: number;
  campusId: number;
};

function aFila(input: ListingInput) {
  return {
    titulo: input.titulo,
    descripcion: input.descripcion,
    precio: input.precio,
    categoria_id: input.categoriaId,
    condicion: input.condicion,
    universidad_id: input.universidadId,
    campus_id: input.campusId,
  };
}

/**
 * Crea la publicación y devuelve su id.
 *
 * El id se necesita de vuelta y con `await` — no es un detalle de comodidad:
 * la carpeta de Storage ES `{listing_id}/`, y
 * `listing_photos_objects_insert_own` exige que ese listing exista y sea del
 * invocante. O sea que **no hay forma de subir una foto antes de esta línea**.
 *
 * `estado` SÍ se manda, explícito, y no cae al default `'activa'` de la
 * columna: bajo el modelo atómico el alta lo crea `'pausada'` y solo lo activa
 * cuando todas las fotos subieron (ver `publicarListing`). Dejarlo implícito
 * haría que un cambio de default —o un lector distraído— decidiera algo que es
 * la pieza central del flujo.
 *
 * `user_id` SÍ se manda, y viene por parámetro en vez de leerse aquí de la
 * sesión. `listings` tiene el insert concedido a nivel de tabla (no por
 * columna) y `user_id` es NOT NULL sin default, así que ponerlo es obligación
 * del cliente. Que la policy `listings_insert_own` exija
 * `user_id = auth.uid()` no lo rellena: solo rechaza la fila si no coincide —
 * es la red de seguridad, no la fuente del valor.
 */
export async function crearListing(
  input: ListingInput,
  userId: string,
  estado: 'activa' | 'pausada'
): Promise<number> {
  const { data, error } = await supabase
    .from('listings')
    .insert({ ...aFila(input), user_id: userId, estado })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/** RF-06. Solo columnas del grant de update — ver la nota de `ListingInput`. */
export async function actualizarListing(id: number, input: ListingInput): Promise<void> {
  const { error } = await supabase.from('listings').update(aFila(input)).eq('id', id);
  if (error) throw error;
}

/**
 * RF-08. Aparte de `actualizarListing` porque el toggle de "Pausar" no toca el
 * formulario.
 *
 * Pasar a `'activa'` puede FALLAR aunque la publicación sea tuya: el trigger
 * `listings_enforce_activation_has_photos` rechaza activar una sin fotos. No es
 * un caso hipotético — el alta atómica deja publicaciones `pausada` con 0 fotos
 * cuando la subida falla entera. Quien llama debe anticiparlo (los dos toggles
 * de reactivación lo hacen) para no mostrarle al usuario el `raise exception`
 * crudo de Postgres.
 */
export async function cambiarEstadoListing(
  id: number,
  estado: 'activa' | 'pausada' | 'vendida'
): Promise<void> {
  const { error } = await supabase.from('listings').update({ estado }).eq('id', id);
  if (error) throw error;
}

/**
 * RF-06. Las filas de `listing_photos` se van solas por `on delete cascade`;
 * los ARCHIVOS no. Quien llama debe borrarlos ANTES con `borrarFotos()` —
 * ver la nota de orden en `src/lib/storage.ts`.
 */
export async function borrarListing(id: number): Promise<void> {
  const { error } = await supabase.from('listings').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Reescribe el set completo de fotos de una publicación, renumerando `orden`
 * de 0 a n-1.
 *
 * POR QUÉ `delete` + `insert` Y NO UN `upsert`, que es lo que uno escribiría
 * primero: `enforce_photo_limit()` es un trigger BEFORE INSERT, y en Postgres
 * un `insert … on conflict do update` dispara igual los triggers BEFORE INSERT
 * antes de detectar el conflicto. Con 5 fotos ya guardadas, el trigger vería
 * `count = 5 >= 5` y reventaría con "no puede tener más de 5 fotos" al intentar
 * EDITAR una publicación que simplemente está llena. El delete previo deja el
 * contador en 0 y el insert lo sube 0→n≤5 sin acercarse al tope. De paso evita
 * las colisiones con `unique (listing_id, orden)` que tendría cualquier
 * renumeración en sitio.
 *
 * El costo: entre el delete y el insert la publicación queda sin fotos. En la
 * EDICIÓN eso importa —la publicación puede estar activa y visible— así que
 * quien llama solo debe invocarla si el set CAMBIÓ (ver `guardar()` en
 * `editar/[id].tsx`); editar solo el precio no pasa por aquí. En el ALTA no
 * importa: la publicación todavía está `pausada` y nadie más que su dueño la ve.
 *
 * Es también la ÚNICA escritora de `listing_photos` en el alta, y eso no es
 * casual: numerar `orden` de a una foto colisiona en cuanto hay un reintento
 * parcial. Ver `subirPendientes()` en `src/lib/publicar.ts`.
 *
 * Si el insert falla, los archivos siguen en Storage y las filas no: se reporta
 * y el usuario reintenta desde el mismo formulario, que todavía tiene los paths
 * en estado.
 */
export async function guardarFotos(listingId: number, paths: string[]): Promise<void> {
  const { error: eBorrado } = await supabase
    .from('listing_photos')
    .delete()
    .eq('listing_id', listingId);
  if (eBorrado) throw eBorrado;

  if (paths.length === 0) return;

  const { error: eInsert } = await supabase
    .from('listing_photos')
    .insert(paths.map((storage_path, orden) => ({ listing_id: listingId, storage_path, orden })));
  if (eInsert) throw eInsert;
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
 * efecto. La bandera `vigente` es lo que evita la carrera clásica: si el
 * usuario cambia de campus mientras la página anterior está en vuelo, esa
 * respuesta llega y se descarta en vez de pintarse encima de la nueva. Mismo
 * patrón que `session.tsx`.
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

  /**
   * Reseteo AL CAMBIAR DE LISTA, hecho en render y no en la primera línea del
   * efecto de carga — mismo patrón que `useMisListings`. Es equivalente en el
   * resultado final, pero resetear dentro del efecto deja pasar un render con
   * la lista VIEJA todavía pintada bajo el filtro/orden NUEVO: React ya pintó
   * el render con `key` nueva antes de que el efecto llegue a limpiar el
   * estado viejo. Comparar contra el valor anterior EN RENDER y corregirlo ahí
   * mismo evita ese frame — es el patrón que React documenta para "ajustar
   * estado cuando cambia una prop"; React reintenta antes de llegar a pintar.
   *
   * `recargas` entra en la comparación (no solo `key`) porque "Reintentar"
   * debe resetear igual sin cambiar de filtro. Cuando `key` es `null` (params
   * aún no listos, ej. campus sin resolver) NO se resetea: es el mismo
   * bail-out silencioso que ya tenía el efecto — los items viejos se quedan
   * hasta que haya params de nuevo, no se limpian a mitad de una transición
   * sin destino.
   *
   * De regalo, esto es lo que hace que `react-hooks/set-state-in-effect` por
   * fin marque este hook — antes NO lo marcaba a pesar de tener el mismo
   * problema, por la razón que documenta CLAUDE.md §9: un guard que lee un ref
   * (`paramsRef.current`) antes del `setState` hace que el análisis estático
   * no pueda probar que sea alcanzable, y se rinde en vez de reportar. No era
   * una diferencia real con `useMisListings` — era un falso negativo del
   * linter, ya corregido aquí.
   */
  const clave = key !== null ? `${key}|${recargas}` : null;
  const [clavePintada, setClavePintada] = useState(clave);
  if (clave !== null && clave !== clavePintada) {
    setClavePintada(clave);
    setItems([]);
    setCursor(null);
    setTotal(null);
    setEstado('loading');
  }

  useEffect(() => {
    if (!key || !paramsRef.current) return;

    let vigente = true;

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

  /**
   * Refresco silencioso (pull-to-refresh): a diferencia de `reintentar`, NO
   * vacía `items` ni pone `estado` en `'loading'` — el punto es mantener el
   * grid visible mientras se pide la página 1 de nuevo. Ver CLAUDE.md §8b.
   */
  const refrescandoRef = useRef(false);

  const refrescar = useCallback(async () => {
    const p = paramsRef.current;
    if (!p || refrescandoRef.current) return;

    refrescandoRef.current = true;
    const keyPedida = keyRef.current;

    try {
      const page = await fetchListings({ ...p, cursor: null });
      // Mismo criterio que `loadMore`: si el filtro cambió mientras esto
      // venía en camino, descartar en vez de pintar encima del nuevo.
      if (keyRef.current !== keyPedida) return;
      setItems(page.items);
      setCursor(page.nextCursor);
      setTotal(page.total);
      // Si veníamos de un error, un refresh exitoso debe sacar la pantalla
      // de ese estado — si no, el ErrorState seguiría tapando el grid nuevo.
      setEstado('ready');
    } finally {
      refrescandoRef.current = false;
    }
  }, []);

  return { items, estado, total, cargandoMas, loadMore, reintentar, refrescar };
}

/**
 * Lo mismo, pero para "Mis publicaciones": sin filtros de catálogo, con el
 * estado como único parámetro y siempre keyset.
 *
 * Es un hook aparte y no un caso más de `useListings` porque la consulta de
 * abajo es otra (`fetchMisListings`, sin embed de vendedor y con TODAS las
 * fotos), y porque este sí expone su `setItems`: la pantalla necesita mover
 * filas sin recargar —pausar de forma optimista, sacar la que dejó de cumplir el
 * chip, quitar la que se borró—. `useListings` no lo expone porque en Explorar
 * nada de eso ocurre; aquí es el modo normal de operar.
 */
export function useMisListings(userId: string | null, estadoFiltro?: 'activa' | 'pausada' | 'vendida') {
  const [items, setItems] = useState<MiListing[]>([]);
  const [cursor, setCursor] = useState<ListingsCursor | null>(null);
  const [estado, setEstado] = useState<EstadoLista>('loading');
  const [cargandoMas, setCargandoMas] = useState(false);
  const [recargas, setRecargas] = useState(0);

  const enVuelo = useRef(false);

  /**
   * Reseteo AL CAMBIAR DE LISTA, hecho en render y no dentro del efecto.
   *
   * `useListings` (arriba) limpia su estado en la primera línea del efecto, que
   * es lo mismo en la práctica pero dispara un render extra con la lista vieja
   * todavía pintada bajo el filtro nuevo. Este es el patrón que React documenta
   * para "ajustar estado cuando cambia una prop": compararlo contra el valor
   * anterior durante el render y corregirlo ahí mismo, antes de pintar nada.
   * React reintenta el render de inmediato, sin llegar a la pantalla.
   */
  const key = `${userId ?? ''}|${estadoFiltro ?? ''}|${recargas}`;
  const [keyPintada, setKeyPintada] = useState(key);
  if (key !== keyPintada) {
    setKeyPintada(key);
    setItems([]);
    setCursor(null);
    setEstado('loading');
  }

  useEffect(() => {
    if (!userId) return;

    let vigente = true;

    fetchMisListings({ userId, estado: estadoFiltro })
      .then((page) => {
        if (!vigente) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setEstado('ready');
      })
      .catch((e: any) => {
        if (!vigente) return;
        console.warn('[mis-listings] falló la carga:', e?.message ?? e);
        setEstado('error');
      });

    return () => {
      vigente = false;
    };
  }, [userId, estadoFiltro, recargas]);

  const loadMore = useCallback(() => {
    if (!userId || !cursor || enVuelo.current) return;

    enVuelo.current = true;
    setCargandoMas(true);
    const filtroPedido = estadoFiltro;

    fetchMisListings({ userId, estado: estadoFiltro, cursor })
      .then((page) => {
        // Si el chip cambió mientras la página venía en camino, el efecto de
        // arriba ya reseteó la lista: descartar en vez de mezclar dos filtros.
        if (filtroPedido !== estadoFiltro) return;
        setItems((prev) => [...prev, ...page.items]);
        setCursor(page.nextCursor);
      })
      .catch((e: any) => console.warn('[mis-listings] falló la página siguiente:', e?.message ?? e))
      .finally(() => {
        enVuelo.current = false;
        setCargandoMas(false);
      });
  }, [userId, cursor, estadoFiltro]);

  const recargar = useCallback(() => setRecargas((n) => n + 1), []);

  return { items, setItems, estado, cargandoMas, hayMas: cursor !== null, loadMore, recargar };
}
