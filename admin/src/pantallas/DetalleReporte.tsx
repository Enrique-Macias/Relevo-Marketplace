import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { CHIP_LISTING, CHIP_REPORTE, CHIP_USUARIO, MOTIVO_REPORTE, fechaLarga, motivoValido, precio } from '../lib/formato.ts';
import type { DetalleListing, DetalleUsuario, Reporte, Vista } from '../lib/tipos.ts';
import { Aviso, CampoMotivo, Chip, ErrorCarga, Esqueleto, Volver } from '../componentes/Basicos.tsx';
import { IconTag, IconUser } from '../componentes/Iconos.tsx';
import { FotoListing } from '../componentes/FotoListing.tsx';
import { ModalBloquear } from '../componentes/ModalBloquear.tsx';

const iniciales = (n: string | null) =>
  (n ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

/**
 * Frames "Reporte — objetivo: publicación / usuario / publicación eliminada /
 * cuenta eliminada", "Reporte resuelto (solo lectura)" y "Aviso de éxito".
 *
 * El reporte se lee con `listar_reportes(NULL, id + 1, 1)`: el cursor `id <`
 * con orden `id desc` y tope 1 devuelve exactamente ese reporte, sin una RPC
 * de detalle aparte. El objetivo vivo se completa con `detalle_listing` o
 * `detalle_usuario`.
 */
export function DetalleReporte({ id, ir }: { id: number; ir: (v: Vista) => void }) {
  const llamar = useLlamar();
  const [reporte, setReporte] = useState<Reporte | null>(null);
  const [listing, setListing] = useState<DetalleListing | null>(null);
  const [usuario, setUsuario] = useState<DetalleUsuario | null>(null);
  const [cargaFallida, setCargaFallida] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [bloqueando, setBloqueando] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const cargar = useCallback(async () => {
    const r = await llamar(() => supabase.rpc('listar_reportes', {
      p_estado: null as unknown as string, p_cursor: id + 1, p_limit: 1,
    }));
    if (!r.ok) return { fallo: true as const };
    const fila = ((r.data ?? []) as unknown as Reporte[]).find((x) => x.id === id) ?? null;
    if (!fila) return { fallo: true as const };
    let l: DetalleListing | null = null;
    let u: DetalleUsuario | null = null;
    if (fila.objetivo_tipo === 'publicacion' && fila.listing_id !== null) {
      const d = await llamar(() => supabase.rpc('detalle_listing', { p_id: fila.listing_id! }));
      if (d.ok) l = d.data as unknown as DetalleListing;
    } else if (fila.objetivo_tipo === 'usuario' && fila.reported_user_id) {
      const d = await llamar(() => supabase.rpc('detalle_usuario', { p_user_id: fila.reported_user_id! }));
      if (d.ok) u = d.data as unknown as DetalleUsuario;
    }
    return { fallo: false as const, fila, l, u };
  }, [id, llamar]);

  useEffect(() => {
    let vivo = true;
    void cargar().then((res) => {
      if (!vivo) return;
      if (res.fallo) { setCargaFallida(true); return; }
      setCargaFallida(false);
      setReporte(res.fila); setListing(res.l); setUsuario(res.u);
    });
    return () => { vivo = false; };
  }, [cargar, recarga]);

  const resolver = async (estado: 'resuelto' | 'descartado') => {
    if (!reporte) return;
    if (!motivoValido(motivo)) return;
    setEnviando(true); setError(null); setExito(null);
    const r = await llamar(() => supabase.rpc('resolver_reporte', { p_id: reporte.id, p_estado: estado, p_motivo: motivo.trim() }));
    setEnviando(false);
    if (!r.ok) { if (r.error) setError(textoDeRechazo(r.error)); return; }
    const sinReportante = reporte.reporter_id === null;
    setExito(estado === 'resuelto'
      ? (sinReportante ? 'Reporte resuelto. La cuenta que reportó se eliminó: nadie recibe aviso.'
                       : 'Reporte resuelto. Quien reportó recibirá un aviso en la app.')
      : (sinReportante ? 'Reporte descartado. Nadie recibe aviso porque la cuenta de quien reportó ya no existe.'
                       : 'Reporte descartado. Quien reportó recibirá un aviso en la app.'));
    setMotivo('');
    setRecarga((n) => n + 1);
  };

  if (cargaFallida && !reporte) {
    return <ErrorCarga titulo="No pudimos cargar el reporte" onReintentar={() => setRecarga((n) => n + 1)} />;
  }
  if (!reporte) return <Esqueleto filas={3} />;

  const [claseEstado, textoEstado] = CHIP_REPORTE[reporte.estado];
  const pendiente = reporte.estado === 'pendiente';
  const listo = motivoValido(motivo);

  return (
    <>
      <Volver onClick={() => ir({ tipo: 'reportes' })}>Reportes</Volver>
      <div className="titulo-pagina">Reporte #{reporte.id} <Chip clase={claseEstado}>{textoEstado}</Chip></div>
      <div className="sub-pagina">Recibido el {fechaLarga(reporte.created_at)}</div>
      {exito && <Aviso tipo="info">{exito}</Aviso>}
      <div className="dos-columnas">
        <div>
          <div className="tarjeta">
            <dl className="rejilla tres">
              <div className="dato"><dt>Motivo</dt><dd>{MOTIVO_REPORTE[reporte.motivo] ?? reporte.motivo}</dd></div>
              <div className="dato"><dt>Reportó</dt>
                <dd className={reporte.reporter_id ? '' : 'suave'}>{reporte.reporter_id ? (reporte.reporter_nombre ?? 'Sin nombre') : 'Cuenta eliminada'}</dd></div>
              {pendiente
                ? <div className="dato"><dt>Reportes de este objetivo</dt>
                    <dd className={reporte.reportes_mismo_objetivo === null ? 'suave' : ''}>{reporte.reportes_mismo_objetivo ?? '—'}</dd></div>
                : <div className="dato"><dt>{reporte.estado === 'resuelto' ? 'Resuelto' : 'Descartado'}</dt>
                    <dd className={reporte.resolved_at ? '' : 'suave'}>{reporte.resolved_at ? fechaLarga(reporte.resolved_at) : '—'}</dd></div>}
            </dl>
            <div className="titulo-seccion">Comentario de quien reportó</div>
            {reporte.comentario
              ? <div className="texto">{reporte.comentario}</div>
              : <div className="texto-suave">Sin comentario.</div>}
          </div>

          {pendiente && (
            <div className="tarjeta">
              <div className="titulo-seccion">Resolver</div>
              <CampoMotivo id="motivo-reporte" valor={motivo} onCambio={setMotivo}
                placeholder="Qué revisaste y qué decidiste" invalido={motivo.trim().length > 0 && !listo} />
              <Aviso tipo="neutro">
                {reporte.reporter_id ? 'Quien reportó recibirá un aviso en la app.'
                                     : 'La cuenta que reportó se eliminó: nadie recibe aviso al resolverlo.'}
              </Aviso>
              {error && <Aviso>{error}</Aviso>}
              <div className="acciones">
                <button type="button" className="btn primary-btn" disabled={!listo || enviando} onClick={() => void resolver('resuelto')}>Resolver</button>
                <button type="button" className="btn ghost-btn" disabled={!listo || enviando} onClick={() => void resolver('descartado')}>Descartar</button>
              </div>
            </div>
          )}
        </div>

        <div>
          <ObjetivoDetalle reporte={reporte} listing={listing} usuario={usuario} ir={ir}
            onBloquear={() => setBloqueando(true)} />
        </div>
      </div>

      {bloqueando && listing && (
        <ModalBloquear listingId={listing.id} titulo={listing.titulo}
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

function ObjetivoDetalle({ reporte, listing, usuario, ir, onBloquear }: {
  reporte: Reporte; listing: DetalleListing | null; usuario: DetalleUsuario | null;
  ir: (v: Vista) => void; onBloquear: () => void;
}) {
  if (reporte.objetivo_tipo === 'publicacion_eliminada') {
    return (
      <div className="objetivo eliminado">
        <div className="objetivo-cabeza"><span className="objetivo-tipo eliminado">Publicación eliminada</span></div>
        <dl><div className="dato"><dt>Título cuando se reportó</dt><dd>{reporte.listing_titulo}</dd></div></dl>
        <br />
        <div className="texto-suave">La publicación ya no existe. El reporte se conserva para moderación, con el título que tenía cuando se reportó. No hay fotos ni dueño que mostrar.</div>
      </div>
    );
  }
  if (reporte.objetivo_tipo === 'cuenta_eliminada') {
    return (
      <div className="objetivo eliminado">
        <div className="objetivo-cabeza"><span className="objetivo-tipo eliminado">Cuenta eliminada</span></div>
        <div className="persona">
          <div className="avatar vacio"><IconUser tam={20} /></div>
          <div><div className="persona-nombre">Sin identidad</div><div className="persona-sub">Ni nombre ni correo</div></div>
        </div>
        <div className="texto-suave">La cuenta reportada se eliminó. El reporte se conserva para moderación, sin su identidad.</div>
      </div>
    );
  }
  if (reporte.objetivo_tipo === 'usuario') {
    const estado = usuario?.estado ?? reporte.reported_user_estado;
    return (
      <div className="objetivo">
        <div className="objetivo-cabeza">
          <span className="objetivo-tipo"><IconUser tam={13} />Cuenta</span>
          {estado && <Chip clase={CHIP_USUARIO[estado][0]}>{CHIP_USUARIO[estado][1]}</Chip>}
        </div>
        <div className="persona">
          <div className="avatar">{iniciales(reporte.reported_user_nombre)}</div>
          <div><div className="persona-nombre">{reporte.reported_user_nombre ?? 'Sin nombre'}</div>
            <div className="persona-sub">{reporte.reported_user_correo}</div></div>
        </div>
        {usuario && (
          <dl className="rejilla dos">
            <div className="dato"><dt>Universidad</dt><dd>{usuario.universidad ?? '—'}</dd></div>
            <div className="dato"><dt>Campus</dt><dd>{usuario.campus ?? '—'}</dd></div>
            <div className="dato"><dt>Publicaciones activas</dt><dd>{usuario.publicaciones_activas}</dd></div>
            <div className="dato"><dt>Reportes en contra</dt><dd>{usuario.reportes_en_contra}</dd></div>
          </dl>
        )}
        <div className="titulo-seccion">Acción sobre la cuenta</div>
        <button type="button" className="btn ghost-btn"
          onClick={() => ir({ tipo: 'usuario', id: reporte.reported_user_id!, desde: reporte.id })}>Ver cuenta</button>
        <div className="field-help">Para suspenderla, ábrela: la suspensión lleva su propio motivo y queda en su auditoría.</div>
      </div>
    );
  }
  // publicacion
  const estado = listing?.estado ?? reporte.listing_estado;
  return (
    <div className="objetivo">
      <div className="objetivo-cabeza">
        <span className="objetivo-tipo"><IconTag />Publicación</span>
        {estado && <Chip clase={CHIP_LISTING[estado][0]}>{CHIP_LISTING[estado][1]}</Chip>}
      </div>
      {listing && listing.fotos.length > 0 && (
        <div className="fotos">
          {listing.fotos.slice(0, 3).map((ruta) => <FotoListing key={ruta} ruta={ruta} />)}
        </div>
      )}
      {listing && <div className="precio">{precio(listing.precio)}</div>}
      <div className="celda-titulo texto">{listing?.titulo ?? reporte.listing_titulo}</div>
      {listing && <div className="texto-suave">{[listing.universidad, listing.campus && `Campus ${listing.campus}`].filter(Boolean).join(' · ')}</div>}
      {listing && (
        <>
          <div className="titulo-seccion">Dueño</div>
          <div className="persona">
            <div className="avatar">{iniciales(listing.dueno.nombre)}</div>
            <div><div className="persona-nombre">{listing.dueno.nombre ?? 'Sin nombre'}</div>
              <div className="persona-sub">{CHIP_USUARIO[listing.dueno.estado][1]} · {listing.dueno.reportes_en_contra} {listing.dueno.reportes_en_contra === 1 ? 'reporte' : 'reportes'} en contra</div></div>
          </div>
        </>
      )}
      <div className="acciones">
        <button type="button" className="btn ghost-btn"
          onClick={() => ir({ tipo: 'listing', id: reporte.listing_id!, desde: reporte.id })}>Ver publicación</button>
        {listing && (
          <button type="button" className="btn ghost-btn"
            onClick={() => ir({ tipo: 'usuario', id: listing.dueno.id, desde: reporte.id })}>Ver cuenta del dueño</button>
        )}
      </div>
      {listing && listing.estado !== 'bloqueada' && (
        <>
          <div className="titulo-seccion">Acción sobre la publicación</div>
          <button type="button" className="btn danger-btn" onClick={onBloquear}>Bloquear publicación</button>
        </>
      )}
    </div>
  );
}
