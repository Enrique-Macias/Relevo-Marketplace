/**
 * `.toast` — aviso no bloqueante, anclado abajo de la pantalla.
 *
 * Dos variantes, ambas con frame propio en `design/relevo-app.html` (grupo
 * `sistema`): "Toast de éxito" (círculo `--forest`, palomita) y "Toast de
 * error" (círculo `--brick`, signo de admiración).
 *
 * El provider vive en el `_layout.tsx` raíz para que cualquier pantalla pueda
 * llamarlo sin montar su propio overlay.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { IconCheck, IconExclamation } from '@/components/icons';
import { Colors, Radii, Typography } from '@/constants/theme';

type Variante = 'exito' | 'error';

type ToastState = { mostrar: (texto: string, variante?: Variante) => void };

const Ctx = createContext<ToastState | null>(null);

export function useToast(): ToastState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast solo funciona dentro de <ToastProvider>');
  return ctx;
}

const DURACION_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ texto: string; variante: Variante } | null>(null);
  // Ver la nota de Skeleton.tsx sobre por qué no es `useRef().current`.
  const [opacidad] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mostrar = useCallback((texto: string, variante: Variante = 'exito') => {
    setToast({ texto, variante });
  }, []);

  useEffect(() => {
    if (!toast) return;

    Animated.timing(opacidad, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    timer.current = setTimeout(() => {
      Animated.timing(opacidad, { toValue: 0, duration: 180, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) setToast(null);
        }
      );
    }, DURACION_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [toast, opacidad]);

  return (
    <Ctx.Provider value={{ mostrar }}>
      {children}
      {toast ? (
        // pointerEvents="none": el toast no bloquea nada de lo que hay debajo —
        // es un aviso, no un diálogo.
        <Animated.View style={[styles.toast, { opacity: opacidad }]} pointerEvents="none">
          <View
            style={[
              styles.icon,
              toast.variante === 'error' ? styles.iconError : styles.iconExito,
            ]}
          >
            {toast.variante === 'error' ? (
              <IconExclamation size={12} color="#fff" />
            ) : (
              <IconCheck size={12} color="#fff" />
            )}
          </View>
          <Text style={styles.texto}>{toast.texto}</Text>
        </Animated.View>
      ) : null}
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  // .toast{position:absolute; left:20px; right:20px; bottom:100px; z-index:10;
  //        background:var(--ink); color:var(--paper); border-radius:14px;
  //        padding:13px 15px; display:flex; align-items:center; gap:10px;
  //        box-shadow:0 10px 24px rgba(0,0,0,0.22);}
  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 100,
    zIndex: 10,
    backgroundColor: Colors.ink,
    borderRadius: Radii.lg,
    paddingVertical: 13,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 8,
  },
  // .toast-icon{width:24px; height:24px; border-radius:50%; flex-shrink:0;}
  icon: {
    width: 24,
    height: 24,
    borderRadius: Radii.full,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconExito: {
    backgroundColor: Colors.forest,
  },
  // .toast-icon.is-error{background:var(--brick);}
  iconError: {
    backgroundColor: Colors.brick,
  },
  // .toast-text{font-size:13px; font-weight:500;}
  texto: {
    ...Typography.bodyStrong,
    color: Colors.paper,
    flex: 1,
  },
});
