// ===========================================================================
// Relevo — la Edge Function `eliminar-publicacion` por HTTP (RF-17 Ola 4, D5).
//
// Cómo correrlo (local, DOS procesos):
//     supabase start
//     supabase functions serve --env-file supabase/functions/.env   # otra terminal
//     node scripts/probe-eliminar-publicacion.mjs
//
// QUÉ CUBRE:
// · Quién entra (sin credencial, la secret key como Bearer) y el body inválido.
// · El dueño activo elimina una activa y una BLOQUEADA: 0 filas y 0 objetos, y la
//   bloqueada deja su registro mínimo de moderación (20261007000482). La
//   bloqueada es el caso que motiva la función: con el cliente del usuario,
//   `remove()` ya no ve sus objetos (lo prueba probe-storage).
// · Quien no puede borrar (un tercero, un dueño suspendido) recibe 403
//   `no_borrable` y NO se toca Storage: decide la base (`listings_delete_own`).
// · Idempotencia: reintentar tras un borrado, y limpiar una carpeta huérfana
//   (sin fila) con cualquier sesión.
// · Storage falla DESPUÉS de borrar la fila → 200 `{huerfanos:true}`, no 500. Se
//   fuerza con un trigger sonda TEMPORAL sobre `storage.objects` que lanza en el
//   DELETE de una ruta marcada; se crea y se quita en este script, detrás de la
//   guarda de proyecto (hay más de un stack local en esta máquina).
//
// Gratis: sin llamadas a terceros. Los triggers de moderación de Storage no
// llaman a nada mientras Vault no tenga sus secretos (se imprime al arrancar).
// Si una corrida muere de golpe, `supabase db reset` limpia.
// ===========================================================================

import { execFileSync } from 'node:child_process';
import { guardaRelevo } from './_guarda-relevo.mjs';

const RUN = Date.now();
const DB = 'supabase_db_relevo-marketplace';
const PASS = 'probe-12345';
const SONDA = 'probe_elimpub_falla';

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
  if (cond) { pasadas++; console.log(`  ok — ${nombre}${detalle ? ` (${detalle})` : ''}`); }
  else { fallos.push(nombre); console.log(`  FALLÓ — ${nombre}${detalle ? ` (${detalle})` : ''}`); }
}

/** SQL como `postgres` dentro del contenedor. Solo con valores del propio probe. */
function sql(query) {
  return execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-Atc', query], { encoding: 'utf8' }).trim();
}
const n = (query) => Number(sql(query));

async function crearUsuario(E, correo) {
  const res = await fetch(`${E.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password: PASS, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`crearUsuario ${correo}: ${res.status} ${await res.text()}`);
  const id = (await res.json()).id;
  sql(`update public.users set nombre = 'Probador', campus_id = 1 where id = '${id}'`);
  return id;
}

async function token(E, correo) {
  const res = await fetch(`${E.API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: E.PUBLISHABLE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password: PASS }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`token ${correo}: ${res.status}`);
  return json.access_token;
}

/** `supabase.functions.invoke('eliminar-publicacion', { body })`, como la app. */
async function eliminar(E, bearer, body) {
  const headers = { apikey: E.PUBLISHABLE, 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${E.API_URL}/functions/v1/eliminar-publicacion`, {
    method: 'POST', headers, body: JSON.stringify(body ?? {}),
  });
  const texto = await res.text();
  let json = {};
  try { json = JSON.parse(texto); } catch { /* cuerpo no JSON */ }
  return { status: res.status, json, texto };
}

const subir = (E, tok, ruta) =>
  fetch(`${E.API_URL}/storage/v1/object/listing-photos/${ruta}`, {
    method: 'POST',
    headers: { apikey: E.PUBLISHABLE, Authorization: `Bearer ${tok}`, 'Content-Type': 'image/jpeg' },
    body: new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0xff, 0xd9]),
  });

const objetos = (id) => n(`select count(*) from storage.objects where bucket_id = 'listing-photos' and name like '${id}/%'`);
const filas = (id) => n(`select count(*) from public.listings where id = ${id}`);

/**
 * Una publicación del dueño con `nFotos` objetos, sembrada `activa` (las fotos
 * se suben mientras el dueño puede escribir en su carpeta) y movida después al
 * `estado` pedido como postgres. Para una bloqueada deja además una evaluación.
 */
async function publicacion(E, uid, tok, estado, nFotos = 2, marca = '') {
  const id = Number(sql(
    `insert into public.listings (user_id, categoria_id, universidad_id, campus_id, titulo, precio, condicion, estado)
     values ('${uid}', 1, 1, 1, 'probe-elimpub ${estado} ${RUN}', 100, 'nuevo', 'activa') returning id`).split('\n')[0]);
  for (let i = 0; i < nFotos; i++) {
    const r = await subir(E, tok, `${id}/${marca}${crypto.randomUUID()}.jpg`);
    if (!r.ok) throw new Error(`subir ${id}: ${r.status} ${await r.text()}`);
  }
  if (estado !== 'activa') {
    if (estado === 'bloqueada') {
      sql(`insert into public.listing_moderacion (listing_id, veredicto, estado_resultante, detalle)
           values (${id}, 'bloquear', 'bloqueada', '{"eje_que_manda":"listaTecleada"}')`);
    }
    sql(`update public.listings set estado = '${estado}' where id = ${id}`);
  }
  return id;
}

async function main() {
  const raw = env();
  const E = {
    API_URL: raw.API_URL,
    SECRET: raw.SECRET_KEY || raw.SERVICE_ROLE_KEY,
    PUBLISHABLE: raw.PUBLISHABLE_KEY || raw.ANON_KEY,
  };
  if (!E.API_URL || !E.SECRET) throw new Error('No hay stack local. Corre `supabase start` primero.');
  guardaRelevo({ apiUrl: E.API_URL });

  const vivo = await fetch(`${E.API_URL}/functions/v1/eliminar-publicacion`, { method: 'POST' }).catch(() => null);
  if (!vivo || vivo.status === 404 || vivo.status >= 500) {
    throw new Error('La función no responde. Corre `supabase functions serve --env-file supabase/functions/.env`.');
  }

  console.log('\n== Estado bajo prueba ==');
  console.log(`  policy de SELECT del bucket mira bloqueada: ${sql(
    "select pg_get_expr(polqual, polrelid) like '%bloqueada%' from pg_policy where polname = 'listing_photos_objects_select'")}`);
  console.log(`  trigger del registro retenido: ${sql(
    "select count(*) from pg_trigger where tgname = 'listings_retiene_moderacion'")}`);
  console.log(`  secretos de Vault (vacío = los triggers de Storage no llaman a nada): [${sql(
    "select coalesce(string_agg(name, ', '), '') from vault.secrets")}]`);

  const creados = [];
  try {
    const correoD = `probe-elimpub-d-${RUN}@tec.mx`;
    const correoT = `probe-elimpub-t-${RUN}@tec.mx`;
    const correoS = `probe-elimpub-s-${RUN}@tec.mx`;
    const D = await crearUsuario(E, correoD);
    const T = await crearUsuario(E, correoT);
    const S = await crearUsuario(E, correoS);
    creados.push(D, T, S);
    const tD = await token(E, correoD);
    const tT = await token(E, correoT);
    const tS = await token(E, correoS);

    console.log('\n== 1. Quién entra, y el body ==');
    ok('sin Authorization → 401', (await eliminar(E, null, { listing_id: 1 })).status === 401);
    ok('la SECRET key como Bearer → 401 (solo usuarios)', (await eliminar(E, E.SECRET, { listing_id: 1 })).status === 401);
    const malo = await eliminar(E, tD, { listing_id: 'x' });
    ok('listing_id que no es entero positivo → 400', malo.status === 400, `status ${malo.status}`);

    console.log('\n== 2. El dueño activo elimina: fila y objetos ==');
    const act = await publicacion(E, D, tD, 'activa');
    const r2 = await eliminar(E, tD, { listing_id: act });
    ok('una activa con 2 fotos → 200, 0 filas, 0 objetos',
      r2.status === 200 && !r2.json.huerfanos && filas(act) === 0 && objetos(act) === 0,
      `status ${r2.status} filas=${filas(act)} objetos=${objetos(act)}`);

    const bloq = await publicacion(E, D, tD, 'bloqueada');
    const r3 = await eliminar(E, tD, { listing_id: bloq });
    ok('una BLOQUEADA con 2 fotos (que el dueño ya no ve) → 200, 0 filas, 0 objetos',
      r3.status === 200 && filas(bloq) === 0 && objetos(bloq) === 0,
      `status ${r3.status} filas=${filas(bloq)} objetos=${objetos(bloq)}`);
    ok('…y deja su registro mínimo de moderación, con el dueño',
      n(`select count(*) from private.moderacion_retenida where listing_id = ${bloq} and user_id = '${D}'`) === 1);

    console.log('\n== 3. Quien no puede borrar: 403 y Storage intacto ==');
    const ajena = await publicacion(E, D, tD, 'activa');
    const r4 = await eliminar(E, tT, { listing_id: ajena });
    ok('un tercero → 403 no_borrable; la fila y sus 2 objetos siguen',
      r4.status === 403 && r4.json.error === 'no_borrable' && filas(ajena) === 1 && objetos(ajena) === 2,
      `status ${r4.status} ${r4.texto.slice(0, 60)} objetos=${objetos(ajena)}`);

    const deS = await publicacion(E, S, tS, 'activa');
    sql(`update public.users set estado = 'suspendido', suspendido_at = now(),
           suspension_motivo = 'probe-eliminar-publicacion' where id = '${S}'`);
    const r5 = await eliminar(E, tS, { listing_id: deS });
    ok('un dueño SUSPENDIDO → 403 no_borrable; su publicación (ahora pausada) y sus objetos siguen',
      r5.status === 403 && filas(deS) === 1 && objetos(deS) === 2,
      `status ${r5.status} objetos=${objetos(deS)}`);

    console.log('\n== 4. Idempotencia ==');
    const r6 = await eliminar(E, tD, { listing_id: act });
    ok('reintentar sobre una ya eliminada → 200 (la fila no existe: solo limpia)',
      r6.status === 200 && objetos(act) === 0, `status ${r6.status}`);

    // Una carpeta huérfana: la fila se borra como postgres sin tocar Storage
    // (lo que dejaba la app vieja), y la limpia otra sesión cualquiera.
    const huerf = await publicacion(E, D, tD, 'activa');
    sql(`delete from public.listings where id = ${huerf}`);
    const antesHuerf = objetos(huerf);
    const r7 = await eliminar(E, tT, { listing_id: huerf });
    ok('una carpeta sin fila la limpia cualquier sesión → 200 y 0 objetos',
      antesHuerf === 2 && r7.status === 200 && objetos(huerf) === 0,
      `antes=${antesHuerf} status ${r7.status} después=${objetos(huerf)}`);

    console.log('\n== 5. Storage falla después de borrar la fila ==');
    const fall = await publicacion(E, D, tD, 'activa', 1, `${SONDA}-`);
    sql(`create or replace function public.${SONDA}() returns trigger language plpgsql as $f$
         begin
           if old.name like '%${SONDA}%' then raise exception 'sonda: falla forzada de Storage'; end if;
           return old;
         end $f$`);
    sql(`create trigger ${SONDA} before delete on storage.objects for each row execute function public.${SONDA}()`);
    console.log(`  sonda puesta: ${sql(`select count(*) from pg_trigger where tgname = '${SONDA}'`)} trigger(s)`);
    const r8 = await eliminar(E, tD, { listing_id: fall });
    ok('la fila se borró y Storage falló → 200 {huerfanos:true}, no 500',
      r8.status === 200 && r8.json.huerfanos === true && filas(fall) === 0 && objetos(fall) === 1,
      `status ${r8.status} ${r8.texto.slice(0, 80)} filas=${filas(fall)} objetos=${objetos(fall)}`);
    sql(`drop trigger ${SONDA} on storage.objects; drop function public.${SONDA}()`);
    const r9 = await eliminar(E, tD, { listing_id: fall });
    ok('…y sin la falla, reinvocar limpia el huérfano → 200 y 0 objetos',
      r9.status === 200 && !r9.json.huerfanos && objetos(fall) === 0, `status ${r9.status}`);
  } finally {
    try { sql(`drop trigger if exists ${SONDA} on storage.objects; drop function if exists public.${SONDA}()`); }
    catch { /* nada que hacer */ }
    // Objetos que hayan quedado (por un control negativo), por el API: por SQL
    // no se puede (storage.protect_delete, CLAUDE.md §9).
    const restos = sql(`select name from storage.objects where bucket_id = 'listing-photos'
                         and owner_id in (${creados.map((i) => `'${i}'`).join(',') || "''"})`).split('\n').filter(Boolean);
    if (restos.length) {
      await fetch(`${E.API_URL}/storage/v1/object/listing-photos`, {
        method: 'DELETE',
        headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: restos }),
      });
    }
    for (const id of creados) {
      await fetch(`${E.API_URL}/auth/v1/admin/users/${id}`, {
        method: 'DELETE', headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      });
    }
    sql(`delete from private.moderacion_retenida where user_id in (${creados.map((i) => `'${i}'`).join(',') || "'00000000-0000-0000-0000-000000000000'"})`);
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
