import { useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { motivoValido } from '../lib/formato.ts';
import type { CategoriaAdmin } from '../lib/tipos.ts';
import { Aviso, CampoMotivo, Puntos } from './Basicos.tsx';
import { IconBan, IconCheckColor } from './Iconos.tsx';

/**
 * Frame "Desactivar o reactivar categoría (modal)" (`20261025000489`,
 * `admin.desactivar_categoria` / `admin.reactivar_categoria`). Desactivar no
 * toca publicaciones ni intereses: solo impide ELEGIRLA (lo hace cumplir un
 * trigger de la base, no la app).
 */
export function ModalEstadoCategoria({ categoria, onCerrar, onHecho }: {
  categoria: CategoriaAdmin; onCerrar: () => void; onHecho: () => void;
}) {
  const llamar = useLlamar();
  const desactivar = categoria.activa;
  const [motivo, setMotivo] = useState('');
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmar = async () => {
    setTocado(true);
    if (!motivoValido(motivo)) return;
    setEnviando(true);
    setError(null);
    const r = await llamar(() => supabase.rpc(desactivar ? 'desactivar_categoria' : 'reactivar_categoria',
      { p_id: categoria.id, p_motivo: motivo.trim() }));
    setEnviando(false);
    if (r.ok) { onHecho(); return; }
    if (r.error) setError(textoDeRechazo(r.error, 'categoria'));
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-estado-categoria-titulo">
      <div className="modal-card">
        <div className={`modal-icon${desactivar ? '' : ' ok'}`}>{desactivar ? <IconBan /> : <IconCheckColor />}</div>
        <div className="modal-title" id="modal-estado-categoria-titulo">
          {desactivar ? `¿Desactivar ${categoria.nombre}?` : `¿Reactivar ${categoria.nombre}?`}
        </div>
        <div className="modal-sub">
          {desactivar
            ? `Ya no se podrá elegir al publicar, al filtrar ni en intereses. ${conservan(categoria)}`
            : 'Se podrá volver a elegir en la app, en el mismo lugar del orden.'}
        </div>
        <CampoMotivo id="motivo-estado-categoria" valor={motivo} onCambio={setMotivo}
          placeholder={desactivar ? 'Por qué la desactivas' : 'Por qué la reactivas'}
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

/** «Su publicación existente la conserva, y las 0 personas…», en número. */
function conservan({ publicaciones: p, intereses: i }: CategoriaAdmin): string {
  const pubs = p === 1
    ? 'Su publicación existente la conserva'
    : p === 0 ? 'No tiene publicaciones' : `Sus ${p} publicaciones existentes la conservan`;
  const ints = i === 1
    ? 'la persona que la eligió como interés no pierde nada'
    : `las ${i} personas que la eligieron como interés no pierden nada`;
  return `${pubs}, y ${ints}.`;
}
