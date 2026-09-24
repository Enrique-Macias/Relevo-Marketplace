import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  AuthBody,
  AuthHeadline,
  AuthLink,
  AuthLinkStrong,
  AuthSub,
  AuthTerms,
} from '@/components/AuthBody';
import { Avatar } from '@/components/Avatar';
import { BlinkingDots } from '@/components/BlinkingDots';
import { PrimaryButton } from '@/components/Buttons';
import { CampusBottomSheet } from '@/components/CampusBottomSheet';
import { Field, FixedField, SelectField } from '@/components/Field';
import { IconCamera, IconPlus } from '@/components/icons';
import { Notice } from '@/components/Notice';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Colors, Radii, Typography } from '@/constants/theme';
import { fetchUniversidad, type OpcionCatalogo } from '@/lib/catalogos';
import { useFotoPerfil } from '@/lib/perfil';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { COPY_NOMBRE_INVALIDO, nombreValido, normalizarNombre } from '@/lib/validacion-perfil';

import { usePerfilDraft } from './_layout';

/**
 * Mínimo de contraseña. NO es "el de la pantalla": es el MISMO que el de la base
 * (`minimum_password_length` en `supabase/config.toml`, y el ajuste equivalente en
 * el dashboard remoto). El candado real es aquél — un `updateUser` con 7
 * caracteres lo rechaza GoTrue, mire el cliente lo que mire; esto solo traduce esa
 * regla a un botón apagado, que es lo que pide CLAUDE.md §0 regla 7.
 *
 * Se exporta para que "Nueva contraseña" (RF-04) no declare su propio número: si
 * se duplicara y alguien moviera uno, las dos pantallas de contraseña de la app
 * dejarían de coincidir sin que nada fallara.
 */
export const MIN_PASSWORD = 8;

/** Frame "Completar perfil". Sin `.auth-logo`: el frame no lo tiene. */
export default function CompletarPerfilScreen() {
  const { session, profile, refreshProfile, signOut } = useSession();
  const {
    nombre,
    setNombre,
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

  /**
   * La universidad NO se elige: la asignó el trigger de alta desde el dominio
   * del correo (20260924000466), y aquí solo se muestra. La sesión trae el id
   * (`PROFILE_COLUMNS`); el nombre se lee aparte.
   *
   * `sinUniversidad` es la variante "sin universidad asignada" del frame. Solo
   * le pasa a una cuenta creada con la llave secreta (Studio, admin API) con un
   * dominio no registrado, porque el alta normal pasa por el Auth Hook. Sin
   * universidad la base no deja fijar campus (check
   * `users_campus_requiere_universidad`) ni publicar, así que la única salida es
   * cerrar sesión. Se mira `profile !== null` para no confundir "todavía no
   * carga" con "no tiene".
   */
  const universidadId = profile?.universidad_id ?? null;
  const sinUniversidad = profile !== null && universidadId === null;
  const [universidad, setUniversidad] = useState<OpcionCatalogo | null>(null);

  useEffect(() => {
    if (universidadId === null) return;
    let vigente = true;
    fetchUniversidad(universidadId)
      .then((u) => {
        if (vigente) setUniversidad(u);
      })
      .catch((e) => {
        // Sin el nombre la pantalla sigue funcionando: el campus se elige por
        // `universidadId`, que ya está en la sesión. Solo queda el campo vacío.
        console.warn('[completar-perfil] no se pudo leer la universidad:', e?.message ?? e);
      });
    return () => {
      vigente = false;
    };
  }, [universidadId]);

  /**
   * El aviso del fallo de foto va por TOAST y no por el `<Text style={error}>`
   * de abajo, aunque esta pantalla ya tenga ese slot: aquél es copy persistente
   * —el usuario lo lee con calma— y estrenar un texto ahí exigiría un frame
   * (§0 regla 4). Un toast es la excepción explícita de esa regla, y además deja
   * el mismo copy que "Editar perfil", que es la otra pantalla del círculo.
   */
  const { mostrar } = useToast();
  const {
    fotoUrl,
    subiendo: subiendoFoto,
    cambiar: cambiarFoto,
  } = useFotoPerfil({
    // La ruta del objeto ES la llave de autorización, así que sin sesión no hay
    // carpeta válida a la que subir. En la práctica no se llega aquí sin ella
    // —el gating de `(onboarding)/_layout.tsx` exige sesión—, pero el `''` haría
    // una request condenada en vez de no hacer ninguna; el `disabled` de abajo
    // es lo que la evita.
    userId: session?.user.id ?? '',
    // Esta pantalla no precarga: se llega con el perfil recién creado por el
    // trigger, o sea `foto_url` en null. Si alguien vuelve tras haberla puesto,
    // el `refreshProfile()` de abajo ya dejó el dato en la sesión.
    inicial: profile?.foto_url ?? null,
    onAviso: mostrar,
    onGuardada: refreshProfile,
  });

  const passwordOk = password.length >= MIN_PASSWORD && password === passwordConfirm;
  const puedeGuardar =
    nombreValido(nombre) && universidadId !== null && campus !== null && passwordOk;

  /**
   * La variante "nombre no válido" del frame. Solo con algo escrito: el campo
   * vacío es el estado inicial, no un error. Se evalúa sobre el normalizado (lo
   * hace `nombreValido`), así que un espacio final al teclear no la dispara. El
   * candado es `users_nombre_valido`; esto solo adelanta su veredicto.
   */
  const nombreError =
    normalizarNombre(nombre) !== '' && !nombreValido(nombre) ? COPY_NOMBRE_INVALIDO : null;

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
    // `rating_promedio` —o `universidad_id`, que salió del grant en
    // 20260924000466—, aunque fuera sin cambiarlas, rechaza el statement
    // completo por privilegios de columna. Que el campus sea de SU universidad
    // lo garantiza la base (`users_campus_universidad_fkey`), no este cliente.
    const { error: ePerfil } = await supabase
      .from('users')
      .update({
        nombre: normalizarNombre(nombre),
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
    router.replace('/permiso-notificaciones');
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

        {/*
          .photo-upload-circle{width:84px; height:84px; border:1.5px dashed var(--line); margin-bottom:22px;}

          YA NO ES INERTE (RF-03): era un `View` sin `accessibilityRole` mientras
          no hacía nada, y ahora abre el carrete. El borde pasa de DASHED a SOLID
          en cuanto hay foto —variante `.photo-upload-circle.has-photo` del
          frame—: el círculo deja de estar vacío, que es el mismo criterio por el
          que "Editar perfil" ya traía ese override.

          El fallback NO son iniciales sino el ícono de cámara, y es la única de
          las 9 superficies donde cambia: aquí el nombre todavía se está
          escribiendo, así que abreviarlo daría "?" o media inicial.

          La foto se guarda AL ELEGIRLA, no con el resto del formulario: la fila
          de `users` ya existe (la creó `private.handle_new_user()` al verificarse
          el correo), así que no hay nada que esperar. Ver `guardarFotoPerfil()`.
        */}
        <Pressable
          style={[styles.photoCircle, fotoUrl ? styles.photoCircleConFoto : null]}
          onPress={cambiarFoto}
          disabled={subiendoFoto || !session?.user}
          accessibilityRole="button"
          accessibilityLabel="Agregar foto de perfil"
        >
          <Avatar
            path={fotoUrl}
            nombre={nombre}
            style={styles.avatar}
            fallback={<IconCamera size={24} color={Colors.inkSoft} />}
          >
            {subiendoFoto ? (
              <View style={styles.avatarScrim}>
                <BlinkingDots style={styles.avatarScrimDots} />
              </View>
            ) : null}
          </Avatar>
          {/* .cam-badge{bottom:0; right:0; width:26px; height:26px; background:var(--brick); border:2px solid var(--paper);}
              Fuera del `Avatar`, que recorta con `overflow:'hidden'`. */}
          <View style={styles.camBadge}>
            <IconPlus size={12} color={Colors.paper} />
          </View>
        </Pressable>

        <Field
          label="Nombre completo"
          placeholder="Ej. Enrique Macías"
          value={nombre}
          onChangeText={setNombre}
          editable={!guardando}
          error={nombreError}
        />
        {/* Fija, sin chevron: la asigna el servidor, no se elige (ver arriba). */}
        <FixedField
          label="Universidad"
          value={universidad?.nombre}
          placeholder={sinUniversidad ? 'Sin universidad asignada' : ''}
        />
        {/*
          El campus se elige SOLO entre los de la universidad asignada. Se
          presenta como bottom sheet, no pantalla completa — ver
          CampusBottomSheet.tsx y el frame "Completar perfil (selector de
          campus)" en relevo-app.html.
        */}
        <SelectField
          label="Campus"
          value={campus?.nombre}
          placeholder="Selecciona tu campus"
          onPress={() => setCampusSheetVisible(true)}
          disabled={universidadId === null || guardando}
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

        {/* Variante "sin universidad asignada": el `.notice` va entre la
            contraseña y el botón, con los 28px que el frame le da al botón. */}
        {sinUniversidad ? (
          <Notice
            text="Tu correo no pertenece a una universidad participante. Entra con el correo que te dio tu universidad."
            style={styles.noticeSinUniversidad}
          />
        ) : null}

        {/* El frame le pone `style="margin-top:28px"` al botón. */}
        <PrimaryButton
          label={guardando ? 'Guardando…' : 'Continuar'}
          onPress={guardar}
          disabled={!puedeGuardar || guardando}
          style={sinUniversidad ? undefined : styles.submit}
        />

        {/*
          La salida de la variante: sin ella, el gating (`isProfileComplete`)
          devolvería a esta pantalla para siempre. El `signOut` de useSession y
          no `supabase.auth.signOut()`, por el orden del push token
          (`nueva-password.tsx`).
        */}
        {sinUniversidad ? (
          <AuthLink>
            ¿Es otro correo?{' '}
            <AuthLinkStrong
              onPress={async () => {
                await signOut();
                router.replace('/verificacion');
              }}
            >
              Usar otro correo
            </AuthLinkStrong>
          </AuthLink>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        </AuthBody>
      </Screen>

      <CampusBottomSheet
        visible={campusSheetVisible}
        universidadId={universidadId}
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
  // `.photo-upload-circle.has-photo` — con foto el borde deja de ser punteado.
  photoCircleConFoto: {
    borderStyle: 'solid',
  },
  // `.seller-avatar` a la escala del círculo, igual que en "Editar perfil", pero
  // SIN `backgroundColor`: sin foto aquí va el ícono de cámara sobre el fondo de
  // la pantalla, no el forest-tint de un avatar de iniciales.
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: Radii.full,
  },
  // `.photo-upload-circle.is-busy .avatar-scrim` — mismo tono que el scrim de
  // `PhotoRow` y que `.photo-remove`, no un color nuevo.
  avatarScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radii.full,
    backgroundColor: 'rgba(34,31,28,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarScrimDots: {
    marginTop: 0,
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
  noticeSinUniversidad: {
    marginTop: 28,
    marginBottom: 12,
  },
  error: {
    ...Typography.meta,
    color: Colors.brick,
    textAlign: 'center',
    marginTop: 12,
  },
});
