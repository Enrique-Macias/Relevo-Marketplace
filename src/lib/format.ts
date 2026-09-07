/** Formato de precio y fecha relativa para tarjetas/detalle de publicaciones. */

export function formatPrecio(n: number): string {
  const tieneCentavos = !Number.isInteger(n);
  const partes = n.toFixed(tieneCentavos ? 2 : 0).split('.');
  partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${partes.join('.')}`;
}

export function formatRelativo(fecha: Date): string {
  const diffMs = Date.now() - fecha.getTime();
  const horas = Math.floor(diffMs / (1000 * 60 * 60));
  if (horas < 1) return 'hace un momento';
  if (horas < 24) return `hace ${horas}h`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias}d`;
}
