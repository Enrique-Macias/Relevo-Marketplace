/**
 * Relevo — configuración de la Edge Function de moderación (RF-18).
 *
 * LOS DOS SECRETOS VAN POR `supabase secrets set` + `Deno.env.get`, NO POR
 * VAULT — ver CLAUDE.md §3 (bloque RF-18) y el plan de implementación. Vault
 * existe en este repo porque el lector de los secretos de push es plpgsql
 * (`private.notify_push()`, sin entorno de proceso del que leer). Aquí el
 * lector es el worker de Deno, que sí lo tiene — meterlos en Vault obligaría
 * a un roundtrip a la base para leer un secreto que la base no usa, y a abrir
 * lectura sobre `vault.decrypted_secrets` que `rls.sql:2189-2192` hoy prohíbe.
 *
 * SON EL PRIMER `Deno.env.get()` Y EL PRIMER `supabase secrets set` DEL REPO.
 * `send-push` —la única Edge Function que existía antes de RF-18— no lee ni
 * un env var propio: su cliente admin le llega armado por `ctx.supabaseAdmin`,
 * inyectado por `withSupabase`. No hay precedente que copiar (verificado con
 * grep sobre `supabase/functions/send-push/index.ts`: cero `Deno.env`).
 *
 * ESTE ARCHIVO ES DENO-ONLY, y por eso vive separado de `decision.ts` y
 * `palabras-prohibidas.ts` en vez de sumarse a ellos: usa el global `Deno`,
 * así que `scripts/probe-moderacion.mjs` NO PUEDE importarlo — Node no tiene
 * ese global, y no hay manera de correrlo con el mismo truco de "importa la
 * implementación real" que sí funciona con los otros dos módulos puros. La
 * cobertura real de este archivo espera a que exista `deno` en la máquina y
 * `index.ts` lo importe: hoy ni lo uno ni lo otro existe (confirmado: `deno`
 * no está instalado en este host ni en el contenedor del edge runtime local).
 */

export type ConfigModeracion = {
  googleCloudVisionApiKey: string;
  openaiApiKey: string;
};

/**
 * Los dos nombres, decididos aquí y no en el comando de `secrets set` —
 * el comando solo puede citarlos correctamente si el código ya los define,
 * nunca al revés.
 *
 *  · `GOOGLE_CLOUD_VISION_API_KEY`: sin precedente que obligue a este nombre
 *    —Vision no tiene una convención de env var tan fija como la de abajo—,
 *    así que se elige explícito y sin abreviar ("VISION" a secas sería
 *    ambiguo en un repo que también tiene visores de foto).
 *  · `OPENAI_API_KEY`: este SÍ tiene una razón técnica, no solo de estilo —
 *    es el nombre que el SDK oficial de OpenAI lee por convención si no se le
 *    pasa `apiKey` explícito al construir el cliente. Usarlo tal cual permite
 *    instanciar el cliente sin cablear el nombre a mano si `index.ts` termina
 *    usando ese SDK en vez de `fetch` crudo contra la API de OpenAI.
 */
const NOMBRES = {
  googleCloudVisionApiKey: 'GOOGLE_CLOUD_VISION_API_KEY',
  openaiApiKey: 'OPENAI_API_KEY',
} as const;

/**
 * Falla RUIDOSAMENTE si falta un secreto, y falla al ARRANCAR la función —no
 * a media petición—, con los DOS nombres faltantes en el mismo mensaje si
 * faltan los dos. Es el mismo criterio que el repo ya aplica en todos lados
 * para lo que no debe fallar en silencio (CLAUDE.md §9): mejor un error
 * inmediato y legible en los logs de arranque que una función que sirve
 * requests, revienta a mitad de moderar una publicación real, y deja un stack
 * trace que no dice cuál de los dos secretos faltaba.
 */
export function resolverConfig(): ConfigModeracion {
  const googleCloudVisionApiKey = Deno.env.get(NOMBRES.googleCloudVisionApiKey);
  const openaiApiKey = Deno.env.get(NOMBRES.openaiApiKey);

  // Va como dos `if` y no como un `.filter()` sobre un arreglo de
  // `false | string`: aquella forma no typechea —el predicado `n is string` no
  // es asignable al tipo del parámetro, porque `false` no es un string— y el
  // error pasó inadvertido porque esta carpeta no la mira ningún compilador
  // (`tsconfig.json` la excluye; ver `notificaciones-push.md`). `npm run
  // check:functions` existe justamente por eso.
  const faltantes: string[] = [];
  if (!googleCloudVisionApiKey) faltantes.push(NOMBRES.googleCloudVisionApiKey);
  if (!openaiApiKey) faltantes.push(NOMBRES.openaiApiKey);

  if (faltantes.length > 0) {
    throw new Error(
      `moderar-contenido: falta${faltantes.length > 1 ? 'n' : ''} el secreto${
        faltantes.length > 1 ? 's' : ''
      } ${faltantes.join(', ')}. Corre: supabase secrets set ${faltantes
        .map((n) => `${n}=...`)
        .join(' ')}`
    );
  }

  return { googleCloudVisionApiKey: googleCloudVisionApiKey!, openaiApiKey: openaiApiKey! };
}
