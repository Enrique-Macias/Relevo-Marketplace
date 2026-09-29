import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './lib/supabase.ts';
import { Login } from './pantallas/Login.tsx';
import { FijarContrasena } from './pantallas/FijarContrasena.tsx';
import { EnrolarTotp } from './pantallas/EnrolarTotp.tsx';
import { VerificarTotp } from './pantallas/VerificarTotp.tsx';
import { EsperaActivacion } from './pantallas/EsperaActivacion.tsx';
import { Panel } from './pantallas/Panel.tsx';

/**
 * Qué pantalla toca, derivado SIEMPRE del servidor (sesión de Auth, factores y
 * `admin.sesion()`). Esto es gating de UX, no candado: el candado es
 * `private.exigir_admin()` dentro de cada RPC.
 *
 *   sin sesión                      → login (o "fijar contraseña con código")
 *   sin TOTP verificado             → enrolar
 *   aal1                            → verificar TOTP
 *   aal2, cuenta sin activar        → espera de activación (crear-admin.mjs activar)
 *   aal2, TOTP de hace más de 12 h  → verificar TOTP otra vez (D16)
 *   todo lo anterior bien           → panel
 */
type Etapa = 'cargando' | 'login' | 'fijar' | 'enrolar' | 'verificar' | 'espera' | 'panel' | 'error';

export function App() {
  const [etapa, setEtapa] = useState<Etapa>('cargando');
  const [fallo, setFallo] = useState<string | null>(null);
  const [correo, setCorreo] = useState<string>('');
  const modoFijar = useRef(false);
  // El modal de TOTP que pide el panel ante `mfa_requerido`/`totp_vencido`.
  const [pideTotp, setPideTotp] = useState<((ok: boolean) => void) | null>(null);

  const evaluar = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setEtapa(modoFijar.current ? 'fijar' : 'login');
      return;
    }
    setCorreo(session.user.email ?? '');
    const { data: factores, error: errF } = await supabase.auth.mfa.listFactors();
    if (errF) { setFallo(errF.message); setEtapa('error'); return; }
    if (!factores.totp.length) { setEtapa('enrolar'); return; }
    const { data: nivel } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (nivel?.currentLevel !== 'aal2') { setEtapa('verificar'); return; }
    const { data: s, error } = await supabase.rpc('sesion');
    if (error) { setFallo(error.message); setEtapa('error'); return; }
    const ses = s as { admin_activado: boolean; totp_reciente: boolean };
    if (!ses.admin_activado) { setEtapa('espera'); return; }
    if (!ses.totp_reciente) { setEtapa('verificar'); return; }
    setEtapa('panel');
  }, []);

  useEffect(() => {
    // Sin `await` dentro del callback de Auth (puede bloquearse): se difiere.
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      setTimeout(() => { void evaluar(); }, 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [evaluar]);

  const salir = async () => {
    modoFijar.current = false;
    await supabase.auth.signOut();
  };

  const pedirTotp = useCallback(
    () => new Promise<boolean>((resolve) => setPideTotp(() => resolve)),
    [],
  );

  return (
    <>
      <header className="barra">
        <span className="marca">Relevo<small>Panel de administración</small></span>
        {correo && etapa !== 'login' && etapa !== 'fijar' && (
          <span className="fila">
            <span className="sub">{correo}</span>
            <button className="secundario" onClick={salir}>Cerrar sesión</button>
          </span>
        )}
      </header>

      {etapa === 'cargando' && <p className="contenido sub">Cargando…</p>}
      {etapa === 'error' && <div className="contenido"><div className="notice">{fallo}</div></div>}
      {etapa === 'login' && (
        <Login onFijar={() => { modoFijar.current = true; setEtapa('fijar'); }} />
      )}
      {etapa === 'fijar' && (
        <FijarContrasena
          onListo={() => { modoFijar.current = false; void evaluar(); }}
          onVolver={() => { modoFijar.current = false; setEtapa('login'); }}
        />
      )}
      {etapa === 'enrolar' && <EnrolarTotp onListo={() => void evaluar()} />}
      {etapa === 'verificar' && <VerificarTotp onListo={() => void evaluar()} />}
      {etapa === 'espera' && <EsperaActivacion onReintentar={() => void evaluar()} />}
      {etapa === 'panel' && <Panel pedirTotp={pedirTotp} />}

      {pideTotp && (
        <div className="modal-fondo">
          <div className="modal">
            <VerificarTotp
              enModal
              onListo={() => { pideTotp(true); setPideTotp(null); }}
              onCancelar={() => { pideTotp(false); setPideTotp(null); }}
            />
          </div>
        </div>
      )}
    </>
  );
}
