-- ===========================================================================
-- Relevo — PL-016: HERRAMIENTA DE RECUPERACIÓN de 20261026000490
-- (aceptación de Términos y presentación del Aviso de privacidad).
--
-- ESTO NO ES UNA MIGRACIÓN. NO va en supabase/migrations/, NO se aplica sola y
-- NO se ejecuta directo en Studio (ni en remoto ni "para probar").
--
-- PROCEDIMIENTO SI HAY QUE RECUPERAR EN STAGING (mismo contrato que
-- docs/rf17-ola6-recuperacion.sql):
--   1. Se decide el NIVEL (abajo) y se crea una migración correctiva NUEVA,
--      append-only, con el siguiente consecutivo libre en ese momento, que
--      contiene EXACTAMENTE ese bloque copiado tal cual. La …490 NO se
--      modifica nunca.
--   2. `supabase db push --linked --dry-run --skip-vault` (debe listar solo la
--      correctiva) → aprobación del usuario → `supabase db push --linked
--      --skip-vault`.
--   Así quedan alineados el historial de migraciones, `schema_migrations`, el
--   estado real del remoto y Git. Ejecutar esto a mano dejaría en
--   `schema_migrations` una versión cuyos objetos ya no existen.
--
-- QUÉ NIVEL:
--   - NIVEL 1, INTERRUPTOR (no borra nada). `terminos_vigentes_aceptados()`
--     pasa a devolver true: se levantan TODOS los candados de la …490 (las 9
--     policies, los 2 triggers y la quinta causa de null de seller_whatsapp)
--     sin tocar el catálogo ni las aceptaciones. Es la salida para "un build
--     viejo quedó bloqueado" o "un candado rechaza algo que no debía".
--     La app nueva sigue mostrando "Términos actualizados" a quien no aceptó
--     (estado_terminos no cambia) y aceptar sigue funcionando.
--     Se deshace con el BLOQUE N1-DESHACER (la definición original, tal cual).
--   - NIVEL 2, REVERSIÓN COMPLETA. Deja la superficie exactamente como antes
--     de la …490: las 9 policies con su texto previo (leído de STAGING el
--     2026-10-27), seller_whatsapp con el cuerpo de 20261013000487 y sin los
--     2 triggers, las 7 funciones ni las 2 tablas. Además de la correctiva,
--     el repo tiene que dejar de pedir la …490 otra vez (se decide entonces:
--     o la …490 se vuelve a aplicar después con otra correctiva, o se retira
--     del repo con su propio commit).
--
-- ADVERTENCIAS:
--   - EL NIVEL 2 BORRA IRREVERSIBLEMENTE public.aceptaciones_legales (la
--     evidencia de quién aceptó qué versión) y public.documentos_legales.
--     En STAGING son versiones de prueba; en PROD esto NO se usaría sin una
--     decisión legal aparte.
--   - Con el NIVEL 2, un build con PL-016 (1.0.0 (4)) recibe PGRST202 en
--     `estado_terminos` y entra sin puerta: es el mismo estado de la prueba A
--     (build nuevo contra STAGING sin la migración), ya confirmado.
--
-- DISEÑO:
--   - Sin CASCADE: una dependencia inesperada hace fallar el bloque a la vista
--     en vez de borrar algo más en silencio.
--   - Idempotentes: cada bloque corre sin error con la …490 aplicada y
--     repetido. El NIVEL 2 también corre sin error sobre un estado ya
--     revertido (o donde nunca se aplicó la …490).
--   - Sin begin/commit propios: la migración correctiva corre en una
--     transacción por archivo.
--   - `create or replace` / `alter policy` conservan OID, nombre y grants: no
--     hay que repetir ningún grant.
--
-- PROBADO EN LOCAL (2026-10-27), siempre dentro de begin … rollback, con
-- scripts en el scratchpad de la sesión: ver el reporte del checklist de
-- activación de PL-016 en STAGING.
-- ===========================================================================


-- >>> BLOQUE N1 — interruptor
create or replace function private.terminos_vigentes_aceptados()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- RECUPERACIÓN PL-016, NIVEL 1: candados apagados. La definición original
  -- está en 20261026000490 (bloque 3) y en el BLOQUE N1-DESHACER.
  select true;
$$;
-- <<< BLOQUE N1


-- >>> BLOQUE N1-DESHACER — vuelve a encender los candados
create or replace function private.terminos_vigentes_aceptados()
returns boolean
language sql
stable
set search_path = ''
as $$
  select count(*) = 2
    from (values ('terminos'), ('aviso_privacidad')) t(tipo)
    join public.aceptaciones_legales a
      on a.tipo = t.tipo
     and a.version = private.version_vigente(t.tipo)
     and a.user_id = (select auth.uid());
$$;
-- <<< BLOQUE N1-DESHACER


-- >>> BLOQUE N2 — reversión completa
-- 1. Las 9 policies, con el texto previo exacto (pg_policies de STAGING,
--    2026-10-27, antes de la …490).
alter policy listings_insert_own on public.listings
  with check ((user_id = (select auth.uid()))
              and (select private.is_active_user())
              and (estado = 'pendiente'::public.listing_status));

alter policy listing_photos_insert_own on public.listing_photos
  with check ((exists (select 1
                         from public.listings l
                        where l.id = listing_photos.listing_id
                          and l.user_id = (select auth.uid())
                          and l.estado <> 'bloqueada'::public.listing_status))
              and (select private.is_active_user()));

alter policy listing_photos_objects_insert_own on storage.objects
  with check ((bucket_id = 'listing-photos'::text)
              and (exists (select 1
                             from public.listings l
                            where l.id = private.listing_id_from_object_name(objects.name)
                              and l.user_id = (select auth.uid())
                              and l.estado <> 'bloqueada'::public.listing_status))
              and (select private.is_active_user()));

alter policy avatars_objects_insert_own on storage.objects
  with check ((bucket_id = 'avatars'::text)
              and ((storage.foldername(name))[1] = ((select auth.uid()))::text));

alter policy ratings_insert_own on public.ratings
  with check ((from_user_id = (select auth.uid()))
              and (select private.is_active_user())
              and (select private.can_rate(ratings.to_user_id, ratings.listing_id)));

alter policy ratings_update_own on public.ratings
  with check ((from_user_id = (select auth.uid()))
              and (select private.can_rate(ratings.to_user_id, ratings.listing_id)));

alter policy listing_contacts_insert_own on public.listing_contacts
  with check ((user_id = (select auth.uid()))
              and (select private.is_active_user())
              and (not private.listing_con_bloqueo(listing_id)));

alter policy listing_sales_insert_seller on public.listing_sales
  with check ((exists (select 1
                         from public.listings l
                        where l.id = listing_sales.listing_id
                          and l.user_id = (select auth.uid())))
              and (comprador_id <> (select auth.uid()))
              and (select private.is_active_user())
              and (exists (select 1
                             from public.listing_contacts c
                            where c.listing_id = listing_sales.listing_id
                              and c.user_id = listing_sales.comprador_id)));

alter policy listing_sales_update_seller on public.listing_sales
  with check ((exists (select 1
                         from public.listings l
                        where l.id = listing_sales.listing_id
                          and l.user_id = (select auth.uid())))
              and (comprador_id <> (select auth.uid()))
              and (exists (select 1
                             from public.listing_contacts c
                            where c.listing_id = listing_sales.listing_id
                              and c.user_id = listing_sales.comprador_id)));

-- 2. seller_whatsapp: el cuerpo de 20261013000487, carácter por carácter
--    (md5 de prosrc = e2cb9bb3df6391af109e93ffcb11ca34, el de STAGING antes
--    de la …490).
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

-- 3. Triggers y funciones de trigger.
drop trigger if exists listings_exige_terminos on public.listings;
drop trigger if exists users_exige_terminos on public.users;
drop function if exists private.exige_terminos_listing();
drop function if exists private.exige_terminos_perfil();

-- 4. RPC del cliente y helpers (ya sin policies que los usen).
drop function if exists public.estado_terminos();
drop function if exists public.aceptar_terminos(text, text);
drop function if exists private.terminos_vigentes_aceptados();
drop function if exists private.version_vigente(text);

-- 5. Tablas: primero las aceptaciones (su FK apunta al catálogo). Los
--    triggers de documentos_legales se van con la tabla; su función, después.
drop table if exists public.aceptaciones_legales;
drop table if exists public.documentos_legales;
drop function if exists private.documento_legal_inmutable();
-- <<< BLOQUE N2
