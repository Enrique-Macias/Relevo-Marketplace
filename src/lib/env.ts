/**
 * Variables de entorno del cliente.
 *
 * Metro solo inyecta variables con prefijo `EXPO_PUBLIC_`, y solo si se leen
 * con notación de punto — `process.env['EXPO_PUBLIC_X']` no se inlinea. De ahí
 * que abajo estén escritas literalmente y no derivadas de un array de nombres.
 *
 * La validación corre al importar el módulo, no en la primera query: si falta
 * una variable queremos que la app truene al arrancar con un mensaje que diga
 * qué hacer, no un 401 opaco tres pantallas después.
 *
 * Los valores reales viven en `.env.local` (fuera de git); `.env.example` es la
 * plantilla commiteada. Tras editar cualquiera de los dos hay que reiniciar el
 * bundler — Fast Refresh no recarga el `.env`.
 */

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. Copia .env.example a .env.local, ` +
        'rellena los valores del proyecto Supabase y reinicia el bundler ' +
        '(`npx expo start --clear`).'
    );
  }
  return value;
}

export const env = {
  supabaseUrl: required(supabaseUrl, 'EXPO_PUBLIC_SUPABASE_URL'),
  supabasePublishableKey: required(
    supabasePublishableKey,
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
  ),
} as const;
