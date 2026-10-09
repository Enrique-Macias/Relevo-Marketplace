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
//      (f) con centinelas: ninguna salida ni objeto de error (util.inspect)
//      contiene la secret key ni la contraseña; (g) un correo con MAYÚSCULAS
//      en auth.users lo encuentran las 6 comparaciones (lower).
//   9. Correos EXTERNOS de admin (`--correo-externo`): (a) sin el flag se
//      rechaza; (b) con el flag, una confirmación que no coincide no toca
//      nada; (c) con el flag y la confirmación correcta el flujo completo
//      funciona y `activar`/`desactivar` aceptan ese correo; (d) un dominio de
//      `universidad_dominios` se rechaza aun con flag y confirmación; (e) una
//      cuenta existente (del marketplace) no se convierte en admin; (f) un
//      correo mal formado se rechaza antes de cualquier llamada; (g) un
//      @rlvo.com.mx no pide confirmación.
//  10. Catálogo (Ola 5): `admin.catalogo()` por HTTP, una escritura por cada
//      RPC con su fila de auditoría y el actor real, y la carrera de
//      `agregar_dominio` hecha determinista con otra sesión que inserta el
//      mismo dominio sin confirmar (dominio_existe_activo, sin 23505 crudo).
//
// Limpia lo suyo al final (sus cuentas y su universidad de prueba, con sus
// campus y dominios; la auditoría es append-only y se queda, como en
// cualquier borrado de cuenta de admin).

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { crear, activar, desactivar, conexionPg, conexionRemota, REF_REMOTO } from './crear-admin.mjs';
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

  const dominiosAntes9 = sql(`select string_agg(dominio, ',' order by dominio) from public.universidad_dominios`);
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
    // La confirmación se inyecta y FALLA si se pide: sin el flag nunca debe pedirse
    // (y así, una regresión cae en una aserción en vez de colgar el probe en un prompt).
    try {
      await crear('otro@gmail.com', 'Nombre', { confirmarCorreo: async () => { throw new Error('confirmación pedida SIN --correo-externo'); } });
    } catch (e) { rechazo = e.message; }
    ok('crear() rechaza un correo fuera de @rlvo.com.mx SIN --correo-externo, antes de tocar nada', Boolean(rechazo) &&
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

    // 7d: EL TTL DEL RECLAMO ESTÁ ESCRITO DOS VECES (Ola 4): `TTL_RECLAMO_MS` de
    // moderar-contenido y el `interval` de `admin.aprobar_listing`, que toma el
    // mismo reclamo para aprobar. Desincronizados no dan ningún error: el panel
    // liberaría (o respetaría) un reclamo que la función trata distinto. Se lee
    // el fuente de la función y el prosrc VIVO, y se comparan en milisegundos.
    const fuenteFuncion = readFileSync(
      new URL('../supabase/functions/moderar-contenido/index.ts', import.meta.url), 'utf8');
    const ttlFuncion = Number(fuenteFuncion.match(/const TTL_RECLAMO_MS = ([\d_]+);/)?.[1].replace(/_/g, ''));
    const fuenteAprobar = sql("select prosrc from pg_proc where oid = 'admin.aprobar_listing(bigint,text)'::regprocedure");
    const intervalos = [...fuenteAprobar.matchAll(/interval '(\d+) seconds'/g)].map((m) => Number(m[1]) * 1000);
    ok(`7d el TTL del reclamo coincide: moderar-contenido ${ttlFuncion} ms, aprobar_listing ${intervalos.join(',')} ms`,
      Number.isFinite(ttlFuncion) && intervalos.length === 1 && intervalos[0] === ttlFuncion);

    // -------------------------------------------------------------------
    // 10. Catálogo (Ola 5, 20261008000484) por HTTP, con la sesión aal2 de
    // `c5`. T37 prueba los contratos con claims fabricados; esto prueba que
    // PostgREST expone las 8 RPC, que cada escritura audita con el actor real
    // y que una carrera en `agregar_dominio` no deja escapar un 23505 crudo
    // (sin advisory lock, deciden `on conflict` y la PK).
    console.log('\n== 10. catálogo (Ola 5) ==');
    const cat = await c5.schema('admin').rpc('catalogo');
    ok('10a catalogo() por HTTP trae el catálogo, con tec.mx activo',
      !cat.error && cat.data.universidades.some((u) => u.dominios.some((d) => d.dominio === 'tec.mx' && d.activo === true)),
      cat.error?.message);
    const audita = (accion, objetivo) => sql(`select count(*) from private.admin_acciones
      where accion = '${accion}' and objetivo_id = '${objetivo}' and admin_id = '${idA}'`) === '1';
    const nomU = `Probe Cat ${RUN}`;
    const rU = await c5.schema('admin').rpc('crear_universidad', { p_nombre: nomU, p_motivo: 'probe 10' });
    ok('10b crear_universidad → id, auditado con el actor', !rU.error && audita('crear_universidad', String(rU.data)),
      rU.error?.message);
    const rC = await c5.schema('admin').rpc('crear_campus', {
      p_universidad_id: rU.data, p_nombre: 'Campus Probe', p_ciudad: 'Monterrey',
      p_latitud: 25.65, p_longitud: -100.29, p_motivo: 'probe 10' });
    ok('10c crear_campus → id, auditado', !rC.error && audita('crear_campus', String(rC.data)), rC.error?.message);
    const rEU = await c5.schema('admin').rpc('editar_universidad', { p_id: rU.data, p_nombre: `${nomU} Dos`, p_motivo: 'probe 10' });
    ok('10d editar_universidad → ok, auditado', !rEU.error && audita('editar_universidad', String(rU.data)), rEU.error?.message);
    const rEC = await c5.schema('admin').rpc('editar_campus', {
      p_id: rC.data, p_nombre: 'Campus Probe', p_ciudad: 'Monterrey', p_latitud: null, p_longitud: null, p_motivo: 'probe 10' });
    ok('10e editar_campus → ok, auditado', !rEC.error && audita('editar_campus', String(rC.data)), rEC.error?.message);
    const dom = `probe-cat-${RUN}.mx`;
    const rD = await c5.schema('admin').rpc('agregar_dominio', { p_universidad_id: rU.data, p_dominio: dom, p_motivo: 'probe 10' });
    ok('10f agregar_dominio → ok, auditado', !rD.error && audita('agregar_dominio', dom), rD.error?.message);
    const rDes = await c5.schema('admin').rpc('desactivar_dominio', { p_dominio: dom, p_motivo: 'probe 10' });
    ok('10g desactivar_dominio → ok, auditado y activo=false',
      !rDes.error && audita('desactivar_dominio', dom)
        && sql(`select activo::text from public.universidad_dominios where dominio = '${dom}'`) === 'false', rDes.error?.message);
    const rRe = await c5.schema('admin').rpc('reactivar_dominio', { p_dominio: dom, p_motivo: 'probe 10' });
    ok('10h reactivar_dominio → ok, auditado y activo=true',
      !rRe.error && audita('reactivar_dominio', dom)
        && sql(`select activo::text from public.universidad_dominios where dominio = '${dom}'`) === 'true', rRe.error?.message);
    // 10i. La carrera de agregar_dominio, DETERMINISTA. Dos llamadas HTTP
    // "simultáneas" casi nunca se solapan (medido: sin el `on conflict`, la
    // versión con Promise.all seguía en verde), así que no probaban nada. Aquí
    // otra sesión inserta el MISMO dominio y espera 2 s sin confirmar: el
    // pre-chequeo de la RPC no ve la fila, su INSERT se bloquea en la PK y, al
    // confirmar la otra sesión, `on conflict do nothing` da 0 filas →
    // dominio_existe_activo. Sin el `on conflict` sería un 23505 crudo.
    const dom2 = `probe-cat2-${RUN}.mx`;
    const otraSesion = spawn('docker', ['exec', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c',
      `begin; insert into public.universidad_dominios (dominio, universidad_id) values ('${dom2}', ${rU.data}); select pg_sleep(2); commit;`],
      { stdio: 'ignore' });
    const terminoOtra = new Promise((r) => otraSesion.on('exit', r));
    await esperar(600);
    const enCarrera = await c5.schema('admin').rpc('agregar_dominio', { p_universidad_id: rU.data, p_dominio: dom2, p_motivo: 'probe 10i' });
    const codigoOtra = await terminoOtra;
    ok('10i carrera: otra sesión inserta el mismo dominio sin confirmar → la RPC espera y responde dominio_existe_activo',
      codigoOtra === 0 && enCarrera.error?.code === '55000' && enCarrera.error?.message === 'dominio_existe_activo',
      `otra sesión exit ${codigoOtra}; rpc ${enCarrera.error?.code}:${enCarrera.error?.message}`);
    ok('10i …sin 23505 crudo, una sola fila y sin auditoría de la RPC',
      enCarrera.error?.code !== '23505'
        && sql(`select count(*) from public.universidad_dominios where dominio = '${dom2}'`) === '1'
        && sql(`select count(*) from private.admin_acciones where accion = 'agregar_dominio' and objetivo_id = '${dom2}'`) === '0',
      `${enCarrera.error?.code}:${enCarrera.error?.message}`);
    // El catálogo vuelve a su estado ANTES de los casos 8 y 9: el 9c compara
    // `universidad_dominios` contra la foto del arranque (el finally es respaldo).
    sql(`delete from public.universidades where nombre like 'Probe Cat ${RUN}%'`);

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
    // `correos_bloqueados` ENTERA antes y después (conteo + md5 de sus filas):
    // la compensación borra una cuenta NO suspendida, y el trigger que guarda
    // el hash solo dispara con `old.estado = 'suspendido'` (…474:217-221).
    const fotoBloqueados = () => sql(`select count(*) || ':' || coalesce(md5(string_agg(
      encode(correo_hash, 'hex') || '@' || created_at::text, ',' order by correo_hash)), '-')
      from public.correos_bloqueados`);
    const bloqueadosAntes = fotoBloqueados();
    let r8c = null;
    try { await crear(C8c, 'Admin Huerfano', { con: conRota }); } catch (e) { r8c = e.message; }
    ok('8c INSERT fallido → compensación: 0 filas en auth.users y en public.users',
      /compensación/.test(r8c ?? '')
        && sql(`select count(*) from auth.users where email = '${C8c}'`) === '0'
        && sql(`select count(*) from public.users where correo = '${C8c}'`) === '0', r8c?.slice(0, 100));
    // Misma expresión que el hook (…474:236) y el trigger (…474:209).
    const bloqueadosDespues = fotoBloqueados();
    const hash8c = sql(`select count(*) from public.correos_bloqueados
      where correo_hash = sha256(convert_to(lower(btrim('${C8c}')), 'UTF8'))`);
    ok('8c …y la compensación NO deja el correo en correos_bloqueados (tabla idéntica, hash ausente)',
      hash8c === '0' && bloqueadosAntes === bloqueadosDespues,
      `hash=${hash8c} antes=${bloqueadosAntes} después=${bloqueadosDespues}`);

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

    // 8f. COMPORTAMIENTO, con centinelas: ninguna salida del script (todo
    // console.*) ni el objeto de error COMPLETO (util.inspect, no solo
    // .message) contiene la secret key ni la contraseña de la base.
    const CENT_SEC = `sb_secret_CENTINELA8f${RUN}`;
    const CENT_PW = `CENTINELA-PW-8f-${RUN}`;
    const capturado = [];
    const original = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    const capturar = async (fn) => {
      for (const k of Object.keys(original)) {
        console[k] = (...a) => capturado.push(a.map((x) => (typeof x === 'string' ? x
          : inspect(x, { depth: null, showHidden: true }))).join(' '));
      }
      try { await fn(); return null; } catch (e) {
        capturado.push(inspect(e, { depth: null, showHidden: true }));
        return e;
      } finally { Object.assign(console, original); }
    };
    // (i) El camino --remoto entero: prompts → conexión → preflight, que falla
    // al resolver un pooler INEXISTENTE. Precondición: ese host no resuelve; si
    // algún día resolviera, se aborta ANTES de intentar un login contra un
    // pooler real con la contraseña centinela.
    const HOST_FALSO = 'aws-0-no-existe-probe.pooler.supabase.com';
    let resuelve = true;
    try { execFileSync('docker', ['exec', DB, 'getent', 'ahosts', HOST_FALSO], { stdio: 'ignore' }); }
    catch { resuelve = false; }
    if (resuelve) throw new Error(`8f: ${HOST_FALSO} resuelve; no se prueba contra un host real`);
    const respuestas = [REF_REMOTO, CENT_SEC, CENT_PW];
    const e8fi = await capturar(async () => {
      const conR = await conexionRemota({ poolerHost: HOST_FALSO, preguntar: async () => respuestas.shift() });
      await crear(`probe-admin-8f-${RUN}@rlvo.com.mx`, 'Admin Centinela', { con: conR });
    });
    // (ii) La llave centinela contra el GoTrue LOCAL: el preflight la rechaza
    // (listUsers → 401) antes de createUser; y createUser directo con ella
    // también da 401. Se capturan los dos objetos de error completos.
    const e8fii = await capturar(() => crear(`probe-admin-8f2-${RUN}@rlvo.com.mx`, 'Admin Centinela',
      { con: { ...conPg, secretKey: CENT_SEC } }));
    const cu = await createClient(E.API_URL, CENT_SEC, { auth: { persistSession: false, autoRefreshToken: false } })
      .auth.admin.createUser({ email: `probe-admin-8f3-${RUN}@rlvo.com.mx`, email_confirm: true });
    capturado.push(inspect(cu.error, { depth: null, showHidden: true }));
    const todo = capturado.join('\n');
    ok('8f (i) --remoto con pooler inexistente falla en el preflight',
      /^preflight: no se pudo consultar la base/.test(e8fi?.message ?? ''), e8fi?.message?.slice(0, 90));
    ok('8f (ii) la llave centinela da 401: en el preflight y en createUser directo',
      /^preflight: la secret key no sirve \(401/.test(e8fii?.message ?? '') && cu.error?.status === 401,
      `${e8fii?.message?.slice(0, 60)} · createUser ${cu.error?.status}`);
    ok('8f ninguna salida ni objeto de error contiene la secret key ni la contraseña centinela',
      capturado.length > 0 && !todo.includes(CENT_SEC) && !todo.includes(CENT_PW)
        && !todo.includes(`CENTINELA8f${RUN}`),
      `${capturado.length} capturas, ${todo.length} caracteres`);
    ok('8f …y no se creó ninguna cuenta', sql(`select count(*) from auth.users where email like 'probe-admin-8f%${RUN}@rlvo.com.mx'`) === '0');

    // 8g. Un correo guardado con MAYÚSCULAS en auth.users (sembrado por SQL):
    // las 6 comparaciones del script van con lower(u.email) (crear-admin.mjs:
    // 229 preflight, 313/332 activar, 374 su diagnóstico, 394 desactivar, 417
    // su diagnóstico). Cada sub-caso es la red de una de ellas.
    const G_MAYUS = `Probe-Admin-8G-${RUN}@RLVO.com.mx`;
    const G = G_MAYUS.toLowerCase();
    creadas.push(G_MAYUS, G);
    // Las columnas de tokens van en '' y no en NULL: GoTrue las lee como
    // texto, y una fila con NULL hace que `listUsers` (el preflight) responda
    // 500 "Database error finding users" (medido en la primera corrida).
    const idG = sql(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token,
        email_change, email_change_token_current, email_change_token_new, phone_change,
        phone_change_token, reauthentication_token)
      values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
              'authenticated', '${G_MAYUS}', '', now(), now(), now(), '', '', '', '', '', '', '', '')
      returning id`).split('\n')[0];
    sql(`insert into private.admins (user_id, nombre, activado_at) values ('${idG}', 'Admin Mayus', now())`);
    const antesG = totalAuth();
    let g1 = null;
    try { await crear(G, 'Admin Mayus', { con: conPg }); } catch (e) { g1 = e.message; }
    ok('8g1 (:229) crear en minúsculas sobre una cuenta en MAYÚSCULAS → preflight "ya existe", sin crear otra',
      /^preflight: .*ya existe/.test(g1 ?? '') && totalAuth() === antesG, g1?.slice(0, 90));
    let g2 = null;
    try { await desactivar(G, 'Prueba de mayúsculas (8g)', { con: conPg }); } catch (e) { g2 = e.message; }
    ok('8g2 (:394) desactivar encuentra la cuenta en MAYÚSCULAS',
      !g2 && sql(`select (activado_at is null)::text from private.admins where user_id = '${idG}'`) === 'true', g2?.slice(0, 90));
    let g3 = null;
    try { await desactivar(G, 'Prueba de mayúsculas (8g)', { con: conPg }); } catch (e) { g3 = e.message; }
    ok('8g3 (:417) el diagnóstico de desactivar también la encuentra', /admin=true activado=false/.test(g3 ?? ''), g3?.slice(0, 90));
    sql(`insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
         values (gen_random_uuid(), '${idG}', 'probe-8g', 'totp', 'verified', now(), now())`);
    capturado.length = 0;
    const g4 = await capturar(() => activar(G, { confirmado: true, con: conPg }));
    const lineaFactores = capturado.find((l) => l.startsWith('Factores TOTP')) ?? '';
    ok('8g4 (:313, :332) activar imprime su factor y la activa',
      !g4 && !/: ninguno$/.test(lineaFactores)
        && sql(`select (activado_at is not null)::text from private.admins where user_id = '${idG}'`) === 'true',
      g4?.message?.slice(0, 90) ?? lineaFactores);
    let g5 = null;
    try { await activar(G, { confirmado: true, con: conPg }); } catch (e) { g5 = e.message; }
    ok('8g5 (:374) el diagnóstico de activar también la encuentra', /admin=true activado=true/.test(g5 ?? ''), g5?.slice(0, 90));

    // -------------------------------------------------------------------
    // 9. Correos EXTERNOS de admin. Todo contra el stack local, por PG*.
    console.log('\n== 9. crear-admin --correo-externo: flag, confirmación, dominio universitario, cuenta existente ==');
    const contada = (con) => {
      let n = 0;
      return { con: { ...con, ejecutar: (q, v) => { n++; return con.ejecutar(q, v); } }, llamadas: () => n };
    };
    const espia = (valor) => { const e = { n: 0, fn: async () => { e.n++; return valor; } }; return e; };
    const fotoBase = () => `${totalAuth()}|${sql('select count(*) from private.admins')}|${sql('select count(*) from public.users')}`;

    // 9a. Sin el flag, un correo externo se rechaza y el mensaje dice cómo.
    const E9a = `probe-admin-9a-${RUN}@example.org`;
    creadas.push(E9a);
    const base9a = fotoBase();
    const cnt9a = contada(conPg);
    const sp9a = espia(E9a);
    let r9a = null;
    try { await crear(E9a, 'Admin Externo', { con: cnt9a.con, confirmarCorreo: sp9a.fn }); } catch (e) { r9a = e.message; }
    ok('9a un correo externo SIN --correo-externo se rechaza (y el mensaje menciona el flag)',
      /--correo-externo/.test(r9a ?? '') && fotoBase() === base9a && cnt9a.llamadas() === 0 && sp9a.n === 0,
      `${r9a?.slice(0, 70)} · llamadas a la base=${cnt9a.llamadas()}`);

    // 9b. Con el flag, una confirmación que NO coincide no toca nada: ni la
    // base ni la red (el preflight no llega a correr).
    const base9b = fotoBase();
    const cnt9b = contada(conPg);
    const sp9b = espia('otro-correo@example.org');
    let r9b = null;
    try { await crear(E9a, 'Admin Externo', { con: cnt9b.con, correoExterno: true, confirmarCorreo: sp9b.fn }); }
    catch (e) { r9b = e.message; }
    ok('9b --correo-externo con una confirmación distinta → "no coincide", sin llamadas a la base',
      /confirmación del correo no coincide/.test(r9b ?? '') && sp9b.n === 1 && cnt9b.llamadas() === 0 && fotoBase() === base9b,
      `${r9b?.slice(0, 70)} · confirmaciones pedidas=${sp9b.n} · llamadas a la base=${cnt9b.llamadas()}`);
    // …y una confirmación vacía tampoco pasa (un Enter a ciegas).
    let r9b2 = null;
    try { await crear(E9a, 'Admin Externo', { con: conPg, correoExterno: true, confirmarCorreo: async () => '' }); }
    catch (e) { r9b2 = e.message; }
    ok('9b una confirmación vacía tampoco pasa', /confirmación del correo no coincide/.test(r9b2 ?? '') && fotoBase() === base9b);

    // 9c. Con el flag y la confirmación correcta: flujo completo y
    // activar/desactivar aceptan el correo externo (sin flag).
    const sp9c = espia(E9a.toUpperCase()); // la comparación normaliza mayúsculas
    let r9c = null;
    try { await crear(E9a, 'Admin Externo', { con: conPg, correoExterno: true, confirmarCorreo: sp9c.fn }); }
    catch (e) { r9c = e.message; }
    ok('9c crear con el flag y la confirmación correcta termina sin error', !r9c, r9c?.slice(0, 100));
    ok('9c …la cuenta existe, sin activar, y su fila de public.users NO tiene universidad',
      sql(`select count(*) from auth.users where email = '${E9a}'`) === '1'
        && sql(`select (activado_at is null)::text from private.admins a join auth.users u on u.id = a.user_id where u.email = '${E9a}'`) === 'true'
        && sql(`select (universidad_id is null)::text from public.users where correo = '${E9a}'`) === 'true');
    const cod9 = await codigoNuevo(E9a, 0);
    ok('9c …y le llegó el código de recuperación al correo externo', Boolean(cod9));
    const c9 = cli();
    await c9.auth.verifyOtp({ type: 'recovery', email: E9a, token: cod9 });
    await c9.auth.updateUser({ password: PASS });
    const c9b = cli();
    await c9b.auth.signInWithPassword({ email: E9a, password: PASS });
    const en9 = await c9b.auth.mfa.enroll({ factorType: 'totp' });
    const v9 = await c9b.auth.mfa.challengeAndVerify({ factorId: en9.data.id, code: totp(en9.data.totp.secret) });
    ok('9c enrolar el TOTP del correo externo', !en9.error && !v9.error, en9.error?.message ?? v9.error?.message);
    let a9 = null;
    try { await activar(E9a, { confirmado: true, con: conPg }); } catch (e) { a9 = e.message; }
    const s9 = await c9b.schema('admin').rpc('sesion');
    ok('9c activar acepta el correo externo (sin flag) y la cuenta es admin', !a9 && s9.data?.es_admin === true, a9 ?? JSON.stringify(s9.data ?? s9.error));
    const id9 = sql(`select id from auth.users where email = '${E9a}'`);
    let d9 = null;
    try { await desactivar(E9a, 'Prueba del correo externo (9c)', { con: conPg }); } catch (e) { d9 = e.message; }
    ok('9c desactivar acepta el correo externo y lo audita',
      !d9 && sql(`select (activado_at is null)::text from private.admins where user_id = '${id9}'`) === 'true'
        && sql(`select count(*) from private.admin_acciones where accion = 'desactivar_admin' and objetivo_id = '${id9}'`) === '1', d9?.slice(0, 100));
    ok('9c el alta de un admin externo no tocó el registro de usuarios normales (universidad_dominios igual)',
      sql(`select string_agg(dominio, ',' order by dominio) from public.universidad_dominios`) === dominiosAntes9);

    // 9d. Un dominio de universidad_dominios se rechaza aun con flag y confirmación.
    const dominioUniv = sql(`select dominio from public.universidad_dominios order by dominio limit 1`);
    const E9d = `probe-admin-9d-${RUN}@${dominioUniv}`;
    creadas.push(E9d);
    const base9d = fotoBase();
    let r9d = null;
    try { await crear(E9d, 'Admin Alumno', { con: conPg, correoExterno: true, confirmarCorreo: async () => E9d }); }
    catch (e) { r9d = e.message; }
    ok(`9d un correo de un dominio universitario (${dominioUniv}) se rechaza aun con flag y confirmación`,
      /^preflight: .*universidad participante/.test(r9d ?? '') && fotoBase() === base9d, r9d?.slice(0, 110));

    // 9e. Una cuenta existente (del marketplace) NO se convierte en admin.
    const E9e = `probe-admin-9e-${RUN}@gmail.com`;
    creadas.push(E9e);
    sql(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token,
        email_change, email_change_token_current, email_change_token_new, phone_change,
        phone_change_token, reauthentication_token)
      values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
              'authenticated', '${E9e}', '', now(), now(), now(), '', '', '', '', '', '', '', '')`);
    const perfilAntes = sql(`select count(*) || ':' || coalesce(max(estado::text), '-') from public.users where correo = '${E9e}'`);
    const base9e = fotoBase();
    let r9e = null;
    try { await crear(E9e, 'Admin Existente', { con: conPg, correoExterno: true, confirmarCorreo: async () => E9e }); }
    catch (e) { r9e = e.message; }
    ok('9e una cuenta existente NO se convierte en admin: se detiene en el preflight',
      /^preflight: .*NO se convierte en admin/.test(r9e ?? '')
        && sql(`select count(*) from private.admins a join auth.users u on u.id = a.user_id where u.email = '${E9e}'`) === '0'
        && fotoBase() === base9e
        && sql(`select count(*) || ':' || coalesce(max(estado::text), '-') from public.users where correo = '${E9e}'`) === perfilAntes,
      r9e?.slice(0, 120));

    // 9f. Un correo mal formado se rechaza antes de cualquier llamada.
    const malos = ['a@b', 'a..b@example.org', '@example.org', 'a b@example.org', '.a@example.org', 'a.@example.org',
      'a@-example.org', 'a@example', 'a@example.o', 'no-es-un-correo', `${'x'.repeat(250)}@example.org`];
    const rechazados = [];
    for (const m of malos) {
      const sp = espia(m); const cnt = contada(conPg);
      try { await crear(m, 'Admin Malo', { con: cnt.con, correoExterno: true, confirmarCorreo: sp.fn }); rechazados.push(`ACEPTÓ ${m.slice(0, 20)}`); }
      catch (e) { if (sp.n !== 0 || cnt.llamadas() !== 0 || !/correo inválido/.test(e.message)) rechazados.push(`${m.slice(0, 20)}: ${e.message.slice(0, 40)}`); }
    }
    ok(`9f ${malos.length} correos mal formados se rechazan con "correo inválido", sin confirmación ni llamadas`,
      rechazados.length === 0 && fotoBase() === base9e, rechazados.join(' | '));
    // Y los bien formados poco comunes sí pasan la validación (sin crear nada: se aborta en la confirmación).
    const raros = ["o'brien+x@example.org", 'a.b-c_d%e@sub.example.co.uk', 'x@a-b.example.org'];
    creadas.push(...raros, ...malos.filter((m) => m.length < 100)); // por si un control las crea: el finally las borra
    const aceptados = [];
    for (const m of raros) {
      let msg = null;
      try { await crear(m, 'Admin Raro', { con: conPg, correoExterno: true, confirmarCorreo: async () => 'abortar' }); } catch (e) { msg = e.message; }
      if (!/confirmación del correo no coincide/.test(msg ?? '')) aceptados.push(`${m}: ${msg?.slice(0, 40)}`);
    }
    ok('9f correos válidos poco comunes pasan la validación (y se detienen en la confirmación)', aceptados.length === 0 && fotoBase() === base9e, aceptados.join(' | '));

    // 9g. Un @rlvo.com.mx no pide confirmación (y el flag no la vuelve obligatoria).
    const E9g = `probe-admin-9g-${RUN}@rlvo.com.mx`;
    creadas.push(E9g);
    const sp9g = espia('no-debería-pedirse');
    let r9g = null;
    try { await crear(E9g, 'Admin Rlvo', { con: conPg, confirmarCorreo: sp9g.fn }); } catch (e) { r9g = e.message; }
    ok('9g un @rlvo.com.mx se crea sin pedir confirmación', !r9g && sp9g.n === 0, r9g?.slice(0, 100) ?? `confirmaciones pedidas=${sp9g.n}`);
  } finally {
    for (const c of creadas) {
      sql(`delete from auth.users where email = '${c.replace(/'/g, "''")}'`);
    }
    // Caso 10: la universidad de prueba (cascade a sus campus y dominios).
    sql(`delete from public.universidades where nombre like 'Probe Cat ${RUN}%'`);
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
