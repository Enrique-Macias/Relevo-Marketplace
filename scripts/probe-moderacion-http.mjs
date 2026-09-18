// ===========================================================================
// Relevo — la Edge Function `moderar-contenido` por HTTP (RF-18).
//
// Cómo correrlo (necesita DOS procesos, y esa es la diferencia con los otros):
//     supabase start                                          # terminal 1
//     supabase functions serve --env-file supabase/functions/.env   # terminal 2
//     node scripts/probe-moderacion-http.mjs                   # terminal 3
//
// POR QUÉ ES UN CUARTO PROBE Y NO PARTE DE `probe-moderacion.mjs`. Aquel es
// puro: importa `decision.ts` desde Node y corre en menos de un segundo, sin
// stack ni red. Lo que prueba son DECISIONES. Este prueba el CABLEADO —quién
// puede llamar, con qué credencial, sobre qué publicación— y para eso no hay
// atajo: hay que pegarle a la función de verdad. Mezclarlos le quitaría al
// primero su mejor propiedad, que es correr siempre y en todos lados.
//
// LO QUE ESTE ARCHIVO NO PUEDE PROBAR TODAVÍA, dicho aquí y no escondido: la
// EVALUACIÓN. `evaluarListing()` y `moderarAvatar()` son stubs (ver
// `.claude/rules/moderacion.md`), así que los cuatro ejes vuelven siempre como
// `'revisar'` y toda publicación termina en `pendiente`. Las aserciones de
// abajo están escritas para NO depender de eso — miran autorización y forma de
// respuesta, no veredictos. La aserción de "el trigger no promueve" está
// marcada aparte porque hoy pasa por vacuidad, y decirlo importa: es
// exactamente el tipo de prueba que la sección de `:C` en T11b (CLAUDE.md §3)
// enseña a no dar por buena.
//
// REQUISITO NO OBVIO: la función no arranca sin los DOS secretos en
// `supabase/functions/.env`, porque `resolverConfig()` corre a nivel de módulo
// a propósito. Para estas aserciones sirven valores cualquiera — ninguna toca
// Vision ni OpenAI.
//
// Crea sus propios usuarios y publicaciones con correos únicos por corrida, y
// limpia en un `finally`, igual que los otros probes.
//
// CONTROLES NEGATIVOS CORRIDOS (2026-09-18), uno a la vez:
//
//   | Qué se rompió en `index.ts`        | Cae en                              |
//   |------------------------------------|-------------------------------------|
//   | el chequeo de ownership            | «un tercero NO puede…» + «ajena e   |
//   |                                    | inexistente se ven IGUAL»           |
//   | el guard de `esPromocion()`        | **NADA — las 15 pasan** (§5)        |
//
// La segunda fila es el dato incómodo y por eso está aquí arriba y no
// escondida: el guard de promoción no tiene cobertura end-to-end todavía. La
// tiene en `probe-moderacion.mjs` (405 combinaciones), que es lo que hace
// aceptable el hueco mientras la evaluación sea un stub — ver la nota en la
// sección 5.
//
// Este archivo nació encontrando un bug real de la primera corrida:
// `ctx.userClaims` expone **`id`**, no `sub` (el `sub` está en
// `ctx.jwtClaims`). El E-spike había confirmado que `userClaims` EXISTE, que no
// es lo mismo que conocer su forma, y el shim de tipos deja `ctx` sin tipar a
// propósito — así que el error salía como un 401 «sin identidad en el JWT», que
// se lee como problema de credenciales y no como un nombre de campo mal puesto.
// ===========================================================================

import { execFileSync } from 'node:child_process';

const RUN = Date.now();

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

const igual = (nombre, actual, esperado) =>
  ok(nombre, actual === esperado, `esperado ${esperado}, obtuvo ${actual}`);

// ---------------------------------------------------------------------------

async function crearUsuario(E, correo) {
  const res = await fetch(`${E.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`,
               'Content-Type': 'application/json' },
    // Inmune a `minimum_password_length`: el admin API está exento de esa
    // validación (CLAUDE.md §9, medido — el corte es por llave, no por endpoint).
    body: JSON.stringify({ email: correo, password: 'probe-1234', email_confirm: true }),
  });
  if (!res.ok) throw new Error(`crearUsuario ${correo}: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

async function token(E, correo) {
  const res = await fetch(`${E.API_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: E.PUBLISHABLE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password: 'probe-1234' }),
  });
  if (!res.ok) throw new Error(`token ${correo}: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function crearListing(E, userId, titulo, estado) {
  const res = await fetch(`${E.API_URL}/rest/v1/listings`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`,
               'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, categoria_id: 1, universidad_id: 1,
                           campus_id: 1, titulo, precio: 100, condicion: 'nuevo', estado }),
  });
  if (!res.ok) throw new Error(`crearListing ${titulo}: ${res.status} ${await res.text()}`);
  return (await res.json())[0].id;
}

async function estadoDe(E, id) {
  const res = await fetch(`${E.API_URL}/rest/v1/listings?id=eq.${id}&select=estado`, {
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
  });
  return (await res.json())[0]?.estado;
}

async function auditoriasDe(E, id) {
  const res = await fetch(
    `${E.API_URL}/rest/v1/listing_moderacion?listing_id=eq.${id}&select=veredicto,estado_resultante`,
    { headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` } }
  );
  return res.ok ? await res.json() : [];
}

/**
 * Las TRES formas de credencial que la función puede recibir, cada una en el
 * header que le corresponde de verdad:
 *  · `secret`      → `apikey` (NO `Bearer`: las secret keys modernas no son
 *                    JWT y la plataforma las rechazaría al parsearlas — §9).
 *  · `user`        → `Authorization: Bearer <access_token>`, con la
 *                    publishable en `apikey`, que es como pega el cliente real.
 *  · `publishable` → solo `apikey`, sin sesión.
 */
function headers(E, modo, tok) {
  const base = { 'Content-Type': 'application/json' };
  if (modo === 'ninguna') return base;
  if (modo === 'inventada') return { ...base, apikey: 'sb_secret_esto-no-existe' };
  if (modo === 'publishable') return { ...base, apikey: E.PUBLISHABLE };
  if (modo === 'secret') return { ...base, apikey: E.SECRET };
  if (modo === 'user') return { ...base, apikey: E.PUBLISHABLE, Authorization: `Bearer ${tok}` };
  throw new Error(`modo desconocido: ${modo}`);
}

async function llamar(E, modo, body, tok) {
  const res = await fetch(`${E.API_URL}/functions/v1/moderar-contenido`, {
    method: 'POST',
    headers: headers(E, modo, tok),
    body: JSON.stringify(body),
  });
  const texto = await res.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* respuestas de la plataforma no son JSON */ }
  return { status: res.status, json, texto };
}

// ---------------------------------------------------------------------------

async function main() {
  const raw = env();
  const E = {
    API_URL: raw.API_URL,
    SECRET: raw.SECRET_KEY || raw.SERVICE_ROLE_KEY,
    PUBLISHABLE: raw.PUBLISHABLE_KEY || raw.ANON_KEY,
  };
  if (!E.API_URL || !E.SECRET) {
    throw new Error('No hay stack local. Corre `supabase start` primero.');
  }

  // Comprobación de arranque con mensaje propio: sin esto, TODAS las
  // aserciones fallarían con 404 y el motivo real ("no corriste `functions
  // serve`") quedaría enterrado bajo 12 líneas rojas.
  const vivo = await llamar(E, 'secret', {});
  if (vivo.texto.includes('Function not found')) {
    throw new Error(
      'La función no está servida. En otra terminal:\n' +
      '  supabase functions serve --env-file supabase/functions/.env'
    );
  }

  const correoDueno = `probe-mod-dueno-${RUN}@tec.mx`;
  const correoAjeno = `probe-mod-ajeno-${RUN}@tec.mx`;
  let dueno, ajeno, propia, ajena, enPendiente;

  try {
    dueno = await crearUsuario(E, correoDueno);
    ajeno = await crearUsuario(E, correoAjeno);
    const tDueno = await token(E, correoDueno);

    propia = await crearListing(E, dueno, `RLS ModHTTP propia ${RUN}`, 'activa');
    ajena = await crearListing(E, ajeno, `RLS ModHTTP ajena ${RUN}`, 'activa');
    enPendiente = await crearListing(E, dueno, `RLS ModHTTP pendiente ${RUN}`, 'pendiente');

    // -----------------------------------------------------------------
    console.log('\n== 1. Las CINCO credenciales ==');
    // Las cuatro primeras son las que CLAUDE.md §9 ya documenta para
    // `send-push`; la quinta es nueva aquí y es la razón de ser de
    // `auth: ['secret','user']`.

    const sinLlave = await llamar(E, 'ninguna', { listing_id: propia });
    igual('sin llave → 401', sinLlave.status, 401);

    const inventada = await llamar(E, 'inventada', { listing_id: propia });
    igual('llave inventada → 401', inventada.status, 401);

    // La publishable es una llave VÁLIDA del proyecto, y aun así no autoriza:
    // no es `secret` ni trae sesión de usuario. Es la aserción que distingue
    // "la llave existe" de "la llave puede hacer esto".
    const publishable = await llamar(E, 'publishable', { listing_id: propia });
    igual('publishable (válida, pero sin sesión) → 401', publishable.status, 401);

    const conSecret = await llamar(E, 'secret', {
      bucket_id: 'listing-photos', name: `${propia}/x.jpg`, entity_id: String(propia),
    });
    ok('secret key → pasa', conSecret.status === 200, `HTTP ${conSecret.status}`);

    const conUser = await llamar(E, 'user', { listing_id: propia }, tDueno);
    ok('JWT de usuario → pasa', conUser.status === 200, `HTTP ${conUser.status}`);

    // -----------------------------------------------------------------
    console.log('\n== 2. Ownership: el camino de usuario es solo para el dueño ==');

    const dePropia = await llamar(E, 'user', { listing_id: propia }, tDueno);
    ok('el dueño SÍ puede pedir moderar lo suyo', dePropia.status === 200,
       `HTTP ${dePropia.status}`);

    const deAjena = await llamar(E, 'user', { listing_id: ajena }, tDueno);
    ok('un tercero NO puede pedir moderar lo ajeno',
       deAjena.status === 404, `HTTP ${deAjena.status}`);

    // 404 y no 403 a propósito: un 403 confirmaría que esa publicación existe
    // y es de alguien más. La aserción mira el código, no solo que rechace.
    const inexistente = await llamar(E, 'user', { listing_id: 999999999 }, tDueno);
    ok('una publicación ajena y una inexistente se ven IGUAL desde afuera',
       deAjena.status === inexistente.status &&
         JSON.stringify(deAjena.json) === JSON.stringify(inexistente.json),
       `ajena ${deAjena.status} ${JSON.stringify(deAjena.json)} vs inexistente ${inexistente.status} ${JSON.stringify(inexistente.json)}`);

    // -----------------------------------------------------------------
    console.log('\n== 3. Forma del body ==');

    const sinListingId = await llamar(E, 'user', {}, tDueno);
    igual('camino de usuario sin listing_id → 400', sinListingId.status, 400);

    const triggerIncompleto = await llamar(E, 'secret', { bucket_id: 'avatars' });
    igual('payload de trigger incompleto → 400', triggerIncompleto.status, 400);

    const bucketRaro = await llamar(E, 'secret', {
      bucket_id: 'otro-bucket', name: 'x', entity_id: '1',
    });
    igual('bucket no moderado → 400', bucketRaro.status, 400);

    // -----------------------------------------------------------------
    console.log('\n== 4. Efectos sobre la base ==');

    // Con los stubs, TODO cae en `pendiente` por falla segura. Esta aserción no
    // prueba el veredicto (no hay evaluación todavía): prueba que el camino de
    // escritura está cableado —que la función lee el estado, decide, y
    // escribe—, que es justo lo que este paso construyó.
    igual('una activa sin evaluación real cae en pendiente (falla segura)',
          await estadoDe(E, propia), 'pendiente');

    // La auditoría se escribe SIEMPRE, incluso cuando el estado no se movió:
    // `listing_moderacion` es historial de EVALUACIONES, no de cambios.
    const filas = await auditoriasDe(E, propia);
    ok('cada llamada deja su fila en listing_moderacion',
       filas.length >= 2, `${filas.length} fila(s) tras 3 llamadas`);
    ok('la fila guarda el veredicto y el estado resultante',
       filas.length > 0 && filas[0].veredicto === 'revisar' &&
         filas[0].estado_resultante === 'pendiente',
       JSON.stringify(filas[0]));

    // -----------------------------------------------------------------
    console.log('\n== 5. El trigger no promueve ==');

    const trigSobrePendiente = await llamar(E, 'secret', {
      bucket_id: 'listing-photos', name: `${enPendiente}/x.jpg`,
      entity_id: String(enPendiente),
    });
    ok('llamada del trigger sobre una pendiente → sigue pendiente',
       trigSobrePendiente.status === 200 &&
         (await estadoDe(E, enPendiente)) === 'pendiente',
       `HTTP ${trigSobrePendiente.status}`);

    // ⚠️ HOY PASA POR VACUIDAD, y hay que decirlo. Con los stubs, los ejes
    // vuelven como `'revisar'`, así que `decidirListing()` nunca PROPONE
    // `activa` y el guard de `esPromocion()` no llega a ejercitarse: esta
    // aserción daría verde igual con el guard borrado. Se corrió el control
    // negativo (quitando el guard de `index.ts`) y en efecto no cae.
    //
    // La cobertura REAL del guard vive hoy en `probe-moderacion.mjs`, que lo
    // ejercita sobre las 405 combinaciones sin necesitar la función. Esta
    // aserción se vuelve load-bearing en cuanto la evaluación exista (Olas 1.3
    // y 1.4): ahí una publicación `pendiente` con contenido limpio SÍ hará que
    // `decidirListing` proponga `activa`, y el guard será lo único que la
    // detenga. **Al cerrar la Ola 1.4, vuelve a correr el control negativo de
    // esta línea; si sigue sin caer, la aserción está mal escrita.**
    console.log('     ⚠  esta aserción pasa por vacuidad mientras la evaluación sea un stub');

  } finally {
    const del = (tabla, filtro) =>
      fetch(`${E.API_URL}/rest/v1/${tabla}?${filtro}`, {
        method: 'DELETE',
        headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      }).catch(() => {});

    for (const id of [propia, ajena, enPendiente]) {
      if (id) await del('listings', `id=eq.${id}`);
    }
    for (const id of [dueno, ajeno]) {
      if (id) {
        await fetch(`${E.API_URL}/auth/v1/admin/users/${id}`, {
          method: 'DELETE',
          headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
        }).catch(() => {});
      }
    }
  }

  console.log('');
  if (fallos.length > 0) {
    console.log('===========================================');
    console.log(`   ${fallos.length} PRUEBA(S) FALLARON`);
    for (const f of fallos) console.log(`   · ${f}`);
    console.log('===========================================');
    process.exit(1);
  }
  console.log('===========================================');
  console.log(`   LAS ${pasadas} PRUEBAS PASARON`);
  console.log('===========================================');
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
