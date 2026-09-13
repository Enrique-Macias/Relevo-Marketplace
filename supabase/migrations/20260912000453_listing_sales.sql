-- Relevo — quién compró (RF-07 / RF-12) y el cuarto disparador de RF-16.
--
-- Cierra el flujo "Marcar como vendida → ¿A quién le vendiste? → Calificar":
-- hasta ahora el estado `vendida` existía en el enum pero nadie lo escribía,
-- porque cablearlo sin registrar al comprador rompía RF-12 — el vendedor no
-- sabe quién compró (no hay chat interno) y sin esa elección nadie puede
-- calificar a nadie.

-- ---------------------------------------------------------------------------
-- La tabla
-- ---------------------------------------------------------------------------

-- POR QUÉ ESTO NO ES UNA COLUMNA `listings.comprador_id`, que es lo primero que
-- uno escribe:
--   1. `listings` tiene `grant select` A NIVEL TABLA (20260906000439:86), así
--      que toda columna nueva queda legible por cualquier autenticado que pueda
--      ver la fila — y `listings_select` solo esconde las `pausada`, o sea que
--      una publicación vendida la ve el campus entero.
--   2. Sacar una columna de ese grant exigiría convertirlo a lista de columnas,
--      que es justo lo que hoy hace funcionar a `listings.busqueda` sin grant
--      propio (CLAUDE.md §3, vigilado por T13): "endurecerlo" rompería la
--      búsqueda sin ningún error visible, y dejaría invisible a toda columna
--      futura.
--   3. Quién compró es MÁS revelador que quién preguntó, y `listing_contacts`
--      ya es privado entre las dos partes. Esta tabla hereda esa postura.
-- De regalo, el trigger de notificación de abajo cuelga de esta tabla y no de
-- `listings`, donde `increment_listing_view()` y `set_updated_at` disparan en
-- TODOS los updates y obligarían a una cláusula `when` defensiva (§3).
create table public.listing_sales (
  -- PK SOBRE `listing_id`: una publicación tiene un comprador o ninguno. De
  -- esta unicidad dependen los `not exists` de can_rate() más abajo — sin ella
  -- dirían algo distinto de lo que parecen decir.
  listing_id   bigint primary key references public.listings(id) on delete cascade,
  comprador_id uuid   not null    references public.users(id)    on delete cascade,
  created_at   timestamptz not null default now()
);

-- "¿Qué compré?" — lo usa el Detalle para saber si quien mira es el comprador.
create index listing_sales_comprador_idx on public.listing_sales (comprador_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.listing_sales enable row level security;

-- Solo las dos partes. Ni los otros contactos, ni el resto del campus. Es el
-- mismo criterio de `listing_contacts_select` (20260906000440:57-63).
create policy listing_sales_select on public.listing_sales
  for select to authenticated
  using (
    comprador_id = (select auth.uid())
    or exists (select 1 from public.listings l
               where l.id = listing_id and l.user_id = (select auth.uid()))
  );

-- El `exists` sobre listing_contacts es EL punto de enforcement de "el comprador
-- tiene que haberte contactado". Sin él, un vendedor apunta a cualquiera y le
-- dispara la notificación de abajo: un aviso de spam por víctima por
-- publicación.
--
-- NO NECESITA `SECURITY DEFINER`: las expresiones de policy se evalúan como el
-- rol invocante, y el vendedor ya ve su propio listing (`listings_select`) y sus
-- propios contactos (`listing_contacts_select`).
--
-- NO EXIGE `estado = 'vendida'`, y eso es deliberado: es lo que permite que el
-- cliente inserte ANTES de marcar la publicación. Al revés, un fallo entre los
-- dos statements dejaría una publicación `vendida` sin comprador registrado y
-- SIN SALIDA — la entrada "Marcar como vendida" ya habría desaparecido.
create policy listing_sales_insert_seller on public.listing_sales
  for insert to authenticated
  with check (
    exists (select 1 from public.listings l
            where l.id = listing_id and l.user_id = (select auth.uid()))
    and comprador_id <> (select auth.uid())
    and (select private.is_active_user())
    and exists (select 1 from public.listing_contacts c
                where c.listing_id = listing_sales.listing_id
                  and c.user_id = comprador_id)
  );

-- Corregir al comprador mal elegido, hasta que la venta produzca consecuencias.
--
-- EL CONGELAMIENTO ES DIRECCIONAL, y esa es la parte que se decidió a mano:
-- cierra la ventana la reseña DEL VENDEDOR hacia el comprador registrado, NO
-- "cualquier reseña de la venta". Las dos direcciones no son simétricas en
-- consecuencia:
--   · Si el vendedor ya calificó a quien asignó, existe una reseña SUYA sobre
--     alguien que quizá nunca le compró; dejarlo mover la venta sería lavarla
--     mientras sigue contando en el rating_promedio de esa persona.
--   · Si quien calificó fue el otro, esa reseña se sostiene sola (sí hubo
--     contacto real), y congelar por ella castigaría al vendedor y al comprador
--     REAL por el acto de un tercero: el comprador real no podría ser
--     acreditado ni calificar nunca.
-- Si alguien "simplifica" esto a las dos direcciones, no rompe nada visible —
-- solo vuelve incorregible un error ajeno. Lo vigila T19 (l2).
--
-- EL `USING` SE EVALÚA CONTRA LA FILA VIEJA, y aquí eso es exactamente lo que se
-- quiere: `listing_sales.comprador_id` dentro del not exists es el comprador
-- ORIGINAL, o sea la pregunta es "¿ya califiqué YO a quien tengo registrado?".
-- Es la misma semántica del gotcha de CLAUDE.md §9 (ON CONFLICT DO UPDATE
-- evalúa el USING contra la fila vieja), esta vez a favor.
--
-- Un rechazo por esta policy NO lanza error: el `using` filtra, así que el
-- cliente recibe 0 filas afectadas y tiene que comparar el conteo.
create policy listing_sales_update_seller on public.listing_sales
  for update to authenticated
  using (
    exists (select 1 from public.listings l
            where l.id = listing_id and l.user_id = (select auth.uid()))
    and (select private.is_active_user())
    and not exists (
      select 1 from public.ratings r
      where r.listing_id   = listing_sales.listing_id
        and r.from_user_id = (select auth.uid())
        and r.to_user_id   = listing_sales.comprador_id
    )
  )
  with check (
    exists (select 1 from public.listings l
            where l.id = listing_id and l.user_id = (select auth.uid()))
    and comprador_id <> (select auth.uid())
    and exists (select 1 from public.listing_contacts c
                where c.listing_id = listing_sales.listing_id
                  and c.user_id = comprador_id)
  );

-- POR QUÉ ESTE REVOKE (aplica a TODA tabla nueva de este proyecto):
-- Supabase define un pg_default_acl que concede automáticamente TODOS los
-- privilegios sobre cada tabla nueva de `public` a anon y authenticated. Los
-- `grant` de abajo son ADITIVOS: suman permisos, nunca retiran los que ese
-- default ya otorgó. Sin este revoke previo, el `grant update (comprador_id)`
-- sería decorativo y el vendedor podría reapuntar `listing_id`, moviendo la
-- venta a otra publicación.
revoke all on public.listing_sales from anon, authenticated;

grant select, insert on public.listing_sales to authenticated;

-- GRANT DE COLUMNA, no de tabla — mismo mecanismo que hace inmutables a
-- ratings.to_user_id / listing_id (20260906000440:190-195). `listing_id` es la
-- PK y no se mueve; `created_at` es cuándo se registró la venta, no se reescribe.
grant update (comprador_id) on public.listing_sales to authenticated;

-- SIN delete (ni grant ni policy): borrar la venta sería decir "no fue a través
-- de Relevo" después de haberla registrado, y eso se resuelve corrigiendo a la
-- persona correcta. Decisión de alcance, no olvido.

-- ---------------------------------------------------------------------------
-- can_rate() se aprieta en LAS DOS direcciones
-- ---------------------------------------------------------------------------

-- Hasta aquí, can_rate() solo miraba `listing_contacts`: CUALQUIERA de los que
-- contactó podía calificar al vendedor (haya comprado o no) y el vendedor podía
-- calificar a cualquiera de sus contactos (le haya vendido o no). Con la venta
-- registrada, la única pareja que puede calificarse es vendedor ↔ comprador.
--
-- CREATE OR REPLACE Y NO DROP+CREATE: conserva el OID, así que las dos policies
-- que la invocan (ratings_insert_own, ratings_update_own — 20260906000440:166-176)
-- siguen funcionando y el `grant execute` a `authenticated` (:132) persiste. Un
-- drop obligaría a recrear las dos policies y a rehacer el grant.
create or replace function private.can_rate(p_to_user uuid, p_listing_id bigint)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (                     -- soy el vendedor y esa persona me contactó
    select 1
    from public.listings l
    join public.listing_contacts c on c.listing_id = l.id
    where l.id = p_listing_id
      and l.user_id = (select auth.uid())
      and c.user_id = p_to_user
      -- Como la PK de listing_sales es listing_id, hay a lo sumo UNA fila, así
      -- que esta negación dice exactamente: "no hay venta registrada, o la
      -- venta es de esa persona".
      and not exists (
        select 1 from public.listing_sales s
        where s.listing_id = l.id and s.comprador_id <> p_to_user
      )
  ) or exists (                       -- o yo contacté y esa persona es el vendedor
    select 1
    from public.listings l
    join public.listing_contacts c on c.listing_id = l.id
    where l.id = p_listing_id
      and l.user_id = p_to_user
      and c.user_id = (select auth.uid())
      and not exists (
        select 1 from public.listing_sales s
        where s.listing_id = l.id and s.comprador_id <> (select auth.uid())
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Disparador 3 — te acreditaron una compra, califícala (RF-16)
-- ---------------------------------------------------------------------------

-- ES EL PRIMER VALOR QUE SE SUMA A ESTE ENUM desde que se creó, y el primero con
-- un productor real: los dos que se dejaron fuera en 20260911000451
-- (`correo_verificado`, `nueva_publicacion`) siguen sin él.
--
-- ALTER TYPE ADD VALUE corre dentro del bloque transaccional de la migración
-- (Postgres 12+), y el valor nuevo NO se puede USAR hasta que esa transacción
-- commitee. Aquí solo se declara: el cuerpo de la función de abajo no se ejecuta
-- al crearse, así que no lo usa.
alter type public.notification_type add value 'compra_calificable';

-- SECURITY DEFINER por el mismo motivo que notify_price_drop(): inserta en
-- `notifications`, donde NADIE tiene grant de insert. Vive en `private` y queda
-- revocada: solo dispara por trigger.
create function private.notify_compra_calificable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, tipo, titulo, cuerpo, listing_id)
  select new.comprador_id,
         'compra_calificable',
         'Califica tu compra',
         '"' || l.titulo || '" — cuéntanos cómo te fue con '
              || coalesce(u.nombre, 'el vendedor') || '.',
         -- listing_id SÍ va poblado, a diferencia de `reporte_resuelto`: el tap
         -- tiene que llevar al Detalle, que es donde vive el botón de calificar.
         l.id
    from public.listings l
    join public.users u on u.id = l.user_id
   where l.id = new.listing_id;

  return null;  -- AFTER trigger: el valor de retorno se ignora.
end;
$$;
-- `coalesce(u.nombre, …)`: nombre es nullable hasta que el usuario pasa por
-- "Completar perfil", igual que lo maneja iniciales() (src/lib/format.ts).

revoke execute on function private.notify_compra_calificable()
  from public, anon, authenticated;

-- DOS TRIGGERS Y NO UNO, y no es estilo: el `WHEN` de un trigger declarado sobre
-- INSERT y UPDATE a la vez no puede referenciar OLD ("OLD cannot be referenced
-- in ON INSERT trigger"). La rama de insert no necesita WHEN —todo insert en
-- esta tabla ES una venta—, que es parte de lo que se gana al colgar esto de
-- `listing_sales` en vez de `listings`.
create trigger listing_sales_notify_insert
  after insert on public.listing_sales
  for each row execute function private.notify_compra_calificable();

-- La corrección tiene que avisar al comprador NUEVO, o nunca se entera de que
-- le acreditaron la compra. El anterior se queda con su aviso: `notifications`
-- no tiene grant de delete y sus filas son historia. Degrada bien — el tap lo
-- lleva al Detalle, donde el botón está gateado por la fila de venta, que ya no
-- es suya.
create trigger listing_sales_notify_correccion
  after update of comprador_id on public.listing_sales
  for each row
  when (old.comprador_id is distinct from new.comprador_id)
  execute function private.notify_compra_calificable();
