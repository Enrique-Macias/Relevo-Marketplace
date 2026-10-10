/**
 * Señal diaria de uso de la app (RF-17 Ola 6, D-6; 20261009000485).
 *
 * Como máximo UNA fila por persona y día (hora de México) en
 * `public.actividad_diaria`. Su única finalidad es la métrica agregada
 * "usuarios activos" del panel de admin; el registro atribuible se conserva 90
 * días y se borra con la cuenta. La app no lee nada de aquí.
 *
 * FORMA DE LA LLAMADA, y no es intercambiable: `insert({ user_id })` PLANO.
 *   - 201 → registrada; 409 / 23505 → ya estaba la de hoy. Las dos son éxito.
 *   - NO `upsert`, NO `ignoreDuplicates`, NO `.select()`: PostgREST siempre
 *     pone target en el ON CONFLICT y `.select()` es un RETURNING de columnas;
 *     los dos exigen SELECT sobre la tabla, que el cliente NO tiene a propósito
 *     (así nadie puede leer su historial de días). Darían 403 / 42501 en CADA
 *     llamada y, como aquí los errores se tragan, la métrica se quedaría en
 *     cero sin que nada fallara. Medido: docs/rf17-ola6-plan.md, anexo C, y el
 *     tripwire de `scripts/probe-actividad.mjs`.
 *   - El día lo pone el servidor (default de la columna). El cliente no puede
 *     mandarlo.
 *
 * Deduplicación SOLO EN MEMORIA (D-15): después de un éxito no se vuelve a
 * llamar hasta que cambie el día o la cuenta. La clave de día es solo para no
 * repetir: un error en ella cuesta como mucho un insert de más, que da 23505.
 * Tras un arranque en frío se pierde y hay un insert más (inofensivo).
 *
 * Cualquier otro error (sin red, 5xx, la tabla aún no existe en el remoto) se
 * registra con `console.warn` y NO marca el día: se reintenta en el siguiente
 * foreground o arranque. Sin toast: no es algo que el usuario pueda resolver.
 */
import { supabase } from '@/lib/supabase';

/**
 * El día calendario de México, como "AAAA-MM-DD", solo para deduplicar.
 * México no tiene horario de verano desde 2022 (UTC-6 todo el año), así que no
 * depende del soporte de zonas horarias de `Intl` en Hermes. La fuente de
 * verdad del día es el servidor.
 */
export function diaMexico(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

let ultimoEnviado: { userId: string; dia: string } | null = null;
let enCurso = false;

/**
 * Registra la señal de hoy de `userId`, como mucho una vez por día y cuenta.
 * Nunca lanza: es telemetría de producto, no puede frenar nada.
 */
export async function registrarActividad(userId: string): Promise<void> {
  const dia = diaMexico();
  if (enCurso) return;
  if (ultimoEnviado && ultimoEnviado.userId === userId && ultimoEnviado.dia === dia) return;

  enCurso = true;
  try {
    const { error } = await supabase.from('actividad_diaria').insert({ user_id: userId });
    if (!error || error.code === '23505') {
      ultimoEnviado = { userId, dia };
    } else {
      console.warn('[actividad] no se pudo registrar la señal de hoy:', error.code, error.message);
    }
  } catch (e) {
    console.warn('[actividad] no se pudo registrar la señal de hoy:', e instanceof Error ? e.message : e);
  } finally {
    enCurso = false;
  }
}
