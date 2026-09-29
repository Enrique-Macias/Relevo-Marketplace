# Panel de administración (`admin/`) — RF-17

SPA con Vite + React + TS (D2), estática, que habla con Supabase **solo con la
publishable key**. El plan completo es `docs/rf17-plan-admin.md`; el estado por
olas vive en `CLAUDE.md` raíz §8, pendiente 0k. Este archivo carga solo cuando
la sesión toca `admin/`.

## Qué reglas del `CLAUDE.md` raíz NO aplican aquí

`admin/` no está bajo las reglas 1-4 ni 6 de §0 raíz (D1): esas hablan de
`design/relevo-app.html` y de la app móvil. Las del panel son:

1. **Diseño.** La fuente de verdad será `design/admin-panel.html`, a partir de
   la Ola 2: frames primero, aprobación del usuario después y solo entonces el
   código. **La Ola 1 va sin frame** (D14): son pantallas funcionales mínimas
   que la Ola 2 alineará a esos frames. Solo se reusan los TOKENS de color y
   tipografía de §2 raíz (`src/estilos.css`); nada de tamaños ni componentes
   de teléfono.
2. **Autorización, siempre en la base** (§0 regla 7 raíz, esta sí aplica).
   Toda acción es una RPC `security definer` de `admin.*` cuya primera línea es
   `perform private.exigir_admin();`, y toda escritura se audita en
   `private.admin_acciones`. Ningún `if` del panel decide quién puede qué: si
   el panel esconde un botón es UX, no candado.
3. **La secret key nunca llega al navegador.** Lo que de verdad necesite
   `service_role` va en una Edge Function que verifique `is_admin()` del que
   llama (la primera será `admin-reset-mfa`, Ola 3), o en
   `scripts/crear-admin.mjs`, que corre en local con la secret key.

## Identidad y MFA (20260930000477)

- Admin = fila en `private.admins` con `activado_at` puesto. **Revocar a un
  admin es BORRAR su fila**, y surte efecto en la request siguiente (T35 (l)).
- **Suspender NO revoca a un admin**: `is_admin()` no mira `users.estado`
  (decisión E de la Ola 1). Desde el panel no se puede suspender a un admin
  (G4, `objetivo_es_admin`); por Studio sí, y en ese caso otro admin lo puede
  reactivar (`reactivar_usuario` no lleva G4).
- `is_admin()` exige aal2 **y** un TOTP de las últimas 12 h leído de `amr`.
  Medido: un refresh conserva el timestamp del TOTP y re-verificarlo lo
  renueva (`scripts/probe-admin.mjs`, caso 3). Por eso la UI, ante
  `totp_vencido`, pide el código y reintenta.

## Rechazos: solo tres mensajes cambian la sesión

`src/lib/rechazos.ts` (puro, sin imports; lo importa `probe-admin.mjs`):

| Mensaje (42501) | Qué hace el panel |
|---|---|
| `no_admin` | cierra la sesión |
| `mfa_requerido`, `totp_vencido` | abre el modal de TOTP y reintenta UNA vez |
| cualquier otro (incluidos `no_sobre_si_mismo`, `objetivo_es_admin`, un 42501 de RLS) | lo muestra y ya |

Cerrar la sesión por un 42501 de una guarda echaría al admin por un error suyo
de operación. El amarre con la base es el caso 7 de `probe-admin.mjs`.

## Alta de admins: `scripts/crear-admin.mjs` (solo local hasta la Ola 3)

- `crear <correo@rlvo.com.mx> <Nombre>`: **no** usa `inviteUserByEmail`, que
  SÍ pasa por el Auth Hook de dominios (403 `dominio_no_participante`, medido);
  crea por `admin/users`, registra en `private.admins` sin activar y manda el
  código de recuperación. La persona fija su contraseña en "Primera vez u
  olvidé mi contraseña" y enrola su TOTP.
- `activar <correo>`: exige confirmar **por otro canal** y exactamente UN TOTP
  verificado creado después del alta. Audita con el actor centinela
  `00000000-0000-0000-0000-000000000000` y `admin_correo =
  'script:crear-admin.mjs'` (no hay JWT de un admin).
- Nada se interpola: variables de psql (`:'var'`), `execFileSync` sin shell y
  **ningún dollar-quote** en su SQL (psql no sustituye `:'var'` dentro de uno).

## Auditoría: lo que NO se pega en ningún lado

- `antes`/`despues` solo llevan las claves permitidas POR TIPO de objetivo
  (`private.claves_auditoria_ok`, D20): nunca correo, nombre, teléfono, título
  ni comentario.
- El `motivo` es texto libre (3-500 caracteres): el panel pide no escribir
  datos personales, pero la base no lo puede hacer cumplir.
- **El `DETAIL` de un rechazo de cualquier CHECK de `admin_acciones` imprime la
  fila COMPLETA, con el `motivo`, y puede llegar a logs. No lo pegues en chats
  ni en tickets.**

## Desarrollo local

```bash
cd admin && npm install
# admin/.env.local (ignorado por git), con API_URL y PUBLISHABLE_KEY de `supabase status`:
#   VITE_SUPABASE_URL=http://127.0.0.1:54321
#   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
npm run dev            # http://localhost:5173
```

El stack local necesita TOTP encendido y `admin` en `[api] schemas`
(`supabase/config.toml`). **Orden, medido:** si el schema `admin` se expone
ANTES de que exista, PostgREST no carga el schema cache (3F000) y TODO el API
responde 503. En remoto, el Dashboard se toca después del push de
`20260930000477`, nunca antes (Ola 3).

## Verificación

- `npm run check:admin` desde la raíz (typecheck + lint del panel). El
  `tsconfig.json` raíz excluye `admin/`: sin este comando, nadie lo mira.
- `node scripts/probe-admin.mjs` (stack local + Mailpit).
- `supabase/tests/rls.sql`: T12 y T35.
- Tipos: `npm run gen:types` (desde `admin/`) regenera `src/db/admin.types.ts`
  contra el stack local; se commitea.
- ESLint prohíbe `dangerouslySetInnerHTML` y el prop `style` en TSX: la CSP
  del build (`vite.config.ts`) no permite scripts ni estilos inline.
