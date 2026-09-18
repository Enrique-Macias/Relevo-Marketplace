// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // `supabase/functions` es código Deno con specifiers `npm:` (a veces
    // pineados, `npm:paquete@1.2.3`). `eslint-import-resolver-typescript`
    // —el resolver que trae `eslint-config-expo`— no sabe qué hacer con ese
    // esquema y reporta `import/no-unresolved`, siempre, sobre un import que
    // SÍ resuelve en runtime (lo resuelve Deno, no Node). Es un falso
    // positivo estructural, no un import roto: medido contra
    // `supabase/functions/send-push/index.ts`, que ya tenía este mismo error
    // antes de que existiera esta carpeta de reglas — nadie lo había visto
    // porque `npm run lint` (alias de `expo lint`) por default solo escanea
    // `/src`, `/app`, `/components` (ver su `--help`), así que esta carpeta
    // nunca pasaba por ESLint. `npm run lint` ahora la incluye explícito
    // (`package.json`), y este override es lo que hace que incluirla no
    // llene la salida de ruido por algo que no se puede arreglar del lado
    // del import.
    //
    // SE IGNORA SOLO EL PATRÓN `^npm:`, no la regla entera — es `ignore`, una
    // opción de `no-unresolved` heredada de `eslint-module-utils/moduleVisitor`
    // (no está en el schema propio de la regla, pero sí lo acepta en runtime).
    // La primera versión de este override apagaba la regla completa para
    // `supabase/functions/**/*.ts`, y un control negativo la delató: un import
    // relativo roto de verdad (`./archivo-que-no-existe.ts`) dejaba de
    // reportarse ahí. Con `ignore: ['^npm:']`, ese mismo control SÍ se sigue
    // cazando (medido) — la regla queda viva para todo lo demás en esta
    // carpeta, incluidos los imports entre `decision.ts`/`env.ts`/`index.ts`.
    files: ["supabase/functions/**/*.ts"],
    rules: {
      "import/no-unresolved": ["error", { ignore: ["^npm:"] }],
    },
  },
]);
