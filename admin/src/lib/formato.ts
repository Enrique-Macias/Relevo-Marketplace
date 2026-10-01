/**
 * Etiquetas y fechas del panel, con el copy de `design/admin-panel.html`.
 * Los motivos de reporte son los MISMOS textos que ve el estudiante al
 * reportar (`src/app/reportar/[id].tsx`, MOTIVOS), para que el admin lea lo
 * mismo que eligió quien reportó.
 */

export type EstadoReporte = 'pendiente' | 'resuelto' | 'descartado';
export type EstadoListing = 'activa' | 'pausada' | 'vendida' | 'pendiente' | 'bloqueada';
export type EstadoUsuario = 'activo' | 'suspendido';
export type ObjetivoTipo = 'publicacion' | 'usuario' | 'publicacion_eliminada' | 'cuenta_eliminada';

export const MOTIVO_REPORTE: Record<string, string> = {
  spam_publicidad: 'Es spam o publicidad',
  sospecha_fraude: 'Sospecho que es fraude',
  contenido_inapropiado: 'Contenido inapropiado',
  no_es_estudiante: 'No es un estudiante',
  otro: 'Otro motivo',
};

/** Clase de `.estado` y texto, por el criterio de los frames (ok / atención / apagado). */
export const CHIP_REPORTE: Record<EstadoReporte, [string, string]> = {
  pendiente: ['atencion', 'Pendiente'],
  resuelto: ['ok', 'Resuelto'],
  descartado: ['apagado', 'Descartado'],
};

export const CHIP_LISTING: Record<EstadoListing, [string, string]> = {
  activa: ['ok', 'Activa'],
  pausada: ['apagado', 'Pausada'],
  vendida: ['apagado', 'Vendida'],
  pendiente: ['atencion', 'Pendiente'],
  bloqueada: ['fuerte', 'Bloqueada'],
};

export const CHIP_USUARIO: Record<EstadoUsuario, [string, string]> = {
  activo: ['ok', 'Activa'],
  suspendido: ['atencion', 'Suspendida'],
};

export const CONDICION: Record<string, string> = {
  nuevo: 'Nuevo', como_nuevo: 'Como nuevo', buen_estado: 'Buen estado', usado: 'Usado',
};

export const ACCION: Record<string, string> = {
  suspender_usuario: 'Suspender cuenta',
  reactivar_usuario: 'Reactivar cuenta',
  activar_admin: 'Activar admin',
  resolver_reporte: 'Resolver reporte',
  bloquear_listing: 'Bloquear publicación',
};

const ESTADO_LEGIBLE: Record<string, string> = {
  activo: 'Activa', suspendido: 'Suspendida',
  activa: 'Activa', pausada: 'Pausada', vendida: 'Vendida', pendiente: 'Pendiente', bloqueada: 'Bloqueada',
  resuelto: 'Resuelto', descartado: 'Descartado',
};

/** "Activa → Suspendida · 3 pausadas", como la columna "Cambio" del frame. */
export function cambioAuditado(antes: Record<string, unknown> | null, despues: Record<string, unknown> | null): string {
  const de = antes?.estado ? ESTADO_LEGIBLE[String(antes.estado)] ?? String(antes.estado) : null;
  const a = despues?.estado ? ESTADO_LEGIBLE[String(despues.estado)] ?? String(despues.estado) : null;
  const partes = [de && a ? `${de} → ${a}` : a ?? de ?? '—'];
  if (typeof despues?.publicaciones_pausadas === 'number') {
    const n = despues.publicaciones_pausadas;
    partes.push(`${n} ${n === 1 ? 'pausada' : 'pausadas'}`);
  }
  return partes.join(' · ');
}

/** La fila del script de alta no es un admin (admin/CLAUDE.md, "Auditoría"). */
export const autorAuditado = (correo: string) => (correo === 'script:crear-admin.mjs' ? 'script' : correo);

const corta = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const larga = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dia = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

export const fechaCorta = (s: string | null) => (s ? corta.format(new Date(s)) : '—');
export const fechaLarga = (s: string | null) => (s ? larga.format(new Date(s)) : '—');
export const fechaDia = (s: string | null) => (s ? dia.format(new Date(s)) : '—');

const pesos = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
export const precio = (n: number) => `$${pesos.format(n)}`;

export const MOTIVO_MIN = 3;
export const MOTIVO_MAX = 500;
export const motivoValido = (m: string) => {
  const l = m.trim().length;
  return l >= MOTIVO_MIN && l <= MOTIVO_MAX;
};
