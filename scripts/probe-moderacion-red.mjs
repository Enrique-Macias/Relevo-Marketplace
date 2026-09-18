// ===========================================================================
// Relevo — moderar-contenido contra Vision y OpenAI DE VERDAD (RF-18, Ola 1.5).
//
// Cómo correrlo (TRES procesos, igual que probe-moderacion-http.mjs):
//     supabase start                                                # terminal 1
//     supabase functions serve --env-file supabase/functions/.env  # terminal 2
//     node scripts/probe-moderacion-red.mjs                         # terminal 3
//
// ⚠️ CUESTA DINERO Y TARDA. Cada corrida hace varios requests reales a Google
// Cloud Vision y a OpenAI — dos llamadas de varios MB para el particionado
// (caso 5), una por cada verificación del no-op (caso 13). No es parte del
// paquete rutinario de `npm run lint`/`check:functions`/los seis pasos de
// CLAUDE.md §6: se corre a mano, cuando se toca `vision.ts`, `openai.ts` o el
// pipeline de `evaluarListing()` en `index.ts`.
//
// QUÉ CUBRE Y QUÉ NO. Los casos de verificación del plan de RF-18 que
// dependen de red real y NO necesitan reiniciar el servidor con un endpoint
// apuntado a otro lado:
//
//   5.  El particionado: fotos reales que SUMEN más de 6 MB crudos →
//       confirma, vía `listing_moderacion.detalle.lotes_vision`, que Vision
//       recibió más de un request.
//   9.  Falla la descarga de una foto SUELTA (el camino más fácil de
//       implementar mal, CLAUDE.md dixit): las otras fotos se evalúan normal
//       Y el resultado global sigue siendo al menos `pendiente`.
//   13. El no-op write: moderar dos veces una publicación limpia y confirmar
//       que `updated_at` no se mueve la segunda vez.
//
// Los casos 6 (Vision caído), 7 (OpenAI caído) y 8 (refusal) NO están aquí:
// piden que `ENDPOINT_VISION`/`ENDPOINT_OPENAI` apunten a otro lado, lo que
// exige editar el FUENTE y reiniciar `functions serve` — no algo que este
// script pueda orquestar sin arriesgar dejar el entorno de desarrollo a medio
// restaurar si algo truena a mitad de camino. Se verificaron a mano,
// documentados con sus resultados exactos en `.claude/rules/moderacion.md` §6.
//
// El caso 4 (una imagen real por umbral: limpia, LIKELY, VERY_LIKELY) está
// PARCIAL a propósito: la sub-caso "limpia" ya vive en
// `probe-moderacion-http.mjs` (verificada 5/5 GPT, 3/3 Vision antes de
// confiar en ella como fixture). Las sub-casos LIKELY/VERY_LIKELY exigirían
// sourcear o generar contenido sexual o gráficamente violento real para
// forzar esas clasificaciones — este repo NO lo hace, ni para pruebas: la
// lógica de umbral (`LIKELY → revisar`, `VERY_LIKELY → bloquear`) ya tiene
// cobertura pura y determinista en `nivelDeSafeSearch()`
// (`scripts/probe-moderacion.mjs`), que es lo que hace aceptable declinar
// esta parte en vez de sourcear el contenido.
//
// TITULO_LIMPIO/DESCRIPCION_LIMPIA se reusan tal cual de
// `probe-moderacion-http.mjs` — MISMO par, ya verificado, no una variación
// "que debería dar igual".
//
// CONTROL NEGATIVO CORRIDO (2026-09-18) SOBRE EL CASO 9, contra la función
// VIVA — el que el propio plan marca como "el que más fácil se implementa
// mal": se cambió `evaluarFotos()` en `index.ts` para que `resultados`
// DESCARTARA `fallosDeDescarga` en vez de incluirlos (la forma natural, y
// rota, de escribirlo — filtrar y seguir con el resto). Cayeron EXACTAMENTE
// las dos mitades de la aserción combinada: la foto fantasma dejó de
// aparecer en el detalle (en vez de `no_evaluable`) y el resultado global
// volvió a `activa` — publicando sin mirar la foto que no se pudo bajar, que
// es precisamente el fallo silencioso que este caso existe para cazar.
// Restaurado y reverificado en verde.
//
// LECCIÓN DE FIXTURE, no de producto: la primera versión del caso 9 usaba
// `pausada` como estado inicial y falló — no por un bug de `index.ts`, sino
// porque `pausada` tiene su PROPIO carve-out (`revisar` no la escala, misma
// exención que protege a `vendida`, CLAUDE.md §3). Con `activa` la aserción
// mide lo que el caso 9 del plan pide medir. Ver el comentario en el cuerpo
// del caso 9, más abajo.
// ===========================================================================

import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

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
  ok(nombre, actual === esperado, `esperado ${esperado}, obtuvo ${JSON.stringify(actual)}`);

// ---------------------------------------------------------------------------
// El par de contenido LIMPIO, verificado — ver probe-moderacion-http.mjs para
// el porqué y la medición (5/5 GPT, 3/3 Vision).
// ---------------------------------------------------------------------------

const TITULO_LIMPIO = 'Calculadora científica Casio fx-991LA Plus';
const DESCRIPCION_LIMPIA =
  'Calculadora en buen estado, la usé para mis clases de cálculo. Incluye funda y pilas nuevas.';

// ---------------------------------------------------------------------------
// Helpers HTTP — mismo patrón que los otros tres probes de RF-18.
// ---------------------------------------------------------------------------

async function crearUsuario(E, correo) {
  const res = await fetch(`${E.API_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password: 'probe-1234', email_confirm: true }),
  });
  if (!res.ok) throw new Error(`crearUsuario ${correo}: ${res.status} ${await res.text()}`);
  return (await res.json()).id;
}

async function crearListing(E, userId, estado, titulo = TITULO_LIMPIO, descripcion = DESCRIPCION_LIMPIA) {
  const res = await fetch(`${E.API_URL}/rest/v1/listings`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`,
               'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, categoria_id: 1, universidad_id: 1, campus_id: 1,
                           titulo, descripcion, precio: 100, condicion: 'nuevo', estado }),
  });
  if (!res.ok) throw new Error(`crearListing: ${res.status} ${await res.text()}`);
  return (await res.json())[0].id;
}

async function subirFoto(E, listingId, jpeg, nombre) {
  const storagePath = `${listingId}/${nombre}`;
  const res = await fetch(`${E.API_URL}/storage/v1/object/listing-photos/${storagePath}`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'image/jpeg' },
    body: jpeg,
  });
  if (!res.ok) throw new Error(`subirFoto ${nombre}: ${res.status} ${await res.text()}`);
  return storagePath;
}

async function insertarFilaFoto(E, listingId, storagePath, orden) {
  const res = await fetch(`${E.API_URL}/rest/v1/listing_photos`, {
    method: 'POST',
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ listing_id: listingId, storage_path: storagePath, orden }),
  });
  if (!res.ok) throw new Error(`insertarFilaFoto: ${res.status} ${await res.text()}`);
}

async function llamarTrigger(E, listingId, nombreArchivo) {
  const res = await fetch(`${E.API_URL}/functions/v1/moderar-contenido`, {
    method: 'POST',
    headers: { apikey: E.SECRET, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bucket_id: 'listing-photos',
      name: `${listingId}/${nombreArchivo}`,
      entity_id: String(listingId),
    }),
  });
  const texto = await res.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* no-op */ }
  return { status: res.status, json, texto };
}

async function auditoriasDe(E, id) {
  const res = await fetch(
    `${E.API_URL}/rest/v1/listing_moderacion?listing_id=eq.${id}&select=veredicto,estado_resultante,detalle,created_at&order=created_at.asc`,
    { headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` } }
  );
  return res.ok ? await res.json() : [];
}

async function updatedAtDe(E, id) {
  const res = await fetch(`${E.API_URL}/rest/v1/listings?id=eq.${id}&select=updated_at`, {
    headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
  });
  const filas = await res.json();
  return filas[0]?.updated_at;
}

/**
 * Ruido: cada pixel un gris al azar. JPEG comprime MUY MAL el ruido (a
 * diferencia de un color sólido), así que infla el tamaño de forma
 * predecible — 2000×2000 da ~3.9 MB, medido. Es contenido sin ninguna
 * semántica visual: no hay forma de que Vision lo lea como otra cosa que
 * `VERY_UNLIKELY`/`UNKNOWN` en las tres categorías (verificado por separado,
 * 1/1 corrida real antes de usarlo como fixture — no hace falta más: es
 * ruido, no algo que un clasificador pueda interpretar dos veces distinto).
 */
async function jpegDeRuido(ancho, alto) {
  const buf = Buffer.alloc(ancho * alto * 3);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  return sharp(buf, { raw: { width: ancho, height: alto, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

async function jpegLimpio(lado = 300) {
  return sharp({ create: { width: lado, height: lado, channels: 3, background: { r: 128, g: 128, b: 128 } } })
    .jpeg()
    .toBuffer();
}

// ---------------------------------------------------------------------------

async function main() {
  const raw = env();
  const E = { API_URL: raw.API_URL, SECRET: raw.SECRET_KEY || raw.SERVICE_ROLE_KEY };
  if (!E.API_URL || !E.SECRET) throw new Error('No hay stack local. Corre `supabase start` primero.');

  const vivo = await llamarTrigger(E, 0, 'x.jpg');
  if (vivo.texto.includes('Function not found')) {
    throw new Error(
      'La función no está servida. En otra terminal:\n' +
      '  supabase functions serve --env-file supabase/functions/.env'
    );
  }

  const correo = `probe-mod-red-${RUN}@tec.mx`;
  let dueno;
  const listingsCreados = [];
  const objetosSubidos = [];

  try {
    dueno = await crearUsuario(E, correo);

    // -----------------------------------------------------------------
    console.log('\n== 5. El particionado con fotos reales (>6 MB crudos) ==');

    const lPartic = await crearListing(E, dueno, 'pausada');
    listingsCreados.push(lPartic);

    // Dos fotos de ~3.9 MB = ~7.8 MB crudos, por encima del umbral de 6 MB de
    // `MAX_BYTES_POR_LOTE` — tienen que partirse en DOS requests a Vision.
    const [foto1, foto2] = await Promise.all([jpegDeRuido(2000, 2000), jpegDeRuido(2000, 2000)]);
    ok('las dos fotos suman más de 6 MB crudos',
       foto1.length + foto2.length > 6 * 1024 * 1024,
       `${((foto1.length + foto2.length) / 1024 / 1024).toFixed(2)} MB`);

    const [p1, p2] = await Promise.all([
      subirFoto(E, lPartic, foto1, 'a.jpg'),
      subirFoto(E, lPartic, foto2, 'b.jpg'),
    ]);
    objetosSubidos.push(p1, p2);
    await insertarFilaFoto(E, lPartic, p1, 0);
    await insertarFilaFoto(E, lPartic, p2, 1);

    const rPartic = await llamarTrigger(E, lPartic, 'a.jpg');
    ok('la llamada con fotos grandes responde 200', rPartic.status === 200, JSON.stringify(rPartic.json));

    const [filaPartic] = (await auditoriasDe(E, lPartic)).slice(-1);
    ok('se hicieron DOS requests a Vision, no uno',
       filaPartic?.detalle?.lotes_vision === 2,
       `lotes_vision=${filaPartic?.detalle?.lotes_vision}`);
    igual('y el veredicto sigue siendo el correcto (limpio) pese a partirse',
          filaPartic?.veredicto, 'limpio');
    ok('las DOS fotos aparecen evaluadas en el detalle, ninguna se perdió',
       filaPartic?.detalle?.fotos?.length === 2 &&
         filaPartic.detalle.fotos.every((f) => f.estado === 'evaluada'),
       JSON.stringify(filaPartic?.detalle?.fotos?.map((f) => f.estado)));

    // -----------------------------------------------------------------
    console.log('\n== 9. Falla la descarga de UNA foto suelta ==');

    // `activa`, NO `pausada` — y esto lo destapó la primera corrida, no una
    // lectura previa de `decision.ts`. `pausada` tiene su PROPIO carve-out
    // documentado: `revisar` no la escala (es la misma exención que protege a
    // `vendida`, CLAUDE.md §3), así que con `pausada` como estado inicial la
    // foto fantasma sube el eje `vision` a `revisar` igual, pero
    // `decidirListing` la deja en `pausada` — un resultado correcto, solo que
    // no es el que este caso quiere ejercitar. Con `activa`, `revisar` SÍ
    // escala a `pendiente`, que es la aserción real del caso 9 del plan.
    const lDescarga = await crearListing(E, dueno, 'activa');
    listingsCreados.push(lDescarga);

    const fotoBuena = await jpegLimpio();
    const pathBueno = await subirFoto(E, lDescarga, fotoBuena, 'buena.jpg');
    objetosSubidos.push(pathBueno);
    await insertarFilaFoto(E, lDescarga, pathBueno, 0);

    // Fila de `listing_photos` que apunta a un objeto que NUNCA se subió —
    // no hay FK entre `storage_path` y `storage.objects`, así que esto es
    // legal a nivel de esquema y reproduce exactamente "objeto borrado entre
    // que el trigger disparó y la función corre".
    const pathFantasma = `${lDescarga}/no-existe-${RUN}.jpg`;
    await insertarFilaFoto(E, lDescarga, pathFantasma, 1);

    const rDescarga = await llamarTrigger(E, lDescarga, 'buena.jpg');
    ok('la llamada con una foto fantasma igual responde 200 (no lanza)',
       rDescarga.status === 200, JSON.stringify(rDescarga.json));

    const [filaDescarga] = (await auditoriasDe(E, lDescarga)).slice(-1);
    const fotosDetalle = filaDescarga?.detalle?.fotos ?? [];
    const buena = fotosDetalle.find((f) => f.storage_path === pathBueno);
    const fantasma = fotosDetalle.find((f) => f.storage_path === pathFantasma);

    // LAS DOS MITADES EN LA MISMA ASERCIÓN, a propósito (§6 del plan): un test
    // que solo mirara "la buena se evaluó" pasaría con la implementación
    // ROTA que filtra las fotos que no se pudieron descargar y sigue con el
    // resto — que es justo el fallo silencioso que este caso existe para
    // cazar.
    ok('la foto BUENA se evaluó normal Y la FANTASMA quedó no_evaluable (no se perdió, no se filtró)',
       buena?.estado === 'evaluada' && fantasma?.estado === 'no_evaluable',
       `buena=${buena?.estado}, fantasma=${fantasma?.estado} (${fantasma?.motivo})`);
    ok('el resultado global es AL MENOS pendiente por la foto que no se pudo bajar',
       filaDescarga?.estado_resultante === 'pendiente',
       `estado_resultante=${filaDescarga?.estado_resultante}`);

    // -----------------------------------------------------------------
    console.log('\n== 13. El no-op write: moderar dos veces no debe tocar updated_at ==');

    const lNoOp = await crearListing(E, dueno, 'activa');
    listingsCreados.push(lNoOp);
    const fotoNoOp = await jpegLimpio();
    const pathNoOp = await subirFoto(E, lNoOp, fotoNoOp, 'x.jpg');
    objetosSubidos.push(pathNoOp);
    await insertarFilaFoto(E, lNoOp, pathNoOp, 0);

    await llamarTrigger(E, lNoOp, 'x.jpg');
    const updatedTrasPrimera = await updatedAtDe(E, lNoOp);

    // Segunda pasada, MISMO contenido: `activa` + `limpio` → `activa`, así que
    // `nuevoEstado === estadoActual` y el `if` de `index.ts` NO debe emitir
    // ningún UPDATE — es la lección de T23 (b) que `decidirListing` cita en su
    // propio docblock.
    await new Promise((r) => setTimeout(r, 1200)); // margen de reloj, por si acaso
    await llamarTrigger(E, lNoOp, 'x.jpg');
    const updatedTrasSegunda = await updatedAtDe(E, lNoOp);

    igual('updated_at NO se mueve en la segunda moderación (mismo veredicto)',
          updatedTrasSegunda, updatedTrasPrimera);

    const filasNoOp = await auditoriasDe(E, lNoOp);
    ok('pero SÍ quedan DOS filas de auditoría — es historial, no estado',
       filasNoOp.length >= 2, `${filasNoOp.length} filas`);

  } finally {
    for (const path of objetosSubidos) {
      await fetch(`${E.API_URL}/storage/v1/object/listing-photos/${path}`, {
        method: 'DELETE',
        headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      }).catch(() => {});
    }
    for (const id of listingsCreados) {
      await fetch(`${E.API_URL}/rest/v1/listings?id=eq.${id}`, {
        method: 'DELETE',
        headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      }).catch(() => {});
    }
    if (dueno) {
      await fetch(`${E.API_URL}/auth/v1/admin/users/${dueno}`, {
        method: 'DELETE',
        headers: { apikey: E.SECRET, Authorization: `Bearer ${E.SECRET}` },
      }).catch(() => {});
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
