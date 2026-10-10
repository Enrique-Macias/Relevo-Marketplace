import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { ACCION, autorAuditado, cambioAuditado, cambioCatalogo, fechaCorta } from '../lib/formato.ts';
import type { AuditoriaFila } from '../lib/tipos.ts';
import { ErrorCarga, Esqueleto } from './Basicos.tsx';

const PAGINA = 50;
const TIPO_OBJETO: Record<string, string> = { universidad: 'Universidad', campus: 'Campus', dominio: 'Dominio' };

/**
 * La sección «Auditoría» de dos frames de la Ola 6, con `admin.auditoria`
 * (20261009000486):
 *   - «Reporte resuelto»: las filas de ese reporte.
 *   - «Universidad — detalle»: las de la universidad, SUS CAMPUS y SUS
 *     DOMINIOS en una sola llamada, con la columna «Objeto» (el nombre actual).
 * Del más reciente al más antiguo; «Ver más» pide la página siguiente con el
 * cursor (id de la última fila) y desaparece cuando ya no hay filas anteriores.
 * Solo lectura: nada aquí decide permisos (los decide `exigir_admin()`).
 */
export function Auditoria({ tipo, id, recarga = 0 }: {
  tipo: 'reporte' | 'universidad'; id: string; recarga?: number;
}) {
  const llamar = useLlamar();
  const [filas, setFilas] = useState<AuditoriaFila[] | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [fallo, setFallo] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await llamar(() => supabase.rpc('auditoria',
        { p_objetivo_tipo: tipo, p_objetivo_id: id, p_limit: PAGINA }));
      if (!vivo) return;
      if (!r.ok) { setFallo(true); return; }
      const datos = (r.data ?? []) as unknown as AuditoriaFila[];
      setFilas(datos); setHayMas(datos.length === PAGINA);
    })();
    return () => { vivo = false; };
  }, [tipo, id, recarga, intento, llamar]);

  const verMas = async () => {
    if (!filas || filas.length === 0) return;
    setCargandoMas(true);
    const r = await llamar(() => supabase.rpc('auditoria',
      { p_objetivo_tipo: tipo, p_objetivo_id: id, p_cursor: filas[filas.length - 1].id, p_limit: PAGINA }));
    setCargandoMas(false);
    if (!r.ok) { setFallo(true); return; }
    const mas = (r.data ?? []) as unknown as AuditoriaFila[];
    setFilas([...filas, ...mas]); setHayMas(mas.length === PAGINA);
  };

  const titulo = <div className="titulo-seccion">Auditoría</div>;
  if (fallo) {
    return <>{titulo}<ErrorCarga titulo="No pudimos cargar la auditoría"
      onReintentar={() => { setFallo(false); setFilas(null); setIntento((n) => n + 1); }} /></>;
  }
  if (filas === null) return <>{titulo}<Esqueleto filas={3} /></>;
  if (filas.length === 0) {
    return <>{titulo}<div className="texto-suave">{tipo === 'reporte'
      ? 'Este reporte no tiene movimientos en la auditoría: se resolvió fuera del panel.'
      : 'Sin movimientos en la auditoría.'}</div></>;
  }

  const conObjeto = tipo === 'universidad';
  return (
    <>
      {titulo}
      <table className="tabla">
        <thead><tr><th>Fecha</th>{conObjeto && <th>Objeto</th>}<th>Acción</th><th>Admin</th><th>Motivo</th><th>Cambio</th></tr></thead>
        <tbody>
          {filas.map((a) => (
            <tr key={a.id}>
              <td className="suave">{fechaCorta(a.created_at)}</td>
              {conObjeto && (
                <td>
                  <div className="celda-titulo">{a.objetivo_etiqueta ?? a.objetivo_id}</div>
                  <div className="celda-sub">{TIPO_OBJETO[a.objetivo_tipo] ?? a.objetivo_tipo}</div>
                </td>
              )}
              <td>{ACCION[a.accion] ?? a.accion}</td>
              <td>{autorAuditado(a.admin_correo)}</td>
              <td>{a.motivo}</td>
              <td className="suave">{conObjeto ? cambioCatalogo(a.accion, a.antes, a.despues) : cambioAuditado(a.antes, a.despues)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(conObjeto || hayMas) && (
        <div className="pie-tabla">
          <span>{conObjeto ? 'Incluye la universidad, sus campus y sus dominios, del más reciente al más antiguo. Los nombres son los actuales.' : ''}</span>
          {hayMas && (
            <button type="button" className="btn ghost-btn" disabled={cargandoMas} onClick={() => void verMas()}>Ver más</button>
          )}
        </div>
      )}
    </>
  );
}
