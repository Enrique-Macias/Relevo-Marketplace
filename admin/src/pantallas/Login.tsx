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
    <form className="tarjeta auth" onSubmit={entrar}>
      <h1>Iniciar sesión</h1>
      <label htmlFor="correo">Correo</label>
      <input id="correo" type="email" autoComplete="username" value={correo}
        onChange={(e) => setCorreo(e.target.value)} required />
      <label htmlFor="password">Contraseña</label>
      <input id="password" type="password" autoComplete="current-password" value={password}
        onChange={(e) => setPassword(e.target.value)} required />
      {error && <div className="notice">{error}</div>}
      <div className="fila">
        <button className="primario" type="submit" disabled={enviando}>Entrar</button>
        <button className="enlace" type="button" onClick={onFijar}>
          Primera vez u olvidé mi contraseña
        </button>
      </div>
    </form>
  );
}
