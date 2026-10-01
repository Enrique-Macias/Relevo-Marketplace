// TOTP (RFC 6238) para los probes: lo mismo que hace una app autenticadora.
//
// Módulo PURO, sin efectos al importarse: `probe-admin.mjs` y
// `probe-storage.mjs` lo comparten. Estaba dentro de `probe-admin.mjs`, que es
// un script con `main()`, así que importarlo desde otro probe lo ejecutaría.
// Solo depende de `node:crypto`.

import { createHmac } from 'node:crypto';

export function base32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += A.indexOf(ch).toString(2).padStart(5, '0');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

export function totp(secret) {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac('sha1', base32(secret)).update(c).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

/** Espera a la siguiente ventana de 30 s: GoTrue no re-verifica el mismo código. */
export const siguienteVentana = () =>
  new Promise((r) => setTimeout(r, 30000 - (Date.now() % 30000) + 1500));
