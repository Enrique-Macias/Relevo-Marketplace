-- Relevo — el precio de una publicación es un ENTERO de pesos, 0-100000
-- inclusive (RF-05). El 0 se permite: regalar un artículo es un caso válido.
--
-- No se cambia el tipo de `listings.precio` (`numeric(10,2)` se queda): el
-- check basta para exigir "sin decimales" y reescribir la tabla no aporta
-- nada que el check no dé ya. `precio = trunc(precio)` es la forma correcta
-- de expresar eso sobre un `numeric` — un `numeric(10,2)` puede guardar
-- 100.00 (SÍ es entero, 100 = trunc(100)) pero no 100.50.
--
-- Reemplaza al check original (`listings_precio_check`, solo `precio >= 0`,
-- 20260906000439:11) con el mismo nombre, para no dejar dos constraints
-- haciendo el trabajo de una.
alter table public.listings
  drop constraint listings_precio_check,
  add constraint listings_precio_check
    check (precio >= 0 and precio <= 100000 and precio = trunc(precio));

-- `private.formato_precio()` ya no necesita distinguir centavos: el check de
-- arriba garantiza que `p` SIEMPRE es un entero al llegar aquí (la función
-- solo se llama con `new.precio`/`old.precio` del trigger de notificaciones,
-- verificado por grep — no hay otro caller con un valor que sí pueda traer
-- decimales). `create or replace` conserva el OID y el `revoke execute` ya
-- aplicado (mismo patrón que `can_rate()`), así que no hace falta repetirlo.
create or replace function private.formato_precio(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p, 'FM999,999,999');
$$;
