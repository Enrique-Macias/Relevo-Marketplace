-- Relevo — el camino CLIENTE de `moderar-contenido` evalúa UNA vez por
-- publicación, y nunca dos a la vez (RF-18, fix preexistente).
--
-- EL HUECO QUE CIERRA, leído en el código antes de escribir esto:
-- `solicitarModeracion()` (src/lib/moderacion.ts) lee `estado` y, si sigue en
-- `pendiente`, invoca la función. `functions.invoke` va SIN timeout, así que una
-- primera llamada que muere EN EL CLIENTE (red, background) puede seguir viva en
-- el servidor mientras el usuario toca "Reintentar". Medido en producción
-- (function_edge_logs, 2026-09-22, n=13): cada evaluación tarda de 1.6 a 5.0 s
-- (p50 2.8 s). Esa ventana alcanza para:
--   1. pagar Vision + GPT + Rekognition DOS veces por la misma publicación;
--   2. que las dos escriban sin condición y gane la última: como GPT no es
--      determinista, una `bloqueada` podía quedar pisada por `activa`, que es
--      justo la transición que CLAUDE.md §3 dice que no ocurre por ningún camino;
--   3. que un dueño llame la función por API sobre una publicación que el
--      trigger de Storage escaló a `pendiente` al editar fotos, y se auto-apruebe
--      sin pasar por Studio (H2).
-- (2) lo cierra un compare-and-set en la Edge Function; (1) y (3), esta tabla.
--
-- POR QUÉ NO UN ADVISORY LOCK: la función habla con la base por PostgREST, y
-- cada llamada es su propia request y su propia transacción. Un
-- `pg_advisory_xact_lock` se soltaría al terminar la request del reclamo, y uno
-- de sesión quedaría pegado a una conexión del pool. Ninguno cubre los segundos
-- que tarda la evaluación.
--
-- POR QUÉ NO UN UNIQUE EN `listing_moderacion`: esa tabla es historial por
-- EVALUACIÓN (varias filas por publicación, `veredicto` not null). Una fila de
-- "reclamo" sin veredicto cambiaría lo que la tabla significa.
--
-- CICLO DE VIDA DE UNA FILA — es UNA fila con DOS estados, y los separa
-- `completada_at`:
--   · `completada_at is null`  → MUTEX. La tomó una llamada que está evaluando.
--     Si esa llamada falla de forma manejada (500, o un eje sin evaluar por
--     infraestructura) la BORRA ella misma, y el reintento puede evaluar de
--     inmediato. Si el worker muere sin borrarla, la siguiente llamada la libera
--     cuando tiene más de 60 s (12 veces el máximo medido).
--   · `completada_at is not null` → MARCA PERMANENTE de que el alta ya se
--     evaluó. No la borra NADIE: ni el TTL (que exige `completada_at is null`)
--     ni la función. Solo muere con la publicación (`on delete cascade`).
-- Consecuencia operativa: el camino cliente evalúa una sola vez en la vida de
-- una publicación. Si después vuelve a `pendiente` por una foto editada, SOLO
-- Studio la resuelve. Las fotos nuevas se siguen evaluando por el camino del
-- TRIGGER, que no usa esta tabla.
create table public.listing_moderacion_reclamos (
  listing_id    bigint primary key references public.listings(id) on delete cascade,
  reclamada_at  timestamptz not null default now(),
  completada_at timestamptz
);

-- POR QUÉ ESTE REVOKE — y aquí, igual que en `listing_moderacion`, NO es el
-- preámbulo de ningún grant: ES el control de acceso entero. Sin él, el
-- pg_default_acl de Supabase dejaría la tabla legible y escribible para anon y
-- authenticated, y un cliente podría borrar su propio reclamo completado para
-- volver a evaluarse.
revoke all on public.listing_moderacion_reclamos from anon, authenticated;

-- RLS sin una sola policy, a propósito: la escribe la Edge Function con
-- `supabaseAdmin` (que salta la RLS) y la lee Studio. Si algún día alguien le
-- agrega un grant sin pensarlo, RLS sin policies sigue negando todo. T12 lo
-- vigila, igual que a `listing_moderacion`.
alter table public.listing_moderacion_reclamos enable row level security;
