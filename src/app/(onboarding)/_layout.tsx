/**
 * Layout del grupo de onboarding + el borrador del perfil en construcción.
 *
 * El borrador vive aquí, en el layout, y no en params de ruta. El mecanismo
 * anterior (`router.back()` seguido de `router.setParams()` en cada selector)
 * tenía dos problemas: `setParams` corría sobre una ruta que aún no terminaba
 * de cambiar, y solo devolvía el *nombre* del catálogo — pero para escribir en
 * `public.users` hacen falta los ids (`universidad_id`, `campus_id`).
 */

import { Stack } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type OpcionCatalogo = { id: number; nombre: string };

type Draft = {
  correo: string;
  nombre: string;
  universidad: OpcionCatalogo | null;
  campus: OpcionCatalogo | null;
  password: string;
  passwordConfirm: string;
};

type DraftContext = Draft & {
  setCorreo: (v: string) => void;
  setNombre: (v: string) => void;
  setUniversidad: (v: OpcionCatalogo) => void;
  setCampus: (v: OpcionCatalogo) => void;
  setPassword: (v: string) => void;
  setPasswordConfirm: (v: string) => void;
};

const VACIO: Draft = {
  correo: '',
  nombre: '',
  universidad: null,
  campus: null,
  password: '',
  passwordConfirm: '',
};

const Ctx = createContext<DraftContext | null>(null);

export function usePerfilDraft(): DraftContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePerfilDraft solo funciona dentro del grupo (onboarding)');
  return ctx;
}

export default function OnboardingLayout() {
  const [draft, setDraft] = useState<Draft>(VACIO);

  const setUniversidad = useCallback((u: OpcionCatalogo) => {
    setDraft((d) => ({
      ...d,
      universidad: u,
      // Al cambiar de universidad se limpia el campus: `campus.universidad_id`
      // es FK, así que un campus de la universidad anterior dejaría el perfil
      // incoherente. La base no lo impide (no hay constraint que ate
      // users.campus_id a users.universidad_id), así que toca hacerlo aquí.
      campus: d.universidad?.id === u.id ? d.campus : null,
    }));
  }, []);

  const value = useMemo<DraftContext>(
    () => ({
      ...draft,
      setCorreo: (v) => setDraft((d) => ({ ...d, correo: v })),
      setNombre: (v) => setDraft((d) => ({ ...d, nombre: v })),
      setUniversidad,
      setCampus: (v) => setDraft((d) => ({ ...d, campus: v })),
      setPassword: (v) => setDraft((d) => ({ ...d, password: v })),
      setPasswordConfirm: (v) => setDraft((d) => ({ ...d, passwordConfirm: v })),
    }),
    [draft, setUniversidad]
  );

  return (
    <Ctx.Provider value={value}>
      <Stack screenOptions={{ headerShown: false }} />
    </Ctx.Provider>
  );
}
