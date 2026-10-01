import { IconShield } from '../componentes/Iconos.tsx';

/**
 * La cuenta ya tiene contraseña y TOTP, pero `private.admins.activado_at` sigue
 * en NULL: hasta que el admin técnico confirme por otro canal que fuiste tú y
 * corra `scripts/crear-admin.mjs activar`, la base no te deja ver nada.
 */
export function EsperaActivacion({ onReintentar }: { onReintentar: () => void }) {
  return (
    <div className="acceso">
      <div className="auth-card">
        <div className="auth-logo recuperacion"><IconShield clase="icono-blanco" /></div>
        <h1 className="auth-headline">Casi listo</h1>
        <div className="auth-sub">Tu cuenta y tu app autenticadora quedaron configuradas. El admin técnico te contactará para confirmar que fuiste tú y activar tu acceso.</div>
        <button className="btn ghost-btn ancho" onClick={onReintentar}>Ya me confirmaron</button>
      </div>
    </div>
  );
}
