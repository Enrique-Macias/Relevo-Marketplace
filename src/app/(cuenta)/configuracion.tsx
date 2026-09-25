/**
 * Frame "Configuración" — destino del engrane de `.profile-top` en Perfil,
 * inerte hasta ahora (`(tabs)/perfil.tsx`). "Cerrar sesión" NO vive aquí: estuvo
 * y se revirtió a Perfil, porque el guard de sesión de `(tabs)/_layout.tsx`
 * (`<Redirect>`, que corre en `useFocusEffect`) no redirige mientras `(tabs)`
 * está tapado por esta pantalla. Ver `.claude/rules/cuenta-perfil.md`.
 *
 * El frame muestra TODAS las filas; el código solo pinta las que funcionan
 * hoy, decidido en un solo lugar (`filaVisible()`, `src/lib/configuracion.ts`).
 * Ver `.claude/rules/cuenta-perfil.md` para qué enciende cada fila oculta.
 */

import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Linking, Platform, Share, StyleSheet, Text, View } from 'react-native';

import {
  IconBell,
  IconChevronRight,
  IconDocument,
  IconMail,
  IconInfo,
  IconShare,
  IconShield,
  IconStar,
  IconTrash,
} from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { SectionHead } from '@/components/SectionHead';
import { StatusRow } from '@/components/StatusRow';
import { useToast } from '@/components/Toast';
import { Colors, ScreenPadding } from '@/constants/theme';
import {
  CORREO_CONTACTO,
  filaVisible,
  URL_APP_STORE,
  URL_GOOGLE_PLAY,
  URL_PRIVACIDAD,
  URL_TERMINOS,
} from '@/lib/configuracion';
import { estadoPermisoPush, pushDisponible, registrarPushToken, type EstadoPermisoPush } from '@/lib/push';
import { useSession } from '@/lib/session';

export default function ConfiguracionScreen() {
  const { session } = useSession();
  const { mostrar } = useToast();

  const [permisoPush, setPermisoPush] = useState<EstadoPermisoPush | null>(null);

  // Re-lee al ENFOCAR, no solo al montar: revocar el permiso desde Ajustes y
  // volver a esta pantalla (sin matar la app) tiene que actualizar el texto.
  useFocusEffect(
    useCallback(() => {
      if (!pushDisponible) return;
      let activo = true;
      void estadoPermisoPush().then((estado) => {
        if (activo) setPermisoPush(estado);
      });
      return () => {
        activo = false;
      };
    }, []),
  );

  async function tocarNotificaciones() {
    if (permisoPush === 'no_solicitado') {
      try {
        if (session?.user.id) await registrarPushToken(session.user.id);
      } catch {
        mostrar('No pudimos activar las notificaciones. Intenta de nuevo.', 'error');
      } finally {
        setPermisoPush(await estadoPermisoPush());
      }
      return;
    }
    void Linking.openSettings();
  }

  async function abrirContacto() {
    try {
      await Linking.openURL(`mailto:${CORREO_CONTACTO}`);
    } catch {
      mostrar('No encontramos una app de correo instalada.', 'error');
    }
  }

  async function calificarApp() {
    const url = Platform.OS === 'ios' ? URL_APP_STORE : URL_GOOGLE_PLAY;
    try {
      await Linking.openURL(url);
    } catch {
      mostrar('No pudimos abrir la tienda de aplicaciones.', 'error');
    }
  }

  async function abrirDocumentoLegal(url: string) {
    // Navegador DENTRO de la app (SFSafariViewController en iOS, Custom Tabs en
    // Android), no `Linking.openURL`: el usuario lee el documento y cierra de
    // vuelta a Configuración sin salir a Safari/Chrome. Solo acepta `http(s)`:
    // con una URL vacía o sin esquema la promesa rechaza
    // (`WebBrowserInvalidURLException`, `expo-web-browser/ios/WebBrowserModule.swift`),
    // y sin este catch sería un rechazo sin manejar.
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      mostrar('No pudimos abrir el documento.', 'error');
    }
  }

  async function compartirApp() {
    // Texto plano, sin link — mismo criterio que Detalle/Perfil público
    // (compartir-deeplinks.md): sin universal links/App Links todavía.
    await Share.share({
      message: 'Descarga Relevo, el marketplace para comprar y vender entre estudiantes.',
    });
  }

  const textoPush =
    permisoPush === 'concedido'
      ? 'Activadas'
      : permisoPush === 'denegado'
        ? 'Desactivadas'
        : permisoPush === 'no_solicitado'
          ? 'Activar'
          : '';

  const version = Constants.expoConfig?.version ?? '';

  const mostrarNotificaciones = filaVisible('notificaciones');
  const mostrarGeneral = filaVisible('calificar') || filaVisible('compartir');
  const mostrarLegal = filaVisible('privacidad') || filaVisible('terminos');
  // "Soporte" (Contacto/Versión) siempre se pinta — es la PRIMERA sección
  // solo cuando las tres de arriba están ocultas. Se calcula una sola vez
  // para no repetir la misma condición en cada `SectionHead`.
  const soporteEsPrimera = !mostrarNotificaciones && !mostrarGeneral && !mostrarLegal;

  return (
    <>
      <Screen header={<PageHeader title="Configuración" />}>
        <StatusBar style="dark" />

        {mostrarNotificaciones ? (
          <>
            <SectionHead title="Notificaciones" style={styles.firstSection} />
            <View style={styles.section}>
              <StatusRow
                icon={<IconBell size={16} color={Colors.inkSoft} />}
                label="Notificaciones"
                trailing={
                  <View style={styles.trailingValue}>
                    <Text style={permisoPush === 'no_solicitado' ? styles.valorActivar : styles.valor}>
                      {textoPush}
                    </Text>
                    <IconChevronRight size={14} color={Colors.inkSoft} />
                  </View>
                }
                onPress={permisoPush === null ? undefined : tocarNotificaciones}
                last
              />
            </View>
          </>
        ) : null}

        {mostrarGeneral ? (
          <>
            <SectionHead title="General" style={!mostrarNotificaciones ? styles.firstSection : undefined} />
            <View style={styles.section}>
              {filaVisible('calificar') ? (
                <StatusRow
                  icon={<IconStar size={16} color={Colors.inkSoft} />}
                  label="Calificar la app"
                  trailing={<IconChevronRight size={14} color={Colors.inkSoft} />}
                  onPress={() => void calificarApp()}
                  last={!filaVisible('compartir')}
                />
              ) : null}
              {filaVisible('compartir') ? (
                <StatusRow
                  icon={<IconShare size={16} color={Colors.inkSoft} />}
                  label="Compartir la app"
                  trailing={<IconChevronRight size={14} color={Colors.inkSoft} />}
                  onPress={() => void compartirApp()}
                  last
                />
              ) : null}
            </View>
          </>
        ) : null}

        {mostrarLegal ? (
          <>
            <SectionHead
              title="Legal"
              style={!mostrarNotificaciones && !mostrarGeneral ? styles.firstSection : undefined}
            />
            <View style={styles.section}>
              {filaVisible('privacidad') ? (
                <StatusRow
                  icon={<IconShield size={16} color={Colors.inkSoft} />}
                  label="Aviso de privacidad"
                  trailing={<IconChevronRight size={14} color={Colors.inkSoft} />}
                  onPress={() => void abrirDocumentoLegal(URL_PRIVACIDAD)}
                  last={!filaVisible('terminos')}
                />
              ) : null}
              {filaVisible('terminos') ? (
                <StatusRow
                  icon={<IconDocument size={16} color={Colors.inkSoft} />}
                  label="Términos de uso"
                  trailing={<IconChevronRight size={14} color={Colors.inkSoft} />}
                  onPress={() => void abrirDocumentoLegal(URL_TERMINOS)}
                  last
                />
              ) : null}
            </View>
          </>
        ) : null}

        <SectionHead title="Soporte" style={soporteEsPrimera ? styles.firstSection : undefined} />
        <View style={styles.section}>
          <StatusRow
            icon={<IconMail size={16} color={Colors.inkSoft} />}
            label="Contacto"
            trailing={<IconChevronRight size={14} color={Colors.inkSoft} />}
            onPress={() => void abrirContacto()}
          />
          <StatusRow
            icon={<IconInfo size={16} color={Colors.inkSoft} />}
            label="Versión"
            trailing={<Text style={styles.valor}>{version}</Text>}
            last
          />
        </View>

        {/* "Cerrar sesión" NO va aquí: vive en Perfil, dentro de (tabs). Desde
            esta pantalla el guard de (tabs)/_layout.tsx no redirigiría a
            /splash — ver cuenta-perfil.md. */}

        {filaVisible('eliminar_cuenta') ? (
          <View style={[styles.section, styles.separado, styles.ultimaSeccion]}>
            {/* filaVisible('eliminar_cuenta') es false hoy: esta rama no
                renderiza todavía. El onPress se cablea en la tarea del flujo
                de eliminar cuenta. */}
            <StatusRow
              icon={<IconTrash size={16} color={Colors.brick} />}
              label="Eliminar cuenta"
              trailing={<IconChevronRight size={14} color={Colors.inkSoft} />}
              danger
              onPress={() => {}}
              last
            />
          </View>
        ) : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  firstSection: {
    paddingTop: 4,
  },
  section: {
    paddingHorizontal: ScreenPadding,
  },
  separado: {
    marginTop: 22,
  },
  ultimaSeccion: {
    paddingBottom: 24,
  },
  trailingValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // 13px no coincide con ningún rol de Typography (`meta` es 12.5) — mismo
  // criterio que `formAction` en ListRow.tsx: se declara aquí en vez de
  // forzar el parecido.
  valor: {
    fontSize: 13,
    color: Colors.inkSoft,
  },
  valorActivar: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.brick,
  },
});
