// ===========================================================================
// Relevo — la Edge Function `eliminar-cuenta` por HTTP (Apple 5.1.1(v)).
//
// Cómo correrlo (local, DOS procesos):
//     supabase start
//     supabase functions serve --env-file supabase/functions/.env   # otra terminal
//     node scripts/probe-eliminar-cuenta.mjs
//
// QUÉ CUBRE Y QUÉ NO:
// · La parte PURA —¿la contraseña es reciente?— importando la implementación
//   REAL (`supabase/functions/eliminar-cuenta/reautenticacion.ts`, sin
//   imports). Es la única forma de probar la ventana de 5 minutos sin esperar
//   5 minutos.
// · Por HTTP, contra la función de verdad: quién puede llamarla, que el body
//   no elige a quién se borra, que el borrado deja 0 objetos en Storage y 0
//   filas en auth.users, que las reseñas escritas quedan anónimas con sus
//   estrellas, y que reintentar no truena.
// · NO repite la semántica de la base (qué se borra y qué se anonimiza fila por
//   fila): eso es T33 de `supabase/tests/rls.sql`. Aquí solo lo mínimo para
//   probar que la función dispara esas cascadas por el camino real
//   (`auth.admin.deleteUser`), no un `delete` de SQL.
//
// Los triggers de Storage no llaman a nada en local mientras Vault no tenga los
// secretos de moderación (`select name from vault.secrets` vacío), así que
// subir fotos aquí no cuesta Vision/OpenAI.
//
// Si una corrida muere de golpe, las cuentas `probe-del-*` quedan;
// `supabase db reset` las borra.
// ===========================================================================

import { execFileSync } from 'node:child_process';

import {
  reautenticacionReciente,
  TOLERANCIA_RELOJ_S,
  VENTANA_REAUTENTICACION_S,
} from '../supabase/functions/eliminar-cuenta/reautenticacion.ts';

const RUN = Date.now();
const DB = 'supabase_db_relevo-marketplace';
const PASS = 'probe-12345';

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

/** SQL como `postgres` dentro del contenedor. Solo con valores del propio probe. */
function sql(query) {
  return execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-Atc', query], { encoding: 'utf8' }).trim();
}

const n = (query) => Number(sql(query));
const decodificar = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

// ---------------------------------------------------------------------------
// Llamadas: las mismas que hace la app
// ---------------------------------------------------------------------------

async function crearUsuario(E, correo, nombre) {
  const res = await fetch(`${E.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password: PASS, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`crearUsuario ${correo}: ${res.status} ${await res.text()}`);
  const id = (await res.json()).id;
  sql(`update public.users set nombre = '${nombre}', campus_id = 1 where id = '${id}'`);
  return id;
}

/** `signInWithPassword`: el paso de reautenticación que hará el cliente. */
async function login(E, correo, password = PASS) {
  const res = await fetch(`${E.API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: E.PUBLISHABLE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password }),
  });
  return { status: res.status, json: await res.json() };
}

/** Una sesión que nació por OTP (magic link): sin `password` en `amr`. */
async function sesionOtp(E, correo) {
  const link = await (await fetch(`${E.API_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: correo }),
  })).json();
  const v = await (await fetch(`${E.API_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: E.PUBLISHABLE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: correo, token: link.email_otp }),
  })).json();
  if (!v.access_token) throw new Error(`sesionOtp ${correo}: ${JSON.stringify(v).slice(0, 200)}`);
  return v.access_token;
}

/** `supabase.functions.invoke('eliminar-cuenta', { body })`. */
async function eliminar(E, bearer, body = {}) {
  const headers = { apikey: E.PUBLISHABLE, 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${E.API_URL}/functions/v1/eliminar-cuenta`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const texto = await res.text();
  let json = {};
  try { json = JSON.parse(texto); } catch { /* cuerpo no JSON */ }
  return { status: res.status, json, texto };
}

const subir = (E, tok, bucket, ruta) =>
  fetch(`${E.API_URL}/storage/v1/object/${bucket}/${ruta}`, {
    method: 'POST',
    headers: { apikey: E.PUBLISHABLE, Authorization: `Bearer ${tok}`, 'Content-Type': 'image/jpeg' },
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9]),
  });

/** Objetos de Storage de un usuario, por dueño Y por carpeta. */
const objetosDe = (uid, listingIds = []) => n(
  `select count(*) from storage.objects
    where owner_id = '${uid}'
       or (bucket_id = 'avatars' and name like '${uid}/%')
       ${listingIds.map((id) => `or (bucket_id = 'listing-photos' and name like '${id}/%')`).join(' ')}`);

const cuentas = (uid) => n(`select count(*) from auth.users where id = '${uid}'`);

/**
 * Siembra una cuenta con avatar, una publicación con dos fotos, un push token
 * y un nombre. Devuelve lo que hace falta para comprobarla después.
 */
async function sembrar(E, etiqueta) {
  const correo = `probe-del-${etiqueta}-${RUN}@tec.mx`;
  const id = await crearUsuario(E, correo, 'Probador');
  const tok = (await login(E, correo)).json.access_token;
  const listing = Number(sql(
    `insert into public.listings (user_id, categoria_id, universidad_id, campus_id, titulo, precio, condicion, estado)
     values ('${id}', 1, 1, 1, 'probe-del ${etiqueta}', 100, 'nuevo', 'activa') returning id`).split('\n')[0]);
  const subidas = [
    await subir(E, tok, 'avatars', `${id}/${crypto.randomUUID()}.jpg`),
    await subir(E, tok, 'listing-photos', `${listing}/${crypto.randomUUID()}.jpg`),
    await subir(E, tok, 'listing-photos', `${listing}/${crypto.randomUUID()}.jpg`),
  ];
  if (subidas.some((r) => !r.ok)) {
    throw new Error(`sembrar ${etiqueta}: subida ${subidas.map((r) => r.status).join(',')}`);
  }
  sql(`insert into public.push_tokens (token, user_id, platform)
       values ('ExponentPushToken[probe-del-${etiqueta}-${RUN}]', '${id}', 'ios')`);
  return { id, correo, tok, listing };
}

// ---------------------------------------------------------------------------

async function main() {
  const raw = env();
  const E = {
    API_URL: raw.API_URL,
    SECRET: raw.SECRET_KEY || raw.SERVICE_ROLE_KEY,
    PUBLISHABLE: raw.PUBLISHABLE_KEY || raw.ANON_KEY,
  };
  if (!E.API_URL || !E.SECRET) throw new Error('No hay stack local. Corre `supabase start` primero.');

  const vivo = await fetch(`${E.API_URL}/functions/v1/eliminar-cuenta`, { method: 'POST' }).catch(() => null);
  if (!vivo || vivo.status === 404 || vivo.status >= 500) {
    throw new Error('La función no responde. Corre `supabase functions serve --env-file supabase/functions/.env`.');
  }

  // Imprime QUÉ se está probando antes de probarlo (CLAUDE.md §9).
  console.log('\n== Estado bajo prueba ==');
  console.log(`  ventana ${VENTANA_REAUTENTICACION_S} s, tolerancia de reloj ${TOLERANCIA_RELOJ_S} s`);
  console.log(`  FKs: ${sql(`select string_agg(conname || '=' || confdeltype::text, ', ' order by conname)
    from pg_constraint where conname in ('ratings_from_user_id_fkey','ratings_listing_id_fkey','reports_reporter_id_fkey')`)}`);
  console.log(`  secretos de Vault (vacío = los triggers de Storage no llaman a nada): [${sql('select string_agg(name, \', \') from vault.secrets')}]`);

  console.log('\n== 0. La decisión pura: ¿contraseña reciente? ==');
  const T = 1_800_000_000;
  const pw = (ts) => [{ method: 'password', timestamp: ts }];
  ok('recién escrita → sí', reautenticacionReciente(pw(T), T));
  ok(`justo en el borde (${VENTANA_REAUTENTICACION_S} s) → sí`, reautenticacionReciente(pw(T - VENTANA_REAUTENTICACION_S), T));
  ok('un segundo después del borde → no', !reautenticacionReciente(pw(T - VENTANA_REAUTENTICACION_S - 1), T));
  ok(`reloj adelantado ${TOLERANCIA_RELOJ_S} s → sí`, reautenticacionReciente(pw(T + TOLERANCIA_RELOJ_S), T));
  ok('adelantado un segundo más → no', !reautenticacionReciente(pw(T + TOLERANCIA_RELOJ_S + 1), T));
  ok('sesión por OTP → no', !reautenticacionReciente([{ method: 'otp', timestamp: T }], T));
  ok('sin amr, amr vacío o no-arreglo → no',
    !reautenticacionReciente(undefined, T) && !reautenticacionReciente([], T) && !reautenticacionReciente('password', T));
  ok('timestamp como texto → no', !reautenticacionReciente([{ method: 'password', timestamp: String(T) }], T));
  ok('otp + password reciente en el mismo amr → sí',
    reautenticacionReciente([{ method: 'otp', timestamp: T - 9999 }, ...pw(T - 10)], T));

  const creados = [];
  try {
    console.log('\n== 1. Sin credencial de usuario, no entra ==');
    const sin = await eliminar(E, null);
    ok('sin Authorization → 401', sin.status === 401, `status ${sin.status}`);
    const pub = await eliminar(E, E.PUBLISHABLE);
    ok('la publishable como Bearer → 401', pub.status === 401, `status ${pub.status}`);
    const sec = await eliminar(E, E.SECRET);
    ok('la SECRET key como Bearer → 401 (la función solo acepta usuarios)', sec.status === 401, `status ${sec.status}`);

    console.log('\n== 2. Sin reautenticación con contraseña, no borra ==');
    const O = await sembrar(E, 'otp');
    creados.push(O.id);
    const tokOtp = await sesionOtp(E, O.correo);
    console.log(`  amr de la sesión OTP: ${JSON.stringify(decodificar(tokOtp).amr)}`);
    const r2 = await eliminar(E, tokOtp);
    ok('sesión por OTP → 401 reautenticacion_requerida', r2.status === 401 && r2.json.error === 'reautenticacion_requerida',
      `status ${r2.status} ${r2.texto.slice(0, 80)}`);
    ok('…y la cuenta y sus 3 objetos siguen ahí', cuentas(O.id) === 1 && objetosDe(O.id, [O.listing]) === 3);

    console.log('\n== 3. El borrado correcto, y nadie borra a otro ==');
    const X = await sembrar(E, 'x');
    const B = await sembrar(E, 'b');
    const C = await sembrar(E, 'c');
    creados.push(X.id, B.id, C.id);
    // X le vende a C y los dos se califican: la reseña de X sobre C debe
    // sobrevivir anónima y el promedio de C no debe moverse.
    sql(`insert into public.listing_contacts (user_id, listing_id) values ('${C.id}', ${X.listing})`);
    sql(`insert into public.listing_sales (listing_id, comprador_id) values (${X.listing}, '${C.id}')`);
    sql(`insert into public.ratings (from_user_id, to_user_id, listing_id, estrellas, comentario)
         values ('${X.id}', '${C.id}', ${X.listing}, 4, 'probe-comentario'),
                ('${C.id}', '${X.id}', ${X.listing}, 5, null)`);
    const promC = sql(`select rating_promedio from public.users where id = '${C.id}'`);
    const resenaXC = sql(`select id from public.ratings where from_user_id = '${X.id}' and to_user_id = '${C.id}'`);

    // Reautenticación reciente: lo que hará el cliente justo antes de llamar.
    const re = await login(E, X.correo);
    console.log(`  amr tras signInWithPassword: ${JSON.stringify(decodificar(re.json.access_token).amr)}`);
    // El body pide borrar a B. Se ignora: el objetivo sale del JWT.
    const r3 = await eliminar(E, re.json.access_token, { user_id: B.id, id: B.id, uid: B.id });
    ok('X reautenticado → 200', r3.status === 200, `status ${r3.status} ${r3.texto.slice(0, 120)}`);
    ok('…el body con el id de B NO borra a B (cuenta y 3 objetos intactos)',
      cuentas(B.id) === 1 && objetosDe(B.id, [B.listing]) === 3);
    ok('…X: 0 filas en auth.users', cuentas(X.id) === 0);
    ok('…X: 0 objetos en Storage (avatar y las dos fotos)', objetosDe(X.id, [X.listing]) === 0,
      `quedan ${objetosDe(X.id, [X.listing])}`);
    ok('…X: su push token se fue con la cascada',
      n(`select count(*) from public.push_tokens where user_id = '${X.id}' or token like '%probe-del-x-${RUN}%'`) === 0);
    ok('…la reseña que X escribió sigue, anónima, con sus 4 estrellas',
      sql(`select coalesce(from_user_id::text, 'null') || '|' || estrellas || '|' || coalesce(comentario, 'null')
             from public.ratings where id = ${resenaXC}`) === 'null|4|null');
    ok('…el promedio de C no se movió', sql(`select rating_promedio from public.users where id = '${C.id}'`) === promC,
      `antes ${promC}`);

    console.log('\n== 4. Reintentar no truena ==');
    // Con el MISMO token: el caso de una respuesta que se perdió en la red.
    // 200 y no solo "no 5xx", medido: `withSupabase` valida el JWT por firma
    // (JWKS) y no pregunta si la cuenta existe, así que el token sigue valiendo
    // hasta su `exp`, y un `deleteUser` sobre una cuenta ya borrada cuenta como
    // hecho. El cliente puede reintentar a ciegas.
    const r4 = await eliminar(E, re.json.access_token);
    ok('segunda llamada con el mismo JWT → 200', r4.status === 200, `status ${r4.status} ${r4.texto.slice(0, 120)}`);

    // Un corte a la mitad: Storage ya perdió un objeto (como si la primera
    // llamada hubiera muerto después de borrarlo) y la cuenta sigue viva.
    const P = await sembrar(E, 'parcial');
    creados.push(P.id);
    const unaFoto = sql(`select name from storage.objects where bucket_id = 'listing-photos' and name like '${P.listing}/%' limit 1`);
    await fetch(`${E.API_URL}/storage/v1/object/listing-photos`, {
      method: 'DELETE',
      headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [unaFoto] }),
    });
    const antes = objetosDe(P.id, [P.listing]);
    const reP = await login(E, P.correo);
    const r5 = await eliminar(E, reP.json.access_token);
    ok('estado parcial (Storage a medias) → 200 y termina', r5.status === 200
      && cuentas(P.id) === 0 && objetosDe(P.id, [P.listing]) === 0,
      `objetos antes ${antes}, status ${r5.status}`);

    console.log('\n== 5. Una cuenta con una publicación BLOQUEADA (RF-17 Ola 4) ==');
    // D5: el dueño de una bloqueada ya no ve sus objetos; aquí borra la función
    // con la secret key, así que no cambia nada, y este caso lo vigila. Y el
    // cascade deja el registro mínimo de moderación (20261007000482), con su
    // user_id aunque la cuenta ya no exista (decisión del usuario).
    const K = await sembrar(E, 'bloq');
    creados.push(K.id);
    sql(`insert into public.listing_moderacion (listing_id, veredicto, estado_resultante, detalle)
         values (${K.listing}, 'bloquear', 'bloqueada', '{}')`);
    sql(`update public.listings set estado = 'bloqueada' where id = ${K.listing}`);
    const reK = await login(E, K.correo);
    const r6 = await eliminar(E, reK.json.access_token);
    ok('cuenta con una bloqueada con 2 fotos → 200, 0 filas en auth.users, 0 objetos',
      r6.status === 200 && cuentas(K.id) === 0 && objetosDe(K.id, [K.listing]) === 0,
      `status ${r6.status} objetos=${objetosDe(K.id, [K.listing])}`);
    ok('…y el registro mínimo de moderación de la bloqueada queda, con su user_id',
      n(`select count(*) from private.moderacion_retenida where listing_id = ${K.listing} and user_id = '${K.id}'`) === 1);
  } finally {
    // El registro retenido es del probe: se quita (no lo borra ninguna cascada).
    if (creados.length) {
      sql(`delete from private.moderacion_retenida where user_id in (${creados.map((i) => `'${i}'`).join(',')})`);
    }
    for (const id of creados) {
      await fetch(`${E.API_URL}/auth/v1/admin/users/${id}`, {
        method: 'DELETE', headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      });
    }
    // Los objetos que queden (bajo un control negativo, o de las cuentas que
    // SÍ debían sobrevivir) se borran por el API: por SQL no se puede
    // (`storage.protect_delete`, CLAUDE.md §9).
    const restos = sql(`select bucket_id || ' ' || name from storage.objects
                         where name like '%' and owner_id in (${creados.map((i) => `'${i}'`).join(',') || "''"})`)
      .split('\n').filter(Boolean);
    for (const bucket of ['avatars', 'listing-photos']) {
      const rutas = restos.filter((l) => l.startsWith(`${bucket} `)).map((l) => l.slice(bucket.length + 1));
      if (rutas.length) {
        await fetch(`${E.API_URL}/storage/v1/object/${bucket}`, {
          method: 'DELETE',
          headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: rutas }),
        });
      }
    }
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
