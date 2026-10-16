-- Relevo — bloqueo entre usuarios (UGC-1, PL-006).
--
-- Semántica aprobada en UGC-1A (híbrida): si A bloquea a B,
--  · NINGUNO de los dos ve las publicaciones del otro (ni sus fotos);
--  · `seller_whatsapp` niega el número en las DOS direcciones;
--  · no se pueden registrar contactos NUEVOS entre ellos (`listing_contacts`);
--  · no nacen avisos usuario→usuario entre ellos (4 productores);
--  · todo lo histórico se queda: reseñas, contactos, ventas, avisos y reportes;
--  · solo A ve y deshace SU fila; B no puede leer ni listar quién lo bloqueó.
--
-- Piezas:
--  1. `public.user_bloqueos`: una fila por bloqueo, legible solo por quien lo
--     creó.
--  2. `private.bloqueos_vigentes()`: los ids con bloqueo EN CUALQUIER
--     DIRECCIÓN respecto a `auth.uid()`. Es lo que usa `listings_select`.
--  3. `private.listing_con_bloqueo(bigint)`: ¿el dueño de esa publicación está
--     en un bloqueo conmigo? Para el `with check` de `listing_contacts`.
--  4. `private.bloqueo_entre(uuid, uuid)`: para los 4 triggers de avisos.
--  5. `public.interaccion_disponible(uuid)`: el estado neutro del Perfil
--     público ("Este perfil no está disponible", UGC-1B.1).
--  6. Cambios a `listings_select`, `listing_contacts_insert_own`,
--     `seller_whatsapp` y a los 4 productores de avisos.
--
-- Lo prueba T40 de supabase/tests/rls.sql; por HTTP,
-- scripts/probe-bloqueos.mjs.

-- ---------------------------------------------------------------------------
-- 1. user_bloqueos
-- ---------------------------------------------------------------------------

-- Las dos FKs en cascade: borrar cualquiera de las dos cuentas borra el
-- bloqueo (T33 (h) barre toda columna uuid de `public`, así que una FK
-- equivocada aquí también la cazaría).
create table public.user_bloqueos (
  user_id      uuid not null references public.users(id) on delete cascade,
  bloqueado_id uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, bloqueado_id),
  constraint user_bloqueos_no_a_si_mismo check (user_id <> bloqueado_id)
);

-- La PK cubre "mis bloqueos" (columna líder `user_id`). Este índice cubre la
-- dirección inversa, "quién me bloqueó", que `bloqueos_vigentes()` necesita
-- para el bloqueo mutuo.
create index user_bloqueos_bloqueado_id_idx on public.user_bloqueos (bloqueado_id);

alter table public.user_bloqueos enable row level security;

-- Cada quien ve, crea y borra SOLO los bloqueos que ÉL creó. Una fila donde
-- solo aparezco como `bloqueado_id` no me es visible: así B no puede saber
-- quién lo bloqueó leyendo la tabla.
-- Sin `is_active_user()`, a propósito: bloquear es protegerse, y un suspendido
-- también tiene que poder hacerlo (mismo criterio que `favorites`).
create policy user_bloqueos_select_own on public.user_bloqueos
  for select to authenticated using (user_id = (select auth.uid()));

create policy user_bloqueos_insert_own on public.user_bloqueos
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy user_bloqueos_delete_own on public.user_bloqueos
  for delete to authenticated using (user_id = (select auth.uid()));

-- POR QUÉ ESTE REVOKE: el pg_default_acl de Supabase concede TODO sobre cada
-- tabla nueva de `public` a anon y authenticated, y los `grant` son aditivos
-- (CLAUDE.md §9). Sin UPDATE: un bloqueo no se edita, se borra.
-- Sin Realtime: nada lo escucha.
revoke all on public.user_bloqueos from anon, authenticated;
grant select, insert, delete on public.user_bloqueos to authenticated;

-- ---------------------------------------------------------------------------
-- 2. private.bloqueos_vigentes()
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER porque el bloqueo es MUTUO: cuando B consulta, la fila
-- relevante es la de A (`user_id = A, bloqueado_id = B`), y la RLS de arriba
-- se la esconde a B. Como invoker, el bloqueo solo se aplicaría en la
-- dirección de quien lo creó, en silencio (lo vigila T40 con su control
-- negativo).
--
-- SIN parámetros: siempre es respecto a `auth.uid()`, así que no sirve de
-- oráculo sobre relaciones entre terceros. Vive en `private`, que PostgREST no
-- expone: el cliente no la puede llamar.
--
-- Devuelve un arreglo y nunca null (el `coalesce`): sin bloqueos, `'{}'`. Si
-- algún día devolviera null, `listings_select` lo trata como fallo y CIERRA
-- (ver 6a).
--
-- `sql stable`, sin `plpgsql` ni bloque `exception` (KNOWN_ISSUES.md).
create function private.bloqueos_vigentes()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(x.id), '{}'::uuid[])
    from (
      select b.bloqueado_id as id
        from public.user_bloqueos b
       where b.user_id = (select auth.uid())
      union
      select b.user_id
        from public.user_bloqueos b
       where b.bloqueado_id = (select auth.uid())
    ) x;
$$;

-- EXECUTE para authenticated: la invoca una policy, y Postgres exige el
-- privilegio al rol que dispara la policy (CLAUDE.md §9 y el SIGSEGV de
-- KNOWN_ISSUES.md). T12 lo vigila con su invariante genérica por pg_depend.
revoke all on function private.bloqueos_vigentes() from public, anon;
grant execute on function private.bloqueos_vigentes() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. private.listing_con_bloqueo(bigint)
-- ---------------------------------------------------------------------------
--
-- Para el `with check` de `listing_contacts_insert_own`. Tiene que ser
-- DEFINER por la misma razón que la anterior y una más: la publicación de
-- quien me bloqueó YA no me es visible por `listings_select`, así que un
-- `exists` invoker sobre `listings` daría false y DEJARÍA PASAR el contacto.
-- Respecto a `auth.uid()` y solo para ESA publicación.
create function private.listing_con_bloqueo(p_listing_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.listings l
     where l.id = p_listing_id
       and l.user_id = any (private.bloqueos_vigentes())
  );
$$;

revoke all on function private.listing_con_bloqueo(bigint) from public, anon;
grant execute on function private.listing_con_bloqueo(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. private.bloqueo_entre(uuid, uuid)
-- ---------------------------------------------------------------------------
--
-- Para los 4 productores de avisos usuario→usuario, que son triggers DEFINER
-- y no tienen un `auth.uid()` confiable (pueden dispararse desde Studio o
-- desde una RPC). Recibe las DOS personas, así que SÍ sería un oráculo sobre
-- terceros: por eso NO tiene EXECUTE para nadie más que su dueño, y es
-- INVOKER (corre como el trigger que la llama, que ya es definer).
create function private.bloqueo_entre(p_a uuid, p_b uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.user_bloqueos b
     where (b.user_id = p_a and b.bloqueado_id = p_b)
        or (b.user_id = p_b and b.bloqueado_id = p_a)
  );
$$;

revoke all on function private.bloqueo_entre(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. public.interaccion_disponible(uuid)
-- ---------------------------------------------------------------------------
--
-- El estado neutro del Perfil público (UGC-1B.1). Cuando A bloqueó a B, la app
-- de B necesita saber "con este perfil no hay interacción" sin leer la fila de
-- A. NO se pudo reutilizar nada existente (UGC-1C, decisión F):
--  · `seller_whatsapp` devuelve null por CUATRO causas (sin número, llamante
--    suspendido, objetivo suspendido, bloqueo); separarlas con
--    `tiene_telefono` falla con un perfil sin número, y obligaría a pedir el
--    teléfono en cada visita al perfil, no solo al tocar el botón.
--  · Cero publicaciones no distingue "bloqueo" de "no publica".
--  · `bloqueos_vigentes()` devuelve la LISTA entera: exponerla dejaría a B
--    enumerar quién lo bloqueó en un solo request.
--
-- Contrato mínimo: un booleano, respecto a `auth.uid()` y a UN perfil.
-- `false` si hay bloqueo en cualquier dirección. No dice cuál: si B no tiene
-- fila propia, puede inferir que A lo bloqueó (decisión aceptada en UGC-1C).
-- ALCANCE HONESTO, el mismo de `seller_whatsapp` (CLAUDE.md §3): no es
-- enumerable en bloque, pero sí uno por uno, con un request por perfil.
--
-- Es la CUARTA función SECURITY DEFINER de `public` (CLAUDE.md §3): esta sí la
-- invoca el cliente por RPC.
create function public.interaccion_disponible(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
      from public.user_bloqueos b
     where (b.user_id = (select auth.uid()) and b.bloqueado_id = p_user_id)
        or (b.user_id = p_user_id and b.bloqueado_id = (select auth.uid()))
  );
$$;

revoke all on function public.interaccion_disponible(uuid) from public, anon;
grant execute on function public.interaccion_disponible(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6a. listings_select: el bloqueo bilateral
-- ---------------------------------------------------------------------------
--
-- Se SUMA (`and`) a la condición de siempre, sin tocarla: el dueño sigue viendo
-- lo suyo en cualquier estado, porque su propio id nunca está en el arreglo
-- (el `check` de arriba impide bloquearse a sí mismo).
--
-- FORMA (UGC-1C.1, medida con 80 000 activas y 0/1/50/1000 bloqueos como
-- `authenticated`): `not in` contra el `unnest` del arreglo. Postgres lo
-- resuelve como `hashed SubPlan`: llama al helper UNA vez por sentencia
-- (InitPlan, `(select ...)` entre paréntesis; una función definer no se
-- inlinea), arma una tabla hash y hace una búsqueda por fila. Se descartó
-- `user_id <> all (arreglo)`, que compara cada fila contra CADA id bloqueado
-- (filas × bloqueos: +28 a +122 ms con 1000 bloqueos), y `not exists` sobre el
-- arreglo, cuyo plan era inestable.
--
-- FAIL-CLOSED ante un helper roto: si `bloqueos_vigentes()` devolviera null,
-- el `coalesce` lo convierte en `{NULL}`, y `x not in (..., NULL)` nunca es
-- verdadero, así que la fila se ESCONDE (también al dueño: es el precio de
-- cerrar ante un estado inesperado). `coalesce(..., '{}')` haría lo contrario:
-- un helper null abriría todo el contenido bloqueado. Lo vigila T40 (b6).
--
-- Lo heredan, por correr como invoker contra esta tabla: el Feed, Categoría,
-- Búsqueda (`buscar_listings`), Recomendados (`recomendar_listings`), Detalle
-- por id, el Perfil público, el `!inner` de Favoritos, `listing_photos_select`
-- y la policy de Storage de `listing-photos`. T40 prueba cada uno.
alter policy listings_select on public.listings
  using (
    (estado <> all (array['pausada'::public.listing_status,
                          'pendiente'::public.listing_status,
                          'bloqueada'::public.listing_status])
     or user_id = (select auth.uid()))
    and user_id not in (
      select b.id
        from unnest(coalesce((select private.bloqueos_vigentes()), array[null]::uuid[])) as b(id)
    )
  );

-- ---------------------------------------------------------------------------
-- 6b. listing_contacts_insert_own: sin contactos NUEVOS entre bloqueados
-- ---------------------------------------------------------------------------
--
-- SOLO cierra el caso de una pareja bloqueada. Que hoy se pueda registrar un
-- contacto por id sin ver la publicación es un hueco general y anterior, con
-- su propia deuda (PL-052): no se arregla aquí. Los contactos históricos no se
-- tocan.
alter policy listing_contacts_insert_own on public.listing_contacts
  with check (
    user_id = (select auth.uid())
    and (select private.is_active_user())
    and not private.listing_con_bloqueo(listing_id)
  );

-- ---------------------------------------------------------------------------
-- 6c. seller_whatsapp: niega en las DOS direcciones
-- ---------------------------------------------------------------------------
--
-- `create or replace` conserva el OID, los grants y el contrato (mismo
-- argumento, mismo retorno, null y no excepción). La condición nueva va dentro
-- del mismo subselect que ya filtraba al objetivo suspendido.
create or replace function public.seller_whatsapp(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- Devuelve NULL —y no `raise exception`— en los cuatro casos: vendedor sin
  -- número, llamante suspendido, objetivo suspendido y bloqueo entre los dos
  -- (en cualquier dirección, 20261013000487). La función no dice por qué negó;
  -- la UI separa las causas con datos que ya tiene (el `estado` del propio
  -- usuario y el del vendedor, ambos dentro del grant de select, y
  -- `interaccion_disponible()` para el bloqueo).
  select case
    when (select private.is_active_user())
    then (select u.telefono
          from public.users u
          where u.id = p_user_id
            and u.estado = 'activo'
            and not exists (
              select 1
                from public.user_bloqueos b
               where (b.user_id = (select auth.uid()) and b.bloqueado_id = p_user_id)
                  or (b.user_id = p_user_id and b.bloqueado_id = (select auth.uid()))
            ))
  end;
$$;

-- ---------------------------------------------------------------------------
-- 6d. Los 4 productores de avisos usuario→usuario
-- ---------------------------------------------------------------------------
--
-- Con un bloqueo entre quien provoca el aviso y quien lo recibiría, el aviso
-- NO se crea. No basta con esconderlo: el push sale en el INSERT
-- (`notifications_notify_push`). `send-push` no cambia. Cada función es la
-- definición viva de antes con UNA condición más; los avisos históricos no se
-- tocan. Los productores del sistema (moderación, reporte resuelto, avatar) no
-- cambian: no hay otra persona en juego.

create or replace function private.notify_price_drop()
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
     and f.user_id <> new.user_id
     -- UGC-1: ni a quien tenga un bloqueo con el vendedor.
     and not private.bloqueo_entre(f.user_id, new.user_id);

  return null;  -- AFTER trigger: el valor de retorno se ignora.
end;
$$;

create or replace function private.notify_favorito_vendido()
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
                     where s.listing_id = new.id and s.comprador_id = f.user_id)
     -- UGC-1: ni a quien tenga un bloqueo con el vendedor.
     and not private.bloqueo_entre(f.user_id, new.user_id);

  return null;
end;
$$;

create or replace function private.notify_calificacion()
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
     and l.id = new.listing_id
     -- UGC-1: la reseña SÍ se guarda (O-2: bloquear no impide calificar una
     -- transacción legítima); lo que no nace es el aviso.
     and not private.bloqueo_entre(new.to_user_id, new.from_user_id);

  return null;
end;
$$;

create or replace function private.notify_compra_calificable()
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
   where l.id = new.listing_id
     -- UGC-1: la venta SÍ se registra; lo que no nace es el aviso.
     and not private.bloqueo_entre(new.comprador_id, l.user_id);

  return null;  -- AFTER trigger: el valor de retorno se ignora.
end;
$$;
