import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import {
  ACCION, CHIP_LISTING, CHIP_REPORTE, CHIP_USUARIO, CONDICION, MOTIVO_REPORTE,
  autorAuditado, cambioAuditado, fechaCorta, fechaDia, precio,
} from '../lib/formato.ts';
import type { DetalleListing as Detalle, Vista } from '../lib/tipos.ts';
import { Aviso, Chip, ErrorCarga, Esqueleto, Volver } from '../componentes/Basicos.tsx';
import { IconBan } from '../componentes/Iconos.tsx';
import { FotoListing } from '../componentes/FotoListing.tsx';
import { ModalBloquear } from '../componentes/ModalBloquear.tsx';
import { ModalAprobar } from '../componentes/ModalAprobar.tsx';
import { razones } from '../lib/razones.ts';

const iniciales = (n: string | null) =>
  (n ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

const VEREDICTO: Record<string, string> = { limpio: 'Limpio', revisar: 'Revisar', bloquear: 'Bloquear' };

/**
 * Frames "Detalle de publicación" (con sus variantes: bloqueada, foto no
 * disponible) y "Detalle de publicación en revisión (aprobar)": una
 * `pendiente` suma la tarjeta Aprobar (Ola 4) y su chip dice "En revisión".
 */
export function DetalleListing({ id, desde, ir }: { id: number; desde?: number | 'moderacion'; ir: (v: Vista) => void }) {
  const llamar = useLlamar();
  const [d, setD] = useState<Detalle | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [bloqueando, setBloqueando] = useState(false);
  const [aprobando, setAprobando] = useState(false);
  const [exito, setExito] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    let vivo = true;
    void llamar(() => supabase.rpc('detalle_listing', { p_id: id })).then((r) => {
      if (!vivo) return;
      if (!r.ok) { setFallo(r.error ? textoDeRechazo(r.error) : 'No pudimos cargar la publicación'); return; }
      setFallo(null);
      setD(r.data as unknown as Detalle);
    });
    return () => { vivo = false; };
  }, [id, recarga, llamar]);

  const volver = desde === 'moderacion'
    ? <Volver onClick={() => ir({ tipo: 'moderacion' })}>Moderación</Volver>
    : desde !== undefined
      ? <Volver onClick={() => ir({ tipo: 'reporte', id: desde })}>Reporte #{desde}</Volver>
      : <Volver onClick={() => ir({ tipo: 'reportes' })}>Reportes</Volver>;

  if (fallo && !d) return <>{volver}<ErrorCarga titulo="No pudimos cargar la publicación" onReintentar={() => setRecarga((n) => n + 1)} /></>;
  if (!d) return <>{volver}<Esqueleto filas={3} /></>;

  const [claseEstado, textoChip] = CHIP_LISTING[d.estado];
  // El título de una `pendiente` dice "En revisión" (frame "en revisión
  // (aprobar)"); en las tablas sigue diciendo "Pendiente", como en sus frames.
  const textoEstado = d.estado === 'pendiente' ? 'En revisión' : textoChip;
  const enRevision = d.estado === 'pendiente';
  const duenoSuspendido = d.dueno.estado === 'suspendido';
  const sinFotos = d.fotos.length === 0;

  return (
    <>
      {volver}
      <div className="titulo-pagina">{d.titulo} <Chip clase={claseEstado}>{textoEstado}</Chip></div>
      <div className="sub-pagina">Publicación #{d.id} · creada el {fechaDia(d.created_at)}{!enRevision && <> · modificada el {fechaDia(d.updated_at)}</>}</div>
      {exito && <Aviso tipo="info">{exito}</Aviso>}
      <div className="dos-columnas">
        <div>
          {d.fotos.length > 0
            ? (
              <div className="galeria">
                {d.fotos.map((ruta, i) => (
                  <FotoListing key={ruta} ruta={ruta} clase={i === 0 ? 'principal' : ''} principal={i === 0} />
                ))}
              </div>
            )
            : <div className="texto-suave">Sin fotos.</div>}

          <div className="titulo-seccion">Historial de moderación</div>
          {d.moderacion.length === 0 ? <div className="texto-suave">Sin evaluaciones registradas.</div> : (
            <table className="tabla">
              <thead><tr><th>Fecha</th><th>Veredicto</th><th>Quedó en</th><th>Por qué</th></tr></thead>
              <tbody>
                {d.moderacion.map((m) => {
                  const rs = razones(m.detalle);
                  return (
                    <tr key={m.id}>
                      <td className="suave">{fechaCorta(m.created_at)}</td>
                      <td><span className={`veredicto ${m.veredicto}`}>{VEREDICTO[m.veredicto] ?? m.veredicto}</span></td>
                      <td>{CHIP_LISTING[m.estado_resultante]?.[1] ?? m.estado_resultante}</td>
                      <td><div className="razones">
                        {rs.length ? rs.map((t) => <span key={t} className="razon">{t}</span>)
                                   : <span className="razon">Ningún eje marcó nada</span>}
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="titulo-seccion">Reportes ({d.reportes.length})</div>
          {d.reportes.length === 0 ? <div className="texto-suave">Sin reportes.</div> : (
            <table className="tabla">
              <tbody>
                {d.reportes.map((r) => (
                  <tr key={r.id} className="seleccionable" tabIndex={0} onClick={() => ir({ tipo: 'reporte', id: r.id })}
                    onKeyDown={(e) => { if (e.key === 'Enter') ir({ tipo: 'reporte', id: r.id }); }}>
                    <td className="suave">{r.id}</td>
                    <td>{MOTIVO_REPORTE[r.motivo] ?? r.motivo}</td>
                    <td className={r.reporter_eliminado ? 'suave' : ''}>{r.reporter_eliminado ? 'Cuenta eliminada' : (r.reporter_nombre ?? 'Sin nombre')}</td>
                    <td><Chip clase={CHIP_REPORTE[r.estado][0]}>{CHIP_REPORTE[r.estado][1]}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="titulo-seccion">Auditoría</div>
          {d.auditoria.length === 0 ? <div className="texto-suave">Sin acciones registradas.</div> : (
            <table className="tabla">
              <thead><tr><th>Fecha</th><th>Acción</th><th>Admin</th><th>Motivo</th><th>Cambio</th></tr></thead>
              <tbody>
                {d.auditoria.map((a) => (
                  <tr key={a.id}>
                    <td className="suave">{fechaCorta(a.created_at)}</td>
                    <td>{ACCION[a.accion] ?? a.accion}</td>
                    <td>{autorAuditado(a.admin_correo)}</td>
                    <td>{a.motivo}</td>
                    <td className="suave">{cambioAuditado(a.antes, a.despues)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
          <div className="tarjeta">
            <div className="precio grande">{precio(d.precio)}</div>
            <br />
            <dl className="rejilla dos">
              <div className="dato"><dt>Categoría</dt><dd>{d.categoria ?? '—'}</dd></div>
              <div className="dato"><dt>Condición</dt><dd>{CONDICION[d.condicion] ?? d.condicion}</dd></div>
              <div className="dato"><dt>Universidad</dt><dd>{d.universidad ?? '—'}</dd></div>
              <div className="dato"><dt>Campus</dt><dd>{d.campus ?? '—'}</dd></div>
            </dl>
            <div className="titulo-seccion">Descripción</div>
            {d.descripcion ? <div className="texto">{d.descripcion}</div> : <div className="texto-suave">Sin descripción.</div>}
          </div>
          <div className="tarjeta">
            <div className="titulo-seccion">Dueño</div>
            <div className="persona">
              <div className="avatar">{iniciales(d.dueno.nombre)}</div>
              <div><div className="persona-nombre">{d.dueno.nombre ?? 'Sin nombre'}</div>
                <div className="persona-sub">{CHIP_USUARIO[d.dueno.estado][1]} · {d.dueno.reportes_en_contra} {d.dueno.reportes_en_contra === 1 ? 'reporte' : 'reportes'} en contra</div></div>
            </div>
            <button type="button" className="btn ghost-btn" onClick={() => ir({ tipo: 'usuario', id: d.dueno.id })}>Ver cuenta</button>
          </div>
          {enRevision && (
            <div className="tarjeta">
              <div className="titulo-seccion">Aprobar</div>
              {duenoSuspendido
                ? <Aviso>La cuenta del dueño está <b>suspendida</b>: no se puede aprobar mientras siga así.</Aviso>
                : sinFotos
                  ? <Aviso>La publicación <b>no tiene fotos</b>: no se puede aprobar.</Aviso>
                  : <><div className="texto-suave">Pasa a activa y aparece en el catálogo. El dueño recibe un aviso en la app.</div><br /></>}
              <button type="button" className="btn forest-btn" disabled={duenoSuspendido || sinFotos}
                onClick={() => setAprobando(true)}>Aprobar publicación</button>
            </div>
          )}
          {d.estado === 'bloqueada'
            ? <Aviso tipo="neutro" icono={<IconBan tam={12} clase="icono-blanco" />}>Esta publicación está bloqueada: no aparece en el catálogo y desde el panel no se puede desbloquear.</Aviso>
            : (
              <div className="tarjeta">
                <div className="titulo-seccion">Bloquear</div>
                <div className="texto-suave">Deja de aparecer en el catálogo y desde el panel no se puede desbloquear. El dueño recibe un aviso en la app.</div>
                <br />
                <button type="button" className="btn danger-btn" onClick={() => setBloqueando(true)}>Bloquear publicación</button>
              </div>
            )}
        </div>
      </div>

      {aprobando && (
        <ModalAprobar listingId={d.id} titulo={d.titulo}
          onCerrar={() => setAprobando(false)}
          onAprobada={() => {
            setAprobando(false);
            setExito('Publicación aprobada. El dueño recibirá un aviso en la app.');
            setRecarga((n) => n + 1);
          }} />
      )}
      {bloqueando && (
        <ModalBloquear listingId={d.id} titulo={d.titulo}
          onCerrar={() => setBloqueando(false)}
          onBloqueada={() => {
            setBloqueando(false);
            setExito('Publicación bloqueada. El dueño recibirá un aviso en la app.');
            setRecarga((n) => n + 1);
          }} />
      )}
    </>
  );
}
