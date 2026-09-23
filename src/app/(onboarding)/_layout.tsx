/**
 * Layout del grupo de onboarding + el borrador del perfil en construcción.
 *
 * El borrador vive aquí, en el layout, y no en params de ruta. El mecanismo
 * anterior (`router.back()` seguido de `router.setParams()` en cada selector)
 * tenía dos problemas: `setParams` corría sobre una ruta que aún no terminaba
 * de cambiar, y solo devolvía el *nombre* del catálogo — pero para escribir en
 * `public.users` hace falta el id (`campus_id`).
 */

import { Stack } from 'expo-router';
import { createContext, useContext, useMemo, useState } from 'react';

import { type OpcionCatalogo } from '@/lib/catalogos';

// Vive en `src/lib/catalogos.ts`, compartido con "Editar perfil": dos
// definiciones idénticas con el mismo nombre en dos módulos distintos serían una
// invitación a que se separaran. Se re-exporta para no cambiar la superficie de
// este layout.
//
// El borrador ya NO lleva universidad: la asigna el servidor desde el dominio
// del correo al crear la cuenta (20260924000466), así que no hay nada que
// elegir ni un campus que limpiar al cambiarla. La coherencia campus ↔
// universidad la garantiza la base (FK compuesta), no este layout.
export type { OpcionCatalogo };

type Draft = {
  correo: string;
  nombre: string;
  campus: OpcionCatalogo | null;
  password: string;
  passwordConfirm: string;
};

type DraftContext = Draft & {
  setCorreo: (v: string) => void;
  setNombre: (v: string) => void;
  setCampus: (v: OpcionCatalogo) => void;
  setPassword: (v: string) => void;
  setPasswordConfirm: (v: string) => void;
};

const VACIO: Draft = {
  correo: '',
  nombre: '',
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

  const value = useMemo<DraftContext>(
    () => ({
      ...draft,
      setCorreo: (v) => setDraft((d) => ({ ...d, correo: v })),
      setNombre: (v) => setDraft((d) => ({ ...d, nombre: v })),
      setCampus: (v) => setDraft((d) => ({ ...d, campus: v })),
      setPassword: (v) => setDraft((d) => ({ ...d, password: v })),
      setPasswordConfirm: (v) => setDraft((d) => ({ ...d, passwordConfirm: v })),
    }),
    [draft]
  );

  return (
    <Ctx.Provider value={value}>
      <Stack screenOptions={{ headerShown: false }} />
    </Ctx.Provider>
  );
}
