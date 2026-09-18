/**
 * send-push — entrega por push una fila de `public.notifications` (RF-16).
 *
 * La dispara el webhook `notifications_notify_push` (migración 20260911000452)
 * en cada insert. Recibe SOLO el id: el contenido lo relee ella misma con la
 * secret key, así el texto del usuario no viaja en el body del webhook y la
 * forma del payload no queda acoplada al esquema.
 *
 * NO TIENE LÓGICA DE NEGOCIO, y es a propósito: `titulo` y `cuerpo` ya vienen
 * materializados por el trigger que creó la fila (el precio anterior no existe
 * después del UPDATE, ver la migración 20260911000451). Esta función solo sabe
 * de tokens y de HTTP.
 *
 * AUTORIZACIÓN — por qué `verify_jwt = false` no significa "abierta":
 * este proyecto usa las secret keys modernas (`sb_secret_…`), que NO son JWT.
 * La verificación integrada de la plataforma solo entiende las llaves legadas,
 * así que con `verify_jwt = true` rechazaría la llamada con "Invalid JWT" sin
 * siquiera mirarla. La llave viaja en el header `apikey` y `auth: 'secret'` la
 * valida aquí dentro. Ver supabase/config.toml.
 */

import { withSupabase } from 'npm:@supabase/server';

/** El endpoint de Expo. No requiere credenciales: el token ya identifica al aparato. */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Tope que documenta Expo por request. */
const LOTE = 100;

type Ticket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
};

function lotes<T>(xs: T[], tam: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += tam) out.push(xs.slice(i, i + tam));
  return out;
}

export default {
  fetch: withSupabase({ auth: 'secret' }, async (req: Request, ctx) => {
    const { notification_id } = await req.json().catch(() => ({ notification_id: null }));
    if (!notification_id) {
      return Response.json({ error: 'falta notification_id' }, { status: 400 });
    }

    const db = ctx.supabaseAdmin;

    const { data: notif, error: errNotif } = await db
      .from('notifications')
      .select('id, user_id, titulo, cuerpo, listing_id, push_enviado_at')
      .eq('id', notification_id)
      .maybeSingle();

    if (errNotif) return Response.json({ error: errNotif.message }, { status: 500 });
    if (!notif) return Response.json({ error: 'no existe' }, { status: 404 });

    // IDEMPOTENCIA. pg_net reintenta y un webhook puede llegar dos veces; sin
    // este corte, el usuario recibiría el mismo aviso duplicado.
    if (notif.push_enviado_at) {
      return Response.json({ ok: true, motivo: 'ya se había enviado' });
    }

    const { data: tokens, error: errTokens } = await db
      .from('push_tokens')
      .select('token')
      .eq('user_id', notif.user_id);

    if (errTokens) return Response.json({ error: errTokens.message }, { status: 500 });

    // Sin tokens no es un error: el usuario dijo que no a las notificaciones, o
    // nunca abrió la app en un dispositivo real. La fila sigue en su inbox.
    if (!tokens || tokens.length === 0) {
      await db
        .from('notifications')
        .update({ push_enviado_at: new Date().toISOString() })
        .eq('id', notif.id);
      return Response.json({ ok: true, enviados: 0, motivo: 'sin tokens' });
    }

    const muertos: string[] = [];
    let enviados = 0;

    // El genérico va explícito porque `tokens` viene de `ctx.supabaseAdmin`,
    // que no está tipado (ver `supabase/functions/shims.d.ts`): sin esto,
    // `lotes<T>` infiere `T = unknown` a partir de un `any` y `npm run
    // check:functions` no puede mirar adentro del lote. Sin efecto en runtime.
    for (const lote of lotes<{ token: string }>(tokens, LOTE)) {
      const mensajes = lote.map((t) => ({
        to: t.token,
        title: notif.titulo,
        body: notif.cuerpo,
        // El cliente lo lee en `useRespuestaANotificacion` para decidir a dónde
        // navega el tap (src/lib/push.ts).
        data: { notification_id: notif.id, listing_id: notif.listing_id },
        // Android no muestra nada si el mensaje no cae en un canal declarado.
        // Tiene que ser el MISMO id que registra `configurarCanalAndroid()`.
        channelId: 'default',
      }));

      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(mensajes),
      });

      if (!res.ok) {
        console.error('[send-push] Expo respondió', res.status, await res.text());
        continue;
      }

      const { data: tickets } = (await res.json()) as { data: Ticket[] };

      (tickets ?? []).forEach((ticket, i) => {
        if (ticket.status === 'ok') {
          enviados += 1;
          return;
        }
        // ESTE ES EL MOTIVO POR EL QUE LOS TOKENS VIVEN EN SU PROPIA TABLA Y NO
        // EN UNA COLUMNA DE `users`: Expo invalida POR TOKEN, o sea por aparato.
        // Con una columna, la única reacción posible sería borrar el token del
        // usuario entero, apagando también el teléfono que sí funciona.
        if (ticket.details?.error === 'DeviceNotRegistered') {
          muertos.push(lote[i].token);
        } else {
          console.error('[send-push] ticket con error:', ticket.message);
        }
      });
    }

    if (muertos.length > 0) {
      await db.from('push_tokens').delete().in('token', muertos);
    }

    await db
      .from('notifications')
      .update({ push_enviado_at: new Date().toISOString() })
      .eq('id', notif.id);

    return Response.json({ ok: true, enviados, limpiados: muertos.length });
  }),
};
