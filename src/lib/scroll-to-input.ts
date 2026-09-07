/**
 * "Scroll to focused input" — el patrón estándar de RN, implementado a mano.
 *
 * Deliberadamente NO usa `scrollResponderScrollNativeHandleToKeyboard()`: esa
 * API llama por dentro a `getInnerViewNode()`/`getInnerViewRef()`, marcadas
 * como obsoletas desde hace años (facebook/react-native#28203) y pensadas
 * para la arquitectura antigua de RN. Este proyecto corre en New Architecture
 * (obligatoria desde RN 0.82; aquí es 0.86) — bajo Fabric, `measureLayout` se
 * llama pasando el ref del ancestro directamente, no un node handle:
 * https://reactnative.dev/docs/direct-manipulation
 *
 * Tampoco se usó una librería (`react-native-keyboard-aware-scroll-view` o
 * `react-native-keyboard-controller`) — ver el comentario en `Field.tsx` para
 * el porqué de cada una.
 */

import type { RefObject } from 'react';
import type { ScrollView, TextInput } from 'react-native';

/**
 * No-op: si el input aún no montó o falla la medición (measureLayout no
 * lanza — solo no llama al callback de éxito), no hay nada que hacer.
 */
const onMeasureFail = () => {};

export function scrollToFocusedInput(
  scrollViewRef: RefObject<ScrollView | null> | null,
  inputRef: RefObject<TextInput | null>,
  /** Aire extra arriba del campo para que no quede pegado al borde del teclado/viewport. */
  extraOffset = 24
) {
  const scrollView = scrollViewRef?.current;
  const input = inputRef.current;
  if (!scrollView || !input) return;

  input.measureLayout(
    // Pasar el ref del ScrollView directo — NO `getInnerViewNode()`, obsoleto
    // y pensado para la arquitectura vieja. El cast es solo de tipos: los
    // `.d.ts` de RN todavía piden `ReactNativeElement` (el tipo interno de
    // Fabric) para este parámetro, pero la firma pública documentada acepta
    // el ref de cualquier componente nativo — `ScrollView` lo es. Ver
    // facebook/react#15126 (measureLayout pasó a aceptar un ref, no un handle).
    scrollView as unknown as Parameters<TextInput['measureLayout']>[0],
    (_left: number, top: number) => {
      scrollView.scrollTo({ y: Math.max(top - extraOffset, 0), animated: true });
    },
    onMeasureFail
  );
}
