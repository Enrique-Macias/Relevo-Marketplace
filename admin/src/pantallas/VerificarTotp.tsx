import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';

/**
 * Pide el código de la app autenticadora. Como pantalla (aal1, o TOTP de hace
 * más de 12 h) y como modal (el panel recibió `mfa_requerido`/`totp_vencido`
 * a media acción: al confirmar, la acción se reintenta). Re-verificar RENUEVA
 * el timestamp del `totp` en `amr` (medido, probe-admin.mjs caso 3), que es
 * lo que reabre la ventana de 12 h de `is_admin()`.
 */
export function VerificarTotp({ onListo, onCancelar, enModal }: {
  onListo: () => void; onCancelar?: () => void; enModal?: boolean;
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

  return (
    <form className={enModal ? '' : 'tarjeta auth'} onSubmit={verificar}>
      <h2>Código de verificación</h2>
      <p className="sub">Escribe el código de 6 dígitos de tu app autenticadora.</p>
      <label htmlFor="totp">Código</label>
      <input id="totp" inputMode="numeric" autoComplete="one-time-code" value={codigo}
        onChange={(e) => setCodigo(e.target.value)} required autoFocus />
      {error && <div className="notice">{error}</div>}
      <div className="fila">
        <button className="primario" type="submit" disabled={enviando}>Confirmar</button>
        {onCancelar && <button className="secundario" type="button" onClick={onCancelar}>Cancelar</button>}
      </div>
    </form>
  );
}
