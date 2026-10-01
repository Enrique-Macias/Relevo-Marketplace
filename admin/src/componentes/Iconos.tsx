/**
 * Los íconos de `design/admin-panel.html` (sus `<symbol>`), como componentes.
 * Mismos paths: si el diseño cambia uno, cambia ahí primero y después aquí.
 */
type P = { tam?: number; clase?: string };

const base = (tam: number, clase?: string) => ({
  width: tam, height: tam, viewBox: '0 0 24 24', fill: 'none', className: clase, 'aria-hidden': true,
});

export const IconFlag = ({ tam = 18, clase }: P) => (
  <svg {...base(tam, clase)}><path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>
);
export const IconUser = ({ tam = 18, clase }: P) => (
  <svg {...base(tam, clase)}><g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" /></g></svg>
);
export const IconSearch = ({ tam = 16, clase }: P) => (
  <svg {...base(tam, clase)}><g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></g></svg>
);
export const IconTag = ({ tam = 13, clase }: P) => (
  <svg {...base(tam, clase)}><g stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.3" /></g></svg>
);
export const IconBan = ({ tam = 24, clase }: P) => (
  <svg {...base(tam, clase)}><g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><path d="M6 6l12 12" /></g></svg>
);
export const IconLock = ({ tam = 24, clase }: P) => (
  <svg {...base(tam, clase)}><g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></g></svg>
);
export const IconShield = ({ tam = 24, clase }: P) => (
  <svg {...base(tam, clase)}><path stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /></svg>
);
export const IconImage = ({ tam = 22, clase }: P) => (
  <svg {...base(tam, clase)}><g stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3 16l5-5 4 4 3-3 6 6" /></g></svg>
);
export const IconChevron = ({ tam = 14, clase }: P) => (
  <svg {...base(tam, clase)}><path stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M15 5l-7 7 7 7" /></svg>
);
export const IconAlert = ({ tam = 12, clase }: P) => (
  <svg {...base(tam, clase)}><g stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M12 7v6" /><path d="M12 17h.01" /></g></svg>
);
export const IconCheck = ({ tam = 12, clase }: P) => (
  <svg {...base(tam, clase)}><path stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" d="M6 12.5l4 4 8-9" /></svg>
);
export const IconInbox = ({ tam = 30, clase }: P) => (
  <svg {...base(tam, clase)}><g stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M3 13l3-8h12l3 8v6H3z" /><path d="M3 13h5l1.5 2.5h5L16 13h5" /></g></svg>
);
export const IconWifi = ({ tam = 30, clase }: P) => (
  <svg {...base(tam, clase)}><g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 9a12 12 0 0 1 16 0" /><path d="M7 12.5a7.5 7.5 0 0 1 10 0" /><path d="M10 16a3 3 0 0 1 4 0" /><path d="M12 19.5h.01" /></g></svg>
);
