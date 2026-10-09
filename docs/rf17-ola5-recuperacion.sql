-- ===========================================================================
-- Relevo — RF-17 Ola 5: HERRAMIENTA DE RECUPERACIÓN del hook de registro.
--
-- ESTO NO ES UNA MIGRACIÓN. NO va en supabase/migrations/, NO se aplica sola y
-- NO es un rollback de 20261008000484. Es el texto que usaría una migración
-- correctiva NUEVA, preparada y probada de antemano (plan v3.2, K-6b).
--
-- QUÉ RESTAURA, Y NADA MÁS: `public.hook_before_user_created` y
-- `private.handle_new_user` a su texto previo a la Ola 5 (literal de
-- 20260929000474:226-257 y 20260924000466:48-65), con sus grants. No toca la
-- columna `activo`, el CHECK de auditoría, los checks de nombres, los índices,
-- las helpers ni las RPC de `admin.*`.
--
-- CUÁNDO SE USA (contrato de K-6b, docs/rf17-ola5-plan.md):
--   1. Falla del camino de registro Y el diagnóstico DEMUESTRA que la causa es
--      el cambio del hook o de handle_new_user de la Ola 5 → STOP → diagnóstico
--      → precondición (abajo) → migración correctiva nueva con este texto →
--      `db push --dry-run` → aprobación del usuario → ejecución.
--   2. Falla en cualquier otra parte (un CHECK, una RPC, el ACL de otra
--      función, índices, admin.*, is_admin, exigir_admin, panel, tipos,
--      auditoría…) → STOP y diagnóstico específico. NO se usa esto.
--   3. Causa desconocida → STOP. No se usa hasta identificarla.
--
-- PRECONDICIÓN (correr antes y decidir con el resultado):
--     select count(*) from public.universidad_dominios where not activo;
--   Restaurar IGNORA `activo`: cualquier dominio desactivado en ese momento
--   VUELVE A ADMITIR REGISTROS. Si da más de 0, se decide qué hacer con esos
--   dominios ANTES de aplicar esto.
--
-- PROBADO EN LOCAL (2026-10-08 y, contra la 484 real, en el commit d890966):
-- md5 del prosrc de vuelta a b6e6a8a7… (hook) y 87e685cf… (handle_new_user),
-- mismos OID, ACL, prosecdef, provolatile y proconfig; la rama
-- correo_bloqueado sigue funcionando y `on_auth_user_created` sigue apuntando
-- a la función.
--
-- Guardar también una copia junto a la copia cifrada de K-2.
-- ===========================================================================

-- Hook (literal de supabase/migrations/20260929000474_eliminar_cuenta.sql:226-257).
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when exists (
      select 1
      from public.correos_bloqueados b
      where b.correo_hash = sha256(convert_to(lower(btrim(event -> 'user' ->> 'email')), 'UTF8'))
    )
    then jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'correo_bloqueado'
      )
    )
    when exists (
      select 1
      from public.universidad_dominios d
      where d.dominio = split_part(lower(btrim(event -> 'user' ->> 'email')), '@', -1)
    )
    then '{}'::jsonb
    else jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'dominio_no_participante'
      )
    )
  end
$$;

revoke execute on function public.hook_before_user_created(jsonb)
  from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb)
  to supabase_auth_admin;

-- Trigger de alta (literal de supabase/migrations/20260924000466_universidad_desde_dominio.sql:48-65).
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

revoke execute on function private.handle_new_user() from public, anon, authenticated;
