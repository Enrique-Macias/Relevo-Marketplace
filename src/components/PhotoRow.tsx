/**
 * `.field-label-row` + `.photo-row` / `.photo-thumb` / `.photo-add` /
 * `.photo-remove` — la fila de fotos de Publicar y Editar publicación.
 *
 * Maneja una lista MIXTA a propósito: en Publicar todas las entradas son URIs
 * locales del picker (todavía no existe el listing, así que no pueden estar en
 * Storage — ver `crearListing()`), y en Editar conviven las ya subidas (que se
 * leen del bucket con `ListingPhoto`) con las recién elegidas. El discriminante
 * `origen` es lo que decide cómo se pinta cada una y, al guardar, cuáles hay
 * que subir.
 */

import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BlinkingDots } from '@/components/BlinkingDots';
import { IconClose, IconPlus } from '@/components/icons';
import { ListingPhoto } from '@/components/ListingPhoto';
import { Colors, Radii, Typography } from '@/constants/theme';
import { MAX_FOTOS } from '@/lib/storage';

/** Una foto ya en el bucket: se identifica por su `listing_photos.storage_path`. */
export type FotoSubida = { origen: 'storage'; path: string };

/**
 * Por qué no subió una foto.
 *
 * `tamaño` y `formato` son DETERMINISTAS: el archivo no cambia entre intentos,
 * así que reintentarlos es gastar red a sabiendas. `transporte` es lo único que
 * un reintento puede resolver. Esa distinción es la que decide si la pantalla
 * ofrece "Reintentar" o pide quitar la foto — ver `fallosDe()` en
 * `src/lib/publicar.ts`.
 */
export type MotivoFallo = 'tamaño' | 'formato' | 'transporte';

/**
 * Una foto recién elegida del carrete: solo existe como URI local hasta el
 * guardado.
 *
 * `fallo` lo escribe `subirPendientes()` en cada pasada. Vive AQUÍ y no en el
 * estado de la pantalla a propósito: así el aviso se deriva de `form.fotos` en
 * cada render y las posiciones que nombra son siempre las actuales — si el
 * usuario quita la foto 2, la que era 4 pasa a ser 3 y el texto lo refleja solo.
 * Un texto guardado en estado seguiría nombrando fotos ya quitadas.
 */
export type FotoElegida = {
  origen: 'local';
  uri: string;
  mimeType?: string | null;
  fallo?: MotivoFallo;
};

/**
 * Un asset recién elegido del carrete, todavía SIN pasar por `normalizar()`
 * (filtrado de formato + re-encode a JPEG, `src/lib/foto-picker.ts`). Mientras
 * exista una fila en este estado, `elegirFotos()` sigue trabajando sobre ella
 * — nunca es el resultado final, solo un lugar donde pintar la foto real
 * mientras se procesa.
 *
 * `uri` es la MISMA uri cruda del picker con la que luego se llama
 * `normalizar(asset)`: es lo que conecta este placeholder con su reemplazo
 * (`reemplazarPlaceholder` en `src/lib/listing-form.ts`), sin necesitar un id
 * aparte.
 */
export type FotoProcesando = { origen: 'procesando'; uri: string };

export type FotoEnEdicion = FotoSubida | FotoElegida | FotoProcesando;

/**
 * El subconjunto de `FotoEnEdicion` que ya puede pasar por `src/lib/publicar.ts`:
 * nunca a medio elegir. `puedeGuardar` (`src/lib/listing-form.ts`) ya excluye
 * cualquier `'procesando'` antes de que el usuario pueda tocar "Guardar"/
 * "Publicar artículo" — este tipo es lo que hace que esa garantía se vea en la
 * firma de las funciones de guardado, no solo en el botón.
 */
export type FotoParaGuardar = FotoSubida | FotoElegida;

/**
 * Llave estable para el `key` de React y para comparar sets entre renders.
 *
 * NO incluye `fallo`, y es deliberado: marcar una foto no es editar el set, así
 * que la miniatura no debe remontarse ni `fotosCambiaron` debe dispararse en
 * "Editar publicación".
 */
export function idFoto(foto: FotoEnEdicion): string {
  if (foto.origen === 'storage') return `s:${foto.path}`;
  if (foto.origen === 'procesando') return `p:${foto.uri}`;
  return `l:${foto.uri}`;
}

type PhotoRowProps = {
  fotos: FotoEnEdicion[];
  onAgregar: () => void;
  onQuitar: (index: number) => void;
  /** Durante el guardado la fila se congela: quitar una foto a media subida rompería el orden. */
  disabled?: boolean;
  /**
   * Cierto desde el tap en "Agregar" hasta que exista el primer resultado del
   * picker — cubre el tramo en el que `fotos` todavía no cambió en nada pero
   * el picker nativo puede seguir resolviendo (a veces varios segundos, si
   * iOS necesita descargar la foto elegida desde iCloud). Mientras esto es
   * cierto y TODAVÍA no hay ningún placeholder, el tile "+" se reemplaza por
   * uno no interactivo con `BlinkingDots` — frame "Publicar (procesando
   * fotos)", variante documentada junto al `.photo-row`. En cuanto aparece el
   * primer placeholder (`fotos.some(origen === 'procesando')`, que este
   * componente ya puede ver solo con su propio prop `fotos`) el tile
   * desaparece del todo: ese es el estado ya aprobado antes de este cambio,
   * sin tocar.
   */
  eligiendoFotos?: boolean;
};

export function PhotoRow({
  fotos,
  onAgregar,
  onQuitar,
  disabled = false,
  eligiendoFotos = false,
}: PhotoRowProps) {
  const lleno = fotos.length >= MAX_FOTOS;
  // Ya hay al menos un placeholder: el `.photo-add` se esconde del todo (sin
  // reemplazo), empezar un segundo lote antes de que termine el primero no
  // tiene un slot limpio donde ir.
  const hayPlaceholder = fotos.some((f) => f.origen === 'procesando');

  return (
    <View style={styles.field}>
      {/* .field-label-row — el contador hace visible el tope ANTES de que el
          `.photo-add` desaparezca sin explicación. */}
      <View style={styles.labelRow}>
        <Text style={styles.label}>Fotos</Text>
        <Text style={styles.count}>
          {fotos.length}/{MAX_FOTOS}
        </Text>
      </View>

      <View style={styles.row}>
        {fotos.map((foto, i) => (
          <View key={idFoto(foto)} style={styles.thumb}>
            {foto.origen === 'storage' ? (
              // Ya está en el bucket privado: se lee por el endpoint autenticado.
              <ListingPhoto path={foto.path} fallback={null} style={styles.thumbFill} />
            ) : (
              // URI local: la del picker (origen 'local' o 'procesando') no pasa
              // por Storage ni necesita token, se pinta tal cual.
              <Image source={{ uri: foto.uri }} style={styles.thumbFill} contentFit="cover" />
            )}

            {/* Foto real de fondo + scrim + splash-dots: mismo indicador de
                espera que ya usa el botón "Subiendo imágenes", puesto sobre la
                foto que ya se eligió en vez de un placeholder genérico —
                responde directo a "parece que no se cargó" (frame "Publicar
                (procesando fotos)", `/design/relevo-app.html`). */}
            {foto.origen === 'procesando' ? (
              <View style={styles.scrim}>
                <BlinkingDots style={styles.scrimDots} />
              </View>
            ) : null}

            {/* Nada que quitar de una foto que no terminó de existir. */}
            {!disabled && foto.origen !== 'procesando' ? (
              <Pressable
                style={styles.remove}
                onPress={() => onQuitar(i)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Quitar foto ${i + 1}`}
              >
                <IconClose size={8} color={Colors.paper} />
              </Pressable>
            ) : null}
          </View>
        ))}

        {/* El `.photo-add` desaparece al llegar al tope, igual que en el frame:
            el trigger `enforce_photo_limit()` ya rechazaría la sexta, pero
            dejar tocar un botón que va a fallar es peor UX que esconderlo.
            También desaparece del todo en cuanto hay un placeholder. */}
        {!lleno && !disabled && !hayPlaceholder ? (
          eligiendoFotos ? (
            // El picker sigue resolviendo y todavía no hay nada que mostrar
            // en su lugar (ni se sabe cuántas fotos van a volver). MISMO slot
            // 76x76 con borde punteado, pero `View`, no `Pressable`: sin
            // `onPress` ni `accessibilityRole="button"` — no debe invitar al
            // toque, no solo verse ocupado.
            <View style={styles.add}>
              <BlinkingDots style={styles.addBusyDots} />
            </View>
          ) : (
            <Pressable
              style={styles.add}
              onPress={onAgregar}
              accessibilityRole="button"
              accessibilityLabel="Agregar foto"
            >
              <IconPlus size={18} color={Colors.inkSoft} />
              <Text style={styles.addLabel}>Agregar</Text>
            </Pressable>
          )
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    width: '100%',
    marginBottom: 22, // `.photo-row{margin-bottom:22px}`
  },
  // .field-label-row{display:flex; align-items:baseline; justify-content:space-between; margin-bottom:7px;}
  labelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  label: {
    ...Typography.label,
    color: Colors.ink,
  },
  // .photo-count{font-size:11.5px; color:var(--ink-soft);}
  count: {
    ...Typography.rowSub,
    color: Colors.inkSoft,
  },
  // .photo-row{display:flex; gap:10px;} — el margin-bottom vive en `field`.
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  // .photo-thumb{width:76px; height:76px; border-radius:14px; position:relative;}
  thumb: {
    width: 76,
    height: 76,
    borderRadius: Radii.lg,
    backgroundColor: Colors.brickTint, // el `style="background:var(--brick-tint)"` del frame
  },
  thumbFill: {
    width: '100%',
    height: '100%',
    borderRadius: Radii.lg,
  },
  // .photo-thumb .thumb-scrim{position:absolute; inset:0; border-radius:14px;
  //   background:rgba(34,31,28,0.55);} — mismo tono que .photo-remove, no un
  // color nuevo.
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radii.lg,
    backgroundColor: 'rgba(34,31,28,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `.splash-dots` trae un margin-top pensado para el Splash; aquí, centrado
  // dentro del scrim, se anula igual que en `.primary-btn.is-busy`.
  scrimDots: {
    marginTop: 0,
  },
  // .photo-remove{top:-6px; right:-6px; width:20px; height:20px; border-radius:50%;
  //   background:rgba(34,31,28,0.55); border:2px solid var(--paper);}
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(34,31,28,0.55)',
    borderWidth: 2,
    borderColor: Colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // .photo-add{width:76px; height:76px; border-radius:14px; border:1.5px dashed var(--line);
  //   gap:4px; font-size:9.5px; font-weight:500;}
  add: {
    width: 76,
    height: 76,
    borderRadius: Radii.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  addLabel: {
    // 9.5px/500 no tiene rol en `Typography` (el más chico es `tabLabel`, 10/500)
    // y solo lo usa este control, así que se declara aquí.
    fontFamily: Typography.tabLabel.fontFamily,
    fontSize: 9.5,
    color: Colors.inkSoft,
  },
  // `.photo-add.is-busy .splash-dots{margin-top:0;}` — mismo motivo que
  // `scrimDots`: el margen de `.splash-dots` es para el Splash, no para un
  // tile de 76px.
  addBusyDots: {
    marginTop: 0,
  },
});
