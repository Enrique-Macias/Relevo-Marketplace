import { useState } from 'react';
import type { Vista } from '../lib/tipos.ts';
import { IconBuilding, IconChart, IconEye, IconFlag, IconUser } from '../componentes/Iconos.tsx';
import { Reportes } from './Reportes.tsx';
import { DetalleReporte } from './DetalleReporte.tsx';
import { DetalleListing } from './DetalleListing.tsx';
import { Moderacion } from './Moderacion.tsx';
import { BuscarUsuarios, DetalleCuenta, type Busqueda } from './Usuarios.tsx';
import { Catalogo } from './Catalogo.tsx';
import { DetalleUniversidad } from './DetalleUniversidad.tsx';
import { Metricas } from './Metricas.tsx';

/**
 * La cáscara del panel: la navegación lateral de los frames (Reportes,
 * Moderación, Usuarios, Catálogo, Métricas) y la vista activa. Sin router: un
 * estado. Una publicación abierta desde la cola deja "Moderación" activo; una
 * universidad deja "Catálogo".
 *
 * El modal de TOTP NO vive aquí: su único dueño es App (`lib/puerta-totp.ts`),
 * y toda llamada a `admin.*` pasa por `lib/llamar.ts`.
 */
export function Panel() {
  const [vista, setVista] = useState<Vista>({ tipo: 'reportes' });
  const [busqueda, setBusqueda] = useState<Busqueda>({ q: '', filas: null });
  const seccion = vista.tipo === 'usuarios' || vista.tipo === 'usuario'
    ? 'usuarios'
    : vista.tipo === 'moderacion' || (vista.tipo === 'listing' && vista.desde === 'moderacion')
      ? 'moderacion'
      : vista.tipo === 'catalogo' || vista.tipo === 'universidad'
        ? 'catalogo'
        : vista.tipo === 'metricas'
          ? 'metricas'
          : 'reportes';

  return (
    <div className="cuerpo">
      <nav className="lateral" aria-label="Secciones">
        <button type="button" className={`nav-item${seccion === 'reportes' ? ' active' : ''}`}
          aria-current={seccion === 'reportes' ? 'page' : undefined}
          onClick={() => setVista({ tipo: 'reportes' })}><IconFlag />Reportes</button>
        <button type="button" className={`nav-item${seccion === 'moderacion' ? ' active' : ''}`}
          aria-current={seccion === 'moderacion' ? 'page' : undefined}
          onClick={() => setVista({ tipo: 'moderacion' })}><IconEye />Moderación</button>
        <button type="button" className={`nav-item${seccion === 'usuarios' ? ' active' : ''}`}
          aria-current={seccion === 'usuarios' ? 'page' : undefined}
          onClick={() => setVista({ tipo: 'usuarios' })}><IconUser />Usuarios</button>
        <button type="button" className={`nav-item${seccion === 'catalogo' ? ' active' : ''}`}
          aria-current={seccion === 'catalogo' ? 'page' : undefined}
          onClick={() => setVista({ tipo: 'catalogo' })}><IconBuilding />Catálogo</button>
        <button type="button" className={`nav-item${seccion === 'metricas' ? ' active' : ''}`}
          aria-current={seccion === 'metricas' ? 'page' : undefined}
          onClick={() => setVista({ tipo: 'metricas' })}><IconChart />Métricas</button>
      </nav>
      <main className="contenido">
        {vista.tipo === 'reportes' && <Reportes onAbrir={(id) => setVista({ tipo: 'reporte', id })} />}
        {vista.tipo === 'moderacion' && <Moderacion onAbrir={(id) => setVista({ tipo: 'listing', id, desde: 'moderacion' })} />}
        {vista.tipo === 'reporte' && <DetalleReporte key={vista.id} id={vista.id} ir={setVista} />}
        {vista.tipo === 'listing' && <DetalleListing key={vista.id} id={vista.id} desde={vista.desde} ir={setVista} />}
        {vista.tipo === 'usuarios' && <BuscarUsuarios ir={setVista} busqueda={busqueda} setBusqueda={setBusqueda} />}
        {vista.tipo === 'usuario' && <DetalleCuenta key={vista.id} id={vista.id} desde={vista.desde} ir={setVista} />}
        {vista.tipo === 'catalogo' && <Catalogo onAbrir={(id) => setVista({ tipo: 'universidad', id })} />}
        {vista.tipo === 'universidad' && <DetalleUniversidad key={vista.id} id={vista.id} ir={setVista} />}
        {vista.tipo === 'metricas' && <Metricas />}
      </main>
    </div>
  );
}
