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
  precio: string;
  descripcion: string;
  categoriaId: number | undefined;
  condicion: Condicion | undefined;
  fotos: FotoEnEdicion[];
};

export const FORMULARIO_VACIO: ValoresIniciales = {
  titulo: '',
  precio: '',
  descripcion: '',
  categoriaId: undefined,
  condicion: undefined,
  fotos: [],
};

/**
 * `precio` se guarda como TEXTO y se parsea al validar, no se fuerza a número
 * en cada tecla: un `TextInput` numérico controlado por un `number` pelea con
 * el usuario a media escritura (borrar el último dígito de "5" no puede dar
 * `NaN` ni volver a "0"). La columna es `numeric(10,2) check (precio >= 0)`,
 * así que lo que importa es que el valor que se manda sea finito y no negativo.
 */
function parsePrecio(texto: string): number {
  // Se quita todo lo que no sea dígito o punto: el teclado decimal de Android
  // ofrece coma en varios locales, y el frame escribe el precio como "$ 280".
  const limpio = texto.replace(',', '.').replace(/[^0-9.]/g, '');
  if (limpio === '' || limpio === '.') return NaN;
  return Number(limpio);
}

export function useListingForm(iniciales: ValoresIniciales = FORMULARIO_VACIO) {
  const [titulo, setTitulo] = useState(iniciales.titulo);
  const [precio, setPrecio] = useState(iniciales.precio);
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

  const precioNum = parsePrecio(precio);

  /**
   * El mismo booleano derivado de "Completar perfil". `fotos.length > 0` es
   * decisión de producto, no del esquema: `listings` no exige ninguna foto,
   * pero una tarjeta sin imagen en el feed se lee como rota.
   *
   * `!fotos.some(origen === 'procesando')`: sin esto, tocar "Publicar
   * artículo"/"Guardar" mientras una foto sigue procesando le pasaría una
   * `FotoProcesando` (sin `path`) a `subirPendientes()`, que solo sabe tratar
   * `'storage'`/`'local'`.
   */
  const puedeGuardar =
    titulo.trim().length > 0 &&
    Number.isFinite(precioNum) &&
    precioNum >= 0 &&
    categoriaId !== undefined &&
    condicion !== undefined &&
    fotos.length > 0 &&
    !fotos.some((f) => f.origen === 'procesando');

  /**
   * Los campos listos para la base. `universidadId`/`campusId` no son del
   * formulario: salen del perfil (la zona de entrega es un campo deshabilitado),
   * por eso entran por parámetro.
   */
  const aInput = useCallback(
    (universidadId: number, campusId: number): ListingInput => ({
      titulo: titulo.trim(),
      // `null` y no `''`: la columna es nullable y `busqueda` ya hace
      // `coalesce(descripcion, '')`. Guardar la cadena vacía sería un valor
      // distinto para decir lo mismo.
      descripcion: descripcion.trim() || null,
      precio: precioNum,
      categoriaId: categoriaId!,
      condicion: condicion!,
      universidadId,
      campusId,
    }),
    [titulo, descripcion, precioNum, categoriaId, condicion]
  );

  /** Identidad del set de fotos, para saber si hay que reescribir `listing_photos`. */
  const firmaFotos = useMemo(() => fotos.map(idFoto).join('|'), [fotos]);

  return {
    titulo,
    setTitulo,
    precio,
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
