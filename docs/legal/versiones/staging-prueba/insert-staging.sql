-- PL-016 · versiones legales de PRUEBA `staging-prueba` · SOLO STAGING
-- (ukxfnydfhmryrzhdqkvj) y el ensayo en LOCAL. NUNCA en PROD: estos
-- documentos son borradores con marcadores [[POR CONFIRMAR]] (ver LEEME.md).
--
-- Lo corre scripts/pl016-activar.sh justo después del push de
-- 20261026000490, en la misma ejecución. Antes de correrlo, el script
-- comprueba que los dos hashes de abajo son el sha256 de terminos.html y
-- privacidad.html de esta carpeta (SHA256SUMS).
--
-- contenido_sha256 = sha256 de los BYTES del HTML servido el 2026-10-27, no
-- del texto canónico (no existe para estos borradores). LEEME.md explica la
-- diferencia y qué cambia para PROD.
--
-- Una sola transacción: si la comprobación final no da exactamente estas dos
-- versiones como vigentes, se revierte todo y no queda nada a medias. No es
-- idempotente a propósito: una segunda corrida falla con 23505 (PK), nunca
-- duplica.
begin;

insert into public.documentos_legales (tipo, version, vigente_desde, url, contenido_sha256)
values
  ('terminos', 'staging-prueba', now(), 'https://www.rlvo.com.mx/terminos',
   decode('a54344e6b97361575fecb341ccf3a895bfceac04e51dc603c7ba2df4a39e94e8', 'hex')),
  ('aviso_privacidad', 'staging-prueba', now(), 'https://www.rlvo.com.mx/privacidad',
   decode('dfbb3742a5840e658946037df021bb3d0f291fe01e6f6aa5f02845d03a9b078f', 'hex'));

do $$
begin
  if (select count(*)
        from public.documentos_legales d
       where d.version = 'staging-prueba'
         and private.version_vigente(d.tipo) = d.version
         and encode(d.contenido_sha256, 'hex') = case d.tipo
               when 'terminos' then 'a54344e6b97361575fecb341ccf3a895bfceac04e51dc603c7ba2df4a39e94e8'
               when 'aviso_privacidad' then 'dfbb3742a5840e658946037df021bb3d0f291fe01e6f6aa5f02845d03a9b078f'
             end) <> 2 then
    raise exception 'staging-prueba no quedó vigente con los hashes archivados';
  end if;
end;
$$;

commit;
