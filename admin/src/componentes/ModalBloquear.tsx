import { useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { motivoValido } from '../lib/formato.ts';
import { Aviso, CampoMotivo, Puntos } from './Basicos.tsx';
import { IconBan } from './Iconos.tsx';

/**
 * Frame "Bloquear publicación (modal)". El copy solo afirma lo que es cierto
 * desde los 4 orígenes (pendiente, activa, pausada, vendida): el dueño recibe
 * UN aviso en la app (`listings_notify_moderacion`, 20260928000473:121-128);
 * no promete push, que puede no salir. "Desde el panel no se puede
 * desbloquear" (D10): el dueño sí la sigue viendo, por eso no dice "visible
 * para todos".
 *
 * Mientras bloquea, Cancelar se deshabilita: cerrar el modal no cancelaría la
 * RPC, solo escondería su resultado (CLAUDE.md §9, el hermano del Redirect).
 */
export function ModalBloquear({ listingId, titulo, onCerrar, onBloqueada }: {
  listingId: number; titulo: string; onCerrar: () => void; onBloqueada: () => void;
}) {
  const llamar = useLlamar();
  const [motivo, setMotivo] = useState('');
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bloquear = async () => {
    setTocado(true);
    if (!motivoValido(motivo)) return;
    setEnviando(true);
    setError(null);
    const r = await llamar(() => supabase.rpc('bloquear_listing', { p_id: listingId, p_motivo: motivo.trim() }));
    setEnviando(false);
    if (r.ok) { onBloqueada(); return; }
    if (r.error) setError(textoDeRechazo(r.error, 'publicacion'));
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-bloquear-titulo">
      <div className="modal-card">
        <div className="modal-icon"><IconBan /></div>
        <div className="modal-title" id="modal-bloquear-titulo">Bloquear publicación</div>
        <div className="modal-sub">
          «{titulo}» deja de aparecer en el catálogo. Desde el panel no se puede desbloquear. El dueño recibirá un aviso en la app.
        </div>
        <CampoMotivo id="motivo-bloqueo" valor={motivo} onCambio={setMotivo}
          placeholder="Por qué bloqueas esta publicación" invalido={tocado && !motivoValido(motivo)} />
        {error && <Aviso>{error}</Aviso>}
        <div className="modal-actions">
          <button type="button" className="btn ghost-btn" disabled={enviando} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn danger-btn" disabled={enviando} onClick={() => void bloquear()}>
            {enviando ? <><Puntos />Bloqueando</> : 'Bloquear'}
          </button>
        </div>
      </div>
    </div>
  );
}
