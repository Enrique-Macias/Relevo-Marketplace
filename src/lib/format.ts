/** Formato de precio, fecha relativa e iniciales para tarjetas/detalle de publicaciones. */

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

/**
 * Iniciales para los avatares (`.avatar`, `.seller-avatar`, `.profile-avatar`).
 *
 * En los mocks venían precomputadas ("JM"); con datos reales solo hay
 * `users.nombre`, que además es nullable hasta que el usuario pasa por
 * "Completar perfil". Toma la primera letra de las dos primeras palabras —
 * "Jorge Muñoz" → "JM", "Ana" → "A" — y cae a "?" si no hay nombre, que es lo
 * que puede pasar con un perfil a medias visto desde otra pantalla.
 */
export function iniciales(nombre: string | null | undefined): string {
  const palabras = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return '?';
  return palabras
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}
