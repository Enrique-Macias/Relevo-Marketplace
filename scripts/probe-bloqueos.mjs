#!/usr/bin/env node
// ===========================================================================
// Relevo — bloqueo entre usuarios por HTTP (UGC-1, 20261013000487).
//
// Cómo correrlo (local):
//     supabase start
//     node scripts/probe-bloqueos.mjs
//
// QUÉ CUBRE: que las protecciones del bloqueo existen en lo que PostgREST
// expone, con la misma `@supabase/supabase-js` que la app, y no solo en SQL
// directo (eso lo prueba T40 de supabase/tests/rls.sql). Con A que bloquea a B
// y un tercero T sin bloqueos:
//   - las publicaciones no se ven entre A y B en ninguna dirección, tampoco
//     pidiéndolas por id ni por `buscar_listings`;
//   - `seller_whatsapp` niega en las dos direcciones;
//   - B no lee la fila de `user_bloqueos` que lo nombra, no la borra y no
//     inserta a nombre de A; A sí lee la suya;
//   - `interaccion_disponible` da false en las dos direcciones (no dice cuál);
//   - no se registran contactos nuevos entre ellos;
//   - `increment_listing_view` no suma vistas entre ellos (20261015000488) y
//     responde exactamente igual que cuando sí suma: no revela el bloqueo;
//   - T conserva el comportamiento normal, y anon no toca nada.
//
// Escribe en la base local (cuentas, publicaciones y un bloqueo temporales), así
// que pasa primero por la guarda de proyecto. Limpia lo suyo: borra sus cuentas
// por el admin API y el cascade se lleva publicaciones y bloqueos.
// ===========================================================================

import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { guardaRelevo, CONTENEDOR_DB } from './_guarda-relevo.mjs';
import { aceptarTerminosDePrueba } from './_terminos-prueba.mjs';

const RUN = Date.now().toString(36);
const PASS = 'probe-bloqueos-1234';

function env() {
  const raw = execFileSync('supabase', ['status', '-o', 'env'], { encoding: 'utf8' });
  const out = {};
  for (const line of raw.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, '');
  }
  return out;
}

/** SQL como `postgres` dentro del contenedor. Solo con valores del propio probe. */
function sql(query) {
  return execFileSync('docker', ['exec', CONTENEDOR_DB, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-Atc', query], { encoding: 'utf8' }).trim();
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

const describir = (r) => (r.error ? `${r.status} ${r.error.code}: ${r.error.message}` : `${r.status} ok`);
const ids = (r) => (r.data ?? []).map((x) => x.id).sort((a, b) => a - b).join(',');

/**
 * `increment_listing_view` por HTTP crudo, con el token de la sesión: lo que la
 * app recibe, sin la capa de supabase-js. Devuelve solo lo observable por el
 * llamador (status, cuerpo y los headers que podrían variar), para comparar una
 * llamada que cuenta contra una que no.
 */
async function vistaHttp(E, U, listingId) {
  const { data } = await U.cli.auth.getSession();
  const res = await fetch(`${E.API_URL}/rest/v1/rpc/increment_listing_view`, {
    method: 'POST',
    headers: { apikey: E.PUBLISHABLE_KEY, Authorization: `Bearer ${data.session.access_token}`,
      'Content-Type': 'application/json' },
    body: JSON.stringify({ p_listing_id: listingId }),
  });
  const cuerpo = await res.text();
  const h = (k) => res.headers.get(k) ?? '-';
  return { status: res.status, cuerpo, firma: `${res.status}|${cuerpo}|${h('content-type')}|${h('content-range')}|${h('content-length')}` };
}
const vistas = (id) => Number(sql(`select vistas_count from public.listings where id = ${Number(id)}`));

async function main() {
  const E = env();
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(E.API_URL)) throw new Error('solo contra el stack local');
  guardaRelevo({ apiUrl: E.API_URL });

  console.log('Estado bajo prueba:');
  console.log(`  policy listings_select usa el filtro de bloqueo: ${sql(
    `select (pg_get_expr(polqual, polrelid) like '%bloqueos_vigentes%')::text from pg_policy where polname = 'listings_select'`)}`);
  console.log(`  privilegios de user_bloqueos: ${sql(`select coalesce(string_agg(grantee || ':' || privilege_type, ', ' order by 1), '(ninguno)')
    from information_schema.table_privileges where table_name = 'user_bloqueos' and grantee in ('anon', 'authenticated')`)}`);
  console.log(`  increment_listing_view mira el bloqueo: ${sql(
    `select (prosrc like '%bloqueo_entre%')::text from pg_proc where oid = 'public.increment_listing_view(bigint)'::regprocedure`)}`);

  const admin = createClient(E.API_URL, E.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const creadas = [];
  const crear = async (etiqueta, telefono) => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `probe-bloqueos-${etiqueta}-${RUN}@tec.mx`, password: PASS, email_confirm: true });
    if (error) throw new Error(`createUser ${etiqueta}: ${error.message}`);
    creadas.push(data.user.id);
    // Sin aceptar los términos (PL-016) no contacta ni recibe un WhatsApp.
    await aceptarTerminosDePrueba(E.API_URL, E.SECRET_KEY, data.user.id);
    sql(`update public.users set telefono = '${telefono}',
           campus_id = (select c.id from public.campus c where c.universidad_id = users.universidad_id order by c.id limit 1)
         where id = '${data.user.id}'`);
    const cli = createClient(E.API_URL, E.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: e2 } = await cli.auth.signInWithPassword({ email: data.user.email, password: PASS });
    if (e2) throw new Error(`login ${etiqueta}: ${e2.message}`);
    return { id: data.user.id, cli };
  };
  const publicar = (uid, titulo) => sql(`insert into public.listings (user_id, categoria_id, universidad_id, campus_id,
      titulo, descripcion, precio, condicion, estado)
    select id, (select min(id) from public.categories), universidad_id, campus_id, '${titulo}', 'probe', 100, 'usado', 'activa'
      from public.users where id = '${uid}' returning id`).split('\n')[0];

  try {
    const A = await crear('a', '+528150000001');
    const B = await crear('b', '+528150000002');
    const T = await crear('t', '+528150000003');
    const la = Number(publicar(A.id, `Termodinamica probeblq ${RUN} A`));
    const lb = Number(publicar(B.id, `Termodinamica probeblq ${RUN} B`));
    const lt = Number(publicar(T.id, `Termodinamica probeblq ${RUN} T`));
    const todas = [la, lb, lt];

    console.log('\n== 0. Sin bloqueo, todos ven todo ==');
    const r0 = await A.cli.from('listings').select('id').in('id', todas);
    ok('0a A ve las tres antes del bloqueo', ids(r0) === [la, lb, lt].sort((x, y) => x - y).join(','), describir(r0));

    console.log('\n== 1. A bloquea a B (insert plano, como lo haría la app) ==');
    const rb = await A.cli.from('user_bloqueos').insert({ user_id: A.id, bloqueado_id: B.id });
    ok('1a el bloqueo se crea → 201', rb.status === 201 && !rb.error, describir(rb));

    console.log('\n== 2. Publicaciones ==');
    const a2 = await A.cli.from('listings').select('id').in('id', todas);
    ok('2a A ve la suya y la del tercero, no la de B', ids(a2) === [la, lt].sort((x, y) => x - y).join(','), describir(a2));
    const b2 = await B.cli.from('listings').select('id').in('id', todas);
    ok('2b B ve la suya y la del tercero, no la de A', ids(b2) === [lb, lt].sort((x, y) => x - y).join(','), describir(b2));
    const t2 = await T.cli.from('listings').select('id').in('id', todas);
    ok('2c el tercero ve las tres', ids(t2) === [la, lb, lt].sort((x, y) => x - y).join(','), describir(t2));
    const a3 = await A.cli.from('listings').select('id').eq('id', lb).maybeSingle();
    const b3 = await B.cli.from('listings').select('id').eq('id', la).maybeSingle();
    ok('2d por id (Detalle): A no obtiene la de B ni B la de A', a3.data === null && !a3.error && b3.data === null && !b3.error,
      `${describir(a3)} | ${describir(b3)}`);
    const a4 = await A.cli.rpc('buscar_listings', { q: 'termodinamica' }, { get: true }).select('id').in('id', todas);
    const b4 = await B.cli.rpc('buscar_listings', { q: 'termodinamica' }, { get: true }).select('id').in('id', todas);
    ok('2e buscar_listings: bilateral', ids(a4) === [la, lt].sort((x, y) => x - y).join(',')
      && ids(b4) === [lb, lt].sort((x, y) => x - y).join(','), `${describir(a4)} | ${describir(b4)}`);

    console.log('\n== 3. seller_whatsapp ==');
    const w1 = await A.cli.rpc('seller_whatsapp', { p_user_id: B.id });
    const w2 = await B.cli.rpc('seller_whatsapp', { p_user_id: A.id });
    ok('3a niega A→B y B→A (null, sin error)', w1.data === null && !w1.error && w2.data === null && !w2.error,
      `${describir(w1)} | ${describir(w2)}`);
    const w3 = await T.cli.rpc('seller_whatsapp', { p_user_id: A.id });
    const w4 = await A.cli.rpc('seller_whatsapp', { p_user_id: T.id });
    ok('3b control: el tercero recibe el número de A y A el del tercero',
      w3.data === '+528150000001' && w4.data === '+528150000003', `${describir(w3)} | ${describir(w4)}`);

    console.log('\n== 4. La fila de user_bloqueos ==');
    const f1 = await A.cli.from('user_bloqueos').select('user_id, bloqueado_id');
    ok('4a A lee su propia fila', (f1.data ?? []).length === 1 && f1.data[0].bloqueado_id === B.id, describir(f1));
    const f2 = await B.cli.from('user_bloqueos').select('user_id, bloqueado_id');
    ok('4b B no lee la fila que lo nombra (0 filas)', !f2.error && (f2.data ?? []).length === 0, describir(f2));
    const f3 = await T.cli.from('user_bloqueos').select('user_id, bloqueado_id');
    ok('4c el tercero tampoco', !f3.error && (f3.data ?? []).length === 0, describir(f3));
    const f4 = await B.cli.from('user_bloqueos').delete({ count: 'exact' }).eq('user_id', A.id);
    ok('4d B no borra la fila de A (0 filas afectadas) y la fila sigue',
      (f4.count ?? 0) === 0 && sql(`select count(*) from public.user_bloqueos where user_id = '${A.id}'`) === '1', describir(f4));
    const f5 = await B.cli.from('user_bloqueos').insert({ user_id: A.id, bloqueado_id: T.id });
    ok('4e B no crea un bloqueo a nombre de A → 403 / 42501', f5.status === 403 && f5.error?.code === '42501', describir(f5));

    console.log('\n== 5. interaccion_disponible ==');
    const d1 = await A.cli.rpc('interaccion_disponible', { p_user_id: B.id });
    const d2 = await B.cli.rpc('interaccion_disponible', { p_user_id: A.id });
    ok('5a false en las dos direcciones (el mismo booleano para quien bloquea y para el bloqueado)',
      d1.data === false && d2.data === false, `${describir(d1)} | ${describir(d2)}`);
    const d3 = await T.cli.rpc('interaccion_disponible', { p_user_id: A.id });
    const d4 = await A.cli.rpc('interaccion_disponible', { p_user_id: T.id });
    ok('5b true con el tercero', d3.data === true && d4.data === true, `${describir(d3)} | ${describir(d4)}`);

    console.log('\n== 6. Contactos nuevos ==');
    const c1 = await B.cli.from('listing_contacts').insert({ user_id: B.id, listing_id: la });
    ok('6a B no registra un contacto en la de A → 403 / 42501', c1.status === 403 && c1.error?.code === '42501', describir(c1));
    const c2 = await T.cli.from('listing_contacts').insert({ user_id: T.id, listing_id: la });
    ok('6b control: el tercero sí → 201', c2.status === 201 && !c2.error, describir(c2));

    console.log('\n== 7. anon ==');
    const anon = createClient(E.API_URL, E.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const n1 = await anon.from('user_bloqueos').select('user_id');
    const n2 = await anon.rpc('interaccion_disponible', { p_user_id: A.id });
    ok('7a anon no lee user_bloqueos ni llama interaccion_disponible', n1.error?.code === '42501' && !!n2.error,
      `${describir(n1)} | ${describir(n2)}`);

    console.log('\n== 7b. Vistas (increment_listing_view) ==');
    const v0a = vistas(la);
    const v0b = vistas(lb);
    const hb = await vistaHttp(E, B, la);   // A bloqueó a B: el dueño bloqueó al lector
    const ha = await vistaHttp(E, A, lb);   // el lector bloqueó al dueño
    ok('7b1 con bloqueo, ni B suma a la de A ni A a la de B',
      vistas(la) === v0a && vistas(lb) === v0b, `la ${v0a}→${vistas(la)}, lb ${v0b}→${vistas(lb)}`);
    const ht = await vistaHttp(E, T, la);   // control: el tercero sí suma
    ok('7b2 control: el tercero sí suma a la de A', vistas(la) === v0a + 1, `la ${v0a}→${vistas(la)}`);
    ok('7b3 la respuesta con bloqueo es idéntica a la que sí suma (status, cuerpo y headers)',
      hb.firma === ht.firma && ha.firma === ht.firma && ht.status === 204,
      `bloqueado ${hb.firma} | inverso ${ha.firma} | tercero ${ht.firma}`);

    console.log('\n== 8. Desbloquear restaura ==');
    const u1 = await A.cli.from('user_bloqueos').delete({ count: 'exact' }).eq('bloqueado_id', B.id);
    const a8 = await A.cli.from('listings').select('id').eq('id', lb);
    const d8 = await B.cli.rpc('interaccion_disponible', { p_user_id: A.id });
    ok('8a A borra su bloqueo, vuelve a ver la de B y B ve la interacción disponible',
      u1.count === 1 && ids(a8) === String(lb) && d8.data === true, `${describir(u1)} | ${describir(a8)} | ${describir(d8)}`);
    const v8a = vistas(la);
    const v8b = vistas(lb);
    const hb8 = await vistaHttp(E, B, la);
    const ha8 = await vistaHttp(E, A, lb);
    ok('8b sin bloqueo, la misma RPC vuelve a sumar en las dos direcciones y responde igual',
      vistas(la) === v8a + 1 && vistas(lb) === v8b + 1 && hb8.firma === ht.firma && ha8.firma === ht.firma,
      `la ${v8a}→${vistas(la)}, lb ${v8b}→${vistas(lb)} | ${hb8.firma}`);
  } finally {
    for (const id of creadas) await admin.auth.admin.deleteUser(id);
    const lista = creadas.length ? creadas.map((u) => `'${u}'`).join(',') : 'null';
    const restos = sql(`select (select count(*) from public.listings where user_id in (${lista}))
                            + (select count(*) from public.user_bloqueos where user_id in (${lista}) or bloqueado_id in (${lista}))`);
    console.log(`\nLimpieza: ${creadas.length} cuentas borradas; publicaciones y bloqueos que quedan: ${restos}`);
    if (restos !== '0') fallos.push('limpieza: quedaron filas');
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
