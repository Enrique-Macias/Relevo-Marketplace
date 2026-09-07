import { Redirect } from 'expo-router';

/**
 * Entrada de la app.
 *
 * TODO (auth gating — CLAUDE.md §8, pendiente #1): esto es un redirect fijo al
 * onboarding. Cuando exista el session provider, aquí se decide entre
 * `(onboarding)` y `(tabs)` según haya sesión activa; hoy no puede hacerlo
 * porque `anon` no tiene un solo grant en el proyecto remoto, así que ninguna
 * pantalla autenticada renderizaría nada.
 */
export default function Index() {
  return <Redirect href="/splash" />;
}
