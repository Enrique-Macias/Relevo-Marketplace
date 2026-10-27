import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AuthBody, AuthHeadline, AuthLink, AuthLinkStrong, AuthLogo, AuthSub, AuthTerms } from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { Field } from '@/components/Field';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Colors, Typography } from '@/constants/theme';
import { URL_PRIVACIDAD, URL_TERMINOS } from '@/lib/configuracion';
import { mensajeErrorAuth } from '@/lib/errores-auth';
import { useRedirectSiPerfilCompleto } from '@/lib/session';
import {
  COPY_CORREO_BLOQUEADO,
  COPY_DOMINIO_NO_PARTICIPANTE,
  esCorreoBloqueado,
  esDominioNoParticipante,
} from '@/lib/registro';
import { supabase } from '@/lib/supabase';
import { abrirDocumentoLegal } from '@/lib/terminos';

import { usePerfilDraft } from './_layout';

/**
 * Un correo mínimamente válido; la validación real la hace Supabase Auth.
 *
 * Se exporta porque "Recuperar contraseña" (RF-04) pide lo mismo: dos regex
 * idénticas en dos archivos se separan sin dar ningún error, solo dejando que
 * una pantalla acepte lo que la otra rechaza.
 */
export const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Frame "Verificación". Registro passwordless: solo correo + OTP. */
export default function VerificacionScreen() {
  const redirect = useRedirectSiPerfilCompleto();
  const { correo, setCorreo } = usePerfilDraft();
  const { mostrar } = useToast();
  const abrir = async (url: string) => {
    if (!(await abrirDocumentoLegal(url))) mostrar('No pudimos abrir el documento.', 'error');
  };
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Los rechazos del hook van aparte del error genérico porque tienen su
  // propio frame ("Verificación (correo no participante)" y su variante
  // "correo bloqueado"): un `.notice` pegado al campo, en vez del texto rojo
  // bajo el botón.
  const [rechazo, setRechazo] = useState<'dominio' | 'bloqueado' | null>(null);

  if (redirect) return redirect;

  const cambiarCorreo = (valor: string) => {
    setCorreo(valor);
    // El aviso habla del correo que se mandó. En cuanto el usuario lo edita,
    // deja de ser cierto.
    setRechazo(null);
  };

  const valido = CORREO_RE.test(correo.trim());

  const enviarCodigo = async () => {
    setEnviando(true);
    setError(null);
    setRechazo(null);
    // `shouldCreateUser: true` (el default) es lo que hace que este mismo
    // llamado sirva para registro: si el correo no existe, crea el usuario.
    const { error: e } = await supabase.auth.signInWithOtp({
      email: correo.trim(),
      options: { shouldCreateUser: true },
    });
    setEnviando(false);
    if (e) {
      // Quien decide es el servidor (el hook de dominios); aquí solo se
      // traduce su rechazo a copy. No hay lista de dominios en el cliente.
      if (esDominioNoParticipante(e)) setRechazo('dominio');
      else if (esCorreoBloqueado(e)) setRechazo('bloqueado');
      else setError(mensajeErrorAuth(e));
      return;
    }
    router.push('/codigo');
  };

  return (
    <Screen>
      <StatusBar style="dark" />
      <AuthBody>
        <AuthLogo marca />
        <AuthHeadline>Verifica que eres estudiante</AuthHeadline>
        <AuthSub>
          Usa tu correo institucional para crear tu cuenta y acceder al catálogo de tu campus.
        </AuthSub>

        <Field
          label="Correo institucional"
          placeholder="estudiante@institución.mx"
          value={correo}
          onChangeText={cambiarCorreo}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!enviando}
        />

        {rechazo ? (
          <Notice
            text={rechazo === 'dominio' ? COPY_DOMINIO_NO_PARTICIPANTE : COPY_CORREO_BLOQUEADO}
            style={styles.notice}
          />
        ) : null}

        <PrimaryButton
          label={enviando ? 'Enviando…' : 'Enviar código de verificación'}
          onPress={enviarCodigo}
          disabled={!valido || enviando}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <AuthLink>
          ¿Ya tienes cuenta?{' '}
          <AuthLinkStrong onPress={() => router.push('/iniciar-sesion')}>
            Inicia sesión
          </AuthLinkStrong>
        </AuthLink>
        {/* PL-016: aquí todavía no hay sesión, así que no se acepta nada; la
            aceptación es la casilla de "Completar perfil". Los enlaces abren las
            páginas públicas (sin sesión no se lee el catálogo de versiones). */}
        <AuthTerms>
          Consulta los{' '}
          <Text style={styles.legalLink} onPress={() => void abrir(URL_TERMINOS)} accessibilityRole="link" suppressHighlighting>
            Términos de uso
          </Text>{' '}
          y el{' '}
          <Text style={styles.legalLink} onPress={() => void abrir(URL_PRIVACIDAD)} accessibilityRole="link" suppressHighlighting>
            Aviso de privacidad
          </Text>{' '}
          de RLVO.
        </AuthTerms>
      </AuthBody>
    </Screen>
  );
}

// El prototipo no dibuja un estado de error para estas pantallas; se usa el rol
// tipográfico y el color de marca ya existentes, sin tokens nuevos.
const styles = StyleSheet.create({
  // .legal-link{color:var(--brick); font-weight:600; text-decoration:underline;}
  legalLink: {
    fontFamily: Typography.label.fontFamily,
    color: Colors.brick,
    textDecorationLine: 'underline',
  },
  // El frame le pone `margin-bottom:12px` inline al .notice: con el `margin-top`
  // de 4 del botón quedan 16, igual que del .field al aviso. Los 24 de la clase
  // son para el .sticky-cta de Publicar.
  notice: { marginBottom: 12 },
  error: {
    ...Typography.meta,
    color: Colors.danger,
    textAlign: 'center',
    marginTop: 12,
  },
});
