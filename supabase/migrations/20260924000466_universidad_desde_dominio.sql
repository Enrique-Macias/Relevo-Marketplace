-- Relevo — la universidad de un usuario deja de ser una elección del cliente y
-- pasa a derivarse, en el servidor, del dominio de su correo (fase 2A). Y la
-- base garantiza que el campus del usuario y sus publicaciones sean coherentes
-- con esa universidad.
--
-- POR QUÉ TODO EL CANDADO VA AQUÍ Y NADA EN EL CLIENTE: las tarjetas van a
-- mostrar la universidad de cada publicación, y esa etiqueta solo da confianza
-- si nadie la puede falsificar. Cuatro piezas, cada una con su aserción en T28:
--
--   (1) el trigger de alta asigna `users.universidad_id` desde el dominio;
--   (2) `authenticated` pierde UPDATE sobre `users.universidad_id`, y sobre
--       `listings.universidad_id` / `listings.campus_id`;
--   (3) FK compuesta campus ↔ universidad, en `users` y en `listings`;
--   (4) FK compuesta publicación ↔ dueño: `listings(user_id, universidad_id)`
--       → `users(id, universidad_id)`.
--
-- DEPENDE DE LA FASE 1 (20260923000465) CON DOMINIOS REALES. Con
-- `universidad_dominios` vacía, (1) haría nacer toda cuenta con universidad
-- null. El paso 0 del runbook lo verifica antes del `db push`.

-- ===========================================================================
-- (1) EL TRIGGER DE ALTA ASIGNA LA UNIVERSIDAD
-- ===========================================================================
-- `create or replace` y no drop+create: conserva el OID, así que el trigger
-- `on_auth_user_created` y el `revoke execute` de 20260906000438:39-43 siguen
-- colgando de la misma función sin tocarlos.
--
-- La normalización es LA MISMA que la del Auth Hook
-- (`public.hook_before_user_created`, 20260923000465:91): lo que sigue al
-- ÚLTIMO '@', en minúsculas y sin espacios, con coincidencia EXACTA. Está
-- escrita dos veces y no se puede compartir: el hook corre como
-- `supabase_auth_admin`, que no tiene USAGE sobre `private`, y esta función vive
-- en `private`. El amarre entre las dos copias es T28 (a3). Si una cambia sin
-- la otra, una cuenta podría pasar el hook y nacer sin universidad.
--
-- NUNCA LANZA. Sin match (o con email NULL), el subselect da NULL y la fila
-- nace con universidad NULL. Pasa con una cuenta creada por la llave secreta
-- (Studio, admin API), que no pasa por el hook (CLAUDE.md §9). Que el alta
-- reviente por esto sería peor: ese usuario ni existiría para corregirlo desde
-- Studio. Sin universidad, la base le impide fijar campus (check de abajo) y
-- publicar (FK de (4)), y la app le muestra la variante "sin universidad
-- asignada" de Completar perfil.
--
-- SECURITY DEFINER como antes. Su dueño es `postgres`, que también es dueño de
-- `universidad_dominios` y no tiene FORCE ROW LEVEL SECURITY, así que la policy
-- de esa tabla (solo `supabase_auth_admin`) no le esconde filas. T28 (a) lo
-- prueba al crear la cuenta de verdad, no lo supone.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, correo, universidad_id)
  values (
    new.id,
    new.email,
    (select d.universidad_id
       from public.universidad_dominios d
      where d.dominio = split_part(lower(btrim(new.email)), '@', -1))
  );
  return new;
end;
$$;

-- ===========================================================================
-- (3) CAMPUS ↔ UNIVERSIDAD, en la base
-- ===========================================================================
-- Un `check` con subconsulta no es legal en Postgres, así que la coherencia va
-- como FK COMPUESTA contra `campus(universidad_id, id)`. Para eso ese par tiene
-- que ser único. Lo es trivialmente, porque `id` ya es PK, pero una FK exige un
-- constraint declarado sobre exactamente esas columnas.
alter table public.campus
  add constraint campus_universidad_id_id_key unique (universidad_id, id);

-- La FK compuesta REEMPLAZA a la suelta, no se suma. Con dos FKs de `users`
-- hacia `campus`, PostgREST tendría dos caminos y los embeds `campus:campus(...)`
-- sin hint (`src/lib/perfil.ts`) morirían con PGRST201. La compuesta ya
-- garantiza lo mismo que la suelta (que el campus exista) y además que sea de
-- esa universidad.
alter table public.users drop constraint users_campus_id_fkey;
alter table public.users
  add constraint users_campus_universidad_fkey
  foreign key (universidad_id, campus_id)
  references public.campus (universidad_id, id);

-- La FK es MATCH SIMPLE: si CUALQUIERA de las dos columnas es NULL, no se
-- evalúa. O sea que sin este check, `campus_id = X` con `universidad_id` NULL
-- pasaría sin mirar nada. MATCH FULL no sirve: exige las dos nulas o las dos
-- llenas, y rechazaría el estado normal "universidad asignada en el alta,
-- campus todavía no elegido".
alter table public.users
  add constraint users_campus_requiere_universidad
  check (campus_id is null or universidad_id is not null);

-- Lo mismo en `listings`, donde las dos columnas son NOT NULL y la FK siempre
-- se evalúa. También reemplaza a la suelta, por los embeds `campus:campus(...)`
-- de `src/lib/listings.ts`.
alter table public.listings drop constraint listings_campus_id_fkey;
alter table public.listings
  add constraint listings_campus_universidad_fkey
  foreign key (universidad_id, campus_id)
  references public.campus (universidad_id, id);

-- ===========================================================================
-- (4) PUBLICACIÓN ↔ DUEÑO: la universidad de la publicación es la del dueño
-- ===========================================================================
-- FK compuesta y no un trigger ni un `with check` (decidido en el plan):
--   - Un trigger que la FIJARA desde el perfil reescribiría en silencio: el
--     cliente manda X, se guarda Y, sin error. Este repo ya documenta de más lo
--     que cuesta lo que no falla ruidosamente (CLAUDE.md §9).
--   - Un `with check` solo aplica a `authenticated`. Studio/`service_role`
--     podrían dejar una publicación incoherente, y la etiqueta dependería de que
--     nadie se equivoque ahí.
--   - La FK aplica a TODOS los roles y rechaza con 23503. Un dueño sin
--     universidad no puede publicar: `(id, NULL)` nunca machea, porque la
--     columna de `listings` es NOT NULL y la FK siempre se evalúa.
--
-- ON UPDATE CASCADE: si un admin mueve a un usuario de universidad, sus
-- publicaciones lo siguen, o el UPDATE aborta. En la práctica aborta: el
-- cascade deja `(universidad nueva, campus viejo)` y choca con
-- `listings_campus_universidad_fkey`. Falla CERRADO. Mover a alguien con
-- publicaciones exige resolver primero esas publicaciones (T28 (d6)). Sin el
-- cascade el efecto sería el mismo, pero con un error menos claro.
--
-- ON DELETE CASCADE, por coherencia con `listings_user_id_fkey`, que SE QUEDA:
-- es el nombre que usa el hint `users!listings_user_id_fkey`
-- (`src/lib/listings.ts`). Con esta segunda FK hacia `users`, un embed
-- `users(...)` desde `listings` sin hint sería ambiguo. Hoy no hay ninguno
-- (todos llevan el hint desde que `favorites` los volvió ambiguos).
alter table public.users
  add constraint users_id_universidad_id_key unique (id, universidad_id);

alter table public.listings
  add constraint listings_user_universidad_fkey
  foreign key (user_id, universidad_id)
  references public.users (id, universidad_id)
  on update cascade
  on delete cascade;

-- ===========================================================================
-- (2) GRANTS
-- ===========================================================================
-- `revoke all` primero, re-grant después (CLAUDE.md §1, pg_default_acl §9). Las
-- listas de abajo salen de lo MEDIDO en remoto y en local
-- (`scripts/grants-users-listings.sql`, 55 filas idénticas), no de las
-- migraciones anteriores. `anon` no tenía nada y sigue sin nada. El diff
-- antes/después tiene que dar EXACTAMENTE tres filas menos y ninguna más:
--   columna|authenticated|users.universidad_id|UPDATE
--   columna|authenticated|listings.universidad_id|UPDATE
--   columna|authenticated|listings.campus_id|UPDATE

revoke all on public.users from anon, authenticated;

-- SELECT sin cambios. Sin `correo` (RNF-05) ni `telefono` (se lee solo por
-- `seller_whatsapp`); con `tiene_telefono` (20260910000448).
grant select (id, nombre, foto_url, universidad_id, campus_id, carrera,
              rating_promedio, estado, created_at, tiene_telefono)
  on public.users to authenticated;

-- Sale `universidad_id`: la asigna el trigger de alta y no la cambia el
-- cliente. El campus sí, y la FK compuesta lo ata a esa universidad.
grant update (nombre, foto_url, campus_id, carrera, telefono)
  on public.users to authenticated;

revoke all on public.listings from anon, authenticated;

-- SELECT/INSERT/DELETE a nivel TABLA, igual que antes y a propósito: el
-- SELECT de tabla es lo que hace legible `busqueda` sin grant propio (T13), y
-- el INSERT de tabla es lo que deja al cliente mandar `universidad_id`/
-- `campus_id` al crear. En el INSERT, quien valida esos valores son las FKs.
grant select, insert, delete on public.listings to authenticated;

-- Salen `universidad_id` y `campus_id`: una publicación conserva la
-- universidad y el campus con los que se creó. Antes Editar la movía en
-- silencio al campus actual del perfil (corregido en el cliente en el commit
-- anterior; este grant es el candado). `vistas_count` y `user_id` siguen fuera,
-- por los motivos de 20260906000439:88-91.
grant update (categoria_id, titulo, descripcion, precio, condicion, estado)
  on public.listings to authenticated;
