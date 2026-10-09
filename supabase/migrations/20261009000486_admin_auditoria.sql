-- Relevo — RF-17 Ola 6: auditoría de solo lectura en el panel de admin.
-- Plan: docs/rf17-ola6-plan.md (v1 FINAL, D-1 y D-14). Va en su propia
-- migración (D-14): es independiente de la actividad y de las métricas, y así
-- se prueba y se recupera por separado.
--
-- `admin.auditoria` lee `private.admin_acciones` para dos superficies (D-1):
--   - 'reporte': la auditoría de un reporte (frame «Reporte resuelto»);
--   - 'universidad': la de una universidad, SUS CAMPUS y SUS DOMINIOS, en una
--     sola llamada (frame «Universidad — detalle»).
-- Usuario y publicación ya traen su auditoría en `detalle_usuario` y
-- `detalle_listing`, así que no se admiten aquí.
--
-- La pertenencia de un campus o un dominio a la universidad se resuelve con
-- las tablas del catálogo, no con la auditoría: `desactivar_dominio` y
-- `reactivar_dominio` auditan solo `{activo}` (20261008000484:619-620,
-- :663-664). Es estable porque ninguna RPC mueve ni borra un campus o un
-- dominio (D12). Límite: si uno se borrara desde Studio, sus filas siguen en
-- `admin_acciones` pero dejan de aparecer en el ámbito de la universidad.
--
-- Solo lectura: no audita. Sin índices nuevos (medido en F4). Sin bloques
-- EXCEPTION (supabase/KNOWN_ISSUES.md).

create function admin.auditoria(p_objetivo_tipo text, p_objetivo_id text,
                                p_cursor bigint default null, p_limit int default 50)
returns table(id bigint, accion text, objetivo_tipo text, objetivo_id text, objetivo_etiqueta text,
              admin_correo text, motivo text, antes jsonb, despues jsonb, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit       int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_universidad bigint;
begin
  perform private.exigir_admin();

  if p_objetivo_tipo is null or p_objetivo_tipo not in ('reporte', 'universidad') then
    raise exception 'objetivo_tipo_invalido' using errcode = '22023';
  end if;
  if p_objetivo_id is null or btrim(p_objetivo_id) = '' then
    raise exception 'objetivo_invalido' using errcode = '22023';
  end if;

  if p_objetivo_tipo = 'reporte' then
    -- No exige que el reporte exista: los reportes no se borran; un id sin
    -- filas devuelve el conjunto vacío.
    return query
    select aa.id, aa.accion, aa.objetivo_tipo, aa.objetivo_id, null::text,
           aa.admin_correo, aa.motivo, aa.antes, aa.despues, aa.created_at
      from private.admin_acciones aa
     where aa.objetivo_tipo = 'reporte'
       and aa.objetivo_id = p_objetivo_id
       and (p_cursor is null or aa.id < p_cursor)
     order by aa.id desc
     limit v_limit;
    return;
  end if;

  -- 'universidad': la regex va ANTES del cast, para que un id basura dé un
  -- 22023 limpio y no un error de conversión.
  if p_objetivo_id !~ '^[0-9]{1,18}$' then
    raise exception 'objetivo_invalido' using errcode = '22023';
  end if;
  v_universidad := p_objetivo_id::bigint;

  -- objetivo_etiqueta: el nombre ACTUAL de la universidad o del campus, o el
  -- dominio tal cual. Son nombres de catálogo, no datos personales.
  return query
  select aa.id, aa.accion, aa.objetivo_tipo, aa.objetivo_id,
         case aa.objetivo_tipo
           when 'universidad' then un.nombre
           when 'campus'      then c.nombre
           else aa.objetivo_id
         end,
         aa.admin_correo, aa.motivo, aa.antes, aa.despues, aa.created_at
    from private.admin_acciones aa
    left join public.universidades un
           on aa.objetivo_tipo = 'universidad' and un.id = v_universidad
    left join public.campus c
           on aa.objetivo_tipo = 'campus' and c.id::text = aa.objetivo_id
   where ((aa.objetivo_tipo = 'universidad' and aa.objetivo_id = p_objetivo_id)
       or (aa.objetivo_tipo = 'campus'
           and aa.objetivo_id in (select cc.id::text from public.campus cc
                                   where cc.universidad_id = v_universidad))
       or (aa.objetivo_tipo = 'dominio'
           and aa.objetivo_id in (select d.dominio from public.universidad_dominios d
                                   where d.universidad_id = v_universidad)))
     and (p_cursor is null or aa.id < p_cursor)
   order by aa.id desc
   limit v_limit;
end;
$$;

revoke execute on function admin.auditoria(text, text, bigint, int) from public, anon;
grant  execute on function admin.auditoria(text, text, bigint, int) to authenticated;
