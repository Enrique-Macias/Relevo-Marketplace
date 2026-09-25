/**
 * Registro del dispositivo para push (RF-16).
 *
 * Tres funciones y ninguna más: pedir permiso y guardar el token, borrarlo al
 * cerrar sesión, y declarar el canal que Android exige. Lo que se hace con el
 * token vive del lado del servidor (la Edge Function `send-push`).
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import type * as NotificationsType from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/**
 * `expo-notifications` está excluido del autolinking en builds locales de
 * personal team de Apple (no soportan la capability de Push — ver
 * `package.json` > `expo.autolinking.exclude` y CLAUDE.md pendiente #1). Sin
 * el módulo nativo, hasta el `import` revienta con "Cannot find native
 * module" — por eso va como `require()` dentro de un `try`, que sí se puede
 * atrapar (un `import` estático no). Todo lo de abajo se vuelve no-op mientras
 * `Notifications` sea `null`.
 */
let Notifications: typeof NotificationsType | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require('expo-notifications');
} catch (e) {
  console.warn('[push] módulo nativo de notificaciones no disponible:', (e as Error)?.message ?? e);
}

/** Derivada DIRECTO del require protegido de arriba — no un flag a mano. */
export const pushDisponible = Notifications !== null;

/**
 * Estado del permiso del sistema, para la fila "Notificaciones" de
 * Configuración. Son TRES valores, no dos — `getPermissionsAsync` puede
 * devolver `'undetermined'` (nunca se pidió), no solo `'granted'`/`'denied'`
 * (expo-modules-core, `PermissionsInterface.d.ts`).
 */
export type EstadoPermisoPush = 'concedido' | 'denegado' | 'no_solicitado';

/**
 * Lee el estado ACTUAL sin pedirlo (no dispara ningún diálogo). Para resolver
 * `'no_solicitado'`, usar `registrarPushToken()`, que sí pide el permiso.
 */
export async function estadoPermisoPush(): Promise<EstadoPermisoPush> {
  if (!Notifications) return 'no_solicitado';
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'concedido';
  if (status === 'undetermined') return 'no_solicitado';
  return 'denegado';
}

/**
 * Qué hacer con una notificación que llega con la app ABIERTA.
 *
 * Sin esto, iOS la traga en silencio: el default del sistema es no molestar a
 * una app que ya está en primer plano. Aquí sí queremos el banner, porque el
 * usuario puede estar en el Feed cuando baja el precio de un favorito.
 *
 * `shouldShowBanner`/`shouldShowList` y no `shouldShowAlert`: ese último está
 * deprecado en SDK 57 (verificado en
 * node_modules/expo-notifications/build/Notifications.types.d.ts:613).
 *
 * Sin sonido ni badge: los dos avisos de RF-16 son informativos, no urgentes.
 */
Notifications?.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Android no muestra NADA si la notificación no cae en un canal declarado, y el
 * canal tiene que existir antes de pedir el permiso para que el diálogo del
 * sistema aparezca en Android 13+. En iOS la llamada no existe, de ahí el guard
 * de plataforma.
 */
export async function configurarCanalAndroid(): Promise<void> {
  if (!Notifications || Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync('default', {
    name: 'Avisos de Relevo',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: '#C1440E', // --brick
  });
}

/** El `projectId` de EAS, que `getExpoPushTokenAsync` exige para firmar el token. */
function projectId(): string | null {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as any).easConfig?.projectId ??
    null
  );
}

/**
 * Pide el permiso del sistema y guarda el token de ESTE aparato.
 *
 * Devuelve `true` solo si quedó un token guardado — el llamador lo usa para
 * saber si tiene sentido volver a intentarlo, no para autorizar nada.
 *
 * Es idempotente a propósito: se llama en el botón del onboarding Y en cada
 * arranque con sesión (ver `session.tsx`). Volver a llamarla con el permiso ya
 * concedido no vuelve a mostrar ningún diálogo, y el insert de abajo no duplica.
 */
export async function registrarPushToken(userId: string): Promise<boolean> {
  // El emulador/simulador no tiene servicio de push: pedir el token ahí lanza.
  if (!Notifications || !Device.isDevice) return false;

  await configurarCanalAndroid();

  // `getPermissionsAsync` primero: `requestPermissionsAsync` sobre un permiso ya
  // DENEGADO no vuelve a preguntar (iOS solo muestra ese diálogo una vez en la
  // vida de la instalación), así que sin este paso no habría forma de distinguir
  // "el usuario dijo que no" de un fallo.
  const previo = await Notifications.getPermissionsAsync();
  const estado = previo.granted
    ? previo
    : await Notifications.requestPermissionsAsync();

  if (!estado.granted) return false;

  const id = projectId();
  if (!id) {
    console.warn('[push] sin projectId de EAS: no se puede pedir el token');
    return false;
  }

  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  } catch (e: any) {
    // Documentado por la propia librería: esta llamada pega a los servidores de
    // Expo y falla sin red. No es un error del usuario ni algo que valga la pena
    // mostrarle — el próximo arranque lo reintenta.
    console.warn('[push] no se pudo obtener el token:', e?.message ?? e);
    return false;
  }

  // INSERT PLANO CON `ignoreDuplicates`, NO UN UPSERT — y no es intercambiable.
  // Un `upsert` normal emite ON CONFLICT DO UPDATE, y Postgres evalúa el USING
  // de la policy de UPDATE contra la fila EXISTENTE: cuando este teléfono ya
  // tenía el token registrado por OTRA cuenta, esa fila es ajena y el statement
  // muere con "new row violates row-level security policy (USING expression)".
  // La reasignación de dueño la hace el trigger `push_tokens_claim` del lado de
  // la base (migración 20260911000450). Mismo mecanismo y misma razón de forma
  // que `agregarFavorito` en favoritos.ts.
  const { error } = await supabase.from('push_tokens').upsert(
    { token, user_id: userId, platform: Platform.OS === 'ios' ? 'ios' : 'android' },
    { onConflict: 'token', ignoreDuplicates: true },
  );

  if (error) {
    console.warn('[push] no se pudo guardar el token:', error.message);
    return false;
  }

  return true;
}

/**
 * Borra el token de ESTE aparato. Se llama al cerrar sesión: sin esto, el
 * teléfono seguiría recibiendo —y mostrando en la pantalla de bloqueo— los
 * avisos de la cuenta que acaba de salir.
 *
 * Best-effort: si falla, no puede impedir el cierre de sesión.
 */
export async function borrarPushToken(): Promise<void> {
  if (!Notifications || !Device.isDevice) return;

  const id = projectId();
  if (!id) return;

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await supabase.from('push_tokens').delete().eq('token', data);
  } catch (e: any) {
    console.warn('[push] no se pudo borrar el token:', e?.message ?? e);
  }
}

/**
 * Se pone en `true` justo antes de navegar por un tap de notificación (las DOS
 * ramas de `useRespuestaANotificacion`). La lee — nunca la espera — cualquier
 * otro efecto que compita por la navegación al abrir la app. No es un timer:
 * mismo criterio que `vigente`/`intentoRef` en `listings.ts`/
 * `selector-campus.tsx` — comprobar el estado real en el momento de actuar, no
 * adivinar cuánto tardaría el otro lado.
 *
 * OJO: quien la consume (`useAutoAbrirCalificarPendiente`, en confianza.ts) es
 * también quien la REINICIA a `false` al empezar cada uno de sus propios
 * ciclos de revisión (mount, y cada regreso a primer plano) — esta bandera
 * arbitra la carrera de CADA ciclo, no "si alguna vez pasó en esta sesión".
 * Este archivo (`push.ts`) solo la enciende; nunca la apaga.
 */
export const navegacionPorNotificacion = { current: false };

/** A dónde lleva el tap, leído del `data` que manda la Edge Function. */
function destino(respuesta: NotificationsType.NotificationResponse): string {
  const data = respuesta.notification.request.content.data as
    | { listing_id?: number | string | null }
    | undefined;

  const listingId = data?.listing_id;
  // Las de reporte llegan sin `listing_id` a propósito (el tap devolvería a la
  // persona al contenido que denunció), y una publicación borrada lo deja en
  // null por la FK. En ambos casos el destino honesto es el inbox.
  return listingId === null || listingId === undefined
    ? '/notificaciones'
    : `/detalle/${listingId}`;
}

/**
 * Navega cuando el usuario toca un push.
 *
 * Cubre los DOS caminos, que son distintos y fáciles de confundir:
 *  · `addNotificationResponseReceivedListener` — la app ya estaba viva.
 *  · `getLastNotificationResponseAsync` — la app estaba CERRADA y el tap fue lo
 *    que la abrió. Sin esta segunda mitad, el caso más común de todos (llega el
 *    aviso, el usuario abre desde la pantalla de bloqueo) aterriza en el Feed
 *    como si nada hubiera pasado.
 *
 * Se monta en el layout raíz, no en una pantalla: tiene que estar escuchando
 * pase lo que pase, y navegar desde una pantalla que puede estar desmontada no
 * tiene sentido.
 *
 * Las dos ramas marcan `navegacionPorNotificacion.current = true` justo antes
 * de navegar: además de navegar, esta función avisa que YA navegó, para que
 * otro efecto que compita por la pantalla al abrir la app
 * (`useAutoAbrirCalificarPendiente`, en `confianza.ts`) pueda comprobarlo
 * antes de actuar.
 */
export function useRespuestaANotificacion() {
  useEffect(() => {
    if (!Notifications) return;
    let activo = true;

    void Notifications.getLastNotificationResponseAsync().then((respuesta) => {
      if (!activo || !respuesta) return;
      navegacionPorNotificacion.current = true;
      router.push(destino(respuesta) as never);
    });

    const sub = Notifications.addNotificationResponseReceivedListener((respuesta) => {
      navegacionPorNotificacion.current = true;
      router.push(destino(respuesta) as never);
    });

    return () => {
      activo = false;
      sub.remove();
    };
  }, []);
}
