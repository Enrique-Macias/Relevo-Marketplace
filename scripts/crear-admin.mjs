#!/usr/bin/env node
// Alta, activación y desactivación de admins del panel (RF-17).
//
//   node scripts/crear-admin.mjs crear      [--remoto --pooler-host H] <correo@rlvo.com.mx> <Nombre>
//   node scripts/crear-admin.mjs activar    [--remoto --pooler-host H] <correo@rlvo.com.mx>
//   node scripts/crear-admin.mjs desactivar [--remoto --pooler-host H] <correo@rlvo.com.mx> --motivo "<3-500>"
//
// Sin `--remoto` corre SOLO contra el stack local (como en las Olas 1 y 2).
// Con `--remoto` (Ola 3) habla con el proyecto de producción, y lo corre el
// admin técnico en su terminal, nunca una IA (las credenciales no se le dan):
//   · pide que se teclee el ref del proyecto (`ukxfnydfhmryrzhdqkvj`);
//   · pide la SECRET KEY y la CONTRASEÑA DE LA BASE con un prompt sin eco: solo
//     viven en la memoria de este proceso, nunca en argv, en disco ni en el
//     historial del shell. Usa una secret key TEMPORAL creada para esto en
//     Settings → API Keys, y bórrala al terminar;
//   · psql corre dentro del contenedor local de Postgres (la máquina no tiene
//     psql) contra el SESSION POOLER (`--pooler-host`, puerto 5432): la
//     conexión directa es solo IPv6 y Docker no tiene IPv6 (medido, Ola 3).
//     La contraseña viaja como `docker exec -e PGPASSWORD` SIN valor: Docker la
//     hereda del entorno de este proceso, así que no aparece en `ps`;
//   · la publishable key se lee del `.env.local` de la app, solo si su URL es
//     la del mismo ref (no es secreta).
//
// POR QUÉ `crear` Y NO "invitar": medido en el Paso 0 de la Ola 1,
// `POST /auth/v1/invite` (auth.admin.inviteUserByEmail) SÍ pasa por el Auth
// Hook de dominios y @rlvo.com.mx sale 403 `dominio_no_participante`; en
// cambio `POST /auth/v1/admin/users` no pasa por él (200) — medido en LOCAL
// (GoTrue v2.196.0). Remoto corre v2.197.0: el primer `crear --remoto` es la
// medición; si sale 403, el hook falló cerrado y no quedó nada.
//
//   1. `crear`: PREFLIGHT (base y llaves, sin escribir nada), después la cuenta
//      nace por `admin/users` (sin contraseña, correo confirmado), se registra
//      en `private.admins` con `activado_at` NULL y se manda el código de
//      RECUPERACIÓN. Si el INSERT falla, se COMPENSA borrando la cuenta recién
//      creada; si falla el correo, la persona lo pide sola en el panel.
//   2. `activar`: imprime cuándo se creó el factor TOTP (para cotejarlo en la
//      llamada), exige confirmar POR OTRO CANAL y exactamente UN factor TOTP
//      verificado, creado DESPUÉS de la última desactivación auditada (o del
//      alta, si nunca se desactivó). Hasta aquí `is_admin()` es false aunque la
//      cuenta tenga aal2.
//   3. `desactivar`: `activado_at = null` y la fila `desactivar_admin` en la
//      MISMA sentencia (20260930000479). Surte efecto en la request siguiente.
//      Reactivar exige borrar el factor y enrolar uno nuevo (paso 2).
//
// SIN INTERPOLAR NADA: correo, nombre y motivo se validan aquí y viajan a psql
// como variables (`-v correo=…`), que el SQL usa como `:'correo'` (psql las
// cita como literal). El proceso se lanza con `execFileSync` y un arreglo de
// argumentos: no hay shell. Y el SQL NO lleva ningún dollar-quote (ni `DO`
// ni cuerpos de función), porque psql NO sustituye `:'var'` dentro de uno: el
// nombre llegaría literal `:'nombre'`. `probe-admin.mjs` (caso 6) lo vigila
// con un nombre con comilla simple y con un grep de dos signos de dólar
// seguidos sobre este archivo (por eso ni este comentario los escribe).
//
// La auditoría de `activar` y `desactivar` no tiene JWT de ningún admin: lleva
// el centinela `00000000-0000-0000-0000-000000000000` y
// `admin_correo = 'script:crear-admin.mjs'` (20260930000477).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { createClient } from '@supabase/supabase-js';
import { normalizarNombre, nombreValido } from '../src/lib/validacion-perfil.ts';

const DB = 'supabase_db_relevo-marketplace';
export const REF_REMOTO = 'ukxfnydfhmryrzhdqkvj';
const CORREO_RE = /^[a-z0-9._%+'-]+@rlvo\.com\.mx$/;
const MOTIVO_ACTIVAR = 'Activación tras confirmar por otro canal el enrolamiento TOTP';
const SIN_ESPERA = { auth: { persistSession: false, autoRefreshToken: false } };

export function validarCorreo(crudo) {
  const correo = String(crudo ?? '').trim().toLowerCase();
  if (correo.length > 254 || !CORREO_RE.test(correo)) {
    throw new Error(`correo inválido (se espera nombre@rlvo.com.mx): ${JSON.stringify(crudo)}`);
  }
  return correo;
}

export function validarNombre(crudo) {
  const nombre = normalizarNombre(String(crudo ?? ''));
  if (!nombreValido(nombre)) {
    throw new Error(`nombre inválido (letras y separadores, 2-50): ${JSON.stringify(crudo)}`);
  }
  return nombre;
}

/** La misma regla que `admin_acciones_motivo_valido`: 3-500 tras btrim. */
export function validarMotivo(crudo) {
  const motivo = String(crudo ?? '');
  const n = motivo.trim().length;
  if (n < 3 || n > 500 || /[\r\n]/.test(motivo)) {
    throw new Error('motivo inválido (3-500 caracteres, una sola línea)');
  }
  return motivo;
}

// ---------------------------------------------------------------------------
// Conexiones. Una conexión es { etiqueta, apiUrl, secretKey, publishableKey,
// ejecutar(sqlFijo, vars) }. `crear`/`activar`/`desactivar` solo hablan con
// ella, así que el probe ejercita el camino de `--remoto` contra el stack
// local inyectando una conexión por PG* (y puede envolver `ejecutar`).
// ---------------------------------------------------------------------------

function argsPsql(vars) {
  // `-q` es portante: sin él, psql imprime también la etiqueta del comando
  // (`INSERT 0 0`), y `activar` la leería como "se activó" aunque el
  // `returning` no devolviera nada (lo cazó probe-admin.mjs, caso 2).
  const args = ['psql', '-v', 'ON_ERROR_STOP=1', '-q', '-At'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  return args;
}

/** Stack local: psql por el socket del contenedor, como en las Olas 1 y 2. */
export function conexionLocal() {
  const raw = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  const out = {};
  for (const line of raw.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, '');
  }
  const url = new URL(out.API_URL);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`el stack local no está en localhost (API_URL = ${out.API_URL})`);
  }
  return {
    etiqueta: `local (${out.API_URL})`,
    apiUrl: out.API_URL,
    secretKey: out.SECRET_KEY,
    publishableKey: out.PUBLISHABLE_KEY,
    ejecutar: (sqlFijo, vars = {}) => execFileSync('docker',
      ['exec', '-i', DB, ...argsPsql(vars), '-U', 'postgres', '-d', 'postgres'],
      { input: sqlFijo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(),
  };
}

/**
 * psql por PG* (el camino de `--remoto`). Los valores van en el ENTORNO del
 * proceso hijo y `docker exec -e NOMBRE` (sin `=valor`) los hereda de ahí:
 * nada de esto aparece en argv.
 */
export function conexionPg({ etiqueta, apiUrl, secretKey, publishableKey, pg }) {
  const nombres = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE',
    'PGCONNECT_TIMEOUT'];
  const env = {
    ...process.env,
    PGHOST: pg.host, PGPORT: String(pg.port), PGUSER: pg.user, PGPASSWORD: pg.password,
    PGDATABASE: pg.database ?? 'postgres', PGSSLMODE: pg.sslmode ?? 'require',
    PGCONNECT_TIMEOUT: '10',
  };
  return {
    etiqueta,
    apiUrl, secretKey, publishableKey,
    ejecutar: (sqlFijo, vars = {}) => execFileSync('docker',
      ['exec', '-i', ...nombres.flatMap((n) => ['-e', n]), DB, ...argsPsql(vars)],
      { input: sqlFijo, encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'] }).trim(),
  };
}

function leerPublishableDeLaApp(ref) {
  let txt;
  try { txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8'); } catch {
    throw new Error('no se encontró .env.local de la app para leer la publishable key');
  }
  const val = (k) => txt.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '');
  const url = val('EXPO_PUBLIC_SUPABASE_URL');
  const key = val('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if (!url || new URL(url).hostname !== `${ref}.supabase.co` || !key?.startsWith('sb_publishable_')) {
    throw new Error(`.env.local de la app no apunta a ${ref}: no se puede leer la publishable key`);
  }
  return key;
}

/**
 * Conexión a producción. `preguntar(texto, { oculto })` es inyectable (el
 * probe la sustituye); por defecto lee de la terminal, sin eco si `oculto`.
 * El ref se confirma ANTES de pedir ninguna credencial ni tocar la red.
 */
export async function conexionRemota({ poolerHost, preguntar = preguntarTerminal }) {
  const ref = (await preguntar(`Teclea el ref del proyecto remoto para confirmar: `)).trim();
  if (ref !== REF_REMOTO) throw new Error('el ref no coincide: no se toca nada');
  if (!poolerHost || !/^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(poolerHost)) {
    throw new Error('falta --pooler-host <aws-….pooler.supabase.com> (Dashboard → Connect → Session pooler)');
  }
  const publishableKey = leerPublishableDeLaApp(ref);
  const secretKey = (await preguntar('Secret key TEMPORAL (no se muestra): ', { oculto: true })).trim();
  if (!secretKey.startsWith('sb_secret_')) throw new Error('eso no parece una secret key (sb_secret_…)');
  const password = await preguntar('Contraseña de la base (no se muestra): ', { oculto: true });
  if (!password) throw new Error('falta la contraseña de la base');
  const user = `postgres.${ref}`;
  console.log(`Remoto: https://${ref}.supabase.co · psql ${user}@${poolerHost}:5432 (session pooler)`);
  return conexionPg({
    etiqueta: `remoto (${ref})`,
    apiUrl: `https://${ref}.supabase.co`, secretKey, publishableKey,
    pg: { host: poolerHost, port: 5432, user, password, sslmode: 'require' },
  });
}

async function preguntarTerminal(texto, { oculto = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (oculto) {
    process.stdout.write(texto);
    rl._writeToOutput = () => {};
    const r = await rl.question('');
    rl.close();
    process.stdout.write('\n');
    return r;
  }
  const r = await rl.question(texto);
  rl.close();
  return r;
}

// ---------------------------------------------------------------------------
// Preflight: comprueba base y llaves SIN escribir nada. Si falla, no se crea
// ni se modifica nada.
// ---------------------------------------------------------------------------

export async function preflight(con, correo, { debeExistir }) {
  let fila;
  try {
    fila = con.ejecutar(`
      select current_user,
             has_table_privilege('private.admins', 'INSERT, UPDATE'),
             has_table_privilege('private.admin_acciones', 'INSERT'),
             exists (select 1 from supabase_migrations.schema_migrations
                      where version = '20260930000479'),
             coalesce((select position('desactivar_admin' in pg_get_constraintdef(c.oid)) > 0
                         from pg_constraint c
                        where c.conname = 'admin_acciones_accion_check'), false),
             exists (select 1 from auth.users where lower(email) = :'correo');`,
    { correo });
  } catch (e) {
    throw new Error(`preflight: no se pudo consultar la base (${String(e.stderr ?? e.message).trim().split('\n')[0]})`);
  }
  const [usuario, admins, acciones, mig479, accionCheck, existe] = fila.split('|');
  const fallas = [];
  if (usuario !== 'postgres') fallas.push(`current_user = ${usuario}`);
  if (admins !== 't') fallas.push('sin INSERT/UPDATE en private.admins');
  if (acciones !== 't') fallas.push('sin INSERT en private.admin_acciones');
  if (mig479 !== 't') fallas.push('falta la migración 20260930000479');
  if (accionCheck !== 't') fallas.push('admin_acciones_accion_check sin desactivar_admin');
  if (debeExistir && existe !== 't') fallas.push(`no existe la cuenta ${correo}`);
  if (!debeExistir && existe === 't') fallas.push(`ya existe una cuenta ${correo}`);
  if (fallas.length) throw new Error(`preflight: ${fallas.join('; ')}`);

  const adm = createClient(con.apiUrl, con.secretKey, SIN_ESPERA);
  const lu = await adm.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (lu.error) throw new Error(`preflight: la secret key no sirve (${lu.error.status ?? ''} ${lu.error.message})`);
  const h = await fetch(`${con.apiUrl}/auth/v1/health`, { headers: { apikey: con.publishableKey } });
  if (h.status !== 200) throw new Error(`preflight: la publishable key no sirve (health ${h.status})`);
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

async function crear(correoCrudo, nombreCrudo, { con } = {}) {
  const correo = validarCorreo(correoCrudo);
  const nombre = validarNombre(nombreCrudo);
  con ??= conexionLocal();
  await preflight(con, correo, { debeExistir: false });

  const admin = createClient(con.apiUrl, con.secretKey, SIN_ESPERA);
  const { data, error } = await admin.auth.admin.createUser({ email: correo, email_confirm: true });
  if (error) throw new Error(`createUser: ${error.status} ${error.message}`);
  const id = data.user.id;

  try {
    con.ejecutar(`insert into private.admins (user_id, nombre, created_by)
                  select id, :'nombre', null from auth.users where id = :'id'::uuid;`,
    { id, nombre });
  } catch (e) {
    // COMPENSACIÓN: la cuenta existe (y el trigger de alta ya le creó su fila
    // en public.users) pero no es admin. Se borra entera: la cascada se lleva
    // public.users, y como no está suspendida no deja hash en
    // correos_bloqueados.
    const insertMsg = String(e.stderr ?? e.message).trim().split('\n')[0];
    const del = await admin.auth.admin.deleteUser(id);
    if (del.error) {
      throw new Error(`el INSERT en private.admins falló (${insertMsg}) y la compensación TAMBIÉN `
        + `(${del.error.message}). Queda una cuenta huérfana ${id}: bórrala en Dashboard → `
        + 'Authentication → Users y confirma 0 filas con ese id en auth.users y public.users.');
    }
    throw new Error(`el INSERT en private.admins falló (${insertMsg}); se borró la cuenta ${id} `
      + '(compensación): no quedó nada.');
  }

  const pub = createClient(con.apiUrl, con.publishableKey, SIN_ESPERA);
  const rec = await pub.auth.resetPasswordForEmail(correo);
  const correoEnviado = !rec.error;

  console.log(`Cuenta creada: ${correo} (${id}), SIN activar. [${con.etiqueta}]`);
  if (correoEnviado) {
    console.log('Le llegó un código de 6 dígitos: con él fija su contraseña en el panel');
    console.log('("Primera vez u olvidé mi contraseña") y enrola su app autenticadora.');
  } else {
    console.log(`AVISO: no se pudo mandar el código (${rec.error.status ?? ''} ${rec.error.message}).`);
    console.log('La cuenta SÍ quedó creada: la persona puede pedirlo ella misma en el panel,');
    console.log('"Primera vez u olvidé mi contraseña". Si tampoco llega, revisa el SMTP.');
  }
  console.log('Después, confirma POR OTRO CANAL que fue esa persona y corre `activar`.');
  return { id, correoEnviado };
}

async function activar(correoCrudo, { confirmado, con } = {}) {
  const correo = validarCorreo(correoCrudo);
  con ??= conexionLocal();
  await preflight(con, correo, { debeExistir: true });

  const factores = con.ejecutar(`
    select coalesce(string_agg(to_char(f.created_at at time zone 'America/Monterrey',
                                       'YYYY-MM-DD HH24:MI:SS'), ', ' order by f.created_at), 'ninguno')
      from auth.mfa_factors f join auth.users u on u.id = f.user_id
     where lower(u.email) = :'correo' and f.factor_type = 'totp' and f.status = 'verified';`,
  { correo });
  console.log(`Factores TOTP verificados de ${correo} (hora de Monterrey): ${factores}`);

  if (!confirmado) {
    const r = await preguntarTerminal(
      `¿Confirmaste POR OTRO CANAL (llamada) que ${correo} enroló su TOTP a esa hora? Escribe SI: `);
    if (r.trim() !== 'SI') throw new Error('activación cancelada');
  }

  // Una sola sentencia: activa y audita en la misma transacción, o ninguna.
  // El factor tiene que ser posterior a la ÚLTIMA desactivación auditada (o al
  // alta, si nunca se desactivó): así, tras un reset de MFA, el factor viejo
  // no reactiva la cuenta (probe-admin, caso 8e).
  const id = con.ejecutar(`
    with a as (
      update private.admins ad
         set activado_at = now()
        from auth.users u
       where lower(u.email) = :'correo'
         and ad.user_id = u.id
         and ad.activado_at is null
         and (select count(*) from auth.mfa_factors f
               where f.user_id = u.id and f.factor_type = 'totp'
                 and f.status = 'verified') = 1
         and (select count(*) from auth.mfa_factors f
               where f.user_id = u.id and f.factor_type = 'totp'
                 and f.status = 'verified'
                 and f.created_at > coalesce(
                       (select max(aa.created_at) from private.admin_acciones aa
                         where aa.accion = 'desactivar_admin'
                           and aa.objetivo_tipo = 'admin'
                           and aa.objetivo_id = u.id::text),
                       ad.created_at)) = 1
      returning ad.user_id, ad.activado_at
    )
    insert into private.admin_acciones
      (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, antes, despues, motivo)
    select '00000000-0000-0000-0000-000000000000', 'script:crear-admin.mjs',
           'activar_admin', 'admin', a.user_id::text,
           jsonb_build_object('activado_at', null),
           jsonb_build_object('activado_at', a.activado_at),
           :'motivo'
      from a
    returning objetivo_id;`,
  { correo, motivo: MOTIVO_ACTIVAR });

  if (!id) {
    const diag = con.ejecutar(`
      select coalesce((select 'admin=' || (ad.user_id is not null)
                        || ' activado=' || (ad.activado_at is not null)
                        || ' totp_verificados=' || (select count(*) from auth.mfa_factors f
                             where f.user_id = u.id and f.factor_type = 'totp'
                               and f.status = 'verified')
                        || ' ultima_desactivacion=' || coalesce(
                             (select max(aa.created_at)::text from private.admin_acciones aa
                               where aa.accion = 'desactivar_admin'
                                 and aa.objetivo_tipo = 'admin'
                                 and aa.objetivo_id = u.id::text), 'nunca')
                         from auth.users u
                         left join private.admins ad on ad.user_id = u.id
                        where lower(u.email) = :'correo'), 'sin cuenta');`,
    { correo });
    throw new Error(`no se activó (${diag}). Se exige: admin sin activar y exactamente 1 TOTP `
      + 'verificado creado después del alta y de la última desactivación.');
  }
  console.log(`Activado: ${correo} (${id}). Auditado como activar_admin. [${con.etiqueta}]`);
}

async function desactivar(correoCrudo, motivoCrudo, { con } = {}) {
  const correo = validarCorreo(correoCrudo);
  const motivo = validarMotivo(motivoCrudo);
  con ??= conexionLocal();
  await preflight(con, correo, { debeExistir: true });

  // Una sola sentencia: desactiva y audita, o ninguna. `prev` guarda el
  // `activado_at` de antes (un UPDATE … RETURNING solo ve el valor nuevo).
  const id = con.ejecutar(`
    with prev as (
      select ad.user_id, ad.activado_at
        from private.admins ad join auth.users u on u.id = ad.user_id
       where lower(u.email) = :'correo' and ad.activado_at is not null
         for update of ad
    ), a as (
      update private.admins ad set activado_at = null
        from prev where ad.user_id = prev.user_id
      returning ad.user_id, prev.activado_at as antes
    )
    insert into private.admin_acciones
      (admin_id, admin_correo, accion, objetivo_tipo, objetivo_id, antes, despues, motivo)
    select '00000000-0000-0000-0000-000000000000', 'script:crear-admin.mjs',
           'desactivar_admin', 'admin', a.user_id::text,
           jsonb_build_object('activado_at', a.antes),
           jsonb_build_object('activado_at', null), :'motivo'
      from a
    returning objetivo_id;`,
  { correo, motivo });

  if (!id) {
    const diag = con.ejecutar(`
      select coalesce((select 'admin=' || (ad.user_id is not null)
                        || ' activado=' || (ad.activado_at is not null)
                         from auth.users u
                         left join private.admins ad on ad.user_id = u.id
                        where lower(u.email) = :'correo'), 'sin cuenta');`,
    { correo });
    throw new Error(`no se desactivó (${diag}). Se exige: admin activado.`);
  }
  console.log(`Desactivado: ${correo} (${id}). Auditado como desactivar_admin. [${con.etiqueta}]`);
  console.log('Para reactivarlo: borra su factor MFA (Dashboard → Authentication → Users),');
  console.log('que enrole uno nuevo, confírmalo por otro canal y corre `activar`.');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parsear(argv) {
  const pos = [];
  const op = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--remoto') op.remoto = true;
    else if (a === '--pooler-host') op.poolerHost = argv[++i];
    else if (a === '--motivo') op.motivo = argv[++i];
    else pos.push(a);
  }
  return { pos, op };
}

const esMain = import.meta.url === `file://${process.argv[1]}`;
if (esMain) {
  const [cmd, ...resto] = process.argv.slice(2);
  const { pos: [a, b], op } = parsear(resto);
  const uso = 'uso: crear-admin.mjs crear <correo> <Nombre> | activar <correo> | '
    + 'desactivar <correo> --motivo "<3-500>"   (más --remoto --pooler-host <host> para producción)';
  try {
    // Validar ANTES de pedir credenciales: un typo no debe costar la llave.
    if (cmd === 'crear' && a && b) { validarCorreo(a); validarNombre(b); }
    else if (cmd === 'activar' && a) validarCorreo(a);
    else if (cmd === 'desactivar' && a) { validarCorreo(a); validarMotivo(op.motivo); }
    else { console.error(uso); process.exit(2); }

    const con = op.remoto ? await conexionRemota({ poolerHost: op.poolerHost }) : conexionLocal();
    if (cmd === 'crear') {
      const r = await crear(a, b, { con });
      if (!r.correoEnviado) process.exitCode = 1;
    } else if (cmd === 'activar') await activar(a, { con });
    else await desactivar(a, op.motivo, { con });
  } catch (e) {
    console.error(`crear-admin: ${e.message}`);
    process.exit(1);
  }
}

export { crear, activar, desactivar };
