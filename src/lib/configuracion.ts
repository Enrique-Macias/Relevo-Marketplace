/**
 * Qué fila de "Configuración" se pinta HOY — un solo lugar, no condiciones
 * dispersas por la pantalla. El frame (`design/relevo-app.html`) muestra
 * TODAS las filas, incluidas las que este módulo mantiene ocultas.
 */

import { Platform } from 'react-native';

import { pushDisponible } from '@/lib/push';

export type FilaConfiguracion =
  | 'notificaciones'
  | 'calificar'
  | 'compartir'
  | 'privacidad'
  | 'terminos'
  | 'contacto'
  | 'version'
  | 'eliminar_cuenta';

/**
 * VISTA PREVIA: pinta TODAS las filas, ignorando las condiciones de abajo,
 * para ver la pantalla completa contra el frame. Gateado a `__DEV__`, así que
 * un build de producción nunca la hereda aunque se quede en `true`. Las filas
 * que se pintan por esto tienen su comportamiento REAL de hoy: "Eliminar
 * cuenta" no hace nada (su flujo es otra tarea) y la de notificaciones sale
 * sin texto ni acción si el módulo nativo no está en el build. Apagarla
 * (`false`) para probar la lógica real de visibilidad.
 */
const VISTA_PREVIA_TODAS_LAS_FILAS = __DEV__ && true;

// Cambiar cuando la app tenga ficha publicada en al menos una tienda.
const APP_PUBLICADA = false;

// URLs reales cuando exista el aviso/términos publicados.
export const URL_PRIVACIDAD = 'https://enriquemacias.dev/';
export const URL_TERMINOS = 'https://enriquemacias.dev/';

// Links reales cuando exista la ficha de cada tienda.
export const URL_APP_STORE = 'https://apps.apple.com/mx/app/relevo/id1501683637';
export const URL_GOOGLE_PLAY = 'https://play.google.com/store/apps/details?id=com.enriquemacias.relevo';

export const CORREO_CONTACTO = 'noreply@enriquemacias.dev';

export function filaVisible(fila: FilaConfiguracion): boolean {
  if (VISTA_PREVIA_TODAS_LAS_FILAS) return true;
  switch (fila) {
    case 'notificaciones':
      return pushDisponible;
    case 'calificar':
      // Por plataforma: si APP_PUBLICADA ya es true pero solo una tienda
      // tiene URL real, la fila no se muestra en la otra plataforma.
      return APP_PUBLICADA && (Platform.OS === 'ios' ? URL_APP_STORE !== 'https://apps.apple.com/mx/app/relevo/id1501683637' : URL_GOOGLE_PLAY !== 'https://play.google.com/store/apps/details?id=com.enriquemacias.relevo');
    case 'compartir':
      // No depende de ninguna URL de tienda: es texto plano, sin link.
      return APP_PUBLICADA;
    case 'privacidad':
      return URL_PRIVACIDAD !== 'https://enriquemacias.dev/';
    case 'terminos':
      return URL_TERMINOS !== 'https://enriquemacias.dev/';
    case 'eliminar_cuenta':
      // Oculta por decisión de producto, no por una condición externa: su
      // flujo todavía no existe (tarea siguiente).
      return false;
    case 'contacto':
    case 'version':
      return true;
  }
}
