/**
 * Estado y validación del formulario de publicación, compartido por
 * "Publicar" y "Editar publicación" — son el mismo formulario con distinto
 * origen de datos y distinto botón.
 *
 * La validación sigue el patrón que ya estableció "Completar perfil": no hay
 * mensajes de error por campo ni validación en `onChange`; se deriva un
 * booleano en el render y se pasa a `disabled`, que el prototipo ya pinta con
 * `opacity:0.45` (`.primary-btn.disabled`).
 */

import { useCallback, useMemo, useState } from 'react';

import {
  idFoto,
  type FotoElegida,
  type FotoEnEdicion,
  type FotoProcesando,
} from '@/components/PhotoRow';
import type { Condicion, ListingInput } from '@/lib/listings';
import { MAX_FOTOS } from '@/lib/storage';

export const CONDICIONES: { value: Condicion; label: string }[] = [
  { value: 'nuevo', label: 'Nuevo' },
  { value: 'como_nuevo', label: 'Como nuevo' },
  { value: 'buen_estado', label: 'Buen estado' },
  { value: 'usado', label: 'Usado' },
];

export type ValoresIniciales = {
  titulo: string;
  precio: number | undefined;
  descripcion: string;
  categoriaId: number | undefined;
  condicion: Condicion | undefined;
  fotos: FotoEnEdicion[];
};

export const FORMULARIO_VACIO: ValoresIniciales = {
  titulo: '',
  precio: undefined,
  descripcion: '',
  categoriaId: undefined,
  condicion: undefined,
  fotos: [],
};

/**
 * `listings.precio` es un entero de pesos, 0-100000 inclusive (`check` de
 * `20260922000464`, RF-05) — el 0 permite regalar.
 */
export const PRECIO_MAX = 100000;

/**
 * Extrae el número de lo que el usuario tecleó o pegó. Decide qué es un
 * separador de MILES (se descarta, se conservan todos los dígitos) y qué es
 * un separador DECIMAL (se trunca ahí, se descarta la fracción) por la
 * cantidad de dígitos que le siguen al ÚLTIMO separador: 3 dígitos → miles
 * ("1,250" → 1250, "$1250" → 1250); 1 o 2 dígitos → decimal ("12.50"/"12,50"
 * → 12, NUNCA 1250 — quitar el separador sin mirar cuántos dígitos trae
 * multiplicaría el precio por 100 sin avisar).
 *
 * Se trunca y no se rechaza: es la misma operación que ya exige la base
 * (`precio = trunc(precio)`), así que cliente y base nunca discrepan sobre
 * qué hacer con un decimal. Y sigue el criterio que ya documenta
 * `PhoneField` (`src/components/Field.tsx:90-93`) para el campo hermano de
 * este mismo formulario: "pelearle al usuario a media escritura es peor que
 * limpiar al guardar". Cadena vacía → `NaN` (campo vacío, no 0). Los ceros a
 * la izquierda se resuelven solos al pasar por `Number(...)`
 * ("05" → 5, "000" → 0).
 */
export function parsePrecioInput(texto: string): number {
  const soloValidos = texto.replace(/[^0-9.,]/g, '');
  const idxSeparador = Math.max(soloValidos.lastIndexOf('.'), soloValidos.lastIndexOf(','));

  if (idxSeparador === -1) {
    const digitos = soloValidos;
    return digitos === '' ? NaN : Number(digitos);
  }

  const digitosDespues = soloValidos.length - idxSeparador - 1;
  if (digitosDespues === 3) {
    // Separador de miles: se descarta junto con cualquier otro que lo
    // acompañe, y se conservan todos los dígitos.
    const digitos = soloValidos.replace(/[.,]/g, '');
    return digitos === '' ? NaN : Number(digitos);
  }

  // Separador decimal: se trunca ahí.
  const digitos = soloValidos.slice(0, idxSeparador).replace(/[.,]/g, '');
  return digitos === '' ? NaN : Number(digitos);
}

/** Mismo formateo de miles que `formatPrecio` (`src/lib/format.ts`) pero SIN
 * el caso "Gratis": es lo que se ve mientras se EDITA el campo, y un precio
 * de 0 en el formulario se ve "$0" como cualquier otro número — "Gratis" es
 * solo de lectura, para no reemplazar el valor que el usuario está tecleando.
 */
export function formatPrecioInput(n: number): string {
  const conComas = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${conComas}`;
}

/**
 * Distingue un TECLEO (o backspace) de un PEGADO — es lo que decide si
 * `parsePrecioInput` corre su heurístico de miles-vs-decimal o no.
 *
 * BUG QUE ESTO CORRIGE: `onChangeText` entrega el texto COMPLETO del campo,
 * que ya trae la coma que puso `formatPrecioInput` en el render anterior. Al
 * cruzar de $999 a $1,000 y seguir tecleando un dígito más, ese texto es
 * "$1,0000" — 4 dígitos después de la coma, no 3 — y el heurístico de
 * `parsePrecioInput` lo lee como separador DECIMAL y trunca a "1". El
 * teclado es `number-pad` (sin tecla de punto/coma), así que un tecleo o un
 * backspace JAMÁS inserta ni quita una coma por sí solo: cualquier coma
 * presente ahí es una de LAS NUESTRAS, no algo que el usuario haya escrito, y
 * quitarla a secas (sin heurístico) es lo correcto.
 *
 * Se detecta por PREFIJO de dígitos, no por longitud de string a secas —una
 * longitud parecida no basta: seleccionar todo el campo y PEGAR un
 * reemplazo de tamaño similar (ej. "$500" → pegar "12.50") tiene casi la
 * misma longitud que un tecleo, y ahí SÍ hace falta el heurístico completo
 * (si no, "12.50" se leería como "1250", el mismo bug de multiplicar por
 * 100 que este campo existe para evitar). Un tecleo/backspace real siempre
 * dice: los dígitos nuevos son los de antes con UN dígito de más al final, o
 * con UN dígito de menos al final — nunca un juego de dígitos distinto.
 */
function esTecleoSimple(anterior: number, digitosNuevos: string): boolean {
  const digitosAnteriores = Number.isFinite(anterior) ? String(anterior) : '';
  return (
    (digitosNuevos.length === digitosAnteriores.length + 1 &&
      digitosNuevos.slice(0, -1) === digitosAnteriores) ||
    (digitosNuevos.length === digitosAnteriores.length - 1 &&
      digitosAnteriores.slice(0, -1) === digitosNuevos)
  );
}

/**
 * La transición completa de `precioNum` ante un `onChangeText` — pura, sin
 * `useState`, para poder probarla desde Node sin arrastrar React. `setPrecio`
 * (más abajo) es un envoltorio de una línea sobre esta función; si algún día
 * vuelven a divergir, es una señal de que algo se "optimizó" mal.
 */
export function siguientePrecio(anterior: number, texto: string): number {
  const digitosNuevos = texto.replace(/[^0-9]/g, '');
  const parsed = esTecleoSimple(anterior, digitosNuevos)
    ? digitosNuevos === ''
      ? NaN
      : Number(digitosNuevos)
    : parsePrecioInput(texto);
  if (Number.isFinite(parsed) && parsed > PRECIO_MAX) return anterior;
  return parsed;
}

export function useListingForm(iniciales: ValoresIniciales = FORMULARIO_VACIO) {
  const [titulo, setTitulo] = useState(iniciales.titulo);
  // `NaN` = campo vacío (distinto de 0, que sí es un precio válido — regalar).
  const [precioNum, setPrecioNum] = useState<number>(iniciales.precio ?? NaN);
  const [descripcion, setDescripcion] = useState(iniciales.descripcion);
  const [categoriaId, setCategoriaId] = useState<number | undefined>(iniciales.categoriaId);
  const [condicion, setCondicion] = useState<Condicion | undefined>(iniciales.condicion);
  const [fotos, setFotos] = useState<FotoEnEdicion[]>(iniciales.fotos);

  const agregarFotos = useCallback((nuevas: FotoElegida[]) => {
    setFotos((prev) => [...prev, ...nuevas].slice(0, MAX_FOTOS));
  }, []);

  const quitarFoto = useCallback((index: number) => {
    setFotos((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /**
   * Slots de "esto se está eligiendo", agregados apenas `elegirFotos()` sabe
   * cuántas fotos pasaron el filtro de formato — antes de que ninguna termine
   * de normalizarse. Mismo `.slice(MAX_FOTOS)` que `agregarFotos`.
   */
  const agregarPlaceholders = useCallback((placeholders: FotoProcesando[]) => {
    setFotos((prev) => [...prev, ...placeholders].slice(0, MAX_FOTOS));
  }, []);

  /**
   * Reemplaza EN SU LUGAR el placeholder cuya `uri` cruda coincide con la del
   * asset ya normalizado — no reordena ni reinicia el array, así que las fotos
   * ya resueltas no parpadean. `uri` alcanza como llave: mientras hay un lote
   * en curso no puede empezar otro (`PhotoRow` esconde `.photo-add`), así que
   * no hay dos placeholders compitiendo por la misma uri cruda.
   */
  const reemplazarPlaceholder = useCallback((uri: string, foto: FotoElegida) => {
    setFotos((prev) =>
      prev.map((f) => (f.origen === 'procesando' && f.uri === uri ? foto : f))
    );
  }, []);

  /**
   * `texto` es el valor CRUDO que llega de `onChangeText` (lo que el usuario
   * tecleó o pegó, sobre el texto ya formateado del render anterior). La
   * lógica en sí vive en `siguientePrecio` (arriba, pura); esto solo la
   * conecta al estado. Va con el `setPrecioNum` FUNCIONAL (no
   * `setPrecioNum(siguientePrecio(precioNum, texto))`) porque
   * `siguientePrecio` necesita el valor ANTERIOR real, no uno capturado por
   * closure en el render en que se creó este callback — con `useCallback([])`
   * ese valor quedaría congelado en `NaN` para siempre.
   */
  const setPrecio = useCallback((texto: string) => {
    setPrecioNum((anterior) => siguientePrecio(anterior, texto));
  }, []);

  /** El texto que ve el `Field`, derivado del número en cada render — nunca
   * guardado aparte, para que el `$0`/`$1,250` en pantalla nunca pueda
   * desincronizarse de `precioNum`. */
  const precioTexto = Number.isFinite(precioNum) ? formatPrecioInput(precioNum) : '';

  /**
   * El mismo booleano derivado de "Completar perfil". `fotos.length > 0` es
   * decisión de producto, no del esquema: `listings` no exige ninguna foto,
   * pero una tarjeta sin imagen en el feed se lee como rota.
   *
   * `!fotos.some(origen === 'procesando')`: sin esto, tocar "Publicar
   * artículo"/"Guardar" mientras una foto sigue procesando le pasaría una
   * `FotoProcesando` (sin `path`) a `subirPendientes()`, que solo sabe tratar
   * `'storage'`/`'local'`.
   *
   * `precioNum <= PRECIO_MAX` es redundante con el bloqueo de `setPrecio`
   * (que nunca deja llegar un número mayor) — mismo criterio defensivo que ya
   * usa el `>= 0` de abajo, que tampoco puede violarse por construcción.
   */
  const puedeGuardar =
    titulo.trim().length > 0 &&
    Number.isFinite(precioNum) &&
    precioNum >= 0 &&
    precioNum <= PRECIO_MAX &&
    categoriaId !== undefined &&
    condicion !== undefined &&
    fotos.length > 0 &&
    !fotos.some((f) => f.origen === 'procesando');

  /**
   * Los campos listos para la base. La ubicación (universidad/campus) no es del
   * formulario ni viaja aquí: la fija el alta desde el perfil
   * (`UbicacionListing`, `src/lib/listings.ts`) y editar no la toca.
   */
  const aInput = useCallback(
    (): ListingInput => ({
      titulo: titulo.trim(),
      // `null` y no `''`: la columna es nullable y `busqueda` ya hace
      // `coalesce(descripcion, '')`. Guardar la cadena vacía sería un valor
      // distinto para decir lo mismo.
      descripcion: descripcion.trim() || null,
      precio: precioNum,
      categoriaId: categoriaId!,
      condicion: condicion!,
    }),
    [titulo, descripcion, precioNum, categoriaId, condicion]
  );

  /** Identidad del set de fotos, para saber si hay que reescribir `listing_photos`. */
  const firmaFotos = useMemo(() => fotos.map(idFoto).join('|'), [fotos]);

  return {
    titulo,
    setTitulo,
    precio: precioTexto,
    setPrecio,
    descripcion,
    setDescripcion,
    categoriaId,
    setCategoriaId,
    condicion,
    setCondicion,
    fotos,
    setFotos,
    agregarFotos,
    agregarPlaceholders,
    reemplazarPlaceholder,
    quitarFoto,
    puedeGuardar,
    aInput,
    firmaFotos,
  };
}

export type ListingForm = ReturnType<typeof useListingForm>;
