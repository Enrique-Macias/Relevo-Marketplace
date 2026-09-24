// ===========================================================================
// Relevo — el amarre entre las validaciones del perfil del CLIENTE
// (`src/lib/validacion-perfil.ts`) y los `check` de la BASE que las hacen
// cumplir (`users_nombre_valido`, migración 20260927000469).
//
// Cómo correrlo (local, con el stack arriba):
//     supabase start           # o supabase db reset
//     node scripts/probe-perfil.mjs
//
// POR QUÉ EXISTE, SI YA HAY UNA SUITE DE RLS:
// T31 (`supabase/tests/rls.sql`) prueba el check. Lo que no puede ver es que
// el cliente diga LO MISMO: la regla está escrita dos veces, en SQL y en
// TypeScript, y si se desincronizan no falla nada — el usuario ve un botón
// habilitado y un rechazo crudo al guardar, o un error bajo el campo sobre un
// nombre que la base habría aceptado. Mismo tipo de amarre que
// `probe-registro.mjs`: el módulo no tiene imports justamente para que Node lo
// cargue (type stripping), así que aquí corre la implementación REAL, no una
// transcripción.
//
// Tres cosas que vigila:
//   (i)  los casos crudos contra el check real dan el veredicto esperado — los
//        mismos de T31, más algunos que solo tienen sentido del lado cliente;
//   (ii) el contrato del cliente: `nombreValido(x)` coincide con lo que la base
//        responde a lo que el cliente MANDARÍA, que es `normalizarNombre(x)`;
//   (iii) la definición de "letra" es literalmente la misma: `CLASE_LETRA`
//        aparece tal cual (con sus escapes `\uXXXX`) en la definición viva del
//        constraint, y las cotas de longitud también.
//
// No deja estado: todo corre dentro de un `begin … rollback`.
// ===========================================================================

import { execFileSync } from 'node:child_process';

import {
  CLASE_LETRA,
  NOMBRE_MAX,
  NOMBRE_MIN,
  nombreValido,
  normalizarNombre,
} from '../src/lib/validacion-perfil.ts';

const DB = 'supabase_db_relevo-marketplace';
const PROBE_UID = '31313131-0000-0000-0000-00000000ffff';

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

/** SQL como `postgres` dentro del contenedor, por stdin. Solo valores del probe. */
function psql(script) {
  return execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-At', '-q'], { encoding: 'utf8', input: script }).trim();
}

const lit = (s) => (s === null ? 'null' : `'${s.replace(/'/g, "''")}'`);

/**
 * El veredicto del check REAL para cada valor: 'ok' o '<sqlstate>:<constraint>'.
 * Un UPDATE de `nombre` sobre una cuenta del propio probe, dentro de una
 * transacción que se deshace. Como `postgres`: lo que se amarra es el CHECK;
 * que `authenticated` llegue a él por su grant ya lo prueba T31.
 */
function veredictosBase(valores) {
  const filas = valores.map((v, i) => `(${i}, ${lit(v)})`).join(',\n');
  const out = psql(`
begin;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('${PROBE_UID}', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'probe-perfil@tec.mx', '', now(), now(), now());
create function pg_temp.v(p text) returns text language plpgsql as $$
declare c text;
begin
  update public.users set nombre = p where id = '${PROBE_UID}';
  return 'ok';
exception when others then
  get stacked diagnostics c = constraint_name;
  return sqlstate || coalesce(':' || nullif(c, ''), '');
end $$;
select i || '|' || pg_temp.v(v) from (values ${filas}) as t(i, v) order by i;
rollback;
`);
  const res = [];
  for (const linea of out.split('\n')) {
    const [i, v] = linea.split('|');
    if (v !== undefined) res[Number(i)] = v;
  }
  return res;
}

const RECHAZO = '23514:users_nombre_valido';
const texto = (s) => (s === null ? 'NULL' : JSON.stringify(s));

// Los casos de T31 (mismo veredicto crudo esperado), más los que solo tienen
// sentido del lado cliente. `null` en `cliente` = no aplica (el campo vacío no
// se evalúa: la pantalla no deja guardar y no pinta error).
const CASOS = [
  // T31
  { v: 'José Ñúñez', base: 'ok', cliente: true },
  { v: 'María-José', base: 'ok', cliente: true },
  { v: "O'Connor", base: 'ok', cliente: true },
  { v: 'Müller', base: 'ok', cliente: true },
  { v: null, base: 'ok', cliente: null },
  { v: 'Juan123', base: RECHAZO, cliente: false },
  { v: 'Juan_', base: RECHAZO, cliente: false },
  { v: '  Juan', base: RECHAZO, cliente: true }, // el cliente lo recorta: manda "Juan"
  { v: 'Juan  Pérez', base: RECHAZO, cliente: true }, // …y lo colapsa: "Juan Pérez"
  { v: 'J', base: RECHAZO, cliente: false },
  { v: 'a'.repeat(51), base: RECHAZO, cliente: false },
  { v: 'Juan 😀', base: RECHAZO, cliente: false },
  { v: 'José'.normalize('NFD'), base: RECHAZO, cliente: true }, // el cliente pasa a NFC
  // Solo de este lado
  { v: 'O’Brien', base: 'ok', cliente: true }, // apóstrofe tipográfico
  { v: 'Łódź Żaneta', base: 'ok', cliente: true }, // Latin Extended-A
  { v: 'a'.repeat(50), base: 'ok', cliente: true }, // borde exacto
  { v: 'Al', base: 'ok', cliente: true }, // borde exacto
  { v: 'Ana--Luz', base: RECHAZO, cliente: false }, // separadores seguidos
  { v: "Ana-'Luz", base: RECHAZO, cliente: false },
  { v: '-Ana', base: RECHAZO, cliente: false }, // separador al borde
  { v: "Ana'", base: RECHAZO, cliente: false },
  { v: 'Ana×Luz', base: RECHAZO, cliente: false }, // × (U+00D7), el hueco de Latin-1
  { v: 'Ana÷Luz', base: RECHAZO, cliente: false }, // ÷ (U+00F7), el otro
  { v: 'Ana\tLuz', base: RECHAZO, cliente: true }, // el cliente colapsa el tab a espacio
  { v: 'Ana Luz ', base: RECHAZO, cliente: true }, // espacio final: recortado
  { v: 'Ștefan', base: RECHAZO, cliente: false }, // Ș es Latin Extended-B: fuera
];

function main() {
  const def = psql(
    "select pg_get_constraintdef(oid) from pg_constraint where conname = 'users_nombre_valido'");
  console.log(`\nDefinición VIVA de users_nombre_valido:\n  ${def || '(NO EXISTE)'}`);
  console.log(`CLASE_LETRA del cliente:\n  ${CLASE_LETRA}\n`);

  console.log('== (iii) la misma definición de "letra" y las mismas cotas');
  const apariciones = def.split(CLASE_LETRA).length - 1;
  ok('CLASE_LETRA aparece literal en el check, en sus DOS clases', apariciones === 2,
    `${apariciones} aparición(es)`);
  ok(`la cota inferior del check es ${NOMBRE_MIN}`, def.includes(`char_length(nombre) >= ${NOMBRE_MIN}`));
  ok(`la cota superior del check es ${NOMBRE_MAX}`, def.includes(`char_length(nombre) <= ${NOMBRE_MAX}`));

  // Una sola llamada a la base con los crudos y los normalizados.
  const crudos = CASOS.map((c) => c.v);
  const normalizados = CASOS.map((c) => (c.v === null ? null : normalizarNombre(c.v)));
  const base = veredictosBase([...crudos, ...normalizados]);
  const baseCrudo = base.slice(0, CASOS.length);
  const baseNorm = base.slice(CASOS.length);

  console.log('\n== (i) el check real, con el valor CRUDO');
  CASOS.forEach((c, i) => {
    ok(`${texto(c.v)} → ${c.base}`, baseCrudo[i] === c.base, `base dijo ${baseCrudo[i]}`);
  });

  console.log('\n== (ii) el cliente dice lo mismo que la base sobre lo que MANDARÍA');
  CASOS.forEach((c, i) => {
    if (c.cliente === null) return;
    const cliente = nombreValido(c.v);
    const baseAcepta = baseNorm[i] === 'ok';
    ok(`${texto(c.v)} → cliente ${cliente}, base(normalizado ${texto(normalizados[i])}) ${baseNorm[i]}`,
      cliente === c.cliente && cliente === baseAcepta);
  });

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

try {
  main();
} catch (e) {
  console.error(`\n${e.message}`);
  process.exit(1);
}
