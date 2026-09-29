-- Relevo — resolver el reporte de una cuenta eliminada ya no aborta.
--
-- `20260929000474` (eliminar cuenta) hizo NULLABLE a `reports.reporter_id` y
-- cambió su FK a `on delete set null`, para conservar el reporte sin la
-- identidad de quien lo hizo. Pero `private.notify_report_resolved()`
-- (`20260911000451`) inserta `new.reporter_id` en `notifications.user_id`, que
-- es NOT NULL, y su trigger dispara en TODA transición de `estado` fuera de
-- `pendiente`. O sea que, desde esa migración, resolver o descartar el reporte
-- de alguien que ya eliminó su cuenta aborta el UPDATE con 23502.
--
-- MEDIDO en local antes de escribir esto (begin … rollback, con dos cuentas,
-- borrando al reportante y luego `update reports set estado = 'resuelto'`):
--
--     ERROR:  null value in column "user_id" of relation "notifications"
--             violates not-null constraint
--
-- No se cambia la función: con el `when` basta, y así conserva su OID, su
-- `revoke execute` y su cuerpo. Sin reportante no hay a quién avisar, que es
-- justo lo que dice la cláusula nueva.
--
-- DROP + CREATE y no `alter trigger`: Postgres no permite cambiar el `WHEN` de
-- un trigger existente.
--
-- Es un fix preexistente encontrado al planear RF-17 (el panel de admin es
-- quien resuelve reportes), y por eso va en su propia migración y su propio
-- commit.

drop trigger reports_notify_resolved on public.reports;

create trigger reports_notify_resolved
  after update on public.reports
  for each row
  when (old.estado is distinct from new.estado
        and new.estado <> 'pendiente'
        and new.reporter_id is not null)
  execute function private.notify_report_resolved();
