import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text } from 'react-native';

import { AuthBody, AuthHeadline, AuthLogo, AuthSub } from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { useEliminarCuenta } from '@/components/EliminarCuentaModal';
import { LegalCheck } from '@/components/LegalCheck';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Colors, Typography } from '@/constants/theme';
import { useSession } from '@/lib/session';
import {
  abrirDocumentoLegal,
  aceptarTerminos,
  esCuentaPrevia,
  esVersionNoVigente,
  fechaVersion,
} from '@/lib/terminos';

const COPY_ERROR_RED = 'No pudimos registrar tu aceptación. Revisa tu conexión e inténtalo de nuevo.';
const COPY_VENCIDA =
  'Los términos se actualizaron mientras los revisabas. Revisa la versión más reciente y vuelve a aceptarla.';

/**
 * Frame "Términos actualizados" (PL-016). Es una PUERTA OBLIGATORIA (decisión
 * del usuario, 2026-10-27, que reemplaza el "Ahora no" de D8-C): la pone
 * `(tabs)/_layout.tsx` a quien tiene sesión y NO aceptó la versión vigente de
 * los Términos, y también la abre una acción que exige aceptación
 * (`useExigirTerminos`) si la puerta no la vio.
 *
 * No se cierra con el gesto de iOS (`gestureEnabled: false`, `_layout.tsx`) ni
 * con el "atrás" de Android (aquí abajo). Las únicas salidas son aceptar,
 * "Cerrar sesión" y "Eliminar mi cuenta", que abre el MISMO "Confirmar eliminar
 * cuenta" de Configuración: borrar la cuenta tiene que ser posible también sin
 * aceptar (Apple 5.1.1(v)). La puerta es de la app; el candado de las acciones
 * sigue siendo de la base.
 *
 * El recuadro "Qué cambió" del frame NO se pinta: su texto lo redacta el
 * abogado por versión (PL-008) y el catálogo todavía no tiene dónde guardarlo.
 * Sin fuente, pintarlo sería inventar copy.
 */
export default function TerminosActualizadosScreen() {
  const { estadoTerminos: estado, refreshTerminos, signOut } = useSession();
  const { mostrar } = useToast();
  const eliminarCuenta = useEliminarCuenta();
  const [marcado, setMarcado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [aviso, setAviso] = useState<'red' | 'vencida' | null>(null);

  const salir = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  // El "atrás" de Android no sale de la puerta: se consume sin hacer nada.
  // Los modales (eliminar cuenta) manejan su propio "atrás" con `onRequestClose`.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  // Sin estado no hay versión que aceptar (no se pudo leer, no hay versión
  // vigente, o se llegó por un enlace sin pasar por la sesión): la puerta no
  // aplica, se vuelve a la app.
  useEffect(() => {
    if (!estado) salir();
  }, [estado]);

  const abrir = async (url: string) => {
    if (!(await abrirDocumentoLegal(url))) mostrar('No pudimos abrir el documento.', 'error');
  };

  const aceptar = async () => {
    if (!estado || guardando) return;
    setGuardando(true);
    setAviso(null);
    try {
      await aceptarTerminos(estado);
      await refreshTerminos();
      setGuardando(false);
      salir();
    } catch (e: any) {
      if (esVersionNoVigente(e)) {
        // Lo aceptado tiene que ser lo mostrado: se recarga la versión nueva y
        // la casilla se desmarca.
        await refreshTerminos();
        setMarcado(false);
        setAviso('vencida');
      } else {
        console.warn('[terminos] no se pudo registrar la aceptación:', e?.message ?? e);
        setAviso('red');
      }
      setGuardando(false);
    }
  };

  const cerrarSesion = async () => {
    if (cerrando || guardando) return;
    setCerrando(true);
    try {
      // La salida la hace el guard global (`src/lib/salida-sesion.ts`): esta
      // pantalla no es de (tabs) ni de (onboarding), así que al perder la
      // sesión reinicia la navegación en Splash.
      await signOut();
    } catch (e: any) {
      console.warn('[terminos] no se pudo cerrar sesión:', e?.message ?? e);
      mostrar('No pudimos cerrar sesión. Intenta de nuevo.', 'error');
      setCerrando(false);
    }
  };

  if (!estado) {
    return (
      <Screen>
        <StatusBar style="dark" />
      </Screen>
    );
  }

  const previa = esCuentaPrevia(estado);

  return (
    <Screen>
      <StatusBar style="dark" />
      {/* .auth-body con `style="padding-bottom:40px"`, como en el frame. */}
      <AuthBody style={styles.body}>
        <AuthLogo marca />
        {previa ? (
          <>
            <AuthHeadline>Acepta los términos de RLVO</AuthHeadline>
            <AuthSub style={styles.sub}>
              Para seguir usando RLVO, revisa y acepta los Términos de uso.
            </AuthSub>
          </>
        ) : (
          <>
            <AuthHeadline>Actualizamos nuestros términos</AuthHeadline>
            <AuthSub style={styles.sub}>
              Para seguir usando RLVO, revisa y acepta la nueva versión.
            </AuthSub>
          </>
        )}

        {/* .legal-version: qué versión exacta se acepta. */}
        <Text style={styles.version}>
          Términos de uso, versión del {fechaVersion(estado.terminos.vigenteDesde)} · Aviso de
          privacidad, versión del {fechaVersion(estado.aviso.vigenteDesde)}
        </Text>

        {aviso === 'vencida' ? <Notice text={COPY_VENCIDA} style={styles.noticeVencida} /> : null}

        <LegalCheck
          checked={marcado}
          onToggle={() => setMarcado((m) => !m)}
          onTerminos={() => void abrir(estado.terminos.url)}
          onAviso={() => void abrir(estado.aviso.url)}
          disabled={guardando}
        />

        {aviso === 'red' ? <Notice text={COPY_ERROR_RED} style={styles.noticeRed} /> : null}

        <PrimaryButton
          label={guardando ? 'Guardando' : 'Aceptar'}
          onPress={() => void aceptar()}
          disabled={!marcado || cerrando}
          busy={guardando}
          style={aviso === null ? styles.submit : styles.submitTrasAviso}
        />
        {/* .text-btn */}
        <Pressable
          onPress={() => void cerrarSesion()}
          disabled={guardando || cerrando}
          accessibilityRole="button"
          style={styles.textBtn}
        >
          <Text style={styles.textBtnLabel}>Cerrar sesión</Text>
        </Pressable>
        {/* .text-btn.danger */}
        <Pressable
          onPress={eliminarCuenta.abrir}
          disabled={guardando || cerrando}
          accessibilityRole="button"
          style={[styles.textBtn, styles.textBtnDanger]}
        >
          <Text style={[styles.textBtnLabel, styles.textBtnLabelDanger]}>Eliminar mi cuenta</Text>
        </Pressable>
      </AuthBody>
      {eliminarCuenta.modal}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingBottom: 40,
  },
  // `.auth-sub` con `style="margin-bottom:20px"`.
  sub: {
    marginBottom: 20,
  },
  // .legal-version{width:100%; text-align:left; font-size:11px; line-height:1.5; color:var(--ink-soft); margin-top:2px;}
  version: {
    ...Typography.legalVersion,
    color: Colors.inkSoft,
    width: '100%',
    textAlign: 'left',
    marginTop: 2,
  },
  noticeVencida: {
    marginTop: 16,
    marginBottom: 0,
  },
  // El `.notice` de error va entre la casilla y el botón, con 16 a cada lado.
  noticeRed: {
    marginTop: 16,
    marginBottom: 0,
  },
  // El botón lleva `style="margin-top:22px"`; tras un aviso, 16.
  submit: {
    marginTop: 22,
  },
  submitTrasAviso: {
    marginTop: 16,
  },
  // .text-btn{width:100%; padding:14px 0; font-size:13.5px; font-weight:600; color:var(--ink-soft); text-align:center;}
  textBtn: {
    width: '100%',
    paddingVertical: 14,
  },
  textBtnLabel: {
    ...Typography.textButton,
    color: Colors.inkSoft,
    textAlign: 'center',
  },
  // .text-btn.danger{color:var(--danger); padding-top:0;}
  textBtnDanger: {
    paddingTop: 0,
  },
  textBtnLabelDanger: {
    color: Colors.danger,
  },
});
