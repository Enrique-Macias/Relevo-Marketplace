import { useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { motivoValido } from '../lib/formato.ts';
import { Aviso, CampoMotivo, Puntos } from './Basicos.tsx';
import { IconLock } from './Iconos.tsx';

/** Rechazos que el frame pinta bajo el campo Dominio; el resto va como aviso. */
const DEL_CAMPO = new Set(['dominio_invalido', 'dominio_no_permitido']);

/**
 * Frame "Agregar dominio (modal)" (Ola 5, `admin.agregar_dominio`). La base
 * normaliza (minúsculas, espacios, un `@` inicial), rechaza los proveedores de
 * correo público y exige que la universidad tenga campus. Agregar NUNCA
 * reactiva uno desactivado: para eso está «Reactivar» en la lista.
 */
export function ModalAgregarDominio({ universidad, onCerrar, onAgregado }: {
  universidad: { id: number; nombre: string }; onCerrar: () => void; onAgregado: () => void;
}) {
  const llamar = useLlamar();
  const [dominio, setDominio] = useState('');
  const [motivo, setMotivo] = useState('');
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<{ codigo: string; texto: string } | null>(null);

  const agregar = async () => {
    setTocado(true);
    if (!motivoValido(motivo)) return;
    setEnviando(true);
    setError(null);
    const r = await llamar(() => supabase.rpc('agregar_dominio', {
      p_universidad_id: universidad.id, p_dominio: dominio, p_motivo: motivo.trim() }));
    setEnviando(false);
    if (r.ok) { onAgregado(); return; }
    if (r.error) setError({ codigo: r.error.message, texto: textoDeRechazo(r.error) });
  };

  const errorCampo = error && DEL_CAMPO.has(error.codigo) ? error.texto : null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-dominio-titulo">
      <div className="modal-card">
        <div className="modal-icon neutro"><IconLock /></div>
        <div className="modal-title" id="modal-dominio-titulo">Agregar dominio a {universidad.nombre}</div>
        <div className="modal-sub">Quien tenga un correo con este dominio podrá registrarse en la app y quedará en esta universidad.</div>
        <div className="field">
          <label className="field-label" htmlFor="dominio">Dominio</label>
          <input id="dominio" className={`text-field${errorCampo ? ' is-invalid' : ''}`} value={dominio}
            maxLength={260} autoCapitalize="none" spellCheck={false} onChange={(e) => setDominio(e.target.value)} />
          {errorCampo
            ? <div className="field-error">{errorCampo}</div>
            : <div className="field-help">Coincidencia exacta: un subdominio (por ejemplo, alumnos.uanl.edu.mx) necesita su propia fila.</div>}
        </div>
        <CampoMotivo id="motivo-dominio" valor={motivo} onCambio={setMotivo}
          placeholder="Por qué lo das de alta" invalido={tocado && !motivoValido(motivo)} />
        {error && !errorCampo && <Aviso>{error.texto}</Aviso>}
        <div className="modal-actions">
          <button type="button" className="btn ghost-btn" disabled={enviando} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn primary-btn" disabled={enviando} onClick={() => void agregar()}>
            {enviando ? <><Puntos />Agregando</> : 'Agregar'}
          </button>
        </div>
      </div>
    </div>
  );
}
