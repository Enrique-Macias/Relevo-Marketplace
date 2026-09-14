/**
 * Frame "Reportar publicación" (RF-14) — la última pantalla del grupo Confianza.
 *
 * VIVE EN LA RAÍZ Y NO EN `(confianza)/`, al revés que "¿A quién le vendiste?" y
 * "Calificar", que son pantallas completas empujadas por el stack de su grupo.
 * Esta es una HOJA (`transparentModal`) y se abre desde Detalle, que vive en
 * `(explorar)` — o sea que la transición la resuelve el stack RAÍZ, y es ahí
 * donde tiene que declararse la presentación (CLAUDE.md §9). Es el mismo caso de
 * `filtros.tsx` y `selector-campus.tsx`, no el de `vendida/[id].tsx`.
 *
 * Solo reporta PUBLICACIONES. El esquema soporta reportar usuarios
 * (`reports.reported_user_id`), pero ese frame no existe en el diseño y queda
 * fuera de alcance.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/Buttons';
import { Field } from '@/components/Field';
import { RadioCircle } from '@/components/ListRow';
import { SheetScreen } from '@/components/SheetScreen';
import { useToast } from '@/components/Toast';
import { Colors, Typography } from '@/constants/theme';
import { crearReporte, type ReportReason } from '@/lib/confianza';
import { useSession } from '@/lib/session';

/** Los 5 motivos, en el orden del frame — que es también el orden del enum. */
const MOTIVOS: { value: ReportReason; label: string }[] = [
  { value: 'spam_publicidad', label: 'Es spam o publicidad' },
  { value: 'sospecha_fraude', label: 'Sospecho que es fraude' },
  { value: 'contenido_inapropiado', label: 'Contenido inapropiado' },
  { value: 'no_es_estudiante', label: 'No es un estudiante' },
  { value: 'otro', label: 'Otro motivo' },
];

export default function ReportarScreen() {
  const { id, sellerId } = useLocalSearchParams<{ id: string; sellerId?: string }>();
  const listingId = Number(id);
  const { session, profile } = useSession();
  const { mostrar } = useToast();

  // El frame pinta la primera opción marcada para documentar el estado
  // seleccionado; aquí nace en null, mismo criterio que las estrellas de
  // Calificar: sin elección explícita, "no elegí" y "elegí la primera" serían
  // indistinguibles.
  const [motivo, setMotivo] = useState<ReportReason | null>(null);
  const [comentario, setComentario] = useState('');
  const [enviando, setEnviando] = useState(false);

  const userId = session?.user.id ?? null;

  /**
   * Guard de autorreporte — SOLO de UX. El candado real es el `with check` de
   * `reports_insert_own` (20260914000455), que rechaza esto mire el cliente lo
   * que mire.
   *
   * `sellerId` llega por param y NO se vuelve a pedir a la base: Detalle ya
   * tiene ese dato en la mano cuando decide pintar el ícono de bandera, y es
   * exactamente el mismo campo con el que calcula `isOwner` (`listing.userId`).
   * Si fueran dos fuentes distintas podrían desincronizarse sin ningún error
   * visible.
   *
   * Cierra la hoja en vez de pintar un estado vacío dentro de ella: no hay frame
   * para "no puedes reportar esto" y no se inventa uno (§0 regla 4). Y va en un
   * efecto, no en el cuerpo del render, porque `router.back()` mueve el estado
   * del navegador — hacerlo mientras React pinta es actualizar otro componente
   * a media función.
   *
   * Si el param falta o viene manipulado, lo único que pasa es que se pinta el
   * formulario y el insert termina rechazado abajo — no es un hueco.
   */
  const esAutorreporte = userId !== null && sellerId !== undefined && userId === sellerId;

  useEffect(() => {
    if (esAutorreporte) router.back();
  }, [esAutorreporte]);

  async function enviar() {
    if (motivo === null || enviando) return;
    if (!userId) return;

    setEnviando(true);
    try {
      await crearReporte({ reporterId: userId, listingId, motivo, comentario });
      mostrar('Gracias por avisarnos. Vamos a revisarlo.');
      router.back();
    } catch (e: any) {
      // 42501 tiene DOS causas (el `with check` cubre las dos): cuenta
      // suspendida, o el guard de arriba esquivado con un param manipulado. Se
      // separan con `profile.estado`, que la sesión ya trae en PROFILE_COLUMNS
      // — el mismo recurso que usa el toast de WhatsApp en Detalle. Sin el
      // `&&`, el caso adversarial recibiría un mensaje de suspensión que sería
      // mentira.
      if (e?.code === '42501' && profile?.estado === 'suspendido') {
        mostrar('Tu cuenta no puede reportar publicaciones mientras esté suspendida', 'error');
        return;
      }
      console.warn('[reportar] no se pudo enviar:', e?.message ?? e);
      mostrar('No pudimos enviar tu reporte', 'error');
    } finally {
      setEnviando(false);
    }
  }

  // El efecto de arriba ya disparó el cierre; no se pinta el formulario en el
  // render intermedio.
  if (esAutorreporte) return null;

  return (
    <SheetScreen
      title="Reportar publicación"
      footer={
        <PrimaryButton
          label="Enviar reporte"
          onPress={enviar}
          busy={enviando}
          // El comentario es lo opcional; el motivo no (`motivo` es
          // `report_reason not null`).
          disabled={motivo === null}
          style={styles.cta}
        />
      }
    >
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>¿Cuál es el motivo?</Text>
        {MOTIVOS.map((m, i) => (
          <Pressable
            key={m.value}
            style={[styles.radioRow, i === MOTIVOS.length - 1 && styles.radioRowLast]}
            onPress={() => setMotivo(m.value)}
            disabled={enviando}
            accessibilityRole="radio"
            accessibilityState={{ selected: motivo === m.value }}
          >
            <RadioCircle selected={motivo === m.value} />
            <Text style={styles.radioLabel}>{m.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* El frame SÍ le pone `.field-label` a este campo (a diferencia del
          comentario de Calificar, que va solo con placeholder), y el "opcional"
          vive en la etiqueta, no en el placeholder. Es opcional para cualquier
          motivo, incluido "Otro". */}
      <Field
        label="Cuéntanos más (opcional)"
        placeholder="Da más contexto para que podamos revisarlo…"
        value={comentario}
        onChangeText={setComentario}
        editable={!enviando}
        multiline
        style={styles.textarea}
        textAlignVertical="top"
        containerStyle={styles.campoUltimo}
      />
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  // .field{width:100%; margin-bottom:16px;}
  field: {
    width: '100%',
    marginBottom: 16,
  },
  // style="margin-bottom:0;" — es el último del .sheet-body.
  campoUltimo: {
    marginBottom: 0,
  },
  // .field-label{font-size:12.5px; font-weight:600; margin-bottom:7px;}
  fieldLabel: {
    ...Typography.label,
    color: Colors.ink,
    marginBottom: 7,
  },
  // .radio-row{display:flex; align-items:center; gap:11px; padding:13px 0;
  //            border-bottom:1px solid var(--line);}
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  // .radio-row:last-child{border-bottom:none;}
  radioRowLast: {
    borderBottomWidth: 0,
  },
  // .radio-label{font-size:13.5px; color:var(--ink); font-weight:500;}
  radioLabel: {
    ...Typography.rowLabel,
    color: Colors.ink,
  },
  // .textarea-field{min-height:84px; line-height:1.5;}
  textarea: {
    minHeight: 84,
    lineHeight: 21, // 14 × 1.5
  },
  // .sheet-footer .primary-btn{margin-top:0;} — el footer ya da su padding.
  cta: {
    flex: 1,
    marginTop: 0,
  },
});
