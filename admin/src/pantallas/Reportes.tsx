import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { CHIP_LISTING, CHIP_REPORTE, CHIP_USUARIO, MOTIVO_REPORTE, fechaCorta, type EstadoReporte } from '../lib/formato.ts';
import type { Reporte } from '../lib/tipos.ts';
import { Aviso, Chip, ErrorCarga, Esqueleto, Vacio } from '../componentes/Basicos.tsx';
import { IconTag, IconUser } from '../componentes/Iconos.tsx';

const PAGINA = 50;
type Filtro = EstadoReporte | null;

const FILTROS: [Filtro, string][] = [
  ['pendiente', 'Pendientes'], ['resuelto', 'Resueltos'], ['descartado', 'Descartados'], [null, 'Todos'],
];

/** El texto vacío por filtro. El de Pendientes es el del frame "lista vacía". */
const VACIO: Record<string, string> = {
  pendiente: 'No hay reportes pendientes',
  resuelto: 'No hay reportes resueltos',
  descartado: 'No hay reportes descartados',
  todos: 'No hay reportes',
};

/**
 * Frame "Reportes — lista". Nunca se oculta un reporte (§13): los 4
 * `objetivo_tipo` se pintan siempre, con etiqueta para los eliminados.
 * Paginado por cursor (`id < p_cursor`, orden id desc).
 */
export function Reportes({ onAbrir }: { onAbrir: (id: number) => void }) {
  const llamar = useLlamar();
  const [filtro, setFiltro] = useState<Filtro>('pendiente');
  const [filas, setFilas] = useState<Reporte[] | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  // `p_estado` va SIEMPRE explícito: NULL (JSON null) es "Todos"; omitirlo
  // daría el default de la RPC, 'pendiente'. Los tipos generados no admiten
  // null aquí (lo trata como string opcional), de ahí el cast.
  const pedir = useCallback(
    (cursor: number | null) => llamar(() => supabase.rpc('listar_reportes', {
      p_estado: filtro as string, p_cursor: cursor ?? undefined, p_limit: PAGINA,
    })),
    [llamar, filtro],
  );

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await pedir(null);
      if (!vivo) return;
      if (!r.ok) { setFallo(r.error ? textoDeRechazo(r.error) : null); return; }
      const datos = (r.data ?? []) as unknown as Reporte[];
      setFilas(datos);
      setHayMas(datos.length === PAGINA);
    })();
    return () => { vivo = false; };
  }, [recarga, pedir]);

  const cambiarFiltro = (f: Filtro) => {
    setFiltro(f); setFilas(null); setFallo(null);
  };

  const cargarMas = async () => {
    if (!filas?.length) return;
    setCargandoMas(true);
    const cursor = filas[filas.length - 1].id;
    const r = await pedir(cursor);
    setCargandoMas(false);
    if (!r.ok) { setFallo(r.error ? textoDeRechazo(r.error) : null); return; }
    const mas = (r.data ?? []) as unknown as Reporte[];
    setFilas([...filas, ...mas]);
    setHayMas(mas.length === PAGINA);
  };

  return (
    <>
      <div className="titulo-pagina">Reportes</div>
      <div className="sub-pagina">Lo que reportaron los estudiantes, del más reciente al más antiguo.</div>
      <div className="chips" role="tablist">
        {FILTROS.map(([f, etiqueta]) => (
          <button key={etiqueta} type="button" role="tab" aria-selected={filtro === f}
            className={`chip${filtro === f ? ' active' : ''}`} onClick={() => cambiarFiltro(f)}>{etiqueta}</button>
        ))}
      </div>

      {fallo !== null && filas === null
        ? <ErrorCarga titulo="No pudimos cargar los reportes" onReintentar={() => { setFallo(null); setRecarga((n) => n + 1); }} />
        : filas === null
          ? <Esqueleto />
          : filas.length === 0
            ? <Vacio titulo={VACIO[filtro ?? 'todos']}
                sub="Cuando alguien reporte una publicación o una cuenta, aparecerá aquí." />
            : (
              <>
                <table className="tabla">
                  <thead><tr><th>#</th><th>Fecha</th><th>Objetivo</th><th>Motivo</th><th>Reportó</th>
                    <th className="num">Reportes del objetivo</th><th>Estado</th></tr></thead>
                  <tbody>
                    {filas.map((r) => <FilaReporte key={r.id} r={r} onAbrir={onAbrir} />)}
                  </tbody>
                </table>
                {fallo && <Aviso>{fallo}</Aviso>}
                <div className="pie-tabla">
                  <span>Mostrando {filas.length} {filas.length === 1 ? 'reporte' : 'reportes'}</span>
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

function FilaReporte({ r, onAbrir }: { r: Reporte; onAbrir: (id: number) => void }) {
  const [claseEstado, textoEstado] = CHIP_REPORTE[r.estado];
  return (
    <tr className="seleccionable" tabIndex={0} onClick={() => onAbrir(r.id)}
      onKeyDown={(e) => { if (e.key === 'Enter') onAbrir(r.id); }}>
      <td className="suave">{r.id}</td>
      <td className="suave">{fechaCorta(r.created_at)}</td>
      <td><Objetivo r={r} /></td>
      <td>{MOTIVO_REPORTE[r.motivo] ?? r.motivo}</td>
      <td className={r.reporter_id ? '' : 'suave'}>{r.reporter_id ? (r.reporter_nombre ?? 'Sin nombre') : 'Cuenta eliminada'}</td>
      <td className={`num${r.reportes_mismo_objetivo === null ? ' suave' : ''}`}>{r.reportes_mismo_objetivo ?? '—'}</td>
      <td><Chip clase={claseEstado}>{textoEstado}</Chip></td>
    </tr>
  );
}

/** La celda "Objetivo": los 4 tipos, ninguno escondido. */
export function Objetivo({ r }: { r: Reporte }) {
  switch (r.objetivo_tipo) {
    case 'publicacion':
      return (<>
        <div className="celda-titulo">{r.listing_titulo}</div>
        <div className="celda-sub"><span className="objetivo-tipo"><IconTag />Publicación · {r.listing_estado ? CHIP_LISTING[r.listing_estado][1].toLowerCase() : '—'}</span></div>
      </>);
    case 'usuario':
      return (<>
        <div className="celda-titulo">{r.reported_user_nombre ?? 'Sin nombre'}</div>
        <div className="celda-sub"><span className="objetivo-tipo"><IconUser tam={13} />Cuenta · {r.reported_user_estado ? CHIP_USUARIO[r.reported_user_estado][1].toLowerCase() : '—'}</span></div>
      </>);
    case 'publicacion_eliminada':
      return (<>
        <div className="celda-titulo">{r.listing_titulo}</div>
        <div className="celda-sub"><span className="objetivo-tipo eliminado">Publicación eliminada</span></div>
      </>);
    case 'cuenta_eliminada':
      return (<>
        <div className="celda-titulo suave">Sin identidad</div>
        <div className="celda-sub"><span className="objetivo-tipo eliminado">Cuenta eliminada</span></div>
      </>);
  }
}
