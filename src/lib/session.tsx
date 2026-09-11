/**
 * Sesión y perfil de la app — fuente única de verdad para el auth gating.
 *
 * Junta dos cosas que siempre se consultan a la vez:
 *  - la sesión de Supabase Auth (¿hay usuario?),
 *  - la fila de `public.users` (¿el perfil está completo?).
 *
 * El gating necesita ambas: tener sesión no basta para entrar al Feed, porque
 * el trigger `on_auth_user_created` crea la fila solo con `(id, correo)` y deja
 * `nombre`/`universidad_id` en null hasta que el usuario pasa por "Completar
 * perfil" (CLAUDE.md §5).
 */

import type { Session } from '@supabase/supabase-js';
import { Redirect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

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

async function leerPerfil(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('users')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    // `maybeSingle` y no `single`: justo después de verificar el OTP hay una
    // ventana en la que el trigger puede no haber insertado la fila todavía.
    // Sin fila = perfil incompleto, no un error que rompa el arranque.
    .maybeSingle();

  if (error) {
    console.warn('[session] no se pudo leer el perfil:', error.message);
    return null;
  }
  return data as Profile | null;
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

  const userId = session?.user.id ?? null;

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
    void leerPerfil(userId).then((p) => {
      if (!activo) return;
      setProfile(p);
      setPerfilCargadoPara(userId);
    });

    return () => {
      activo = false;
    };
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
    setProfile(await leerPerfil(userId));
  }, [userId]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<SessionState>(
    () => ({
      session,
      profile: perfilVigente,
      status: authResuelto && perfilResuelto ? 'ready' : 'loading',
      // El criterio exacto del gating: sin nombre o sin universidad, el perfil
      // sigue incompleto y el usuario no puede pasar al Feed.
      isProfileComplete: Boolean(perfilVigente?.nombre && perfilVigente?.universidad_id),
      refreshProfile,
      signOut,
    }),
    [session, perfilVigente, authResuelto, perfilResuelto, refreshProfile, signOut]
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
 * "/notificaciones", que vive en ese mismo grupo — un guard de grupo lo
 * expulsaría al Feed a media pantalla.
 */
export function useRedirectSiPerfilCompleto(): React.ReactElement | null {
  const { status, session, isProfileComplete } = useSession();

  if (status === 'loading') return null;
  if (session && isProfileComplete) return <Redirect href="/(tabs)" />;
  return null;
}
