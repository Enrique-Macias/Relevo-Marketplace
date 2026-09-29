/**
 * La cuenta ya tiene contraseña y TOTP, pero `private.admins.activado_at` sigue
 * en NULL: hasta que el admin técnico confirme por otro canal que fuiste tú y
 * corra `scripts/crear-admin.mjs activar`, la base no te deja ver nada.
 */
export function EsperaActivacion({ onReintentar }: { onReintentar: () => void }) {
  return (
    <div className="tarjeta auth">
      <h1>Casi listo</h1>
      <p>Tu cuenta y tu app autenticadora quedaron configuradas.</p>
      <p className="sub">El admin técnico te contactará para confirmar que fuiste tú y activar tu acceso.</p>
      <div className="fila">
        <button className="secundario" onClick={onReintentar}>Ya me confirmaron</button>
      </div>
    </div>
  );
}
