-- Relevo — `seller_whatsapp` valida las DOS puntas del contacto, no solo quien
-- llama.
--
-- Qué lo motivó: la prueba en dispositivo de RF-13 confirmó que un comprador
-- SUSPENDIDO no obtiene el número (el `case` que introdujo 20260910000448),
-- pero destapó lo contrario, que nadie estaba cubriendo: un comprador activo SÍ
-- podía contactar a un vendedor suspendido. La intención es que una cuenta
-- suspendida quede fuera del contacto en las dos direcciones.
--
-- POR QUÉ EL OBJETIVO VA CON `estado = 'activo'` INLINE Y NO CON
-- is_active_user():
-- ese helper resuelve `auth.uid()`, o sea el LLAMANTE, por definición — no
-- acepta parámetro y no hay forma de preguntarle por un tercero. El estado del
-- objetivo se lee de la fila que la función ya está leyendo, así que el filtro
-- entra en el `where` del subselect y no cuesta ni una lectura extra.
--
-- Sigue siendo `sql` pura, `stable`, sin `plpgsql` ni bloque EXCEPTION: la
-- cautela que impone supabase/KNOWN_ISSUES.md. El `case` no creció.
--
-- Se reemplaza en una migración NUEVA en vez de editar 20260910000448, que ya
-- está aplicada al remoto. La firma no cambia, así que los grants de aquella
-- siguen vigentes y no hay que regenerar tipos.
create or replace function public.seller_whatsapp(p_user_id uuid)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  -- Devuelve NULL —y no `raise exception`— en los tres casos: vendedor sin
  -- número, llamante suspendido y objetivo suspendido. La función no dice por
  -- qué negó; la UI separa las causas con datos que ya tiene (el `estado` del
  -- propio usuario y el del vendedor, ambos dentro del grant de select).
  select case
    when (select private.is_active_user())
    then (select u.telefono
          from public.users u
          where u.id = p_user_id
            and u.estado = 'activo')
  end;
$$;
