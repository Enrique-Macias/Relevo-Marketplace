/**
 * Frame "Calificar" (RF-12).
 *
 * NO lleva `.form-header`: es un `.auth-body` centrado, con el avatar grande,
 * el headline, las estrellas, el comentario opcional y "Omitir por ahora" como
 * `.auth-link`. Es la misma forma de las pantallas de auth, no la de un
 * formulario.
 *
 * Se llega por dos caminos, y por eso los params traen todo lo que hace falta:
 *   · el VENDEDOR, desde "¿A quién le vendiste?" tras registrar la venta;
 *   · el COMPRADOR, desde el Detalle de una publicación ya vendida.
 * La base no distingue: `private.can_rate()` autoriza las dos direcciones
 * mientras la pareja sea vendedor ↔ comprador registrado.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthBody, AuthHeadline, AuthLink, AuthLinkStrong, AuthSub } from '@/components/AuthBody';
import { PrimaryButton } from '@/components/Buttons';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { StarRating } from '@/components/StarRating';
import { useToast } from '@/components/Toast';
import { Colors, Radii, Typography } from '@/constants/theme';
import { crearRating } from '@/lib/confianza';
import { iniciales } from '@/lib/format';
import { useSession } from '@/lib/session';

export default function CalificarScreen() {
  const { toUserId, listingId, nombre } = useLocalSearchParams<{
    toUserId: string;
    listingId: string;
    nombre?: string;
  }>();
  const { session } = useSession();
  const { mostrar } = useToast();

  const [estrellas, setEstrellas] = useState(0);
  const [comentario, setComentario] = useState('');
  const [guardando, setGuardando] = useState(false);

  // El headline del frame usa el NOMBRE DE PILA ("¿Cómo estuvo tu experiencia
  // con Jorge?"), no el nombre completo. Con el perfil a medias el nombre puede
  // no existir todavía, y ahí el copy cae a una forma sin nombre.
  const nombrePila = (nombre ?? '').trim().split(/\s+/)[0] || '';

  async function enviar() {
    if (estrellas === 0 || guardando) return;

    const fromUserId = session?.user.id;
    if (!fromUserId) return;

    setGuardando(true);
    try {
      await crearRating({
        fromUserId,
        toUserId,
        listingId: Number(listingId),
        estrellas,
        comentario,
      });
      mostrar('¡Gracias por calificar!');
      router.back();
    } catch (e: any) {
      // 23505 = el `unique (from_user_id, to_user_id, listing_id)` de la tabla,
      // que es lo que impide calificar dos veces la misma transacción. Es un
      // caso alcanzable de verdad: la pantalla se abre desde dos lados.
      if (e?.code === '23505') {
        mostrar('Ya calificaste esta compra', 'error');
        router.back();
        return;
      }
      console.warn('[calificar] no se pudo enviar:', e?.message ?? e);
      mostrar('No pudimos enviar tu calificación', 'error');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Screen>
      <StatusBar style="dark" />

      <AuthBody>
        {/* .rate-avatar{width:64px; height:64px; background:var(--forest-tint);
            color:var(--forest);} — es --forest y no --slate como .buyer-avatar:
            aquí el gesto es de confianza, no de selección. */}
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{iniciales(nombre)}</Text>
        </View>

        <AuthHeadline>
          {nombrePila
            ? `¿Cómo estuvo tu experiencia con ${nombrePila}?`
            : '¿Cómo estuvo tu experiencia?'}
        </AuthHeadline>
        <AuthSub>Tu calificación ayuda a que la comunidad confíe más en Relevo.</AuthSub>

        <StarRating valor={estrellas} onChange={setEstrellas} disabled={guardando} />

        {/* El frame no le pone `.field-label` a este campo: el placeholder es
            toda la etiqueta que tiene. `Field` lo exige, así que va vacío. */}
        <Field
          label=""
          placeholder="Cuéntanos cómo fue (opcional)"
          value={comentario}
          onChangeText={setComentario}
          editable={!guardando}
          multiline
          style={styles.textarea}
          textAlignVertical="top"
          containerStyle={styles.campo}
        />

        <PrimaryButton
          label="Enviar calificación"
          onPress={enviar}
          busy={guardando}
          // Sin estrellas no hay calificación: el comentario es lo opcional, no
          // el puntaje (la columna es `not null check (estrellas between 1 and 5)`).
          disabled={estrellas === 0}
          style={styles.cta}
        />

        <AuthLink>
          <AuthLinkStrong onPress={() => router.back()}>Omitir por ahora</AuthLinkStrong>
        </AuthLink>
      </AuthBody>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // .rate-avatar{width:64px; height:64px; border-radius:50%;
  //   background:var(--forest-tint); margin-bottom:16px;}
  avatar: {
    width: 64,
    height: 64,
    borderRadius: Radii.full,
    backgroundColor: Colors.forestTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  // .rate-avatar{font-family:display; font-weight:600; font-size:22px; color:var(--forest);}
  avatarText: {
    ...Typography.rateAvatarInitials,
    color: Colors.forest,
  },
  // El .field del frame va a ancho completo dentro del .auth-body centrado.
  campo: {
    width: '100%',
  },
  // .textarea-field{min-height:84px; line-height:1.5;}
  textarea: {
    minHeight: 84,
    lineHeight: 21, // 14 × 1.5
  },
  cta: {
    width: '100%',
  },
});
