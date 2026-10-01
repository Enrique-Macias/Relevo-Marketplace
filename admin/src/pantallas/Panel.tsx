import { useState } from 'react';
import type { Vista } from '../lib/tipos.ts';
import { IconFlag, IconUser } from '../componentes/Iconos.tsx';
import { Reportes } from './Reportes.tsx';
import { DetalleReporte } from './DetalleReporte.tsx';
import { DetalleListing } from './DetalleListing.tsx';
import { BuscarUsuarios, DetalleCuenta, type Busqueda } from './Usuarios.tsx';

/**
 * La cáscara del panel: la navegación lateral de los frames (Reportes,
 * Usuarios) y la vista activa. Sin router: un estado. Nada de las olas 4-6.
 *
 * El modal de TOTP NO vive aquí: su único dueño es App (`lib/puerta-totp.ts`),
 * y toda llamada a `admin.*` pasa por `lib/llamar.ts`.
 */
export function Panel() {
  const [vista, setVista] = useState<Vista>({ tipo: 'reportes' });
  const [busqueda, setBusqueda] = useState<Busqueda>({ q: '', filas: null });
  const seccion = vista.tipo === 'usuarios' || vista.tipo === 'usuario' ? 'usuarios' : 'reportes';

  return (
    <div className="cuerpo">
      <nav className="lateral" aria-label="Secciones">
        <button type="button" className={`nav-item${seccion === 'reportes' ? ' active' : ''}`}
          aria-current={seccion === 'reportes' ? 'page' : undefined}
          onClick={() => setVista({ tipo: 'reportes' })}><IconFlag />Reportes</button>
        <button type="button" className={`nav-item${seccion === 'usuarios' ? ' active' : ''}`}
          aria-current={seccion === 'usuarios' ? 'page' : undefined}
          onClick={() => setVista({ tipo: 'usuarios' })}><IconUser />Usuarios</button>
      </nav>
      <main className="contenido">
        {vista.tipo === 'reportes' && <Reportes onAbrir={(id) => setVista({ tipo: 'reporte', id })} />}
        {vista.tipo === 'reporte' && <DetalleReporte key={vista.id} id={vista.id} ir={setVista} />}
        {vista.tipo === 'listing' && <DetalleListing key={vista.id} id={vista.id} desde={vista.desde} ir={setVista} />}
        {vista.tipo === 'usuarios' && <BuscarUsuarios ir={setVista} busqueda={busqueda} setBusqueda={setBusqueda} />}
        {vista.tipo === 'usuario' && <DetalleCuenta key={vista.id} id={vista.id} desde={vista.desde} ir={setVista} />}
      </main>
    </div>
  );
}
