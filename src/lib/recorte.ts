/**
 * Geometría del "Editor de foto de perfil" (DESIGN-1 fase 5), PURA a propósito:
 * sin imports, para que `scripts/probe-recorte.mjs` la cargue tal cual desde
 * Node (mismo criterio que `src/lib/ubicacion.ts`). Si alguien le mete un
 * import de React Native, el probe deja de arrancar: esa es la señal.
 *
 * Las cuatro primeras llevan `'worklet'`: el editor las llama en el hilo de UI
 * mientras el dedo se mueve (acotar en vivo). En Node la directiva es solo una
 * cadena suelta y no cambia nada; `rectRecorte()` corre en JS al confirmar.
 *
 * El modelo es el del prototipo (`relevo-app.html`, `.crop-stage`/`.crop-mask`
 * y su JS):
 *  - el escenario es un cuadrado de `lado` puntos;
 *  - la imagen lo CUBRE con zoom 1 (como `object-fit: cover`), centrada;
 *  - el círculo es concéntrico, de diámetro `FRACCION_CIRCULO × lado`;
 *  - el usuario mueve (`x`, `y`, en puntos del escenario, desplazamiento del
 *    centro de la imagen) y hace zoom (`escala`, de 1 a `ZOOM_MAXIMO`);
 *  - el paneo se limita para que el círculo quede SIEMPRE cubierto por la
 *    imagen: nunca se recorta un pedazo vacío.
 */

/** `.crop-mask{left:10%; width:80%}`. */
export const FRACCION_CIRCULO = 0.8;
/** `MAX_ZOOM` del prototipo. */
export const ZOOM_MAXIMO = 4;

export type Encuadre = { escala: number; x: number; y: number };
export type Rect = { originX: number; originY: number; width: number; height: number };

/** Puntos por píxel con zoom 1: el lado CORTO de la imagen llena el escenario. */
export function escalaBase(lado: number, anchoImg: number, altoImg: number): number {
  'worklet';
  return lado / Math.min(anchoImg, altoImg);
}

export function acotarEscala(escala: number): number {
  'worklet';
  if (!Number.isFinite(escala)) return 1;
  return Math.min(ZOOM_MAXIMO, Math.max(1, escala));
}

/**
 * Cuánto puede moverse el centro de la imagen en cada eje sin destapar el
 * círculo: la mitad de lo que la imagen mostrada sobra respecto al diámetro.
 */
export function limitesPaneo(
  lado: number,
  anchoImg: number,
  altoImg: number,
  escala: number
): { maxX: number; maxY: number } {
  'worklet';
  const s = escalaBase(lado, anchoImg, altoImg) * acotarEscala(escala);
  const diametro = FRACCION_CIRCULO * lado;
  return {
    maxX: Math.max(0, (anchoImg * s - diametro) / 2),
    maxY: Math.max(0, (altoImg * s - diametro) / 2),
  };
}

export function acotarEncuadre(
  lado: number,
  anchoImg: number,
  altoImg: number,
  e: Encuadre
): Encuadre {
  'worklet';
  const escala = acotarEscala(e.escala);
  const { maxX, maxY } = limitesPaneo(lado, anchoImg, altoImg, escala);
  const acotar = (v: number, m: number) => (Number.isFinite(v) ? Math.min(m, Math.max(-m, v)) : 0);
  return { escala, x: acotar(e.x, maxX), y: acotar(e.y, maxY) };
}

/**
 * El cuadrado que circunscribe al círculo, en PÍXELES de la imagen, listo para
 * `ImageManipulator.crop()`. Enteros, cuadrado (`width === height`) y dentro
 * de la imagen: el manipulator rechaza un rectángulo que se salga.
 *
 * Con el encuadre ya acotado, el cuadrado cabe por construcción; el ajuste final
 * solo absorbe el redondeo.
 */
export function rectRecorte(
  lado: number,
  anchoImg: number,
  altoImg: number,
  encuadre: Encuadre
): Rect {
  const e = acotarEncuadre(lado, anchoImg, altoImg, encuadre);
  const s = escalaBase(lado, anchoImg, altoImg) * e.escala;
  const diametro = FRACCION_CIRCULO * lado;

  // El círculo empieza en (lado − diámetro)/2 del escenario; la imagen mostrada,
  // en lado/2 + x − anchoImg·s/2. La diferencia, en píxeles de la imagen:
  const origenX = (anchoImg * s - diametro) / 2 - e.x;
  const origenY = (altoImg * s - diametro) / 2 - e.y;

  const tam = Math.max(1, Math.min(Math.round(diametro / s), anchoImg, altoImg));
  const acotar = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));

  return {
    originX: acotar(origenX / s, anchoImg - tam),
    originY: acotar(origenY / s, altoImg - tam),
    width: tam,
    height: tam,
  };
}
