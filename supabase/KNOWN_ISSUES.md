# Incidentes conocidos — base de datos

## SIGSEGV del backend al capturar en plpgsql el rechazo de una escritura con RLS

**Fecha:** 6 de septiembre de 2026
**Entorno:** Supabase CLI 2.98.2 · imagen `public.ecr.aws/supabase/postgres:17.6.1.106`
· PostgreSQL 17.6 · aarch64 (Docker Desktop en macOS)
**Estado:** sin resolver upstream. **Mitigado** con un workaround en el esquema.
**Impacto si se quita el workaround:** el backend muere y la base entra en recovery.

### El log

```
2026-09-06 05:41:36.502 UTC [11] LOG:  server process (PID 369) was terminated by
    signal 11: Segmentation fault
2026-09-06 05:41:36.502 UTC [11] DETAIL:  Failed process was running:
    select pg_temp.expect_error('aaaaaaaa-0000-0000-0000-00000000000a'::uuid,
      format('insert into public.listings (user_id, categoria_id, universidad_id,
                                           campus_id, titulo, precio, condicion)
              values (%L, 1, 1, 1, ''RLS Suplantado'', 1, ''nuevo'')',
             'bbbbbbbb-0000-0000-0000-00000000000b'::uuid),
      'A no puede insertar un listing con user_id de B');
2026-09-06 05:41:36.502 UTC [11] LOG:  terminating any other active server processes
2026-09-06 05:41:36.761 UTC [11] LOG:  all server processes terminated; reinitializing
```

**Dónde:** aserción 6 de `supabase/tests/rls.sql`, bloque `T3`
(*"A no puede insertar un listing con user_id de B"*). La sesión de `psql` solo dice
`server closed the connection unexpectedly`; la causa real únicamente aparece en
`docker logs supabase_db_<proyecto>`.

### Condiciones para reproducirlo

Se necesitan las tres a la vez:

1. Una tabla con RLS cuya policy referencia una función `SECURITY DEFINER`.
2. Que el rol que invoca **no pueda ejecutar esa función** — da igual cómo se le
   niegue: sin `USAGE` sobre el esquema que la contiene, o con `EXECUTE` revocado
   estando la función en `public`. Ambas variantes crashean.
3. Que el error del rechazo se capture en un bloque **plpgsql con `EXCEPTION`**.

Sin (3) no hay crash: el mismo insert, sin capturar, devuelve limpiamente
`new row violates row-level security policy`. Con (3), muere el backend.

**Es determinista:** 6 de 6 corridas con esas condiciones. (Al principio pareció
intermitente porque las primeras pruebas usaban `execute 'set local role'`, que
enmascaraba el patrón; con `set_config('role', ...)` falla siempre.)

### El workaround, y por qué NO hay que quitarlo

`authenticated` tiene `USAGE` sobre el esquema `private` y `EXECUTE` sobre las dos
funciones que se invocan desde policies (`is_active_user`, `can_rate`). Con eso, la
condición (2) nunca se cumple y el crash no ocurre.

**Esto se ve como un privilegio innecesario, y por eso conviene entender por qué está.**
No es un requisito funcional: una escritura legítima funciona igual con el esquema
cerrado, porque las expresiones de policy se evalúan con los privilegios del dueño de
la tabla. Durante la implementación se llegó a quitar por "menor privilegio", y fue un
error: lo que se rompe no es el camino feliz sino **el camino de rechazo**, y solo
cuando alguien lo captura. Hoy nada del código lo captura, pero cualquier RPC en
plpgsql que envuelva un insert en `EXCEPTION` —un patrón perfectamente normal— tumbaría
la base en producción.

Las cuatro funciones restantes de `private` (las que solo disparan por trigger) **sí**
están revocadas y deben seguir así: no participan de policies, así que no tocan este bug.

`supabase/tests/rls.sql` (bloque `T12`) verifica los dos grants del workaround. Si
alguien los quita, la suite falla con un mensaje explícito en vez de matar el backend.

### Qué hacer si vuelve a ocurrir

**NO lo resuelvas agregando grants a ciegas** — y tampoco quitándolos. La primera vez el
crash se interpretó como un problema de privilegios, se agregaron grants, luego se
comprobó que no hacían falta funcionalmente y se quitaron, y la base volvió a caerse.
El diagnóstico correcto tomó tres iteraciones. Antes de tocar privilegios, reproduce y
caracteriza.

**Antes de reiniciar el contenedor**, que destruye la evidencia:

1. Log completo del engine:
   ```bash
   docker logs supabase_db_<proyecto> > /tmp/pg-segv-$(date +%s).log 2>&1
   ```
2. Estado y versión:
   ```bash
   docker inspect supabase_db_<proyecto> > /tmp/pg-segv-inspect.json
   docker exec supabase_db_<proyecto> psql -U postgres -tAc "select version();"
   ```
3. Core dump, si el kernel lo dejó:
   ```bash
   docker exec supabase_db_<proyecto> sh -c \
     'ls -la /var/lib/postgresql/data/core* 2>/dev/null; cat /proc/sys/kernel/core_pattern'
   ```
4. Anota en qué aserción se detuvo la suite: identifica el statement sin depender del log.
5. Mide la frecuencia (`for i in $(seq 20)`). Con un repro determinista y mínimo esto se
   puede reportar a `pgsql-bugs` o a Supabase. El repro mínimo sintético que se intentó
   aquí (tabla + policy + función en esquema sin acceso + wrapper plpgsql) **no** bastó:
   sobrevivió en cuatro variantes, así que el gatillo necesita algo más del esquema real
   que no se llegó a aislar.
