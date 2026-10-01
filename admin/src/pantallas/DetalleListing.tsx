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

const iniciales = (n: string | null) =>
  (n ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';

const VEREDICTO: Record<string, string> = { limpio: 'Limpio', revisar: 'Revisar', bloquear: 'Bloquear' };

/** Las categorías del eje de texto (GPT), como las nombra `openai.ts`. */
const CATEGORIA_GPT: Record<string, string> = {
  violencia: 'violencia', estafa_spam: 'estafa o spam', datos_contacto: 'datos de contacto',
  contenido_sexual: 'contenido sexual', articulo_prohibido: 'artículo prohibido',
  odio_discriminacion: 'odio o discriminación',
};

/**
 * "Por qué" de una evaluación, legible. Lee la forma REAL de
 * `listing_moderacion.detalle` que escribe `moderar-contenido` (index.ts,
 * `Detalle`; medida en una fila de remoto): `fotos[].safe_search` (niveles de
 * Vision), `fotos[].rekognition` (`{name, confidence}` o `{estado, motivo}` si
 * no se evaluó), `lista_tecleada`/`lista_ocr` (palabras) y `gpt.veredicto`
 * (categoría → nivel) o `gpt.motivo` si falló. Lo que no explica un veredicto
 * (`lotes_vision`, `ejes`) no se pinta.
 */
function razones(detalle: Record<string, unknown> | null): string[] {
  if (!detalle) return [];
  const out: string[] = [];
  const fotos = Array.isArray(detalle.fotos) ? detalle.fotos as Record<string, unknown>[] : [];
  for (const f of fotos) {
    if (f.estado !== 'evaluada') {
      out.push(`Imagen: no evaluada${f.motivo ? ` (${String(f.motivo)})` : ''}`);
      continue;
    }
    const ss = (f.safe_search ?? {}) as Record<string, string>;
    const marcadas = Object.entries(ss).filter(([, v]) => v === 'LIKELY' || v === 'VERY_LIKELY');
    if (marcadas.length) out.push(`Imagen (Vision): ${marcadas.map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const rek = f.rekognition;
    if (Array.isArray(rek)) {
      for (const e of rek as Record<string, unknown>[]) {
        if (typeof e.name === 'string') {
          out.push(`Imagen (Rekognition): ${e.name}${typeof e.confidence === 'number' ? ` ${e.confidence.toFixed(1)}` : ''}`);
        }
      }
    } else if (rek && typeof rek === 'object') {
      out.push(`Imagen (Rekognition): no evaluada${(rek as Record<string, unknown>).motivo ? ` (${String((rek as Record<string, unknown>).motivo)})` : ''}`);
    }
  }
  const tecleada = Array.isArray(detalle.lista_tecleada) ? detalle.lista_tecleada as string[] : [];
  const ocr = Array.isArray(detalle.lista_ocr) ? detalle.lista_ocr as string[] : [];
  if (tecleada.length) out.push(`Texto: ${tecleada.join(', ')}`);
  if (ocr.length) out.push(`Texto en la foto: ${ocr.join(', ')}`);
  const gpt = detalle.gpt as Record<string, unknown> | undefined;
  if (gpt?.veredicto && typeof gpt.veredicto === 'object') {
    const marcadas = Object.entries(gpt.veredicto as Record<string, string>).filter(([, v]) => v !== 'ninguno');
    if (marcadas.length) out.push(`Texto (GPT): ${marcadas.map(([k, v]) => `${CATEGORIA_GPT[k] ?? k} ${v}`).join(', ')}`);
  } else if (gpt?.motivo) {
    out.push(`Texto (GPT): no evaluado (${String(gpt.motivo)})`);
  }
  return out;
}

/** Frame "Detalle de publicación", con sus variantes (bloqueada, foto no disponible). */
export function DetalleListing({ id, desde, ir }: { id: number; desde?: number; ir: (v: Vista) => void }) {
  const llamar = useLlamar();
  const [d, setD] = useState<Detalle | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [bloqueando, setBloqueando] = useState(false);
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

  const volver = desde !== undefined
    ? <Volver onClick={() => ir({ tipo: 'reporte', id: desde })}>Reporte #{desde}</Volver>
    : <Volver onClick={() => ir({ tipo: 'reportes' })}>Reportes</Volver>;

  if (fallo && !d) return <>{volver}<ErrorCarga titulo="No pudimos cargar la publicación" onReintentar={() => setRecarga((n) => n + 1)} /></>;
  if (!d) return <>{volver}<Esqueleto filas={3} /></>;

  const [claseEstado, textoEstado] = CHIP_LISTING[d.estado];

  return (
    <>
      {volver}
      <div className="titulo-pagina">{d.titulo} <Chip clase={claseEstado}>{textoEstado}</Chip></div>
      <div className="sub-pagina">Publicación #{d.id} · creada el {fechaDia(d.created_at)} · modificada el {fechaDia(d.updated_at)}</div>
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
