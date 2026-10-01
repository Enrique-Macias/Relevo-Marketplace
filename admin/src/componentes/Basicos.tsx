import type { ReactNode } from 'react';
import { IconAlert, IconCheck, IconChevron, IconInbox, IconWifi } from './Iconos.tsx';
import { MOTIVO_MAX } from '../lib/formato.ts';

/** `.notice` del frame: error (brick), `info` (forest) o `neutro` (slate). */
export function Aviso({ tipo = 'error', icono, children }: {
  tipo?: 'error' | 'info' | 'neutro'; icono?: ReactNode; children: ReactNode;
}) {
  const clase = tipo === 'info' ? 'notice is-info' : tipo === 'neutro' ? 'notice is-neutro' : 'notice';
  return (
    <div className={clase} role={tipo === 'error' ? 'alert' : 'status'}>
      <div className="notice-icon">{icono ?? (tipo === 'info' ? <IconCheck /> : <IconAlert />)}</div>
      <div className="notice-text">{children}</div>
    </div>
  );
}

export function Chip({ clase, children }: { clase: string; children: ReactNode }) {
  return <span className={`estado ${clase}`}>{children}</span>;
}

export function Volver({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="volver" onClick={onClick}>
      <IconChevron />{children}
    </button>
  );
}

/** El campo "Motivo (3 a 500 caracteres)" con su contador y el aviso de datos personales. */
export function CampoMotivo({ id, valor, onCambio, placeholder, invalido }: {
  id: string; valor: string; onCambio: (v: string) => void; placeholder: string; invalido?: boolean;
}) {
  return (
    <div className="field">
      <div className="field-label-row">
        <label className="field-label" htmlFor={id}>Motivo (3 a 500 caracteres)</label>
        <span className="contador">{valor.trim().length}/{MOTIVO_MAX}</span>
      </div>
      <textarea id={id} className={`text-field area${invalido ? ' is-invalid' : ''}`} value={valor}
        maxLength={MOTIVO_MAX + 50} placeholder={placeholder} onChange={(e) => onCambio(e.target.value)} />
      {invalido
        ? <div className="field-error">El motivo debe tener entre 3 y 500 caracteres.</div>
        : <div className="field-help">No escribas datos personales: queda en la auditoría.</div>}
    </div>
  );
}

/** Los puntos de "Bloqueando…" (`.splash-dots`). */
export function Puntos() {
  return <span className="splash-dots"><span className="splash-dot" /><span className="splash-dot" /><span className="splash-dot" /></span>;
}

export function Vacio({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><IconInbox /></div>
      <div className="empty-title">{titulo}</div>
      <div className="empty-sub">{sub}</div>
    </div>
  );
}

export function ErrorCarga({ titulo, onReintentar }: { titulo: string; onReintentar: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon error"><IconWifi /></div>
      <div className="empty-title">{titulo}</div>
      <div className="empty-sub">Revisa tu conexión e inténtalo otra vez.</div>
      <button type="button" className="btn primary-btn" onClick={onReintentar}>Reintentar</button>
    </div>
  );
}

/** El esqueleto del frame "Cargando": filas de tabla. */
export function Esqueleto({ filas = 5 }: { filas?: number }) {
  return (
    <div className="sk-tabla" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: filas }, (_, i) => (
        <div className="sk-fila" key={i}>
          {Array.from({ length: 6 }, (_, j) => <div className="sk-line skeleton" key={j} />)}
        </div>
      ))}
    </div>
  );
}

/**
 * Los 6 dígitos del TOTP como en los frames (`.otp`): un <input> real, invisible,
 * encima de las seis cajas, para que el teclado, pegar y el autocompletado de
 * `one-time-code` funcionen igual que en un campo normal.
 */
export function CampoOtp({ id, valor, onCambio, autoFocus }: {
  id: string; valor: string; onCambio: (v: string) => void; autoFocus?: boolean;
}) {
  const digitos = valor.replace(/\D/g, '').slice(0, 6);
  return (
    <label className="otp otp-real" htmlFor={id}>
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={digitos[i] ? '' : 'vacio'}>{digitos[i] ?? '0'}</span>
      ))}
      <input id={id} className="otp-oculto" inputMode="numeric" autoComplete="one-time-code"
        aria-label="Código de 6 dígitos" value={digitos} autoFocus={autoFocus}
        onChange={(e) => onCambio(e.target.value.replace(/\D/g, '').slice(0, 6))} />
    </label>
  );
}
