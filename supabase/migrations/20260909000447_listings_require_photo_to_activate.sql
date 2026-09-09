-- ===========================================================================
-- Una publicación no puede pasar a `activa` sin al menos una foto.
--
-- POR QUÉ EXISTE: el alta migró al modelo atómico (crear como `pausada`, subir
-- todas las fotos, activar solo si todas suben). Eso garantiza que *Publicar*
-- nunca active una publicación con fotos incompletas — pero REACTIVAR no
-- validaba nada, y hay dos rutas que reactivan ("Mis publicaciones" y el toggle
-- de "Editar publicación"). Como el camino de error del alta deja publicaciones
-- en `pausada` —con 0 fotos si la subida falló entera— cualquiera de las dos
-- podía volverlas `activa` sin una sola foto, que es exactamente el estado que
-- el modelo atómico existe para impedir.
--
-- Va en la base y no en un `if` de React (CLAUDE.md §0 regla 7): el cliente
-- tiene su propio guard, pero es traducción del mensaje, no el candado.
-- ===========================================================================

-- Espeja a `private.enforce_photo_limit()`, que es el precedente exacto:
-- SECURITY DEFINER para que la RLS no le esconda filas al contar, en `private`
-- y con EXECUTE revocado porque solo la dispara un trigger — es de las que NO
-- invoca ninguna policy, así que no necesita el grant que sí tienen
-- is_active_user(), can_rate() y listing_id_from_object_name().
create function private.enforce_activation_has_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.listing_photos where listing_id = new.id) then
    raise exception 'Una publicación no puede activarse sin fotos';
  end if;
  return new;
end;
$$;

revoke execute on function private.enforce_activation_has_photos()
  from public, anon, authenticated;

-- SOLO la transición, y el `when` es OBLIGATORIO — no es una optimización.
-- Medido quitándolo en local: la suite ni siquiera llega a T15, revienta en T5
-- porque `public.increment_listing_view()` hace un `update listings set
-- vistas_count = ...` y el trigger se le dispara encima. O sea que sin el `when`
-- ABRIR EL DETALLE de cualquier publicación sin fotos fallaría, que es un radio
-- de daño muchísimo mayor que el caso obvio.
--
-- El caso obvio también cuenta: en remoto ya hay listings `activa` con 0 fotos
-- (los creados antes de que existiera la subida, y los dados de alta desde
-- Studio), y sin esta condición cambiarles el precio fallaría sin que nada
-- explique por qué.
--
-- De paso, un update ordinario ni siquiera paga la consulta: el `when` se
-- evalúa antes que la función.
create trigger listings_enforce_activation_has_photos
  before update on public.listings
  for each row
  when (old.estado is distinct from new.estado and new.estado = 'activa')
  execute function private.enforce_activation_has_photos();

-- POR QUÉ NO HAY UN TRIGGER SIMÉTRICO DE INSERT, que es la pregunta obvia al
-- leer esto: no es que no se pueda, es que hoy no se paga.
--
-- Un `before insert` SIN `when` sí sería imposible: el orden obligatorio es
-- listing → fotos (la carpeta del objeto ES `{listing_id}/`, ver
-- `listing_photos_objects_insert_own`), así que exigir fotos al insertar haría
-- imposible crear cualquier publicación. Pero uno CON el mismo
-- `when (new.estado = 'activa')` sería perfectamente viable y no tocaría el
-- flujo real, que nace `pausada`. Se descartó por costo:
--
--   · `supabase/tests/rls.sql` siembra 6 listings con `estado='activa'`
--     directo, en 4 bloques de fixtures load-bearing para listings_select,
--     T11b, T13 y T14. El trigger los rechaza a los seis, y rehacerlos
--     (insert `pausada` → insertar una foto → update a `activa`) acopla a
--     `listing_photos` fixtures que no tienen nada que ver con fotos: T13 es
--     de búsqueda por tsvector.
--   · `estado` es `not null default 'activa'`, así que el trigger reventaría
--     también cualquier insert que OMITA la columna, Studio incluido. Cerrarlo
--     bien exigiría además voltear ese default a 'pausada'.
--   · Lo que quedaría cerrado es un vector de calidad de dato, no de
--     seguridad: un autenticado que inserte `activa` sin fotos solo se ensucia
--     su propia publicación.
--
-- Queda como deuda consciente CON disparador de revisión en CLAUDE.md §8, con
-- el mismo criterio que el tope de 5 fotos en Storage.
