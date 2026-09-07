import { Redirect } from 'expo-router';

/**
 * Entrada de la app.
 *
 * El redirect al splash se queda a propósito: `index.tsx` no puede desaparecer
 * porque `/` colisiona con `(tabs)/index.tsx`, y sin este archivo la raíz
 * resolvería directo al Feed saltándose el gating por completo.
 *
 * Lo que sí desapareció es la *decisión* fija: antes esto mandaba siempre al
 * carrusel. Ahora el splash decide según sesión, perfil y la bandera del
 * carrusel — ver `(onboarding)/splash.tsx`.
 */
export default function Index() {
  return <Redirect href="/splash" />;
}
