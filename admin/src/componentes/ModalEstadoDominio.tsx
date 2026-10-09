import { useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { motivoValido } from '../lib/formato.ts';
import { Aviso, CampoMotivo, Puntos } from './Basicos.tsx';
import { IconBan, IconCheckColor } from './Iconos.tsx';

/**
 * Frame "Desactivar o reactivar dominio (modal)" (Ola 5,
 * `admin.desactivar_dominio` / `admin.reactivar_dominio`). Desactivar solo
 * afecta a las altas NUEVAS: las cuentas existentes conservan su universidad.
 * El aviso de «único dominio activo» es UX; la base lo permite a propósito.
 */
export function ModalEstadoDominio({ dominio, accion, ultimoActivo, onCerrar, onHecho }: {
  dominio: string; accion: 'desactivar' | 'reactivar';
  ultimoActivo: { universidad: string; usuarios: number } | null;
  onCerrar: () => void; onHecho: () => void;
}) {
  const llamar = useLlamar();
  const desactivar = accion === 'desactivar';
  const [motivo, setMotivo] = useState('');
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmar = async () => {
    setTocado(true);
    if (!motivoValido(motivo)) return;
    setEnviando(true);
    setError(null);
    const r = await llamar(() => supabase.rpc(desactivar ? 'desactivar_dominio' : 'reactivar_dominio',
      { p_dominio: dominio, p_motivo: motivo.trim() }));
    setEnviando(false);
    if (r.ok) { onHecho(); return; }
    if (r.error) setError(textoDeRechazo(r.error));
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-estado-dominio-titulo">
      <div className="modal-card">
        <div className={`modal-icon${desactivar ? '' : ' ok'}`}>{desactivar ? <IconBan /> : <IconCheckColor />}</div>
        <div className="modal-title" id="modal-estado-dominio-titulo">
          {desactivar ? `¿Desactivar @${dominio}?` : `¿Reactivar @${dominio}?`}
        </div>
        <div className="modal-sub">
          {desactivar
            ? `Nadie nuevo podrá registrarse con @${dominio}. Las cuentas existentes no cambian: conservan su universidad y siguen entrando.`
            : `Se podrá volver a registrar con @${dominio}.`}
        </div>
        {ultimoActivo && (
          <Aviso>
            Es el <b>único dominio activo</b> de {ultimoActivo.universidad}: nadie nuevo de esta universidad podrá
            registrarse. Sus {ultimoActivo.usuarios} cuentas siguen igual.
          </Aviso>
        )}
        <CampoMotivo id="motivo-estado-dominio" valor={motivo} onCambio={setMotivo}
          placeholder={desactivar ? 'Por qué lo desactivas' : 'Por qué lo reactivas'}
          invalido={tocado && !motivoValido(motivo)} />
        {error && <Aviso>{error}</Aviso>}
        <div className="modal-actions">
          <button type="button" className="btn ghost-btn" disabled={enviando} onClick={onCerrar}>Cancelar</button>
          <button type="button" className={`btn ${desactivar ? 'danger-btn' : 'forest-btn'}`} disabled={enviando}
            onClick={() => void confirmar()}>
            {enviando ? <><Puntos />{desactivar ? 'Desactivando' : 'Reactivando'}</> : desactivar ? 'Desactivar' : 'Reactivar'}
          </button>
        </div>
      </div>
    </div>
  );
}
