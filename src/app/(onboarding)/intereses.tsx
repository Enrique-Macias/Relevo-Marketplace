/**
 * Frame "Intereses" — paso OPCIONAL del alta, entre "Completar perfil" y
 * "Permiso de notificaciones" (20260930000475). Se ve una sola vez; después
 * los intereses se editan desde Perfil → "Mis intereses".
 *
 * NO llama a `useRedirectSiPerfilCompleto()`, por el mismo motivo que
 * "Permiso de notificaciones": al llegar aquí el perfil YA está completo
 * (nombre + campus), así que ese guard expulsaría al usuario al Feed a media
 * pantalla. Y no toca el gating: `isProfileComplete` no mira los intereses.
 * Si la app muere en este paso, al reabrir el splash manda al Feed y el paso
 * se salta — igual que el permiso. Se pueden elegir después desde Perfil.
 *
 * Nada de lo que pase aquí bloquea el registro:
 *  - "Omitir" sigue sin escribir nada;
 *  - "Continuar" guarda, y si guardar falla, avisa con un toast y sigue igual;
 *  - si las categorías no cargaron, se ve el esqueleto y "Omitir" funciona.
 */

import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthBody, AuthHeadline, AuthSub } from '@/components/AuthBody';
import { GhostButton, PrimaryButton } from '@/components/Buttons';
import { alternar, CategoriasSelector } from '@/components/CategoriasSelector';
import { Screen } from '@/components/Screen';
import { SkeletonCatGrid } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { Colors, ScreenPadding } from '@/constants/theme';
import { useExplorarState } from '@/lib/explorar-state';
import { guardarIntereses } from '@/lib/intereses';
import { useSession } from '@/lib/session';

export default function InteresesOnboardingScreen() {
  const { session } = useSession();
  const { categorias, categoriasListas, interesesCambiaron } = useExplorarState();
  const { mostrar } = useToast();
  const insets = useSafeAreaInsets();

  const [elegidas, setElegidas] = useState<Set<number>>(new Set());
  const [guardando, setGuardando] = useState(false);

  const seguir = () => router.replace('/permiso-notificaciones');

  const continuar = async () => {
    if (!session?.user.id || guardando) return;
    setGuardando(true);
    try {
      await guardarIntereses(session.user.id, [...elegidas]);
      interesesCambiaron();
    } catch (e: any) {
      // Toast y seguir: un fallo al guardar preferencias no puede atorar el
      // alta. Se pueden volver a elegir desde Perfil → "Mis intereses".
      console.warn('[intereses] no se pudieron guardar en el onboarding:', e?.message ?? e);
      mostrar('No pudimos guardar tus intereses. Puedes elegirlos desde tu perfil.', 'error');
    } finally {
      setGuardando(false);
    }
    seguir();
  };

  return (
    <>
      <Screen contentStyle={{ paddingBottom: insets.bottom + 150 }}>
        <StatusBar style="dark" />
        <AuthBody>
          {/* .auth-headline con margin-bottom:6px inline, .auth-sub con 20px */}
          <AuthHeadline style={styles.headline}>¿Qué te interesa?</AuthHeadline>
          <AuthSub style={styles.sub}>
            Elige las categorías que más buscas y te las mostramos primero. Puedes cambiarlas
            cuando quieras desde tu perfil.
          </AuthSub>
          {categoriasListas ? (
            <CategoriasSelector
              categorias={categorias}
              elegidas={elegidas}
              onToggle={(id) => setElegidas((prev) => alternar(prev, id))}
            />
          ) : (
            <View style={styles.skeleton}>
              <SkeletonCatGrid filas={4} columnas={3} />
            </View>
          )}
        </AuthBody>
      </Screen>

      {/* .sticky-cta.stacked — hermano del `.screen`, anclado abajo. Sin
          ninguna elegida, "Continuar" va deshabilitado (variante del frame):
          la salida es "Omitir", y así no hay dos botones que hagan lo mismo. */}
      <View style={[styles.stickyCta, { paddingBottom: insets.bottom + 22 }]}>
        <PrimaryButton
          label="Continuar"
          onPress={continuar}
          busy={guardando}
          disabled={elegidas.size === 0}
          style={styles.primary}
        />
        <GhostButton label="Omitir" onPress={seguir} disabled={guardando} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  headline: {
    marginBottom: 6,
  },
  sub: {
    marginBottom: 20,
  },
  // `SkeletonCatGrid` trae su propio padding lateral de pantalla (20), que
  // dentro de `.auth-body` (24) se sumaría: se compensa para que el esqueleto
  // ocupe el mismo ancho que la rejilla real.
  skeleton: {
    width: '100%',
    marginHorizontal: -ScreenPadding,
  },
  // Mismo `.sticky-cta` que "Publicar" (`(publicar)/nueva.tsx`): color plano en
  // vez del rgba + backdrop-filter del prototipo, que RN no tiene.
  stickyCta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    gap: 10,
    paddingTop: 14,
    paddingHorizontal: ScreenPadding,
    backgroundColor: Colors.paper,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  // El frame le pone `style="margin-top:0"` al primary.
  primary: {
    marginTop: 0,
  },
});
