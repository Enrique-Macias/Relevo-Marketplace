/**
 * El "por qué" legible de una evaluación de moderación. Vivía en
 * `pantallas/DetalleListing.tsx`; se movió aquí porque desde la Ola 4 también lo
 * usa la cola de Moderación (la primera razón, bajo el veredicto).
 */

/** Las categorías del eje de texto (GPT), como las nombra `openai.ts`. */
const CATEGORIA_GPT: Record<string, string> = {
  violencia: 'violencia', estafa_spam: 'estafa o spam', datos_contacto: 'datos de contacto',
  contenido_sexual: 'contenido sexual', articulo_prohibido: 'artículo prohibido',
  odio_discriminacion: 'odio o discriminación',
};

/**
 * "Por qué" de una evaluación, legible. Lee la forma REAL de
 * `listing_moderacion.detalle` que escribe `moderar-contenido` (index.ts,
 * `Detalle`; medida en una fila de remoto): `fotos[].safe_search` (niveles de
 * Vision), `fotos[].rekognition` (`{name, confidence}` o `{estado, motivo}` si
 * no se evaluó), `lista_tecleada`/`lista_ocr` (palabras) y `gpt.veredicto`
 * (categoría → nivel) o `gpt.motivo` si falló. Lo que no explica un veredicto
 * (`lotes_vision`, `ejes`) no se pinta.
 */
export function razones(detalle: Record<string, unknown> | null): string[] {
  if (!detalle) return [];
  const out: string[] = [];
  const fotos = Array.isArray(detalle.fotos) ? detalle.fotos as Record<string, unknown>[] : [];
  for (const f of fotos) {
    if (f.estado !== 'evaluada') {
      out.push(`Imagen: no evaluada${f.motivo ? ` (${String(f.motivo)})` : ''}`);
      continue;
    }
    const ss = (f.safe_search ?? {}) as Record<string, string>;
    const marcadas = Object.entries(ss).filter(([, v]) => v === 'LIKELY' || v === 'VERY_LIKELY');
    if (marcadas.length) out.push(`Imagen (Vision): ${marcadas.map(([k, v]) => `${k} ${v}`).join(', ')}`);
    const rek = f.rekognition;
    if (Array.isArray(rek)) {
      for (const e of rek as Record<string, unknown>[]) {
        if (typeof e.name === 'string') {
          out.push(`Imagen (Rekognition): ${e.name}${typeof e.confidence === 'number' ? ` ${e.confidence.toFixed(1)}` : ''}`);
        }
      }
    } else if (rek && typeof rek === 'object') {
      out.push(`Imagen (Rekognition): no evaluada${(rek as Record<string, unknown>).motivo ? ` (${String((rek as Record<string, unknown>).motivo)})` : ''}`);
    }
  }
  const tecleada = Array.isArray(detalle.lista_tecleada) ? detalle.lista_tecleada as string[] : [];
  const ocr = Array.isArray(detalle.lista_ocr) ? detalle.lista_ocr as string[] : [];
  if (tecleada.length) out.push(`Texto: ${tecleada.join(', ')}`);
  if (ocr.length) out.push(`Texto en la foto: ${ocr.join(', ')}`);
  const gpt = detalle.gpt as Record<string, unknown> | undefined;
  if (gpt?.veredicto && typeof gpt.veredicto === 'object') {
    const marcadas = Object.entries(gpt.veredicto as Record<string, string>).filter(([, v]) => v !== 'ninguno');
    if (marcadas.length) out.push(`Texto (GPT): ${marcadas.map(([k, v]) => `${CATEGORIA_GPT[k] ?? k} ${v}`).join(', ')}`);
  } else if (gpt?.motivo) {
    out.push(`Texto (GPT): no evaluado (${String(gpt.motivo)})`);
  }
  return out;
}
