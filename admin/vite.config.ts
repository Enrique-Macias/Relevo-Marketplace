import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// CSP estricta SOLO en el build: en dev, el preámbulo de React Refresh es un
// script inline y `script-src 'self'` lo bloquearía. En producción (Ola 3,
// Cloudflare Pages) la CSP viaja además como header en `dist/_headers`, que
// este mismo plugin genera, junto con `frame-ancestors 'none'`, que una
// etiqueta <meta> no puede expresar.
function csp(supabaseUrl: string): Plugin {
  const politica = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    // Fuentes autoalojadas en public/fonts (D-A1 de la Ola 2): sin terceros.
    "font-src 'self'",
    // `data:` — el QR del enrolamiento TOTP llega como data URI SVG (mfa.enroll).
    // `blob:` — las fotos del bucket privado: se descargan con el token de la
    // sesión (`storage.download()`) y se pintan como object URL (FotoListing).
    "img-src 'self' data: blob:",
    `connect-src 'self' ${supabaseUrl}`,
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ].join('; ');
  // `_headers` de Cloudflare Pages (Ola 3), generado de la MISMA `politica`
  // que la <meta>: una sola fuente, así que no pueden divergir. El header
  // suma lo que una <meta> no puede expresar (`frame-ancestors`) y los
  // encabezados de transporte y de embebido.
  const headers = [
    '/*',
    `  Content-Security-Policy: ${politica}; frame-ancestors 'none'`,
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
    '  X-Frame-Options: DENY',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    '',
  ].join('\n');
  return {
    name: 'relevo-admin-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${politica}" />`),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headers });
    },
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
