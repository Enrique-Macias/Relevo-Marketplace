// ===========================================================================
// Relevo — el registro solo admite dominios institucionales (Auth Hook
// "Before User Created", migración 20260923000465), y la universidad del perfil
// la asigna el trigger de alta desde ese mismo dominio (20260924000466, caso 8).
//
// Cómo correrlo (local, con el stack arriba y el hook activo en config.toml):
//     supabase start           # o supabase db reset
//     node scripts/probe-registro.mjs
//
// POR QUÉ EXISTE, SI YA HAY UNA SUITE DE RLS:
// `supabase/tests/rls.sql` (T27) prueba los GRANTS y la LÓGICA de la función,
// llamándola directo como `postgres`. Lo que no puede ver es a GoTrue: que el
// hook esté CABLEADO, que corra como `supabase_auth_admin` con su policy (como
// `postgres`, la RLS no se evalúa), que un rechazo no deje fila en `auth.users`
// ni mande correo, y que login y recuperación de una cuenta ya existente no
// pasen por él. Todo eso solo se ve contra el Auth de verdad.
//
// Y es el AMARRE entre el string que devuelve la función SQL y el que reconoce
// el cliente: importa `DOMINIO_NO_PARTICIPANTE` de `src/lib/registro.ts`, que
// no tiene imports justamente para que Node lo pueda cargar.
//
// Si una corrida muere de golpe, las cuentas `probe-reg-*` quedan en
// `auth.users`; `supabase db reset` las borra.
// ===========================================================================

import { execFileSync } from 'node:child_process';

import { DOMINIO_NO_PARTICIPANTE, esDominioNoParticipante } from '../src/lib/registro.ts';

const RUN = Date.now();
const DB = 'supabase_db_relevo-marketplace';

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function env() {
  const raw = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  const out = {};
  for (const line of raw.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, '');
  }
  return out;
}

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

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** SQL como `postgres` dentro del contenedor. Solo con valores del propio probe. */
function sql(query) {
  return execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-Atc', query], { encoding: 'utf8' }).trim();
}

/** ¿Hay fila en auth.users? GoTrue guarda el correo en minúsculas. */
const filas = (correo) => Number(sql(
  `select count(*) from auth.users where email = '${correo.toLowerCase().replace(/'/g, "''")}'`));

/**
 * La universidad con la que nació el perfil de `public.users`, o `null`. La
 * asigna `private.handle_new_user()` desde el dominio (20260924000466). `'∅'`
 * si ni siquiera existe la fila, para distinguir "sin universidad" de "sin
 * perfil".
 */
const universidadDe = (correo) => sql(
  `select coalesce((select coalesce(u.universidad_id::text, 'null') from public.users u
     join auth.users a on a.id = u.id
    where a.email = '${correo.toLowerCase().replace(/'/g, "''")}'), '∅')`);

/** Mensajes que Mailpit (el buzón local, :54324) tiene para ese destinatario. */
async function correos(E, correo) {
  const res = await fetch(`${E.MAIL}/api/v1/search?query=${encodeURIComponent(`to:${correo.toLowerCase()}`)}`);
  if (!res.ok) throw new Error(`mailpit: ${res.status} ${await res.text()}`);
  return (await res.json()).messages ?? [];
}

/**
 * Espera a que llegue el n-ésimo correo. Para el caso NEGATIVO espera la
 * ventana completa: un "0 correos" leído a los 50 ms no prueba que no se mandó
 * nada, solo que todavía no llegó.
 */
async function esperarCorreos(E, correo, n, ms = 3000) {
  const hasta = Date.now() + ms;
  let lista = await correos(E, correo);
  while (lista.length < n && Date.now() < hasta) {
    await esperar(150);
    lista = await correos(E, correo);
  }
  return lista;
}

async function codigoDe(E, mensaje) {
  const res = await fetch(`${E.MAIL}/api/v1/message/${mensaje.ID}`);
  const cuerpo = (await res.json()).Text ?? '';
  return cuerpo.match(/\b\d{6}\b/)?.[0];
}

// ---------------------------------------------------------------------------
// Llamadas a GoTrue: las mismas que hace la app
// ---------------------------------------------------------------------------

async function post(E, ruta, body, llave = E.PUBLISHABLE) {
  const res = await fetch(`${E.API_URL}/auth/v1/${ruta}`, {
    method: 'POST',
    headers: { apikey: llave, Authorization: `Bearer ${llave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const texto = await res.text();
  let json = {};
  try { json = JSON.parse(texto); } catch { /* cuerpo vacío */ }
  // La misma traducción que auth-js (`_getErrorMessage` en lib/fetch.js):
  // `msg` pasa a `error.message` y el status HTTP a `error.status`.
  const error = res.ok ? null : { status: res.status, message: json.msg ?? json.message ?? texto };
  return { status: res.status, json, error };
}

// `verificacion.tsx`: signInWithOtp({ email, options: { shouldCreateUser: true } })
const registrar = (E, correo) => post(E, 'otp', { email: correo, create_user: true });
// `iniciar-sesion.tsx`: signInWithPassword
const login = (E, correo, password) =>
  fetch(`${E.API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: E.PUBLISHABLE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password }),
  });
// `recuperar-password.tsx` y `recuperar-codigo.tsx`
const recuperar = (E, correo) => post(E, 'recover', { email: correo });
const verificarRecuperacion = (E, correo, token) =>
  post(E, 'verify', { type: 'recovery', email: correo, token });

async function crearConAdmin(E, correo, password) {
  const { status, json } = await post(E, 'admin/users',
    { email: correo, password, email_confirm: true }, E.SECRET);
  return { status, id: json.id };
}

// ---------------------------------------------------------------------------

async function main() {
  const raw = env();
  const E = {
    API_URL: raw.API_URL,
    MAIL: raw.MAILPIT_URL || raw.INBUCKET_URL,
    SECRET: raw.SECRET_KEY || raw.SERVICE_ROLE_KEY,
    PUBLISHABLE: raw.PUBLISHABLE_KEY || raw.ANON_KEY,
  };
  if (!E.API_URL || !E.SECRET || !E.MAIL) {
    throw new Error('No hay stack local. Corre `supabase start` primero.');
  }

  // Imprime QUÉ se está probando antes de probarlo (CLAUDE.md §9, "una
  // verificación que sale sospechosamente limpia"). Si un control negativo no
  // se aplicó, esto lo delata antes que cualquier aserción.
  console.log('\n== Estado bajo prueba ==');
  console.log(`  dominios: [${sql('select string_agg(dominio, \', \' order by dominio) from public.universidad_dominios')}]`);
  console.log(`  policies: [${sql("select string_agg(policyname, ', ') from pg_policies where tablename = 'universidad_dominios'")}]`);
  const hook = execFileSync('docker', ['inspect', 'supabase_auth_relevo-marketplace', '--format',
    '{{range .Config.Env}}{{println .}}{{end}}'], { encoding: 'utf8' })
    .split('\n').filter((l) => l.startsWith('GOTRUE_HOOK_BEFORE_USER_CREATED_')).join(' ');
  console.log(`  GoTrue: ${hook || '(sin hook configurado)'}`);
  const uniTec = sql("select universidad_id from public.universidad_dominios where dominio = 'tec.mx'");
  console.log(`  trigger de alta asigna universidad: ${sql(
    "select (prosrc like '%universidad_dominios%')::text from pg_proc where proname = 'handle_new_user'")} (tec.mx → ${uniTec || '∅'})`);

  const tec = `probe-reg-${RUN}@tec.mx`;
  const mayus = `PROBE-REG-MAYUS-${RUN}@TEC.MX`;
  const gmail = `probe-reg-${RUN}@gmail.com`;
  const existente = `probe-reg-existente-${RUN}@gmail.com`;
  const PASS = 'probe-1234';

  try {
    console.log('\n== 1. Un dominio sembrado se registra ==');
    const r1 = await registrar(E, tec);
    ok('tec.mx → 200', r1.status === 200, `status ${r1.status} ${r1.error?.message ?? ''}`);
    ok('tec.mx → existe la fila en auth.users', filas(tec) === 1);
    ok('tec.mx → el correo con el código llega al buzón',
      (await esperarCorreos(E, tec, 1)).length === 1);

    console.log('\n== 2. gmail.com se rechaza, sin fila y sin correo ==');
    const r2 = await registrar(E, gmail);
    ok('gmail.com → 403', r2.status === 403, `status ${r2.status}`);
    ok('gmail.com → el mensaje es el código que reconoce el cliente',
      r2.error?.message === DOMINIO_NO_PARTICIPANTE, `recibido: ${r2.error?.message}`);
    ok('gmail.com → esDominioNoParticipante() lo reconoce', esDominioNoParticipante(r2.error));
    ok('gmail.com → NO hay fila en auth.users', filas(gmail) === 0);
    ok('gmail.com → NO se envió correo', (await esperarCorreos(E, gmail, 1, 2000)).length === 0);

    console.log('\n== 3. Mayúsculas ==');
    const r3 = await registrar(E, mayus);
    ok('PROBE@TEC.MX → 200', r3.status === 200, `status ${r3.status} ${r3.error?.message ?? ''}`);
    ok('PROBE@TEC.MX → existe la fila', filas(mayus) === 1);

    console.log('\n== 4. Subdominios e imitaciones se rechazan ==');
    for (const d of ['estudiante.tec.mx', 'tec.mx.evil.com', 'eviltec.mx']) {
      const correo = `probe-reg-${RUN}@${d}`;
      const r = await registrar(E, correo);
      ok(`${d} → rechazado por el hook`, esDominioNoParticipante(r.error),
        `status ${r.status} ${r.error?.message ?? ''}`);
      ok(`${d} → sin fila`, filas(correo) === 0);
    }

    console.log('\n== 5. Una cuenta EXISTENTE de dominio no permitido sigue entrando ==');
    // Se crea por el admin API, que NO pasa por el hook (caso 7). Es el mismo
    // estado que las cuentas gmail/hotmail que ya hay en remoto.
    const alta = await crearConAdmin(E, existente, PASS);
    if (alta.status !== 200) throw new Error(`no se pudo sembrar la cuenta existente: ${alta.status}`);

    const l = await login(E, existente, PASS);
    ok('signInWithPassword → 200 con sesión', l.status === 200 && Boolean((await l.json()).access_token),
      `status ${l.status}`);

    const rec = await recuperar(E, existente);
    ok('resetPasswordForEmail → 200', rec.status === 200, `status ${rec.status} ${rec.error?.message ?? ''}`);
    const buzon = await esperarCorreos(E, existente, 1);
    ok('resetPasswordForEmail → llega el correo', buzon.length === 1);
    const codigo = buzon[0] ? await codigoDe(E, buzon[0]) : undefined;
    const ver = codigo ? await verificarRecuperacion(E, existente, codigo) : { status: 0, json: {} };
    ok('verifyOtp({type:"recovery"}) → sesión', ver.status === 200 && Boolean(ver.json.access_token),
      `status ${ver.status} ${ver.error?.message ?? ''}`);

    // El "Reenviar" de `codigo.tsx` también manda `shouldCreateUser: true`. Sobre
    // una cuenta que ya existe no crea nada, así que el hook no dispara.
    await esperar(1100); // max_frequency = "1s" de [auth.email]
    const otp = await registrar(E, existente);
    ok('signInWithOtp sobre la cuenta existente → 200', otp.status === 200,
      `status ${otp.status} ${otp.error?.message ?? ''}`);
    ok('ningún camino creó una segunda fila', filas(existente) === 1);

    console.log('\n== 6. Recuperar un correo inexistente no crea cuenta ==');
    const fantasma = `probe-reg-fantasma-${RUN}@gmail.com`;
    const r6 = await recuperar(E, fantasma);
    ok('resetPasswordForEmail de un gmail inexistente → 200 (anti-enumeración)', r6.status === 200,
      `status ${r6.status}`);
    ok('…y sin fila en auth.users', filas(fantasma) === 0);

    console.log('\n== 7. El admin API NO pasa por el hook ==');
    // Medido, no supuesto: el corte es por LLAVE, igual que
    // `minimum_password_length` (CLAUDE.md §9). Quien tenga la secret key
    // (Studio, service_role) crea cuentas de cualquier dominio. Si esto empieza
    // a fallar, GoTrue cambió de comportamiento, y los probes que crean
    // cuentas por esa vía dependen de que `tec.mx` esté sembrado.
    const admin = `probe-reg-admin-${RUN}@gmail.com`;
    const r7 = await crearConAdmin(E, admin, PASS);

    ok('POST /admin/users con gmail.com → 200', r7.status === 200, `status ${r7.status}`);

    console.log('\n== 8. El trigger de alta asigna la universidad del dominio ==');
    // 20260924000466. T28 prueba la función llamando al trigger por un INSERT
    // como `postgres`; esto prueba lo mismo por el camino REAL de GoTrue: el
    // alta por OTP del caso 1 y 3, y el alta por admin API del caso 7, que no
    // pasa por el hook.
    ok('tec.mx por OTP → nace con la universidad de tec.mx', universidadDe(tec) === uniTec,
      `universidad_id ${universidadDe(tec)}, esperado ${uniTec}`);
    ok('TEC.MX en mayúsculas → también', universidadDe(mayus) === uniTec,
      `universidad_id ${universidadDe(mayus)}`);
    // La mitad "nunca lanza": el caso 7 ya dio 200 (si el trigger lanzara, GoTrue
    // respondería 500 y no habría cuenta); aquí se confirma que el perfil EXISTE
    // y nace sin universidad, que es lo que la app pinta como "sin universidad
    // asignada".
    ok('gmail.com por admin API → el perfil existe, con universidad null',
      universidadDe(admin) === 'null', `universidad_id ${universidadDe(admin)}`);
  } finally {
    // Por patrón y no por la lista de `creados`: bajo un control negativo, los
    // correos que DEBÍAN rechazarse sí crean fila, y también hay que borrarlos.
    sql(`delete from auth.users where email like 'probe-reg-%${RUN}@%'`);
  }

  console.log(`\n${'='.repeat(43)}`);
  if (fallos.length) {
    console.log(`   ${fallos.length} FALLARON de ${pasadas + fallos.length}`);
    for (const f of fallos) console.log(`   - ${f}`);
    console.log('='.repeat(43));
    process.exit(1);
  }
  console.log(`   LAS ${pasadas} PRUEBAS PASARON`);
  console.log('='.repeat(43));
}

main().catch((e) => { console.error(`\n${e.message}`); process.exit(1); });
