/**
 * Aceptación de los Términos de uso y presentación del Aviso de privacidad
 * (PL-016, migración 20261026000490).
 *
 * El candado NO vive aquí: las acciones que exigen aceptación (publicar,
 * contactar, calificar, fotos, foto de perfil, teléfono, carrera…) las rechaza
 * la base, con policies y triggers (§0 regla 7). Este módulo solo lee el estado
 * para decidir qué pantalla pintar, y llama a la RPC que registra la
 * aceptación.
 */

import * as WebBrowser from 'expo-web-browser';

import { supabase } from '@/lib/supabase';

export type DocumentoVigente = {
  version: string;
  /** Desde cuándo rige (ISO). La pantalla dice "versión del …". */
  vigenteDesde: string;
  /** La URL FIJA de esa versión exacta (Q4), no "la más reciente". */
  url: string;
  /** La sesión aceptó (o vio, en el Aviso) ESTA versión. */
  aceptado: boolean;
  /** La sesión aceptó ALGUNA versión de este tipo. */
  aceptoAlguna: boolean;
};

export type EstadoTerminos = {
  terminos: DocumentoVigente;
  aviso: DocumentoVigente;
};

/**
 * La versión vigente de los dos documentos y si la sesión ya los aceptó.
 *
 * Devuelve `null` si falta la versión vigente de alguno de los dos (Q3: el
 * catálogo vacío falla cerrado, nadie puede aceptar todavía). Lanza si la
 * consulta falla: quien la llama decide si eso es "no sé" o un error visible.
 */
export async function fetchEstadoTerminos(): Promise<EstadoTerminos | null> {
  const { data, error } = await supabase.rpc('estado_terminos');
  if (error) throw error;

  const porTipo = new Map((data ?? []).map((d) => [d.tipo, d]));
  const t = porTipo.get('terminos');
  const a = porTipo.get('aviso_privacidad');
  if (!t || !a) return null;

  const aDocumento = (d: NonNullable<typeof t>): DocumentoVigente => ({
    version: d.version,
    vigenteDesde: d.vigente_desde,
    url: d.url,
    aceptado: d.aceptado,
    aceptoAlguna: d.acepto_alguna,
  });
  return { terminos: aDocumento(t), aviso: aDocumento(a) };
}

/** La sesión aceptó la versión vigente de los Términos. */
export function terminosAceptados(estado: EstadoTerminos): boolean {
  return estado.terminos.aceptado;
}

/**
 * Cuenta sin ninguna aceptación registrada (anterior a PL-016): ve la variante
 * "Acepta los términos de RLVO" en vez de "Actualizamos nuestros términos".
 */
export function esCuentaPrevia(estado: EstadoTerminos): boolean {
  return !estado.terminos.aceptoAlguna;
}

/**
 * Registra la aceptación de las versiones que se le MOSTRARON al usuario. La
 * hora y quién acepta los pone el servidor. Idempotente: reintentar tras un
 * fallo de red no cambia nada. Si la versión dejó de ser la vigente mientras
 * la pantalla estaba abierta, lanza `version_no_vigente` (`esVersionNoVigente`).
 */
export async function aceptarTerminos(estado: EstadoTerminos): Promise<void> {
  const { error } = await supabase.rpc('aceptar_terminos', {
    p_version_terminos: estado.terminos.version,
    p_version_aviso: estado.aviso.version,
  });
  if (error) throw error;
}

type ErrorPostgrest = { code?: string; message?: string } | null | undefined;

/**
 * El rechazo de los triggers de PL-016 (`listings_exige_terminos`,
 * `users_exige_terminos`): `42501` con mensaje `terminos_no_aceptados`.
 *
 * El de una POLICY (publicar, contactar, calificar, fotos) llega como el
 * `42501` genérico de RLS, que no se distingue de otros rechazos: por eso la
 * app pregunta antes (`useExigirTerminos`) en vez de depender de esto.
 */
export function esTerminosNoAceptados(e: unknown): boolean {
  const err = e as ErrorPostgrest;
  return err?.code === '42501' && err?.message === 'terminos_no_aceptados';
}

export function esVersionNoVigente(e: unknown): boolean {
  const err = e as ErrorPostgrest;
  return err?.code === '22023' && err?.message === 'version_no_vigente';
}

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/**
 * "26 de octubre de 2026", en hora de México (UTC−6: sin horario de verano
 * desde 2022). Se arma a mano y no con `Intl` + `timeZone`, para no depender
 * de qué tanto de `Intl` trae Hermes (mismo criterio que `src/lib/paises.ts`).
 */
export function fechaVersion(iso: string): string {
  const d = new Date(Date.parse(iso) - 6 * 60 * 60 * 1000);
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

/**
 * Abre un documento legal en el navegador DENTRO de la app, igual que
 * Configuración (`abrirDocumentoLegal` de `configuracion.tsx`). Devuelve false
 * si no se pudo abrir (URL inválida), para que la pantalla avise con un toast.
 */
export async function abrirDocumentoLegal(url: string): Promise<boolean> {
  try {
    await WebBrowser.openBrowserAsync(url);
    return true;
  } catch {
    return false;
  }
}
