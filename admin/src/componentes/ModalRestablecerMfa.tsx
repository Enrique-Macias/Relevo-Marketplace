import { useRef, useState } from 'react';
import { FunctionsHttpError, type PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { rechazoDeFuncion } from '../lib/funciones.ts';
import { motivoValido } from '../lib/formato.ts';
import { Aviso, CampoMotivo, Puntos } from './Basicos.tsx';
import { IconLock } from './Iconos.tsx';

/**
 * Frame "Restablecer app autenticadora (modal)" (RF-17, Ola 3b). Llama a la
 * Edge Function `admin-reset-mfa`; quién puede y sobre quién lo deciden las
 * RPC `admin.restablecer_mfa_*` que ella invoca con el JWT de este admin. Este
 * componente no decide nada: si oculta o deshabilita algo es UX.
 *
 * `intentoPendiente`: el id del restablecimiento a medias que mostraba el
 * detalle (variante "restablecimiento pendiente"), o null. Si un 502 de esta
 * misma ventana devuelve el intento, los reintentos lo mandan también: así, si
 * otro admin ya lo cerró, la base responde `ya_completado` en lugar de abrir un
 * intento NUEVO que borraría el TOTP que la persona enroló después.
 *
 * Mientras restablece, Cancelar se deshabilita (cerrar no cancela la llamada,
 * CLAUDE.md §9). Tras un rechazo que cambia el estado (a medias, o la cuenta
 * cambió), `onCambio` recarga el detalle debajo.
 */
export function ModalRestablecerMfa({ userId, nombre, intentoPendiente, onCerrar, onHecho, onCambio }: {
  userId: string; nombre: string; intentoPendiente: number | null;
  onCerrar: () => void; onHecho: () => void; onCambio: () => void;
}) {
  const llamar = useLlamar();
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendiente = useRef<number | null>(intentoPendiente);
  const valido = motivoValido(motivo);
  const invalido = motivo.trim().length > 0 && !valido;

  const invocar = async () => {
    const { error: err } = await supabase.functions.invoke('admin-reset-mfa', {
      body: { user_id: userId, motivo: motivo.trim(), intento_pendiente: pendiente.current },
    });
    if (!err) return { data: true, error: null };
    let status = 0;
    let cuerpo: unknown = null;
    if (err instanceof FunctionsHttpError) {
      const res = err.context as Response;
      status = res.status;
      cuerpo = await res.json().catch(() => null);
    }
    const r = rechazoDeFuncion(status, cuerpo);
    if (r.accion_id) pendiente.current = r.accion_id;
    return { data: null, error: { code: r.code, message: r.message, details: '', hint: '' } as unknown as PostgrestError };
  };

  const restablecer = async () => {
    if (!valido) return;
    setEnviando(true);
    setError(null);
    const r = await llamar(invocar);
    setEnviando(false);
    if (r.ok) { onHecho(); return; }
    if (!r.error) return;
    setError(textoDeRechazo(r.error));
    if (['factores_pendientes', 'cierre_pendiente', 'estado_inesperado', 'objetivo_no_es_admin']
      .includes(r.error.message)) onCambio();
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-mfa-titulo">
      <div className="modal-card">
        <div className="modal-icon"><IconLock /></div>
        <div className="modal-title" id="modal-mfa-titulo">¿Restablecer la app autenticadora de {nombre}?</div>
        <div className="modal-sub">
          Su acceso al panel se desactiva ahora y se elimina la app autenticadora registrada en su cuenta. Para volver a entrar tendrá que registrar una nueva y esperar a que el admin técnico la active.
        </div>
        <CampoMotivo id="motivo-mfa" valor={motivo} onCambio={setMotivo}
          placeholder="Por qué restableces su app autenticadora" invalido={invalido} />
        {error && <Aviso>{error}</Aviso>}
        <div className="modal-actions">
          <button type="button" className="btn ghost-btn" disabled={enviando} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn danger-btn" disabled={!valido || enviando} onClick={() => void restablecer()}>
            {enviando ? <><Puntos />Restableciendo</> : 'Restablecer'}
          </button>
        </div>
      </div>
    </div>
  );
}
