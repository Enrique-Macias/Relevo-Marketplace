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
  | 'cerrar_sesion'
  | 'eliminar_cuenta';

// Cambiar cuando la app tenga ficha publicada en al menos una tienda.
const APP_PUBLICADA = false;

// URLs reales cuando exista el aviso/términos publicados.
export const URL_PRIVACIDAD = '';
export const URL_TERMINOS = '';

// Links reales cuando exista la ficha de cada tienda.
export const URL_APP_STORE = '';
export const URL_GOOGLE_PLAY = '';

export const CORREO_CONTACTO = 'noreply@enriquemacias.dev';

export function filaVisible(fila: FilaConfiguracion): boolean {
  switch (fila) {
    case 'notificaciones':
      return pushDisponible;
    case 'calificar':
      // Por plataforma: si APP_PUBLICADA ya es true pero solo una tienda
      // tiene URL real, la fila no se muestra en la otra plataforma.
      return APP_PUBLICADA && (Platform.OS === 'ios' ? URL_APP_STORE !== '' : URL_GOOGLE_PLAY !== '');
    case 'compartir':
      // No depende de ninguna URL de tienda: es texto plano, sin link.
      return APP_PUBLICADA;
    case 'privacidad':
      return URL_PRIVACIDAD !== '';
    case 'terminos':
      return URL_TERMINOS !== '';
    case 'eliminar_cuenta':
      // Oculta por decisión de producto, no por una condición externa: su
      // flujo todavía no existe (tarea siguiente).
      return false;
    case 'contacto':
    case 'version':
    case 'cerrar_sesion':
      return true;
  }
}
