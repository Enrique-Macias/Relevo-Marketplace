// Aceptación de los términos para las cuentas de prueba de los `probe-*.mjs`
// (PL-016, migración 20261026000490).
//
// Desde esa migración, una cuenta que no aceptó la versión vigente de los
// Términos y del Aviso no puede publicar, subir fotos, contactar, reseñar ni
// registrar una venta. Los probes crean sus cuentas por el admin API, así que
// nacen sin aceptar: este módulo registra la aceptación con la secret key,
// igual que hace la suite de RLS con su fixture.
//
// Si el stack no tiene versión vigente (un `db reset` limpio), inserta las de
// PRUEBA de `supabase/seeds-local/terminos.sql`, con los mismos valores, así
// que correr también ese seed no choca.
//
// Se niega a correr fuera de localhost: nunca debe registrar una aceptación en
// STAGING ni en PROD a nombre de una cuenta.
//
// Sin dependencias: `fetch` y la secret key, sin supabase-js.
import { createHash } from 'node:crypto';

const VERSION_PRUEBA = 'local-prueba';
const VIGENTE_DESDE = '2026-01-01T00:00:00Z';
// sha256('local-prueba'), el mismo que calcula el seed en SQL (bytea en hex).
const SHA256_PRUEBA = '\\x' + createHash('sha256').update(VERSION_PRUEBA).digest('hex');

function exigirLocal(apiUrl) {
  const host = new URL(apiUrl).hostname;
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new Error(`_terminos-prueba: se niega a correr contra ${host} (solo el stack local)`);
  }
}

function cabeceras(secret, extra = {}) {
  return { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...extra };
}

// Las versiones vigentes ({ terminos, aviso_privacidad }), con la MISMA regla
// que `private.version_vigente()`: la más reciente con vigente_desde <= now().
async function vigentes(apiUrl, secret) {
  const ahora = new Date().toISOString();
  const res = await fetch(
    `${apiUrl}/rest/v1/documentos_legales?select=tipo,version,vigente_desde`
      + `&vigente_desde=lte.${encodeURIComponent(ahora)}&order=vigente_desde.desc`,
    { headers: cabeceras(secret) });
  if (!res.ok) throw new Error(`_terminos-prueba: leer documentos_legales: ${res.status} ${await res.text()}`);
  const v = {};
  for (const d of await res.json()) v[d.tipo] ??= d.version;
  return v;
}

export async function asegurarVersionesDePrueba(apiUrl, secret) {
  exigirLocal(apiUrl);
  const v = await vigentes(apiUrl, secret);
  if (v.terminos && v.aviso_privacidad) return v;
  const res = await fetch(`${apiUrl}/rest/v1/documentos_legales?on_conflict=tipo,version`, {
    method: 'POST',
    headers: cabeceras(secret, { Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify([
      { tipo: 'terminos', version: VERSION_PRUEBA, vigente_desde: VIGENTE_DESDE,
        url: 'https://www.rlvo.com.mx/terminos', contenido_sha256: SHA256_PRUEBA },
      { tipo: 'aviso_privacidad', version: VERSION_PRUEBA, vigente_desde: VIGENTE_DESDE,
        url: 'https://www.rlvo.com.mx/privacidad', contenido_sha256: SHA256_PRUEBA },
    ]),
  });
  if (!res.ok) throw new Error(`_terminos-prueba: sembrar versiones: ${res.status} ${await res.text()}`);
  return vigentes(apiUrl, secret);
}

// Registra que `userId` aceptó los Términos y vio el Aviso vigentes.
// Idempotente.
export async function aceptarTerminosDePrueba(apiUrl, secret, userId) {
  const v = await asegurarVersionesDePrueba(apiUrl, secret);
  const res = await fetch(`${apiUrl}/rest/v1/aceptaciones_legales?on_conflict=user_id,tipo,version`, {
    method: 'POST',
    headers: cabeceras(secret, { Prefer: 'resolution=ignore-duplicates,return=minimal' }),
    body: JSON.stringify([
      { user_id: userId, tipo: 'terminos', version: v.terminos, accion: 'aceptado' },
      { user_id: userId, tipo: 'aviso_privacidad', version: v.aviso_privacidad, accion: 'presentado' },
    ]),
  });
  if (!res.ok) throw new Error(`_terminos-prueba: aceptar ${userId}: ${res.status} ${await res.text()}`);
}
