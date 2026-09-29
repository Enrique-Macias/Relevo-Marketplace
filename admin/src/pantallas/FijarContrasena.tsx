import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD, supabase } from '../lib/supabase.ts';

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
    if (password !== confirmacion) { setError('Las contraseñas no coinciden.'); return; }
    setEnviando(true);
    const { error: errV } = await supabase.auth.verifyOtp({
      type: 'recovery', email: correo.trim().toLowerCase(), token: codigo.trim(),
    });
    if (errV) { setEnviando(false); setError('El código no es válido o ya venció.'); return; }
    const { error: errU } = await supabase.auth.updateUser({ password });
    setEnviando(false);
    if (errU) { setError(errU.message); return; }
    onListo();
  };

  return paso === 'correo' ? (
    <form className="tarjeta auth" onSubmit={pedirCodigo}>
      <h1>Fijar contraseña</h1>
      <p className="sub">Te enviaremos un código a tu correo @rlvo.com.mx.</p>
      <label htmlFor="correo">Correo</label>
      <input id="correo" type="email" autoComplete="username" value={correo}
        onChange={(e) => setCorreo(e.target.value)} required />
      {error && <div className="notice">{error}</div>}
      <div className="fila">
        <button className="primario" type="submit" disabled={enviando}>Enviar código</button>
        <button className="enlace" type="button" onClick={onVolver}>Volver</button>
      </div>
    </form>
  ) : (
    <form className="tarjeta auth" onSubmit={fijar}>
      <h1>Nueva contraseña</h1>
      {aviso && <div className="notice info">{aviso}</div>}
      <label htmlFor="codigo">Código</label>
      <input id="codigo" inputMode="numeric" autoComplete="one-time-code" value={codigo}
        onChange={(e) => setCodigo(e.target.value)} required />
      <label htmlFor="password">Contraseña nueva</label>
      <input id="password" type="password" autoComplete="new-password" value={password}
        onChange={(e) => setPassword(e.target.value)} required />
      <label htmlFor="confirmacion">Repite la contraseña</label>
      <input id="confirmacion" type="password" autoComplete="new-password" value={confirmacion}
        onChange={(e) => setConfirmacion(e.target.value)} required />
      {error && <div className="notice">{error}</div>}
      <div className="fila">
        <button className="primario" type="submit" disabled={enviando}>Guardar contraseña</button>
        <button className="enlace" type="button" onClick={onVolver}>Volver</button>
      </div>
    </form>
  );
}
