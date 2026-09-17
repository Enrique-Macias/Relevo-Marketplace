/**
 * Frames "¿A quién le vendiste?", su estado sin contactos, y su modo corrección.
 *
 * POR QUÉ EXISTE, que no se ve en el diseño: como no hay chat interno (RF-13),
 * el vendedor no sabe quién compró. Esta pantalla convierte el log de
 * `listing_contacts` en una elección explícita, y esa elección es lo único que
 * después autoriza la calificación entre las dos partes (`private.can_rate()`).
 *
 * LOS TRES ESTADOS SON UNA SOLA PANTALLA, mismo patrón que Categoría y Búsqueda
 * (CLAUDE.md §5):
 *   · con contactos    — la lista + la salida "No fue a través de Relevo".
 *   · sin contactos    — el `.empty-state`; el CTA sigue marcando la venta.
 *   · modo corrección  — la publicación YA está vendida y trae comprador: el
 *                        radio nace en él, el CTA dice "Guardar cambio" y la
 *                        salida no se pinta (deshacer una venta registrada no
 *                        está soportado; `listing_sales` no tiene DELETE).
 */

import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/Buttons';
import { BuyerRow, BuyerRowAvatarNeutro } from '@/components/BuyerRow';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { IconClose, IconUsers } from '@/components/icons';
import { FormHeader } from '@/components/ListRow';
import { Screen } from '@/components/Screen';
import { SkeletonRows } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { Colors, ScreenPadding, Typography } from '@/constants/theme';
import { ListingNoEditableError } from '@/lib/listings';
import {
  VentaCongeladaError,
  corregirComprador,
  marcarVendidaSinComprador,
  registrarVenta,
  useVenta,
} from '@/lib/confianza';
import { useSession } from '@/lib/session';

/** El valor del radio cuando se elige la salida. No es un userId posible. */
const SIN_COMPRADOR = '__sin_comprador__';

export default function VendidaScreen() {
  const { id, titulo } = useLocalSearchParams<{ id: string; titulo?: string }>();
  const listingId = Number(id);
  const insets = useSafeAreaInsets();
  const { mostrar } = useToast();
  const { session } = useSession();

  // El vendedor es quien mira: a esta pantalla solo se llega desde las tres
  // entradas del dueño, y la RLS lo confirma —`listing_sales_select` no le
  // devuelve fila a un tercero, y `fetchContactos` solo ve los contactos de las
  // publicaciones propias. Va explícito y no derivado dentro de `fetchVenta`
  // porque ahí el mismo parámetro lo consume también el camino del comprador.
  const { contactos, venta, estado, recargar } = useVenta(
    Number.isNaN(listingId) ? null : listingId,
    session?.user.id ?? null
  );

  /**
   * `null` = todavía no eligió. NO se preselecciona la primera fila: el frame
   * la pinta marcada para documentar el estado seleccionado, pero sin elección
   * explícita "nada" y "No fue a través de Relevo" serían indistinguibles.
   *
   * En modo corrección sí nace con valor — ver `seleccionEfectiva`.
   */
  const [elegido, setElegido] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const corrigiendo = venta !== null;
  /**
   * En corrección, el comprador ya registrado es la selección inicial. Se
   * deriva en vez de sembrarse con un efecto: `venta` llega asíncrono, así que
   * un `setElegido` en un efecto pintaría un render con todo sin marcar.
   */
  const seleccionEfectiva = elegido ?? (corrigiendo ? venta.compradorId : null);

  const sinContactos = estado === 'ready' && contactos.length === 0;

  async function confirmar() {
    if (guardando) return;
    // Sin contactos no hay nada que elegir y el botón está habilitado igual:
    // marcar la venta sigue siendo posible, que es el punto del estado vacío.
    // Ese caso cae abajo, en la misma rama que la salida explícita.
    if (!sinContactos && seleccionEfectiva === null) return;

    // Se copia a un local para que TypeScript pueda estrecharlo: el guard de
    // arriba no basta, porque `!sinContactos && … === null` no le dice nada
    // sobre el caso contrario.
    const eleccion = seleccionEfectiva;

    setGuardando(true);
    try {
      // Sin comprador que registrar: la salida explícita, o el estado vacío
      // (donde no hubo nada que elegir). Las dos hacen exactamente lo mismo.
      if (sinContactos || eleccion === null || eleccion === SIN_COMPRADOR) {
        await marcarVendidaSinComprador(listingId);
        mostrar('Publicación marcada como vendida');
        router.back();
        return;
      }

      if (corrigiendo) {
        await corregirComprador(listingId, eleccion);
        mostrar('Comprador actualizado');
        router.back();
        return;
      }

      await registrarVenta(listingId, eleccion);

      // `replace` y no `push`: volver atrás desde Calificar tiene que devolver a
      // "Mis publicaciones", no a una pantalla de venta que ya se consumió.
      const comprador = contactos.find((c) => c.userId === eleccion);
      router.replace({
        pathname: '/(confianza)/calificar',
        params: {
          toUserId: eleccion,
          listingId: String(listingId),
          nombre: comprador?.nombre ?? '',
          fotoUrl: comprador?.fotoUrl ?? '',
        },
      });
    } catch (e: any) {
      // El congelamiento no llega como error de Postgres —el `using` de la
      // policy filtra la fila y el update afecta 0—, así que `corregirComprador`
      // lo convierte en este error para poder decirlo. El texto es DIRECCIONAL
      // a propósito: lo que cierra la ventana es la calificación del propio
      // vendedor, no cualquier reseña de la venta.
      if (e instanceof VentaCongeladaError) {
        mostrar('Ya calificaste a esta persona, el comprador no se puede cambiar', 'error');
      } else if (e instanceof ListingNoEditableError) {
        // La publicación ya estaba vendida cuando se intentó marcarla. Se llega
        // desde una pantalla con el estado viejo en memoria, o reintentando una
        // venta cuya respuesta se perdió. En los dos casos la venta ya quedó
        // registrada, así que el remedio es volver a abrirla y no reintentar.
        mostrar('Esta publicación ya estaba marcada como vendida', 'error');
      } else {
        console.warn('[vendida] no se pudo confirmar:', e?.message ?? e);
        mostrar('No pudimos marcar la publicación como vendida', 'error');
      }
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <Screen
        header={<FormHeader title="Marcar como vendida" />}
        contentStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        <StatusBar style="dark" />

        <View style={styles.body}>
          <Text style={styles.sub}>
            {titulo ? `"${titulo}" — ` : ''}
            {corrigiendo
              ? 'elige a la persona correcta. Solo puedes cambiarlo mientras no la hayas calificado.'
              : 'elige quién se la llevó para poder calificarlo. Esto es opcional pero ayuda a la comunidad.'}
          </Text>

          {estado === 'error' ? (
            <ErrorState
              onRetry={recargar}
              title="No pudimos cargar tus contactos"
              sub="Revisa tu conexión e intenta de nuevo."
            />
          ) : estado === 'loading' ? (
            <SkeletonRows filas={3} style={styles.skeleton} />
          ) : sinContactos ? (
            // Frame "¿A quién le vendiste? (sin contactos)". Sin `.empty-actions`:
            // la única acción posible ya está en el `.sticky-cta`.
            <EmptyState
              icon={<IconUsers size={30} color={Colors.inkSoft} />}
              title="Nadie te contactó por Relevo"
              sub="Puedes marcarla como vendida de todos modos. No habrá a quién calificar, porque la calificación solo existe entre personas que se contactaron aquí."
            />
          ) : (
            <>
              <Text style={styles.label}>Personas que te contactaron</Text>
              {contactos.map((c, i) => (
                <BuyerRow
                  key={c.userId}
                  nombre={c.nombre}
                  fotoUrl={c.fotoUrl}
                  contactoAt={c.createdAt}
                  selected={seleccionEfectiva === c.userId}
                  last={corrigiendo && i === contactos.length - 1}
                  onPress={() => setElegido(c.userId)}
                />
              ))}

              {/* La salida NO se pinta en corrección: deshacer una venta ya
                  registrada no está soportado (la tabla no tiene DELETE), así
                  que ofrecerlo prometería algo que la base rechaza. */}
              {corrigiendo ? null : (
                <>
                  <Text style={[styles.label, styles.labelOtra]}>Otra opción</Text>
                  <BuyerRow
                    nombre="No fue a través de Relevo"
                    selected={seleccionEfectiva === SIN_COMPRADOR}
                    last
                    onPress={() => setElegido(SIN_COMPRADOR)}
                    leading={
                      <BuyerRowAvatarNeutro>
                        <IconClose size={16} color={Colors.inkSoft} />
                      </BuyerRowAvatarNeutro>
                    }
                  />
                </>
              )}
            </>
          )}
        </View>
      </Screen>

      {/* .sticky-cta — hermano del `.screen`, fuera del Screen para que no
          scrollee con la lista. */}
      <View style={[styles.stickyCta, { paddingBottom: insets.bottom + 22 }]}>
        <PrimaryButton
          label={corrigiendo ? 'Guardar cambio' : 'Confirmar venta'}
          onPress={confirmar}
          busy={guardando}
          // Sin contactos no hay nada que elegir, así que el botón se habilita
          // solo: marcar la venta sigue siendo posible, que es el punto del
          // estado vacío.
          disabled={estado !== 'ready' || (!sinContactos && seleccionEfectiva === null)}
          style={styles.cta}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  // .form-body{padding:18px 20px 100px;} — el 100 lo aporta el contentStyle.
  body: {
    paddingTop: 18,
    paddingHorizontal: ScreenPadding,
  },
  // .auth-sub con text-align:left, max-width:none, margin-bottom:18px.
  sub: {
    ...Typography.auth,
    color: Colors.inkSoft,
    marginBottom: 18,
  },
  // .field-label con margin-bottom:2px (el .buyer-row aporta su propio padding).
  label: {
    ...Typography.label,
    color: Colors.ink,
    marginBottom: 2,
  },
  // style="margin:20px 0 2px;"
  labelOtra: {
    marginTop: 20,
  },
  skeleton: {
    paddingHorizontal: 0,
  },
  // .sticky-cta{position:absolute; bottom:0; left:0; right:0;
  //   padding:14px 20px 22px; background:rgba(243,240,234,0.94);
  //   border-top:1px solid var(--line);}
  stickyCta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 14,
    paddingHorizontal: ScreenPadding,
    backgroundColor: 'rgba(243,240,234,0.94)',
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  cta: {
    marginTop: 0,
  },
});
