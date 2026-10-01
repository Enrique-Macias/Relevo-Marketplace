import { supabase } from './supabase.ts';
import { pedirTotp } from './puerta-totp.ts';

/**
 * Qué hacer cuando una foto del bucket privado no se pudo descargar (D-A2).
 *
 * Storage NO dice por qué rechaza: medido en `scripts/probe-storage.mjs`, un
 * admin aal1, un admin con el TOTP vencido y un no-admin reciben el MISMO
 * `HTTP 400 {"statusCode":"404","error":"not_found","code":"NoSuchKey"}`, y
 * un objeto borrado tampoco se distingue. Así que el panel le pregunta a
 * `admin.sesion()` y decide con eso, no con el status.
 *
 * Una publicación tiene varias fotos y TODAS fallan a la vez cuando vence el
 * TOTP: este diagnóstico se comparte (una promesa en vuelo), así que N fotos
 * hacen UNA llamada a `admin.sesion()` y abren, como mucho, UN modal (que
 * además pasa por la puerta única de `puerta-totp.ts`).
 *
 *   'reintentar'     → la sesión se renovó (o ya estaba bien): reintentar UNA vez.
 *   'no_disponible'  → la sesión está bien y aun así falló, o se canceló el modal.
 *   'cerrar_sesion'  → la cuenta ya no es admin.
 */
export type Diagnostico = 'reintentar' | 'no_disponible' | 'cerrar_sesion';

interface Sesion { es_admin: boolean; admin_activado: boolean; aal: string | null; totp_reciente: boolean }

let enVuelo: Promise<Diagnostico> | null = null;

async function diagnosticar(): Promise<Diagnostico> {
  const { data, error } = await supabase.rpc('sesion');
  if (error || !data) return 'no_disponible';
  const s = data as unknown as Sesion;
  if (!s.admin_activado) {
    await supabase.auth.signOut();
    return 'cerrar_sesion';
  }
  if (s.aal !== 'aal2' || !s.totp_reciente) {
    return (await pedirTotp(s.aal !== 'aal2' ? 'mfa_requerido' : 'totp_vencido')) ? 'reintentar' : 'no_disponible';
  }
  // Sesión de admin válida y aun así no se pudo: la foto no existe (o la
  // policy no la deja ver). Reintentar no cambiaría nada.
  return 'no_disponible';
}

export function diagnosticarFalloDeFoto(): Promise<Diagnostico> {
  if (enVuelo) return enVuelo;
  enVuelo = diagnosticar()
    .catch((): Diagnostico => 'no_disponible')
    .finally(() => { enVuelo = null; });
  return enVuelo;
}

/** El bucket privado se lee con el token de la sesión: `download()` → `/object/{bucket}/…`. */
export const BUCKET_FOTOS = 'listing-photos';
