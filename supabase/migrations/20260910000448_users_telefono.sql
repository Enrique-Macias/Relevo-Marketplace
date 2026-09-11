-- Relevo — teléfono del vendedor (RF-13), con su lectura acotada por RPC.
--
-- Cierra el "HUECO CONOCIDO" de docs/product-spec.md: RF-13 pide un botón que
-- abra WhatsApp "con el vendedor", pero ninguna entidad guardaba un número, así
-- que el deep link de la app usaba un placeholder. Lo que YA era real es el
-- registro en listing_contacts (lo que habilita RF-12); lo que no llegaba a
-- nadie era el mensaje.

alter table public.users add column telefono text;

-- Formato E.164 mexicano: +52 y 10 dígitos nacionales. Se guarda con el `+`
-- aunque wa.me lo pida sin él (el cliente lo quita al armar la URL) porque
-- +528111234567 es un número sin ambigüedad y 528111234567 es una cadena que
-- hay que saber interpretar.
--
-- DEUDA CONSCIENTE (CLAUDE.md §8): la lada está fija en +52 porque hoy el
-- catálogo es mexicano y nadie pidió otra cosa. Disparador: que se abra la app
-- a una universidad fuera de México. Fix: alterar este check y agregar el
-- selector de país a los frames de Publicar / Editar perfil. El dato ya es
-- E.164, así que el costo futuro es acotado.
alter table public.users add constraint users_telefono_e164_mx
  check (telefono is null or telefono ~ '^\+52[0-9]{10}$');

-- "¿Este usuario es contactable?" sin revelar el número.
--
-- Es columna GENERADA por el mismo motivo que listings.busqueda: una expresión
-- materializada sí es referenciable por nombre desde PostgREST, y un cliente no
-- puede pedir `telefono is not null` sin tener SELECT sobre `telefono` — que es
-- justo lo que no va a tener. La necesita el gate de Publicar, que decide en el
-- render si mostrar el campo, sin un round trip extra ni parpadeo.
alter table public.users
  add column tiene_telefono boolean generated always as (telefono is not null) stored;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- OJO — ESTA TABLA NO NECESITA EL `revoke all` DEL PATRÓN DE CLAUDE.md §9, Y
-- CONVIENE SABER POR QUÉ ANTES DE "CORREGIRLO":
-- ese patrón existe porque el pg_default_acl de Supabase concede todo sobre
-- cada tabla NUEVA de `public`. Aquí no hay tabla nueva: son columnas
-- agregadas a una tabla existente, y un default ACL no se aplica
-- retroactivamente a una columna. Además el `select` de public.users está
-- acotado POR LISTA DE COLUMNAS desde 20260906000438, no a nivel tabla, así que
-- tampoco hay grant heredado que arrastre — al revés que listings.busqueda,
-- donde el `select` de tabla sí cubrió la columna nueva (CLAUDE.md §3).
-- O sea: `telefono` nace SIN privilegios y solo tiene lo que se le dé abajo.
-- La suite (T16) lo prueba en vez de darlo por sentado.

-- El booleano sí es público: es el dato que hace falta para saber si tiene
-- sentido ofrecer el botón, y no dice nada del número.
grant select (tiene_telefono) on public.users to authenticated;

-- El número lo escribe su dueño (users_update_own ya acota a auth.uid()).
-- `telefono` NO entra a ningún grant de select: se lee solo por la RPC de
-- abajo. `tiene_telefono` no entra a ningún grant de update porque no hace
-- falta — Postgres rechaza toda escritura sobre una columna generada, sin
-- importar los privilegios.
grant update (telefono) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- Lectura del número — RF-13 sin romper RNF-05
-- ---------------------------------------------------------------------------

-- POR QUÉ VIVE EN `public` Y NO EN `private`:
-- la regla del proyecto es que toda función SECURITY DEFINER vive en `private`,
-- salvo las que el cliente debe poder invocar por RPC vía PostgREST. Esta es la
-- TERCERA y por el mismo motivo exacto que las otras dos
-- (increment_listing_view, listing_favorites_count): la llama Detalle desde el
-- cliente, al tocar "Contactar por WhatsApp".
--
-- POR QUÉ NO ES UN `grant select (telefono)`:
-- users_select es `to authenticated using (true)` — un directorio semi-público
-- a propósito, porque hace falta ver a otros para Perfil público y las reseñas.
-- Con el teléfono en el grant de select, cualquier autenticado se baja el
-- número de TODOS los usuarios en un solo request a la Data API. RNF-05 dice
-- literalmente "no exponer correo/teléfono públicamente sin consentimiento", y
-- product-spec.md lo aterriza: "el número solo debería viajar al abrir
-- WhatsApp, no en el select del perfil público". Es el mismo criterio que
-- protege `correo` desde 20260906000438.
--
-- ALCANCE HONESTO DE LO QUE ESTO COMPRA:
-- el número queda NO ENUMERABLE EN BLOQUE, no inaccesible. `users.id` sí está
-- en el grant de select, así que un cliente hostil podría iterar ids y llamar
-- esta función N veces. Son N requests observables y limitables contra 1
-- invisible. Revisar si aparecen llamadas masivas en los logs.
--
-- POR QUÉ VALIDA AL LLAMANTE, Y NO SOLO A QUIÉN SE LE PIDE EL NÚMERO:
-- la tabla de decisión de CLAUDE.md §3 dice que un usuario suspendido NO puede
-- contactar por WhatsApp. Esa regla parecía cubierta por
-- listing_contacts_insert_own (20260906000440), que exige is_active_user() —
-- pero el cliente se traga ese rechazo A PROPÓSITO: negarle el contacto a
-- alguien por un fallo de log sería peor que perder la fila, así que abre
-- wa.me igual y solo avisa con un toast. Correcto para un fallo de red, y con
-- el efecto colateral de que el único efecto real de estar suspendido era no
-- quedar registrado. Con el número detrás de esta función, ESTA es la única
-- pieza donde la regla se puede hacer cumplir de verdad — así que la hace
-- cumplir ella. Sin este `case`, la regla queda escrita y no aplicada.
create function public.seller_whatsapp(p_user_id uuid)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  -- Devuelve NULL —y no `raise exception`— al suspendido, por el mismo motivo
  -- que listing_favorites_count se lo devuelve a quien no es dueño: mantiene
  -- esto como función `sql` pura, sin plpgsql ni bloque EXCEPTION, que es la
  -- cautela que impone supabase/KNOWN_ISSUES.md.
  --
  -- auth.uid() sigue siendo el del LLAMANTE aunque el cuerpo corra como el
  -- dueño de la función: sale de un GUC de la transacción, no del rol actual.
  -- Es el mismo mecanismo del que ya depende listing_favorites_count.
  select case
    when (select private.is_active_user())
    then (select u.telefono from public.users u where u.id = p_user_id)
  end;
$$;

-- Postgres concede EXECUTE a PUBLIC por default en cada función nueva: sin este
-- revoke, `anon` puede invocarla aunque nunca se le haya otorgado nada.
revoke execute on function public.seller_whatsapp(uuid) from public, anon;
grant  execute on function public.seller_whatsapp(uuid) to authenticated;
