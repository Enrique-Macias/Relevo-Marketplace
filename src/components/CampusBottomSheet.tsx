/**
 * Frame "Completar perfil (selector de campus)" de `design/relevo-app.html`.
 *
 * `.sheet-card` anclada abajo sobre un `.modal-backdrop` oscurecido — ver el
 * comentario de esa clase en el CSS para el porqué no existía antes: los
 * frames de Explorar (Filtros, Reportar publicación, Selector de campus)
 * siempre llenan `.device` completo porque el mockup estático no puede
 * componer "pantalla de fondo + hoja encima" salvo cuando de verdad dibuja
 * ambas capas, como aquí.
 *
 * Reusa el mismo comportamiento de datos que tenía el selector de pantalla
 * completa que reemplaza (`selector-campus.tsx`, ahora borrado): tap en una
 * fila selecciona y cierra, sin botón de confirmar aparte.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconClose } from '@/components/icons';
import { ListRow, SearchField } from '@/components/ListRow';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';
import { fetchCampus } from '@/lib/catalogos';

export type CampusSeleccionado = { id: number; nombre: string };

type CampusBottomSheetProps = {
  visible: boolean;
  /** El campus depende de la universidad ya elegida — nunca se abre sin ella. */
  universidadId: number | null;
  selectedId: number | null;
  onSelect: (item: CampusSeleccionado) => void;
  onClose: () => void;
};

export function CampusBottomSheet({
  visible,
  universidadId,
  selectedId,
  onSelect,
  onClose,
}: CampusBottomSheetProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<{ id: number; nombre: string; ciudad: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  // De qué universidad son los `items`/`error` que tenemos. Comparado contra
  // `universidadId` da el "¿ya cargó esto?" sin escribir estado síncronamente
  // dentro del efecto (mismo patrón que `perfilCargadoPara` en session.tsx).
  const [cargadoPara, setCargadoPara] = useState<number | null>(null);

  useEffect(() => {
    if (!visible || !universidadId) return;
    let activo = true;
    fetchCampus(universidadId)
      .then((data) => {
        if (!activo) return;
        setItems(data);
        setError(null);
        setCargadoPara(universidadId);
      })
      .catch((e) => {
        if (!activo) return;
        setError(e.message ?? 'No se pudo cargar el catálogo');
        setCargadoPara(universidadId);
      });
    return () => {
      activo = false;
    };
  }, [visible, universidadId]);

  const cargando = universidadId !== null && cargadoPara !== universidadId;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (cargando) return [];
    if (!q) return items;
    return items.filter(
      (item) =>
        item.nombre.toLowerCase().includes(q) || item.ciudad.toLowerCase().includes(q)
    );
  }, [items, query, cargando]);

  // El cierre siempre limpia la búsqueda — así la próxima vez que se abra no
  // arrastra el texto de la sesión anterior. Vive en los handlers, no en un
  // efecto: es una reacción a un evento, no una sincronización con algo externo.
  const cerrar = () => {
    setQuery('');
    onClose();
  };

  const elegir = (item: { id: number; nombre: string }) => {
    onSelect(item);
    cerrar();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={cerrar}>
      {/*
        KeyboardAvoidingView es el propio backdrop: al abrir el teclado, en iOS
        se rellena de padding-bottom igual a la altura del teclado (y en
        Android se encoge la propia vista) — como el sheet está anclado con
        justifyContent:'flex-end', sube solo, en vez de quedar tapado detrás.
      */}
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* .modal-backdrop con align-items:flex-end en vez de centrado — mismo backdrop, ancla la tarjeta abajo. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={cerrar} accessibilityLabel="Cerrar" />

        {/* .sheet-card{max-height:70%; border-radius:20px 20px 0 0;} */}
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Tu campus</Text>
            <Pressable onPress={cerrar} accessibilityRole="button" hitSlop={12}>
              <IconClose size={18} color={Colors.ink} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={[
              styles.bodyContent,
              // Sin esto el último renglón queda a ras del home indicator —
              // el sheet no pasa por SafeAreaView (está anclado al borde del
              // Modal, no de la pantalla), así que el inset se suma a mano.
              { paddingBottom: insets.bottom + 16 },
            ]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.search}>
              <SearchField placeholder="Busca tu campus" value={query} onChangeText={setQuery} />
            </View>

            {cargando && !error ? (
              <ActivityIndicator style={styles.estado} color={Colors.inkSoft} />
            ) : null}
            {error ? <Text style={styles.estado}>{error}</Text> : null}
            {!cargando && filtered.length === 0 ? (
              <Text style={styles.estado}>
                {query ? 'Sin resultados' : 'Esta universidad todavía no tiene campus dados de alta.'}
              </Text>
            ) : null}

            {filtered.map((item, i) => (
              <ListRow
                key={item.id}
                name={item.nombre}
                sub={item.ciudad}
                selected={item.id === selectedId}
                last={i === filtered.length - 1}
                onPress={() => elegir(item)}
              />
            ))}
          </ScrollView>
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
    // Antes no estaba: sin esto una lista de campus más larga que el 70% de
    // la pantalla se salía por debajo de las esquinas redondeadas en vez de
    // quedar contenida y scrolleable.
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
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  // .sheet-body{padding:18px 20px 0;} — el paddingBottom dinámico (insets +
  // 16) se agrega aparte, en el JSX, porque depende de useSafeAreaInsets().
  bodyContent: {
    paddingTop: 18,
    paddingHorizontal: ScreenPadding,
  },
  search: {
    marginBottom: 6,
  },
  estado: {
    ...Typography.meta,
    color: Colors.inkSoft,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
