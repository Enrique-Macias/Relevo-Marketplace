import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AuthBody, AuthHeadline, AuthSub } from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { Field, SelectField } from '@/components/Field';
import { IconCamera, IconPlus } from '@/components/icons';
import { Screen } from '@/components/Screen';
import { Colors, Radii } from '@/constants/theme';

/** Frame "Completar perfil". Sin `.auth-logo`: el frame no lo tiene. */
export default function CompletarPerfilScreen() {
  const [nombre, setNombre] = useState('');
  // Los selectores devuelven su elección por query param al hacer `router.back()`.
  const { universidad, campus } = useLocalSearchParams<{
    universidad?: string;
    campus?: string;
  }>();

  return (
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
        />
        <SelectField
          label="Universidad"
          value={universidad}
          placeholder="Selecciona tu universidad"
          onPress={() => router.push('/selector-universidad')}
        />
        {/* El último `.field` del frame lleva `style="margin-bottom:0"`. */}
        <SelectField
          label="Campus"
          value={campus}
          placeholder="Selecciona tu campus"
          onPress={() => router.push('/selector-campus')}
          containerStyle={styles.lastField}
        />

        {/* El frame le pone `style="margin-top:28px"` al botón. */}
        <PrimaryButton
          label="Continuar"
          onPress={() => router.push('/notificaciones')}
          style={styles.submit}
        />
      </AuthBody>
    </Screen>
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
  submit: {
    marginTop: 28,
  },
});
