-- Relevo — tokens de push por dispositivo (RF-16).
--
-- Primera pieza de la cadena de notificaciones: sin un lugar donde vivan los
-- Expo push tokens, la Edge Function no tiene a dónde mandar nada.

-- ---------------------------------------------------------------------------
-- La tabla
-- ---------------------------------------------------------------------------

-- POR QUÉ TABLA Y NO UNA COLUMNA EN `users`:
--   1. El ciclo de vida del token es POR DISPOSITIVO, no por cuenta. Expo
--      responde `DeviceNotRegistered` por token; con una columna, la única
--      reacción posible sería null-earla, apagando también el aparato sano.
--   2. `users_select` es `to authenticated using (true)` a propósito
--      (20260906000438) — un directorio semi-público. Una columna ahí quedaría
--      protegida solo por grant de columna, el mismo mecanismo delicado que ya
--      obliga a vigilar `correo` y `telefono` desde T12. Aquí la RLS por fila
--      resuelve el mismo problema sin grants finos.
create table public.push_tokens (
  -- PK SOBRE EL TOKEN, no sobre (user_id, token), y no es un detalle: si alguien
  -- cierra sesión y otra cuenta entra en el MISMO teléfono, Expo entrega el
  -- mismo token y ese token tiene que CAMBIAR DE DUEÑO, no duplicarse. Con PK
  -- compuesta quedarían dos filas y el dueño anterior seguiría recibiendo los
  -- push de un aparato que ya no usa. El trigger de abajo es lo que hace posible
  -- esa reasignación.
  token      text not null primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now()
);

-- NO HAY `last_seen_at` A PROPÓSITO. La limpieza de tokens muertos no sale de
-- una fecha sino del ticket `DeviceNotRegistered` que devuelve Expo, que es una
-- señal exacta en vez de una heurística. Se agrega el día que exista un caso de
-- uso que la lea.

-- El fan-out de la Edge Function es "dame los tokens de este usuario".
create index push_tokens_user_id_idx on public.push_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Reasignación del token entre cuentas del mismo aparato
-- ---------------------------------------------------------------------------

-- POR QUÉ ESTE TRIGGER EXISTE, Y POR QUÉ UN UPSERT NO SIRVE:
-- lo obvio sería que el cliente hiciera
--   `on conflict (token) do update set user_id = excluded.user_id`.
-- Eso FALLA, y falla justo en el caso que pretende resolver: en un
-- `ON CONFLICT DO UPDATE` Postgres evalúa el `USING` de la policy de UPDATE
-- contra la fila EXISTENTE, que es del dueño anterior. Medido contra el stack
-- local con estas mismas policies:
--   · `do update`  → ERROR: new row violates row-level security policy
--                    (USING expression) for table "push_tokens"
--   · `do nothing` → INSERT 0 0, SIN ERROR: el token se queda con el dueño
--                    viejo y el usuario nuevo simplemente nunca recibe un push.
-- El segundo es el peligroso: es silencioso.
--
-- POR QUÉ UN TRIGGER Y NO UNA FUNCIÓN RPC `SECURITY DEFINER`:
-- sería la CUARTA función de `public` invocable por el cliente, y CLAUDE.md §3
-- pide revisar antes de agregar una. Aquí no hace falta: como trigger, la
-- función vive en `private`, queda revocada de `authenticated` y solo dispara
-- por trigger, igual que las otras cinco. Más importante — EL PUNTO DE
-- ENFORCEMENT NO SE MUEVE: con RPC, "solo puedes registrar un token tuyo" se
-- mudaría al cuerpo de la función; con el trigger, la policy de insert sigue
-- siendo la que lo decide, y el código elevado solo puede BORRAR la fila
-- perdedora, nunca fabricar una a nombre de otro.
--
-- ALCANCE HONESTO: quien conozca el token de otra persona puede reasignárselo y
-- dejarla sin push (denegación de notificación; no gana nada, porque los push
-- llegan al aparato, que no es suyo). La precondición no es alcanzable desde el
-- API: el token solo lo lee su dueño y no aparece en ninguna otra tabla ni
-- respuesta.
create function private.claim_push_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Anclado al token que se está insertando: esto no puede borrar nada más.
  -- El `<>` deja intacta la fila propia, así que un re-registro normal (cada
  -- arranque de la app) no toca `created_at` y termina en el DO NOTHING del
  -- cliente.
  delete from public.push_tokens
   where token = new.token
     and user_id <> new.user_id;

  return new;
end;
$$;

revoke execute on function private.claim_push_token() from public, anon, authenticated;

create trigger push_tokens_claim
  before insert on public.push_tokens
  for each row execute function private.claim_push_token();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.push_tokens enable row level security;

-- Sin `is_active_user()` en ninguna: recibir notificaciones cae del lado de
-- favoritos en la tabla de decisión de CLAUDE.md §3 (lo que un suspendido sí
-- conserva), no del lado de publicar o contactar.
create policy push_tokens_select_own on public.push_tokens
  for select to authenticated using (user_id = (select auth.uid()));

create policy push_tokens_insert_own on public.push_tokens
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy push_tokens_delete_own on public.push_tokens
  for delete to authenticated using (user_id = (select auth.uid()));

-- SIN POLICY DE UPDATE, y por una razón concreta: la única escritura que la
-- habría necesitado era el upsert de reasignación, que no funciona (ver el
-- trigger de arriba). Lo que queda —insertar el propio, borrar el propio al
-- cerrar sesión— no actualiza nada.

-- POR QUÉ ESTE REVOKE (aplica a TODA tabla nueva de este proyecto):
-- Supabase define un pg_default_acl que concede automáticamente TODOS los
-- privilegios sobre cada tabla nueva de `public` a anon y authenticated. Los
-- `grant` de abajo son ADITIVOS: suman permisos, nunca retiran los que ese
-- default ya otorgó. Sin este revoke previo, authenticated conserva acceso a
-- todas las columnas y cualquier grant cuidadosamente acotado no protege nada.
-- Aquí es lo que impide que un autenticado lea los tokens de los demás por la
-- Data API pese a la policy: sin revoke, el UPDATE del default seguiría vivo.
revoke all on public.push_tokens from anon, authenticated;

-- `delete` sí: el cliente borra su token al cerrar sesión, o el teléfono
-- seguiría recibiendo los push de la cuenta anterior.
grant select, insert, delete on public.push_tokens to authenticated;
