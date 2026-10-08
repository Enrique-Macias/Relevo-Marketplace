import { useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { motivoValido } from '../lib/formato.ts';
import { Aviso, CampoMotivo, Puntos } from './Basicos.tsx';
import { IconCheckColor } from './Iconos.tsx';

/**
 * Frame "Aprobar publicación (modal)" (Ola 4, `admin.aprobar_listing`, `…481`).
 * Hermano de `ModalBloquear`, no una variante: otro icono, otro botón y otros
 * rechazos. El motivo es obligatorio (3-500), igual que al bloquear.
 *
 * Los cuatro rechazos del frame (`estado_inesperado`, `dueno_no_activo`,
 * `sin_fotos`, `moderacion_en_curso`) salen de `textoDeRechazo` con sujeto
 * `publicacion`: el panel no los adivina, se los dice la RPC. Que la tarjeta
 * deshabilite el botón con el dueño suspendido o sin fotos es UX; el candado
 * son las guardas de la RPC y el trigger `dueno_no_activo` (`…480`).
 *
 * El dueño recibe UN aviso (`listings_notify_moderacion`, rama `pendiente →
 * activa`, porque `veredicto_en_pantalla` está en false mientras es
 * `pendiente`). Mientras aprueba, Cancelar se deshabilita (CLAUDE.md §9).
 */
export function ModalAprobar({ listingId, titulo, onCerrar, onAprobada }: {
  listingId: number; titulo: string; onCerrar: () => void; onAprobada: () => void;
}) {
  const llamar = useLlamar();
  const [motivo, setMotivo] = useState('');
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aprobar = async () => {
    setTocado(true);
    if (!motivoValido(motivo)) return;
    setEnviando(true);
    setError(null);
    const r = await llamar(() => supabase.rpc('aprobar_listing', { p_id: listingId, p_motivo: motivo.trim() }));
    setEnviando(false);
    if (r.ok) { onAprobada(); return; }
    if (r.error) setError(textoDeRechazo(r.error, 'publicacion'));
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-aprobar-titulo">
      <div className="modal-card">
        <div className="modal-icon ok"><IconCheckColor /></div>
        <div className="modal-title" id="modal-aprobar-titulo">Aprobar publicación</div>
        <div className="modal-sub">
          «{titulo}» pasa a activa y aparece en el catálogo. El dueño recibirá un aviso en la app.
        </div>
        <CampoMotivo id="motivo-aprobar" valor={motivo} onCambio={setMotivo}
          placeholder="Por qué apruebas esta publicación" invalido={tocado && !motivoValido(motivo)} />
        {error && <Aviso>{error}</Aviso>}
        <div className="modal-actions">
          <button type="button" className="btn ghost-btn" disabled={enviando} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn forest-btn" disabled={enviando} onClick={() => void aprobar()}>
            {enviando ? <><Puntos />Aprobando</> : 'Aprobar'}
          </button>
        </div>
      </div>
    </div>
  );
}
