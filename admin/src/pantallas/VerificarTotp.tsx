import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import type { CausaTotp } from '../lib/puerta-totp.ts';
import { Aviso, CampoOtp } from '../componentes/Basicos.tsx';
import { IconLock } from '../componentes/Iconos.tsx';

/**
 * Pide el código de la app autenticadora. Como pantalla (aal1, o TOTP de hace
 * más de 12 h) y como modal (el panel recibió `mfa_requerido`/`totp_vencido`
 * a media acción: al confirmar, la acción se reintenta). Re-verificar RENUEVA
 * el timestamp del `totp` en `amr` (medido, probe-admin.mjs caso 3), que es
 * lo que reabre la ventana de 12 h de `is_admin()`.
 */
export function VerificarTotp({ onListo, onCancelar, enModal, causa = 'totp_vencido' }: {
  onListo: () => void; onCancelar?: () => void; enModal?: boolean; causa?: CausaTotp;
}) {
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const verificar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    const { data: f } = await supabase.auth.mfa.listFactors();
    const factor = f?.totp[0];
    if (!factor) { setEnviando(false); setError('Tu cuenta no tiene una app autenticadora.'); return; }
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: codigo.trim() });
    setEnviando(false);
    if (err) { setError('El código no es válido. Intenta con el siguiente.'); return; }
    setCodigo('');
    onListo();
  };

  if (enModal) {
    return (
      <form onSubmit={verificar}>
        <div className="modal-icon neutro"><IconLock /></div>
        <div className="modal-title" id="modal-totp-titulo">Código de verificación</div>
        <div className="modal-sub">{causa === 'mfa_requerido'
          ? 'Falta confirmar tu código de la app autenticadora.'
          : 'Tu código de la app autenticadora venció. Confírmalo otra vez y seguimos donde estabas.'}</div>
        <CampoOtp id="totp" valor={codigo} onCambio={setCodigo} autoFocus />
        {error && <Aviso>{error}</Aviso>}
        <div className="modal-actions">
          {onCancelar && <button className="btn ghost-btn" type="button" disabled={enviando} onClick={onCancelar}>Cancelar</button>}
          <button className="btn primary-btn" type="submit" disabled={enviando || codigo.length !== 6}>Confirmar</button>
        </div>
      </form>
    );
  }
  return (
    <div className="acceso">
      <form className="auth-card" onSubmit={verificar}>
        <div className="auth-logo"><span>R</span></div>
        <h1 className="auth-headline">Código de verificación</h1>
        <div className="auth-sub">Escribe el código de 6 dígitos de tu app autenticadora.</div>
        <CampoOtp id="totp" valor={codigo} onCambio={setCodigo} autoFocus />
        {error && <Aviso>{error}</Aviso>}
        <button className="btn primary-btn ancho" type="submit" disabled={enviando || codigo.length !== 6}>Confirmar</button>
      </form>
    </div>
  );
}
