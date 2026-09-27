/**
 * Qué pasa en pantalla cuando la sesión DESAPARECE — el guard global.
 *
 * EL HUECO QUE CIERRA. Hasta aquí el único redirect a `/splash` era el
 * `<Redirect>` de `(tabs)/_layout.tsx`, y `<Redirect>` navega en
 * `useFocusEffect` (`expo-router/build/link/Redirect.js`): mientras `(tabs)`
 * está TAPADO por un grupo hermano del stack raíz —`(cuenta)`, `(explorar)`,
 * `(publicar)`…— no hace nada. Si la sesión moría ahí (token vencido, o
 * eliminar la cuenta desde Configuración), el usuario se quedaba en una
 * pantalla viva sin sesión. Documentado en CLAUDE.md §9 y en
 * `.claude/rules/cuenta-perfil.md`; fue lo que obligó a revertir "Cerrar
 * sesión" a Perfil.
 *
 * CÓMO. Un efecto (NO de foco) montado en el layout RAÍZ, que nunca pierde el
 * foco, detecta la TRANSICIÓN con sesión → sin sesión y REINICIA el navegador
 * raíz. Reiniciar y no `dismissAll()`: `dismissAll()` cierra solo el stack más
 * cercano —el de `(cuenta)`— y dejaría `(tabs)` vivo debajo.
 *
 * CUÁNDO NO ACTÚA:
 *  · Al arrancar sin sesión: no hay transición, `splash` decide.
 *  · Si la sesión muere estando en `(tabs)`: ahí `(tabs)` SÍ tiene foco y su
 *    `<Redirect>` ya navega. Actuar también sería navegar dos veces.
 *  · Si muere estando en `(onboarding)`: esos flujos cierran sesión A
 *    PROPÓSITO y navegan solos ("Usar otro correo", "Nueva contraseña").
 *  Salvo que alguien haya pedido un destino con `salirHacia()`: entonces actúa
 *  siempre, porque ese destino es la razón del cierre de sesión.
 */

import { useNavigationContainerRef, useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useSession } from '@/lib/session';

/** Pantallas de `(onboarding)` a las que se puede salir. */
type DestinoSalida = 'splash' | 'cuenta-eliminada';

let destinoPendiente: DestinoSalida | null = null;

/**
 * Pide que, cuando la sesión desaparezca, se aterrice en `destino` en vez de
 * `/splash`. Se llama JUSTO ANTES de cerrar la sesión, así el guard es el único
 * que navega y no hay dos navegaciones compitiendo.
 */
export function salirHacia(destino: DestinoSalida): void {
  destinoPendiente = destino;
}

export function useSalidaAlPerderSesion(): void {
  const { session } = useSession();
  const segments = useSegments();
  const navegacion = useNavigationContainerRef();

  const userIdPrevio = useRef<string | null>(null);
  const grupo = segments[0];
  const userId = session?.user.id ?? null;

  // `grupo` está en las dependencias y aun así cambiar de pantalla no navega:
  // el efecto solo actúa en la corrida en que había usuario y ya no, y en esa
  // misma corrida `userIdPrevio` pasa a null, así que la siguiente (por
  // pantalla o por lo que sea) sale en la primera línea.

  useEffect(() => {
    const previo = userIdPrevio.current;
    userIdPrevio.current = userId;
    if (!previo || userId) return;

    const pedido = destinoPendiente;
    destinoPendiente = null;

    if (!pedido && (grupo === '(tabs)' || grupo === '(onboarding)')) {
      return;
    }
    // Una transición real solo ocurre con la app ya en uso, así que el
    // contenedor ya está listo; el chequeo es para no lanzar si no.
    if (!navegacion.isReady()) return;

    navegacion.reset({
      index: 0,
      routes: [
        {
          name: '(onboarding)',
          state: { index: 0, routes: [{ name: pedido ?? 'splash' }] },
        },
      ],
    });
  }, [userId, grupo, navegacion]);
}
