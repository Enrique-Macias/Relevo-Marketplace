import { useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { motivoValido } from '../lib/formato.ts';
import { Aviso, CampoMotivo, Puntos } from './Basicos.tsx';
import { IconBuilding } from './Iconos.tsx';

/** Rechazos que el frame pinta bajo el campo Nombre; el resto va como aviso. */
const DEL_NOMBRE = new Set(['nombre_invalido', 'nombre_duplicado']);

/**
 * Frame "Universidad (modal: agregar o editar)" (Ola 5). Con `universidad`,
 * edita (`admin.editar_universidad`); sin ella, agrega
 * (`admin.crear_universidad`). La normalización (espacios) y la unicidad sin
 * distinguir mayúsculas son de la base: aquí no se valida el nombre, solo se
 * muestra lo que la RPC responde. «Guardar» se puede pulsar sin cambios: lo
 * decide la base (`sin_cambios`).
 */
export function ModalUniversidad({ universidad, onCerrar, onGuardada }: {
  universidad?: { id: number; nombre: string }; onCerrar: () => void; onGuardada: () => void;
}) {
  const llamar = useLlamar();
  const editar = universidad !== undefined;
  const [nombre, setNombre] = useState(universidad?.nombre ?? '');
  const [motivo, setMotivo] = useState('');
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<{ codigo: string; texto: string } | null>(null);

  const guardar = async () => {
    setTocado(true);
    if (!motivoValido(motivo)) return;
    setEnviando(true);
    setError(null);
    const r = editar
      ? await llamar(() => supabase.rpc('editar_universidad', { p_id: universidad.id, p_nombre: nombre, p_motivo: motivo.trim() }))
      : await llamar(() => supabase.rpc('crear_universidad', { p_nombre: nombre, p_motivo: motivo.trim() }));
    setEnviando(false);
    if (r.ok) { onGuardada(); return; }
    if (r.error) setError({ codigo: r.error.message, texto: textoDeRechazo(r.error) });
  };

  const errorNombre = error && DEL_NOMBRE.has(error.codigo) ? error.texto : null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-universidad-titulo">
      <div className="modal-card">
        <div className="modal-icon neutro"><IconBuilding tam={24} /></div>
        <div className="modal-title" id="modal-universidad-titulo">{editar ? 'Editar universidad' : 'Agregar universidad'}</div>
        {editar
          ? <Aviso tipo="neutro">El nombre nuevo se verá en todas las publicaciones y perfiles de esta universidad.</Aviso>
          : <div className="modal-sub">Aparece en la app cuando tenga al menos un campus. Para que sus estudiantes se registren, agrega después un dominio.</div>}
        <div className="field">
          <label className="field-label" htmlFor="universidad-nombre">Nombre</label>
          <input id="universidad-nombre" className={`text-field${errorNombre ? ' is-invalid' : ''}`} value={nombre}
            maxLength={150} onChange={(e) => setNombre(e.target.value)} />
          {errorNombre && <div className="field-error">{errorNombre}</div>}
        </div>
        <CampoMotivo id="motivo-universidad" valor={motivo} onCambio={setMotivo}
          placeholder={editar ? 'Por qué cambias el nombre' : 'Por qué la das de alta'}
          invalido={tocado && !motivoValido(motivo)} />
        {error && !errorNombre && <Aviso>{error.texto}</Aviso>}
        <div className="modal-actions">
          <button type="button" className="btn ghost-btn" disabled={enviando} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn primary-btn" disabled={enviando} onClick={() => void guardar()}>
            {enviando ? <><Puntos />Guardando</> : editar ? 'Guardar' : 'Agregar'}
          </button>
        </div>
      </div>
    </div>
  );
}
