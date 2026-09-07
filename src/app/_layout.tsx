import { Fraunces_400Regular, Fraunces_500Medium, Fraunces_600SemiBold } from '@expo-google-fonts/fraunces';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { ExplorarStateProvider } from '@/lib/explorar-state';
import { SessionProvider } from '@/lib/session';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    // El provider envuelve TODO el árbol de rutas: el splash, el guard de
    // (tabs) y las pantallas de auth leen del mismo estado de sesión.
    <SessionProvider>
      <ExplorarStateProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(onboarding)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(explorar)" />
          <Stack.Screen name="(publicar)" />
          <Stack.Screen name="(cuenta)" />
          <Stack.Screen name="(confianza)" />
          <Stack.Screen name="(notificaciones)" />
          <Stack.Screen name="(sistema)" options={{ presentation: 'modal' }} />
          {/*
            Selector de campus y Filtros son hojas (bottom sheet) que deben
            dejar ver la pantalla de origen (Feed/Búsqueda/Categoría) detrás
            con un backdrop semitransparente — para eso sirve `SheetScreen`.
            Antes vivían dentro de `(explorar)/_layout.tsx` con
            `presentation:'transparentModal'` puesto en SU stack anidado, pero
            eso solo controla transiciones DENTRO de un `(explorar)` ya
            montado. La entrada real (desde Feed/Búsqueda en `(tabs)`, o desde
            Categoría en el propio `(explorar)`) cruza el navigator — y esa
            transición la resuelve ESTE stack raíz, empujando "(explorar)"
            como una sola card opaca sin importarle las opciones de su
            navigator interno. Por eso se sentía como una pantalla completa
            nueva, no como una hoja flotando: el backdrop transparente de
            `SheetScreen` nunca llegaba a pintarse sobre nada, porque para
            cuando se montaba, la pantalla de origen ya había sido cubierta
            por el push opaco del stack raíz. Moviéndolas aquí — mismo patrón
            que ya usa `(sistema)` arriba — el stack que de verdad hace el
            push es el que sabe que debe ser transparente.
          */}
          <Stack.Screen
            name="selector-campus"
            options={{ presentation: 'transparentModal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen
            name="filtros"
            options={{ presentation: 'transparentModal', animation: 'slide_from_bottom' }}
          />
        </Stack>
      </ExplorarStateProvider>
    </SessionProvider>
  );
}
