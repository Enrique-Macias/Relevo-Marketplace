import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD, supabase } from '../lib/supabase.ts';
import { Aviso } from '../componentes/Basicos.tsx';
import { IconLock } from '../componentes/Iconos.tsx';

const NO_COINCIDEN = 'Las contraseñas no coinciden.';

/**
 * Primera vez Y "olvidé mi contraseña": el mismo flujo de código tecleado que
 * la app (sin redirect). La cuenta de un admin nace por `admin/users` sin
 * contraseña (`scripts/crear-admin.mjs crear`), así que la primera contraseña
 * también se fija con el código de recuperación. Después se pide el TOTP como
 * siempre: el código solo da aal1 (medido, probe-admin.mjs caso 5).
 */
export function FijarContrasena({ onListo, onVolver }: { onListo: () => void; onVolver: () => void }) {
  const [paso, setPaso] = useState<'correo' | 'codigo'>('correo');
  const [correo, setCorreo] = useState('');
  const [codigo, setCodigo] = useState('');
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const pedirCodigo = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(correo.trim().toLowerCase());
    setEnviando(false);
    if (err) { setError('No pudimos enviar el código. Intenta de nuevo en un momento.'); return; }
    setAviso('Si la cuenta existe, te enviamos un código de 6 dígitos.');
    setPaso('codigo');
  };

  const fijar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) { setError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`); return; }
    if (password !== confirmacion) { setError(NO_COINCIDEN); return; }
    setEnviando(true);
    const { error: errV } = await supabase.auth.verifyOtp({
      type: 'recovery', email: correo.trim().toLowerCase(), token: codigo.trim(),
    });
    if (errV) { setEnviando(false); setError('El código no es válido o ya venció. Pide uno nuevo con «Volver».'); return; }
    const { error: errU } = await supabase.auth.updateUser({ password });
    setEnviando(false);
    if (errU) { setError(errU.message); return; }
    onListo();
  };

  const logo = <div className="auth-logo recuperacion"><IconLock clase="icono-blanco" /></div>;
  return paso === 'correo' ? (
    <div className="acceso">
      <form className="auth-card" onSubmit={pedirCodigo}>
        {logo}
        <h1 className="auth-headline">Fijar contraseña</h1>
        <div className="auth-sub">Te enviaremos un código a tu correo @rlvo.com.mx.</div>
        <div className="field">
          <label className="field-label" htmlFor="correo">Correo</label>
          <input id="correo" className="text-field" type="email" autoComplete="username" value={correo}
            onChange={(e) => setCorreo(e.target.value)} required />
        </div>
        {error && <Aviso>{error}</Aviso>}
        <button className="btn primary-btn ancho" type="submit" disabled={enviando}>Enviar código</button>
        <div className="auth-link"><button className="enlace" type="button" onClick={onVolver}><b>Volver</b></button></div>
      </form>
    </div>
  ) : (
    <div className="acceso">
      <form className="auth-card" onSubmit={fijar}>
        {logo}
        <h1 className="auth-headline">Nueva contraseña</h1>
        {aviso && <Aviso tipo="info">{aviso}</Aviso>}
        <div className="field">
          <label className="field-label" htmlFor="codigo">Código</label>
          <input id="codigo" className="text-field" inputMode="numeric" autoComplete="one-time-code" value={codigo}
            onChange={(e) => setCodigo(e.target.value)} required />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="password">Contraseña nueva</label>
          <input id="password" className="text-field" type="password" autoComplete="new-password" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
          <div className="field-help">Al menos {MIN_PASSWORD} caracteres.</div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="confirmacion">Repite la contraseña</label>
          <input id="confirmacion" className={`text-field${error === NO_COINCIDEN ? ' is-invalid' : ''}`} type="password"
            autoComplete="new-password" value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} required />
          {error === NO_COINCIDEN && <div className="field-error">{NO_COINCIDEN}</div>}
        </div>
        {error && error !== NO_COINCIDEN && <Aviso>{error}</Aviso>}
        <button className="btn primary-btn ancho" type="submit" disabled={enviando}>Guardar contraseña</button>
        <div className="auth-link"><button className="enlace" type="button" onClick={onVolver}><b>Volver</b></button></div>
      </form>
    </div>
  );
}
