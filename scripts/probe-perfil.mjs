// ===========================================================================
// Relevo — el amarre entre las validaciones del perfil del CLIENTE
// (`src/lib/validacion-perfil.ts`) y los `check` de la BASE que las hacen
// cumplir (`users_nombre_valido`, 20260927000469; `users_telefono_e164`,
// 20260927000470).
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
//   (iv)-(viii) el teléfono: los casos de T31 contra el check; el contrato por
//        país del cliente; la INCLUSIÓN cliente ⊆ base con el número de ejemplo
//        de cada país de la metadata (lo que libphonenumber da por bueno, la base
//        también lo acepta — si no, sería un rechazo crudo al guardar); que la
//        lista del selector (`src/lib/paises.ts`) coincida con esa metadata; y
//        que los +52 guardados se separen igual que antes.
//
// No deja estado: todo corre dentro de un `begin … rollback`.
// ===========================================================================

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

import {
  getCountries,
  getCountryCallingCode,
  isSupportedCountry,
} from 'libphonenumber-js/min';

import { PAISES } from '../src/lib/paises.ts';

import {
  aE164,
  CLASE_LETRA,
  formaE164Valida,
  NOMBRE_MAX,
  NOMBRE_MIN,
  nombreValido,
  normalizarNombre,
  separarE164,
  telefonoValido,
} from '../src/lib/validacion-perfil.ts';

const EJEMPLOS = createRequire(import.meta.url)('libphonenumber-js/examples.mobile.json');

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
 * Un UPDATE de `columna` sobre una cuenta del propio probe, dentro de una
 * transacción que se deshace. Como `postgres`: lo que se amarra es el CHECK;
 * que `authenticated` llegue a él por su grant ya lo prueba T31.
 */
function veredictosBase(columna, valores) {
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
  update public.users set ${columna} = p where id = '${PROBE_UID}';
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
const RECHAZO_TEL = '23514:users_telefono_e164';

// T31 (n)-(v), mismo veredicto crudo esperado.
const CASOS_TEL = [
  { v: '+528112345678', base: 'ok' },
  { v: '+12025550123', base: 'ok' },
  { v: '+34612345678', base: 'ok' },
  { v: '+5281123456', base: RECHAZO_TEL },
  { v: '+5281123456789', base: RECHAZO_TEL },
  { v: '+0123456789', base: RECHAZO_TEL },
  { v: '+52811234abcd', base: RECHAZO_TEL },
  { v: '528112345678', base: RECHAZO_TEL },
  { v: '+1234567890123456', base: RECHAZO_TEL },
];

// El contrato por país del cliente: lo que la pantalla deja guardar.
const CAPTURAS = [
  { pais: 'MX', t: '81 1234 5678', ok: true, e164: '+528112345678' },
  { pais: 'MX', t: '81-1234-5678', ok: true, e164: '+528112345678' },
  { pais: 'MX', t: '528112345678', ok: true, e164: '+528112345678' }, // lada pegada sin +
  { pais: 'MX', t: '81 1234', ok: false },
  { pais: 'MX', t: '0012345678', ok: false }, // 10 dígitos, prefijo imposible
  { pais: 'MX', t: '5215512345678', ok: false }, // el "1" viejo de móvil
  { pais: 'US', t: '(202) 555-0123', ok: true, e164: '+12025550123' },
  { pais: 'CA', t: '202 555 0123', ok: true, e164: '+12025550123' }, // misma lada +1
  { pais: 'US', t: '123 555 0123', ok: false }, // área que no existe
  { pais: 'ES', t: '612 34 56 78', ok: true, e164: '+34612345678' },
  { pais: 'ES', t: '612 34', ok: false },
  { pais: 'GB', t: '07911 123456', ok: true, e164: '+447911123456' }, // prefijo troncal 0
  { pais: 'DE', t: '0151 12345678', ok: true, e164: '+4915112345678' },
];
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
  const base = veredictosBase('nombre', [...crudos, ...normalizados]);
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

  console.log('\n== (iv) teléfono: el check real, con el valor CRUDO');
  const defTel = psql(
    "select pg_get_constraintdef(oid) from pg_constraint where conname = 'users_telefono_e164'");
  console.log(`  vivo: ${defTel || '(NO EXISTE)'}`);
  const telCrudo = veredictosBase('telefono', CASOS_TEL.map((c) => c.v));
  CASOS_TEL.forEach((c, i) => {
    ok(`${c.v} → ${c.base}`, telCrudo[i] === c.base, `base dijo ${telCrudo[i]}`);
    // El gemelo del check en TS dice lo mismo que el check.
    ok(`  formaE164Valida(${c.v}) coincide con la base`,
      formaE164Valida(c.v) === (telCrudo[i] === 'ok'));
  });

  console.log('\n== (v) teléfono: el contrato por país del cliente, y lo que manda la base lo acepta');
  const capturasOk = CAPTURAS.filter((c) => c.ok);
  const telCapt = veredictosBase('telefono', capturasOk.map((c) => aE164(c.pais, c.t)));
  CAPTURAS.forEach((c) => {
    const valido = telefonoValido(c.pais, c.t);
    if (!c.ok) {
      ok(`${c.pais} ${JSON.stringify(c.t)} → no válido`, valido === false);
      return;
    }
    const e164 = aE164(c.pais, c.t);
    const base = telCapt[capturasOk.indexOf(c)];
    ok(`${c.pais} ${JSON.stringify(c.t)} → ${e164}, base ${base}`,
      valido && e164 === c.e164 && base === 'ok');
  });

  console.log('\n== (vi) inclusión cliente ⊆ base, con el ejemplo de CADA país de la metadata');
  const muestras = getCountries()
    .filter((iso) => EJEMPLOS[iso])
    .map((iso) => ({ iso, t: EJEMPLOS[iso] }));
  const aceptadas = muestras.filter((m) => telefonoValido(m.iso, m.t));
  const telEj = veredictosBase('telefono', aceptadas.map((m) => aE164(m.iso, m.t)));
  const rechazadasPorBase = aceptadas.filter((m, i) => telEj[i] !== 'ok');
  ok(`de ${muestras.length} ejemplos, el cliente acepta ${aceptadas.length} y la base TODOS esos`,
    rechazadasPorBase.length === 0,
    rechazadasPorBase.length
      ? `la base rechaza: ${rechazadasPorBase.map((m) => `${m.iso} ${aE164(m.iso, m.t)}`).join(', ')}`
      : undefined);
  const noAceptadas = muestras.filter((m) => !telefonoValido(m.iso, m.t)).map((m) => m.iso);
  console.log(`  (ejemplos que el cliente NO acepta: ${noAceptadas.join(', ') || 'ninguno'})`);

  console.log('\n== (vii) la lista del selector coincide con la metadata');
  const malos = PAISES.filter(
    (p) => !isSupportedCountry(p.iso) || p.lada !== `+${getCountryCallingCode(p.iso)}`);
  ok(`los ${PAISES.length} países de paises.ts existen en la metadata, con su lada`,
    malos.length === 0, malos.map((p) => p.iso).join(', ') || undefined);
  ok('México va primero (el default)', PAISES[0].iso === 'MX');

  console.log('\n== (viii) los +52 guardados se separan igual que antes');
  const sep = separarE164('+528112345678');
  ok('+528112345678 → MX, "81 1234 5678"', sep.pais === 'MX' && sep.nacional === '81 1234 5678',
    JSON.stringify(sep));
  const sepEs = separarE164('+34612345678');
  ok('+34612345678 → ES, y vuelve al mismo E.164',
    sepEs.pais === 'ES' && aE164(sepEs.pais, sepEs.nacional) === '+34612345678', JSON.stringify(sepEs));

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
