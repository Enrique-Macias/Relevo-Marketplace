/**
 * Qué fila de "Configuración" se pinta HOY — un solo lugar, no condiciones
 * dispersas por la pantalla. El frame (`design/relevo-app.html`) muestra
 * TODAS las filas, incluidas las que este módulo mantiene ocultas.
 */

import { Platform } from 'react-native';

import { urlWhatsapp } from '@/lib/perfil';
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
 * que se pintan por esto tienen su comportamiento REAL de hoy: la de
 * notificaciones sale sin texto ni acción si el módulo nativo no está en el
 * build. Apagarla
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

// Dos buzones con propósitos distintos: `CORREO_SOPORTE` = ayuda con la cuenta,
// desde "Ayuda y soporte" de Perfil (`HojaSoporte`); `CORREO_CONTACTO` = la fila
// "Contacto" de Configuración.
export const CORREO_CONTACTO = 'contacto@rlvo.com.mx';
export const CORREO_SOPORTE = 'soporte@rlvo.com.mx';

// WhatsApp de soporte, en E.164 con `+`. Vacío = la hoja de soporte no pinta el
// botón de WhatsApp (queda solo el correo).
export const NUMERO_SOPORTE = '';

/**
 * Botón de WhatsApp de `HojaSoporte`. NO pasa por `VISTA_PREVIA_TODAS_LAS_FILAS`
 * a propósito: con la constante vacía, el bypass de `filaVisible` lo pintaría en
 * dev y abriría `wa.me/` roto.
 */
export function whatsappSoporteDisponible(): boolean {
  return NUMERO_SOPORTE !== '';
}

// El nombre de la app en los textos de soporte sale SOLO de aquí (rebranding).
const MARCA = 'Relevo';

/**
 * Asunto y cuerpo prellenados de soporte, para WhatsApp y para el correo. El
 * único sitio que interpola `MARCA`. El correo es el de la propia sesión del
 * usuario: lo ve y lo puede borrar antes de enviar.
 */
export function textosSoporte(correo?: string | null): { asunto: string; cuerpo: string } {
  const lineas = [`Hola, necesito ayuda con mi cuenta de ${MARCA}.`];
  if (correo) lineas.push(`Mi correo: ${correo}`);
  return { asunto: `Ayuda con mi cuenta de ${MARCA}`, cuerpo: lineas.join('\n') };
}

export function urlSoporteWhatsapp(correo?: string | null): string {
  return urlWhatsapp(NUMERO_SOPORTE, textosSoporte(correo).cuerpo);
}

// `encodeURIComponent` y no `URLSearchParams`: éste codifica el espacio como
// `+`, que varios clientes de correo muestran literal en asunto y cuerpo.
export function urlSoporteCorreo(correo?: string | null): string {
  const { asunto, cuerpo } = textosSoporte(correo);
  return `mailto:${CORREO_SOPORTE}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
}

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
      // Siempre: Apple (5.1.1(v)) y Google Play exigen poder borrar la cuenta
      // desde la app. El flujo es el modal de `configuracion.tsx` + la Edge
      // Function `eliminar-cuenta`.
      return true;
    case 'contacto':
    case 'version':
      return true;
  }
}
