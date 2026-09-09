import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConfirmModal } from '@/components/ConfirmModal';
import { IconChevronRight, IconLogout, IconTag } from '@/components/icons';
import { Colors, ScreenPadding, Typography } from '@/constants/theme';
import { useSession } from '@/lib/session';

/**
 * Placeholder deliberado: la pantalla real "Perfil" (avatar, stats, el resto del
 * `.menu-list`) necesita datos que todavía no están conectados — es otra tarea.
 * Hoy solo tiene dos afordances reales: "Cerrar sesión" y la entrada a "Mis
 * publicaciones", que se agregó por necesidad — el Feed filtra
 * `estado = 'activa'`, así que sin ella una publicación pausada no era
 * alcanzable desde ninguna parte (CLAUDE.md §8).
 */
export default function PerfilScreen() {
  const { signOut } = useSession();
  const [confirmando, setConfirmando] = useState(false);
  const [cerrandoSesion, setCerrandoSesion] = useState(false);

  const cerrarSesion = async () => {
    setCerrandoSesion(true);
    await signOut();
    // No hay que navegar a mano ni cerrar el modal aquí: cambiar la sesión
    // dispara el guard de (tabs)/_layout.tsx, que ya redirige a /splash — el
    // desmontaje de esta pantalla se encarga de todo lo demás.
  };

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Perfil</Text>

      {/* `.menu-list` con UNA sola fila por ahora — las otras tres del frame
          (Editar perfil, Verificación, Ayuda) llegan cuando se construya Perfil
          de verdad. `last` porque hoy es la única: `.menu-row:last-child` no
          lleva línea inferior. */}
      <View style={styles.menuList}>
        <Pressable
          style={[styles.menuRow, styles.menuRowLast]}
          onPress={() => router.push('/mis-publicaciones')}
          accessibilityRole="button"
        >
          <View style={styles.menuIcon}>
            <IconTag size={16} color={Colors.inkSoft} />
          </View>
          <Text style={styles.menuLabel}>Mis publicaciones</Text>
          <IconChevronRight size={14} color={Colors.inkSoft} />
        </Pressable>
      </View>

      <Pressable
        style={styles.logoutRow}
        onPress={() => setConfirmando(true)}
        accessibilityRole="button"
      >
        <Text style={styles.logoutLabel}>Cerrar sesión</Text>
      </Pressable>

      {/*
        El FAB de "Publicar" NO va aquí aunque el diseño lo dibuje sobre esta
        pantalla: dentro del contenido de una pantalla de `NativeTabs` se pinta
        pero no recibe el toque (CLAUDE.md §9). Vive en `(tabs)/_layout.tsx`
        como hermano del navegador, y ese layout decide mostrarlo solo en
        Perfil.
      */}
      <ConfirmModal
        visible={confirmando}
        icon={<IconLogout size={22} color={Colors.brick} />}
        title="¿Cerrar sesión?"
        body="Tendrás que verificar tu correo de nuevo la próxima vez que quieras entrar a Relevo."
        confirmLabel="Cerrar sesión"
        onConfirm={cerrarSesion}
        onCancel={() => setConfirmando(false)}
        confirming={cerrandoSesion}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    backgroundColor: Colors.paper,
  },
  text: {
    ...Typography.pageHeading,
    color: Colors.ink,
  },
  // .menu-list{padding:2px 20px 100px;} — el padding inferior no aplica aquí,
  // donde la lista está centrada en un placeholder y no al final de la pantalla.
  menuList: {
    alignSelf: 'stretch',
    paddingHorizontal: ScreenPadding,
  },
  // .menu-row{display:flex; align-items:center; gap:12px; padding:13px 0; border-bottom:1px solid var(--line);}
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  // .menu-row:last-child{border-bottom:none;}
  menuRowLast: {
    borderBottomWidth: 0,
  },
  // .menu-icon{width:34px; height:34px; border-radius:10px; background:var(--paper);}
  menuIcon: {
    width: 34,
    height: 34,
    // El mismo 10px que `.status-row-icon` — el radio que CLAUDE.md §2 anota
    // como fuera de `Radii`.
    borderRadius: 10,
    backgroundColor: Colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // .menu-label{flex:1; font-size:13.5px; font-weight:500;}
  menuLabel: {
    ...Typography.rowLabel,
    color: Colors.ink,
    flex: 1,
  },
  logoutRow: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  logoutLabel: {
    ...Typography.emphasis,
    color: Colors.brick,
  },
});
