import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { CHIP_USUARIO, fechaCorta, precio } from '../lib/formato.ts';
import { razones } from '../lib/razones.ts';
import type { FilaCola } from '../lib/tipos.ts';
import { Aviso, Chip, ErrorCarga, Esqueleto } from '../componentes/Basicos.tsx';
import { IconEye, IconImage } from '../componentes/Iconos.tsx';

const PAGINA = 50;
const VEREDICTO: Record<string, string> = { limpio: 'Limpio', revisar: 'Revisar', bloquear: 'Bloquear' };

/** Los dos chips del frame: las evaluadas (default) y las altas que nunca pidieron moderación. */
const FILTROS: [boolean, string][] = [[true, 'Evaluadas'], [false, 'Sin evaluar']];

/**
 * Frames "Moderación — cola (evaluadas)" y "Moderación — cola vacía", con sus
 * variantes de «Sin evaluar». La cola es `admin.cola_moderacion` (`…481`):
 * solo `pendiente`, de la más antigua a la más reciente (id asc), paginada por
 * cursor (`id > p_cursor`).
 *
 * La miniatura es el recuadro con ícono del frame, sin bajar la foto: una cola
 * de 50 filas serían 50 descargas del bucket privado para un cuadro de 44 px.
 * Las fotos se miran en el detalle.
 */
export function Moderacion({ onAbrir }: { onAbrir: (id: number) => void }) {
  const llamar = useLlamar();
  const [evaluadas, setEvaluadas] = useState(true);
  const [filas, setFilas] = useState<FilaCola[] | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  const pedir = useCallback(
    (cursor: number | null) => llamar(() => supabase.rpc('cola_moderacion', {
      p_solo_evaluadas: evaluadas, p_cursor: cursor ?? undefined, p_limit: PAGINA,
    })),
    [llamar, evaluadas],
  );

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await pedir(null);
      if (!vivo) return;
      if (!r.ok) { setFallo(r.error ? textoDeRechazo(r.error) : null); return; }
      const datos = (r.data ?? []) as unknown as FilaCola[];
      setFilas(datos);
      setHayMas(datos.length === PAGINA);
    })();
    return () => { vivo = false; };
  }, [recarga, pedir]);

  const cambiar = (e: boolean) => { setEvaluadas(e); setFilas(null); setFallo(null); };

  const cargarMas = async () => {
    if (!filas?.length) return;
    setCargandoMas(true);
    const r = await pedir(filas[filas.length - 1].id);
    setCargandoMas(false);
    if (!r.ok) { setFallo(r.error ? textoDeRechazo(r.error) : null); return; }
    const mas = (r.data ?? []) as unknown as FilaCola[];
    setFilas([...filas, ...mas]);
    setHayMas(mas.length === PAGINA);
  };

  return (
    <>
      <div className="titulo-pagina">Moderación</div>
      <div className="sub-pagina">Publicaciones en revisión, de la más antigua a la más reciente.</div>
      <div className="chips" role="tablist">
        {FILTROS.map(([e, etiqueta]) => (
          <button key={etiqueta} type="button" role="tab" aria-selected={evaluadas === e}
            className={`chip${evaluadas === e ? ' active' : ''}`} onClick={() => cambiar(e)}>{etiqueta}</button>
        ))}
      </div>

      {fallo !== null && filas === null
        ? <ErrorCarga titulo="No pudimos cargar la cola de moderación" onReintentar={() => { setFallo(null); setRecarga((n) => n + 1); }} />
        : filas === null
          ? <Esqueleto />
          : filas.length === 0
            ? (
              <div className="empty-state">
                <div className="empty-icon"><IconEye tam={30} /></div>
                {evaluadas
                  ? <>
                      <div className="empty-title">No hay publicaciones en revisión</div>
                      <div className="empty-sub">Cuando la moderación automática mande una publicación a revisión, aparecerá aquí.</div>
                    </>
                  : <>
                      <div className="empty-title">No hay altas sin evaluar</div>
                      <div className="empty-sub">Aquí aparecen las publicaciones que se quedaron a media subida y nunca pasaron por la moderación automática.</div>
                    </>}
              </div>
            )
            : (
              <>
                <table className="tabla">
                  <thead><tr><th>#</th><th>Enviada</th><th>Publicación</th><th>Dueño</th><th>Último veredicto</th>
                    <th className="num">Evaluaciones</th></tr></thead>
                  <tbody>
                    {filas.map((f, i) => <FilaModeracion key={f.id} f={f} tinte={(i % 4) + 1} onAbrir={onAbrir} />)}
                  </tbody>
                </table>
                {fallo && <Aviso>{fallo}</Aviso>}
                <div className="pie-tabla">
                  <span>Mostrando {filas.length} {filas.length === 1 ? 'publicación' : 'publicaciones'}</span>
                  {hayMas && (
                    <button type="button" className="btn ghost-btn" disabled={cargandoMas} onClick={() => void cargarMas()}>
                      Cargar más
                    </button>
                  )}
                </div>
              </>
            )}
    </>
  );
}

function FilaModeracion({ f, tinte, onAbrir }: { f: FilaCola; tinte: number; onAbrir: (id: number) => void }) {
  const razon = razones(f.ultimo_detalle)[0];
  return (
    <tr className="seleccionable" tabIndex={0} onClick={() => onAbrir(f.id)}
      onKeyDown={(e) => { if (e.key === 'Enter') onAbrir(f.id); }}>
      <td className="suave">{f.id}</td>
      <td className="suave">{fechaCorta(f.created_at)}</td>
      <td>
        <div className="celda-con-foto">
          <div className={`miniatura t${tinte}`}><IconImage tam={18} /></div>
          <div>
            <div className="celda-titulo">{f.titulo}</div>
            <div className="celda-sub">{f.categoria ?? '—'} · {precio(f.precio)}</div>
          </div>
        </div>
      </td>
      <td>{f.dueno_nombre ?? 'Sin nombre'}{' '}
        {f.dueno_estado === 'suspendido' && <Chip clase={CHIP_USUARIO.suspendido[0]}>{CHIP_USUARIO.suspendido[1]}</Chip>}</td>
      {f.ultimo_veredicto
        ? <td><span className={`veredicto ${f.ultimo_veredicto}`}>{VEREDICTO[f.ultimo_veredicto] ?? f.ultimo_veredicto}</span>
            {razon && <div className="celda-sub">{razon}</div>}</td>
        : <td className="suave">Sin evaluar</td>}
      <td className={`num${f.evaluaciones === 0 ? ' suave' : ''}`}>{f.evaluaciones}</td>
    </tr>
  );
}
