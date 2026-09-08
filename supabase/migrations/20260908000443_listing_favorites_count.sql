-- Relevo — conteo de favoritos de una publicación, solo para su dueño.
--
-- Por qué existe: el frame "Detalle (vista vendedor)" de design/relevo-app.html
-- muestra una tarjeta con Vistas / Favoritos / Contactos. Vistas sale de
-- listings.vistas_count y Contactos lo deja leer la policy de listing_contacts
-- (el vendedor ve quién lo contactó), pero la RLS de `favorites` es
-- `user_id = auth.uid()`: el vendedor NO puede contar los favoritos de su propia
-- publicación, porque los favoritos son privados por diseño (CLAUDE.md §3).
-- Sin esta función esa tarjeta muestra siempre 0.
--
-- POR QUÉ VIVE EN `public` Y NO EN `private`:
-- la regla del proyecto es que toda función SECURITY DEFINER vive en `private`,
-- con la única excepción de las que el cliente debe poder invocar por RPC vía
-- PostgREST — hasta hoy, solo increment_listing_view. Esta es la segunda y
-- última excepción por la misma razón exacta: la llama Detalle desde el
-- cliente. Las funciones que solo se invocan desde policies o triggers siguen
-- en `private`.
--
-- POR QUÉ ES SECURITY DEFINER:
-- tiene que ver filas de public.favorites que la RLS le esconde al invocador.
-- Es el mismo motivo por el que private.can_rate() lo es.

create function public.listing_favorites_count(p_listing_id bigint)
returns bigint
language sql
security definer
stable
set search_path = ''
as $$
  -- Simétrica a increment_listing_view, que valida que el llamante NO sea el
  -- dueño: esta valida que SÍ lo sea. Sin ese `exists`, cualquier autenticado
  -- podría contar los favoritos de publicaciones ajenas — un dato agregado que
  -- hoy la RLS de favorites protege, y que revela el interés real en una
  -- publicación de la competencia.
  --
  -- Devuelve NULL (el `case` sin `else`) para quien no es el dueño, en vez de
  -- `raise exception`: así se mantiene como función `sql` pura, sin plpgsql ni
  -- bloque EXCEPTION, que es la cautela que impone supabase/KNOWN_ISSUES.md.
  -- NULL no se confunde con 0 porque la UI solo renderiza esa tarjeta al dueño.
  select case
    when exists (
      select 1
      from public.listings l
      where l.id = p_listing_id
        and l.user_id = (select auth.uid())
    )
    then (select count(*) from public.favorites f where f.listing_id = p_listing_id)
  end;
$$;

-- Postgres concede EXECUTE a PUBLIC por default en cada función nueva: sin este
-- revoke, `anon` puede invocarla aunque nunca se le haya otorgado nada.
revoke execute on function public.listing_favorites_count(bigint) from public, anon;
grant  execute on function public.listing_favorites_count(bigint) to authenticated;
