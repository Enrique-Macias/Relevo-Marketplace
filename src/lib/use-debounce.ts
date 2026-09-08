/**
 * Valor que solo se propaga cuando el usuario deja de escribir.
 *
 * Con datos mock el filtrado era síncrono sobre un arreglo, así que cada tecla
 * era gratis. Ahora cada cambio de query es un round-trip a PostgREST: sin esto,
 * escribir "calculo" dispara 7 peticiones y pinta la de "calcul" si llega tarde.
 */

import { useEffect, useState } from 'react';

export function useDebounce<T>(valor: T, ms = 300): T {
  const [diferido, setDiferido] = useState(valor);

  useEffect(() => {
    const t = setTimeout(() => setDiferido(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);

  return diferido;
}
