/**
 * Bloqueo entre usuarios (UGC-1, PL-006) — capa de datos del cliente.
 *
 * LA SEGURIDAD VIVE EN LA BASE (`20261013000487`, CLAUDE.md §0 regla 7):
 * `listings_select` esconde las publicaciones en las dos direcciones,
 * `seller_whatsapp` niega el número, `listing_contacts` rechaza contactos
 * nuevos y los avisos entre los dos no se crean. Nada de este archivo filtra
 * publicaciones: solo lee y escribe las filas PROPIAS de `user_bloqueos` y
 * pregunta por un perfil concreto para elegir qué pantalla pintar.
 *
 * Lo que el cliente puede saber, y por qué es suficiente:
 *  - SUS bloqueos: la RLS de `user_bloqueos` solo le devuelve las filas donde
 *    él es `user_id`. Las filas donde aparece como `bloqueado_id` no las ve.
 *  - Si hay interacción con UN perfil: `interaccion_disponible()` devuelve un
 *    booleano sin dirección. Junto con lo anterior basta para separar "yo lo
 *    bloqueé" (frame "Perfil público (bloqueado)") de "no disponible" (frame
 *    "Perfil público (no disponible)"), sin que la base revele quién bloqueó.
 */

import { supabase } from '@/lib/supabase';

/**
 * Qué pantalla de perfil corresponde frente a OTRO usuario.
 *  - `normal`: sin bloqueo en ninguna dirección.
 *  - `bloqueado_por_mi`: existe MI fila. Gana aunque el otro también me haya
 *    bloqueado: cada quien administra solo su propio bloqueo (UGC-1B.1).
 *  - `no_disponible`: no hay fila mía, pero la interacción no está disponible.
 */
export type RelacionBloqueo = 'normal' | 'bloqueado_por_mi' | 'no_disponible';

/** ¿Tengo YO bloqueado a `otroId`? Solo puede leer filas propias (RLS). */
export async function fetchBloqueoPropio(userId: string, otroId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('user_bloqueos')
    .select('bloqueado_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('bloqueado_id', otroId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * `false` si hay bloqueo en cualquier dirección entre la sesión y `otroId`.
 * Un error se PROPAGA: convertirlo en `false` pintaría un estado de bloqueo
 * falso por un fallo de red.
 */
export async function fetchInteraccionDisponible(otroId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('interaccion_disponible', { p_user_id: otroId });
  if (error) throw error;
  if (typeof data !== 'boolean') {
    throw new Error(`interaccion_disponible devolvió un valor inesperado: ${String(data)}`);
  }
  return data;
}

/**
 * La relación con un perfil, en dos lecturas en paralelo. Si cualquiera falla,
 * falla todo: el llamador decide si pinta error o conserva lo que ya tenía.
 */
export async function fetchRelacion(userId: string, otroId: string): Promise<RelacionBloqueo> {
  if (userId === otroId) return 'normal';
  const [propio, disponible] = await Promise.all([
    fetchBloqueoPropio(userId, otroId),
    fetchInteraccionDisponible(otroId),
  ]);
  if (propio) return 'bloqueado_por_mi';
  return disponible ? 'normal' : 'no_disponible';
}

/**
 * Bloquea a `otroId`. Insert PLANO, sin `.select()`: no hace falta leer la fila
 * de vuelta, y así un doble tap que llega a la base como segundo insert choca
 * con la PK (23505), que aquí significa "ya estaba bloqueado" y es éxito: el
 * estado que el usuario pidió ya existe.
 */
export async function bloquearUsuario(userId: string, otroId: string): Promise<void> {
  const { error } = await supabase
    .from('user_bloqueos')
    .insert({ user_id: userId, bloqueado_id: otroId });

  if (error && error.code !== '23505') throw error;
}

/**
 * Deshace MI bloqueo sobre `otroId`. Filtra por `user_id` propio, así que nunca
 * alcanza la fila del otro aunque exista el bloqueo inverso. 0 filas afectadas
 * significa que ya no estaba (otro dispositivo, doble tap): es el estado pedido,
 * así que no se trata como error.
 */
export async function desbloquearUsuario(userId: string, otroId: string): Promise<void> {
  const { error } = await supabase
    .from('user_bloqueos')
    .delete()
    .eq('user_id', userId)
    .eq('bloqueado_id', otroId);

  if (error) throw error;
}

export type UsuarioBloqueado = {
  id: string;
  nombre: string | null;
  /** RUTA dentro del bucket público `avatars`, o null. La pinta `Avatar`. */
  fotoUrl: string | null;
};

/**
 * MIS bloqueos, del más reciente al más viejo, para "Usuarios bloqueados".
 * Solo nombre y avatar (UGC-1B: nada de fecha ni motivo).
 *
 * OJO — `user_bloqueos` tiene DOS FKs a `users`, así que el embed va con el
 * nombre de la FK, igual que `VENDEDOR` en `listings.ts`; sin él, PostgREST
 * responde `PGRST201`. `users_select` es `using (true)`, así que la identidad
 * del bloqueado se lee aunque el bloqueo oculte sus publicaciones.
 */
export async function fetchUsuariosBloqueados(userId: string): Promise<UsuarioBloqueado[]> {
  const { data, error } = await supabase
    .from('user_bloqueos')
    .select('bloqueado_id, created_at, bloqueado:users!user_bloqueos_bloqueado_id_fkey(id, nombre, foto_url)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.bloqueado_id,
    nombre: row.bloqueado?.nombre ?? null,
    fotoUrl: row.bloqueado?.foto_url ?? null,
  }));
}

/**
 * Señal en memoria de "acabo de bloquear a X", para la pantalla que quedó
 * DEBAJO de un flujo que no la controla: "Reportar" bloquea, cierra su hoja y
 * vuelve a un Detalle cuya publicación la base ya no le muestra. Ese Detalle la
 * consume al recuperar el foco y sale, en vez de pintar "ya no está
 * disponible" con un copy que habla de otra cosa. Mismo criterio que
 * `navegacionPorNotificacion` en `push.ts`: un estado comprobado en el momento
 * de actuar, no un temporizador. No es autorización: solo decide a dónde
 * navegar; la base ya escondió la publicación.
 */
let bloqueoReciente: string | null = null;

export function marcarBloqueoReciente(otroId: string): void {
  bloqueoReciente = otroId;
}

/** `true` una sola vez si `otroId` es el último bloqueado. */
export function consumirBloqueoReciente(otroId: string): boolean {
  if (bloqueoReciente !== otroId) return false;
  bloqueoReciente = null;
  return true;
}

/** "Jorge Muñoz" o, sin nombre, "este usuario" — para títulos y toasts. */
export function nombreParaBloqueo(nombre: string | null | undefined): string {
  const limpio = nombre?.trim();
  return limpio ? limpio : 'este usuario';
}
