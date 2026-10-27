/**
 * Cuándo abrir "Términos actualizados" (PL-016, Q1) desde una ACCIÓN.
 *
 * La entrada normal no pasa por aquí: es la puerta de `(tabs)/_layout.tsx`, que
 * redirige a la pantalla mientras la sesión no acepte la versión vigente. Esto
 * cubre lo que esa puerta no ve: una sesión que se queda sin aceptación con
 * `(tabs)` tapado (su `<Redirect>` no navega sin foco, CLAUDE.md §9), o una
 * pantalla abierta por un aviso encima de todo.
 *
 * Nada de esto es el candado: publicar, contactar, calificar, fotos, foto de
 * perfil, teléfono y carrera los rechaza la base sin aceptación (policies y
 * triggers de 20261026000490). Aquí solo se elige mostrar la pantalla ANTES de
 * que la acción choque con ese rechazo, porque el de una policy llega como un
 * `42501` genérico que no dice por qué (§0 regla 7).
 *
 * Con el estado desconocido (`terminosAceptados === null`: todavía cargando, la
 * lectura falló o no hay versión vigente) no se abre nada y la acción sigue:
 * si la base la rechaza, el usuario ve el error de siempre.
 *
 * Va aparte de `terminos.ts` porque usa la sesión, y `session.tsx` importa
 * `terminos.ts`.
 */

import { router } from 'expo-router';
import { useCallback } from 'react';

import { useSession } from '@/lib/session';
import { esTerminosNoAceptados } from '@/lib/terminos';

/**
 * Devuelve una función para llamar al INICIO de una acción que exige
 * aceptación: `if (!exigirTerminos()) return;`. Si la sesión no aceptó la
 * versión vigente, abre la pantalla y devuelve false.
 */
export function useExigirTerminos(): () => boolean {
  const { terminosAceptados } = useSession();
  return useCallback(() => {
    if (terminosAceptados !== false) return true;
    router.push('/terminos-actualizados');
    return false;
  }, [terminosAceptados]);
}

/**
 * Para el `catch` de una acción: si la base la rechazó por los términos (solo
 * los triggers lo dicen con todas sus letras, `esTerminosNoAceptados`), relee
 * el estado y abre la pantalla. Devuelve true si lo manejó.
 */
export function useManejarRechazoTerminos(): (e: unknown) => boolean {
  const { refreshTerminos } = useSession();
  return useCallback(
    (e: unknown) => {
      if (!esTerminosNoAceptados(e)) return false;
      void refreshTerminos();
      router.push('/terminos-actualizados');
      return true;
    },
    [refreshTerminos]
  );
}
