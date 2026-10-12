// Probe de AUTH-2: la sesión "huérfana" contra GoTrue y PostgREST LOCALES.
//
//   node scripts/probe-sesion-huerfana.mjs
//
// Amarra `esCuentaInexistente()` (src/lib/cuenta-inexistente.ts, importada REAL)
// con el error que de verdad devuelve auth-js, y documenta por qué hace falta:
//
//   D. Cuenta de Auth borrada, token aún vigente: `getUser()` da 403
//      `user_not_found` (→ true) y PostgREST sigue aceptando el token y
//      devuelve 0 filas del perfil (por eso "sin fila" no puede leerse como
//      "perfil incompleto").
//   D'. Sesión revocada en el servidor: `AuthSessionMissingError` (→ true).
//   E. Cuenta viva sin fila en public.users: `getUser()` da la cuenta, y un
//      UPDATE con `count: 'exact'` afecta 0 filas SIN error (la defensa de
//      `completar-perfil.tsx`).
//   Red caída y token basura: (→ false). Un fallo de red o cualquier otro
//      401/403 nunca debe cerrar sesión.
//
// Controles negativos integrados: tres variantes rotas del clasificador
// ("cualquier 401/403", "también los errores de red", "sin user_not_found") se
// evalúan contra los MISMOS errores medidos y cada una tiene que discrepar al
// menos en un caso; si alguna no discrepa, el probe ya no la cazaría y falla.
//
// Solo contra el stack local: aborta si la API no es 127.0.0.1/localhost o si
// falla `_guarda-relevo.mjs`. Crea sus propias cuentas y las borra al final.

import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { guardaRelevo, CONTENEDOR_DB } from './_guarda-relevo.mjs';
import { esCuentaInexistente } from '../src/lib/cuenta-inexistente.ts';

const RUN = Date.now();
const PREFIJO = 'probe-huerfana-';
const PASS = 'probe-Huerfana-1234';

function env() {
  const raw = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  const out = {};
  for (const line of raw.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, '');
  }
  return {
    API_URL: out.API_URL,
    SECRET_KEY: out.SECRET_KEY || out.SERVICE_ROLE_KEY,
    PUBLISHABLE_KEY: out.PUBLISHABLE_KEY || out.ANON_KEY,
  };
}

const sql = (q) => execFileSync('docker', ['exec', '-i', CONTENEDOR_DB, 'psql', '-qAt', '-U', 'postgres', '-d', 'postgres'],
  { input: q, encoding: 'utf8' }).trim();

let pasadas = 0;
const fallos = [];
function ok(nombre, cond, detalle) {
  if (cond) {
    pasadas++;
    console.log(`  ok — ${nombre}${detalle ? ` (${detalle})` : ''}`);
  } else {
    fallos.push(nombre);
    console.log(`  FALLÓ — ${nombre}${detalle ? ` (${detalle})` : ''}`);
  }
}
const describir = (e) => (e ? `${e.name} status=${e.status} code=${e.code}` : 'sin error');

async function main() {
  const E = env();
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(E.API_URL ?? '')) {
    throw new Error(`solo contra el stack local; API_URL=${E.API_URL}`);
  }
  guardaRelevo({ apiUrl: E.API_URL });

  const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(E.API_URL, E.SECRET_KEY, opciones);
  const creadas = [];
  const crear = async (etiqueta) => {
    const email = `${PREFIJO}${etiqueta}-${RUN}@tec.mx`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: PASS, email_confirm: true });
    if (error) throw new Error(`createUser ${etiqueta}: ${error.message}`);
    creadas.push(data.user.id);
    const cli = createClient(E.API_URL, E.PUBLISHABLE_KEY, opciones);
    const { data: s, error: e2 } = await cli.auth.signInWithPassword({ email, password: PASS });
    if (e2) throw new Error(`login ${etiqueta}: ${e2.message}`);
    return { id: data.user.id, cli, token: s.session.access_token };
  };
  const filasPerfil = async (cli, id) => {
    const { data, error } = await cli.from('users').select('id').eq('id', id);
    return error ? `error ${error.code}` : data.length;
  };

  // Errores medidos, con lo que el clasificador DEBE responder para cada uno.
  const medidos = [];

  try {
    console.log('\n== D. Cuenta de Auth borrada con el token todavía vigente ==');
    const D = await crear('d');
    ok('antes del borrado, getUser() devuelve la cuenta', (await D.cli.auth.getUser()).data.user?.id === D.id);
    ok('antes del borrado, el perfil tiene 1 fila', (await filasPerfil(D.cli, D.id)) === 1);
    const { error: eBorrar } = await admin.auth.admin.deleteUser(D.id);
    ok('el admin API borra la cuenta', !eBorrar, describir(eBorrar));
    const gD = await D.cli.auth.getUser();
    ok('getUser() da 403 user_not_found', gD.error?.status === 403 && gD.error?.code === 'user_not_found',
      describir(gD.error));
    ok('esCuentaInexistente → true', esCuentaInexistente(gD.error) === true);
    ok('PostgREST acepta el token y el perfil da 0 filas (no un error)', (await filasPerfil(D.cli, D.id)) === 0);
    medidos.push({ caso: 'D user_not_found', error: gD.error, esperado: true });

    console.log("\n== D'. Sesión revocada en el servidor ==");
    const S = await crear('s');
    const { error: eLogout } = await admin.auth.admin.signOut(S.token, 'global');
    ok('el servidor revoca la sesión', !eLogout, describir(eLogout));
    const gS = await S.cli.auth.getUser();
    ok('getUser() da AuthSessionMissingError', gS.error?.name === 'AuthSessionMissingError', describir(gS.error));
    ok('esCuentaInexistente → true', esCuentaInexistente(gS.error) === true);
    medidos.push({ caso: "D' session_not_found", error: gS.error, esperado: true });

    console.log('\n== E. Cuenta viva sin fila en public.users ==');
    const X = await crear('e');
    sql(`delete from public.users where id = '${X.id}'`);
    const gX = await X.cli.auth.getUser();
    ok('getUser() devuelve la cuenta, sin error', !gX.error && gX.data.user?.id === X.id, describir(gX.error));
    ok('esCuentaInexistente(null) → false', esCuentaInexistente(gX.error) === false);
    ok('el perfil da 0 filas', (await filasPerfil(X.cli, X.id)) === 0);
    const up = await X.cli.from('users').update({ nombre: 'Ana Luz' }, { count: 'exact' }).eq('id', X.id);
    ok('UPDATE con count exact: 0 filas y SIN error', !up.error && up.count === 0,
      `error=${up.error?.code ?? 'ninguno'} count=${up.count}`);

    console.log('\n== Red caída ==');
    const sinRed = createClient('http://127.0.0.1:1', E.PUBLISHABLE_KEY, opciones);
    const gRed = await sinRed.auth.getUser(X.token);
    ok('getUser() da AuthRetryableFetchError', gRed.error?.name === 'AuthRetryableFetchError', describir(gRed.error));
    ok('esCuentaInexistente → false (un fallo de red nunca cierra sesión)', esCuentaInexistente(gRed.error) === false);
    medidos.push({ caso: 'red caída', error: gRed.error, esperado: false });

    console.log('\n== Token basura (otro 401/403) ==');
    const gBasura = await X.cli.auth.getUser('no-es-un-jwt');
    ok('getUser() da 401/403 con un código distinto de user_not_found',
      [401, 403].includes(gBasura.error?.status) && gBasura.error?.code !== 'user_not_found', describir(gBasura.error));
    ok('esCuentaInexistente → false', esCuentaInexistente(gBasura.error) === false);
    medidos.push({ caso: 'token basura', error: gBasura.error, esperado: false });

    console.log('\n== Controles negativos (variantes rotas del clasificador) ==');
    const variantes = {
      'cualquier 401/403 cierra sesión': (e) => esCuentaInexistente(e) || [401, 403].includes(e?.status),
      'un error de red cierra sesión': (e) => esCuentaInexistente(e) || e?.name === 'AuthRetryableFetchError',
      'sin la rama user_not_found': (e) => e?.name === 'AuthSessionMissingError',
    };
    for (const [nombre, variante] of Object.entries(variantes)) {
      const cazados = medidos.filter((m) => variante(m.error) !== m.esperado).map((m) => m.caso);
      ok(`el probe caza la variante "${nombre}"`, cazados.length > 0, cazados.join(', ') || 'ningún caso discrepa');
    }
  } finally {
    for (const id of creadas) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error && error.status !== 404) console.log(`  aviso: no se pudo borrar una cuenta del probe: ${error.message}`);
    }
    const restos = sql(`select count(*) from auth.users where email like '${PREFIJO}%'`);
    ok('limpieza: 0 cuentas del probe en auth.users', restos === '0', `restos=${restos}`);
  }

  console.log(`\n${pasadas} ok, ${fallos.length} fallaron`);
  if (fallos.length > 0) {
    console.log('FALLARON:\n  ' + fallos.join('\n  '));
    process.exit(1);
  }
  console.log('===========================================\n   LAS ' + pasadas + ' PRUEBAS PASARON\n===========================================');
}

main().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
