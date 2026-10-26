import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { motivoValido } from '../lib/formato.ts';
import type { CategoriaAdmin } from '../lib/tipos.ts';
import { Aviso, CampoMotivo, ErrorCarga, Esqueleto, Puntos } from '../componentes/Basicos.tsx';
import { IconChevron } from '../componentes/Iconos.tsx';
import { IconoCategoria } from '../componentes/IconosCategoria.tsx';
import { ModalCategoria } from '../componentes/ModalCategoria.tsx';
import { ModalEstadoCategoria } from '../componentes/ModalEstadoCategoria.tsx';

/** Las primeras N ACTIVAS salen en el Feed de la app (`categoriasFeed`, `src/lib/categorias.ts`). */
const EN_EL_INICIO = 7;

type Modal =
  | { t: 'crear' }
  | { t: 'editar'; categoria: CategoriaAdmin }
  | { t: 'estado'; categoria: CategoriaAdmin }
  | { t: 'orden' };

/**
 * Frames "Categorías — lista" y "Categorías — reordenar" (`20261025000489`,
 * `admin.categorias()` y `admin.reordenar_categorias`). Reordenar mueve un
 * BORRADOR local; nada cambia en la base hasta «Guardar orden», que manda el
 * orden completo en una sola RPC. Si alguien creó o borró una categoría
 * mientras tanto, la base responde `orden_desactualizado`.
 */
export function Categorias() {
  const llamar = useLlamar();
  const [lista, setLista] = useState<CategoriaAdmin[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [borrador, setBorrador] = useState<CategoriaAdmin[] | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await llamar(() => supabase.rpc('categorias'));
      if (!vivo) return;
      if (!r.ok) { setFallo(true); return; }
      setLista(((r.data ?? { categorias: [] }) as unknown as { categorias: CategoriaAdmin[] }).categorias);
    })();
    return () => { vivo = false; };
  }, [recarga, llamar]);

  const recargar = () => { setFallo(false); setLista(null); setBorrador(null); setRecarga((n) => n + 1); };
  const hecho = () => { setModal(null); setAviso('Cambios guardados.'); recargar(); };

  const mover = (i: number, delta: -1 | 1) => setBorrador((b) => {
    if (!b) return b;
    const n = [...b];
    [n[i], n[i + delta]] = [n[i + delta], n[i]];
    return n;
  });

  const filas = borrador ?? lista;
  // «En el inicio»: las primeras 7 activas EN EL ORDEN QUE SE VE (el borrador, si se reordena).
  const inicio = new Set((filas ?? []).filter((c) => c.activa).slice(0, EN_EL_INICIO).map((c) => c.id));

  return (
    <>
      <div className="titulo-pagina">Categorías</div>
      <div className="sub-pagina">
        Las categorías de la app, en el orden en que se muestran. Las {EN_EL_INICIO} primeras activas salen en el inicio.
      </div>
      {aviso && !borrador && <Aviso tipo="info">{aviso}</Aviso>}
      {borrador && <Aviso tipo="neutro">Mueve las categorías con las flechas. Nada cambia en la app hasta que guardes.</Aviso>}
      {lista && (
        <div className="acciones">
          {borrador
            ? <>
              <button type="button" className="btn ghost-btn" onClick={() => setBorrador(null)}>Cancelar</button>
              <button type="button" className="btn primary-btn" onClick={() => setModal({ t: 'orden' })}>Guardar orden</button>
            </>
            : <>
              <button type="button" className="btn ghost-btn" onClick={() => { setAviso(null); setBorrador(lista); }}>
                Reordenar
              </button>
              <button type="button" className="btn primary-btn" onClick={() => { setAviso(null); setModal({ t: 'crear' }); }}>
                Agregar categoría
              </button>
            </>}
        </div>
      )}
      <br />
      {fallo
        ? <ErrorCarga titulo="No pudimos cargar las categorías" onReintentar={recargar} />
        : filas === null
          ? <Esqueleto />
          : (
            <>
              <table className="tabla">
                <thead>
                  <tr>
                    {borrador ? <th>Orden</th> : <th className="num">#</th>}
                    <th>Categoría</th><th className="num">Publicaciones</th><th className="num">Intereses</th><th>Estado</th><th />
                  </tr>
                </thead>
                <tbody>
                  {filas.map((c, i) => (
                    <tr key={c.id}>
                      {borrador
                        ? (
                          <td>
                            <span className="orden-btns">
                              <button type="button" className="orden-btn arriba" aria-label={`Subir ${c.nombre}`}
                                disabled={i === 0} onClick={() => mover(i, -1)}><IconChevron /></button>
                              <button type="button" className="orden-btn abajo" aria-label={`Bajar ${c.nombre}`}
                                disabled={i === filas.length - 1} onClick={() => mover(i, 1)}><IconChevron /></button>
                            </span>
                          </td>
                        )
                        : <td className="num suave">{i + 1}</td>}
                      <td>
                        <div className="cat-celda">
                          <span className={`cat-ico${c.activa ? '' : ' apagado'}`}><IconoCategoria icono={c.icono} /></span>
                          <div>
                            <div className="celda-titulo">{c.nombre}</div>
                            {!c.activa
                              ? <div className="celda-sub una-linea">No se puede elegir en la app</div>
                              : inicio.has(c.id) && <div className="celda-sub">En el inicio</div>}
                          </div>
                        </div>
                      </td>
                      <td className="num">{c.publicaciones}</td>
                      <td className="num">{c.intereses}</td>
                      <td>{c.activa ? <span className="estado ok">Activa</span> : <span className="estado apagado">Desactivada</span>}</td>
                      <td>
                        {!borrador && (
                          c.activa
                            ? <>
                              <button type="button" className="btn ghost-btn" onClick={() => { setAviso(null); setModal({ t: 'editar', categoria: c }); }}>Editar</button>{' '}
                              <button type="button" className="btn ghost-btn" onClick={() => { setAviso(null); setModal({ t: 'estado', categoria: c }); }}>Desactivar</button>
                            </>
                            : <button type="button" className="btn ghost-btn" onClick={() => { setAviso(null); setModal({ t: 'estado', categoria: c }); }}>Reactivar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="pie-tabla">
                <span>Las publicaciones existentes conservan su categoría aunque se desactive. Una categoría desactivada no se puede elegir al publicar, al filtrar ni en intereses.</span>
              </div>
            </>
          )}
      {modal?.t === 'crear' && <ModalCategoria onCerrar={() => setModal(null)} onGuardada={hecho} />}
      {modal?.t === 'editar' && <ModalCategoria categoria={modal.categoria} onCerrar={() => setModal(null)} onGuardada={hecho} />}
      {modal?.t === 'estado' && <ModalEstadoCategoria categoria={modal.categoria} onCerrar={() => setModal(null)} onHecho={hecho} />}
      {modal?.t === 'orden' && borrador && (
        <ModalOrden ids={borrador.map((c) => c.id)} onCerrar={() => setModal(null)} onGuardado={hecho} />
      )}
    </>
  );
}

/** Variante del frame "Categorías — reordenar": guardar el orden nuevo, con motivo. */
function ModalOrden({ ids, onCerrar, onGuardado }: { ids: number[]; onCerrar: () => void; onGuardado: () => void }) {
  const llamar = useLlamar();
  const [motivo, setMotivo] = useState('');
  const [tocado, setTocado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    setTocado(true);
    if (!motivoValido(motivo)) return;
    setEnviando(true);
    setError(null);
    const r = await llamar(() => supabase.rpc('reordenar_categorias', { p_ids: ids, p_motivo: motivo.trim() }));
    setEnviando(false);
    if (r.ok) { onGuardado(); return; }
    if (r.error) setError(textoDeRechazo(r.error, 'categoria'));
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-orden-titulo">
      <div className="modal-card">
        <div className="modal-title" id="modal-orden-titulo">Guardar el orden nuevo</div>
        <div className="modal-sub">Cambia el orden de la app para todos. Las {EN_EL_INICIO} primeras activas salen en el inicio.</div>
        <CampoMotivo id="motivo-orden" valor={motivo} onCambio={setMotivo} placeholder="Por qué cambias el orden"
          invalido={tocado && !motivoValido(motivo)} />
        {error && <Aviso>{error}</Aviso>}
        <div className="modal-actions">
          <button type="button" className="btn ghost-btn" disabled={enviando} onClick={onCerrar}>Cancelar</button>
          <button type="button" className="btn primary-btn" disabled={enviando} onClick={() => void guardar()}>
            {enviando ? <><Puntos />Guardando</> : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
