import { useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { motivoValido } from '../lib/formato.ts';
import type { CategoriaAdmin } from '../lib/tipos.ts';
import { Aviso, CampoMotivo, Puntos } from './Basicos.tsx';
import { IconTag } from './Iconos.tsx';
import { ICONOS_CATEGORIA, IconoCategoria } from './IconosCategoria.tsx';

/** Rechazos que el frame pinta bajo el campo Nombre; el resto va como aviso. */
const DEL_NOMBRE = new Set(['nombre_invalido', 'nombre_duplicado']);

/**
 * Frame "Categoría (modal: agregar o editar)" (`20261025000489`). Con
 * `categoria`, edita (`admin.editar_categoria`); sin ella, agrega
 * (`admin.crear_categoria`), que la pone al final, antes de «Otros». La
 * normalización, la unicidad sin mayúsculas y la lista de íconos válidos son de
 * la base: aquí solo se muestra lo que la RPC responde. «Guardar» se puede
 * pulsar sin cambios: lo decide la base (`sin_cambios`).
 */
export function ModalCategoria({ categoria, onCerrar, onGuardada }: {
  categoria?: CategoriaAdmin; onCerrar: () => void; onGuardada: () => void;
}) {
  const llamar = useLlamar();
  const editar = categoria !== undefined;
  const [nombre, setNombre] = useState(categoria?.nombre ?? '');
  const [icono, setIcono] = useState<string | null>(categoria?.icono ?? null);
  const [motivo, setMotivo] = useState('');
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<{ codigo: string; texto: string } | null>(null);

  const guardar = async () => {
    setTocado(true);
    if (!motivoValido(motivo) || icono === null) return;
    setEnviando(true);
    setError(null);
    const r = editar
      ? await llamar(() => supabase.rpc('editar_categoria',
        { p_id: categoria.id, p_nombre: nombre, p_icono: icono, p_motivo: motivo.trim() }))
      : await llamar(() => supabase.rpc('crear_categoria', { p_nombre: nombre, p_icono: icono, p_motivo: motivo.trim() }));
    setEnviando(false);
    if (r.ok) { onGuardada(); return; }
    if (r.error) setError({ codigo: r.error.message, texto: textoDeRechazo(r.error, 'categoria') });
  };

  const errorNombre = error && DEL_NOMBRE.has(error.codigo) ? error.texto : null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-categoria-titulo">
      <div className="modal-card">
        <div className="modal-icon neutro"><IconTag tam={24} /></div>
        <div className="modal-title" id="modal-categoria-titulo">{editar ? 'Editar categoría' : 'Agregar categoría'}</div>
        {editar
          ? <Aviso tipo="neutro">El nombre y el ícono nuevos se verán en todas las publicaciones de esta categoría.</Aviso>
          : <div className="modal-sub">Entra al final de la lista, antes de «Otros», y se puede elegir en la app de inmediato.</div>}
        <div className="field">
          <label className="field-label" htmlFor="categoria-nombre">Nombre</label>
          <input id="categoria-nombre" className={`text-field${errorNombre ? ' is-invalid' : ''}`} value={nombre}
            maxLength={80} onChange={(e) => setNombre(e.target.value)} />
          {errorNombre && <div className="field-error">{errorNombre}</div>}
        </div>
        <div className="field">
          <span className="field-label" id="categoria-icono">Ícono</span>
          <div className="iconos" role="group" aria-labelledby="categoria-icono">
            {ICONOS_CATEGORIA.map((llave) => (
              <button key={llave} type="button" className={`icono-op${icono === llave ? ' active' : ''}`}
                aria-label={llave} aria-pressed={icono === llave} disabled={enviando} onClick={() => setIcono(llave)}>
                <IconoCategoria icono={llave} tam={20} />
              </button>
            ))}
          </div>
          <div className="field-help">Solo los íconos que ya conoce la app.</div>
        </div>
        <CampoMotivo id="motivo-categoria" valor={motivo} onCambio={setMotivo}
          placeholder={editar ? 'Por qué la cambias' : 'Por qué la das de alta'}
          invalido={tocado && !motivoValido(motivo)} />
        {error && !errorNombre && <Aviso>{error.texto}</Aviso>}
        <div className="modal-actions">
          <button type="button" className="btn ghost-btn" disabled={enviando} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn primary-btn" disabled={enviando || icono === null}
            onClick={() => void guardar()}>
            {enviando ? <><Puntos />Guardando</> : editar ? 'Guardar' : 'Agregar'}
          </button>
        </div>
      </div>
    </div>
  );
}
