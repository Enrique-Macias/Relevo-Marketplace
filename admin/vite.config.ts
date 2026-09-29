import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// CSP estricta SOLO en el build: en dev, el preámbulo de React Refresh es un
// script inline y `script-src 'self'` lo bloquearía. En producción (Ola 3,
// Cloudflare Pages) la CSP viaja además como header en `_headers`, junto con
// `frame-ancestors 'none'`, que una etiqueta <meta> no puede expresar.
function csp(supabaseUrl: string): Plugin {
  const politica = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    // El QR del enrolamiento TOTP llega como data URI SVG (mfa.enroll).
    "img-src 'self' data:",
    `connect-src 'self' ${supabaseUrl}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
  return {
    name: 'relevo-admin-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${politica}" />`),
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (ver admin/.env.example)');
  }
  return {
    plugins: [react(), csp(env.VITE_SUPABASE_URL)],
    server: { port: 5173, strictPort: true },
  };
});
