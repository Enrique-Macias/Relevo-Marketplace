-- Relevo — los dos triggers de `storage.objects` que disparan `moderar-contenido`
-- (RF-18, Ola 2).
--
-- QUÉ CIERRA. Hasta aquí, el único camino de moderación era el que el cliente
-- pide explícitamente al terminar de publicar. Eso deja abierta una evasión
-- directa: subir limpio, quedar aprobado, y SOBRESCRIBIR la foto después. Estos
-- triggers hacen que todo objeto que entra a `listing-photos` o a `avatars`
-- —venga del cliente, de Studio o del Storage API directo— se evalúe, sin que
-- nadie tenga que acordarse de pedirlo.
--
-- EL REPARTO DE PODER ES ASIMÉTRICO Y VIVE EN LA EDGE FUNCTION, NO AQUÍ: este
-- trigger llama con la secret key, o sea `ctx.authMode === 'secret'`, que es el
-- modo que **solo puede escalar**. Verificado leyendo el código, no asumido:
-- `index.ts:161` llama `moderarListing(..., { puedePromover: false })`; `:243`
-- bloquea con `esPromocion()`; y `decision.ts:272-277` define `esPromocion` como
-- EXACTAMENTE `pendiente → activa`, que es el único par en el que
-- `decidirListing()` devuelve `'activa'` sin que ya lo fuera. Por este camino
-- `estado = 'activa'` no se escribe nunca.
--
-- ---------------------------------------------------------------------------
-- RIESGO DE DESPLIEGUE #1, Y NO TIENE PLAN B DENTRO DE UNA MIGRACIÓN
-- ---------------------------------------------------------------------------
-- `postgres` NO es dueño de `storage.objects` (lo es `supabase_storage_admin`).
-- Puede politiquearla —y ponerle triggers— solo porque `supautils.policy_grants`
-- la lista para él. CLAUDE.md §9 lo tiene medido en LOCAL y **no en remoto**
-- (crear un trigger allá es una escritura, no una consulta), y esta migración es
-- la PRIMERA del repo que lo ejercita de verdad. Si un `supabase db push`
-- revienta aquí con `42501 must be owner of table objects`, esa es la diferencia
-- que hay que mirar primero.
--
-- ---------------------------------------------------------------------------
-- RESULTADO DEL F-SPIKE (2026-09-18) — medido, no supuesto
-- ---------------------------------------------------------------------------
-- Trigger sonda sobre `storage.objects` registrando `tg_op`, `old/new.version` y
-- `old/new.metadata->>'eTag'`, contra el Storage API real del stack local:
--
--   POST alta                        -> INSERT, fila nueva
--   POST + `x-upsert: true`          -> UPDATE sobre la MISMA fila (`id`
--                                       idéntico), `version` CAMBIA, `eTag` CAMBIA
--   PUT (`.update()` de supabase-js) -> UPDATE, `version` CAMBIA
--   `move()`                         -> UPDATE, `version` CAMBIA, `eTag` IGUAL
--   POST sin upsert, ruta existente  -> HTTP 400, CERO eventos
--   DELETE                           -> DELETE
--
-- Vale para los dos buckets. En `avatars`, el UPDATE solo lo alcanza
-- `service_role`/Studio: como `authenticated` no tiene policy de UPDATE ahí, su
-- upsert muere con `400 AccessDenied "new row violates row-level security
-- policy"` y no genera ningún evento (medido) — que es exactamente el caso de
-- Studio por el que la rama UPDATE tiene que existir igual.
--
-- DOS COSAS QUE EL DISEÑO PREVIO DABA POR OTRAS, Y EL SPIKE CORRIGIÓ:
--
--  1. NO HAY DELETE+INSERT. `.claude/rules/moderacion.md` §1 contemplaba ese
--     resultado y pedía, para ese caso, un comentario-tripwire en la rama INSERT
--     avisando de que la rama UPDATE quedaba muerta. **No se escribió porque no
--     aplica**: el overwrite es un UPDATE real y la rama UPDATE es la que lo
--     caza. La rama INSERT cubre altas y nada más.
--
--  2. UN `move` SÍ DISPARA. Aquel archivo predecía que `move` no cambiaba
--     `version` y que por tanto ningún trigger lo vería ("y está bien"). Es al
--     revés. **Se deja disparando a propósito, y no se tapa con un guard de
--     `eTag`:** un move cambia `path_tokens[1]`, o sea que el objeto pasa a
--     colgar de otra publicación, con otro estado y otro dueño. Re-moderarlo es
--     el comportamiento correcto — y coincide con la regla del payload de más
--     abajo ("lo que se modera es dónde QUEDÓ el objeto").
--
-- ALCANCE HONESTO DEL GUARD `old.version is distinct from new.version`: hoy no
-- filtra ningún ruido medido. Se probaron 3 lecturas por
-- `GET /object/authenticated/` y 3 por `/object/info/` -> **0 eventos**, o sea
-- que `last_accessed_at` no se escribe al leer en esta versión de Storage. El
-- guard se conserva como defensa declarada para UPDATEs futuros que no cambien
-- el contenido, **sin control negativo que lo respalde** — mismo caso, y misma
-- honestidad, que el `estado <> 'pausada'` redundante de
-- `listing_photos_objects_select` (20260908000446). No lo leas como un filtro
-- con consumidor.

-- ---------------------------------------------------------------------------
-- La llave y la URL, y por qué NO están escritas aquí
-- ---------------------------------------------------------------------------
-- Mismo mecanismo que `private.notify_push()` (20260911000452): Vault, leído en
-- cada llamada, para no comitear una credencial.
--
-- PASO MANUAL DE DESPLIEGUE (una vez por entorno, FUERA del repo):
--   select vault.create_secret('sb_secret_…', 'moderar_contenido_secret_key');
--   select vault.create_secret(
--     'https://ukxfnydfhmryrzhdqkvj.supabase.co/functions/v1/moderar-contenido',
--     'moderar_contenido_function_url');
--
-- ⚠️ EN PRODUCCIÓN ESOS DOS **NO** SE CREAN TODAVÍA, Y ES UNA DECISIÓN.
-- Mientras `publicar.ts` siga creando las publicaciones en `pausada` (Ola 3 no
-- existe), el skip de `pendiente` de más abajo no tiene a quién saltarse, así
-- que el trigger evaluaría DURANTE el alta y `decidirListing()` escalaría
-- `pausada → bloqueada` ante un veredicto `bloquear`. Y una publicación
-- `bloqueada` hoy es un callejón sin salida para su dueño: `listings_update_own`
-- la excluye, así que "Reactivar" afecta 0 filas SIN LANZAR y muestra "No
-- pudimos cambiar el estado" (falso), "Editar publicación" pinta el formulario
-- entero y al guardar dice "Esta publicación ya se vendió" (falso), el chip de
-- estado sale VACÍO porque `ESTADO_LABEL` no tiene esa clave, y no hay panel de
-- moderación (RF-17) al que recurrir. Lo único que funciona es eliminarla.
--
-- Hasta entonces el trigger queda INERTE en remoto por falla segura: sin los
-- secretos levanta un `warning` y no llama a nadie. Crearlos es un paso
-- explícito del checklist de Ola 3, junto al rework de `publicar.ts` y al
-- `with_check` de `listings_insert_own`. Ver CLAUDE.md §8 y
-- `.claude/rules/moderacion.md` §7.

create function private.notify_moderacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_listing_id bigint;
  v_estado     public.listing_status;
  v_url        text;
  v_key        text;
begin
  -- -------------------------------------------------------------------------
  -- 1. EL SKIP DE `pendiente` — y es SOLO para `listing-photos`
  -- -------------------------------------------------------------------------
  -- Una publicación en `pendiente` está en un flujo de alta activo: la llamada
  -- final del cliente ya viene en camino y va a evaluarla ENTERA (texto + todas
  -- las fotos). Saltarse el evento aquí evita dos cosas a la vez: pagar Vision
  -- dos veces, y una CARRERA real —`pg_net` es fire-and-forget y la función
  -- tarda segundos, así que una foto sucia evaluándose en paralelo con la
  -- llamada final dejaría la publicación pública en el intervalo
  -- (`.claude/rules/moderacion.md` §1.3)—.
  --
  -- VA EN EL CUERPO Y NO EN EL `WHEN` porque un `WHEN` de trigger no admite
  -- subconsultas. Es un lookup por PK dentro de la misma transacción, y cuando
  -- corta ahorra la llamada HTTP entera.
  --
  -- LOS AVATARES NO PASAN POR AQUÍ, A PROPÓSITO: no tienen estado que consultar
  -- —`users` no tiene columna de moderación para la foto— y su enforcement es
  -- inmediato (borrar o nada). Copiar este guard a los dos buckets "por
  -- simetría" es el error que invita esta función; lo caza la aserción (d) de
  -- scripts/probe-storage.mjs.
  if new.bucket_id = 'listing-photos' then
    -- SE REUSA EL HELPER DE LAS POLICIES (20260908000446:52) en vez de
    -- `new.path_tokens[1]::bigint`: su `case` con regex es lo que evita que una
    -- ruta arbitraria reviente con `22P02`. No necesita grant extra — el cuerpo
    -- de una SECURITY DEFINER corre como su dueño (CLAUDE.md §3).
    v_listing_id := private.listing_id_from_object_name(new.name);

    -- Ruta sin carpeta de listing: no hay nada que moderar. Alcanzable solo por
    -- service_role, porque `listing_photos_objects_insert_own` ya la rechaza
    -- para `authenticated`.
    if v_listing_id is null then
      return null;
    end if;

    select l.estado into v_estado
      from public.listings l
     where l.id = v_listing_id;

    -- La publicación no existe (objeto huérfano subido con la secret key).
    if v_estado is null then
      return null;
    end if;

    if v_estado = 'pendiente' then
      return null;
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- 2. Los secretos
  -- -------------------------------------------------------------------------
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'moderar_contenido_secret_key';

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'moderar_contenido_function_url';

  -- SIN CONFIGURACIÓN NO SE INTENTA NADA, Y SOBRE TODO NO SE ABORTA. Un
  -- `raise exception` aquí tumbaría la SUBIDA del usuario por un fallo de
  -- configuración nuestro — el objeto ni siquiera entraría. Mismo criterio que
  -- `notify_push()`: mejor un objeto sin moderar y un warning en el log que
  -- romperle el alta a alguien. Para `listing-photos` el estado de la fila
  -- sigue siendo el piso real: lo que no se evalúa, no se promueve.
  if v_url is null or v_key is null then
    raise warning '[notify_moderacion] falta el secreto de Vault: % / % no se modera',
      new.bucket_id, new.name;
    return null;
  end if;

  -- -------------------------------------------------------------------------
  -- 3. El disparo
  -- -------------------------------------------------------------------------
  -- LA LLAVE VA EN `apikey` Y NO EN `Authorization: Bearer`: las secret keys
  -- modernas (`sb_secret_…`, CLAUDE.md §1) NO son JWT, y mandarlas como Bearer
  -- hace que la plataforma intente parsearlas como tal y conteste "Invalid JWT".
  -- Es también la razón de `verify_jwt = false` en config.toml.
  --
  -- `net.http_post`, NO `extensions.net.http_post`: la EXTENSIÓN vive en
  -- `extensions` pero sus funciones en un esquema `net` propio (CLAUDE.md §9).
  -- Con `search_path = ''` equivocarse ahí no falla al crear la función, falla
  -- en runtime y en silencio.
  --
  -- TODO EL PAYLOAD SALE DE `NEW`, NUNCA DE `OLD`: un `move` cambia el nombre, y
  -- lo que hay que moderar es dónde QUEDÓ el objeto, no de dónde salió.
  -- (`path_tokens` es columna generada y se recalcula en ese UPDATE — medido.)
  --
  -- `entity_id` Y NO `listing_id`: significa `listings.id` cuando el bucket es
  -- `listing-photos` y `users.id` cuando es `avatars`. Meter un uuid de usuario
  -- en un campo llamado `listing_id` es la clase de mentira que muerde tres
  -- meses después; el discriminador es `bucket_id` y la función hace el
  -- narrowing en un solo punto (`moderar-contenido/index.ts`, `PayloadTrigger`).
  --
  -- Y VA `new.path_tokens[1]` CRUDO, NO EL HELPER DE ARRIBA. No es
  -- incoherencia: en `avatars` el `entity_id` es un **uuid**, y
  -- `listing_id_from_object_name()` devolvería `null` para él. El helper sirve
  -- al lookup de estado; el payload es texto. Quien "unifique" los dos rompe el
  -- camino de avatares sin ningún error a la vista.
  --
  -- `tg_op` y `version` viajan para que el contrato quede documentado de los dos
  -- lados; la función los acepta y NO ramifica sobre ellos (re-evalúa la entidad
  -- completa), que es lo que hace que el resultado del F-spike no cambie nada
  -- río abajo.
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key),
    body    := jsonb_build_object(
      'bucket_id', new.bucket_id,
      'name',      new.name,
      'entity_id', new.path_tokens[1],
      'tg_op',     tg_op,
      'version',   new.version
    )
  );

  return null;
end;
$$;

revoke execute on function private.notify_moderacion() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- DOS TRIGGERS SOBRE LA MISMA FUNCIÓN, NO UNO CON `INSERT OR UPDATE`
-- ---------------------------------------------------------------------------
-- El `WHEN` de un trigger declarado sobre INSERT y UPDATE a la vez **no puede
-- referenciar `OLD`**, y el de UPDATE lo necesita. El repo ya chocó con esto
-- exactamente igual en 20260912000453:241-259 (CLAUDE.md:511). Si alguien los
-- "unifica" para ahorrar una declaración, el `old.version` de abajo deja de ser
-- legal y hay que volver aquí.
--
-- AFTER y no BEFORE: `pg_net` es asíncrono (encola y devuelve), así que esto no
-- bloquea el commit de la subida; y la Edge Function relee la fila desde otra
-- conexión, fuera de esta transacción, así que el objeto tiene que estar ya
-- escrito para cuando ella mire.

create trigger objects_notify_moderacion_insert
  after insert on storage.objects
  for each row
  when (new.bucket_id in ('listing-photos', 'avatars'))
  execute function private.notify_moderacion();

create trigger objects_notify_moderacion_update
  after update on storage.objects
  for each row
  when (new.bucket_id in ('listing-photos', 'avatars')
        and old.version is distinct from new.version)
  execute function private.notify_moderacion();
