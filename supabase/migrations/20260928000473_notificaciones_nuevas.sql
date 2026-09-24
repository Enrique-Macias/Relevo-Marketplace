-- Relevo — los productores de los cuatro avisos nuevos del inbox (RF-16,
-- tanda 2). Los valores del enum nacen en 20260928000472; ver ahí por qué van
-- en otro archivo.
--
-- Mismo patrón que los tres productores que ya existen (20260911000451,
-- 20260912000453): funciones en `private`, SECURITY DEFINER (insertan en
-- `notifications`, donde NADIE tiene grant de insert), `search_path = ''`,
-- EXECUTE revocado, triggers AFTER, y el texto MATERIALIZADO aquí: es copy
-- persistente y está en el frame "Notificaciones" de design/relevo-app.html,
-- palabra por palabra.
--
-- La única función nueva que NO sigue ese patrón es
-- `limpia_veredicto_en_pantalla()`: es BEFORE, INVOKER y conserva su EXECUTE,
-- igual que `set_updated_at()`, porque solo toca NEW (ver abajo).

-- ===========================================================================
-- 1. Veredicto de moderación de MI publicación (`publicacion_aprobada` /
--    `publicacion_bloqueada`)
-- ===========================================================================
--
-- EL PROBLEMA: el veredicto del ALTA ya lo ve el usuario en pantalla — el
-- cliente espera la respuesta de `moderar-contenido` y navega a "Publicación
-- creada" o "no aprobada". Medido en remoto (listing_moderacion, 2026-09-24): de
-- 23 evaluaciones, 12 sacan la publicación de `pendiente` en el acto y el
-- usuario las está viendo; notificarlas duplicaría el aviso en la mitad de las
-- altas. Las otras 11 se quedan en `pendiente` hasta que alguien las resuelve
-- en Studio, y ESAS no las ve nadie.
--
-- LA COLUMNA: `veredicto_en_pantalla`. Solo la pone en true la Edge Function,
-- en el MISMO update con el que su camino CLIENTE saca la publicación de
-- `pendiente` (moderarListing(), index.ts). Todo lo demás la deja en false:
-- Studio no la toca, el camino del trigger la escribe en false, y el trigger de
-- limpieza de abajo la baja cada vez que la fila está en `pendiente`.
--
-- Se descartó un filtro por historial ("¿hay una fila `pendiente` previa en
-- listing_moderacion?"): dependía del orden update→auditoría de la función y
-- fallaba en silencio si la auditoría no se escribía o si Studio mandaba a
-- `pendiente` a mano.
--
-- Legible para todos (el `grant select` de `listings` es de TABLA) e inocua: no
-- dice nada que el estado no diga. NO entra al `grant update` de authenticated,
-- que es por lista de columnas (medido: 6 columnas). El INSERT sí es de tabla,
-- así que un cliente podría mandarla en true — y toda fila de cliente nace
-- `pendiente` (20260919000463), donde la limpieza la baja a false.
alter table public.listings
  add column veredicto_en_pantalla boolean not null default false;

-- LA INVARIANTE: mientras `estado = 'pendiente'`, la columna vale false. Así,
-- cualquier entrada a `pendiente` —la escalada del trigger de Storage, Studio a
-- mano, un insert— reinicia el ciclo sin que el que escribe tenga que saberlo.
--
-- INVOKER y sin revocar, como `set_updated_at()`: solo reescribe NEW, no lee ni
-- escribe otras filas, así que no hay nada que elevar (el criterio de
-- 20260906000439:31). Postgres verifica EXECUTE al CREAR el trigger, no al
-- dispararlo, así que el grant tampoco es necesario; se deja por consistencia
-- con `set_updated_at()`, y T12 vigila las dos.
create function private.limpia_veredicto_en_pantalla()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.veredicto_en_pantalla := false;
  return new;
end;
$$;

-- UN solo trigger para INSERT y UPDATE: es válido porque el WHEN solo mira NEW
-- (la restricción de 20260912000453 es para un WHEN que referencie OLD).
create trigger listings_limpia_veredicto_en_pantalla
  before insert or update on public.listings
  for each row
  when (new.estado = 'pendiente' and new.veredicto_en_pantalla)
  execute function private.limpia_veredicto_en_pantalla();

create function private.notify_moderacion_listing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, tipo, titulo, cuerpo, listing_id)
  values (
    new.user_id,
    case when new.estado = 'activa' then 'publicacion_aprobada'
         else 'publicacion_bloqueada' end::public.notification_type,
    case
      when new.estado = 'activa'   then 'Tu publicación ya está publicada'
      when old.estado = 'pendiente' then 'Tu publicación no fue aprobada'
      else                              'Retiramos tu publicación'
    end,
    case
      when new.estado = 'activa'
        then '"' || new.titulo || '" pasó la revisión y ya es visible para otros estudiantes.'
      when old.estado = 'pendiente'
        then '"' || new.titulo || '" no cumple con las reglas de la comunidad, así que no se publicó.'
      else '"' || new.titulo || '" dejó de cumplir con las reglas de la comunidad y ya no es visible.'
    end,
    -- El tap lleva al Detalle: el dueño ve la suya en cualquier estado
    -- (`listings_select`), y ahí la `bloqueada` pinta su `.notice`.
    new.id
  );
  return null;
end;
$$;

revoke execute on function private.notify_moderacion_listing() from public, anon, authenticated;

-- CADA MITAD DEL WHEN ES LOAD-BEARING, y cada una tiene su aserción en T32:
--   · `old.estado is distinct from new.estado`: un update que no cambia el
--     estado (Studio re-guardando una bloqueada) no notifica — T32 (h).
--   · rama 1, `old.estado = 'pendiente'` … `activa`: sin `old = pendiente`, el
--     dueño que REACTIVA su pausada se notificaría a sí mismo — T32 (f).
--   · rama 1, `not new.veredicto_en_pantalla`: sin ella, el veredicto del alta
--     que el usuario está viendo se duplica — T32 (a)/(d).
--   · rama 2, `old.estado <> 'pendiente'`: separa la bloqueada de algo ya
--     publicado (se notifica SIEMPRE: nadie lo está mirando) de la del alta
--     (que depende de la columna) — T32 (e) y (d).
-- activa → pendiente NO se notifica (T32 (g)): se notifica su resolución.
create trigger listings_notify_moderacion
  after update of estado on public.listings
  for each row
  when (old.estado is distinct from new.estado and (
          (old.estado = 'pendiente' and new.estado in ('activa', 'bloqueada')
             and not new.veredicto_en_pantalla)
       or (old.estado <> 'pendiente' and new.estado = 'bloqueada')))
  execute function private.notify_moderacion_listing();

-- ===========================================================================
-- 2. Me calificaron (`calificacion_recibida`)
-- ===========================================================================
--
-- SOLO AL CREAR la reseña. `ratings` sí admite UPDATE por API (`grant update
-- (estrellas, comentario)`, 20260906000440) aunque ninguna pantalla lo use, y
-- editar no debe avisar de nuevo. No hace falta ningún WHEN para distinguirlo:
-- el trigger es AFTER INSERT, y el `unique (from_user_id, to_user_id,
-- listing_id)` impide un segundo insert. T32 (j) vigila que un update no
-- produzca aviso.
--
-- NUNCA incluye el comentario: el aviso es "te calificaron", no la reseña. Las
-- estrellas y el nombre sí, porque las reseñas ya son públicas en "Perfil
-- público" (`ratings_select` es `using (true)`). T32 (k).
create function private.notify_calificacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, tipo, titulo, cuerpo, listing_id)
  select new.to_user_id,
         'calificacion_recibida',
         'Recibiste una calificación',
         -- `coalesce`: nombre es nullable hasta "Completar perfil", igual que en
         -- notify_compra_calificable().
         coalesce(u.nombre, 'Alguien') || ' te dio ' || new.estrellas
           || case when new.estrellas = 1 then ' estrella' else ' estrellas' end
           || ' por "' || l.titulo || '".',
         -- Se guarda la publicación de la reseña, pero el tap NO la usa: lleva
         -- al Perfil público propio, donde vive la lista de reseñas
         -- (rutaDeNotificacion(), src/lib/notificaciones.ts).
         new.listing_id
    from public.users u, public.listings l
   where u.id = new.from_user_id
     and l.id = new.listing_id;

  return null;
end;
$$;

revoke execute on function private.notify_calificacion() from public, anon, authenticated;

create trigger ratings_notify_insert
  after insert on public.ratings
  for each row execute function private.notify_calificacion();

-- ===========================================================================
-- 3. Se vendió un favorito (`favorito_vendido`)
-- ===========================================================================
--
-- Fan-out a quienes tienen la publicación en favoritos, con DOS exclusiones, y
-- cada una tiene su aserción:
--   · el DUEÑO (puede tener su propia publicación en favoritos, igual que en
--     notify_price_drop()) — T32 (n);
--   · el COMPRADOR registrado, que ya recibe "Califica tu compra" — T32 (m). El
--     cliente inserta `listing_sales` ANTES de marcar `vendida`
--     (registrarVenta(), src/lib/confianza.ts, orden obligatorio), así que la
--     fila ya existe cuando este trigger corre.
-- "No fue a través de Relevo" no crea fila de venta: le llega a todos menos al
-- dueño — T32 (o). Corregir al comprador solo toca `listing_sales`, no
-- `listings`, así que no vuelve a disparar — T32 (p).
create function private.notify_favorito_vendido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, tipo, titulo, cuerpo, listing_id)
  select f.user_id,
         'favorito_vendido',
         'Se vendió un favorito',
         '"' || new.titulo || '" ya se vendió y dejó de estar disponible.',
         new.id
    from public.favorites f
   where f.listing_id = new.id
     and f.user_id <> new.user_id
     and not exists (select 1 from public.listing_sales s
                     where s.listing_id = new.id and s.comprador_id = f.user_id);

  return null;
end;
$$;

revoke execute on function private.notify_favorito_vendido() from public, anon, authenticated;

-- Solo `vendida`, no `pausada`: pausar y reactivar sería ruido — T32 (q). Y
-- `old.estado is distinct from new.estado`, porque un update sobre una ya
-- vendida (Studio) no es una venta nueva — T32 (r).
create trigger listings_notify_vendido
  after update of estado on public.listings
  for each row
  when (old.estado is distinct from new.estado and new.estado = 'vendida')
  execute function private.notify_favorito_vendido();

-- ===========================================================================
-- 4. La moderación borró mi foto de perfil (`avatar_eliminado`)
-- ===========================================================================
--
-- Hasta aquí, el borrado de un avatar solo dejaba `foto_url = null`, y eso no
-- distingue "lo quitó la moderación" de "lo quitó el usuario": el cliente nunca
-- escribe null ahí, pero el `grant update (foto_url)` se lo permite por API. El
-- aviso vivía en un toast que se pierde si el usuario no abre Perfil.
--
-- Por eso una tabla de AUDITORÍA que escribe `moderarAvatar()` con
-- `supabaseAdmin` al borrar, y un trigger sobre ella. Conserva "las
-- notificaciones solo nacen de triggers" y le da al borrado el rastro que antes
-- era solo un console.error.
create table public.avatar_moderacion (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references public.users(id) on delete cascade,
  storage_path        text not null,
  -- Si el guard de la carrera de moderarAvatar() dejó intacto `foto_url` (el
  -- usuario ya había subido OTRO avatar), el vigente no se perdió y no hay nada
  -- que avisar. Su único consumidor es el WHEN de abajo.
  foto_url_nulificado boolean not null,
  created_at          timestamptz not null default now()
);

-- Igual que `listing_moderacion`: el `revoke all` ES el control de acceso
-- entero, y RLS sin policies es la segunda capa. T12 vigila las dos.
revoke all on public.avatar_moderacion from anon, authenticated;
alter table public.avatar_moderacion enable row level security;

create function private.notify_avatar_eliminado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, tipo, titulo, cuerpo, listing_id)
  values (new.user_id, 'avatar_eliminado', 'Quitamos tu foto de perfil',
          'No pasó la revisión de contenido. Puedes subir otra desde Editar perfil.',
          null);
  return null;
end;
$$;

revoke execute on function private.notify_avatar_eliminado() from public, anon, authenticated;

create trigger avatar_moderacion_notify
  after insert on public.avatar_moderacion
  for each row
  when (new.foto_url_nulificado)
  execute function private.notify_avatar_eliminado();
