-- Relevo — el WhatsApp del perfil acepta cualquier país (estudiantes de
-- intercambio), sin perder la validación estricta de México.
--
-- Cierra la deuda consciente de 20260910000448 ("la lada está fija en +52"):
-- el dato ya era E.164, así que el costo es este check y el selector de país
-- del cliente.
--
-- LA REGLA, dos mitades:
--   · E.164 genérico: `+`, una lada que NO empieza con 0, y de 8 a 15 dígitos
--     EN TOTAL (lada incluida). 15 es el máximo de E.164; 8 deja fuera los
--     números incompletos sin excluir ningún plan de numeración real.
--   · Y si la lada es +52, exactamente 10 dígitos después — la regla que ya
--     había, intacta para México. Los códigos de país son prefix-free (ninguno
--     empieza con 52 salvo México), así que `^\+52` es México y nada más.
--
-- La validación POR PAÍS (qué longitudes y prefijos son válidos en España, en
-- Alemania…) NO vive aquí: son cientos de reglas que cambian, y las trae
-- libphonenumber-js del lado del cliente. La base garantiza la FORMA; el
-- cliente ayuda a capturar bien, y lo que el cliente acepta es subconjunto de
-- lo que acepta esto (lo vigila `scripts/probe-perfil.mjs`).
--
-- RENOMBRADO de `users_telefono_e164_mx` a `users_telefono_e164`: con el
-- sufijo `_mx` el nombre mentiría sobre lo que valida. Nadie depende del
-- nombre viejo — grep sobre `src`, `scripts` y `supabase/functions` no lo
-- encuentra; solo lo citaban las pruebas y la documentación.
--
-- Datos previos: en remoto hay 4 teléfonos y los 4 son +52 con 10 dígitos
-- (medido por conteo), que el check nuevo acepta igual que el viejo — para
-- +52 las dos reglas son idénticas.
--
-- Drop + add en la MISMA migración (una transacción): no hay ventana sin check.

alter table public.users drop constraint users_telefono_e164_mx;

alter table public.users add constraint users_telefono_e164 check (
  telefono is null or (
    telefono ~ '^\+[1-9][0-9]{7,14}$'
    and (telefono !~ '^\+52' or telefono ~ '^\+52[0-9]{10}$')
  )
);
