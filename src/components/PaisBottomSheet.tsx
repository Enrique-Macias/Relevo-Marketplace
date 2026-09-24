/**
 * Frame "Selector de país" de `design/relevo-app.html`: el país del WhatsApp
 * (20260927000470). Lo abre `.phone-country` desde "Editar perfil" y desde
 * "Publicar (falta teléfono)".
 *
 * Misma forma que `CampusBottomSheet` (`.sheet-card` anclada abajo sobre el
 * `.modal-backdrop`, buscador y `ListRow` con radio; tap selecciona y cierra),
 * con dos diferencias deliberadas:
 *  - la lista es ESTÁTICA (`src/lib/paises.ts`, generada), así que no hay carga,
 *    error ni spinner;
 *  - es una `FlatList` y no un `ScrollView` con `map`: son 245 filas, y montarlas
 *    todas al abrir la hoja es trabajo que nadie ve.
 *
 * SIN bandera emoji, a propósito (CLAUDE.md §3, bloque del teléfono): cada fila
 * es nombre + "ISO · lada".
 */

import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconClose } from '@/components/icons';
import { ListRow, SearchField } from '@/components/ListRow';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';
import { PAISES, type Pais } from '@/lib/paises';

type PaisBottomSheetProps = {
  visible: boolean;
  selectedIso: string;
  onSelect: (pais: Pais) => void;
  onClose: () => void;
};

/** Minúsculas y sin acentos: "espana" encuentra España. */
function plano(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Se calcula una vez: la lista no cambia en runtime.
const INDICE = PAISES.map((p) => ({ pais: p, nombre: plano(p.nombre) }));

export function PaisBottomSheet({ visible, selectedIso, onSelect, onClose }: PaisBottomSheetProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  /**
   * Por nombre (sin acentos, contiene) o por lada: "34" y "+34" encuentran
   * España. Una lada casa por PREFIJO de sus dígitos, así que "1" trae todos los
   * de +1 (y los de +1xxx), que es lo que espera quien teclea una lada.
   */
  const filtrados = useMemo(() => {
    const q = query.trim();
    if (!q) return PAISES;
    const digitos = q.replace(/^\+/, '');
    if (/^\d+$/.test(digitos)) {
      return PAISES.filter((p) => p.lada.slice(1).startsWith(digitos));
    }
    const qp = plano(q);
    return INDICE.filter((i) => i.nombre.includes(qp)).map((i) => i.pais);
  }, [query]);

  // Mismo criterio que `CampusBottomSheet`: el cierre limpia la búsqueda, en el
  // handler y no en un efecto.
  const cerrar = () => {
    setQuery('');
    onClose();
  };

  const elegir = (pais: Pais) => {
    onSelect(pais);
    cerrar();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={cerrar}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={cerrar} accessibilityLabel="Cerrar" />

        {/* .sheet-card{max-height:70%; border-radius:20px 20px 0 0;} */}
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>País de tu WhatsApp</Text>
            <Pressable onPress={cerrar} accessibilityRole="button" hitSlop={12}>
              <IconClose size={18} color={Colors.ink} />
            </Pressable>
          </View>

          {/* El buscador va FUERA de la lista y no como su header: así no se
              desplaza con el scroll ni pierde el foco al re-renderizar. */}
          <View style={styles.search}>
            <SearchField placeholder="Busca un país o lada" value={query} onChangeText={setQuery} />
          </View>

          <FlatList
            style={styles.body}
            contentContainerStyle={[styles.bodyContent, { paddingBottom: insets.bottom + 16 }]}
            data={filtrados}
            keyExtractor={(p) => p.iso}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={15}
            renderItem={({ item, index }) => (
              <ListRow
                name={item.nombre}
                sub={`${item.iso} · ${item.lada}`}
                selected={item.iso === selectedIso}
                last={index === filtrados.length - 1}
                onPress={() => elegir(item)}
              />
            )}
            ListEmptyComponent={<Text style={styles.estado}>No encontramos ese país.</Text>}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(34,31,28,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '70%',
    backgroundColor: Colors.card,
    borderTopLeftRadius: Radii.xxl,
    borderTopRightRadius: Radii.xxl,
    overflow: 'hidden',
  },
  // .sheet-handle{width:36px; height:4px; border-radius:2px; background:var(--line); margin:10px auto 6px;}
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.line,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  // .sheet-header{padding:6px 20px 14px; border-bottom:1px solid var(--line);}
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  title: {
    ...Typography.sheetTitle,
    color: Colors.ink,
  },
  // .sheet-body{padding:18px 20px 0;} partido en dos: el buscador lleva el
  // padding de arriba y los lados, y la lista solo los lados.
  search: {
    paddingTop: 18,
    paddingHorizontal: ScreenPadding,
    marginBottom: 6,
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    paddingHorizontal: ScreenPadding,
  },
  // Mismo estilo que el "Sin resultados" de `CampusBottomSheet`.
  estado: {
    ...Typography.meta,
    color: Colors.inkSoft,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
