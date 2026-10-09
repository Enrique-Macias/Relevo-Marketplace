import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import type { UniversidadCatalogo } from '../lib/tipos.ts';
import { Aviso, ErrorCarga, Esqueleto } from '../componentes/Basicos.tsx';
import { ModalUniversidad } from '../componentes/ModalUniversidad.tsx';

/**
 * Frame "Catálogo — universidades" (Ola 5, `admin.catalogo()`, `…484`). Una
 * sola RPC trae universidades, campus y dominios: son pocas filas y el panel
 * no puede leer `universidad_dominios` de otra forma (no tiene grant, T27).
 */
export function Catalogo({ onAbrir }: { onAbrir: (id: number) => void }) {
  const llamar = useLlamar();
  const [unis, setUnis] = useState<UniversidadCatalogo[] | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [creando, setCreando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await llamar(() => supabase.rpc('catalogo'));
      if (!vivo) return;
      if (!r.ok) { setFallo(r.error ? textoDeRechazo(r.error) : null); return; }
      setUnis(((r.data ?? { universidades: [] }) as unknown as { universidades: UniversidadCatalogo[] }).universidades);
    })();
    return () => { vivo = false; };
  }, [recarga, llamar]);

  const reintentar = () => { setFallo(null); setUnis(null); setRecarga((n) => n + 1); };

  return (
    <>
      <div className="titulo-pagina">Catálogo</div>
      <div className="sub-pagina">Universidades, sus campus y los dominios de correo con los que sus estudiantes se registran.</div>
      {aviso && <Aviso tipo="info">{aviso}</Aviso>}
      <div className="acciones">
        <button type="button" className="btn primary-btn" onClick={() => { setAviso(null); setCreando(true); }}>
          Agregar universidad
        </button>
      </div>
      <br />
      {fallo !== null
        ? <ErrorCarga titulo="No pudimos cargar el catálogo" onReintentar={reintentar} />
        : unis === null
          ? <Esqueleto />
          : (
            <table className="tabla">
              <thead><tr><th>Universidad</th><th className="num">Campus</th><th>Dominios</th><th className="num">Usuarios</th></tr></thead>
              <tbody>
                {unis.map((u) => (
                  <tr key={u.id} className="seleccionable" tabIndex={0} onClick={() => onAbrir(u.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onAbrir(u.id); }}>
                    <td className="celda-titulo">{u.nombre}</td>
                    <td className={`num${u.campus.length === 0 ? ' suave' : ''}`}>{u.campus.length}</td>
                    <td><ResumenDominios dominios={u.dominios} /></td>
                    <td className="num">{u.usuarios}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      {creando && (
        <ModalUniversidad onCerrar={() => setCreando(false)}
          onGuardada={() => { setCreando(false); setAviso('Cambios guardados.'); setRecarga((n) => n + 1); }} />
      )}
    </>
  );
}

/** «2 activos», «1 activo · 1 desactivado» o «Sin dominios», como el frame. */
function ResumenDominios({ dominios }: { dominios: UniversidadCatalogo['dominios'] }) {
  if (dominios.length === 0) return <span className="suave">Sin dominios</span>;
  const activos = dominios.filter((d) => d.activo).length;
  const inactivos = dominios.length - activos;
  return (
    <>
      {activos} {activos === 1 ? 'activo' : 'activos'}
      {inactivos > 0 && <> · <span className="suave">{inactivos} {inactivos === 1 ? 'desactivado' : 'desactivados'}</span></>}
    </>
  );
}
