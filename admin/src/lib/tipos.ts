import type { EstadoListing, EstadoReporte, EstadoUsuario, ObjetivoTipo } from './formato.ts';

/**
 * Las filas y objetos que devuelven las RPCs de `admin.*`, con los NULL que de
 * verdad pueden venir. Los tipos generados (`db/admin.types.ts`) declaran no
 * nulas todas las columnas de una función `returns table` y `Json` para las que
 * devuelven jsonb; aquí se dice lo que la base garantiza.
 */

export interface Reporte {
  id: number;
  motivo: string;
  comentario: string | null;
  estado: EstadoReporte;
  created_at: string;
  resolved_at: string | null;
  reporter_id: string | null;
  reporter_nombre: string | null;
  objetivo_tipo: ObjetivoTipo;
  listing_id: number | null;
  listing_titulo: string | null;
  listing_estado: EstadoListing | null;
  reported_user_id: string | null;
  reported_user_nombre: string | null;
  reported_user_correo: string | null;
  reported_user_estado: EstadoUsuario | null;
  reportes_mismo_objetivo: number | null;
}

export interface Auditoria {
  id: number; accion: string; admin_correo: string; motivo: string;
  antes: Record<string, unknown> | null; despues: Record<string, unknown> | null; created_at: string;
}

export interface DetalleListing {
  id: number;
  titulo: string;
  descripcion: string | null;
  precio: number;
  condicion: string;
  estado: EstadoListing;
  categoria: string | null;
  universidad: string | null;
  campus: string | null;
  vistas_count: number;
  created_at: string;
  updated_at: string;
  dueno: { id: string; nombre: string | null; estado: EstadoUsuario; es_admin: boolean; reportes_en_contra: number };
  fotos: string[];
  moderacion: { id: number; created_at: string; veredicto: 'limpio' | 'revisar' | 'bloquear';
                estado_resultante: EstadoListing; detalle: Record<string, unknown> | null }[];
  reportes: { id: number; motivo: string; estado: EstadoReporte; created_at: string;
              resolved_at: string | null; reporter_nombre: string | null; reporter_eliminado: boolean }[];
  auditoria: Auditoria[];
}

export interface DetalleUsuario {
  id: string; nombre: string | null; correo: string | null; universidad: string | null;
  campus: string | null; estado: EstadoUsuario; suspendido_at: string | null;
  suspension_motivo: string | null; created_at: string; es_admin: boolean;
  publicaciones_activas: number; publicaciones_pendientes: number; activas_sin_foto: number;
  reportes_en_contra: number; auditoria: Auditoria[];
  /** Bloqueadas que siguen existiendo + las eliminadas que se retienen 12 meses (`…482`). */
  bloqueadas: number;
  /** Solo de una cuenta de admin (null si no lo es), `…483`: `activado_at` puesto. */
  admin_activado: boolean | null;
  /** Solo de una cuenta de admin: tiene un TOTP `verified` (un unverified no cuenta). */
  app_registrada: boolean | null;
  /** Solo de una cuenta de admin: el id del restablecimiento sin cerrar, o null. */
  restablecimiento_pendiente: number | null;
}

/** Una fila de `admin.cola_moderacion` (`…481`). Las de "Sin evaluar" no traen veredicto. */
export interface FilaCola {
  id: number; titulo: string; precio: number; categoria: string | null; created_at: string;
  dueno_id: string; dueno_nombre: string | null; dueno_estado: EstadoUsuario; fotos: string[];
  evaluaciones: number; ultimo_veredicto: 'limpio' | 'revisar' | 'bloquear' | null;
  ultimo_detalle: Record<string, unknown> | null; ultima_evaluacion_at: string | null;
}

/** `admin.catalogo()` (`20261008000484`): universidades con sus campus y dominios. Sin admins ni correos. */
export interface CampusCatalogo {
  id: number; nombre: string; ciudad: string; latitud: number | null; longitud: number | null;
  usuarios: number; publicaciones: number;
}
export interface DominioCatalogo { dominio: string; activo: boolean; created_at: string }
export interface UniversidadCatalogo {
  id: number; nombre: string; usuarios: number; campus: CampusCatalogo[]; dominios: DominioCatalogo[];
}

/** Adónde puede ir el panel. Sin router: un estado en el Panel. */
export type Vista =
  | { tipo: 'reportes' }
  | { tipo: 'reporte'; id: number }
  | { tipo: 'moderacion' }
  | { tipo: 'listing'; id: number; desde?: number | 'moderacion' }
  | { tipo: 'usuarios' }
  | { tipo: 'usuario'; id: string; desde?: number }
  | { tipo: 'catalogo' }
  | { tipo: 'universidad'; id: number };
