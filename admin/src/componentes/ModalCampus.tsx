import { useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { motivoValido } from '../lib/formato.ts';
import type { CampusCatalogo } from '../lib/tipos.ts';
import { Aviso, CampoMotivo, Puntos } from './Basicos.tsx';
import { IconBuilding } from './Iconos.tsx';

/** El mismo texto que da la RPC: una sola copia, en `rechazos.ts`. */
const TEXTO_COORDENADAS = textoDeRechazo({ code: '22023', message: 'coordenadas_invalidas' });

/** '' → null; un número (con punto o coma decimal) → number; otra cosa → NaN. */
function coordenada(texto: string): number | null {
  const t = texto.trim().replace(',', '.');
  if (t === '') return null;
  return /^[-+]?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

/**
 * Frame "Campus (modal: agregar o editar)" (Ola 5). Con `campus`, edita
 * (`admin.editar_campus`, reemplazo completo: dejar las dos coordenadas vacías
 * las quita); sin él, agrega (`admin.crear_campus`). No hay campo de
 * universidad: un campus nunca cambia de universidad (la RPC ni lo recibe).
 *
 * Lo único que se revisa aquí es que lo tecleado en latitud/longitud SEA un
 * número; los rangos y «las dos o ninguna» son de la RPC (y del check).
 */
export function ModalCampus({ universidad, campus, onCerrar, onGuardado }: {
  universidad: { id: number; nombre: string }; campus: CampusCatalogo | null;
  onCerrar: () => void; onGuardado: () => void;
}) {
  const llamar = useLlamar();
  const editar = campus !== null;
  const [nombre, setNombre] = useState(campus?.nombre ?? '');
  const [ciudad, setCiudad] = useState(campus?.ciudad ?? '');
  const [lat, setLat] = useState(campus?.latitud?.toString() ?? '');
  const [lon, setLon] = useState(campus?.longitud?.toString() ?? '');
  const [motivo, setMotivo] = useState('');
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<{ codigo: string; texto: string } | null>(null);

  const guardar = async () => {
    setTocado(true);
    if (!motivoValido(motivo)) return;
    const pLat = coordenada(lat);
    const pLon = coordenada(lon);
    if (Number.isNaN(pLat) || Number.isNaN(pLon)) {
      setError({ codigo: 'coordenadas_invalidas', texto: TEXTO_COORDENADAS });
      return;
    }
    setEnviando(true);
    setError(null);
    // Los tipos generados no saben que la RPC acepta null en las coordenadas.
    const coords = { p_latitud: pLat as number, p_longitud: pLon as number };
    const r = editar
      ? await llamar(() => supabase.rpc('editar_campus', {
        p_id: campus.id, p_nombre: nombre, p_ciudad: ciudad, ...coords, p_motivo: motivo.trim() }))
      : await llamar(() => supabase.rpc('crear_campus', {
        p_universidad_id: universidad.id, p_nombre: nombre, p_ciudad: ciudad, ...coords, p_motivo: motivo.trim() }));
    setEnviando(false);
    if (r.ok) { onGuardado(); return; }
    if (r.error) setError({ codigo: r.error.message, texto: textoDeRechazo(r.error, 'campus') });
  };

  const de = (...codigos: string[]) => (error && codigos.includes(error.codigo) ? error.texto : null);
  const errorNombre = de('nombre_invalido', 'nombre_duplicado');
  const errorCiudad = de('ciudad_invalida');
  const errorCoords = de('coordenadas_invalidas');
  const errorGeneral = error && !errorNombre && !errorCiudad && !errorCoords ? error.texto : null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-campus-titulo">
      <div className="modal-card">
        <div className="modal-icon neutro"><IconBuilding tam={24} /></div>
        <div className="modal-title" id="modal-campus-titulo">{editar ? 'Editar campus' : `Agregar campus a ${universidad.nombre}`}</div>
        {editar
          ? <Aviso tipo="neutro">El nombre y la ciudad se ven en las publicaciones de este campus. Cambiar las coordenadas cambia qué campus detecta la app como el más cercano.</Aviso>
          : <div className="modal-sub">El campus queda en la universidad donde lo creas: no se puede mover a otra.</div>}
        <div className="field">
          <label className="field-label" htmlFor="campus-nombre">Nombre</label>
          <input id="campus-nombre" className={`text-field${errorNombre ? ' is-invalid' : ''}`} value={nombre}
            maxLength={150} onChange={(e) => setNombre(e.target.value)} />
          {errorNombre && <div className="field-error">{errorNombre}</div>}
        </div>
        <div className="field">
          <label className="field-label" htmlFor="campus-ciudad">Ciudad</label>
          <input id="campus-ciudad" className={`text-field${errorCiudad ? ' is-invalid' : ''}`} value={ciudad}
            maxLength={150} onChange={(e) => setCiudad(e.target.value)} />
          {errorCiudad && <div className="field-error">{errorCiudad}</div>}
        </div>
        <div className="rejilla dos">
          <div className="field">
            <label className="field-label" htmlFor="campus-latitud">Latitud (opcional)</label>
            <input id="campus-latitud" className={`text-field${errorCoords ? ' is-invalid' : ''}`} value={lat}
              inputMode="decimal" onChange={(e) => setLat(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="campus-longitud">Longitud (opcional)</label>
            <input id="campus-longitud" className={`text-field${errorCoords ? ' is-invalid' : ''}`} value={lon}
              inputMode="decimal" onChange={(e) => setLon(e.target.value)} />
          </div>
        </div>
        {errorCoords
          ? <div className="field-error bajo-rejilla">{errorCoords}</div>
          : <div className="field-help bajo-rejilla">Las dos o ninguna. Sin coordenadas, el campus no participa en «Detectar campus más cercano».</div>}
        <CampoMotivo id="motivo-campus" valor={motivo} onCambio={setMotivo}
          placeholder={editar ? 'Por qué lo cambias' : 'Por qué lo das de alta'}
          invalido={tocado && !motivoValido(motivo)} />
        {errorGeneral && <Aviso>{errorGeneral}</Aviso>}
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
