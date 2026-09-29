#!/usr/bin/env node
// Alta de admins del panel (RF-17, Ola 1). SOLO STACK LOCAL hasta la Ola 3,
// donde se decide cómo llega esto a remoto.
//
//   node scripts/crear-admin.mjs crear   <correo@rlvo.com.mx> <Nombre>
//   node scripts/crear-admin.mjs activar <correo@rlvo.com.mx>
//
// POR QUÉ `crear` Y NO "invitar": medido en el Paso 0 de la Ola 1,
// `POST /auth/v1/invite` (auth.admin.inviteUserByEmail) SÍ pasa por el Auth
// Hook de dominios y @rlvo.com.mx sale 403 `dominio_no_participante`; en
// cambio `POST /auth/v1/admin/users` no pasa por él (200). Así que:
//
//   1. `crear`: la cuenta nace por `admin/users` (sin contraseña, correo
//      confirmado), se registra en `private.admins` con `activado_at` NULL, y
//      se le manda el correo de RECUPERACIÓN: la persona teclea ese código en
//      el panel ("Fijar contraseña"), fija su contraseña y enrola su TOTP.
//   2. `activar`: exige exactamente UN factor TOTP verificado, creado DESPUÉS
//      del alta, y que quien corre esto confirme POR OTRO CANAL (una llamada)
//      que la persona real fue quien enroló. Hasta aquí `is_admin()` es false
//      aunque la cuenta ya tenga aal2: quien interceptara el código podría
//      fijar contraseña y enrolar SU propio TOTP, pero no vería nada.
//
// SIN INTERPOLAR NADA: correo y nombre se validan aquí y viajan a psql como
// variables (`-v correo=…`), que el SQL usa como `:'correo'` (psql las cita
// como literal). El proceso se lanza con `execFileSync` y un arreglo de
// argumentos: no hay shell. Y el SQL NO lleva ningún dollar-quote (ni `DO`
// ni cuerpos de función), porque psql NO sustituye `:'var'` dentro de uno: el
// nombre llegaría literal `:'nombre'`. `probe-admin.mjs` (caso 6) lo vigila
// con un nombre con comilla simple y con un grep de dos signos de dólar
// seguidos sobre este archivo (por eso ni este comentario los escribe).
//
// La fila de auditoría de `activar` no tiene JWT de ningún admin: lleva el
// centinela `00000000-0000-0000-0000-000000000000` y
// `admin_correo = 'script:crear-admin.mjs'` (20260930000477).

import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { createClient } from '@supabase/supabase-js';
import { normalizarNombre, nombreValido } from '../src/lib/validacion-perfil.ts';

const DB = 'supabase_db_relevo-marketplace';
const CORREO_RE = /^[a-z0-9._%+'-]+@rlvo\.com\.mx$/;
const MOTIVO_ACTIVAR = 'Activación tras confirmar por otro canal el enrolamiento TOTP';

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

function env() {
  const raw = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  const out = {};
  for (const line of raw.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, '');
  }
  const url = new URL(out.API_URL);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error(`solo stack local (API_URL = ${out.API_URL}); remoto se decide en la Ola 3`);
  }
  return out;
}

/**
 * SQL FIJO por stdin; los valores, solo como variables de psql. `-q` es
 * portante: sin él, psql imprime también la etiqueta del comando
 * (`INSERT 0 0`), y `activar` la leería como "se activó" aunque el
 * `returning` no devolviera nada (lo cazó probe-admin.mjs, caso 2).
 */
export function psql(sqlFijo, vars) {
  const args = ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-q', '-At'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  return execFileSync('docker', args, { input: sqlFijo, encoding: 'utf8' }).trim();
}

async function crear(correoCrudo, nombreCrudo) {
  const correo = validarCorreo(correoCrudo);
  const nombre = validarNombre(nombreCrudo);
  const E = env();
  const admin = createClient(E.API_URL, E.SECRET_KEY, { auth: { persistSession: false } });

  const { data, error } = await admin.auth.admin.createUser({ email: correo, email_confirm: true });
  if (error) throw new Error(`createUser: ${error.status} ${error.message}`);
  const id = data.user.id;

  psql(`insert into private.admins (user_id, nombre, created_by)
        select id, :'nombre', null from auth.users where id = :'id'::uuid;`,
  { id, nombre });

  const pub = createClient(E.API_URL, E.PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const rec = await pub.auth.resetPasswordForEmail(correo);
  if (rec.error) throw new Error(`resetPasswordForEmail: ${rec.error.status} ${rec.error.message}`);

  console.log(`Cuenta creada: ${correo} (${id}), SIN activar.`);
  console.log('Le llegó un código de 6 dígitos: con él fija su contraseña en el panel');
  console.log('("Fijar contraseña") y enrola su app autenticadora. Después, confirma por');
  console.log(`otro canal que fue esa persona y corre: node scripts/crear-admin.mjs activar ${correo}`);
}

async function activar(correoCrudo, { confirmado } = {}) {
  const correo = validarCorreo(correoCrudo);
  env();

  if (!confirmado) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const r = await rl.question(
      `¿Confirmaste POR OTRO CANAL (llamada) que ${correo} enroló su TOTP? Escribe SI: `);
    rl.close();
    if (r.trim() !== 'SI') throw new Error('activación cancelada');
  }

  // Una sola sentencia: activa y audita en la misma transacción, o ninguna.
  const id = psql(`
    with a as (
      update private.admins ad
         set activado_at = now()
        from auth.users u
       where u.email = :'correo'
         and ad.user_id = u.id
         and ad.activado_at is null
         and (select count(*) from auth.mfa_factors f
               where f.user_id = u.id and f.factor_type = 'totp'
                 and f.status = 'verified') = 1
         and (select count(*) from auth.mfa_factors f
               where f.user_id = u.id and f.factor_type = 'totp'
                 and f.status = 'verified' and f.created_at > ad.created_at) = 1
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
    const diag = psql(`
      select coalesce((select 'admin=' || (ad.user_id is not null)
                        || ' activado=' || (ad.activado_at is not null)
                        || ' totp_verificados=' || (select count(*) from auth.mfa_factors f
                             where f.user_id = u.id and f.factor_type = 'totp'
                               and f.status = 'verified')
                         from auth.users u
                         left join private.admins ad on ad.user_id = u.id
                        where u.email = :'correo'), 'sin cuenta');`,
    { correo });
    throw new Error(`no se activó (${diag}). Se exige: admin sin activar y exactamente 1 TOTP verificado creado después del alta.`);
  }
  console.log(`Activado: ${correo} (${id}). Auditado como activar_admin.`);
}

const esMain = import.meta.url === `file://${process.argv[1]}`;
if (esMain) {
  const [cmd, a, b] = process.argv.slice(2);
  try {
    if (cmd === 'crear' && a && b) await crear(a, b);
    else if (cmd === 'activar' && a) await activar(a);
    else {
      console.error('uso: crear-admin.mjs crear <correo@rlvo.com.mx> <Nombre> | activar <correo@rlvo.com.mx>');
      process.exit(2);
    }
  } catch (e) {
    console.error(`crear-admin: ${e.message}`);
    process.exit(1);
  }
}

export { crear, activar };
