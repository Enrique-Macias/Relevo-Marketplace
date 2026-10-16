-- Relevo — vistas entre usuarios bloqueados (UGC-1E.5b, complemento de
-- 20261013000487_user_bloqueos).
--
-- `increment_listing_view()` es SECURITY DEFINER sobre una tabla sin
-- `force row level security`, así que bypasea `listings_select` y el filtro de
-- bloqueo de esa policy no la alcanza. `…487` no la tocó. Medido en STAGING al
-- validar UGC-1 en dispositivo (UGC-1E.5): con A→B vigente, B abrió por id el
-- Detalle de una publicación vendida de A (la RPC se dispara al montar
-- Detalle, aunque la publicación no cargue) y su `vistas_count` subió.
--
-- No filtraba nada (la RPC devuelve void), pero dejaba a un bloqueado sumarle
-- vistas al bloqueador. Desde aquí, si hay bloqueo EN CUALQUIER DIRECCIÓN entre
-- quien llama y el dueño, el UPDATE no afecta filas. La respuesta es la misma
-- (void, 204 por HTTP) cuente o no, así que no revela el bloqueo ni su
-- dirección.
--
-- `private.bloqueo_entre()` es la helper de los 4 productores de avisos de
-- `…487`. Su EXECUTE está revocado para el cliente y no hace falta abrirlo: el
-- cuerpo de una definer corre como su dueño (`postgres`), que la ejecuta y lee
-- `user_bloqueos` completa (CLAUDE.md §3, `seller_whatsapp` →
-- `is_active_user()`). Usa la PK `(user_id, bloqueado_id)` en las dos ramas.
--
-- Fail-closed: `exists` nunca da NULL; si la helper diera NULL, `not NULL`
-- deja el `where` en NULL y no se cuenta; si lanzara, la RPC entera falla y
-- tampoco se cuenta. Sin `auth.uid()` (service_role, Studio) no hay par con
-- quien estar bloqueado y se cuenta como antes. `anon` sigue sin EXECUTE.
--
-- `create or replace` conserva OID, dueño y grants (mismo motivo que en
-- 20260917000459). Se restata el cuerpo completo, incluidos `security definer`
-- y `set search_path = ''`: `create or replace` no hereda lo que no se repite.
--
-- Lo prueba T40 (y1a)-(y5) de supabase/tests/rls.sql; por HTTP,
-- scripts/probe-bloqueos.mjs.

create or replace function public.increment_listing_view(p_listing_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.listings
     set vistas_count = vistas_count + 1
   where id = p_listing_id
     and estado not in ('pausada', 'pendiente', 'bloqueada')
     and user_id is distinct from (select auth.uid())   -- el dueño no infla sus vistas
     and not private.bloqueo_entre(user_id, (select auth.uid()));  -- UGC-1: ni en un sentido ni en el otro
$$;
