#!/usr/bin/env node
// ===========================================================================
// Relevo — aceptación de los términos por HTTP (PL-016, 20261026000490).
//
// Cómo correrlo (local):
//     supabase start
//     node scripts/probe-terminos.mjs
//
// QUÉ CUBRE: la forma EXACTA de las llamadas de la app, con la misma
// `@supabase/supabase-js` (fijada en package.json), contra PostgREST de
// verdad. `supabase/tests/rls.sql` (T42) prueba la semántica en SQL; esto
// prueba lo que PostgREST emite, que es lo que la app tiene que reconocer:
//
//   - `rpc('estado_terminos')`: la vigente de cada documento, su URL y si la
//     sesión la aceptó.
//   - `rpc('aceptar_terminos', { p_version_terminos, p_version_aviso })`:
//     204; una versión que no es la vigente da 400 / 22023
//     `version_no_vigente`; aceptar dos veces no duplica.
//   - Sin aceptar: publicar da 403 / 42501 por RLS, editar la propia da
//     403 / 42501 `terminos_no_aceptados` (el texto que la app reconoce para
//     abrir "Términos actualizados"), `seller_whatsapp` da null, y pausar SÍ
//     pasa. Después de aceptar, las mismas llamadas pasan.
//   - El cliente no inserta aceptaciones; anon no llama a ninguna de las dos RPC.
//
// Escribe en la base local (cuentas temporales), así que pasa primero por la
// guarda de proyecto. Limpia lo suyo: borra sus cuentas por el admin API y el
// cascade se lleva sus publicaciones y aceptaciones.
// ===========================================================================

import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { guardaRelevo, CONTENEDOR_DB } from './_guarda-relevo.mjs';
import { aceptarTerminosDePrueba, asegurarVersionesDePrueba } from './_terminos-prueba.mjs';

const RUN = Date.now().toString(36);
const PASS = 'probe-terminos-1234';

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
const rls = (r) => r.status === 403 && r.error?.code === '42501' && /row-level security/.test(r.error?.message ?? '');

async function main() {
  const E = env();
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(E.API_URL)) throw new Error('solo contra el stack local');
  guardaRelevo({ apiUrl: E.API_URL });

  const vig = await asegurarVersionesDePrueba(E.API_URL, E.SECRET_KEY);
  console.log('Estado bajo prueba:');
  console.log(`  vigentes: terminos=${vig.terminos}, aviso_privacidad=${vig.aviso_privacidad}`);
  console.log(`  aceptar_terminos definer: ${sql(`select prosecdef from pg_proc where oid = 'public.aceptar_terminos(text, text)'::regprocedure`)}`);
  console.log(`  policies con el helper: ${sql(`select count(*) from pg_policies where with_check like '%terminos_vigentes_aceptados%'`)}`);
  console.log(`  triggers: ${sql(`select string_agg(tgname, ', ' order by tgname) from pg_trigger where tgname in ('listings_exige_terminos', 'users_exige_terminos')`)}`);

  const admin = createClient(E.API_URL, E.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const creadas = [];
  const crear = async (etiqueta, { acepta = false, telefono = null } = {}) => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `probe-terminos-${etiqueta}-${RUN}@tec.mx`, password: PASS, email_confirm: true });
    if (error) throw new Error(`createUser ${etiqueta}: ${error.message}`);
    creadas.push(data.user.id);
    sql(`update public.users set nombre = 'Probador', telefono = ${telefono ? `'${telefono}'` : 'null'},
           campus_id = (select c.id from public.campus c where c.universidad_id = users.universidad_id order by c.id limit 1)
         where id = '${data.user.id}'`);
    if (acepta) await aceptarTerminosDePrueba(E.API_URL, E.SECRET_KEY, data.user.id);
    const cli = createClient(E.API_URL, E.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: e2 } = await cli.auth.signInWithPassword({ email: data.user.email, password: PASS });
    if (e2) throw new Error(`login ${etiqueta}: ${e2.message}`);
    return { id: data.user.id, cli };
  };
  const aceptaciones = (uid) => sql(`select count(*) from public.aceptaciones_legales where user_id = '${uid}'`);
  const nuevaListing = (uid, estado) => Number(sql(
    `insert into public.listings (user_id, categoria_id, universidad_id, campus_id, titulo, precio, condicion, estado)
     select id, 1, universidad_id, campus_id, 'probe-terminos', 100, 'usado', '${estado}'
       from public.users where id = '${uid}' returning id`).split('\n')[0]);

  try {
    const N = await crear('n');
    const X = await crear('x', { acepta: true, telefono: '+528142009999' });
    const lnA = nuevaListing(N.id, 'activa');
    const lnB = nuevaListing(N.id, 'activa');
    const fila = { categoria_id: 1, titulo: 'probe-terminos nueva', precio: 10, condicion: 'usado', estado: 'pendiente' };
    const campus = sql(`select universidad_id || ',' || campus_id from public.users where id = '${N.id}'`).split(',');
    const nueva = { ...fila, user_id: N.id, universidad_id: Number(campus[0]), campus_id: Number(campus[1]) };

    console.log('\n== 1. El estado de una cuenta que no ha aceptado ==');
    const e1 = await N.cli.rpc('estado_terminos');
    const porTipo = Object.fromEntries((e1.data ?? []).map((d) => [d.tipo, d]));
    ok('1a estado_terminos → las dos vigentes, con su fecha y su URL, sin aceptar ninguna',
      e1.status === 200 && e1.data?.length === 2
      && porTipo.terminos?.version === vig.terminos && porTipo.aviso_privacidad?.version === vig.aviso_privacidad
      && /^https:\/\//.test(porTipo.terminos?.url ?? '') && /^https:\/\//.test(porTipo.aviso_privacidad?.url ?? '')
      && e1.data.every((d) => d.aceptado === false && d.acepto_alguna === false && !Number.isNaN(Date.parse(d.vigente_desde))),
      e1.error ? describir(e1) : JSON.stringify(e1.data));

    console.log('\n== 2. Sin aceptar: lo que se rechaza y lo que no ==');
    const p1 = await N.cli.from('listings').insert(nueva);
    ok('2a publicar → 403 / 42501 por RLS', rls(p1), describir(p1));
    const p2 = await N.cli.from('listings').update({ titulo: 'probe-terminos editada' }).eq('id', lnA);
    ok('2b editar la propia → 403 / 42501 terminos_no_aceptados (el texto que la app reconoce)',
      p2.status === 403 && p2.error?.code === '42501' && p2.error?.message === 'terminos_no_aceptados', describir(p2));
    const p3 = await N.cli.rpc('seller_whatsapp', { p_user_id: X.id });
    ok('2c seller_whatsapp → null', p3.status === 200 && p3.data === null, describir(p3));
    const p4 = await N.cli.from('listings').update({ estado: 'pausada' }, { count: 'exact' }).eq('id', lnB);
    ok('2d pausar la propia SÍ pasa (1 fila)', !p4.error && p4.count === 1, `${describir(p4)} count=${p4.count}`);
    const p5 = await N.cli.from('aceptaciones_legales')
      .insert({ user_id: N.id, tipo: 'terminos', version: vig.terminos, accion: 'aceptado' });
    ok('2e insertar una aceptación directo → 403 / 42501, sin fila',
      p5.status === 403 && p5.error?.code === '42501' && aceptaciones(N.id) === '0', describir(p5));

    console.log('\n== 3. Aceptar ==');
    const a1 = await N.cli.rpc('aceptar_terminos', { p_version_terminos: 'vieja', p_version_aviso: vig.aviso_privacidad });
    ok('3a una versión que no es la vigente → 400 / 22023 version_no_vigente, sin fila',
      a1.status === 400 && a1.error?.code === '22023' && a1.error?.message === 'version_no_vigente'
      && aceptaciones(N.id) === '0', describir(a1));
    const a2 = await N.cli.rpc('aceptar_terminos', { p_version_terminos: vig.terminos, p_version_aviso: vig.aviso_privacidad });
    ok('3b las vigentes → 204 y dos filas (Términos aceptado, Aviso presentado)',
      a2.status === 204 && !a2.error
      && sql(`select string_agg(tipo || ':' || accion, ',' order by tipo) from public.aceptaciones_legales where user_id = '${N.id}'`)
        === 'aviso_privacidad:presentado,terminos:aceptado', describir(a2));
    ok('3c la hora la puso el servidor (hace menos de un minuto)',
      sql(`select bool_and(aceptado_at > now() - interval '1 minute') from public.aceptaciones_legales where user_id = '${N.id}'`) === 't');
    const a3 = await N.cli.rpc('aceptar_terminos', { p_version_terminos: vig.terminos, p_version_aviso: vig.aviso_privacidad });
    ok('3d aceptar otra vez → 204, siguen dos filas', a3.status === 204 && aceptaciones(N.id) === '2', describir(a3));
    const e2 = await N.cli.rpc('estado_terminos');
    ok('3e estado_terminos → aceptado (y alguna aceptada) en los dos', e2.status === 200 && e2.data?.length === 2 && e2.data.every((d) => d.aceptado && d.acepto_alguna),
      e2.error ? describir(e2) : JSON.stringify(e2.data));

    console.log('\n== 4. Después de aceptar, las mismas llamadas pasan ==');
    const q1 = await N.cli.from('listings').insert(nueva);
    ok('4a publicar → 201', q1.status === 201 && !q1.error, describir(q1));
    const q2 = await N.cli.from('listings').update({ titulo: 'probe-terminos editada' }, { count: 'exact' }).eq('id', lnA);
    ok('4b editar la propia → 1 fila', !q2.error && q2.count === 1, `${describir(q2)} count=${q2.count}`);
    const q3 = await N.cli.rpc('seller_whatsapp', { p_user_id: X.id });
    ok('4c seller_whatsapp → el número', q3.status === 200 && q3.data === '+528142009999', describir(q3));

    console.log('\n== 5. anon ==');
    const anon = createClient(E.API_URL, E.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const s1 = await anon.rpc('aceptar_terminos', { p_version_terminos: vig.terminos, p_version_aviso: vig.aviso_privacidad });
    const s2 = await anon.rpc('estado_terminos');
    ok('5a anon no llama a aceptar_terminos ni a estado_terminos → 401 / 42501',
      s1.status === 401 && s1.error?.code === '42501' && s2.status === 401 && s2.error?.code === '42501',
      `${describir(s1)} | ${describir(s2)}`);
  } finally {
    for (const id of creadas) await admin.auth.admin.deleteUser(id);
    const restos = sql(`select count(*) from public.aceptaciones_legales where user_id in (${
      creadas.length ? creadas.map((u) => `'${u}'`).join(',') : 'null'})`);
    console.log(`\nLimpieza: ${creadas.length} cuentas borradas; aceptaciones que quedan: ${restos}`);
    if (restos !== '0') fallos.push('limpieza: quedaron aceptaciones');
  }

  console.log('\n===========================================');
  if (fallos.length) {
    console.log(`   ${fallos.length} FALLARON de ${pasadas + fallos.length}`);
    console.log('===========================================');
    process.exit(1);
  }
  console.log(`   LAS ${pasadas} PRUEBAS PASARON`);
  console.log('===========================================');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
