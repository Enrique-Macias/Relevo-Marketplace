#!/usr/bin/env node
// ===========================================================================
// Relevo — `public.actividad_diaria` por HTTP (RF-17 Ola 6, 20261009000485).
//
// Cómo correrlo (local):
//     supabase start
//     node scripts/probe-actividad.mjs
//
// QUÉ CUBRE: la forma EXACTA en que la app registra su señal de actividad, con
// la misma `@supabase/supabase-js` que la app (fijada en package.json), contra
// PostgREST de verdad. `supabase/tests/rls.sql` (T38) prueba la semántica en
// SQL; esto prueba lo que PostgREST emite para cada forma del cliente, que es
// lo que decide si una forma funciona (docs/rf17-ola6-plan.md, anexo C):
//
//   - `insert({ user_id })` plano: 201; el día lo pone el servidor (hora de
//     México) y una segunda señal del mismo día es 409 / 23505, que el cliente
//     trata como éxito.
//   - TRIPWIRE: `upsert(...)` con o sin `onConflict`, y con
//     `ignoreDuplicates`, da 403 / 42501 (PostgREST siempre pone target en el
//     ON CONFLICT, y el target exige SELECT); `.insert(...).select()` también
//     (RETURNING de columnas). Si alguien "simplifica" el cliente a una de esas
//     formas, la métrica se queda en cero en silencio: este probe lo grita.
//   - El cliente no fija el día, no inserta a nombre de otro, no lee, no
//     actualiza ni borra; anon no hace nada; un suspendido SÍ registra (D-5).
//
// Escribe en la base local (cuentas temporales y sus filas de actividad), así
// que pasa primero por la guarda de proyecto. Limpia lo suyo: borra sus
// cuentas por el admin API y el cascade se lleva sus filas.
// ===========================================================================

import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { guardaRelevo, CONTENEDOR_DB } from './_guarda-relevo.mjs';

const RUN = Date.now().toString(36);
const PASS = 'probe-actividad-1234';

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

async function main() {
  const E = env();
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(E.API_URL)) throw new Error('solo contra el stack local');
  guardaRelevo({ apiUrl: E.API_URL });

  console.log('Estado bajo prueba:');
  console.log(`  privilegios: ${sql(`select coalesce(string_agg(grantee || ':' || column_name || ':' || privilege_type, ', ' order by 1), '(ninguno)')
    from information_schema.column_privileges where table_name = 'actividad_diaria' and grantee in ('anon', 'authenticated')`)}`);
  console.log(`  policies: ${sql(`select coalesce(string_agg(policyname || '/' || cmd, ', '), '(ninguna)') from pg_policies where tablename = 'actividad_diaria'`)}`);

  const admin = createClient(E.API_URL, E.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const creadas = [];
  const crear = async (etiqueta) => {
    const { data, error } = await admin.auth.admin.createUser({
      email: `probe-actividad-${etiqueta}-${RUN}@tec.mx`, password: PASS, email_confirm: true });
    if (error) throw new Error(`createUser ${etiqueta}: ${error.message}`);
    creadas.push(data.user.id);
    const cli = createClient(E.API_URL, E.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: e2 } = await cli.auth.signInWithPassword({ email: data.user.email, password: PASS });
    if (e2) throw new Error(`login ${etiqueta}: ${e2.message}`);
    return { id: data.user.id, cli };
  };
  const filas = (uid) => sql(`select count(*) from public.actividad_diaria where user_id = '${uid}'`);

  try {
    const U = await crear('u');
    const V = await crear('v');
    const S = await crear('s');
    sql(`update public.users set estado = 'suspendido', suspendido_at = now(), suspension_motivo = 'probe-actividad'
          where id = '${S.id}'`);
    const T = U.cli.from('actividad_diaria');

    console.log('\n== 1. La forma de la app: insert({ user_id }) plano ==');
    const r1 = await T.insert({ user_id: U.id });
    ok('1a primera señal del día → 201', r1.status === 201 && !r1.error, describir(r1));
    ok('1b el día lo puso el servidor: hoy en America/Mexico_City',
      sql(`select (dia = (now() at time zone 'America/Mexico_City')::date)::text from public.actividad_diaria
            where user_id = '${U.id}'`) === 'true');
    const r2 = await U.cli.from('actividad_diaria').insert({ user_id: U.id });
    ok('1c segunda señal del mismo día → 409 / 23505 (el cliente la trata como éxito), y sigue habiendo 1 fila',
      r2.status === 409 && r2.error?.code === '23505' && filas(U.id) === '1', describir(r2));

    console.log('\n== 2. TRIPWIRE: las formas que NO deben usarse ==');
    const t1 = await V.cli.from('actividad_diaria').upsert({ user_id: V.id }, { ignoreDuplicates: true });
    ok('2a upsert + ignoreDuplicates SIN onConflict → 403 / 42501', t1.status === 403 && t1.error?.code === '42501', describir(t1));
    const t2 = await V.cli.from('actividad_diaria').upsert({ user_id: V.id }, { onConflict: 'user_id,dia', ignoreDuplicates: true });
    ok('2b upsert + ignoreDuplicates con onConflict user_id,dia → 403 / 42501', t2.status === 403 && t2.error?.code === '42501', describir(t2));
    const t3 = await V.cli.from('actividad_diaria').upsert({ user_id: V.id });
    ok('2c upsert a secas (ON CONFLICT DO UPDATE) → 403 / 42501', t3.status === 403 && t3.error?.code === '42501', describir(t3));
    const t4 = await V.cli.from('actividad_diaria').insert({ user_id: V.id }).select();
    ok('2d insert(...).select() → 403 / 42501', t4.status === 403 && t4.error?.code === '42501', describir(t4));
    ok('2e ninguna de esas formas dejó fila', filas(V.id) === '0', `filas de V: ${filas(V.id)}`);

    console.log('\n== 3. Lo que el cliente no puede hacer ==');
    const d1 = await U.cli.from('actividad_diaria').insert({ user_id: U.id, dia: '2020-01-01' });
    ok('3a fijar un día arbitrario → 403 / 42501 (sin grant sobre dia)',
      d1.status === 403 && d1.error?.code === '42501' && /permission denied/.test(d1.error?.message ?? ''), describir(d1));
    const d2 = await U.cli.from('actividad_diaria').insert({ user_id: V.id });
    ok('3b insertar con el user_id de otra cuenta → 403 / 42501 por RLS',
      d2.status === 403 && d2.error?.code === '42501' && /row-level security/.test(d2.error?.message ?? ''), describir(d2));
    const d3 = await U.cli.from('actividad_diaria').select('user_id, dia');
    ok('3c leer → 403 / 42501', d3.status === 403 && d3.error?.code === '42501', describir(d3));
    const d4 = await U.cli.from('actividad_diaria').update({ user_id: U.id }).eq('user_id', U.id);
    ok('3d actualizar → 403 / 42501', d4.status === 403 && d4.error?.code === '42501', describir(d4));
    const d5 = await U.cli.from('actividad_diaria').delete().eq('user_id', U.id);
    ok('3e borrar → 403 / 42501, y la fila de U sigue',
      d5.status === 403 && d5.error?.code === '42501' && filas(U.id) === '1', describir(d5));
    const anon = createClient(E.API_URL, E.PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const a1 = await anon.from('actividad_diaria').insert({ user_id: U.id });
    const a2 = await anon.from('actividad_diaria').select('user_id');
    ok('3f anon no inserta ni lee → 401/403 con 42501', a1.error?.code === '42501' && a2.error?.code === '42501',
      `${describir(a1)} | ${describir(a2)}`);

    console.log('\n== 4. Un suspendido registra su actividad (D-5) ==');
    const s1 = await S.cli.from('actividad_diaria').insert({ user_id: S.id });
    ok('4a la cuenta suspendida inserta su señal → 201', s1.status === 201 && !s1.error && filas(S.id) === '1', describir(s1));
  } finally {
    for (const id of creadas) await admin.auth.admin.deleteUser(id);
    const restos = sql(`select count(*) from public.actividad_diaria where user_id in (${
      creadas.length ? creadas.map((u) => `'${u}'`).join(',') : 'null'})`);
    console.log(`\nLimpieza: ${creadas.length} cuentas borradas; filas de actividad que quedan: ${restos}`);
    if (restos !== '0') fallos.push('limpieza: quedaron filas de actividad');
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
