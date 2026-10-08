import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { ACCION, CHIP_USUARIO, autorAuditado, cambioAuditado, fechaCorta, fechaDia, fechaLarga, motivoValido } from '../lib/formato.ts';
import type { DetalleUsuario, Vista } from '../lib/tipos.ts';
import type { Database } from '../db/admin.types.ts';
import { Aviso, CampoMotivo, Chip, ErrorCarga, Esqueleto, Volver } from '../componentes/Basicos.tsx';
import { IconSearch, IconShield } from '../componentes/Iconos.tsx';
import { ModalRestablecerMfa } from '../componentes/ModalRestablecerMfa.tsx';

type Fila = Database['admin']['Functions']['buscar_usuarios']['Returns'][number];

/** Lo vive Panel, para que "← Resultados" vuelva a la misma búsqueda. */
export interface Busqueda { q: string; filas: Fila[] | null }

/** Frames "Usuarios — buscar (con resultados)" y "Usuarios — sin resultados". */
export function BuscarUsuarios({ ir, busqueda, setBusqueda }: {
  ir: (v: Vista) => void; busqueda: Busqueda; setBusqueda: (b: Busqueda) => void;
}) {
  const llamar = useLlamar();
  const { q, filas } = busqueda;
  const [error, setError] = useState<string | null>(null);

  const buscar = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    const r = await llamar(() => supabase.rpc('buscar_usuarios', { p_q: q, p_limit: 50 }));
    if (r.ok) setBusqueda({ q, filas: r.data ?? [] });
    else if (r.error) setError(textoDeRechazo(r.error));
  };

  return (
    <>
      <div className="titulo-pagina">Usuarios</div>
      <div className="sub-pagina">Busca por correo o por nombre. Sin texto, las cuentas más recientes.</div>
      <form className="buscador" onSubmit={(e) => void buscar(e)}>
        <label className="text-field" htmlFor="q">
          <IconSearch clase="icono-suave" />
          <input id="q" className="buscador-input" value={q} placeholder="Correo o nombre"
            onChange={(e) => setBusqueda({ q: e.target.value, filas })} />
        </label>
        <button type="submit" className="btn primary-btn">Buscar</button>
      </form>
      <br />
      {error && <Aviso>{error}</Aviso>}
      {filas && filas.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon"><IconSearch tam={30} /></div>
          <div className="empty-title">No encontramos cuentas</div>
          <div className="empty-sub">Prueba con otro correo o con parte del nombre.</div>
        </div>
      )}
      {filas && filas.length > 0 && (
        <table className="tabla">
          <thead><tr><th>Nombre</th><th>Correo</th><th>Universidad</th><th>Estado</th>
            <th className="num">Publicaciones</th><th className="num">Reportes</th></tr></thead>
          <tbody>
            {filas.map((f) => {
              const [clase, texto] = CHIP_USUARIO[f.estado];
              return (
                <tr key={f.id} className="seleccionable" tabIndex={0} onClick={() => ir({ tipo: 'usuario', id: f.id })}
                  onKeyDown={(e) => { if (e.key === 'Enter') ir({ tipo: 'usuario', id: f.id }); }}>
                  <td className="celda-titulo">{f.nombre ?? 'Sin nombre'} {f.es_admin && <Chip clase="admin">Admin</Chip>}</td>
                  <td>{f.correo}</td>
                  <td className={f.universidad ? '' : 'suave'}>{f.universidad ?? '—'}</td>
                  <td><Chip clase={clase}>{texto}</Chip></td>
                  <td className="num">{f.publicaciones}</td>
                  <td className="num">{f.reportes_en_contra}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}

/**
 * Frames "Usuario — detalle activo (suspender)", "detalle suspendido
 * (reactivar) y auditoría" y "cuenta de admin (restablecer app
 * autenticadora)". La lógica es la de la Ola 1 (estaba en Panel.tsx); cambian
 * la maqueta y el copy, que son los del frame. La cuenta de admin (Ola 3b)
 * muestra su acceso al panel y su app autenticadora, sin la columna "Cambio"
 * en la auditoría, como su frame.
 */
export function DetalleCuenta({ id, desde, ir }: { id: string; desde?: number; ir: (v: Vista) => void }) {
  const llamar = useLlamar();
  const [d, setD] = useState<DetalleUsuario | null>(null);
  const [falloCarga, setFalloCarga] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [modalMfa, setModalMfa] = useState(false);
  // Solo para no ofrecer el botón sobre la propia cuenta (UX): el candado es la
  // guarda `no_sobre_si_mismo` de `admin.restablecer_mfa_iniciar`.
  const [yo, setYo] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setYo(data.session?.user.id ?? null));
  }, []);

  useEffect(() => {
    let vivo = true;
    void llamar(() => supabase.rpc('detalle_usuario', { p_user_id: id })).then((r) => {
      if (!vivo) return;
      if (!r.ok) { setFalloCarga(true); if (r.error) setError(textoDeRechazo(r.error)); return; }
      setFalloCarga(false);
      setD(r.data as unknown as DetalleUsuario);
    });
    return () => { vivo = false; };
  }, [id, recarga, llamar]);

  const volver = desde !== undefined
    ? <Volver onClick={() => ir({ tipo: 'reporte', id: desde })}>Reporte #{desde}</Volver>
    : <Volver onClick={() => ir({ tipo: 'usuarios' })}>Resultados</Volver>;

  if (falloCarga && !d) {
    return <>{volver}<ErrorCarga titulo="No pudimos cargar la cuenta" onReintentar={() => { setError(null); setRecarga((n) => n + 1); }} /></>;
  }
  if (!d) return <>{volver}<Esqueleto filas={3} /></>;

  const valido = motivoValido(motivo);
  const invalido = motivo.trim().length > 0 && !valido;
  const [clase, texto] = CHIP_USUARIO[d.estado];
  const puedeSuspender = d.estado === 'activo' && !d.es_admin;
  const puedeReactivar = d.estado === 'suspendido';

  const actuar = async (tipo: 'suspender' | 'reactivar') => {
    if (!valido) return;
    setOcupado(true); setError(null); setOk(null);
    const r = tipo === 'suspender'
      ? await llamar(() => supabase.rpc('suspender_usuario', { p_user_id: d.id, p_motivo: motivo.trim() }))
      : await llamar(() => supabase.rpc('reactivar_usuario', { p_user_id: d.id, p_motivo: motivo.trim() }));
    setOcupado(false);
    if (!r.ok) { if (r.error) setError(textoDeRechazo(r.error)); return; }
    setOk(tipo === 'suspender'
      ? `Cuenta suspendida. Publicaciones pausadas: ${r.data as number}.`
      : 'Cuenta reactivada. Sus publicaciones siguen pausadas.');
    setMotivo('');
    setRecarga((n) => n + 1);
  };

  return (
    <>
      {volver}
      <div className="titulo-pagina">{d.nombre ?? 'Sin nombre'} <Chip clase={clase}>{texto}</Chip>
        {d.es_admin && <Chip clase="admin">Admin</Chip>}</div>
      <div className="sub-pagina">{d.correo}</div>
      {ok && <Aviso tipo="info">{ok}</Aviso>}
      <div className="dos-columnas">
        <div>
          <div className="tarjeta">
            <dl className="rejilla tres">
              <div className="dato"><dt>Universidad</dt><dd className={d.universidad ? '' : 'suave'}>{d.universidad ?? '—'}</dd></div>
              <div className="dato"><dt>Campus</dt><dd className={d.campus ? '' : 'suave'}>{d.campus ?? '—'}</dd></div>
              <div className="dato"><dt>Alta</dt><dd>{fechaDia(d.created_at)}</dd></div>
              <div className="dato"><dt>Reportes en contra</dt><dd>{d.reportes_en_contra}</dd></div>
              {d.estado === 'suspendido' && (
                <div className="dato"><dt>Suspendida desde</dt><dd>{fechaLarga(d.suspendido_at)}</dd></div>
              )}
              {d.es_admin ? (
                <>
                  <div className="dato"><dt>Acceso al panel</dt><dd>
                    {d.admin_activado ? <Chip clase="ok">Activado</Chip> : <Chip clase="apagado">Desactivado</Chip>}</dd></div>
                  <div className="dato"><dt>App autenticadora</dt><dd>
                    {d.app_registrada ? <Chip clase="ok">Registrada</Chip> : <Chip clase="apagado">Sin registrar</Chip>}</dd></div>
                </>
              ) : (
                <>
                  <div className="dato"><dt>Publicaciones activas</dt><dd>{d.publicaciones_activas}</dd></div>
                  {d.estado === 'activo' && <div className="dato"><dt>En revisión</dt><dd>{d.publicaciones_pendientes}</dd></div>}
                  <div className="dato"><dt>Bloqueadas</dt><dd>{d.bloqueadas}</dd></div>
                </>
              )}
            </dl>
            {d.estado === 'suspendido' && d.suspension_motivo && (
              <>
                <div className="titulo-seccion">Motivo de la suspensión</div>
                <div className="texto">{d.suspension_motivo}</div>
              </>
            )}
          </div>
          {d.es_admin && (
            <Aviso tipo="neutro" icono={<IconShield tam={12} clase="icono-blanco" />}>
              Es una cuenta de admin: no se suspende desde aquí. Quitarle el acceso lo hace el admin técnico.
            </Aviso>
          )}
          {d.estado === 'suspendido' && d.publicaciones_activas > 0 && (
            <Aviso>Tiene {d.publicaciones_activas} {d.publicaciones_activas === 1 ? 'publicación activa' : 'publicaciones activas'} estando suspendida. Algo {d.publicaciones_activas === 1 ? 'la activó' : 'las activó'} después de la suspensión.</Aviso>
          )}
          <div className="titulo-seccion">Auditoría</div>
          {d.auditoria.length === 0 ? <div className="texto-suave">Sin acciones registradas.</div> : (
            <table className="tabla">
              <thead><tr><th>Fecha</th><th>Acción</th><th>Admin</th><th>Motivo</th>{!d.es_admin && <th>Cambio</th>}</tr></thead>
              <tbody>
                {d.auditoria.map((a) => (
                  <tr key={a.id}>
                    <td className="suave">{fechaCorta(a.created_at)}</td>
                    <td>{ACCION[a.accion] ?? a.accion}</td>
                    <td className={a.admin_correo === 'script:crear-admin.mjs' ? 'suave' : ''}>{autorAuditado(a.admin_correo)}</td>
                    <td>{a.motivo}</td>
                    {!d.es_admin && <td className="suave">{cambioAuditado(a.antes, a.despues)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div>
        {d.es_admin && (
          <TarjetaMfa d={d} esMiCuenta={yo === d.id} onAbrir={() => { setOk(null); setModalMfa(true); }} />
        )}
        {(puedeSuspender || puedeReactivar) && (
          <div className="tarjeta">
            <div className="titulo-seccion">{puedeSuspender ? 'Suspender' : 'Reactivar'}</div>
            {puedeSuspender && d.publicaciones_pendientes > 0 && (
              <Aviso>Tiene <b>{d.publicaciones_pendientes} {d.publicaciones_pendientes === 1 ? 'publicación en revisión' : 'publicaciones en revisión'}</b>: no se podrá aprobar mientras la cuenta esté suspendida.</Aviso>
            )}
            {puedeSuspender && d.activas_sin_foto > 0 && (
              <Aviso><b>{d.activas_sin_foto} {d.activas_sin_foto === 1 ? 'publicación activa' : 'publicaciones activas'}</b> no {d.activas_sin_foto === 1 ? 'tiene' : 'tienen'} foto: al reactivarla, tendrá que subir una foto a cada una.</Aviso>
            )}
            <div className="texto-suave">
              {puedeSuspender
                ? `Sus ${d.publicaciones_activas} publicaciones activas pasarán a pausadas.`
                : 'Sus publicaciones seguirán pausadas; el usuario las reactiva él mismo.'}
            </div>
            <br />
            <CampoMotivo id="motivo-cuenta" valor={motivo} onCambio={setMotivo} invalido={invalido}
              placeholder={puedeSuspender ? 'Por qué suspendes esta cuenta' : 'Por qué reactivas esta cuenta'} />
            {error && <Aviso>{error}</Aviso>}
            {puedeSuspender
              ? <button type="button" className="btn danger-btn" disabled={!valido || ocupado} onClick={() => void actuar('suspender')}>Suspender cuenta</button>
              : <button type="button" className="btn forest-btn" disabled={!valido || ocupado} onClick={() => void actuar('reactivar')}>Reactivar cuenta</button>}
          </div>
        )}
        </div>
      </div>
      {modalMfa && (
        <ModalRestablecerMfa userId={d.id} nombre={d.nombre ?? 'esta cuenta'}
          intentoPendiente={d.restablecimiento_pendiente}
          onCerrar={() => setModalMfa(false)}
          onCambio={() => setRecarga((n) => n + 1)}
          onHecho={() => {
            setModalMfa(false);
            setOk('App autenticadora restablecida. Su acceso queda desactivado hasta que registre una nueva y el admin técnico vuelva a activarlo.');
            setRecarga((n) => n + 1);
          }} />
      )}
    </>
  );
}

/**
 * La tarjeta "Restablecer app autenticadora" del frame de la cuenta de admin y
 * sus variantes: propia cuenta (sin botón), restablecimiento pendiente (reanuda
 * ESE intento), sin app registrada (sin botón), acceso ya desactivado y el
 * estado normal. Qué se puede de verdad lo decide la base; esto es UX.
 */
function TarjetaMfa({ d, esMiCuenta, onAbrir }: { d: DetalleUsuario; esMiCuenta: boolean; onAbrir: () => void }) {
  const boton = (
    <button type="button" className="btn danger-btn" onClick={onAbrir}>Restablecer app autenticadora</button>
  );
  if (esMiCuenta) {
    return (
      <Aviso tipo="neutro" icono={<IconShield tam={12} clase="icono-blanco" />}>
        Es tu cuenta: no puedes restablecer tu propia app autenticadora. Si perdiste el teléfono, pídeselo a otro admin por llamada de voz.
      </Aviso>
    );
  }
  if (d.restablecimiento_pendiente !== null) {
    return (
      <div className="tarjeta">
        <div className="titulo-seccion">Restablecer app autenticadora</div>
        <Aviso>El restablecimiento anterior quedó pendiente. Inténtalo de nuevo para completarlo.</Aviso>
        {boton}
      </div>
    );
  }
  if (!d.admin_activado && !d.app_registrada) {
    return (
      <Aviso tipo="neutro" icono={<IconShield tam={12} clase="icono-blanco" />}>
        No tiene app autenticadora registrada. Cuando registre una, el admin técnico la activa después de confirmar con ella por llamada.
      </Aviso>
    );
  }
  return (
    <div className="tarjeta">
      <div className="titulo-seccion">Restablecer app autenticadora</div>
      {d.admin_activado ? (
        <>
          <div className="texto-suave">Para cuando perdió o cambió el teléfono donde tiene su app autenticadora.</div>
          <br />
          <Aviso>Antes, confírmalo con esta persona <b>por llamada de voz</b>, a un número que ya tengas suyo.</Aviso>
          <div className="texto-suave">
            Su acceso al panel se desactiva en ese momento.<br />
            Se elimina la app autenticadora registrada en su cuenta. Nadie ve ni recibe un código nuevo.<br />
            Su cuenta no se borra: conserva su correo y su contraseña.<br />
            Para volver a entrar, registra la app en su teléfono nuevo y el admin técnico la activa después de confirmar con ella.
          </div>
        </>
      ) : (
        <div className="texto-suave">Su acceso ya está desactivado: al restablecer solo se elimina la app autenticadora registrada en su cuenta.</div>
      )}
      <br />
      {boton}
    </div>
  );
}
