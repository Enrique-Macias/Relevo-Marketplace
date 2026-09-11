/**
 * El cuerpo del formulario de publicación — `.form-body` de los frames
 * "Publicar" y "Editar publicación".
 *
 * Es UN componente para las dos pantallas porque, tras actualizar el diseño,
 * son literalmente el mismo formulario: mismos campos, mismo orden, misma zona
 * de entrega deshabilitada. Lo que cambia entre ellas vive fuera de aquí (el
 * header, el CTA, y en Editar la `.status-section`).
 */

import { StyleSheet, View } from 'react-native';

import { Field, PhoneField, SelectField } from '@/components/Field';
import { PhotoRow } from '@/components/PhotoRow';
import { SegmentedControl } from '@/components/SegmentedControl';
import { ScreenPadding } from '@/constants/theme';
import type { Categoria } from '@/lib/categorias';
import { CONDICIONES, type ListingForm } from '@/lib/listing-form';

type ListingFormFieldsProps = {
  form: ListingForm;
  categorias: Categoria[];
  /** Nombre del campus del perfil — el valor inerte de "Zona de entrega". */
  zonaEntrega: string | undefined;
  onAgregarFoto: () => void;
  /** Congela los campos del formulario mientras se guarda. */
  disabled?: boolean;
  /**
   * Congela SOLO la fila de fotos. Cae a `disabled` si no se pasa.
   *
   * Existe porque las dos mitades se congelan por razones distintas y esas
   * razones dejaron de coincidir: la fila de fotos se congela mientras hay una
   * subida en curso (quitar una a media subida rompería el orden), y los campos
   * de texto mientras la publicación ya exista en la base con ese texto. Tras un
   * fallo de subida lo segundo sigue siendo cierto y lo primero no — y ahí el
   * usuario NECESITA poder quitar la foto que no se puede subir.
   */
  fotosDisabled?: boolean;
  /**
   * Cierto desde el tap en "Agregar" hasta que `elegirFotos()` devuelve algo
   * — lo pone la PANTALLA, no este componente, porque cubre un tramo que
   * `form.fotos` todavía no puede reflejar: mientras `launchImageLibraryAsync()`
   * no resuelve (puede tardar varios segundos más si iOS descarga la foto
   * desde iCloud), no hay ningún placeholder todavía. Se pasa tal cual a
   * `PhotoRow`, que ya sabe distinguir esto de "ya hay un placeholder" mirando
   * su propio prop `fotos` — este componente no necesita combinarlos.
   */
  eligiendoFotos?: boolean;
  /**
   * El campo de WhatsApp, que solo existe mientras el perfil no tenga número
   * (RF-13). Se pasa entero o no se pasa: sin él, el formulario es exactamente
   * el de antes, que es lo que necesita "Editar publicación".
   *
   * No sale de `form` a propósito — no es un campo de la publicación sino del
   * perfil, y se escribe en `public.users`, no en `listings`. Meterlo a
   * `useListingForm` lo haría viajar hasta `aInput()`, que arma la fila de la
   * publicación.
   */
  telefono?: { value: string; onChangeText: (v: string) => void; disabled?: boolean };
};

export function ListingFormFields({
  form,
  categorias,
  zonaEntrega,
  onAgregarFoto,
  disabled = false,
  fotosDisabled = disabled,
  eligiendoFotos = false,
  telefono,
}: ListingFormFieldsProps) {
  return (
    <View style={styles.body}>
      <PhotoRow
        fotos={form.fotos}
        onAgregar={onAgregarFoto}
        onQuitar={form.quitarFoto}
        disabled={fotosDisabled}
        eligiendoFotos={eligiendoFotos}
      />

      <Field
        label="Título"
        placeholder="Ej. Cálculo de Larson, 9a edición"
        value={form.titulo}
        onChangeText={form.setTitulo}
        editable={!disabled}
        maxLength={120}
      />

      <Field
        label="Precio"
        placeholder="$ 0.00"
        value={form.precio}
        onChangeText={form.setPrecio}
        editable={!disabled}
        // `decimal-pad` y no `numeric`: el segundo trae coma y signos en varios
        // teclados, y el precio no los admite. `parsePrecio` limpia igual, pero
        // ofrecer teclas que no sirven es invitar al error.
        keyboardType="decimal-pad"
      />

      {/*
        Las 12 categorías reales, no las 5 del frame — el prototipo dibuja una
        muestra. `.segmented` ya es `flex-wrap:wrap`, así que envuelven solas.
      */}
      <SegmentedControl
        label="Categoría"
        options={categorias.map((c) => ({ value: String(c.id), label: c.nombre }))}
        value={form.categoriaId === undefined ? undefined : String(form.categoriaId)}
        onChange={(v) => !disabled && form.setCategoriaId(Number(v))}
      />

      <SegmentedControl
        label="Condición"
        options={CONDICIONES.map((c) => ({ value: c.value, label: c.label }))}
        value={form.condicion}
        onChange={(v) => !disabled && form.setCondicion(v as typeof form.condicion)}
      />

      <Field
        label="Descripción"
        placeholder="Cuenta el estado del artículo, si tiene detalles, por qué lo vendes…"
        value={form.descripcion}
        onChangeText={form.setDescripcion}
        editable={!disabled}
        multiline
        // .textarea-field{min-height:84px; line-height:1.5;}
        style={styles.textarea}
        textAlignVertical="top"
      />

      {/*
        Zona de entrega: el campus del perfil, no una elección de esta pantalla
        (CLAUDE.md §5 — el campus se fija en "Completar perfil" y el selector del
        Feed solo cambia qué catálogo se MIRA, no dónde se entrega lo que uno
        vende). Va con el estado deshabilitado compartido del prototipo.
      */}
      <SelectField
        label="Zona de entrega"
        value={zonaEntrega}
        placeholder="Sin campus"
        onPress={() => {}}
        disabled
        containerStyle={telefono ? undefined : styles.ultimoCampo}
      />

      {/*
        Solo cuando el perfil todavía no tiene número (RF-13). Va al final y no
        arriba porque no es un dato del artículo: es lo último que falta para
        poder publicar. Ver el frame "Publicar (falta teléfono)".

        Editar publicación nunca lo pasa, así que ahí el formulario queda
        idéntico a como estaba: quien ya publicó una vez, por definición ya dio
        su número.
      */}
      {telefono ? (
        <PhoneField
          label="Tu WhatsApp"
          value={telefono.value}
          onChangeText={telefono.onChangeText}
          editable={!telefono.disabled}
          hint="Solo se comparte cuando alguien toca “Contactar por WhatsApp” en una de tus publicaciones. No aparece en tu perfil."
          containerStyle={styles.ultimoCampo}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // .form-body{padding:18px 20px 100px;} — el 100px de abajo lo aporta el
  // contentStyle de cada pantalla, que sabe cuánto mide su propio CTA.
  body: {
    paddingTop: 18,
    paddingHorizontal: ScreenPadding,
  },
  // .textarea-field{min-height:84px; line-height:1.5;}
  textarea: {
    minHeight: 84,
    lineHeight: 21, // 14 × 1.5
  },
  ultimoCampo: {
    marginBottom: 0,
  },
});
