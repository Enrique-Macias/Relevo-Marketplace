-- ===========================================================================
-- Relevo — RF-17 Ola 6: HERRAMIENTA DE RECUPERACIÓN de 20261009000485 y
-- 20261009000486 (F11 de docs/rf17-ola6-plan.md, §3).
--
-- ESTO NO ES UNA MIGRACIÓN. NO va en supabase/migrations/, NO se aplica sola y
-- NO se ejecuta directo en Studio (ni en remoto ni "para probar").
--
-- PROCEDIMIENTO SI F18 DECIDE RECUPERAR EN PRODUCCIÓN (decidido en F11):
--   1. F18 clasifica el estado real del remoto (1 = las dos migraciones,
--      2 = solo la …485, 3 = ninguna) y dice qué parte es NO-GO.
--   2. Se crea una migración correctiva NUEVA, append-only y con el siguiente
--      consecutivo libre en ese momento, que contiene EXACTAMENTE el bloque o
--      los bloques de abajo que correspondan a ese estado, copiados tal cual.
--      No se reserva ningún número antes, y 485/486 NO se modifican nunca.
--   3. `db push --dry-run` (debe listar solo la correctiva) → aprobación del
--      usuario → `db push`.
--   Así quedan alineados el historial de migraciones, `schema_migrations`, el
--   estado real del remoto y el historial de Git. Ejecutar esto a mano dejaría
--   en `schema_migrations` versiones cuyos objetos ya no existen.
--
-- QUÉ BLOQUE SEGÚN EL ESTADO:
--   - NO-GO solo de la auditoría (…486)  → BLOQUE 486.
--   - NO-GO de la …485 (estado 1 o 2)     → BLOQUE 485 (y el 486 si también
--     hay que retirar la auditoría). Los bloques son independientes: el 485
--     no necesita que antes corra el 486, y el 486 no toca nada de la 485.
--   - Los dos son idempotentes: corren sin error en los estados 1, 2 y 3 y
--     repetidos.
--
-- ADVERTENCIAS:
--   - EL BLOQUE 485 BORRA IRREVERSIBLEMENTE los datos de
--     public.actividad_diaria (las señales diarias de los últimos 90 días) y
--     el `inicio` de private.actividad_parametros. Volver a aplicar la …485
--     después empieza el registro de cero, con un `inicio` nuevo.
--   - Si el panel de Admin con la Ola 6 ya está desplegado, la pantalla de
--     Métricas (y la auditoría, si se retira la …486) deja de funcionar
--     —muestra su estado de error— hasta que ese código se retire o se
--     corrija con un nuevo despliegue.
--   - La app sigue intentando registrar la actividad y recibe el error
--     esperado (la tabla ya no existe, PGRST205). `src/lib/actividad.ts` lo
--     absorbe con un console.warn, sin mostrarle nada al usuario y sin frenar
--     nada; reintenta en el siguiente foreground.
--
-- DISEÑO:
--   - Sin CASCADE: una dependencia inesperada hace fallar el bloque a la
--     vista en vez de borrar algo más en silencio.
--   - El job se quita por su nombre exacto, leyendo cron.job: con cero filas
--     (estado 3 o segunda ejecución) no se llama a cron.unschedule y no hay
--     error. Ningún otro job (p. ej. purga-moderacion-retenida) se toca.
--   - Sin begin/commit propios: la migración correctiva corre en una
--     transacción por archivo (medido en F5).
--
-- PROBADO EN LOCAL (F11, 2026-10-09), siempre dentro de begin … rollback:
-- estados 1, 2 y 3, cada bloque solo y los dos en ambos órdenes, y cada uno
-- repetido; sin objetos residuales de su migración y con el resto (funciones
-- de admin/private, policies, grants, cron.job) idéntico. Evidencia en el
-- reporte de F11.
--
-- Guardar también una copia junto a la copia cifrada de F14.
-- ===========================================================================

-- >>> BLOQUE 486 (auditoría de solo lectura, 20261009000486_admin_auditoria.sql)
drop function if exists admin.auditoria(text, text, bigint, int);
-- <<< FIN BLOQUE 486

-- >>> BLOQUE 485 (actividad diaria y métricas, 20261009000485_actividad_diaria_y_metricas.sql)
-- Primero el job, para que ninguna corrida quede apuntando a lo que se borra.
-- Solo ese nombre; cero filas = nada que quitar, sin error.
select cron.unschedule(j.jobid)
  from cron.job j
 where j.jobname = 'purga-actividad-diaria';

drop function if exists admin.metricas(date, date, bigint);
drop function if exists admin.metricas_resumen(date, date, bigint);
drop function if exists private.actividad_retenida_desde();
drop table if exists private.actividad_parametros;
-- Se lleva su policy (actividad_diaria_insert_own) y sus grants.
drop table if exists public.actividad_diaria;
-- <<< FIN BLOQUE 485
