import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { fechaDia } from '../lib/formato.ts';
import type { CampusCatalogo, UniversidadCatalogo, Vista } from '../lib/tipos.ts';
import { Aviso, Chip, ErrorCarga, Esqueleto, Volver } from '../componentes/Basicos.tsx';
import { ModalUniversidad } from '../componentes/ModalUniversidad.tsx';
import { ModalCampus } from '../componentes/ModalCampus.tsx';
import { ModalAgregarDominio } from '../componentes/ModalAgregarDominio.tsx';
import { ModalEstadoDominio } from '../componentes/ModalEstadoDominio.tsx';
import { Auditoria } from '../componentes/Auditoria.tsx';

type Modal =
  | { tipo: 'nombre' }
  | { tipo: 'campus'; campus: CampusCatalogo | null }
  | { tipo: 'dominio' }
  | { tipo: 'estado'; dominio: string; accion: 'desactivar' | 'reactivar' };

/**
 * Frame "Universidad — detalle (campus y dominios)" (Ola 5). Lee el mismo
 * `admin.catalogo()` que la lista y toma su universidad: no hay una RPC de
 * detalle porque el catálogo completo son pocas filas.
 *
 * Nada aquí decide permisos ni reglas: «sin campus no hay dominio» es la guarda
 * `universidad_sin_campus` de la RPC. El aviso del frame solo lo adelanta.
 */
export function DetalleUniversidad({ id, ir }: { id: number; ir: (v: Vista) => void }) {
  const llamar = useLlamar();
  const [uni, setUni] = useState<UniversidadCatalogo | null | undefined>(undefined);
  const [fallo, setFallo] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [modal, setModal] = useState<Modal | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await llamar(() => supabase.rpc('catalogo'));
      if (!vivo) return;
      if (!r.ok) { setFallo(r.error ? textoDeRechazo(r.error) : null); return; }
      const unis = ((r.data ?? { universidades: [] }) as unknown as { universidades: UniversidadCatalogo[] }).universidades;
      setUni(unis.find((u) => u.id === id) ?? null);
    })();
    return () => { vivo = false; };
  }, [id, recarga, llamar]);

  // Solo pasa si alguien la borró por Studio a media sesión (D12: el panel no
  // borra): sin copy propio en los frames, se vuelve a la lista.
  useEffect(() => { if (uni === null) ir({ tipo: 'catalogo' }); }, [uni, ir]);

  const listo = (texto: string) => { setModal(null); setAviso(texto); setRecarga((n) => n + 1); };
  const abrir = (m: Modal) => { setAviso(null); setModal(m); };

  const volver = <Volver onClick={() => ir({ tipo: 'catalogo' })}>Catálogo</Volver>;
  if (fallo !== null) {
    return <>{volver}<ErrorCarga titulo="No pudimos cargar la universidad"
      onReintentar={() => { setFallo(null); setUni(undefined); setRecarga((n) => n + 1); }} /></>;
  }
  if (uni === undefined) return <>{volver}<Esqueleto /></>;
  if (uni === null) return <>{volver}<Esqueleto /></>;

  const sinCampus = uni.campus.length === 0;
  const activos = uni.dominios.filter((d) => d.activo).length;

  return (
    <>
      {volver}
      <div className="titulo-pagina">{uni.nombre}</div>
      <div className="sub-pagina">{uni.campus.length} campus · {uni.usuarios} usuarios</div>
      <div className="acciones">
        <button type="button" className="btn ghost-btn" onClick={() => abrir({ tipo: 'nombre' })}>Editar nombre</button>
      </div>
      {aviso && <><br /><Aviso tipo="info">{aviso}</Aviso></>}

      <div className="titulo-seccion">Campus</div>
      {sinCampus ? (
        <>
          <Aviso>Agrega un campus antes de agregar un dominio: sin campus, quien se registre no podría completar su perfil.</Aviso>
          <div className="pie-tabla">
            <span>Esta universidad todavía no tiene campus.</span>
            <button type="button" className="btn ghost-btn" onClick={() => abrir({ tipo: 'campus', campus: null })}>Agregar campus</button>
          </div>
        </>
      ) : (
        <>
          <table className="tabla">
            <thead><tr><th>Campus</th><th>Ciudad</th><th>Coordenadas</th><th className="num">Usuarios</th><th className="num">Publicaciones</th><th /></tr></thead>
            <tbody>
              {uni.campus.map((c) => (
                <tr key={c.id}>
                  <td className="celda-titulo">{c.nombre}</td>
                  <td>{c.ciudad}</td>
                  <td className={c.latitud === null ? 'suave' : undefined}>{c.latitud === null ? '—' : 'Sí'}</td>
                  <td className="num">{c.usuarios}</td>
                  <td className="num">{c.publicaciones}</td>
                  <td><button type="button" className="enlace" onClick={() => abrir({ tipo: 'campus', campus: c })}>Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pie-tabla">
            <span>Sin coordenadas, un campus no participa en «Detectar campus más cercano»; se puede elegir a mano.</span>
            <button type="button" className="btn ghost-btn" onClick={() => abrir({ tipo: 'campus', campus: null })}>Agregar campus</button>
          </div>
        </>
      )}

      <div className="titulo-seccion">Dominios de registro</div>
      {uni.dominios.length === 0 ? (
        <div className="pie-tabla">
          <span>Sin dominios: nadie de esta universidad puede registrarse todavía.</span>
          <button type="button" className="btn ghost-btn" onClick={() => abrir({ tipo: 'dominio' })}>Agregar dominio</button>
        </div>
      ) : (
        <>
          <table className="tabla">
            <thead><tr><th>Dominio</th><th>Estado</th><th>Alta</th><th /></tr></thead>
            <tbody>
              {uni.dominios.map((d) => (
                <tr key={d.dominio}>
                  <td className="celda-titulo">{d.dominio}</td>
                  <td>{d.activo ? <Chip clase="ok">Activo</Chip> : <Chip clase="apagado">Desactivado</Chip>}</td>
                  <td className="suave">{fechaDia(d.created_at)}</td>
                  <td>
                    <button type="button" className="enlace"
                      onClick={() => abrir({ tipo: 'estado', dominio: d.dominio, accion: d.activo ? 'desactivar' : 'reactivar' })}>
                      {d.activo ? 'Desactivar' : 'Reactivar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pie-tabla">
            <span>Solo un dominio activo permite registrarse. Desactivarlo no cambia las cuentas que ya existen.</span>
            <button type="button" className="btn ghost-btn" onClick={() => abrir({ tipo: 'dominio' })}>Agregar dominio</button>
          </div>
        </>
      )}

      {/* Ola 6: universidad + sus campus + sus dominios en una llamada; se
          vuelve a leer después de cada cambio (`recarga`). */}
      <Auditoria tipo="universidad" id={String(uni.id)} recarga={recarga} />

      {modal?.tipo === 'nombre' && (
        <ModalUniversidad universidad={{ id: uni.id, nombre: uni.nombre }}
          onCerrar={() => setModal(null)} onGuardada={() => listo('Cambios guardados.')} />
      )}
      {modal?.tipo === 'campus' && (
        <ModalCampus universidad={{ id: uni.id, nombre: uni.nombre }} campus={modal.campus}
          onCerrar={() => setModal(null)} onGuardado={() => listo('Cambios guardados.')} />
      )}
      {modal?.tipo === 'dominio' && (
        <ModalAgregarDominio universidad={{ id: uni.id, nombre: uni.nombre }}
          onCerrar={() => setModal(null)} onAgregado={() => listo('Cambios guardados.')} />
      )}
      {modal?.tipo === 'estado' && (
        <ModalEstadoDominio dominio={modal.dominio} accion={modal.accion}
          ultimoActivo={modal.accion === 'desactivar' && activos === 1 && uni.usuarios > 0
            ? { universidad: uni.nombre, usuarios: uni.usuarios } : null}
          onCerrar={() => setModal(null)}
          onHecho={() => listo(modal.accion === 'desactivar'
            ? `Dominio desactivado. Nadie nuevo podrá registrarse con @${modal.dominio}.`
            : `Dominio reactivado. Ya se puede registrar con @${modal.dominio}.`)} />
      )}
    </>
  );
}
