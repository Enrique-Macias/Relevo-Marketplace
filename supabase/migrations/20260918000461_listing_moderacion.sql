-- Relevo — el motivo de cada veredicto de moderación (RF-18).
--
-- POR QUÉ EXISTE ESTA TABLA, que es lo que no se ve en el diff:
-- sin ella, el revisor abre Studio, ve una publicación en `pendiente` y no
-- tiene la menor idea de por qué. La cola de revisión de RF-18 no es una tabla
-- —es el filtro `estado = 'pendiente'` sobre `listings` (CLAUDE.md §3)—, así
-- que lo único que el revisor vería es el estado. `private.coincidencias()`
-- del lado de la Edge Function ya devuelve CUÁLES palabras machearon
-- precisamente para esto (`palabras-prohibidas.ts:148-155`), y hoy ese valor
-- no tendría a dónde ir.
--
-- ES HISTORIAL, NO ESTADO ACTUAL: una fila por EVALUACIÓN, no una por
-- publicación. Deja leer "se marcó, se limpió, se volvió a marcar" —que es
-- justo lo que un revisor necesita ante una publicación reincidente— y de paso
-- evita un upsert, con el trigger de `enforce_photo_limit` de recuerdo de por
-- qué los upsert en este repo salen caros.
--
-- POR QUÉ NO ES UNA COLUMNA DE `listings`, que es lo primero que uno intenta:
-- `listings` tiene `grant select` A NIVEL TABLA (`20260906000439:86`), así que
-- cualquier columna nueva queda legible por cualquier autenticado que pueda ver
-- la fila — incluido el motivo por el que se bloqueó a alguien. Acotarlo
-- exigiría convertir ese grant a lista de columnas, que es exactamente lo que
-- hoy hace funcionar a `listings.busqueda` sin grant propio y lo que T13
-- vigila. Es el mismo argumento por el que `listing_sales` es tabla aparte
-- (`20260912000453:15-19`).
--
-- LOS AVATARES NO ESCRIBEN AQUÍ. No tienen `listing_id`, y su enforcement es
-- inmediato (borrar el objeto o no hacer nada), sin cola que revisar — su
-- rastro es el `console.error` de la función. Si algún día se quiere auditoría
-- de borrados de avatar, es una tabla hermana o un `listing_id` nullable, y es
-- una decisión aparte que esta migración NO toma.

create table public.listing_moderacion (
  id                bigint generated always as identity primary key,
  listing_id        bigint not null
                      references public.listings(id) on delete cascade,
  -- El veredicto de los cuatro ejes combinados, tal como lo devuelve
  -- `veredicto()` en decision.ts. Va como `text` + `check` y no como enum de
  -- Postgres a propósito: es un detalle interno de la función de moderación,
  -- no un valor que el cliente vea ni que ninguna policy lea. Un enum nuevo
  -- costaría el `ALTER TYPE` partido en dos migraciones (20260917000458) cada
  -- vez que se agregue un nivel.
  veredicto         text not null
                      check (veredicto in ('limpio', 'revisar', 'bloquear')),
  -- A qué estado quedó la publicación DESPUÉS de aplicar la regla del piso.
  -- No es derivable del veredicto: `bloquear` siempre da `bloqueada`, pero
  -- `revisar` sobre una `pausada` la deja en `pausada` y sobre una `activa` la
  -- manda a `pendiente` (decision.ts, la asimetría de CLAUDE.md §3). Guardar
  -- las dos cosas es lo que permite leer después "el veredicto fue revisar
  -- pero no la movió, y esta es la razón".
  estado_resultante public.listing_status not null,
  -- SafeSearch por foto con su `storage_path`, las palabras macheadas en texto
  -- tecleado y en OCR POR SEPARADO (su consecuencia es distinta), el veredicto
  -- de GPT por categoría, y cuál eje mandó. Va `jsonb` y no columnas porque la
  -- forma va a cambiar con cada señal nueva, y ninguna policy la lee.
  detalle           jsonb not null,
  created_at        timestamptz not null default now()
);

-- El acceso real es "dame el historial de esta publicación", nunca por `id`.
create index listing_moderacion_listing_id_idx
  on public.listing_moderacion (listing_id);

-- POR QUÉ ESTE REVOKE (aplica a TODA tabla nueva de este proyecto):
-- Supabase define un pg_default_acl que concede automáticamente TODOS los
-- privilegios sobre cada tabla nueva de `public` a anon y authenticated. Los
-- grants son ADITIVOS: suman permisos, nunca retiran los que ese default ya
-- otorgó. Aquí NO hay ningún grant después, así que este revoke no es el
-- preámbulo de nada — ES el control de acceso entero. Sin él, el motivo por el
-- que se bloqueó a alguien sería legible por cualquier autenticado.
revoke all on public.listing_moderacion from anon, authenticated;

-- CERO GRANTS Y CERO POLICIES, y las dos cosas a propósito:
-- solo `service_role`/Studio leen esta tabla, que es donde vive la moderación
-- hasta que exista RF-17. Mismo criterio que `reports.reported_user_correo`
-- (20260906000441): el dato es consultable por quien modera, no por el campus.
-- La Edge Function escribe con `ctx.supabaseAdmin`, que salta RLS.
--
-- El RLS se habilita IGUAL aunque no haya una sola policy, y no es ceremonia:
-- T12 tiene una aserción literal de que TODAS las tablas de `public` tienen
-- RLS habilitado, así que sin esta línea la suite se pone roja. Y es defensa
-- real: si algún día alguien agrega un `grant select` sin pensarlo, RLS sin
-- policies sigue negando todo en vez de abrir la tabla entera.
alter table public.listing_moderacion enable row level security;
