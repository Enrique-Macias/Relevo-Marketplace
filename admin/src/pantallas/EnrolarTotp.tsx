import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';

interface Enrolamiento { id: string; qr: string; secreto: string }

/**
 * Enrolar la app autenticadora. Al terminar la cuenta tiene aal2, pero NO es
 * admin todavía: `scripts/crear-admin.mjs activar` exige exactamente UN factor
 * TOTP verificado y la confirmación por otro canal. Por eso antes de enrolar
 * se borran los factores SIN verificar de intentos anteriores.
 */
export function EnrolarTotp({ onListo }: { onListo: () => void }) {
  const [enr, setEnr] = useState<Enrolamiento | null>(null);
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const iniciado = useRef(false); // StrictMode monta dos veces: un solo enroll.

  useEffect(() => {
    if (iniciado.current) return;
    iniciado.current = true;
    void (async () => {
      const { data: f } = await supabase.auth.mfa.listFactors();
      for (const viejo of f?.all ?? []) {
        if (viejo.factor_type === 'totp' && viejo.status !== 'verified') {
          await supabase.auth.mfa.unenroll({ factorId: viejo.id });
        }
      }
      const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (err) { setError(err.message); return; }
      setEnr({ id: data.id, qr: data.totp.qr_code, secreto: data.totp.secret });
    })();
  }, []);

  const verificar = async (e: FormEvent) => {
    e.preventDefault();
    if (!enr) return;
    setEnviando(true);
    setError(null);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({ factorId: enr.id, code: codigo.trim() });
    setEnviando(false);
    if (err) { setError('El código no es válido. Revisa la hora de tu teléfono e intenta con el siguiente.'); return; }
    onListo();
  };

  return (
    <form className="tarjeta auth" onSubmit={verificar}>
      <h1>App autenticadora</h1>
      <p className="sub">Escanea el código con tu app autenticadora (Google Authenticator, 1Password…) y escribe el código de 6 dígitos que muestra.</p>
      {enr ? (
        <>
          <img className="qr" src={enr.qr} alt="Código QR para la app autenticadora" />
          <p className="sub">¿No puedes escanear? Escribe esta clave: <span className="secreto">{enr.secreto}</span></p>
        </>
      ) : !error && <p className="sub">Generando…</p>}
      <label htmlFor="codigo">Código</label>
      <input id="codigo" inputMode="numeric" autoComplete="one-time-code" value={codigo}
        onChange={(e) => setCodigo(e.target.value)} required />
      {error && <div className="notice">{error}</div>}
      <div className="fila">
        <button className="primario" type="submit" disabled={enviando || !enr}>Confirmar</button>
      </div>
    </form>
  );
}
