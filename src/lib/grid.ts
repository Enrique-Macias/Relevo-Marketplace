/**
 * Agrupa un arreglo en filas de tamaño fijo para grids de N columnas.
 *
 * RN no tiene el equivalente de `calc()`: combinar `gap` con anchos en
 * porcentaje en un contenedor `flexWrap` no reparte el espacio exacto del
 * CSS grid del prototipo. Construir filas explícitas de `flexDirection:'row'`
 * con `gap` entre columnas (y entre filas en el contenedor padre) sí lo
 * reproduce exacto, sin importar el ancho de pantalla.
 */
export function chunkRows<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return rows;
}
