/**
 * Sesión y perfil de la app — fuente única de verdad para el auth gating.
 *
 * Junta dos cosas que siempre se consultan a la vez:
 *  - la sesión de Supabase Auth (¿hay usuario?),
 *  - la fila de `public.users` (¿el perfil está completo?).
 *
 * El gating necesita ambas: tener sesión no basta para entrar al Feed, porque
 * el trigger `on_auth_user_created` crea la fila con `(id, correo)` y la
 * universidad del dominio del correo (20260924000466), pero deja `nombre` y
 * `campus_id` en null hasta que el usuario pasa por "Completar perfil"
 * (CLAUDE.md §5).
 */

import type { Session } from '@supabase/supabase-js';
import { Redirect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { registrarActividad } from '@/lib/actividad';
import { esCuentaInexistente } from '@/lib/cuenta-inexistente';
import { borrarPushToken, registrarPushToken } from '@/lib/push';
import { supabase } from '@/lib/supabase';

/**
 * Las columnas que el cliente puede leer de `public.users`.
 *
 * NO uses `select('*')`: `correo` quedó fuera del grant de select (RNF-05, ver
 * la migración 20260906000438) y pedir `*` hace fallar la query entera con
 * `42501 permission denied`, no la devuelve sin esa columna. El correo del
 * propio usuario se lee de `session.user.email`.
 */
const PROFILE_COLUMNS =
  'id, nombre, foto_url, universidad_id, campus_id, carrera, rating_promedio, estado, tiene_telefono';

/**
 * Resultado EXPLÍCITO de la lectura (AUTH-1, AUTH-2): fila, CERO filas y "la
 * consulta falló" son tres cosas distintas. Con un error de red, tratar el
 * perfil como incompleto mandaría a una cuenta completa a "Completar perfil",
 * donde guardar le sobrescribe contraseña, nombre y campus.
 */
type LecturaPerfil = { tipo: 'fila'; perfil: Profile } | { tipo: 'sin_fila' } | { tipo: 'error' };

async function leerPerfil(userId: string): Promise<LecturaPerfil> {
  const { data, error } = await supabase
    .from('users')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    // `maybeSingle` y no `single`: cero filas no es un error de la consulta,
    // pero tampoco "perfil incompleto". Ver `resolverPerfil`.
    .maybeSingle();

  if (error) {
    console.warn('[session] no se pudo leer el perfil:', error.message);
    return { tipo: 'error' };
  }
  return data ? { tipo: 'fila', perfil: data as Profile } : { tipo: 'sin_fila' };
}

/**
 * Qué es la cuenta de esta sesión (AUTH-2). Los cinco estados del gating:
 *   A/B. `fila`: el perfil existe; completo o incompleto lo decide el gating.
 *   C. `error`: no se pudo saber (lectura o verificación fallidas). Sesión intacta.
 *   D. `cuenta_inexistente`: la cuenta ya no existe en Auth, pero quedó la sesión
 *      local (el token sigue verificando por firma hasta su `exp`).
 *   E. `inconsistente`: la cuenta existe en Auth y NO tiene fila de perfil.
 *
 * Cero filas NUNCA es "perfil incompleto": el trigger de alta crea la fila en
 * la misma transacción que la cuenta (`on_auth_user_created`, `after insert`) y
 * el borrado de la cuenta se la lleva en cascada, así que un perfil incompleto
 * (B) siempre TIENE fila, con nombre o campus en NULL. Solo con cero filas se
 * pregunta a Auth (`getUser()`), y solo para separar D de E: en A/B no hay
 * llamada extra. Únicamente los errores de `esCuentaInexistente` son D; un
 * fallo de red o cualquier otro error es C, y C nunca cierra sesión.
 *
 * NO se llama desde el callback de `onAuthStateChange` (deadlock de supabase-js,
 * arriba): solo desde el efecto del perfil y desde `refreshProfile`.
 */
type ResolucionPerfil =
  | { tipo: 'fila'; perfil: Profile }
  | { tipo: 'error' }
  | { tipo: 'cuenta_inexistente' }
  | { tipo: 'inconsistente' };

async function resolverPerfil(userId: string): Promise<ResolucionPerfil> {
  const lectura = await leerPerfil(userId);
  if (lectura.tipo !== 'sin_fila') return lectura;

  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) {
      console.warn('[session] la cuenta existe pero no tiene fila en public.users (inconsistencia)');
      return { tipo: 'inconsistente' };
    }
    if (esCuentaInexistente(error)) return { tipo: 'cuenta_inexistente' };
    console.warn('[session] no se pudo verificar la cuenta sin perfil:', error?.message);
    return { tipo: 'error' };
  } catch (e) {
    console.warn('[session] no se pudo verificar la cuenta sin perfil:', e instanceof Error ? e.message : e);
    return { tipo: 'error' };
  }
}

/**
 * Estado D: borra la sesión LOCAL de una cuenta que ya no existe. `scope:
 * 'local'` porque en el servidor ya no hay sesión que cerrar, y no se usa el
 * `signOut` de `useSession` porque su borrado del token de push no aplica (el
 * cascade de la cuenta ya se lo llevó). auth-js borra la sesión local aunque el
 * servidor responda 401/403/404 o falle la red, y emite `SIGNED_OUT`.
 * Devuelve false solo si no pudo limpiarla.
 */
async function limpiarSesionDeCuentaInexistente(): Promise<boolean> {
  console.warn('[session] la cuenta de esta sesión ya no existe: se cierra la sesión local');
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) console.warn('[session] signOut local devolvió un error:', error.message);
    return !error;
  } catch (e) {
    console.warn('[session] signOut local falló:', e instanceof Error ? e.message : e);
    return false;
  }
}

export type Profile = {
  id: string;
  nombre: string | null;
  foto_url: string | null;
  universidad_id: number | null;
  campus_id: number | null;
  carrera: string | null;
  rating_promedio: number;
  estado: 'activo' | 'suspendido';
  /**
   * Si el perfil ya tiene un WhatsApp guardado. NO existe un `telefono` aquí y
   * no es un olvido: el número está fuera del grant de select (RNF-05, ver la
   * migración 20260910000448) y se lee solo por `seller_whatsapp`. Esta columna
   * es generada en la base justo para que el cliente pueda preguntar "¿ya
   * tiene?" sin poder preguntar "¿cuál es?".
   *
   * La usa el gate de Publicar: sin teléfono no se puede publicar (RF-13), y el
   * campo para capturarlo aparece ahí mismo.
   */
  tiene_telefono: boolean | null;
};

type SessionState = {
  session: Session | null;
  profile: Profile | null;
  /** `loading` hasta que sabemos si hay sesión Y si el perfil está completo. */
  status: 'loading' | 'ready';
  /** El criterio de "perfil completo" del gating. */
  isProfileComplete: boolean;
  /**
   * La última lectura del perfil de ESTE usuario falló (red, 5xx, permisos),
   * o la cuenta existe sin fila de perfil (inconsistencia, AUTH-2 estado E).
   * Perfil incompleto ≠ error al leer el perfil: con `true` e
   * `isProfileComplete` en false, `profile` es null porque NO se pudo leer, no
   * porque falte nombre o campus, y nadie debe mandar a "Completar perfil" por
   * eso (`codigo.tsx`, `splash.tsx`, `(tabs)/_layout.tsx`). Con `true` e
   * `isProfileComplete` en true, falló un `refreshProfile()` y se conservó el
   * perfil válido que ya había de esta cuenta.
   */
  profileError: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authResuelto, setAuthResuelto] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  // De qué usuario es el perfil que tenemos cargado. Comparado contra `userId`
  // da el "¿ya resolvió?" sin necesidad de un flag aparte que habría que
  // escribir sincrónicamente dentro del efecto.
  const [perfilCargadoPara, setPerfilCargadoPara] = useState<string | null>(null);
  // De qué usuario falló la última lectura del perfil. Ligado al usuario por
  // lo mismo que `perfilCargadoPara`: el error de la cuenta anterior no debe
  // decidir nada sobre la nueva.
  const [perfilErrorPara, setPerfilErrorPara] = useState<string | null>(null);

  const userId = session?.user.id ?? null;

  // La cuenta vigente, para que `refreshProfile` (asíncrono) sepa si su
  // resultado sigue siendo de la cuenta actual al terminar. Se asigna en un
  // efecto, no en el render (`react-hooks/refs`); mismo patrón que
  // `pathnameRef` en `src/lib/confianza.ts`.
  const userIdActual = useRef(userId);
  useEffect(() => {
    userIdActual.current = userId;
  });

  useEffect(() => {
    let activo = true;

    // Sesión inicial (viene del storage cifrado, ver src/lib/supabase.ts).
    supabase.auth.getSession().then(({ data }) => {
      if (!activo) return;
      setSession(data.session);
      setAuthResuelto(true);
    });

    /**
     * OJO: este callback es SÍNCRONO a propósito y no debe llamar a ninguna
     * función de supabase.
     *
     * Hay un bug conocido en supabase-js: cualquier llamada async hecha dentro
     * de `onAuthStateChange` provoca un deadlock — la siguiente llamada que
     * haga el cliente, desde donde sea, se cuelga y nunca regresa.
     * https://supabase.com/docs/guides/troubleshooting/why-is-my-supabase-api-call-not-returning-PGzXw0
     *
     * Por eso aquí solo se guarda la sesión, y la lectura del perfil vive en el
     * efecto de abajo, disparado por el cambio de `userId` — ya fuera del lock
     * de auth.
     */
    const { data: sub } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      if (!activo) return;
      setSession(nuevaSesion);
      setAuthResuelto(true);
    });

    return () => {
      activo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    // Sin usuario no hay nada que cargar: el estado derivado de abajo ya trata
    // ese caso como resuelto, sin tocar estado desde el cuerpo del efecto.
    if (!userId) return;

    let activo = true;
    void (async () => {
      const r = await resolverPerfil(userId);
      if (!activo) return;
      if (r.tipo === 'cuenta_inexistente') {
        // D: el perfil NO se marca como resuelto. Si se resolviera con
        // `profile` null y sin error, habría un render que mandaría a
        // "Completar perfil" antes del `SIGNED_OUT`; así `status` sigue en
        // `loading` hasta que la sesión pasa a null y splash manda al login.
        if (await limpiarSesionDeCuentaInexistente()) return;
        if (!activo) return;
        // No se pudo limpiar: se trata como C (ErrorState), nunca como B.
      }
      setProfile(r.tipo === 'fila' ? r.perfil : null);
      setPerfilErrorPara(r.tipo === 'fila' ? null : userId);
      setPerfilCargadoPara(userId);
    })();

    return () => {
      activo = false;
    };
  }, [userId]);

  /**
   * Re-registro del token de push en cada arranque con sesión (RF-16).
   *
   * NO basta con el botón "Activar notificaciones" del onboarding, y esta es la
   * misma lección que dejó el gate del teléfono de RF-13 (CLAUDE.md §8): TODA
   * cuenta existente ya pasó por esa pantalla, así que si ese fuera el único
   * punto de captura, nadie con cuenta previa recibiría jamás un push. Además el
   * permiso se puede revocar desde Ajustes y el token puede rotar.
   *
   * Vive en su propio efecto y NO dentro del callback de `onAuthStateChange`:
   * ese callback es síncrono a propósito por el deadlock de supabase-js
   * documentado arriba, y esto hace una escritura a la base.
   *
   * Sin `await` visible ni manejo de error: `registrarPushToken` ya se traga lo
   * suyo y devuelve false. Que no haya token es un estado válido —el usuario
   * dijo que no, o está en un simulador— y no debe frenar el arranque.
   */
  useEffect(() => {
    if (!userId) return;
    void registrarPushToken(userId);
  }, [userId]);

  /**
   * Señal diaria de uso (RF-17 Ola 6): al arrancar con sesión y cada vez que la
   * app vuelve a primer plano. `registrarActividad` deduplica por cuenta y día
   * en memoria y se traga sus errores, así que llamarla de más es barato y
   * nunca frena nada. Mismo criterio que el push de arriba: un efecto aparte,
   * fuera del callback de `onAuthStateChange` (deadlock de supabase-js).
   * El patrón del listener es el de `confianza.ts`.
   */
  useEffect(() => {
    if (!userId) return;
    void registrarActividad(userId);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void registrarActividad(userId);
    });
    return () => sub.remove();
  }, [userId]);

  // Sin sesión el perfil es null y está resuelto por definición. Con sesión,
  // solo cuenta como resuelto si el perfil cargado es el de ESTE usuario —
  // así, al cambiar de cuenta, el gating no decide con el perfil del anterior.
  const perfilResuelto = userId === null || perfilCargadoPara === userId;
  const perfilVigente = userId === null ? null : profile;

  /**
   * Relee el perfil y **espera** a tenerlo antes de resolver. Ese await importa:
   * "Completar perfil" lo llama justo antes de navegar, y si resolviera antes
   * de que el estado se actualice, el guard de (tabs) todavía vería el perfil
   * incompleto y rebotaría al usuario de vuelta al formulario que acaba de
   * llenar. Aquí sí se puede llamar a supabase directo: esto corre desde un
   * handler, no desde el callback de onAuthStateChange.
   */
  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    const r = await resolverPerfil(userId);
    // La cuenta cambió mientras se leía: este resultado es de OTRA cuenta y no
    // se escribe nada (ni perfil ni error). La carga de la cuenta nueva la hace
    // el efecto de `userId`.
    if (userIdActual.current !== userId) return;
    if (r.tipo === 'fila') {
      setProfile(r.perfil);
      setPerfilErrorPara(null);
      return;
    }
    if (r.tipo === 'cuenta_inexistente') {
      // D: el `SIGNED_OUT` lleva la sesión a null. Si no se pudo limpiar,
      // sigue abajo como E (sin perfil y con error), nunca como incompleto.
      if (await limpiarSesionDeCuentaInexistente()) return;
      if (userIdActual.current !== userId) return;
    }
    if (r.tipo !== 'error') {
      // E (o D sin poder limpiar): la fila NO existe, así que no se conserva
      // ningún perfil anterior; `profileError` impide leer el null como B.
      setProfile(null);
      setPerfilErrorPara(userId);
      return;
    }
    // Un error de lectura NO destruye un perfil válido de esta misma cuenta
    // (AUTH-1b): sin esto, un `refreshProfile()` fallido desde Perfil, Editar
    // perfil o Publicar dejaba `profile` en null y `(tabs)/_layout` mandaba a
    // una cuenta completa a "Completar perfil". Solo se conserva si su `id` es
    // el de esta cuenta; si no hay uno así, queda null y `profileError` impide
    // leer ese null como "perfil incompleto".
    setProfile((anterior) => (anterior !== null && anterior.id === userId ? anterior : null));
    setPerfilErrorPara(userId);
  }, [userId]);

  const signOut = useCallback(async () => {
    // ANTES del signOut, y el orden no es estético: la policy de delete de
    // `push_tokens` es `user_id = auth.uid()`, así que sin sesión ya no hay
    // quién autorice el borrado. Al revés, el token quedaría vivo y este
    // teléfono seguiría mostrando en su pantalla de bloqueo los avisos de la
    // cuenta que acaba de salir.
    //
    // Best-effort con await: si falla, `borrarPushToken` lo registra y sigue —
    // no se le puede negar a alguien cerrar sesión por esto.
    await borrarPushToken();
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      session,
      profile: perfilVigente,
      status: authResuelto && perfilResuelto ? 'ready' : 'loading',
      // El criterio exacto del gating: sin nombre o sin campus, el perfil sigue
      // incompleto y el usuario no puede pasar al Feed. Es `campus_id` y ya no
      // `universidad_id`: la universidad llega puesta desde el alta
      // (20260924000466), así que dejó de ser la señal de "completó el perfil".
      // Y el campus implica universidad: la base no admite campus sin ella
      // (`users_campus_requiere_universidad`).
      isProfileComplete: Boolean(perfilVigente?.nombre && perfilVigente?.campus_id),
      profileError: userId !== null && perfilErrorPara === userId,
      refreshProfile,
      signOut,
    }),
    [session, perfilVigente, authResuelto, perfilResuelto, userId, perfilErrorPara, refreshProfile, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession debe usarse dentro de <SessionProvider> (src/app/_layout.tsx)');
  }
  return ctx;
}

/**
 * Guard inverso de las pantallas de entrada (Verificación, Código, Iniciar
 * sesión): si ya hay sesión con perfil completo, esas pantallas no aplican.
 *
 * Sin esto, un usuario ya registrado que vuelve por ahí (el gesto de "atrás"
 * desde el Feed alcanza — `router.replace` reemplaza la ruta, no la pila) puede
 * sobrescribir su perfil, o peor: escribir otro correo y, como
 * `signInWithOtp` va con `shouldCreateUser: true`, crear una SEGUNDA cuenta y
 * dejar la primera huérfana con sus publicaciones y calificaciones.
 *
 * Devuelve el `<Redirect>` a renderizar, o `null` para seguir en la pantalla.
 * No va en `(onboarding)/_layout.tsx` a propósito: al guardar el perfil,
 * `isProfileComplete` pasa a true y el usuario todavía tiene que ver
 * "/permiso-notificaciones", que vive en ese mismo grupo — un guard de grupo lo
 * expulsaría al Feed a media pantalla.
 */
export function useRedirectSiPerfilCompleto(): React.ReactElement | null {
  const { status, session, isProfileComplete } = useSession();

  if (status === 'loading') return null;
  if (session && isProfileComplete) return <Redirect href="/(tabs)" />;
  return null;
}
