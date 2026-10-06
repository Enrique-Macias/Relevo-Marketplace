---
paths:
  - "admin/**"
  - "scripts/crear-admin.mjs"
  - "scripts/probe-admin.mjs"
---

# Panel de administración (RF-17)

Las reglas del panel viven en `admin/CLAUDE.md` y el plan en
`docs/rf17-plan-admin.md`. `admin/` no está bajo las reglas 1-4 ni 6 de §0 del
`CLAUDE.md` raíz (D1). Esta regla existe para que ese aviso cargue también al
tocar los dos scripts del panel, que viven fuera de `admin/`.

Lo imprescindible antes de tocar nada:
- Toda autorización está en la base (`admin.*` + `private.exigir_admin()`);
  la secret key nunca llega al navegador.
- Solo `no_admin`, `mfa_requerido` y `totp_vencido` cambian la sesión
  (`admin/src/lib/rechazos.ts`); cualquier otro rechazo solo se muestra.
- Las cuentas de admin se crean con `scripts/crear-admin.mjs` por
  `admin/users` y se activan en dos pasos; `inviteUserByEmail` pasa por el Auth
  Hook y rechaza `@rlvo.com.mx` (medido). El correo es `@rlvo.com.mx` por
  defecto; uno externo exige `--correo-externo` y el preflight rechaza dominios
  de `universidad_dominios` y cuentas ya existentes.
- El `DETAIL` de un rechazo de CHECK de `admin_acciones` imprime la fila con
  el `motivo`: no se pega en chats ni en tickets.
