/**
 * Inbox de notificaciones (RF-16).
 *
 * La RLS de `notifications` es `user_id = auth.uid()` en select y update, así
 * que estas queries no filtran por usuario: la base ya lo hace. Lo único que el
 * cliente puede escribir es `leida_at` — `titulo` y `cuerpo` están fuera del
 * grant de columna (migración 20260911000451), porque los materializa el trigger
 * en el momento del evento y son historia, no estado editable.
 */

import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';

export type TipoNotificacion = 'precio_favorito' | 'reporte_resuelto';

export type Notificacion = {
  id: number;
  tipo: TipoNotificacion;
  titulo: string;
  cuerpo: string;
  listingId: number | null;
  leida: boolean;
  createdAt: string;
};

/**
 * Sin paginar, y es una decisión con fecha de caducidad declarada: hoy una
 * cuenta acumula notificaciones de a una por baja de precio de un favorito, o
 * sea decenas al año. Ver la deuda de CLAUDE.md §8 para el disparador de cuándo
 * esto necesita cursor.
 */
const TOPE = 100;

export async function fetchNotificaciones(): Promise<Notificacion[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, tipo, titulo, cuerpo, listing_id, leida_at, created_at')
    .order('created_at', { ascending: false })
    .limit(TOPE);

  if (error) throw error;

  return (data ?? []).map((n) => ({
    id: n.id,
    tipo: n.tipo as TipoNotificacion,
    titulo: n.titulo,
    cuerpo: n.cuerpo,
    listingId: n.listing_id,
    leida: n.leida_at !== null,
    createdAt: n.created_at,
  }));
}

/** El número del punto de la campana en el Feed. */
export async function contarNoLeidas(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('leida_at', null);

  if (error) throw error;
  return count ?? 0;
}

/**
 * Marca como leídas las que todavía no lo están.
 *
 * El `.is('leida_at', null)` no es una optimización: sin él, cada apertura del
 * inbox reescribiría la fecha de TODAS las filas, y "leída hace 3 días" se
 * volvería "leída ahora" cada vez.
 */
export async function marcarTodasLeidas(): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ leida_at: new Date().toISOString() })
    .is('leida_at', null);

  if (error) throw error;
}

type EstadoLista = 'loading' | 'ready' | 'error';

/**
 * La lista del inbox.
 *
 * Resetea EN RENDER comparando una `key` contra la anterior, que es el patrón de
 * `useMisListings` (src/lib/listings.ts) y no el de `useListings`. Hacerlo en la
 * primera línea del efecto da el mismo resultado final pero deja pasar un render
 * con la lista del usuario ANTERIOR todavía pintada — inaceptable aquí, donde el
 * contenido es privado. Ver CLAUDE.md §9: la regla `set-state-in-effect` no
 * detecta ese patrón cuando el guard lee un ref, así que que el lint calle no
 * prueba nada.
 */
export function useNotificaciones(userId: string | null) {
  const [items, setItems] = useState<Notificacion[]>([]);
  const [estado, setEstado] = useState<EstadoLista>('loading');
  const [recargas, setRecargas] = useState(0);

  const key = `${userId ?? ''}|${recargas}`;
  const [keyPintada, setKeyPintada] = useState(key);
  if (key !== keyPintada) {
    setKeyPintada(key);
    setItems([]);
    setEstado('loading');
  }

  useEffect(() => {
    if (!userId) return;

    let vigente = true;

    fetchNotificaciones()
      .then((filas) => {
        if (!vigente) return;
        setItems(filas);
        setEstado('ready');
      })
      .catch((e: any) => {
        if (!vigente) return;
        console.warn('[notificaciones] falló la carga:', e?.message ?? e);
        setEstado('error');
      });

    return () => {
      vigente = false;
    };
  }, [userId, recargas]);

  /**
   * Marca todo como leído y pinta el cambio de inmediato.
   *
   * Optimista sin rollback a propósito, mismo criterio que el corazón de
   * favoritos (§8b): la policy de update solo compara `user_id = auth.uid()`
   * sobre filas propias, así que no existe un rechazo por política para una
   * escritura bien formada — los únicos fallos posibles son de transporte. Y el
   * costo de equivocarse es que el punto reaparezca al recargar, no que se
   * pierda nada.
   */
  const marcarLeidas = useCallback(async () => {
    if (!items.some((n) => !n.leida)) return;

    setItems((prev) => prev.map((n) => ({ ...n, leida: true })));
    try {
      await marcarTodasLeidas();
    } catch (e: any) {
      console.warn('[notificaciones] no se pudo marcar como leídas:', e?.message ?? e);
    }
  }, [items]);

  const recargar = useCallback(() => setRecargas((n) => n + 1), []);

  return { items, estado, marcarLeidas, recargar };
}

/**
 * El punto de la campana del Feed.
 *
 * Devuelve `recontar` en vez de refrescarse solo: el Feed lo llama al volver del
 * inbox, que es el único momento en que este número cambia sin que llegue un
 * push. No usa Realtime — sería una suscripción abierta toda la sesión para un
 * dato que cambia un puñado de veces al día.
 */
export function useNoLeidas(userId: string | null) {
  const [noLeidas, setNoLeidas] = useState(0);

  // Mismo reseteo-en-render que `useNotificaciones`, y aquí importa igual: al
  // cambiar de cuenta, el punto de la campana mostraría el conteo del usuario
  // ANTERIOR hasta que llegara la respuesta del nuevo.
  const [keyPintada, setKeyPintada] = useState(userId);
  if (userId !== keyPintada) {
    setKeyPintada(userId);
    setNoLeidas(0);
  }

  // Sin `setNoLeidas` síncrono aquí dentro: el caso "sin usuario" se resuelve
  // en el reseteo de arriba y en el early return, no llamando a setState desde
  // el cuerpo del efecto (regla `react-hooks/set-state-in-effect`).
  const recontar = useCallback(() => {
    if (!userId) return;
    contarNoLeidas()
      .then(setNoLeidas)
      .catch((e: any) => console.warn('[notificaciones] falló el conteo:', e?.message ?? e));
  }, [userId]);

  useEffect(() => {
    recontar();
  }, [recontar]);

  return { noLeidas, recontar };
}
