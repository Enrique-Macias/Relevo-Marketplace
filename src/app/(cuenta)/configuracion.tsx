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
 *
 * "Eliminar cuenta" SÍ vive aquí aunque también termina la sesión, y es lo que
 * el guard global lo permite (`src/lib/salida-sesion.ts`): el borrado pide
 * aterrizar en "Cuenta eliminada" con `salirHacia()` y cierra la sesión local;
 * el guard del layout raíz reinicia la navegación. No depende del `<Redirect>`
 * de `(tabs)`.
 */

import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useState } from 'react';
import { Linking, Platform, Share, StyleSheet, Text, View } from 'react-native';

import { ConfirmModal } from '@/components/ConfirmModal';
import { Field } from '@/components/Field';
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
import { Notice } from '@/components/Notice';
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
import {
  copyDeFallo,
  EliminarCuentaError,
  eliminarCuenta,
  type FalloEliminarCuenta,
} from '@/lib/eliminar-cuenta';
import { estadoPermisoPush, pushDisponible, registrarPushToken, type EstadoPermisoPush } from '@/lib/push';
import { salirHacia } from '@/lib/salida-sesion';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export default function ConfiguracionScreen() {
  const { session } = useSession();
  const { mostrar } = useToast();

  const [permisoPush, setPermisoPush] = useState<EstadoPermisoPush | null>(null);

  // "Confirmar eliminar cuenta".
  const [eliminarVisible, setEliminarVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [eliminando, setEliminando] = useState(false);
  const [fallo, setFallo] = useState<FalloEliminarCuenta | null>(null);

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

  function abrirEliminarCuenta() {
    // Todo se resetea al ABRIR, no solo al cerrar: un intento anterior que
    // Fast Refresh preservó a medias dejaría el modal sin salida (el mismo bug
    // de "Cerrar sesión", cuenta-perfil.md).
    setPassword('');
    setFallo(null);
    setEliminando(false);
    setEliminarVisible(true);
  }

  async function confirmarEliminarCuenta() {
    const correo = session?.user.email;
    if (!correo || !password) return;
    setEliminando(true);
    setFallo(null);
    try {
      await eliminarCuenta(correo, password);
    } catch (e) {
      setFallo(e instanceof EliminarCuentaError ? e.motivo : 'servidor');
      if (!(e instanceof EliminarCuentaError)) console.error('[eliminar-cuenta]', e);
      setEliminando(false);
      return;
    }
    // La cuenta ya no existe. Cerrar la sesión LOCAL es lo que dispara la
    // salida: el guard global ve la sesión desaparecer y aterriza en "Cuenta
    // eliminada". `signOut` limpia el storage aunque el servidor conteste
    // 401/404 (la sesión ya no existe allá; auth-js lo ignora,
    // `GoTrueClient.js:3424-3440`). El push token no se borra desde aquí: se fue
    // con la cascada de `push_tokens` al borrar la cuenta.
    salirHacia('cuenta-eliminada');
    await supabase.auth.signOut({ scope: 'local' });
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
            <StatusRow
              icon={<IconTrash size={16} color={Colors.brick} />}
              label="Eliminar cuenta"
              trailing={<IconChevronRight size={14} color={Colors.inkSoft} />}
              danger
              onPress={abrirEliminarCuenta}
              last
            />
          </View>
        ) : null}
      </Screen>

      {/* Frame "Confirmar eliminar cuenta" (data-cat="sistema"). La contraseña
          ES la confirmación. Los errores van dentro del modal: son copy
          persistente que se lee mientras se corrige (§0 regla 4). */}
      <ConfirmModal
        visible={eliminarVisible}
        icon={<IconTrash size={22} color={Colors.brick} />}
        title="¿Eliminar tu cuenta?"
        body="Se borrarán tu perfil y tus publicaciones de inmediato. Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={() => void confirmarEliminarCuenta()}
        // `onCancel` también es el "atrás" de Android (`onRequestClose`): con el
        // borrado en curso no hay nada que cancelar.
        onCancel={() => {
          if (!eliminando) setEliminarVisible(false);
        }}
        confirming={eliminando}
        confirmDisabled={password.length === 0}
      >
        <Field
          label="Confirma con tu contraseña"
          placeholder="••••••••"
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            // El error de contraseña habla de la que se mandó.
            if (fallo === 'contrasena') setFallo(null);
          }}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          editable={!eliminando}
          error={fallo === 'contrasena' ? copyDeFallo('contrasena') : null}
          containerStyle={styles.campoModal}
        />
        {fallo && fallo !== 'contrasena' ? (
          <Notice text={copyDeFallo(fallo)} style={styles.noticeModal} />
        ) : null}
      </ConfirmModal>
    </>
  );
}

const styles = StyleSheet.create({
  campoModal: {
    marginBottom: 0,
  },
  // .notice trae margin-bottom:24px para el .sticky-cta; dentro del modal lo
  // separa el hueco de `children` (20px) de los botones.
  noticeModal: {
    marginTop: 12,
    marginBottom: 0,
  },
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
