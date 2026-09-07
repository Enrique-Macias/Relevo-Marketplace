import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthBody, AuthHeadline, AuthSub, AuthTerms } from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { CampusBottomSheet } from '@/components/CampusBottomSheet';
import { Field, SelectField } from '@/components/Field';
import { IconCamera, IconPlus } from '@/components/icons';
import { Screen } from '@/components/Screen';
import { Colors, Radii, Typography } from '@/constants/theme';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

import { usePerfilDraft } from './_layout';

/** Mínimo de la pantalla; el servidor tiene el suyo (`minimum_password_length`). */
const MIN_PASSWORD = 8;

/** Frame "Completar perfil". Sin `.auth-logo`: el frame no lo tiene. */
export default function CompletarPerfilScreen() {
  const { session, refreshProfile } = useSession();
  const {
    nombre,
    setNombre,
    universidad,
    campus,
    setCampus,
    password,
    setPassword,
    passwordConfirm,
    setPasswordConfirm,
  } = usePerfilDraft();

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [campusSheetVisible, setCampusSheetVisible] = useState(false);

  const passwordOk = password.length >= MIN_PASSWORD && password === passwordConfirm;
  const puedeGuardar =
    nombre.trim().length > 0 && universidad !== null && campus !== null && passwordOk;

  const guardar = async () => {
    if (!session?.user) return;
    setGuardando(true);
    setError(null);

    // Orden deliberado: primero la contraseña, después el perfil. Si falla el
    // update de la tabla, la contraseña ya quedó fija y reintentar es
    // inofensivo; al revés dejaría un perfil completo sin contraseña, y el
    // gating mandaría al usuario al Feed sin poder volver a entrar nunca por
    // login (RF-02).
    const { error: ePass } = await supabase.auth.updateUser({ password });
    if (ePass) {
      setGuardando(false);
      setError(ePass.message);
      return;
    }

    // Solo las columnas del grant de update. Mandar `correo`/`estado`/
    // `rating_promedio`, aunque fuera sin cambiarlas, rechaza el statement
    // completo por privilegios de columna.
    const { error: ePerfil } = await supabase
      .from('users')
      .update({
        nombre: nombre.trim(),
        universidad_id: universidad!.id,
        campus_id: campus!.id,
      })
      .eq('id', session.user.id);

    if (ePerfil) {
      setGuardando(false);
      setError(ePerfil.message);
      return;
    }

    await refreshProfile();
    setGuardando(false);
    router.replace('/notificaciones');
  };

  return (
    <>
      <Screen>
        <StatusBar style="dark" />
      <AuthBody>
        {/* El frame le mete `style="margin-bottom:6px"` encima de los 9px de la clase. */}
        <AuthHeadline style={styles.headline}>Cuéntanos de ti</AuthHeadline>
        <AuthSub>
          Esto lo verán otros estudiantes cuando les contactes por una publicación.
        </AuthSub>

        {/* .photo-upload-circle{width:84px; height:84px; border:1.5px dashed var(--line); margin-bottom:22px;} */}
        <View style={styles.photoCircle}>
          <IconCamera size={24} color={Colors.inkSoft} />
          {/* .cam-badge{bottom:0; right:0; width:26px; height:26px; background:var(--brick); border:2px solid var(--paper);} */}
          <View style={styles.camBadge}>
            <IconPlus size={12} color={Colors.paper} />
          </View>
        </View>

        <Field
          label="Nombre completo"
          placeholder="Ej. Enrique Macías"
          value={nombre}
          onChangeText={setNombre}
          editable={!guardando}
        />
        <SelectField
          label="Universidad"
          value={universidad?.nombre}
          placeholder="Selecciona tu universidad"
          onPress={() => router.push('/selector-universidad')}
          disabled={guardando}
        />
        {/*
          El campus depende de la universidad: `campus.universidad_id` es FK, así
          que sin universidad elegida no hay lista que mostrar. El cambio de
          universidad limpia el campus en el borrador (ver `_layout.tsx`).
          Se presenta como bottom sheet, no pantalla completa — ver
          CampusBottomSheet.tsx y el frame "Completar perfil (selector de
          campus)" en relevo-app.html.
        */}
        <SelectField
          label="Campus"
          value={campus?.nombre}
          placeholder="Selecciona tu campus"
          onPress={() => setCampusSheetVisible(true)}
          disabled={universidad === null || guardando}
        />
        <Field
          label="Crea una contraseña"
          placeholder="••••••••"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          editable={!guardando}
        />
        {/* El último `.field` del frame lleva `style="margin-bottom:0"`. */}
        <Field
          label="Confirma tu contraseña"
          placeholder="••••••••"
          value={passwordConfirm}
          onChangeText={setPasswordConfirm}
          secureTextEntry
          editable={!guardando}
          containerStyle={styles.lastField}
        />
        {/* `.auth-terms` con `style="margin-top:6px"`, como en el frame. */}
        <AuthTerms style={styles.hint}>Usa al menos {MIN_PASSWORD} caracteres.</AuthTerms>

        {/* El frame le pone `style="margin-top:28px"` al botón. */}
        <PrimaryButton
          label={guardando ? 'Guardando…' : 'Continuar'}
          onPress={guardar}
          disabled={!puedeGuardar || guardando}
          style={styles.submit}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        </AuthBody>
      </Screen>

      <CampusBottomSheet
        visible={campusSheetVisible}
        universidadId={universidad?.id ?? null}
        selectedId={campus?.id ?? null}
        onSelect={setCampus}
        onClose={() => setCampusSheetVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  headline: {
    marginBottom: 6,
  },
  photoCircle: {
    width: 84,
    height: 84,
    borderRadius: Radii.full,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  camBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: Radii.full,
    backgroundColor: Colors.brick,
    borderWidth: 2,
    borderColor: Colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastField: {
    marginBottom: 0,
  },
  hint: {
    marginTop: 6,
  },
  submit: {
    marginTop: 28,
  },
  error: {
    ...Typography.meta,
    color: Colors.brick,
    textAlign: 'center',
    marginTop: 12,
  },
});
