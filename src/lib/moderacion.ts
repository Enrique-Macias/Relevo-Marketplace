/**
 * Moderación pre-publicación (RF-18) del lado del cliente: la llamada a la Edge
 * Function `moderar-contenido` y la suscripción de Realtime que trae el
 * veredicto cuando esa llamada no alcanzó.
 *
 * Vive aparte de `publicar.ts` a propósito: aquel orquesta el ORDEN de las
 * llamadas que tocan `listings`, Storage y `listing_photos`; este es el único
 * punto de contacto con la Edge Function y con Realtime, igual que
 * `src/lib/push.ts` lo es con `expo-notifications`.
 */

import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchListingById, type EstadoListing } from '@/lib/listings';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

/**
 * Los tres estados con los que la moderación puede dejar una publicación recién
 * creada — el subconjunto del enum que `decidirListing()` puede devolver
 * partiendo de `pendiente` (`supabase/functions/moderar-contenido/decision.ts`).
 *
 * `pausada` y `vendida` NO están, y no es un olvido: son decisiones del
 * vendedor, no veredictos. Si alguna aparece aquí, algo que este módulo da por
 * cierto dejó de serlo — ver `ModeracionEstadoInesperadoError`.
 */
export type EstadoModeracion = 'activa' | 'pendiente' | 'bloqueada';

/** La Edge Function no contestó, o contestó algo que no es un veredicto. */
export class ModeracionFallidaError extends Error {
  constructor(detalle?: string) {
    super(`No se pudo moderar la publicación${detalle ? `: ${detalle}` : ''}`);
    this.name = 'ModeracionFallidaError';
  }
}

/**
 * La publicación está en un estado que este flujo no sabe interpretar.
 *
 * Hoy NO ES ALCANZABLE: una fila recién creada nace `pendiente` (el `with_check`
 * de 20260919000463) y de ahí solo la mueve la Edge Function, a uno de los tres
 * valores de `EstadoModeracion`. Existe porque la alternativa era un
 * `as EstadoModeracion` mudo, y ese cast dejaría a `nueva.tsx` navegando al
 * frame equivocado sin que nada lo dijera — en este repo lo que no falla
 * ruidosamente es lo que hay que mirar dos veces (CLAUDE.md §9).
 */
export class ModeracionEstadoInesperadoError extends Error {
  constructor(public readonly estado: string) {
    super(`Estado inesperado para una publicación recién creada: ${estado}`);
    this.name = 'ModeracionEstadoInesperadoError';
  }
}

function comoVeredicto(estado: EstadoListing): EstadoModeracion {
  if (estado === 'activa' || estado === 'pendiente' || estado === 'bloqueada') return estado;
  throw new ModeracionEstadoInesperadoError(estado);
}

/**
 * Pide el veredicto de moderación y devuelve el estado con el que la
 * publicación quedó (RF-18, camino del CLIENTE — el único que puede PROMOVER a
 * `activa`; ver `moderar-contenido/index.ts`, la rama `authMode === 'user'`).
 *
 * VA EN DOS PASOS, Y EL PRIMERO NO ES UNA OPTIMIZACIÓN.
 *
 * `evaluarListing()` evalúa INCONDICIONALMENTE (`index.ts:233`): no mira el
 * estado actual, que solo entra después como argumento de `decidirListing()`. Y
 * ahí, un veredicto `revisar` sobre una publicación ya `activa` la manda a
 * `pendiente` (`decision.ts`, la rama de `revisar`). Junta las dos cosas con un
 * hecho medido —GPT no es determinista sobre el MISMO texto
 * (`.claude/rules/moderacion.md` §6.3)— y sale el caso que este guard existe
 * para cerrar: la función escribió `activa`, la respuesta se perdió, el usuario
 * toca "Reintentar", y la segunda tirada del dado tumba lo que la primera
 * aprobó. Sin que el contenido haya cambiado, y pagando Vision + OpenAI por
 * hacerlo.
 *
 * Leer el estado primero es lo que hace IDEMPOTENTE EL REINTENTO DEL CLIENTE
 * —que es justo lo que `finalizarPublicacion()` promete—, no la función: el
 * camino del trigger de Storage sigue pudiendo re-evaluar (deuda documentada
 * en `.claude/rules/moderacion.md`).
 *
 * NO ES AUTORIZACIÓN DUPLICADA (CLAUDE.md §0 regla 7): la Edge Function se
 * comporta exactamente igual mire el cliente lo que mire, y el ownership lo
 * valida ella con `ctx.userClaims.id`. Lo único que se elige aquí es no volver
 * a tirar el dado.
 *
 * LA CARRERA ES BENIGNA: si el estado cambia entre la lectura y la invocación,
 * lo peor que pasa es que se invoque de más — que es el comportamiento de hoy.
 */
export async function solicitarModeracion(listingId: number): Promise<EstadoModeracion> {
  // `listings_select` deja al dueño ver la suya en CUALQUIER estado
  // (20260917000459), así que esto no necesita nada especial.
  const { data: fila, error: errLectura } = await supabase
    .from('listings')
    .select('estado')
    .eq('id', listingId)
    .maybeSingle();

  if (errLectura) throw new ModeracionFallidaError(errLectura.message);
  if (!fila) throw new ModeracionFallidaError('la publicación ya no existe');

  const actual = fila.estado as EstadoListing;
  if (actual !== 'pendiente') return comoVeredicto(actual);

  const { data, error } = await supabase.functions.invoke('moderar-contenido', {
    body: { listing_id: listingId },
  });

  if (error) throw new ModeracionFallidaError(error.message);

  const estado = (data as { estado?: string } | null)?.estado;
  if (typeof estado !== 'string') {
    throw new ModeracionFallidaError('la respuesta no trae estado');
  }

  return comoVeredicto(estado as EstadoListing);
}

/**
 * El título y el estado de una publicación propia, con Realtime como vía rápida
 * y un refetch al foco como piso — para "Publicación en revisión", que es la
 * única pantalla donde el usuario espera un veredicto que todavía no llegó.
 *
 * LOS CUATRO REQUISITOS DE `.claude/rules/moderacion.md` §4.1, que hasta hoy no
 * tenían ni un consumidor en `src/` (esta es la PRIMERA llamada a `.channel()`
 * del proyecto):
 *
 *  1. **Se suscribe desde un efecto de componente, NUNCA desde
 *     `onAuthStateChange`** — `session.tsx` documenta el deadlock de supabase-js
 *     con cualquier llamada async dentro de ese callback.
 *  2. **`removeChannel` al desmontar.** Sin esto se vuelve literalmente lo que
 *     `notificaciones.ts` rechazó: "una suscripción abierta toda la sesión".
 *     Aquí es a UNA fila, por SEGUNDOS, mientras una pantalla concreta está
 *     montada — por eso la excepción se sostiene.
 *  3. **Gate por token**, el patrón de `ListingPhoto`: sin `access_token` no se
 *     intenta.
 *  4. **El fallback es OBLIGATORIO, no un extra.** Realtime es best-effort: el
 *     socket puede no conectar, y `supabase.ts` solo refresca el token en
 *     foreground, así que en background se cae. Realtime es la vía rápida; el
 *     refetch al foco es el que GARANTIZA.
 *
 * Del lado del servidor no hace falta nada: `20260917000460` ya metió la tabla
 * en la publicación de Realtime, y `listings_select` ya deja al dueño ver la
 * suya en cualquier estado — eso último es load-bearing, porque Realtime evalúa
 * la RLS del suscriptor: si alguien endurece esa policy, el vendedor deja de
 * enterarse de su propio veredicto.
 *
 * LOS LOGS NO SON DEBUG OLVIDADO: son lo único que hace VERIFICABLE al
 * requisito 4. Con el piso funcionando, un canal que nunca conecta se ve
 * exactamente igual que uno que entrega —el veredicto llega de todos modos—,
 * así que la corrida de verificación saldría verde sin haber probado Realtime en
 * absoluto. Es el patrón que CLAUDE.md §9 advierte: en este repo, lo que no
 * falla ruidosamente es lo que hay que mirar dos veces. De ahí que se imprima el
 * estado del canal Y por qué vía llegó cada veredicto.
 *
 * NO van gateados por `__DEV__` —que además no se usa en ningún lado de `src/`—
 * porque eso haría que el dev build y el build de tienda se comporten distinto
 * justo en el camino que hay que verificar. Alcance honesto: nada strippea
 * `console.*` en este proyecto (no hay `babel.config.js` ni
 * `transform-remove-console`), pero tampoco hay recolector de logs, así que en
 * release solo los lee quien tenga el aparato enchufado a Xcode o `adb logcat`.
 *
 * Y NO se devuelven como parte del valor del hook: `revision.tsx` no los
 * pintaría, y un campo sin consumidor es justo lo que este repo evita.
 */
export function useVeredictoEnVivo(listingId: number): {
  titulo: string | null;
  estado: EstadoListing | null;
} {
  const { session } = useSession();
  const token = session?.access_token ?? null;

  const [titulo, setTitulo] = useState<string | null>(null);
  const [estado, setEstado] = useState<EstadoListing | null>(null);

  /**
   * El último estado conocido, en un REF y no leído del state.
   *
   * `leer()` tiene que compararse contra él para saber si lo que trajo es un
   * cambio o la carga inicial, y hacerlo con `estado` lo metería en las
   * dependencias de su `useCallback` — que es justo lo que dispara el efecto de
   * abajo (`useEffect(() => leer(), [leer])`), o sea un bucle de lecturas.
   */
  const estadoRef = useRef<EstadoListing | null>(null);

  const leer = useCallback(() => {
    if (Number.isNaN(listingId)) return;
    fetchListingById(listingId)
      .then((l) => {
        if (!l) return;
        setTitulo(l.titulo);

        const previo = estadoRef.current;
        estadoRef.current = l.estado;
        setEstado(l.estado);

        // SOLO si cambió. La primera lectura (previo `null`) es la carga de la
        // pantalla, no un veredicto: anunciarla como "por refetch" volvería
        // ilegible el runbook, que se apoya en esta línea para distinguir qué
        // vía entregó.
        if (previo !== null && previo !== l.estado) {
          console.log(
            `[moderacion] veredicto de ${listingId} por REFETCH: ${previo} → ${l.estado}`
          );
        }
      })
      .catch((e: any) =>
        console.warn('[moderacion] no se pudo leer la publicación:', e?.message ?? e)
      );
  }, [listingId]);

  useEffect(() => leer(), [leer]);

  /**
   * EL PISO. Salta el primer foco porque el efecto de arriba ya está leyendo
   * para ese montaje — mismo ref que usan `mis-publicaciones.tsx`,
   * `editar/[id].tsx` y `perfil.tsx`; sin él, entrar a la pantalla dispararía
   * dos lecturas idénticas.
   */
  const primerFoco = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primerFoco.current) {
        primerFoco.current = false;
        return;
      }
      leer();
    }, [leer])
  );

  useEffect(() => {
    if (token === null || Number.isNaN(listingId)) return;

    const canal = supabase
      .channel(`listing-${listingId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'listings',
          filter: `id=eq.${listingId}`,
        },
        (payload) => {
          const nuevo = (payload.new as { estado?: EstadoListing } | null)?.estado;
          if (!nuevo) return;

          // SIN condicionar a que haya cambiado, al revés que el refetch: que
          // llegue un evento ES la prueba de que Realtime entrega, y es
          // exactamente lo que hay que poder afirmar al apagar la publicación a
          // propósito para probar el piso.
          console.log(`[moderacion] veredicto de ${listingId} por REALTIME: ${nuevo}`);

          estadoRef.current = nuevo;
          setEstado(nuevo);
        }
      )
      .subscribe((status, err) => {
        if (
          status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
          status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT
        ) {
          console.warn(`[moderacion] canal de ${listingId}: ${status}`, err?.message ?? '');
          return;
        }
        // `SUBSCRIBED` y `CLOSED`. El segundo es lo que hace observable el
        // requisito 2: si entrar y salir de la pantalla no imprime un `CLOSED`
        // por cada `SUBSCRIBED`, el canal quedó abierto.
        console.log(`[moderacion] canal de ${listingId}: ${status}`);
      });

    return () => {
      supabase.removeChannel(canal);
    };
  }, [listingId, token]);

  return { titulo, estado };
}
