/**
 * Frame "Editar perfil" (`design/relevo-app.html`, grupo `cuenta`).
 *
 * Es la OTRA puerta del teléfono de RF-13 — `docs/product-spec.md:284` lo dice
 * con esas palabras: hasta ahora el único lugar donde se podía capturar un
 * WhatsApp era el gate de Publicar, así que quien ya había publicado no tenía
 * cómo corregirlo. Y es el primer camino de código que escribe `carrera`.
 *
 * Las columnas que escribe están en el grant de update de `users`
 * (`20260924000466`, que dejó fuera `universidad_id`), y `users_update_own` no lleva
 * `is_active_user()` — un usuario SUSPENDIDO puede editar su propio perfil,
 * incluido su teléfono, y eso es decisión de producto documentada (CLAUDE.md §3,
 * tabla de decisión), no un descuido de la policy.
 *
 * La UNIVERSIDAD se muestra fija y no se edita: la asignó el servidor desde el
 * dominio del correo al crear la cuenta (20260924000466). El campus sí, y solo
 * entre los de esa universidad; que no pueda ser de otra lo garantiza la base
 * (FK compuesta `users_campus_universidad_fkey`), no esta pantalla.
 */

import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { BlinkingDots } from '@/components/BlinkingDots';
import { CampusBottomSheet } from '@/components/CampusBottomSheet';
import { ErrorState } from '@/components/ErrorState';
import { Field, FixedField, PhoneField, SelectField } from '@/components/Field';
import { IconCamera } from '@/components/icons';
import { FormHeader } from '@/components/ListRow';
import { Screen } from '@/components/Screen';
import { SkeletonPerfilForm } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';
import {
  fetchPerfilEditable,
  fetchTelefonoVendedor,
  formatTelefonoNacional,
  guardarPerfil,
  telefonoValido,
  useFotoPerfil,
  type PerfilEditable,
} from '@/lib/perfil';
import { type OpcionCatalogo } from '@/lib/catalogos';
import { useSession } from '@/lib/session';

type Datos = { perfil: PerfilEditable; telefono: string | null };

export default function EditarPerfilScreen() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState(false);
  const [recargas, setRecargas] = useState(0);

  /**
   * Las dos fuentes en paralelo, porque el teléfono NO viaja con el perfil: está
   * fuera del grant de select (RNF-05) y solo sale por `seller_whatsapp`.
   *
   * OJO — aquí NO hay refetch al recuperar el foco, al revés que
   * `mis-publicaciones.tsx` o `(publicar)/editar/[id].tsx`: esta pantalla no
   * empuja ninguna ruta (el campus se elige en un `Modal`), así que nunca
   * "vuelve" a ella con datos que refrescar. Antes tenía una ruta hija, el
   * selector de universidad, que desapareció cuando la universidad dejó de
   * elegirse (20260924000466).
   */
  useEffect(() => {
    if (!userId) return;

    let vigente = true;
    Promise.all([fetchPerfilEditable(userId), fetchTelefonoVendedor(userId)])
      .then(([perfil, telefono]) => {
        if (!vigente) return;
        if (!perfil) {
          setError(true);
          return;
        }
        setDatos({ perfil, telefono });
      })
      .catch((e) => {
        if (!vigente) return;
        console.warn('[editar-perfil] no se pudo leer el perfil:', e?.message ?? e);
        setError(true);
      });

    return () => {
      vigente = false;
    };
  }, [userId, recargas]);

  if (datos && userId) {
    return <Formulario userId={userId} perfil={datos.perfil} telefonoGuardado={datos.telefono} />;
  }

  return (
    <Screen header={<FormHeader title="Editar perfil" />}>
      <StatusBar style="dark" />
      {error ? (
        <ErrorState
          onRetry={() => {
            setError(false);
            setRecargas((n) => n + 1);
          }}
          title="No pudimos abrir tu perfil"
          sub="Revisa tu conexión e intenta de nuevo."
        />
      ) : (
        <SkeletonPerfilForm />
      )}
    </Screen>
  );
}

function Formulario({
  userId,
  perfil,
  telefonoGuardado,
}: {
  userId: string;
  perfil: PerfilEditable;
  /** E.164 o `null`. Ver `telefonoTocado` abajo para el caso del suspendido. */
  telefonoGuardado: string | null;
}) {
  const { profile, refreshProfile } = useSession();
  const { mostrar } = useToast();

  // Solo se muestra: la universidad no se cambia desde la app.
  const universidad = perfil.universidad;
  const [campus, setCampus] = useState<OpcionCatalogo | null>(perfil.campus);

  const [nombre, setNombre] = useState(perfil.nombre);
  const [carrera, setCarrera] = useState(perfil.carrera);
  const [telefono, setTelefono] = useState(
    telefonoGuardado ? formatTelefonoNacional(telefonoGuardado) : ''
  );
  const [guardando, setGuardando] = useState(false);
  const [campusSheetVisible, setCampusSheetVisible] = useState(false);

  // La foto se persiste al elegirla, NO al tocar "Guardar" — ver
  // `guardarFotoPerfil()`. Por eso no pasa por `puedeGuardar` ni por el UPDATE
  // de abajo, y por eso salir sin guardar la conserva.
  const {
    fotoUrl,
    subiendo: subiendoFoto,
    cambiar: cambiarFoto,
  } = useFotoPerfil({
    userId,
    inicial: perfil.fotoUrl,
    onAviso: mostrar,
    // El avatar del header del Feed y el de Perfil salen de `PROFILE_COLUMNS`,
    // así que sin esto seguirían con la foto vieja hasta el próximo arranque.
    onGuardada: refreshProfile,
  });

  /**
   * Si el usuario TOCÓ el campo de teléfono. Es lo único que decide si la columna
   * viaja en el UPDATE, y no es lo mismo que "el texto cambió".
   *
   * El caso que obliga a distinguirlos: a un usuario SUSPENDIDO,
   * `seller_whatsapp` le devuelve `null` aunque tenga número guardado (valida al
   * llamante, 20260911000449), así que su campo se precarga vacío. Si el criterio
   * fuera comparar contra el valor precargado, cambiar solo la carrera mandaría
   * un teléfono vacío ENCIMA de un número real y lo borraría.
   *
   * Va como `ref` y no como estado a propósito: no cambia nada de lo que se
   * pinta, así que no debe provocar un render.
   */
  const telefonoTocado = useRef(false);

  // Con un número ya guardado el campo no se puede dejar vacío: desde aquí no se
  // borra un teléfono (el frame no dibuja esa acción), así que vaciarlo solo
  // puede ser una edición a medias. Sin número guardado, vacío es legítimo —es el
  // estado de quien nunca lo dio, y también el del suspendido de arriba.
  const telefonoOk =
    telefonoGuardado !== null
      ? telefonoValido(telefono)
      : telefono.trim() === '' || telefonoValido(telefono);

  const puedeGuardar =
    nombre.trim().length > 0 && universidad !== null && campus !== null && telefonoOk;

  const guardar = async () => {
    if (!puedeGuardar || guardando) return;
    setGuardando(true);

    // "El número se escribió en ESTE guardado", que NO es lo mismo que "tocó el
    // campo": sin número previo, tocarlo y dejarlo vacío es válido y no escribe
    // nada. Se calcula una vez y lo usan el UPDATE y el toast de abajo.
    const mandaTelefono = telefonoTocado.current && telefonoValido(telefono);

    try {
      await guardarPerfil(userId, {
        nombre,
        carrera,
        campusId: campus!.id,
        ...(mandaTelefono ? { telefono } : {}),
      });

      // Antes de salir: es lo que actualiza `tiene_telefono` (el gate de
      // Publicar), la zona de entrega de una publicación nueva y el campus del
      // Feed, que sigue al del perfil (`src/lib/explorar-state.tsx`).
      await refreshProfile();

      /**
       * Un suspendido SÍ guarda su número —`users_update_own` no lleva
       * `is_active_user()`, y eso es decisión de producto (§3)— pero al reabrir
       * esta pantalla lo va a ver vacío, porque `seller_whatsapp` niega el
       * self-call por sus DOS puntas a la vez: el llamante
       * (`private.is_active_user()`, 20260911000449:35) y el objetivo
       * (`and u.estado = 'activo'`, `:39`), que con `caller = target` son la
       * misma persona. Sin este aviso, el toast de éxito y el campo vacío se
       * contradicen y lo razonable es concluir que no se guardó.
       *
       * El texto NO dice "no puedes editar" —sí editó— sino qué va a pasar con
       * el dato. Sobre la cuenta PROPIA el repo ya nombra la suspensión
       * explícitamente (`detalle/[id].tsx:267`); el tono neutro que sí se cuida
       * es el de la cuenta de un tercero.
       *
       * `profile` no queda stale pese al `refreshProfile()` de arriba: `estado`
       * está fuera del grant de update, así que este guardado no puede moverlo.
       *
       * Sigue siendo variante 'exito': el guardado funcionó, y un icono de error
       * diría lo contrario.
       */
      mostrar(
        mandaTelefono && profile?.estado === 'suspendido'
          ? 'Cambios guardados. Tu WhatsApp no se mostrará mientras tu cuenta esté suspendida'
          : 'Cambios guardados'
      );
      router.back();
    } catch (e: any) {
      console.warn('[editar-perfil] no se pudo guardar:', e?.message ?? e);
      mostrar('No pudimos guardar los cambios. Intenta de nuevo.', 'error');
      setGuardando(false);
    }
  };

  return (
    <>
      <Screen
        header={
          <FormHeader
            title="Editar perfil"
            trailing={{
              label: guardando ? 'Guardando…' : 'Guardar',
              onPress: guardar,
              disabled: !puedeGuardar || guardando,
            }}
          />
        }
      >
        <StatusBar style="dark" />

        {/* `.form-body` con `display:flex; flex-direction:column; align-items:center`. */}
        <View style={styles.body}>
          {/*
            `.photo-upload-circle` con los overrides del frame
            (`border-style:solid; border-color:var(--line)`) porque aquí no está
            vacío: contiene el avatar (foto o iniciales).

            YA NO ES INERTE (RF-03). Era un `View` sin `accessibilityRole`
            mientras no hacía nada —el criterio del tile de espera de
            `PhotoRow`—; ahora abre el carrete, así que es un `Pressable` que SÍ
            se anuncia como botón. El bucket propio que le faltaba es `avatars`
            (migración `20260916000456`): `listing-photos` no se podía prestar
            porque autoriza por carpeta `{listing_id}/` y un avatar no tiene
            publicación.

            Se deshabilita mientras sube: el scrim ya lo dice visualmente, pero
            sin esto un segundo tap encolaría otra subida. El `enCurso` de
            `useFotoPerfil` es la red que no depende del render.
          */}
          <Pressable
            style={styles.photoCircle}
            onPress={cambiarFoto}
            disabled={subiendoFoto}
            accessibilityRole="button"
            accessibilityLabel="Cambiar foto de perfil"
          >
            <Avatar
              path={fotoUrl}
              nombre={nombre}
              style={styles.avatar}
              textStyle={styles.avatarText}
            >
              {subiendoFoto ? (
                <View style={styles.avatarScrim}>
                  <BlinkingDots style={styles.avatarScrimDots} />
                </View>
              ) : null}
            </Avatar>
            {/* .cam-badge{bottom:0; right:0; width:26px; height:26px; background:var(--brick); border:2px solid var(--paper);}
                Va FUERA del `Avatar`, que recorta con `overflow:'hidden'` para
                que la foto respete el círculo — dentro quedaría cortado. */}
            <View style={styles.camBadge}>
              <IconCamera size={12} color={Colors.paper} />
            </View>
          </Pressable>

          {/* El frame mete los campos en un contenedor `width:100%` — sin él, el
              `align-items:center` del cuerpo los encogería a su contenido. */}
          <View style={styles.campos}>
            <Field
              label="Nombre completo"
              placeholder="Ej. Enrique Macías"
              value={nombre}
              onChangeText={setNombre}
              editable={!guardando}
            />
            <Field
              label="Carrera"
              placeholder="Ej. Ingeniería en Sistemas"
              value={carrera}
              onChangeText={setCarrera}
              editable={!guardando}
            />
            {/*
              El MISMO `PhoneField` que el gate de Publicar, pero sin `hint`: allá
              la letra chica explica por qué de pronto se le pide el número; aquí
              el usuario vino a editar su perfil a propósito (el comentario del
              frame lo dice así).
            */}
            <PhoneField
              label="Tu WhatsApp"
              value={telefono}
              onChangeText={(v) => {
                telefonoTocado.current = true;
                setTelefono(v);
              }}
              editable={!guardando}
            />
            {/* Fija, sin chevron: la asigna el servidor, no se elige. */}
            <FixedField
              label="Universidad"
              value={universidad?.nombre}
              placeholder="Sin universidad asignada"
            />
            {/* Último `.field` del frame: `margin-bottom:0`. */}
            <SelectField
              label="Campus"
              value={campus?.nombre}
              placeholder="Selecciona tu campus"
              onPress={() => setCampusSheetVisible(true)}
              disabled={universidad === null || guardando}
              containerStyle={styles.ultimoCampo}
            />
          </View>
        </View>
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
  // .form-body{padding:18px 20px 100px;} + los dos overrides del frame.
  body: {
    paddingTop: 18,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 100,
    alignItems: 'center',
  },
  // .photo-upload-circle{width:84px; height:84px; border-radius:50%;
  //   border:1.5px solid var(--line); margin-bottom:22px;}
  photoCircle: {
    width: 84,
    height: 84,
    borderRadius: Radii.full,
    borderWidth: 1.5,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  // .seller-avatar con `width:100%; height:100%` — el mismo forest-tint de
  // siempre, a la escala del círculo.
  avatar: {
    width: '100%',
    height: '100%',
    borderRadius: Radii.full,
    backgroundColor: Colors.forestTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    ...Typography.editAvatarInitials,
    color: Colors.forest,
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
  // `.splash-dots` trae un margin-top pensado para el Splash; centrado aquí se
  // anula, igual que en `.primary-btn.is-busy` y en `PhotoRow`.
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
  campos: {
    width: '100%',
  },
  ultimoCampo: {
    marginBottom: 0,
  },
});
