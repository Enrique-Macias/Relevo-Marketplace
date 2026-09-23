-- Foto canónica de los privilegios de anon/authenticated sobre public.users y
-- public.listings, una fila por privilegio, ordenada. Existe para DIFFEAR el
-- antes y el después de una migración que reescribe esos grants con el patrón
-- `revoke all` + re-grant (CLAUDE.md §1): ese patrón reescribe la lista ENTERA,
-- así que "compila y la suite pasa" no prueba que no se haya colado o perdido
-- una columna. El diff sí.
--
-- Mira table_privileges Y column_privileges: un grant acotado por columna no
-- aparece en la primera (medido con listing_moderacion, CLAUDE.md §3).
--
-- Uso local (antes y después, y `diff` entre las dos salidas):
--   docker exec -i supabase_db_relevo-marketplace psql -At -U postgres -d postgres \
--     < scripts/grants-users-listings.sql > $TMP/grants-antes.txt
-- En remoto: la misma consulta, por `mcp__supabase__execute_sql`.
select 'tabla|' || grantee || '|' || table_name || '|' || privilege_type
from information_schema.table_privileges
where table_schema = 'public'
  and table_name in ('users', 'listings')
  and grantee in ('anon', 'authenticated')
union all
select 'columna|' || grantee || '|' || table_name || '.' || column_name || '|' || privilege_type
from information_schema.column_privileges
where table_schema = 'public'
  and table_name in ('users', 'listings')
  and grantee in ('anon', 'authenticated')
order by 1;
