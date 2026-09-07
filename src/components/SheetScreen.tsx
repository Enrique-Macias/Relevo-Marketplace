/**
 * Shell de hoja para pantallas de `(explorar)/` presentadas por el Stack con
 * `presentation:'transparentModal'` (Selector de campus, Filtros) — NO es un
 * `Modal` de RN como `CampusBottomSheet.tsx` (ese sigue siendo el que usa
 * Completar perfil, un caso de uso distinto). Aquí el propio Stack ya da el
 * comportamiento de "modal" (overlay + animación); este componente solo
 * dibuja el contenido: el backdrop oscurecido y la tarjeta anclada abajo.
 */

import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconClose } from '@/components/icons';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';

type SheetScreenProps = {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function SheetScreen({ title, children, footer }: SheetScreenProps) {
  const insets = useSafeAreaInsets();

  return (
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => router.back()} accessibilityLabel="Cerrar" />

      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
            <IconClose size={18} color={Colors.ink} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.body}
          contentContainerStyle={[
            styles.bodyContent,
            // Sin footer, el body toca el borde inferior del sheet directo —
            // hace falta sumar el inset a mano (no hay SafeAreaView aquí, el
            // sheet no cuelga de la pantalla completa). Con footer, ese
            // padding lo absorbe el footer en su lugar.
            !footer && { paddingBottom: insets.bottom + 16 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>

        {footer ? <View style={[styles.footer, { paddingBottom: insets.bottom + 22 }]}>{footer}</View> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(34,31,28,0.55)',
    justifyContent: 'flex-end',
  },
  // .sheet-card{max-height:70%; border-radius:20px 20px 0 0;}
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
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  // .sheet-body{padding:18px 20px 0;}
  bodyContent: {
    paddingTop: 18,
    paddingHorizontal: ScreenPadding,
  },
  // .sheet-footer{display:flex; gap:10px; padding:16px 20px 22px; border-top:1px solid var(--line);}
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: 16,
    paddingHorizontal: ScreenPadding,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
});
