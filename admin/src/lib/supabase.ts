import { createClient } from '@supabase/supabase-js';
import type { Database } from '../db/admin.types.ts';

/**
 * Cliente del panel: SOLO la publishable key (rf17-plan-admin.md, restricción
 * 1: la secret key nunca llega al navegador). Toda autorización vive en la
 * base: las RPCs de `admin.*` empiezan con `private.exigir_admin()`.
 *
 * La sesión vive en localStorage (riesgo de la SPA ante un XSS): lo mitigan la
 * CSP del build (vite.config.ts) y que nada pinte HTML crudo (eslint.config.js).
 */
export const supabase = createClient<Database, 'admin'>(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { db: { schema: 'admin' } },
);

/** Mínimo de Auth (`config.toml` [auth] minimum_password_length). Traduce la regla, no la sustituye. */
export const MIN_PASSWORD = 8;
