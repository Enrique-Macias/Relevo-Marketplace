-- Relevo — incremento de vistas de una publicación.

-- Única función SECURITY DEFINER que vive en `public`, porque PostgREST tiene
-- que poder llamarla como RPC. Existe porque `vistas_count` no tiene grant de
-- update: nadie puede tocarlo con un update directo, ni siquiera el dueño.
create function public.increment_listing_view(p_listing_id bigint)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.listings
     set vistas_count = vistas_count + 1
   where id = p_listing_id
     and estado <> 'pausada'
     and user_id is distinct from (select auth.uid());   -- el dueño no infla sus vistas
$$;

revoke execute on function public.increment_listing_view(bigint) from public, anon;
grant  execute on function public.increment_listing_view(bigint) to authenticated;
