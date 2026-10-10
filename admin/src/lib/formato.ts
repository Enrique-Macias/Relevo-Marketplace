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
  aprobar_listing: 'Aprobar publicación',
  desactivar_admin: 'Desactivar admin',
  restablecer_mfa: 'Restablecer app autenticadora',
  factores_mfa_borrados: 'App autenticadora eliminada',
  // Ola 5 (catálogo). Desde la Ola 6 se ven en la auditoría del detalle de
  // una universidad (`componentes/Auditoria.tsx`).
  crear_universidad: 'Agregar universidad',
  editar_universidad: 'Editar universidad',
  crear_campus: 'Agregar campus',
  editar_campus: 'Editar campus',
  agregar_dominio: 'Agregar dominio',
  desactivar_dominio: 'Desactivar dominio',
  reactivar_dominio: 'Reactivar dominio',
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

/**
 * "Cambio" de una fila del catálogo (Ola 6, auditoría de una universidad), como
 * el frame "Universidad — detalle": un alta se lee «Alta» y un dominio
 * desactivado o reactivado, «Activo → Desactivado» (o al revés). El frame no
 * tiene ejemplo de una edición de nombre o de campus, así que esas filas caen
 * en `cambioAuditado()` («—»). Aparte de `cambioAuditado()` a propósito: así
 * las auditorías de usuario y de publicación no cambian.
 */
const ALTAS_CATALOGO = new Set(['crear_universidad', 'crear_campus', 'agregar_dominio']);
export function cambioCatalogo(accion: string, antes: Record<string, unknown> | null, despues: Record<string, unknown> | null): string {
  if (ALTAS_CATALOGO.has(accion)) return 'Alta';
  if (typeof antes?.activo === 'boolean' && typeof despues?.activo === 'boolean') {
    const t = (v: boolean) => (v ? 'Activo' : 'Desactivado');
    return `${t(antes.activo)} → ${t(despues.activo)}`;
  }
  return cambioAuditado(antes, despues);
}

/** La fila del script de alta no es un admin (admin/CLAUDE.md, "Auditoría"). */
export const autorAuditado = (correo: string) => (correo === 'script:crear-admin.mjs' ? 'script' : correo);

const corta = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const larga = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dia = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

export const fechaCorta = (s: string | null) => (s ? corta.format(new Date(s)) : '—');
export const fechaLarga = (s: string | null) => (s ? larga.format(new Date(s)) : '—');
export const fechaDia = (s: string | null) => (s ? dia.format(new Date(s)) : '—');

/*
 * Fechas de DÍA de las métricas (Ola 6): la base devuelve `date` como
 * "AAAA-MM-DD", ya en hora de México. Se formatean en UTC para que el
 * navegador no las mueva de día: `new Date('2026-10-09')` es medianoche UTC, y
 * en México eso todavía es el 8.
 */
const ZONA_MX = 'America/Mexico_City';
const diaUtc = (d: string) => new Date(`${d}T00:00:00Z`);
const fDiaMes = new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const fDiaMesAnio = new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const fSemana = new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', weekday: 'short' });
const fHoyMx = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_MX, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Hoy en México, "AAAA-MM-DD": el último día que admite `admin.metricas`. */
export const hoyMexico = (ahora: Date = new Date()) => fHoyMx.format(ahora);
/** "AAAA-MM-DD" menos `n` días. */
export const restarDias = (d: string, n: number) => new Date(diaUtc(d).getTime() - n * 86_400_000).toISOString().slice(0, 10);
/** «6 oct 2026». */
export const fechaSql = (d: string) => fDiaMesAnio.format(diaUtc(d));
/** «Mar 15 dic», la primera columna de la tabla diaria. */
export const diaTabla = (d: string) => {
  const s = fSemana.format(diaUtc(d));
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} ${fDiaMes.format(diaUtc(d))}`;
};
/** «10 sep – 9 oct 2026» (el año del inicio solo si es otro). */
export const rangoSql = (desde: string, hasta: string) =>
  `${desde.slice(0, 4) === hasta.slice(0, 4) ? fDiaMes.format(diaUtc(desde)) : fechaSql(desde)} – ${fechaSql(hasta)}`;
/** «del 6 al 9 oct» o «del 30 sep al 2 oct», como la tarjeta de activos. */
export const delAlSql = (desde: string, hasta: string) => {
  const mismoMes = desde.slice(0, 7) === hasta.slice(0, 7);
  return `del ${mismoMes ? Number(desde.slice(8, 10)) : fDiaMes.format(diaUtc(desde))} al ${fDiaMes.format(diaUtc(hasta))}`;
};

const pesos = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
export const precio = (n: number) => `$${pesos.format(n)}`;

export const MOTIVO_MIN = 3;
export const MOTIVO_MAX = 500;
export const motivoValido = (m: string) => {
  const l = m.trim().length;
  return l >= MOTIVO_MIN && l <= MOTIVO_MAX;
};
