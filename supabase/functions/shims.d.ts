// ===========================================================================
// Relevo — shims MÍNIMOS para poder typechear las Edge Functions con `tsc`.
//
// POR QUÉ EXISTE ESTE ARCHIVO. `supabase/functions` es código Deno, así que
// `tsconfig.json` de la raíz la excluye (ver `.claude/rules/notificaciones-push.md`:
// sin el exclude, `npx tsc --noEmit` de la app falla con errores que no son
// errores). La consecuencia, que nadie había medido hasta ahora: esa carpeta no
// la miraba NINGÚN compilador. Se notó al escribir `moderar-contenido/index.ts`
// y correr `tsc` a mano sobre ella por primera vez — apareció un error de tipos
// REAL y preexistente en `env.ts` (un predicado `n is string` no asignable al
// tipo del parámetro), que llevaba ahí desde que se escribió el archivo.
//
// ALCANCE HONESTO — lo que este chequeo SÍ y NO prueba:
//
//  · SÍ: typos, variables inexistentes, formas mal escritas, argumentos que no
//    cuadran con las funciones PROPIAS del repo (`decision.ts`, `env.ts`,
//    `palabras-prohibidas.ts`), y los tipos de la respuesta HTTP.
//  · NO: el contrato de `@supabase/server`. El shim de abajo lo declara sin
//    tipar A PROPÓSITO, y esa es la decisión importante de este archivo.
//
// Por qué sin tipar y no transcribiendo las firmas reales: transcribir tipos de
// un paquete que no está en disco es exactamente el patrón que este repo ya
// documenta como peligroso en `probe-venta.mjs` —dos copias de la misma verdad
// que se desincronizan sin dar ningún error—, y aquí sería peor, porque una
// firma transcrita mal daría luz verde a código roto con toda la apariencia de
// estar verificado. El contrato real se verifica leyendo los `.d.mts`
// publicados (así se resolvió el E-spike de `auth: ['secret','user']`, ver
// `.claude/rules/moderacion.md` §2) y lo hace cumplir Deno al desplegar.
//
// O sea: esto es una red para los errores tontos, no un reemplazo de `deno
// check`. El día que `deno` esté instalado en la máquina, el chequeo correcto
// es ese y este archivo puede irse.
// ===========================================================================

/**
 * El global de Deno, acotado a lo ÚNICO que este repo usa hoy: `Deno.env.get`
 * en `moderar-contenido/env.ts`. No se declara de más — si mañana alguien usa
 * otra cosa de `Deno`, que el chequeo falle y lo obligue a agregarla aquí es
 * mejor que un `declare const Deno: any` que no avise nunca.
 */
declare const Deno: {
  env: {
    get(nombre: string): string | undefined;
  };
};

// Los specifiers `npm:` de Deno. Sin versión (`send-push`) y pineado
// (`moderar-contenido`) son módulos DISTINTOS para TypeScript, así que van los
// dos. Ver `.claude/rules/moderacion.md` sobre el pendiente de pinear el de
// `send-push`.
// La FORMA DE LA LLAMADA sí se declara —es visible en el código de las dos
// funciones, no hay nada que adivinar—, y lo que queda sin tipar es el
// CONTENIDO de `ctx`. Esa es la línea: el chequeo verifica que el handler tiene
// la aridad correcta y devuelve una `Response`, y no finge saber qué trae
// `ctx.supabaseAdmin` ni qué valores admite `auth`. Sin esto, `ctx` quedaba
// implícitamente `any` y `strict` lo reportaba como error en las dos funciones.

/** `ctx` a propósito sin tipar — ver el encabezado de este archivo. */
// deno-lint-ignore no-explicit-any
type CtxSupabase = any;

type HandlerSupabase = (req: Request, ctx: CtxSupabase) => Promise<Response>;

declare module 'npm:@supabase/server' {
  export function withSupabase(
    config: { auth: string | string[] },
    handler: HandlerSupabase
  ): HandlerSupabase;
}

declare module 'npm:@supabase/server@1.7.0' {
  export function withSupabase(
    config: { auth: string | string[] },
    handler: HandlerSupabase
  ): HandlerSupabase;
}
