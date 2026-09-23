/** Formato de precio, fecha relativa e iniciales para tarjetas/detalle de publicaciones. */

/**
 * `listings.precio` es siempre un entero (0-100000, `check` de
 * `20260922000464`) — sin esa garantía esta función mentiría sobre
 * cualquier decimal. "Gratis" es solo de LECTURA: el campo del formulario de
 * Publicar/Editar usa `formatPrecioInput` (`listing-form.ts`), que nunca
 * pinta "Gratis" mientras se edita.
 */
export function formatPrecio(n: number): string {
  if (n === 0) return 'Gratis';
  const conComas = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${conComas}`;
}

/**
 * La hora relativa de `.card .meta`, `.spec-val` y `.notif-time`.
 *
 * LA RAMA DE MINUTOS SE AGREGÓ CON EL INBOX (RF-16) Y CORRIGE A LOS TRES
 * CONSUMIDORES VIEJOS, no solo sirve al nuevo. Antes, todo lo de menos de una
 * hora decía "hace un momento" — una cadena que NO APARECE NI UNA VEZ en
 * `design/relevo-app.html`, o sea que era una invención del código. El diseño
 * usa minutos explícitos ("hace 12m", en la fila de notificación), así que esto
 * acerca `ProductCard`, Detalle y "Mis publicaciones" a su frame en vez de
 * alejarlos.
 *
 * El piso sigue siendo un texto y no "hace 0m": una publicación recién creada se
 * ve en el Feed en el mismo segundo.
 */
export function formatRelativo(fecha: Date): string {
  const diffMs = Date.now() - fecha.getTime();
  const minutos = Math.floor(diffMs / (1000 * 60));
  if (minutos < 1) return 'hace un momento';
  if (minutos < 60) return `hace ${minutos}m`;
  const horas = Math.floor(minutos / 60);
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
/**
 * "8m" del `.stat-card` "En Relevo" de "Perfil público" — meses completos
 * desde `users.created_at`.
 *
 * SIN RAMA DE AÑOS a propósito: el frame solo ilustra un ejemplo de meses, y no
 * hay ningún estado en `relevo-app.html` con una cuenta de más de un año que
 * diga cómo debe verse ese caso (CLAUDE.md §0 regla 4) — así que no se inventa
 * un formato "1a"/"2a" sin evidencia. El mes se aproxima a 30.44 días
 * (365.25 / 12): no importa que no sea un mes calendario exacto, es un stat de
 * antigüedad, no una fecha.
 */
export function mesesEnRelevo(createdAt: Date): string {
  const diffMs = Date.now() - createdAt.getTime();
  const meses = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44));
  return `${meses}m`;
}

export function iniciales(nombre: string | null | undefined): string {
  const palabras = (nombre ?? '').trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return '?';
  return palabras
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}
