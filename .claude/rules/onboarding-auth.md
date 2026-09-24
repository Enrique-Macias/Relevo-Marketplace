---
paths:
  - "src/app/(onboarding)/**"
  - "src/lib/session.tsx"
  - "src/lib/supabase.ts"
  - "src/lib/onboarding-flag.ts"
  - "src/components/OtpInput.tsx"
  - "supabase/templates/**"
  - "src/lib/registro.ts"
  - "scripts/probe-registro.mjs"
---

# Onboarding y autenticación (RF-01, RF-02, RF-04)

> Movido verbatim desde `CLAUDE.md` (§8 / §8b). Esta regla carga sola cuando la
> sesión lee alguno de los archivos de `paths:`. Las reglas transversales —
> tokens de diseño (§2), esquema y RLS (§3), inventario de pantallas (§4) y los
> gotchas de infraestructura (§9) — siguen en `CLAUDE.md`, que carga siempre.

**Onboarding — construido y conectado a Supabase real.** Las 13 pantallas
existen como código, con auth gating real (ver más abajo en este archivo). **"Permiso de
notificaciones" ya pide el permiso REAL** y registra el token (RF-16): el botón
llama a `registrarPushToken()` y entra al Feed pase lo que pase, incluso si el
usuario dice que no — es el último paso del onboarding y atorarlo ahí sería
absurdo. Sin conectar todavía, fuera de alcance por decisión explícita: la subida
de la foto de perfil —que dejó de ser "pendiente del onboarding" y pasó a deuda con
disparador en `cuenta-perfil.md`, porque "Editar perfil" dibuja el mismo círculo inerte y lo que
falta es un bucket, no el picker—, íconos nativos de los 4 triggers de `NativeTabs`
(siguen siendo solo texto).

**RF-04 completo: "Recuperar contraseña" por OTP, no por enlace.** Eran 13
pantallas y son 15: `recuperar-codigo.tsx` y `nueva-password.tsx` se suman a
`recuperar-password.tsx`, que era la única pantalla MUERTA del grupo (su botón
hacía `router.back()` y no llamaba a Supabase). **Sin migración y sin tocar
`rls.sql`**: las tres llamadas van a GoTrue, que escribe en `auth.users`, no en
`public.users` — ni RLS ni grants de columna participan, y el único trigger que
este repo cuelga de ahí es `after insert` (`20260906000438:42`), que un cambio de
contraseña no dispara. Seis cosas que no se ven en el diff:

- **Va por OTP y no por enlace para NO depender de deep linking**, que sigue sin
  montarse (es la misma carencia de la deuda de Compartir en `compartir-deeplinks.md`: dominio propio +
  `apple-app-site-association`/`assetlinks.json` + página de respaldo). Un código
  que se teclea no necesita nada de eso. El frame decía "Te enviaremos un enlace" y
  se corrigió a "un código de 6 dígitos" — copy persistente, así que el HTML fue
  primero (§0 regla 4).
- **`verifyOtp({type:'recovery'})` SÍ emite `PASSWORD_RECOVERY` en nuestra versión**
  (auth-js 2.115.0, `GoTrueClient.js:2063`) — el bug reportado en otras versiones no
  nos toca. Lo que importa está una línea arriba (`:2062`, `_saveSession`): **la
  sesión es real y completa**, indistinguible de la de un login. El nombre del
  evento es lo único que las separa, y `SessionProvider` lo descarta (`session.tsx:118`,
  el `_evento` con guion bajo).
- **Por eso las dos pantallas nuevas NO llaman a `useRedirectSiPerfilCompleto()`**,
  al revés que `codigo.tsx`/`verificacion.tsx`/`iniciar-sesion.tsx`. Con ese guard,
  el usuario saldría disparado al Feed en el instante en que el código se verifica,
  sin llegar nunca a cambiar su contraseña. Es el error natural al copiar el patrón
  de la pantalla hermana, y por eso está comentado en el archivo.
- **No se tocó `SessionProvider` ni el gating**, y la alternativa —un flag
  `recoveryPendiente`— se descartó con un argumento y no por gusto: el único caso
  que resolvería es el force-quit a media recuperación, y un flag en memoria muere
  en ese mismo force-quit. Ver la deuda al final de este archivo.
- **El correo viaja por param de ruta, NO por `usePerfilDraft()`.** Ese borrador es
  el del ALTA y su campo `correo` lo escriben "Verificación"/"Código"; compartirlo
  dejaría a los dos flujos peleándose por el mismo campo si alguien empieza un alta,
  vuelve atrás y entra a recuperar.
- **Al final se cierra sesión y se vuelve a "Iniciar sesión"**, aunque la sesión de
  recuperación sirva para entrar. Obliga a estrenar la contraseña nueva, o sea que
  el usuario COMPRUEBA que funciona antes de salir del flujo. El `.auth-link` de
  "Volver a iniciar sesión" del frame hace lo mismo, y **tiene que cerrar sesión
  para funcionar**: `iniciar-sesion.tsx:19` llama al guard, así que con la sesión
  viva rebotaría al Feed en vez de mostrar el formulario.

Componentes nuevos: **`OtpInput`** (`src/components/OtpInput.tsx`), extraído de
`codigo.tsx` — puramente presentacional, no sabe de `verifyOtp` ni de
`signInWithOtp`, así que la lógica de alta se quedó intacta donde estaba. Exporta
también `OTP_LENGTH`. Y dos constantes que dejaron de estar duplicadas antes de
poder duplicarse: `CORREO_RE` (de `verificacion.tsx`) y `MIN_PASSWORD` (de
`completar-perfil.tsx`), esta última ahora emparejada con el servidor — ver §9.

**Registro restringido a dominios institucionales, fase 1 (candado + mensaje) —
EN PRODUCCIÓN desde el 2026-09-23.** El alta solo admite correos de dominios
dados de alta en `universidad_dominios` (hoy en remoto: `tec.mx` y
`exatec.tec.mx`), y el candado es el Auth Hook "Before User Created" de GoTrue
(CLAUDE.md §3, el bloque del hook, con todo lo medido; la evidencia de
producción está en §8, "Hecho"). Del lado de la app:

- **Flujo:** `verificacion.tsx` sigue llamando a `signInWithOtp({ shouldCreateUser:
  true })` sin cambios. Si el dominio no está dado de alta, GoTrue responde `403`
  con `msg: "dominio_no_participante"`: no crea la cuenta ni manda el correo, y
  el usuario se queda en Verificación.
- **Mensaje:** `esDominioNoParticipante(e)` (`src/lib/registro.ts`) reconoce ese
  rechazo por `status === 403` **y** `message`. El `error_code` que manda GoTrue
  es `unknown`, así que no sirve para distinguirlo. Con eso se pinta el
  `Notice` del frame "Verificación (correo no participante)" entre el campo y
  el botón: *"Ese correo no pertenece a una universidad participante. Usa el
  correo que te dio tu universidad."* Cualquier otro error sigue saliendo como
  antes, en texto bajo el botón. El aviso se borra en cuanto el usuario edita
  el correo, porque habla del correo que se mandó.
- **El cliente solo traduce.** No hay lista de dominios en la app, ni hace falta:
  la pantalla corre sin sesión, `anon` no tiene grants y la tabla no es legible
  por nadie más que `supabase_auth_admin`. Un dominio nuevo se da de alta en
  Studio y funciona sin publicar otra versión de la app.
- **No afecta a quien ya tiene cuenta.** Login, recuperación de contraseña y el
  "Reenviar" de `codigo.tsx` (sobre una cuenta ya creada) no pasan por el hook:
  medido en `probe-registro.mjs` casos 5 y 6. Las cuentas gmail/hotmail que ya
  existen en remoto siguen entrando.
- **`src/lib/registro.ts` no tiene imports a propósito**: `probe-registro.mjs` lo
  carga desde Node y compara `DOMINIO_NO_PARTICIPANTE` contra la respuesta real
  de GoTrue. Si el string cambia en la función SQL sin cambiar aquí, el aviso
  deja de salir y el usuario ve el código crudo. El probe lo caza.
- **Fase 2 cerrada por la 2A (abajo):** la universidad ya no se elige, la
  asigna el servidor desde el mismo dominio que admite el hook.

**Fase 2A — la universidad sale del dominio del correo (`20260924000466`).**
El detalle de base (trigger, grants, FKs compuestas y el check) está en
CLAUDE.md §3; aquí va lo que toca el flujo:

- **"Selector de universidad" ya no existe** (ni el archivo ni el frame). El
  trigger de alta (`private.handle_new_user()`) crea el perfil con la
  universidad del dominio, así que al llegar a "Completar perfil" ya está
  puesta. La pantalla la muestra con `FixedField` (sin chevron: no abre nada),
  la lee con `fetchUniversidad()` (`src/lib/catalogos.ts`, porque la sesión solo
  trae el id) y el UPDATE manda solo `nombre, campus_id`. Mandar
  `universidad_id` ahora da 42501.
- **El borrador de `(onboarding)/_layout.tsx` perdió `universidad`**, y con él
  la línea que limpiaba el campus al cambiarla: la universidad ya no cambia, y
  la coherencia campus ↔ universidad la garantiza la base.
- **El gating es `nombre && campus_id`** (`session.tsx`), no `nombre &&
  universidad_id`. Como la universidad llega desde el alta, había dejado de
  significar "completó el perfil". El campus implica universidad porque la base
  no admite campus sin ella.
- **Variante "sin universidad asignada"** (frame "Completar perfil"). La ve solo
  una cuenta creada por llave secreta con un dominio no registrado: el admin API
  no pasa por el hook, así que el trigger la deja en NULL (medido,
  `probe-registro.mjs` caso 8). Sin universidad no hay campus que elegir ni se
  puede publicar, y el gating la devolvería aquí para siempre. Por eso lleva un
  `.notice` y "Usar otro correo", que hace `signOut()` de `useSession` (por el
  orden del push token) y vuelve a Verificación. `sinUniversidad` mira
  `profile !== null` para no confundir "todavía no carga" con "no tiene".
- **Las cuentas que ya existían no cambian**: conservan su universidad (en
  remoto, las 5 sin dominio registrado tienen la 1) y no pueden cambiarla.

**Nombre válido en "Completar perfil" (`20260927000469`, check
`users_nombre_valido`).** El mecanismo y el porqué de la clase de letras
explícita viven en CLAUDE.md §3. Lo de esta pantalla:

- `puedeGuardar` pide `nombreValido(nombre)` en vez de `trim().length > 0`, y el
  UPDATE manda `normalizarNombre(nombre)` (NFC, trim, espacios colapsados), no
  `nombre.trim()`. Los dos salen de `src/lib/validacion-perfil.ts`.
- La variante "nombre no válido" del frame es el `error` de `Field`: solo con
  algo escrito, y sobre el valor normalizado, así que un espacio final al
  teclear no la dispara. Copy: `COPY_NOMBRE_INVALIDO`, espejo del frame.
- **Efecto conocido y aceptado:** al teclear la PRIMERA letra el error aparece
  (1 carácter < 2) y se va con la segunda. Es lo que dice el frame aprobado
  ("con el campo no vacío"); si molesta en dispositivo, el cambio es de frame.
- **Pruebas manuales que tocan a mano:** "José Ñúñez" guarda; "Juan123" pinta el
  error y deja "Continuar" apagado; "  Ana   Luz  " guarda como "Ana Luz"
  (verificar en Studio).

- **Auth gating cableado end-to-end y confirmado con una cuenta real de Tec
  de Monterrey**: `SessionProvider` (`src/lib/session.tsx`) escucha
  `onAuthStateChange` y lee el perfil de `public.users`; el splash decide
  entre carrusel / login / completar perfil / Feed; `(tabs)/_layout.tsx`
  impide entrar al Feed con el perfil a medias. Registro passwordless por
  OTP, contraseña fijada en "Completar perfil". Probado de punta a punta:
  correo institucional real → código de 6 dígitos → perfil → cerrar sesión →
  volver a entrar con `signInWithPassword`.
  - **Ojo con `onAuthStateChange`**: su callback es síncrono a propósito.
    Cualquier llamada async ahí dentro provoca un deadlock conocido de
    supabase-js que cuelga la siguiente llamada del cliente. La lectura del
    perfil vive en un efecto aparte, fuera del lock.
  - **Nunca `select('*')` sobre `public.users`**: `correo` está fuera del
    grant de select, y pedir `*` hace fallar la query entera con `42501` en
    vez de devolverla sin esa columna. Lista las columnas.
- **Plantilla de correo OTP aplicada y confirmada funcional** en el dashboard
  remoto (Auth → Email Templates → Magic Link, con `{{ .Token }}`) y
  versionada en `supabase/templates/magic_link.html` para que `supabase
  start` local también la use. Ver la nota de SMTP/cuarentena en sección 1.

- **Una recuperación de contraseña abandonada a media deja la sesión abierta con
  la contraseña VIEJA.** `verifyOtp({type:'recovery'})` guarda una sesión real
  (en este archivo, RF-04), así que quien verifica el código y mata la app antes de guardar la
  contraseña nueva reabre la app **dentro del Feed**, sin haber cambiado nada. No
  es un hueco de seguridad —probó que controla ese correo, que es justo lo que
  prueba un login— pero el reset quedó a medias y no hay pantalla de "cambiar
  contraseña" en Perfil, así que la salida es cerrar sesión y repetir el flujo.
  **El abandono DELIBERADO ya está cubierto**: tanto "Guardar contraseña" como el
  "Volver a iniciar sesión" del frame cierran sesión, así que lo único que queda
  abierto es el force-quit. **Por qué no se cerró:** lo obvio sería un flag
  `recoveryPendiente` en `SessionProvider`, y no sirve — el único caso que
  resolvería es precisamente el force-quit, y un flag en memoria muere en él.
  Persistirlo junto a la sesión es meter estado nuevo en el gating por un caso
  raro. **Revisar cuando:** alguien reporte haber quedado dentro de la app sin
  haber cambiado su contraseña. **Fix:** persistir la marca de recuperación en el
  mismo storage que la sesión y que `splash.tsx` la lea, o un `signOut()` al montar
  `nueva-password` cuando no se llegó por el flujo.

- **La universidad se fija en el ALTA: cambiar el correo de una cuenta no la
  re-deriva.** `private.handle_new_user()` es `after insert` sobre `auth.users`,
  y un cambio de correo es un UPDATE. Hoy la app no ofrece cambiar el correo, así
  que el caso solo existe desde Studio/admin API. Si pasara, la cuenta quedaría
  con la universidad de su correo anterior. **Revisar cuando:** la app ofrezca
  cambiar el correo, o se mueva una cuenta de universidad desde Studio.
  **Fix:** un trigger `after update of email` que re-derive, sabiendo que mover
  de universidad a un usuario CON publicaciones aborta por diseño
  (`listings_campus_universidad_fkey`, T28 (d6)). Habría que decidir antes qué
  pasa con ellas.
