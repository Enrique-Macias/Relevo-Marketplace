/**
 * Frame "Editar intereses" (Cuenta). Se abre desde Perfil → "Mis intereses",
 * su única entrada fuera del onboarding (20260930000475).
 *
 * La ruta es `/mis-intereses` y no `/intereses` porque esa ya es el paso del
 * onboarding (`(onboarding)/intereses.tsx`): los grupos no entran en la URL,
 * así que dos archivos con el mismo nombre en grupos distintos chocarían.
 *
 * Mismo patrón que "Editar perfil": el formulario solo se monta con los
 * intereses REALES ya leídos (esqueleto mientras, `ErrorState` si falla), y
 * por eso "Guardar" se habilita comparando contra lo leído — nunca contra una
 * precarga vacía que haría parecer "sin cambios" algo que sí cambió.
 * Guardar sin ninguna elegida es válido: Recomendados vuelve a ser lo más
 * reciente.
 */

import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { alternar, CategoriasSelector } from '@/components/CategoriasSelector';
import { ErrorState } from '@/components/ErrorState';
import { FormHeader } from '@/components/ListRow';
import { Screen } from '@/components/Screen';
import { SkeletonCatGrid } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { Colors, ScreenPadding, Typography } from '@/constants/theme';
import { useExplorarState } from '@/lib/explorar-state';
import { fetchMisIntereses, guardarIntereses } from '@/lib/intereses';
import { useSession } from '@/lib/session';

export default function MisInteresesScreen() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const { categoriasListas } = useExplorarState();

  const [guardados, setGuardados] = useState<Set<number> | null>(null);
  const [error, setError] = useState(false);
  const [recargas, setRecargas] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let vigente = true;
    fetchMisIntereses(userId)
      .then((ids) => {
        if (vigente) setGuardados(new Set(ids));
      })
      .catch((e) => {
        if (!vigente) return;
        console.warn('[mis-intereses] no se pudieron leer:', e?.message ?? e);
        setError(true);
      });
    return () => {
      vigente = false;
    };
  }, [userId, recargas]);

  if (guardados && userId && categoriasListas) {
    return <Formulario userId={userId} guardados={guardados} />;
  }

  return (
    <Screen header={<FormHeader title="Intereses" />}>
      <StatusBar style="dark" />
      {error ? (
        <ErrorState
          onRetry={() => {
            setError(false);
            setRecargas((n) => n + 1);
          }}
          title="No pudimos abrir tus intereses"
          sub="Revisa tu conexión e intenta de nuevo."
        />
      ) : (
        <View style={styles.skeleton}>
          <SkeletonCatGrid filas={4} columnas={3} />
        </View>
      )}
    </Screen>
  );
}

function Formulario({ userId, guardados }: { userId: string; guardados: Set<number> }) {
  const { categorias, interesesCambiaron } = useExplorarState();
  const { mostrar } = useToast();

  const [elegidas, setElegidas] = useState<Set<number>>(guardados);
  const [guardando, setGuardando] = useState(false);

  const cambio =
    elegidas.size !== guardados.size || [...elegidas].some((id) => !guardados.has(id));

  const guardar = async () => {
    if (!cambio || guardando) return;
    setGuardando(true);
    try {
      await guardarIntereses(userId, [...elegidas]);
      interesesCambiaron();
      mostrar('Intereses guardados');
      router.back();
    } catch (e: any) {
      console.warn('[mis-intereses] no se pudieron guardar:', e?.message ?? e);
      mostrar('No pudimos guardar tus intereses. Intenta de nuevo.', 'error');
      setGuardando(false);
    }
  };

  return (
    <Screen
      header={
        <FormHeader
          title="Intereses"
          trailing={{
            label: guardando ? 'Guardando…' : 'Guardar',
            onPress: guardar,
            disabled: !cambio || guardando,
          }}
        />
      }
      contentStyle={styles.content}
    >
      <StatusBar style="dark" />
      {/* .auth-sub con max-width:none y margin-bottom:18px, alineado a la izquierda */}
      <Text style={styles.sub}>Elige las categorías que más buscas.</Text>
      <CategoriasSelector
        categorias={categorias}
        elegidas={elegidas}
        onToggle={(id) => {
          if (!guardando) setElegidas((prev) => alternar(prev, id));
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // .form-body{padding:18px 20px 100px;}
  content: {
    paddingTop: 18,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 100,
  },
  // .auth-sub{font-size:13px; color:var(--ink-soft); line-height:1.55;}
  sub: {
    ...Typography.auth,
    color: Colors.inkSoft,
    marginBottom: 18,
  },
  skeleton: {
    paddingTop: 18,
  },
});
