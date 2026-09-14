/**
 * Layout de "Editar perfil" + el borrador del bloque institucional.
 *
 * Por qué hace falta un contexto aquí, si el formulario es una sola pantalla:
 * el selector de universidad es una RUTA, no un componente. `SelectorCatalogo`
 * hace `router.back()` adentro al elegir (`src/components/SelectorCatalogo.tsx`),
 * así que no se puede montar dentro de un `Modal` como `CampusBottomSheet`, y la
 * ruta que ya existe (`(onboarding)/selector-universidad.tsx`) escribe en
 * `usePerfilDraft`, un contexto que solo alcanza al grupo de onboarding. Este es
 * el mismo mecanismo de `(onboarding)/_layout.tsx`, acotado a las dos rutas que
 * lo necesitan.
 *
 * Solo vive aquí lo que escribe la OTRA ruta. Nombre, carrera y teléfono se
 * quedan en el estado local de la pantalla: al empujar el selector, la pantalla
 * no se desmonta (es un Stack), así que su estado sobrevive solo.
 */

import { Stack } from 'expo-router';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { type OpcionCatalogo } from '@/lib/catalogos';

type Institucional = {
  universidad: OpcionCatalogo | null;
  campus: OpcionCatalogo | null;
};

type InstitucionalContext = Institucional & {
  setUniversidad: (v: OpcionCatalogo) => void;
  setCampus: (v: OpcionCatalogo) => void;
  /** Siembra el borrador con lo que ya tiene el perfil, al terminar de cargar. */
  hidratar: (v: Institucional) => void;
};

const Ctx = createContext<InstitucionalContext | null>(null);

export function useInstitucionalDraft(): InstitucionalContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useInstitucionalDraft solo funciona dentro de (cuenta)/editar-perfil');
  return ctx;
}

export default function EditarPerfilLayout() {
  const [valor, setValor] = useState<Institucional>({ universidad: null, campus: null });

  const setUniversidad = useCallback((u: OpcionCatalogo) => {
    setValor((v) => ({
      universidad: u,
      // Cambiar de universidad limpia el campus, exactamente como en el
      // borrador de onboarding (`(onboarding)/_layout.tsx`): `campus.universidad_id`
      // es FK, así que un campus de la universidad anterior deja el perfil
      // incoherente — y la base NO lo impide (no hay constraint que ate
      // `users.campus_id` a `users.universidad_id`; ver la deuda consciente de
      // CLAUDE.md §8). Esta pantalla es el segundo escritor de ese par, así que
      // la regla tiene que estar en los dos.
      campus: v.universidad?.id === u.id ? v.campus : null,
    }));
  }, []);

  const value = useMemo<InstitucionalContext>(
    () => ({
      ...valor,
      setUniversidad,
      setCampus: (c) => setValor((v) => ({ ...v, campus: c })),
      hidratar: setValor,
    }),
    [valor, setUniversidad]
  );

  return (
    <Ctx.Provider value={value}>
      <Stack screenOptions={{ headerShown: false }} />
    </Ctx.Provider>
  );
}
