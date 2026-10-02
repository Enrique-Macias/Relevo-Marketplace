import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';

export function Login({ onFijar }: { onFijar: () => void }) {
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const entrar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email: correo.trim(), password });
    setEnviando(false);
    // Mensaje único a propósito: no confirmar si el correo existe.
    if (err) setError('Correo o contraseña incorrectos.');
  };

  return (
    <div className="acceso">
      <form className="auth-card" onSubmit={entrar}>
        <div className="auth-logo"><span>R</span></div>
        <h1 className="auth-headline">Iniciar sesión</h1>
        <div className="auth-sub">Entra con tu cuenta de administrador. Después te pediremos el código de tu app autenticadora.</div>
        <div className="field">
          <label className="field-label" htmlFor="correo">Correo</label>
          <input id="correo" className="text-field" type="email" autoComplete="username" value={correo}
            onChange={(e) => setCorreo(e.target.value)} required />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="password">Contraseña</label>
          <input id="password" className={`text-field${error ? ' is-invalid' : ''}`} type="password"
            autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <div className="field-error">{error}</div>}
        </div>
        <button className="btn primary-btn ancho" type="submit" disabled={enviando}>Entrar</button>
        <div className="auth-link">
          <button className="enlace" type="button" onClick={onFijar}><b>Primera vez u olvidé mi contraseña</b></button>
        </div>
      </form>
    </div>
  );
}
