-- Relevo — el puente de `notifications` a la Edge Function `send-push` (RF-16).
--
-- UN SOLO WEBHOOK, SOBRE `notifications`, Y NO UNO POR TABLA DE ORIGEN:
-- `listings` y `reports` ya escriben en esta tabla (20260911000451), así que
-- colgar el webhook de aquí da un punto de integración en vez de dos, deja a la
-- Edge Function sin saber nada del esquema de negocio, y —lo que más importa—
-- hace que un fallo del push sea recuperable: la fila del inbox YA existe, así
-- que el usuario ve el aviso al abrir la app. Es el mismo fallo suave de
-- `listing_contacts` (CLAUDE.md §8b), pero esta vez con red.

-- pg_net es la única forma de que Postgres hable HTTP. No estaba instalado: este
-- es el primer punto del proyecto donde la base sale a la red.
--
-- OJO CON EL ESQUEMA, que no es el que parece: la EXTENSIÓN queda en
-- `extensions` (verificado en pg_extension), pero sus funciones viven en un
-- esquema `net` propio que ella misma crea. O sea que la llamada de abajo va
-- `net.http_post`, NO `extensions.net.http_post`. Con `search_path = ''` en el
-- cuerpo —como exige el estilo de este proyecto— equivocarse ahí no falla al
-- crear la función (plpgsql no resuelve nombres hasta ejecutarla): falla en
-- runtime, con la notificación ya insertada y el push perdido en silencio.
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- La llave, y por qué NO va escrita aquí
-- ---------------------------------------------------------------------------

-- EL WEBHOOK DEL DASHBOARD NO SIRVE PARA ESTE REPO, por dos motivos:
--   1. crea su trigger fuera de supabase/migrations/, así que el esquema dejaría
--      de estar completo en el versionado;
--   2. HARDCODEA la llave en los argumentos del trigger, o sea una credencial en
--      texto plano dentro de un archivo comiteado.
-- Por eso el trigger se escribe a mano y lee la llave de Vault en cada llamada.
--
-- PASO MANUAL DE DESPLIEGUE (una sola vez por entorno, FUERA del repo):
--   select vault.create_secret('sb_secret_…', 'send_push_secret_key');
-- Sin ese secreto el trigger no revienta: `net.http_post` sale con la cabecera
-- vacía y la Edge Function responde 401. Se ve en `net._http_response`.

-- ---------------------------------------------------------------------------
-- El disparo
-- ---------------------------------------------------------------------------

-- POR QUÉ LA LLAVE VA EN `apikey` Y NO EN `Authorization: Bearer`:
-- este proyecto usa las secret keys modernas (`sb_secret_…`, CLAUDE.md §1), que
-- NO son JWT. Mandarlas como Bearer hace que la plataforma intente parsearlas
-- como JWT y rechace la llamada con "Invalid JWT" — el modo de fallo es una
-- notificación que nunca sale y un 401 enterrado en `net._http_response`, no un
-- error visible. Es también la razón de `verify_jwt = false` en config.toml.
create function private.notify_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'send_push_secret_key';

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'send_push_function_url';

  -- Sin configuración no se intenta nada: mejor una fila sin push (visible en el
  -- inbox y en `push_enviado_at is null`) que una excepción que aborte el INSERT
  -- y se lleve la notificación entera.
  if v_url is null or v_key is null then
    raise warning '[notify_push] falta el secreto de Vault: la notificación % no se envía', new.id;
    return null;
  end if;

  -- SOLO EL ID EN EL BODY. La función relee la fila con la secret key: así el
  -- texto del usuario no viaja en el webhook y la forma del payload no queda
  -- acoplada a las columnas de esta tabla.
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key),
    body    := jsonb_build_object('notification_id', new.id)
  );

  return null;
end;
$$;

revoke execute on function private.notify_push() from public, anon, authenticated;

-- AFTER INSERT: si la llamada se hiciera antes, la Edge Function releería una
-- fila que todavía no existe para ella (corre en otra conexión, fuera de esta
-- transacción). `pg_net` es asíncrono —encola y devuelve— así que esto no
-- bloquea el commit del UPDATE de precio que lo originó.
create trigger notifications_notify_push
  after insert on public.notifications
  for each row execute function private.notify_push();
