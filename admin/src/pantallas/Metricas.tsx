import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { useLlamar } from '../lib/llamar.ts';
import { textoDeRechazo } from '../lib/rechazos.ts';
import { delAlSql, diaTabla, fechaSql, hoyMexico, rangoSql, restarDias } from '../lib/formato.ts';
import type { MetricaDia, MetricasResumen, UniversidadCatalogo } from '../lib/tipos.ts';
import { Aviso, ErrorCarga, Esqueleto } from '../componentes/Basicos.tsx';
import { IconChevron } from '../componentes/Iconos.tsx';

const RANGOS = [7, 30, 90] as const;
type Rango = (typeof RANGOS)[number];
type Datos = { dias: MetricaDia[]; resumen: MetricasResumen };

/**
 * Frames "Métricas — 30 días (actividad completa)" y "Métricas — registro de
 * actividad reciente («Sin datos»)" (Ola 6, D-12, D-13). `admin.metricas` (una
 * fila por día) y `admin.metricas_resumen` (totales y cobertura), las dos con
 * el mismo rango: siempre termina HOY en hora de México (D-11), por eso
 * `hoyMexico()` y no la fecha del navegador. Sin gráfica (D-13).
 *
 * Solo agregados. «Sin datos» (activos NULL: antes del inicio del registro o
 * fuera de los 90 días retenidos) se pinta distinto del 0, que es un conteo
 * real; nunca se convierte NULL en 0. Los tipos son los de `lib/tipos.ts`, no
 * los generados, que declaran esas columnas no nulas.
 */
export function Metricas() {
  const llamar = useLlamar();
  const [rango, setRango] = useState<Rango>(30);
  const [universidad, setUniversidad] = useState<number | null>(null);
  const [unis, setUnis] = useState<UniversidadCatalogo[]>([]);
  const [datos, setDatos] = useState<Datos | null>(null);
  const [fallo, setFallo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);

  const hasta = hoyMexico();
  const desde = restarDias(hasta, rango - 1);

  // La lista del selector: el mismo catálogo que ya lee el panel.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const r = await llamar(() => supabase.rpc('catalogo'));
      if (!vivo || !r.ok) return;
      setUnis(((r.data ?? { universidades: [] }) as unknown as { universidades: UniversidadCatalogo[] }).universidades);
    })();
    return () => { vivo = false; };
  }, [llamar]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const args = { p_desde: desde, p_hasta: hasta, ...(universidad === null ? {} : { p_universidad_id: universidad }) };
      const [rd, rr] = await Promise.all([
        llamar(() => supabase.rpc('metricas', args)),
        llamar(() => supabase.rpc('metricas_resumen', args)),
      ]);
      if (!vivo) return;
      if (rd.ok && rr.ok) {
        const fila = ((rr.data ?? []) as unknown as MetricasResumen[])[0];
        if (!fila) { setFallo(true); return; }
        setDatos({ dias: (rd.data ?? []) as unknown as MetricaDia[], resumen: fila });
        return;
      }
      const err = (!rd.ok && rd.error) || (!rr.ok && rr.error) || null;
      if (!err) return; // sesión cerrada o TOTP cancelado: lo resuelve la puerta
      if (err.message === 'rango_invalido' || err.message === 'universidad_no_existe') {
        setAviso(textoDeRechazo(err, 'metricas'));
        return;
      }
      setFallo(true);
    })();
    return () => { vivo = false; };
  }, [desde, hasta, universidad, recarga, llamar]);

  const cambiar = (f: () => void) => { setAviso(null); setFallo(false); setDatos(null); f(); };

  return (
    <>
      <div className="titulo-pagina">Métricas</div>
      <div className="sub-pagina">Cómo se usa Relevo, día por día. No incluye cuentas de administración.</div>
      <div className="controles">
        <div className="chips">
          {RANGOS.map((n) => (
            <button key={n} type="button" className={`chip${rango === n ? ' active' : ''}`} aria-pressed={rango === n}
              onClick={() => { if (rango !== n) cambiar(() => setRango(n)); }}>{n} días</button>
          ))}
        </div>
        <label className="selector">
          <select aria-label="Universidad" value={universidad ?? ''}
            onChange={(e) => cambiar(() => setUniversidad(e.target.value === '' ? null : Number(e.target.value)))}>
            <option value="">Todas las universidades</option>
            {unis.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          <IconChevron />
        </label>
        <span className="texto-suave">{rangoSql(desde, hasta)} · hora de México</span>
      </div>

      {aviso && <Aviso>{aviso}</Aviso>}
      {fallo
        ? <ErrorCarga titulo="No pudimos cargar las métricas" onReintentar={() => cambiar(() => setRecarga((n) => n + 1))} />
        : datos === null
          ? (aviso ? null : <Esqueleto />)
          : <Contenido datos={datos} />}
    </>
  );
}

function Contenido({ datos: { dias, resumen } }: { datos: Datos }) {
  const r = resumen;
  const notaActivos = r.activos_cobertura === 'sin_datos' || r.activos_desde === null || r.activos_hasta === null
    ? 'No hay registro de actividad para este rango.'
    : r.activos_cobertura === 'completa'
      ? 'Personas distintas en el rango, no la suma de los días.'
      : r.activos_desde === r.inicio_tracking
        ? `Personas distintas ${delAlSql(r.activos_desde, r.activos_hasta)}: el registro empezó el ${fechaSql(r.inicio_tracking).replace(/ \d{4}$/, '')}.`
        : `Personas distintas ${delAlSql(r.activos_desde, r.activos_hasta)}.`;

  return (
    <>
      <Aviso tipo="neutro">
        <b>Usuarios activos</b> cuenta a quien abrió la app ese día. Esa actividad se guarda {r.retencion_dias} días:
        los días anteriores, y los anteriores al inicio del registro ({fechaSql(r.inicio_tracking)}), aparecen como
        «Sin datos», no como cero actividad. Antes del lanzamiento, las cifras son del equipo y de testers.
      </Aviso>
      <div className="metricas-tarjetas">
        <Tarjeta nombre="Altas" valor={r.altas} nota="Cuentas nuevas en el rango." />
        <Tarjeta nombre="Usuarios activos" valor={r.activos_cobertura === 'sin_datos' ? null : r.usuarios_activos_distintos} nota={notaActivos} />
        <Tarjeta nombre="Publicaciones creadas" valor={r.publicaciones_creadas} nota="En cualquier estado." />
        <Tarjeta nombre="Contactos" valor={r.contactos} nota="Toques en «Contactar por WhatsApp»." />
      </div>
      <table className="tabla">
        <thead><tr><th>Día</th><th className="num">Altas</th><th className="num">Usuarios activos</th><th className="num">Publicaciones creadas</th><th className="num">Contactos</th></tr></thead>
        <tbody>
          {[...dias].reverse().map((d) => (
            <tr key={d.dia}>
              <td>{diaTabla(d.dia)}</td>
              <td className="num">{d.altas}</td>
              <td className="num">{d.usuarios_activos === null ? <span className="sin-datos">Sin datos</span> : d.usuarios_activos}</td>
              <td className="num">{d.publicaciones_creadas}</td>
              <td className="num">{d.contactos}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** `.metrica` del frame. NULL es «Sin datos», nunca 0. */
function Tarjeta({ nombre, valor, nota }: { nombre: string; valor: number | null; nota: string }) {
  return (
    <div className="metrica">
      <div className="metrica-nombre">{nombre}</div>
      {valor === null
        ? <div className="metrica-valor sin-datos">Sin datos</div>
        : <div className="metrica-valor">{valor}</div>}
      <div className="metrica-nota">{nota}</div>
    </div>
  );
}
