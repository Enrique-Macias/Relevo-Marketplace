// ===========================================================================
// Relevo — la Edge Function `admin-reset-mfa` por HTTP (RF-17 Ola 3b).
//
// Cómo correrlo (local, DOS procesos):
//     supabase start
//     supabase functions serve --env-file supabase/functions/.env   # otra terminal
//     node scripts/probe-admin-reset-mfa.mjs
//
// Lo que `supabase/tests/rls.sql` (T35f) no puede ver, porque allá los factores
// se siembran por SQL y los claims se fabrican: GoTrue de verdad (TOTP reales,
// `deleteFactor` real), la función de verdad y `crear-admin.mjs activar`
// importado REAL. Sin código de inyección de fallos en la función:
//   · S1 (desactivado, TOTP viejos presentes) se fabrica llamando SOLO a la RPC
//     `iniciar` con el JWT del ejecutor;
//   · S2 (TOTP viejos ya borrados, falta el cierre) se fabrica con `iniciar` +
//     `deleteFactor` con la secret key desde el probe, sin `completar`.
//
// Casos:
//   1. nuevo sobre un admin ACTIVADO con TOTP verified + unverified + un
//      WebAuthn sembrado: 200, desactivado, 0 TOTP viejos, el WebAuthn sigue,
//      un inicio y un cierre (factores_borrados = 2).
//   2. Rechazos, cada uno sin cambiar nada: sin JWT, body inválido, motivo,
//      sobre sí mismo, objetivo no admin, ejecutor no admin, aal1, TOTP
//      vencido (token ES256 forjado con la llave local de GoTrue, como
//      probe-storage), y "nada que hacer" (409).
//   3. S1 → la función REANUDA el mismo intento: un solo inicio, un cierre.
//   4. S2 + TOTP NUEVO enrolado después del inicio → `cierre_recuperado`: el
//      TOTP nuevo sobrevive, un solo inicio, un cierre.
//   5. Concurrencia: dos ejecutores a la vez sobre el mismo objetivo → un solo
//      intento y un solo cierre; y dos reintentos de S2 con el mismo
//      `intento_pendiente` → uno cierra, el otro `ya_completado`, sin intento
//      nuevo y sin tocar el TOTP nuevo.
//   6. `activar`: rechaza con el intento pendiente (aunque ya haya un TOTP
//      nuevo); tras completar, rechaza sin TOTP nuevo y acepta tras enrolarlo
//      (`admin.sesion().es_admin` = true).
//   7. El amarre de `admin/src/lib/funciones.ts` (importado REAL) con los
//      cuerpos que devuelve la función.
//
// Gratis: sin terceros. Limpia sus cuentas al final (la auditoría es
// append-only y se queda). Se niega a correr fuera del stack local de Relevo.
// ===========================================================================

import { execFileSync } from 'node:child_process';
import { createPrivateKey, randomUUID, sign as firmar } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { guardaRelevo, CONTENEDOR_DB } from './_guarda-relevo.mjs';
import { totp } from './totp.mjs';
import { activar } from './crear-admin.mjs';
import { rechazoDeFuncion } from '../admin/src/lib/funciones.ts';
import { textoDeRechazo } from '../admin/src/lib/rechazos.ts';

const RUN = Date.now().toString(36);
const PASS = 'Probe-mfa-1234!';
const DOMINIO = 'rlvo.com.mx';

let pasadas = 0;
const fallos = [];
function ok(nombre, cond, detalle) {
  if (cond) { pasadas++; console.log(`  ok — ${nombre}${detalle ? ` (${detalle})` : ''}`); }
  else { fallos.push(nombre); console.log(`  FALLÓ — ${nombre}${detalle ? ` (${detalle})` : ''}`); }
}
const sql = (q) => execFileSync('docker', ['exec', CONTENEDOR_DB, 'psql', '-U', 'postgres', '-d', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '-Atc', q], { encoding: 'utf8' }).trim();

function env() {
  const raw = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const out = {};
  for (const line of raw.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, '');
  }
  return out;
}

const jwt = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

function llaveGotrue() {
  const e = execFileSync('docker', ['inspect', 'supabase_auth_relevo-marketplace', '--format',
    '{{range .Config.Env}}{{println .}}{{end}}'], { encoding: 'utf8' });
  const linea = e.split('\n').find((l) => l.startsWith('GOTRUE_JWT_KEYS='));
  const jwk = JSON.parse(linea.slice('GOTRUE_JWT_KEYS='.length))
    .find((k) => k.kty === 'EC' && k.alg === 'ES256' && (k.key_ops ?? []).includes('sign'));
  return { kid: jwk.kid, llave: createPrivateKey({ key: jwk, format: 'jwk' }) };
}
function forjarConTotp(firma, claimsBase, horas) {
  const ts = Math.floor(Date.now() / 1000) - horas * 3600;
  const claims = { ...claimsBase, amr: (claimsBase.amr ?? []).map((e) =>
    e.method === 'totp' ? { ...e, timestamp: ts } : e) };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const cuerpo = `${b64({ alg: 'ES256', kid: firma.kid, typ: 'JWT' })}.${b64(claims)}`;
  const s = firmar('sha256', Buffer.from(cuerpo), { key: firma.llave, dsaEncoding: 'ieee-p1363' });
  return `${cuerpo}.${s.toString('base64url')}`;
}

async function main() {
  const E = env();
  guardaRelevo({ apiUrl: E.API_URL });
  if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(E.API_URL)) {
    console.error(`ABORTO: API_URL no es local (${E.API_URL})`);
    process.exit(1);
  }
  const FN = `${E.API_URL}/functions/v1/admin-reset-mfa`;
  const adm = createClient(E.API_URL, E.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const cli = () => createClient(E.API_URL, E.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const sonda = await fetch(FN, { method: 'OPTIONS' }).catch(() => null);
  if (!sonda) { console.error(`ABORTO: la función no responde en ${FN} (¿supabase functions serve?)`); process.exit(1); }

  const creadas = [];
  /** Cuenta + fila de admin (activada o no). Devuelve su id. */
  async function cuenta(etq, { admin = true, activado = true } = {}) {
    const correo = `probe-mfa-${etq}-${RUN}@${DOMINIO}`;
    const u = await adm.auth.admin.createUser({ email: correo, password: PASS, email_confirm: true });
    if (u.error) throw new Error(`createUser ${etq}: ${u.error.message}`);
    creadas.push(u.data.user.id);
    if (admin) {
      sql(`insert into private.admins (user_id, nombre, activado_at)
           values ('${u.data.user.id}', 'Probe ${etq}', ${activado ? 'now()' : 'null'})`);
    }
    return { id: u.data.user.id, correo };
  }
  /** Entra con contraseña y enrola+verifica un TOTP. Devuelve el cliente (aal2) y el id del factor. */
  async function conTotp(c) {
    const s = cli();
    const li = await s.auth.signInWithPassword({ email: c.correo, password: PASS });
    if (li.error) throw new Error(`login ${c.correo}: ${li.error.message}`);
    const en = await s.auth.mfa.enroll({ factorType: 'totp', friendlyName: `t-${Date.now()}` });
    if (en.error) throw new Error(`enroll ${c.correo}: ${en.error.message}`);
    const v = await s.auth.mfa.challengeAndVerify({ factorId: en.data.id, code: totp(en.data.totp.secret) });
    if (v.error) throw new Error(`verify ${c.correo}: ${v.error.message}`);
    return { s, factor: en.data.id };
  }
  const token = async (s) => (await s.auth.getSession()).data.session.access_token;
  const llamar = async (tok, body) => {
    const r = await fetch(FN, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: E.PUBLISHABLE_KEY, ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: r.status, cuerpo: await r.json().catch(() => null) };
  };
  const fila = (id, accion) => Number(sql(`select count(*) from private.admin_acciones
    where objetivo_tipo = 'admin' and objetivo_id = '${id}' and accion = '${accion}'`));
  const totpViejos = (id) => Number(sql(`select count(*) from auth.mfa_factors f where f.user_id = '${id}'
    and f.factor_type = 'totp' and f.created_at <= coalesce((select max(created_at) from private.admin_acciones
      where accion = 'restablecer_mfa' and objetivo_id = '${id}'), now())`));
  const activado = (id) => sql(`select (activado_at is not null)::text from private.admins where user_id = '${id}'`) === 'true';
  const existeFactor = (fid) => sql(`select count(*) from auth.mfa_factors where id = '${fid}'`) === '1';

  try {
    // Ejecutores y la cuenta que no es admin.
    const ej = await cuenta('ej');
    const ej2 = await cuenta('ej2');
    const noAdm = await cuenta('noadm', { admin: false });
    const { s: sEj } = await conTotp(ej);
    const { s: sEj2 } = await conTotp(ej2);
    const { s: sNo } = await conTotp(noAdm);
    const tEj = await token(sEj);
    const tEj2 = await token(sEj2);
    console.log(`ejecutor aal=${jwt(tEj).aal} amr=${jwt(tEj).amr.map((e) => e.method).join('+')}`);

    // ---- 1. nuevo sobre un admin activado ----------------------------------
    console.log('\n== 1. nuevo sobre un admin activado ==');
    const x = await cuenta('x');
    const { s: sX, factor: fX } = await conTotp(x);
    const fXu = (await sX.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'sin-verificar' })).data.id;
    const fXw = randomUUID();
    // Medido: con `friendly_name`/`secret` en NULL, GoTrue no puede cargar al
    // usuario ("500 Database error loading user") y CUALQUIER `deleteFactor`
    // suyo falla; GoTrue los escribe como cadena vacía (mismo gotcha que las
    // filas de auth.users sembradas por SQL, CLAUDE.md §9).
    sql(`insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at, friendly_name, secret)
         values ('${fXw}', '${x.id}', 'webauthn', 'verified', now() - interval '1 day', now(), '', '')`);
    const r1 = await llamar(tEj, { user_id: x.id, motivo: 'Perdió el teléfono (probe)' });
    ok('1 200 estado=nuevo desactivado=true', r1.status === 200 && r1.cuerpo?.estado === 'nuevo' && r1.cuerpo?.desactivado === true,
      JSON.stringify(r1));
    ok('1 el objetivo quedó desactivado', !activado(x.id));
    ok('1 sus TOTP (verified y unverified) ya no existen', !existeFactor(fX) && !existeFactor(fXu));
    ok('1 el WebAuthn sobrevive', existeFactor(fXw));
    ok('1 un inicio y un cierre con factores_borrados = 2',
      fila(x.id, 'restablecer_mfa') === 1 && fila(x.id, 'factores_mfa_borrados') === 1
      && sql(`select despues->>'factores_borrados' from private.admin_acciones
              where accion = 'factores_mfa_borrados' and objetivo_id = '${x.id}'`) === '2');

    // ---- 2. rechazos ---------------------------------------------------------
    console.log('\n== 2. rechazos (ninguno cambia nada) ==');
    const y = await cuenta('y');
    const { factor: fY } = await conTotp(y);
    const sinCambios = () => activado(y.id) && existeFactor(fY) && fila(y.id, 'restablecer_mfa') === 0;
    const base = { user_id: y.id, motivo: 'motivo de prueba' };
    const r2a = await llamar(null, base);
    ok('2a sin JWT → 401', r2a.status === 401 && sinCambios(), `${r2a.status}`);
    const r2b = await llamar(tEj, '{no es json');
    ok('2b body inválido → 400 solicitud_invalida', r2b.status === 400 && r2b.cuerpo?.message === 'solicitud_invalida' && sinCambios());
    const r2c = await llamar(tEj, { user_id: y.id, motivo: ' ok ' });
    ok('2c motivo corto → 400 22023 motivo_invalido', r2c.status === 400 && r2c.cuerpo?.code === '22023'
      && r2c.cuerpo?.message === 'motivo_invalido' && sinCambios(), JSON.stringify(r2c.cuerpo));
    const r2d = await llamar(tEj, { user_id: ej.id, motivo: 'motivo de prueba' });
    ok('2d sobre sí mismo → 403 no_sobre_si_mismo', r2d.status === 403 && r2d.cuerpo?.message === 'no_sobre_si_mismo'
      && activado(ej.id), JSON.stringify(r2d.cuerpo));
    const r2e = await llamar(tEj, { user_id: noAdm.id, motivo: 'motivo de prueba' });
    ok('2e objetivo no admin → 404 objetivo_no_es_admin', r2e.status === 404 && r2e.cuerpo?.message === 'objetivo_no_es_admin');
    const r2f = await llamar(await token(sNo), base);
    ok('2f ejecutor no admin → 403 no_admin', r2f.status === 403 && r2f.cuerpo?.message === 'no_admin' && sinCambios());
    const sAal1 = cli();
    await sAal1.auth.signInWithPassword({ email: ej.correo, password: PASS });
    const r2g = await llamar(await token(sAal1), base);
    ok('2g ejecutor aal1 → 403 mfa_requerido', r2g.status === 403 && r2g.cuerpo?.message === 'mfa_requerido' && sinCambios());
    const forjado = forjarConTotp(llaveGotrue(), jwt(tEj), 13);
    const r2h = await llamar(forjado, base);
    ok('2h ejecutor con TOTP de hace 13 h (token forjado) → 403 totp_vencido',
      r2h.status === 403 && r2h.cuerpo?.code === '42501' && r2h.cuerpo?.message === 'totp_vencido' && sinCambios(),
      JSON.stringify(r2h.cuerpo));
    const r2i = await llamar(tEj, { user_id: x.id, motivo: 'otra vez' });
    ok('2i desactivado, sin TOTP y sin pendiente → 409 estado_inesperado',
      r2i.status === 409 && r2i.cuerpo?.message === 'estado_inesperado' && fila(x.id, 'restablecer_mfa') === 1);

    // ---- 3. S1: reanudar el mismo intento -----------------------------------
    console.log('\n== 3. S1 → reanudado ==');
    const iniY = await sEj.schema('admin').rpc('restablecer_mfa_iniciar', { p_user_id: y.id, p_motivo: 'S1 fabricado' });
    ok('3 (fabricar S1) iniciar por RPC → nuevo, desactivado, TOTP viejo presente',
      iniY.data?.estado === 'nuevo' && !activado(y.id) && existeFactor(fY), JSON.stringify(iniY.error ?? iniY.data));
    const r3 = await llamar(tEj, { user_id: y.id, motivo: 'reintento', intento_pendiente: iniY.data?.accion_id });
    ok('3 la función reanuda: 200 reanudado', r3.status === 200 && r3.cuerpo?.estado === 'reanudado', JSON.stringify(r3));
    ok('3 converge: 0 TOTP viejos, un inicio, un cierre',
      totpViejos(y.id) === 0 && fila(y.id, 'restablecer_mfa') === 1 && fila(y.id, 'factores_mfa_borrados') === 1);

    // ---- 4. S2 + TOTP nuevo → cierre_recuperado ------------------------------
    console.log('\n== 4. S2 + TOTP nuevo → cierre_recuperado ==');
    const w = await cuenta('w');
    const { factor: fW } = await conTotp(w);
    const iniW = await sEj.schema('admin').rpc('restablecer_mfa_iniciar', { p_user_id: w.id, p_motivo: 'S2 fabricado' });
    const delW = await adm.auth.admin.mfa.deleteFactor({ id: fW, userId: w.id });
    const { factor: fWn } = await conTotp(w);   // el TOTP NUEVO, posterior al inicio
    ok('4 (fabricar S2) inicio, TOTP viejo borrado y uno nuevo enrolado',
      iniW.data?.estado === 'nuevo' && !delW.error && !existeFactor(fW) && existeFactor(fWn) && totpViejos(w.id) === 0);
    const r4 = await llamar(tEj, { user_id: w.id, motivo: 'reintento', intento_pendiente: iniW.data?.accion_id });
    ok('4 200 cierre_recuperado', r4.status === 200 && r4.cuerpo?.estado === 'cierre_recuperado', JSON.stringify(r4));
    ok('4 el TOTP nuevo sobrevive; un solo inicio y un cierre',
      existeFactor(fWn) && fila(w.id, 'restablecer_mfa') === 1 && fila(w.id, 'factores_mfa_borrados') === 1);
    const r4b = await llamar(tEj2, { user_id: w.id, motivo: 'reintento tardío', intento_pendiente: iniW.data?.accion_id });
    ok('4 un reintento tardío con el mismo intento → 200 ya_completado, sin intento nuevo',
      r4b.status === 200 && r4b.cuerpo?.estado === 'ya_completado' && fila(w.id, 'restablecer_mfa') === 1 && existeFactor(fWn),
      JSON.stringify(r4b));

    // ---- 5. concurrencia ------------------------------------------------------
    console.log('\n== 5. concurrencia ==');
    const v = await cuenta('v');
    const { factor: fV } = await conTotp(v);
    const [c1, c2] = await Promise.all([
      llamar(tEj, { user_id: v.id, motivo: 'concurrente 1' }),
      llamar(tEj2, { user_id: v.id, motivo: 'concurrente 2' }),
    ]);
    ok('5a dos ejecutores a la vez: 200/409, al menos un 200',
      [c1, c2].every((r) => r.status === 200 || r.status === 409) && [c1, c2].some((r) => r.status === 200),
      `${c1.status} ${c1.cuerpo?.estado ?? c1.cuerpo?.message} · ${c2.status} ${c2.cuerpo?.estado ?? c2.cuerpo?.message}`);
    ok('5a un solo intento, un solo cierre, 0 TOTP',
      fila(v.id, 'restablecer_mfa') === 1 && fila(v.id, 'factores_mfa_borrados') === 1 && !existeFactor(fV));

    const u2 = await cuenta('u2');
    const { factor: fU } = await conTotp(u2);
    const iniU = await sEj.schema('admin').rpc('restablecer_mfa_iniciar', { p_user_id: u2.id, p_motivo: 'S2 concurrente' });
    await adm.auth.admin.mfa.deleteFactor({ id: fU, userId: u2.id });
    const { factor: fUn } = await conTotp(u2);
    const [d1, d2] = await Promise.all([
      llamar(tEj, { user_id: u2.id, motivo: 'reintento A', intento_pendiente: iniU.data?.accion_id }),
      llamar(tEj2, { user_id: u2.id, motivo: 'reintento B', intento_pendiente: iniU.data?.accion_id }),
    ]);
    const estados = [d1.cuerpo?.estado, d2.cuerpo?.estado].sort().join(',');
    ok('5b dos reintentos de S2 a la vez: cierre_recuperado + ya_completado',
      d1.status === 200 && d2.status === 200 && estados === 'cierre_recuperado,ya_completado', estados);
    ok('5b sin intento nuevo y el TOTP nuevo sobrevive',
      fila(u2.id, 'restablecer_mfa') === 1 && fila(u2.id, 'factores_mfa_borrados') === 1 && existeFactor(fUn));

    // ---- 6. activar ------------------------------------------------------------
    console.log('\n== 6. activar ==');
    const q = await cuenta('q');
    const { s: sQ, factor: fQ } = await conTotp(q);
    await sEj.schema('admin').rpc('restablecer_mfa_iniciar', { p_user_id: q.id, p_motivo: 'pendiente para activar' });
    let e6a = null;
    try { await activar(q.correo, { confirmado: true }); } catch (e) { e6a = e.message; }
    ok('6a con el intento pendiente y el TOTP viejo → activar rechaza',
      /no se activó/.test(e6a ?? '') && /restablecimiento_pendiente=true/.test(e6a ?? '') && !activado(q.id), e6a?.slice(0, 160));
    // TOTP nuevo con el intento aún pendiente. Medido: con un factor verificado
    // ya presente GoTrue exige aal2 para enrolar otro ("AAL2 required to enroll
    // a new factor"), así que va con la sesión aal2 de q; en la vida real la
    // persona que perdió el teléfono no puede hacerlo hasta que el reset borre
    // el viejo.
    const enQ = await sQ.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'nuevo' });
    const fQn = enQ.data?.id;
    const vQ = await sQ.auth.mfa.challengeAndVerify({ factorId: fQn, code: totp(enQ.data?.totp.secret ?? '') });
    if (enQ.error || vQ.error) throw new Error(`enroll nuevo q: ${enQ.error?.message ?? vQ.error?.message}`);
    const sQ2 = sQ;
    let e6b = null;
    try { await activar(q.correo, { confirmado: true }); } catch (e) { e6b = e.message; }
    ok('6b con un TOTP nuevo pero el intento todavía pendiente → activar rechaza', /no se activó/.test(e6b ?? '') && !activado(q.id));
    const r6 = await llamar(tEj, { user_id: q.id, motivo: 'completar para activar' });
    ok('6c la función reanuda y cierra; el TOTP nuevo sobrevive, el viejo no',
      r6.status === 200 && r6.cuerpo?.estado === 'reanudado' && !existeFactor(fQ) && existeFactor(fQn), JSON.stringify(r6));
    let e6d = null;
    try { await activar(q.correo, { confirmado: true }); } catch (e) { e6d = e.message; }
    const ses = await sQ2.schema('admin').rpc('sesion');
    ok('6d tras cerrar el intento y con un TOTP nuevo → activar funciona y es_admin=true',
      e6d === null && activado(q.id) && ses.data?.es_admin === true, e6d ?? JSON.stringify(ses.data));

    const p = await cuenta('p');
    await conTotp(p);
    const r6e = await llamar(tEj, { user_id: p.id, motivo: 'sin enrolar después' });
    let e6e = null;
    try { await activar(p.correo, { confirmado: true }); } catch (e) { e6e = e.message; }
    ok('6e completado pero SIN TOTP nuevo → activar rechaza', r6e.status === 200 && /no se activó/.test(e6e ?? ''));

    // ---- 7. amarre del panel ---------------------------------------------------
    console.log('\n== 7. amarre de admin/src/lib/funciones.ts ==');
    const a1 = rechazoDeFuncion(r2h.status, r2h.cuerpo);
    ok('7a totp_vencido de la función → {42501, totp_vencido} (useLlamar pide el TOTP)',
      a1.code === '42501' && a1.message === 'totp_vencido');
    const a2 = rechazoDeFuncion(r2a.status, r2a.cuerpo);
    ok('7b el 401 de withSupabase (MISSING_CREDENTIALS) → texto genérico, no cierra la sesión',
      textoDeRechazo(a2).startsWith('No se pudo completar la acción'), `${a2.code}/${a2.message.slice(0, 40)}`);
    const a2b = rechazoDeFuncion(0, null);
    ok('7b sin respuesta (red) → http_0, texto genérico', a2b.message === 'http_0'
      && textoDeRechazo(a2b).startsWith('No se pudo completar la acción'));
    const a3 = rechazoDeFuncion(502, { code: 'parcial', message: 'cierre_pendiente', accion_id: 7 });
    ok('7c un 502 trae accion_id y su texto del frame', a3.accion_id === 7
      && textoDeRechazo(a3) === 'La app autenticadora ya se eliminó, pero el restablecimiento quedó pendiente. Inténtalo de nuevo para completarlo.');
    ok('7d los mensajes de la función tienen texto decidido',
      ['objetivo_no_es_admin', 'factores_pendientes', 'cierre_pendiente', 'estado_inesperado', 'no_sobre_si_mismo', 'motivo_invalido']
        .every((m) => !textoDeRechazo({ code: 'x', message: m }).startsWith('No se pudo completar')));
  } finally {
    // Los factores sembrados por SQL primero: una fila que GoTrue no sepa leer
    // haría fallar el deleteUser y dejaría la cuenta (y rompería T1 de rls.sql).
    if (creadas.length) sql(`delete from auth.mfa_factors where user_id in (${creadas.map((i) => `'${i}'`).join(',')}) and factor_type <> 'totp'`);
    for (const id of creadas) {
      const { error } = await adm.auth.admin.deleteUser(id);
      if (error) console.error(`  no se pudo borrar la cuenta de prueba ${id}: ${error.message}`);
    }
  }

  console.log(`\n${pasadas} pruebas pasaron${fallos.length ? `, ${fallos.length} FALLARON:\n  - ${fallos.join('\n  - ')}` : '.'}`);
  process.exit(fallos.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
