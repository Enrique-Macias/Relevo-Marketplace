/**
 * La ÚNICA puerta al modal de TOTP del panel. Módulo PURO, sin imports, para
 * que `scripts/probe-puerta-totp.mjs` lo cargue tal cual en Node.
 *
 * Por qué existe: `App.tsx` guardaba el `resolve` del modal en un solo estado
 * (`setPideTotp(() => resolve)`). Dos llamadas concurrentes que pidieran TOTP
 * —dos búsquedas seguidas con el TOTP vencido, o N fotos que fallan a la vez—
 * pisaban el `resolve` de la primera, el modal solo resolvía el último y la
 * primera promesa no terminaba nunca. Aquí:
 *
 *   (a) hay UNA promesa en vuelo, que comparten todas las llamadas, y se limpia
 *       al resolverse, por éxito, por cancelación o por error (`finally`);
 *   (b) hay un ÚNICO dueño del modal (`registrarModal`): un segundo dueño lanza
 *       en vez de pisar al primero;
 *   (c) sin dueño registrado no se abre nada y se responde `false`: la acción
 *       se muestra como rechazada, no se queda colgada.
 */

/** Por qué se pide: el modal pinta el texto de cada caso (frame "Código de verificación (modal)"). */
export type CausaTotp = 'totp_vencido' | 'mfa_requerido';

type AbrirModal = (causa: CausaTotp) => Promise<boolean>;

let abrirModal: AbrirModal | null = null;
let enVuelo: Promise<boolean> | null = null;

/** Lo llama App al montar; devuelve la función para soltar la puerta. */
export function registrarModal(fn: AbrirModal): () => void {
  if (abrirModal && abrirModal !== fn) {
    throw new Error('puerta-totp: ya hay un dueño del modal de TOTP');
  }
  abrirModal = fn;
  return () => {
    if (abrirModal === fn) abrirModal = null;
  };
}

/**
 * Pide el TOTP. Si ya hay un modal abierto, devuelve LA MISMA promesa: todas
 * las llamadas concurrentes terminan juntas con el mismo resultado (y con la
 * causa de la primera, que es la que se ve en el modal).
 */
export function pedirTotp(causa: CausaTotp = 'totp_vencido'): Promise<boolean> {
  if (enVuelo) return enVuelo;
  const abrir = abrirModal;
  if (!abrir) return Promise.resolve(false);
  enVuelo = abrir(causa)
    .catch(() => false)
    .finally(() => {
      enVuelo = null;
    });
  return enVuelo;
}
