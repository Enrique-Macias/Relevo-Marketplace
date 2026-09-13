-- Relevo — inbox de notificaciones y sus dos disparadores (RF-16).
--
-- La pantalla "Notificaciones" del diseño NO es un espejo del push: tiene hora
-- relativa y punto de no leído por fila, o sea que es un inbox persistido. Esa
-- tabla tiene que existir de todos modos — y por eso ELLA es el outbox del push
-- (ver 20260911000452), en vez de colgar un webhook de `listings` y otro de
-- `reports`.
--
-- Dos disparadores, que son los dos que RF-16 pide y tienen datos reales hoy:
-- baja de precio de un favorito, y resolución de un reporte. El tercero de
-- RF-16 —nueva publicación en categoría seguida— es opcional y no tiene modelo
-- (no existe "seguir una categoría" ni en el esquema ni en el diseño).

-- `correo_verificado` y `nueva_publicacion` aparecen como filas en el frame del
-- diseño pero NO entran al enum: la primera no tiene disparador (ocurre en el
-- alta) y la segunda no tiene modelo. Un valor de enum sin productor solo
-- genera ramas muertas en el `switch` del cliente.
create type public.notification_type as enum ('precio_favorito', 'reporte_resuelto');

-- ---------------------------------------------------------------------------
-- La tabla
-- ---------------------------------------------------------------------------

create table public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  tipo       public.notification_type not null,
  -- POR QUÉ EL TEXTO SE MATERIALIZA AQUÍ Y NO SE DERIVA EN EL CLIENTE:
  -- el mensaje del diseño dice "ahora cuesta $2,900, ANTES $3,200", y el precio
  -- anterior NO EXISTE EN NINGÚN LADO después del UPDATE que dispara el trigger.
  -- Es el mismo criterio de snapshot que ya usa `reports.listing_titulo`
  -- (20260906000441). De paso deja a la Edge Function del push sin una sola
  -- línea de lógica de negocio: recibe el título y el cuerpo ya resueltos.
  titulo     text not null,
  cuerpo     text not null,
  -- A dónde lleva el tap. `set null` y no `cascade`: si la publicación
  -- desaparece, la notificación sigue siendo historia legible y el tap
  -- simplemente no navega. Queda NULL en las de reporte, a propósito — ver
  -- `notify_report_resolved()` abajo.
  listing_id bigint references public.listings(id) on delete set null,
  leida_at   timestamptz,
  -- Lo sella la Edge Function con service_role. Es lo único que permite
  -- responder después "¿este aviso llegó a salir?" cuando alguien reporta que
  -- vio la fila en el inbox pero nunca recibió el push.
  push_enviado_at timestamptz,
  created_at timestamptz not null default now()
);

-- El listado del inbox, que es siempre "las mías, más recientes primero".
create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- El punto de la campana del Feed: un count de no leídas por usuario. Parcial
-- porque lo normal es tener casi todo leído.
create index notifications_no_leidas_idx
  on public.notifications (user_id) where leida_at is null;

-- ---------------------------------------------------------------------------
-- Formato del precio, del lado del servidor
-- ---------------------------------------------------------------------------

-- Tiene que existir aquí porque el cuerpo del mensaje se arma en el trigger,
-- así que duplica a `formatPrecio` (src/lib/format.ts). Se acepta la
-- duplicación —dos fuentes de verdad del mismo string sería peor— y se vigila
-- con una aserción de T18 que compara la salida contra un precio con centavos.
--
-- EL `case` NO ES ADORNO: `to_char(p, 'FM999,999,999')` a secas REDONDEA.
-- Medido: 99.50 → "100" y 0.50 → "1", que no es lo que pinta el cliente.
-- Y el `0` de 'FM999,999,990.00' tampoco: sin él, 0.50 saldría ".50".
create function private.formato_precio(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p = trunc(p) then to_char(p, 'FM999,999,999')
    else to_char(p, 'FM999,999,990.00')
  end;
$$;

revoke execute on function private.formato_precio(numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Disparador 1 — bajó el precio de un favorito
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER por DOS motivos a la vez, no uno:
--   1. Tiene que leer filas de `favorites` que la RLS le esconde al invocante.
--      Ni siquiera el dueño de la publicación puede verlas — por eso existe
--      `listing_favorites_count` (CLAUDE.md §3).
--   2. Tiene que insertar en `notifications`, donde NADIE tiene grant de insert.
-- Vive en `private` y queda revocada: solo dispara por trigger, como las otras
-- cinco de su tipo.
create function private.notify_price_drop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, tipo, titulo, cuerpo, listing_id)
  select f.user_id,
         'precio_favorito',
         'Bajó el precio de un favorito',
         '"' || new.titulo || '" ahora cuesta $'
              || private.formato_precio(new.precio)
              || ', antes $' || private.formato_precio(old.precio) || '.',
         new.id
    from public.favorites f
   where f.listing_id = new.id
     -- No se avisa al vendedor de su propio cambio. Puede marcar como favorita
     -- su propia publicación: la RLS de `favorites` solo compara
     -- `user_id = auth.uid()`, no impide nada. Este `<>` es el único punto donde
     -- esa regla se hace cumplir, y lleva su aserción en T18.
     and f.user_id <> new.user_id;

  return null;  -- AFTER trigger: el valor de retorno se ignora.
end;
$$;

revoke execute on function private.notify_price_drop() from public, anon, authenticated;

-- LAS DOS CONDICIONES DEL `when` SON LOAD-BEARING, no una optimización — misma
-- lección que el `when` de `listings_enforce_activation_has_photos` (§3):
--   · `new.precio < old.precio` — subir el precio no notifica a nadie.
--   · `new.estado = 'activa'`  — una publicación pausada no la puede VER quien
--     la tiene en favoritos (`listings_select`), así que avisarle la mandaría a
--     un callejón sin salida.
-- Y de paso el `when` mantiene al trigger fuera del camino de todo `update`
-- sobre `listings` que no toque el precio: `increment_listing_view()` hace uno
-- en cada apertura del Detalle, y `set_updated_at` dispara en absolutamente
-- todos.
create trigger listings_notify_price_drop
  after update on public.listings
  for each row
  when (new.precio < old.precio and new.estado = 'activa')
  execute function private.notify_price_drop();

-- ---------------------------------------------------------------------------
-- Disparador 2 — hay respuesta a un reporte
-- ---------------------------------------------------------------------------

-- NO HACE FALTA UN CAMPO `respuesta` EN `reports`, y conviene saber por qué
-- antes de agregarlo: el copy del diseño ("Revisamos tu reporte sobre una
-- publicación y tomamos acción") es genérico y se deriva entero de `estado` +
-- `listing_titulo`. Además un campo de texto libre no tendría quién lo
-- escribiera: RF-17 pone la moderación en Studio, que es un editor de celdas.
--
-- El cuerpo NO puede depender de `auth.uid()`: esta transición siempre la hace
-- service_role desde Studio, porque `reports` no tiene grant de update para
-- `authenticated` (20260906000441).
create function private.notify_report_resolved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_objeto text := case when new.listing_id is not null or new.listing_titulo is not null
                        then 'una publicación'
                        else 'un usuario'
                   end;
begin
  insert into public.notifications (user_id, tipo, titulo, cuerpo, listing_id)
  values (
    new.reporter_id,
    'reporte_resuelto',
    'Respuesta a tu reporte',
    case new.estado
      when 'resuelto' then 'Revisamos tu reporte sobre ' || v_objeto || ' y tomamos acción.'
      else 'Revisamos tu reporte sobre ' || v_objeto || '. No encontramos motivo para tomar acción.'
    end,
    -- `listing_id` va NULL aunque el reporte sí apunte a una publicación: el
    -- tap llevaría al reportante de vuelta al contenido que denunció, que es
    -- justo lo que no quiere ver. La notificación se queda en el inbox.
    null
  );

  return null;
end;
$$;

revoke execute on function private.notify_report_resolved() from public, anon, authenticated;

create trigger reports_notify_resolved
  after update on public.reports
  for each row
  when (old.estado is distinct from new.estado and new.estado <> 'pendiente')
  execute function private.notify_report_resolved();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.notifications enable row level security;

create policy notifications_select_own on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));

-- Solo para marcar leído. Lo que ACOTA qué se puede escribir no es esta policy
-- sino el grant de columna de abajo: la policy decide QUÉ FILAS, el grant decide
-- QUÉ COLUMNAS.
create policy notifications_update_own on public.notifications
  for update to authenticated
  using      (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- POR QUÉ ESTE REVOKE (aplica a TODA tabla nueva de este proyecto):
-- Supabase define un pg_default_acl que concede automáticamente TODOS los
-- privilegios sobre cada tabla nueva de `public` a anon y authenticated. Los
-- `grant` de abajo son ADITIVOS: suman permisos, nunca retiran los que ese
-- default ya otorgó. Sin este revoke previo, `grant update (leida_at)` sería
-- decorativo y cualquiera podría reescribir el `titulo` de su propia
-- notificación — o insertarse notificaciones a mano.
revoke all on public.notifications from anon, authenticated;

-- Select a nivel TABLA y no por lista de columnas: aquí no hay ninguna columna
-- que esconder, y un grant por lista se rompería en silencio con la primera
-- columna que se agregue (es lo que le pasó a `listings.busqueda`, §3, pero al
-- revés).
grant select on public.notifications to authenticated;

-- GRANT DE COLUMNA, no de tabla: es lo único que impide que el cliente reescriba
-- `titulo`/`cuerpo`. Mismo mecanismo que protege `listings.vistas_count`.
grant update (leida_at) on public.notifications to authenticated;

-- SIN insert ni delete para el cliente: las filas solo nacen de los triggers de
-- arriba y solo mueren con el `cascade` del usuario.
