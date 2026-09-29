import { useCallback, useState, type FormEvent } from 'react';
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase.ts';
import { clasificarRechazo, textoDeRechazo } from '../lib/rechazos.ts';
import type { Database } from '../db/admin.types.ts';

type Fila = Database['admin']['Functions']['buscar_usuarios']['Returns'][number];

interface Accion {
  id: number; accion: string; admin_correo: string; motivo: string;
  antes: Record<string, unknown> | null; despues: Record<string, unknown> | null; created_at: string;
}
interface Detalle {
  id: string; nombre: string | null; correo: string | null; universidad: string | null;
  campus: string | null; estado: 'activo' | 'suspendido'; suspendido_at: string | null;
  suspension_motivo: string | null; created_at: string; es_admin: boolean;
  publicaciones_activas: number; publicaciones_pendientes: number; activas_sin_foto: number;
  reportes_en_contra: number; auditoria: Accion[];
}

const fecha = (s: string | null) => (s ? new Date(s).toLocaleString('es-MX') : '—');
const MOTIVO_MIN = 3;
const MOTIVO_MAX = 500;

/**
 * Buscar → detalle → suspender o reactivar con motivo → su auditoría.
 * Toda llamada pasa por `llamar()`: SOLO `no_admin` cierra la sesión y SOLO
 * `mfa_requerido`/`totp_vencido` piden el TOTP y reintentan una vez
 * (`lib/rechazos.ts`). Cualquier otro rechazo se muestra y ya.
 */
export function Panel({ pedirTotp }: { pedirTotp: () => Promise<boolean> }) {
  const [q, setQ] = useState('');
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const llamar = useCallback(async <T,>(
    fn: () => PromiseLike<{ data: T | null; error: PostgrestError | null }>,
  ): Promise<{ ok: boolean; data: T | null }> => {
    for (let intento = 0; intento < 2; intento++) {
      const { data, error: err } = await fn();
      if (!err) return { ok: true, data };
      const accion = clasificarRechazo(err);
      if (accion === 'cerrar_sesion') { await supabase.auth.signOut(); return { ok: false, data: null }; }
      if (accion === 'pedir_totp' && intento === 0 && (await pedirTotp())) continue;
      setError(textoDeRechazo(err));
      return { ok: false, data: null };
    }
    return { ok: false, data: null };
  }, [pedirTotp]);

  const buscar = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null); setOk(null); setDetalle(null);
    const r = await llamar(() => supabase.rpc('buscar_usuarios', { p_q: q, p_limit: 50 }));
    if (r.ok) setFilas(r.data ?? []);
  };

  const abrir = async (id: string) => {
    setError(null); setOk(null); setMotivo('');
    const r = await llamar(() => supabase.rpc('detalle_usuario', { p_user_id: id }));
    if (r.ok) setDetalle(r.data as unknown as Detalle);
  };

  const motivoLimpio = motivo.trim();
  const motivoValido = motivoLimpio.length >= MOTIVO_MIN && motivoLimpio.length <= MOTIVO_MAX;

  const actuar = async (tipo: 'suspender' | 'reactivar') => {
    if (!detalle || !motivoValido) return;
    setOcupado(true); setError(null); setOk(null);
    const r = tipo === 'suspender'
      ? await llamar(() => supabase.rpc('suspender_usuario', { p_user_id: detalle.id, p_motivo: motivoLimpio }))
      : await llamar(() => supabase.rpc('reactivar_usuario', { p_user_id: detalle.id, p_motivo: motivoLimpio }));
    setOcupado(false);
    if (!r.ok) return;
    setOk(tipo === 'suspender'
      ? `Cuenta suspendida. Publicaciones pausadas: ${r.data as number}.`
      : 'Cuenta reactivada. Sus publicaciones siguen pausadas.');
    await abrir(detalle.id);
  };

  return (
    <div className="contenido">
      <form className="tarjeta" onSubmit={buscar}>
        <h2>Usuarios</h2>
        <label htmlFor="q">Buscar por correo o nombre</label>
        <div className="fila">
          <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="correo o nombre" />
          <button className="primario" type="submit">Buscar</button>
        </div>
      </form>

      {error && <div className="notice">{error}</div>}
      {ok && <div className="notice info">{ok}</div>}

      {filas && !detalle && (
        <div className="tarjeta">
          {filas.length === 0 ? <p className="sub">Sin resultados.</p> : (
            <table>
              <thead><tr><th>Nombre</th><th>Correo</th><th>Universidad</th><th>Estado</th><th>Publicaciones</th><th>Reportes</th></tr></thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id} className="seleccionable" onClick={() => void abrir(f.id)}>
                    <td>{f.nombre ?? '—'} {f.es_admin && <span className="chip admin">admin</span>}</td>
                    <td>{f.correo}</td>
                    <td>{f.universidad ?? '—'}</td>
                    <td><span className={`chip ${f.estado}`}>{f.estado}</span></td>
                    <td>{f.publicaciones}</td>
                    <td>{f.reportes_en_contra}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {detalle && (
        <div className="tarjeta">
          <div className="fila">
            <button className="enlace" onClick={() => setDetalle(null)}>← Resultados</button>
          </div>
          <h2>{detalle.nombre ?? 'Sin nombre'} <span className={`chip ${detalle.estado}`}>{detalle.estado}</span>
            {detalle.es_admin && <> <span className="chip admin">admin</span></>}</h2>
          <dl className="rejilla">
            <div><dt>Correo</dt><dd>{detalle.correo}</dd></div>
            <div><dt>Universidad</dt><dd>{detalle.universidad ?? '—'}</dd></div>
            <div><dt>Campus</dt><dd>{detalle.campus ?? '—'}</dd></div>
            <div><dt>Alta</dt><dd>{fecha(detalle.created_at)}</dd></div>
            <div><dt>Publicaciones activas</dt><dd>{detalle.publicaciones_activas}</dd></div>
            <div><dt>En revisión</dt><dd>{detalle.publicaciones_pendientes}</dd></div>
            <div><dt>Reportes en contra</dt><dd>{detalle.reportes_en_contra}</dd></div>
            {detalle.estado === 'suspendido' && <>
              <div><dt>Suspendida desde</dt><dd>{fecha(detalle.suspendido_at)}</dd></div>
              <div><dt>Motivo</dt><dd>{detalle.suspension_motivo}</dd></div>
            </>}
          </dl>

          {detalle.estado === 'suspendido' && detalle.publicaciones_activas > 0 && (
            <div className="notice">
              Tiene {detalle.publicaciones_activas} publicaciones activas estando suspendida. Algo las activó después de la suspensión.
            </div>
          )}

          {detalle.es_admin ? (
            detalle.estado === 'suspendido' ? null : (
              <div className="notice aviso">Es una cuenta de admin: no se suspende desde aquí. Para quitarle el acceso, se borra su fila de admins.</div>
            )
          ) : null}

          {detalle.estado === 'activo' && !detalle.es_admin && (
            <>
              <h2>Suspender</h2>
              {detalle.publicaciones_pendientes > 0 && (
                <div className="notice aviso">Tiene {detalle.publicaciones_pendientes} publicaciones en revisión: podrían activarse aun con la cuenta suspendida.</div>
              )}
              {detalle.activas_sin_foto > 0 && (
                <div className="notice aviso">{detalle.activas_sin_foto} publicaciones activas no tienen foto: al reactivarla, tendrá que subir una foto a cada una.</div>
              )}
              <p className="sub">Sus {detalle.publicaciones_activas} publicaciones activas pasarán a pausadas.</p>
            </>
          )}
          {detalle.estado === 'suspendido' && (
            <>
              <h2>Reactivar</h2>
              <p className="sub">Sus publicaciones seguirán pausadas; el usuario las reactiva él mismo.</p>
            </>
          )}
          {(detalle.estado === 'suspendido' || !detalle.es_admin) && (
            <>
              <label htmlFor="motivo">Motivo (3 a 500 caracteres). No escribas datos personales: queda en la auditoría.</label>
              <textarea id="motivo" value={motivo} maxLength={MOTIVO_MAX + 50}
                onChange={(e) => setMotivo(e.target.value)} />
              <div className="fila">
                {detalle.estado === 'activo'
                  ? <button className="peligro" disabled={!motivoValido || ocupado} onClick={() => void actuar('suspender')}>Suspender cuenta</button>
                  : <button className="confianza" disabled={!motivoValido || ocupado} onClick={() => void actuar('reactivar')}>Reactivar cuenta</button>}
                <span className="sub">{motivoLimpio.length}/{MOTIVO_MAX}</span>
              </div>
            </>
          )}

          <h2>Auditoría</h2>
          {detalle.auditoria.length === 0 ? <p className="sub">Sin acciones registradas.</p> : (
            <table>
              <thead><tr><th>Fecha</th><th>Acción</th><th>Admin</th><th>Motivo</th><th>Cambio</th></tr></thead>
              <tbody>
                {detalle.auditoria.map((a) => (
                  <tr key={a.id}>
                    <td>{fecha(a.created_at)}</td>
                    <td>{a.accion}</td>
                    <td>{a.admin_correo}</td>
                    <td>{a.motivo}</td>
                    <td className="sub">{JSON.stringify(a.antes)} → {JSON.stringify(a.despues)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
