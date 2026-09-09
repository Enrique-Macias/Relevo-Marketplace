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

export type FotoEnEdicion = FotoSubida | FotoElegida;

/**
 * Llave estable para el `key` de React y para comparar sets entre renders.
 *
 * NO incluye `fallo`, y es deliberado: marcar una foto no es editar el set, así
 * que la miniatura no debe remontarse ni `fotosCambiaron` debe dispararse en
 * "Editar publicación".
 */
export function idFoto(foto: FotoEnEdicion): string {
  return foto.origen === 'storage' ? `s:${foto.path}` : `l:${foto.uri}`;
}

type PhotoRowProps = {
  fotos: FotoEnEdicion[];
  onAgregar: () => void;
  onQuitar: (index: number) => void;
  /** Durante el guardado la fila se congela: quitar una foto a media subida rompería el orden. */
  disabled?: boolean;
};

export function PhotoRow({ fotos, onAgregar, onQuitar, disabled = false }: PhotoRowProps) {
  const lleno = fotos.length >= MAX_FOTOS;

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
              // URI local del picker: no pasa por Storage ni necesita token.
              <Image source={{ uri: foto.uri }} style={styles.thumbFill} contentFit="cover" />
            )}

            {!disabled ? (
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
            dejar tocar un botón que va a fallar es peor UX que esconderlo. */}
        {!lleno && !disabled ? (
          <Pressable
            style={styles.add}
            onPress={onAgregar}
            accessibilityRole="button"
            accessibilityLabel="Agregar foto"
          >
            <IconPlus size={18} color={Colors.inkSoft} />
            <Text style={styles.addLabel}>Agregar</Text>
          </Pressable>
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
});
