#!/usr/bin/env node
// Probe del panel de admin (RF-17, Ola 1) contra el stack LOCAL + Mailpit.
//
//   node scripts/probe-admin.mjs
//
// Cubre lo que `supabase/tests/rls.sql` (T35) no puede ver, porque allá los
// claims se fabrican: que GoTrue emita de verdad el `aal`/`amr` que
// `private.is_admin()` espera, que el alta de un admin funcione pese al Auth
// Hook de dominios, y que PostgREST exponga el schema `admin`.
//
// Importa la implementación REAL de `scripts/crear-admin.mjs` (crear y
// activar), no la transcribe. Necesita TOTP encendido en `config.toml`
// (`[auth.mfa.totp]`) y `admin` en `[api] schemas`; imprime al arrancar
// contra qué estado corre.
//
// Casos:
//   1. El alta de un admin: `/invite` SÍ pasa por el hook (403) y
//      `/admin/users` no (200): por eso `crear` usa el segundo.
//   2. Código de recuperación → contraseña → TOTP → aal2; antes de `activar`,
//      `admin.sesion()` dice es_admin=false y `activar` exige el TOTP.
//   3. `amr` tras password, tras TOTP, tras refresh (CONSERVA el timestamp del
//      TOTP) y tras re-verificar (lo RENUEVA): es lo que hace cumplible D16.
//   4. Una RPC con aal2 pasa; con una sesión aal1, 42501 `mfa_requerido`.
//   5. "Olvidé mi contraseña" de un admin activado: el código da aal1 y hay
//      que pedir TOTP para volver a aal2. 5b: el de una cuenta que nunca fijó
//      contraseña también funciona.
//   6. Un nombre con comilla simple (O'Brien) llega intacto a
//      `private.admins`, y `crear-admin.mjs` no contiene ningún dollar-quote.
//   7. El clasificador de rechazos del panel (`admin/src/lib/rechazos.ts`,
//      importado REAL): solo los tres mensajes de `exigir_admin()` cierran la
//      sesión o piden TOTP; los 42501 de las guardas solo se muestran. Y el
//      amarre: los mensajes que devuelve la base por HTTP son esas constantes.
//   8. `crear-admin.mjs --remoto` (Ola 3), con la conexión por PG* apuntada al
//      stack local: (a) un ref equivocado se niega antes de pedir credenciales;
//      (b) un preflight fallido no crea nada; (c) si el INSERT falla tras
//      createUser, la compensación borra la cuenta; (d) crear → activar →
//      desactivar, con su auditoría y `no_admin` en la sesión aal2 vigente;
//      (e) tras desactivar, el factor viejo no reactiva y uno nuevo sí;
//      (f) ningún console.* imprime una credencial.
//
// Limpia lo suyo al final (sus cuentas; la auditoría es append-only y se
// queda, como en cualquier borrado de cuenta de admin).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { crear, activar, desactivar, conexionPg, conexionRemota } from './crear-admin.mjs';
import { totp, siguienteVentana } from './totp.mjs';
import {
  clasificarRechazo, NO_ADMIN, MFA_REQUERIDO, TOTP_VENCIDO, tieneTextoDecidido,
} from '../admin/src/lib/rechazos.ts';

const DB = 'supabase_db_relevo-marketplace';
const MAIL = 'http://127.0.0.1:54324';
const RUN = Date.now().toString(36);
const PASS = 'Probe-admin-1234!';

let pasadas = 0;
const fallos = [];
function ok(nombre, cond, detalle) {
  if (cond) { pasadas++; console.log(`  ok — ${nombre}${detalle ? ` (${detalle})` : ''}`); }
  else { fallos.push(nombre); console.log(`  FALLÓ — ${nombre}${detalle ? ` (${detalle})` : ''}`); }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-d', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '-Atc', q], { encoding: 'utf8' }).trim();

function env() {
  const raw = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  const out = {};
  for (const line of raw.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, '');
  }
  return out;
}

const jwt = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
const tsDe = (claims, metodo) => claims.amr?.find((e) => e.method === metodo)?.timestamp;

// TOTP (RFC 6238): `scripts/totp.mjs`, compartido con probe-storage.mjs.

async function correos(to) {
  const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
  return (await r.json()).messages ?? [];
}
async function codigoNuevo(to, previos) {
  for (let i = 0; i < 40; i++) {
    const l = await correos(to);
    if (l.length > previos) {
      const m = await (await fetch(`${MAIL}/api/v1/message/${l[0].ID}`)).json();
      return (m.Text ?? '').match(/\b\d{6}\b/)?.[0];
    }
    await esperar(150);
  }
  return undefined;
}

async function main() {
  const E = env();
  const cli = () => createClient(E.API_URL, E.PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const creadas = [];
  // Se registra ANTES de crear: si `crear()` revienta a la mitad (ya existe
  // la cuenta pero falló el insert), el `finally` igual la borra. Y el fallo
  // sale como FALLÓ con nombre, no como un error crudo que corta el probe.
  const crearProbe = async (correo, nombre) => {
    creadas.push(correo);
    try { await crear(correo, nombre); return null; } catch (e) { return e.message; }
  };

  console.log('Estado del stack:');
  const gotrue = execFileSync('docker', ['exec', 'supabase_auth_relevo-marketplace', 'env'],
    { encoding: 'utf8' }).split('\n').filter((l) => /MFA_TOTP|HOOK_BEFORE_USER_CREATED_ENABLED/.test(l));
  console.log(`  ${gotrue.join(' ')}`);
  console.log(`  dominios del hook: ${sql('select string_agg(dominio, \',\') from public.universidad_dominios')}`);
  console.log(`  funciones de admin.*: ${sql("select string_agg(proname, ',' order by proname) from pg_proc where pronamespace = 'admin'::regnamespace")}`);

  try {
    // -------------------------------------------------------------------
    console.log('\n== 1. /invite pasa por el hook; /admin/users no ==');
    const inv = await fetch(`${E.API_URL}/auth/v1/invite`, {
      method: 'POST',
      headers: { apikey: E.SECRET_KEY, Authorization: `Bearer ${E.SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `probe-admin-inv-${RUN}@rlvo.com.mx` }),
    });
    const invJson = await inv.json();
    ok('/invite de @rlvo.com.mx → 403 dominio_no_participante', inv.status === 403 && invJson.msg === 'dominio_no_participante',
      `${inv.status} ${invJson.msg}`);

    const A = `probe-admin-a-${RUN}@rlvo.com.mx`;
    const errA = await crearProbe(A, 'Admin Probe');
    ok('crear() termina sin error', !errA, errA?.slice(0, 120));
    if (errA) throw new Error('sin la cuenta A no se puede seguir');
    ok('crear() por /admin/users → la cuenta existe', sql(`select count(*) from auth.users where email = '${A}'`) === '1');
    ok('…con fila en private.admins SIN activar',
      sql(`select (activado_at is null)::text from private.admins a join auth.users u on u.id = a.user_id where u.email = '${A}'`) === 'true');

    // -------------------------------------------------------------------
    console.log('\n== 2. código → contraseña → TOTP → aal2, y activar ==');
    const cod = await codigoNuevo(A, 0);
    ok('crear() mandó el código de recuperación', Boolean(cod));
    const cA = cli();
    const ver = await cA.auth.verifyOtp({ type: 'recovery', email: A, token: cod });
    ok('verifyOtp(recovery) → sesión', !ver.error && Boolean(ver.data.session), ver.error?.message);
    const up = await cA.auth.updateUser({ password: PASS });
    ok('updateUser(password) → ok', !up.error, up.error?.message);

    let fallo = null;
    try { await activar(A, { confirmado: true }); } catch (e) { fallo = e.message; }
    ok('activar ANTES de enrolar TOTP → rechazado', Boolean(fallo), fallo?.slice(0, 80));

    const cL = cli();
    const lg = await cL.auth.signInWithPassword({ email: A, password: PASS });
    ok('login con contraseña', !lg.error, lg.error?.message);
    const c0 = jwt(lg.data.session.access_token);
    const en = await cL.auth.mfa.enroll({ factorType: 'totp' });
    ok('mfa.enroll(totp)', !en.error, en.error?.message);
    const secret = en.data.totp.secret;
    const fid = en.data.id;
    const v1 = await cL.auth.mfa.challengeAndVerify({ factorId: fid, code: totp(secret) });
    ok('challengeAndVerify → sin error', !v1.error, v1.error?.message);
    const c1 = jwt((await cL.auth.getSession()).data.session.access_token);
    ok('tras TOTP: aal2', c1.aal === 'aal2', c1.aal);

    const s0 = await cL.schema('admin').rpc('sesion');
    ok('antes de activar: admin.sesion() → es_admin=false, admin_activado=false',
      !s0.error && s0.data.es_admin === false && s0.data.admin_activado === false,
      JSON.stringify(s0.data ?? s0.error));

    await activar(A, { confirmado: true });
    const s1 = await cL.schema('admin').rpc('sesion');
    ok('después de activar: admin.sesion() → es_admin=true (misma sesión)',
      !s1.error && s1.data.es_admin === true, JSON.stringify(s1.data ?? s1.error));
    ok('activar quedó auditado como activar_admin con el centinela',
      sql(`select count(*) from private.admin_acciones a join auth.users u on u.id::text = a.objetivo_id
            where u.email = '${A}' and a.accion = 'activar_admin'
              and a.admin_id = '00000000-0000-0000-0000-000000000000'
              and a.admin_correo = 'script:crear-admin.mjs'`) === '1');

    // -------------------------------------------------------------------
    console.log('\n== 3. amr: refresh conserva el TOTP, re-verificar lo renueva ==');
    console.log(`  tras password: aal=${c0.aal} amr=${JSON.stringify(c0.amr)}`);
    console.log(`  tras TOTP:     aal=${c1.aal} amr=${JSON.stringify(c1.amr)}`);
    await esperar(1500);
    const rf = await cL.auth.refreshSession();
    const c2 = jwt(rf.data.session.access_token);
    console.log(`  tras refresh:  aal=${c2.aal} amr=${JSON.stringify(c2.amr)}`);
    ok('refresh: iat nuevo, timestamp del totp IGUAL', c2.iat > c1.iat && tsDe(c2, 'totp') === tsDe(c1, 'totp'));
    await siguienteVentana();
    const v2 = await cL.auth.mfa.challengeAndVerify({ factorId: fid, code: totp(secret) });
    const c3 = jwt((await cL.auth.getSession()).data.session.access_token);
    console.log(`  re-verificar:  aal=${c3.aal} amr=${JSON.stringify(c3.amr)}`);
    ok('re-verificar el TOTP RENUEVA su timestamp (D16 cumplible)',
      !v2.error && tsDe(c3, 'totp') > tsDe(c1, 'totp'), `${tsDe(c1, 'totp')} → ${tsDe(c3, 'totp')}`);

    // -------------------------------------------------------------------
    console.log('\n== 4. RPC con aal2 pasa; con aal1, mfa_requerido ==');
    const b2 = await cL.schema('admin').rpc('buscar_usuarios', { p_q: A });
    ok('buscar_usuarios con aal2 → encuentra la cuenta, con correo',
      !b2.error && b2.data.length === 1 && b2.data[0].correo === A, b2.error?.message);
    const cAal1 = cli();
    await cAal1.auth.signInWithPassword({ email: A, password: PASS });
    const b1 = await cAal1.schema('admin').rpc('buscar_usuarios', { p_q: A });
    ok('buscar_usuarios con aal1 → 42501 mfa_requerido',
      b1.error?.code === '42501' && b1.error?.message === 'mfa_requerido', `${b1.error?.code} ${b1.error?.message}`);
    const anon = await cli().schema('admin').rpc('sesion');
    ok('anon → rechazado (sin USAGE en admin)', Boolean(anon.error), anon.error?.message);

    // -------------------------------------------------------------------
    console.log('\n== 5. olvidé mi contraseña de un admin activado ==');
    await siguienteVentana();
    const previos = (await correos(A)).length;
    const r5 = await cli().auth.resetPasswordForEmail(A);
    ok('resetPasswordForEmail → ok', !r5.error, r5.error?.message);
    const cod5 = await codigoNuevo(A, previos);
    const c5 = cli();
    const v5 = await c5.auth.verifyOtp({ type: 'recovery', email: A, token: cod5 });
    const j5 = jwt(v5.data.session.access_token);
    ok('el código da sesión aal1 (amr otp), no aal2', j5.aal === 'aal1', `${j5.aal} ${JSON.stringify(j5.amr)}`);
    const r5a = await c5.schema('admin').rpc('buscar_usuarios', { p_q: A });
    ok('…y el panel pide TOTP (mfa_requerido)', r5a.error?.message === 'mfa_requerido', r5a.error?.message);
    const v5t = await c5.auth.mfa.challengeAndVerify({ factorId: fid, code: totp(secret) });
    const r5b = await c5.schema('admin').rpc('buscar_usuarios', { p_q: A });
    ok('…con el TOTP vuelve a aal2 y pasa', !v5t.error && !r5b.error, v5t.error?.message ?? r5b.error?.message);

    console.log('\n== 5b. una cuenta que nunca fijó contraseña ==');
    const B = `probe-admin-b-${RUN}@rlvo.com.mx`;
    const errB = await crearProbe(B, 'Admin Sin Clave');
    ok('crear() de B termina sin error', !errB, errB?.slice(0, 120));
    const codB0 = await codigoNuevo(B, 0);
    ok('crear() le mandó su código', Boolean(codB0));
    await esperar(1200); // max_frequency de [auth.email]
    const prevB = (await correos(B)).length;
    const rB = await cli().auth.resetPasswordForEmail(B);
    const codB = await codigoNuevo(B, prevB);
    const cB = cli();
    const vB = await cB.auth.verifyOtp({ type: 'recovery', email: B, token: codB });
    ok('pedir otro código y verificarlo → sesión', !rB.error && !vB.error && Boolean(vB.data.session),
      rB.error?.message ?? vB.error?.message);

    // -------------------------------------------------------------------
    console.log("\n== 6. O'Brien: nada se interpola ==");
    const OB = `o'brien.probe-${RUN}@rlvo.com.mx`;
    const errOB = await crearProbe(OB, "O'Brien");
    ok("crear() con un nombre con comilla simple termina sin error", !errOB, errOB?.slice(0, 120));
    ok("private.admins.nombre = O'Brien exacto",
      sql(`select nombre from private.admins a join auth.users u on u.id = a.user_id where u.email = '${OB.replace(/'/g, "''")}'`) === "O'Brien");
    const fuente = readFileSync(new URL('./crear-admin.mjs', import.meta.url), 'utf8');
    ok('crear-admin.mjs no contiene ningún dollar-quote', !fuente.includes('$' + '$'));
    let rechazo = null;
    try { await crear('otro@gmail.com', 'Nombre'); } catch (e) { rechazo = e.message; }
    ok('crear() rechaza un correo fuera de @rlvo.com.mx antes de tocar nada', Boolean(rechazo) &&
      sql("select count(*) from auth.users where email = 'otro@gmail.com'") === '0');
    rechazo = null;
    try { await crear(`probe-admin-x-${RUN}@rlvo.com.mx`, 'Juan\n; drop table x'); } catch (e) { rechazo = e.message; }
    ok('crear() rechaza un nombre con salto de línea', Boolean(rechazo));

    // -------------------------------------------------------------------
    console.log('\n== 7. clasificador de rechazos del panel ==');
    const casos = [
      [{ code: '42501', message: 'no_admin' }, 'cerrar_sesion'],
      [{ code: '42501', message: 'mfa_requerido' }, 'pedir_totp'],
      [{ code: '42501', message: 'totp_vencido' }, 'pedir_totp'],
      [{ code: '42501', message: 'no_sobre_si_mismo' }, 'mostrar'],
      [{ code: '42501', message: 'objetivo_es_admin' }, 'mostrar'],
      [{ code: '42501', message: 'new row violates row-level security policy for table "x"' }, 'mostrar'],
      [{ code: '22023', message: 'motivo_invalido' }, 'mostrar'],
      [{ code: 'P0001', message: 'no_admin' }, 'mostrar'],
      [null, 'mostrar'],
    ];
    for (const [err, esperado] of casos) {
      ok(`7a ${JSON.stringify(err)} → ${esperado}`, clasificarRechazo(err) === esperado, clasificarRechazo(err));
    }

    // 7b: el amarre contra la base REAL, por HTTP.
    ok('7b mfa_requerido de la base (caso 4) === MFA_REQUERIDO', b1.error?.message === MFA_REQUERIDO, b1.error?.message);
    const noAdm = await cB.schema('admin').rpc('buscar_usuarios', { p_q: 'x' });
    ok('7b una cuenta sin activar recibe exactamente NO_ADMIN',
      noAdm.error?.code === '42501' && noAdm.error?.message === NO_ADMIN, noAdm.error?.message);
    const idA = sql(`select id from auth.users where email = '${A}'`);
    const idB = sql(`select id from auth.users where email = '${B}'`);
    const self = await c5.schema('admin').rpc('suspender_usuario', { p_user_id: idA, p_motivo: 'probe 7b' });
    ok('7b suspenderse a sí mismo → 42501 no_sobre_si_mismo, y el panel solo lo muestra',
      self.error?.message === 'no_sobre_si_mismo' && clasificarRechazo(self.error) === 'mostrar', self.error?.message);
    const otro = await c5.schema('admin').rpc('suspender_usuario', { p_user_id: idB, p_motivo: 'probe 7b' });
    ok('7b suspender a otro admin → 42501 objetivo_es_admin, y el panel solo lo muestra',
      otro.error?.message === 'objetivo_es_admin' && clasificarRechazo(otro.error) === 'mostrar', otro.error?.message);
    const fuenteExigir = sql("select prosrc from pg_proc where oid = 'private.exigir_admin()'::regprocedure");
    ok('7b las tres constantes del panel están literales en private.exigir_admin()',
      [NO_ADMIN, MFA_REQUERIDO, TOTP_VENCIDO].every((m) => fuenteExigir.includes(`'${m}'`)));

    // 7c: todo mensaje que lanza una RPC de `admin.*` tiene un texto decidido en
    // el panel (propio, o el genérico a propósito). Se lee del pg_proc VIVO, no
    // de una lista: una RPC nueva con un `raise` nuevo cae aquí hasta que alguien
    // decida su copy.
    const fuenteAdmin = sql("select string_agg(prosrc, ' ') from pg_proc where pronamespace = 'admin'::regnamespace");
    const lanzados = [...new Set([...fuenteAdmin.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]))];
    const sinDecidir = lanzados.filter((m) => !tieneTextoDecidido(m));
    ok(`7c los ${lanzados.length} mensajes de admin.* tienen un texto decidido en rechazos.ts`,
      lanzados.length > 0 && sinDecidir.length === 0, sinDecidir.join(', ') || lanzados.join(', '));

    // -------------------------------------------------------------------
    // 8. El camino de `--remoto` (Ola 3), contra el stack LOCAL: una conexión
    // por PG* (TCP dentro del contenedor, la contraseña por defecto del stack
    // local) es exactamente la que usa producción, solo cambia el host.
    console.log('\n== 8. crear-admin --remoto: ref, preflight, compensación, desactivar ==');
    const conPg = conexionPg({
      etiqueta: 'probe (PG* contra local)', apiUrl: E.API_URL, secretKey: E.SECRET_KEY,
      publishableKey: E.PUBLISHABLE_KEY,
      pg: { host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres', sslmode: 'disable' },
    });
    const totalAuth = () => sql('select count(*) from auth.users');

    // 8a. El ref se confirma ANTES de pedir credenciales o tocar la red.
    const antes8a = totalAuth();
    const preguntas = [];
    let r8a = null;
    try {
      await conexionRemota({
        poolerHost: 'aws-0-us-east-1.pooler.supabase.com',
        preguntar: async (t) => { preguntas.push(t); return 'otro-ref'; },
      });
    } catch (e) { r8a = e.message; }
    ok('8a --remoto con un ref equivocado se niega, sin pedir credenciales ni crear nada',
      /ref no coincide/.test(r8a ?? '') && preguntas.length === 1 && totalAuth() === antes8a,
      `${r8a} · preguntas=${preguntas.length}`);

    // 8b. Un preflight que falla (host inválido) no crea nada.
    const C8b = `probe-admin-8b-${RUN}@rlvo.com.mx`;
    creadas.push(C8b);
    const antes8b = [totalAuth(), sql('select count(*) from private.admins')];
    let r8b = null;
    try {
      await crear(C8b, 'Admin Preflight', { con: conexionPg({
        etiqueta: 'probe (host inválido)', apiUrl: E.API_URL, secretKey: E.SECRET_KEY,
        publishableKey: E.PUBLISHABLE_KEY,
        pg: { host: 'no-existe.invalid', port: 5432, user: 'postgres', password: 'x', sslmode: 'disable' },
      }) });
    } catch (e) { r8b = e.message; }
    ok('8b preflight fallido → no se crea nada (auth.users y private.admins iguales)',
      /^preflight:/.test(r8b ?? '') && totalAuth() === antes8b[0]
        && sql('select count(*) from private.admins') === antes8b[1], r8b?.slice(0, 100));

    // 8c. El INSERT falla tras createUser → la compensación borra la cuenta.
    const C8c = `probe-admin-8c-${RUN}@rlvo.com.mx`;
    creadas.push(C8c);
    const conRota = { ...conPg, ejecutar: (q, v) => {
      if (q.includes('insert into private.admins')) throw new Error('INSERT forzado a fallar (probe 8c)');
      return conPg.ejecutar(q, v);
    } };
    let r8c = null;
    try { await crear(C8c, 'Admin Huerfano', { con: conRota }); } catch (e) { r8c = e.message; }
    ok('8c INSERT fallido → compensación: 0 filas en auth.users y en public.users',
      /compensación/.test(r8c ?? '')
        && sql(`select count(*) from auth.users where email = '${C8c}'`) === '0'
        && sql(`select count(*) from public.users where correo = '${C8c}'`) === '0', r8c?.slice(0, 100));

    // 8d. crear → activar → desactivar, todo por PG*.
    const C = `probe-admin-8d-${RUN}@rlvo.com.mx`;
    creadas.push(C);
    let r8d = null;
    try { await crear(C, 'Admin Ocho', { con: conPg }); } catch (e) { r8d = e.message; }
    ok('8d crear por PG* termina sin error', !r8d, r8d?.slice(0, 100));
    const codC = await codigoNuevo(C, 0);
    const cC = cli();
    await cC.auth.verifyOtp({ type: 'recovery', email: C, token: codC });
    await cC.auth.updateUser({ password: PASS });
    const cC2 = cli();
    await cC2.auth.signInWithPassword({ email: C, password: PASS });
    const enC = await cC2.auth.mfa.enroll({ factorType: 'totp' });
    const vC = await cC2.auth.mfa.challengeAndVerify({ factorId: enC.data.id, code: totp(enC.data.totp.secret) });
    ok('8d enrolar el primer TOTP', !enC.error && !vC.error, enC.error?.message ?? vC.error?.message);
    await activar(C, { confirmado: true, con: conPg });
    const sC1 = await cC2.schema('admin').rpc('sesion');
    ok('8d activado por PG* → es_admin=true', sC1.data?.es_admin === true, JSON.stringify(sC1.data ?? sC1.error));

    const idC = sql(`select id from auth.users where email = '${C}'`);
    const activadoAntes = sql(`select to_jsonb(activado_at)::text from private.admins where user_id = '${idC}'`);
    await desactivar(C, 'Perdió el teléfono (probe 8d)', { con: conPg });
    ok('8d desactivar → activado_at NULL',
      sql(`select (activado_at is null)::text from private.admins where user_id = '${idC}'`) === 'true');
    ok('8d la auditoría desactivar_admin trae el activado_at de antes y null después',
      sql(`select ((antes->'activado_at')::text = '${activadoAntes}' and despues = '{"activado_at": null}'::jsonb
                   and admin_id = '00000000-0000-0000-0000-000000000000'
                   and admin_correo = 'script:crear-admin.mjs')::text
             from private.admin_acciones
            where accion = 'desactivar_admin' and objetivo_id = '${idC}'`) === 'true');
    const bC = await cC2.schema('admin').rpc('buscar_usuarios', { p_q: 'x' });
    ok('8d con aal2 y TOTP vigente, una cuenta desactivada recibe no_admin',
      bC.error?.code === '42501' && bC.error?.message === NO_ADMIN, bC.error?.message);

    // 8e. Tras desactivar, el factor VIEJO no reactiva; uno nuevo sí.
    let r8e = null;
    try { await activar(C, { confirmado: true, con: conPg }); } catch (e) { r8e = e.message; }
    ok('8e activar con el factor de ANTES de la desactivación → rechazado',
      /no se activó/.test(r8e ?? '') && sql(`select (activado_at is null)::text from private.admins where user_id = '${idC}'`) === 'true',
      r8e?.slice(0, 120));
    const admC = createClient(E.API_URL, E.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const delF = await admC.auth.admin.mfa.deleteFactor({ id: enC.data.id, userId: idC });
    const cC3 = cli();
    await cC3.auth.signInWithPassword({ email: C, password: PASS });
    const enC2 = await cC3.auth.mfa.enroll({ factorType: 'totp' });
    const vC2 = await cC3.auth.mfa.challengeAndVerify({ factorId: enC2.data.id, code: totp(enC2.data.totp.secret) });
    let r8e2 = null;
    try { await activar(C, { confirmado: true, con: conPg }); } catch (e) { r8e2 = e.message; }
    const sC2 = await cC3.schema('admin').rpc('sesion');
    ok('8e borrar el factor, enrolar uno nuevo y activar → es_admin=true',
      !delF.error && !enC2.error && !vC2.error && !r8e2 && sC2.data?.es_admin === true,
      delF.error?.message ?? enC2.error?.message ?? vC2.error?.message ?? r8e2 ?? JSON.stringify(sC2.data));

    // 8f. Ninguna línea que imprime menciona una variable de credencial.
    const fuenteCA = readFileSync(new URL('./crear-admin.mjs', import.meta.url), 'utf8');
    const filtran = fuenteCA.split('\n')
      .filter((l) => /console\.\w+\(/.test(l) && /\b(secretKey|password|PGPASSWORD|publishableKey)\b/.test(l));
    ok('8f ningún console.* de crear-admin.mjs imprime una credencial', filtran.length === 0, filtran.join(' | '));
  } finally {
    for (const c of creadas) {
      sql(`delete from auth.users where email = '${c.replace(/'/g, "''")}'`);
    }
  }

  console.log('');
  if (fallos.length) {
    console.log(`FALLARON ${fallos.length}: ${fallos.join(' | ')}`);
    process.exit(1);
  }
  console.log('===========================================');
  console.log(`   LAS ${pasadas} PRUEBAS PASARON`);
  console.log('===========================================');
}

await main();
