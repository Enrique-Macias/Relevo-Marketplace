/**
 * Frame "Editar perfil" (`design/relevo-app.html`, grupo `cuenta`).
 *
 * Es la OTRA puerta del teléfono de RF-13 — `docs/product-spec.md:284` lo dice
 * con esas palabras: hasta ahora el único lugar donde se podía capturar un
 * WhatsApp era el gate de Publicar, así que quien ya había publicado no tenía
 * cómo corregirlo. Y es el primer camino de código que escribe `carrera`.
 *
 * No toca la base: las cinco columnas que escribe ya están en el grant de update
 * (`20260906000438:110` + `20260910000448:62`) y `users_update_own` no lleva
 * `is_active_user()` — un usuario SUSPENDIDO puede editar su propio perfil,
 * incluido su teléfono, y eso es decisión de producto documentada (CLAUDE.md §3,
 * tabla de decisión), no un descuido de la policy.
 */

import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CampusBottomSheet } from '@/components/CampusBottomSheet';
import { ErrorState } from '@/components/ErrorState';
import { Field, PhoneField, SelectField } from '@/components/Field';
import { IconCamera } from '@/components/icons';
import { FormHeader } from '@/components/ListRow';
import { Screen } from '@/components/Screen';
import { SkeletonPerfilForm } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';
import { iniciales } from '@/lib/format';
import {
  fetchPerfilEditable,
  fetchTelefonoVendedor,
  formatTelefonoNacional,
  guardarPerfil,
  telefonoValido,
  type PerfilEditable,
} from '@/lib/perfil';
import { useSession } from '@/lib/session';

import { useInstitucionalDraft } from './_layout';

type Datos = { perfil: PerfilEditable; telefono: string | null };

export default function EditarPerfilScreen() {
  const { session } = useSession();
  const { hidratar } = useInstitucionalDraft();
  const userId = session?.user.id ?? null;

  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState(false);
  const [recargas, setRecargas] = useState(0);

  /**
   * Las dos fuentes en paralelo, porque el teléfono NO viaja con el perfil: está
   * fuera del grant de select (RNF-05) y solo sale por `seller_whatsapp`.
   *
   * OJO — aquí NO hay refetch al recuperar el foco, al revés que
   * `mis-publicaciones.tsx` o `(publicar)/editar/[id].tsx`. La única ruta hija es
   * el selector de universidad, que no escribe en la base sino en el borrador del
   * layout: recargar al volver de ahí pisaría la universidad que el usuario
   * acaba de elegir con la que sigue guardada.
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
        // El borrador del bloque institucional se siembra aquí, no en el
        // formulario: es el layout quien lo guarda, para que el selector de
        // universidad —otra ruta— pueda escribirlo.
        hidratar({ universidad: perfil.universidad, campus: perfil.campus });
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
    // `hidratar` entra a las deps sin re-disparar nada: es el `setValor` de
    // `useState` del layout, o sea la misma referencia en todos los renders.
  }, [userId, recargas, hidratar]);

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
  const { universidad, campus, setCampus } = useInstitucionalDraft();
  const { mostrar } = useToast();

  const [nombre, setNombre] = useState(perfil.nombre);
  const [carrera, setCarrera] = useState(perfil.carrera);
  const [telefono, setTelefono] = useState(
    telefonoGuardado ? formatTelefonoNacional(telefonoGuardado) : ''
  );
  const [guardando, setGuardando] = useState(false);
  const [campusSheetVisible, setCampusSheetVisible] = useState(false);

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
        universidadId: universidad!.id,
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
            vacío: contiene el avatar de iniciales.

            INERTE A PROPÓSITO — subir la foto de perfil sigue fuera de alcance
            (CLAUDE.md §8): exige un bucket propio con sus policies, que
            `listing-photos` no puede prestar (autoriza por carpeta
            `{listing_id}/`). Es un `View` y no un `Pressable`, sin
            `accessibilityRole="button"`: si no pasa nada, no debe anunciarse ni
            sentirse como un botón — el mismo criterio del tile de espera de
            `PhotoRow`.
          */}
          <View style={styles.photoCircle}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{iniciales(nombre)}</Text>
            </View>
            {/* .cam-badge{bottom:0; right:0; width:26px; height:26px; background:var(--brick); border:2px solid var(--paper);} */}
            <View style={styles.camBadge}>
              <IconCamera size={12} color={Colors.paper} />
            </View>
          </View>

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
            <SelectField
              label="Universidad"
              value={universidad?.nombre}
              placeholder="Selecciona tu universidad"
              onPress={() => router.push('/editar-perfil/universidad')}
              disabled={guardando}
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
