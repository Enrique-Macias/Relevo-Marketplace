/** Detalle de publicación — 2 estados: vista comprador / vista vendedor. */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostButton, PrimaryButton } from '@/components/Buttons';
import { CategoryIcon } from '@/components/icons/categories';
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconFlag,
  IconHeart,
  IconKebab,
  IconMapPin,
  IconShare,
  IconWhatsapp,
} from '@/components/icons';
import { ErrorState } from '@/components/ErrorState';
import {
  PhotoCarousel,
  PhotoDots,
  type PhotoCarouselHandle,
} from '@/components/PhotoCarousel';
import { PhotoViewer } from '@/components/PhotoViewer';
import { RoundIconButton } from '@/components/RoundIconButton';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Colors, Radii, Typography } from '@/constants/theme';
import { accionVenta, LABEL_ACCION_VENTA, useVentaDetalle } from '@/lib/confianza';
import { useExplorarState } from '@/lib/explorar-state';
import { Avatar } from '@/components/Avatar';
import { formatPrecio, formatRelativo } from '@/lib/format';
import {
  fetchListingById,
  fetchStatsPropias,
  fetchVentasVendedor,
  incrementListingView,
  registrarContacto,
  type ListingDetalle,
} from '@/lib/listings';
import { fetchTelefonoVendedor, urlWhatsapp } from '@/lib/perfil';
import { useSession } from '@/lib/session';

const CONDICION_LABEL: Record<string, string> = {
  nuevo: 'Nuevo',
  como_nuevo: 'Como nuevo',
  buen_estado: 'Buen estado',
  usado: 'Usado',
};

const TINT_BG: Record<string, string> = {
  brick: Colors.brickTint,
  slate: Colors.slateTint,
  gold: Colors.goldTint,
  forest: Colors.forestTint,
};

const TINT_FG: Record<string, string> = {
  brick: Colors.brick,
  slate: Colors.slate,
  gold: Colors.gold,
  forest: Colors.forest,
};

export default function DetalleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const listingId = Number(id);
  const insets = useSafeAreaInsets();
  const { favoritos, toggleFavorito, getCategoria } = useExplorarState();
  const { session, profile } = useSession();
  const { mostrar } = useToast();

  const [listing, setListing] = useState<ListingDetalle | null>(null);
  // De qué publicación es lo que tenemos cargado (o falló). Comparado contra
  // `listingId` da el estado sin necesidad de un setState sincrónico dentro del
  // efecto para "volver a loading" — mismo idioma que `perfilCargadoPara` en
  // `src/lib/session.tsx`.
  const [cargadoPara, setCargadoPara] = useState<number | null>(null);
  const [errorPara, setErrorPara] = useState<number | null>(null);
  const [ventas, setVentas] = useState(0);
  const [stats, setStats] = useState({ contactos: 0, favoritos: 0 });
  const [recargas, setRecargas] = useState(0);

  /**
   * Carrusel del hero. `indiceFoto` es la ÚNICA fuente de verdad de en qué foto
   * está: `PhotoCarousel` no guarda índice propio a propósito, justo para que
   * `irA()` no tenga que reconciliar dos estados.
   *
   * `fotoAmpliada` es el índice con el que abre el visor, o `null` si está
   * cerrado — y es también lo que lo monta y desmonta (ver `PhotoViewer`).
   */
  const [indiceFoto, setIndiceFoto] = useState(0);
  const [fotoAmpliada, setFotoAmpliada] = useState<number | null>(null);
  const carruselRef = useRef<PhotoCarouselHandle>(null);

  const userId = session?.user.id ?? null;
  const isOwner = !!listing && !!userId && listing.userId === userId;

  /**
   * Frame "Detalle (vendida)". Solo se pide cuando la publicación YA está
   * vendida: en cualquier otro estado no hay fila de venta que leer, y el
   * reparto del `.sticky-cta` no depende de ella.
   */
  const { venta, yaCalifique } = useVentaDetalle(
    listing?.estado === 'vendida' ? listing.id : null,
    userId,
    listing?.vendedor.id ?? null,
    recargas
  );
  const accionDeVenta = listing ? accionVenta(listing.estado, venta) : null;
  // RF-08: vendida es terminal. Hermano del `puedeEditar` de la hoja de "Mis
  // publicaciones" — la misma regla, en la otra entrada a la misma pantalla.
  const puedeEditar = listing?.estado !== 'vendida';
  // "Soy el comprador" NO se deduce del estado sino de la fila: `listing_sales`
  // solo la ven las dos partes, así que la RLS ya contestó esa pregunta.
  const soyComprador = !!venta && !!userId && venta.compradorId === userId;
  // Una ruta con id no numérico es un error derivado del param, no un estado
  // que haya que asentar con setState desde un efecto.
  const idValido = !Number.isNaN(listingId);

  useEffect(() => {
    if (!idValido) return;

    let vigente = true;

    fetchListingById(listingId)
      .then((data) => {
        if (!vigente) return;
        setListing(data);
        setCargadoPara(listingId);
      })
      .catch((e) => {
        if (!vigente) return;
        console.warn('[detalle] no se pudo leer la publicación:', e?.message ?? e);
        setErrorPara(listingId);
      });

    return () => {
      vigente = false;
    };
  }, [listingId, recargas, idValido]);

  /**
   * Recargar al VOLVER a la pantalla, no solo al montar. Mismo patrón —y mismo
   * `ref` para saltarse el primer foco— que "Mis publicaciones".
   *
   * No es una mejora de frescura general: es lo que hace que el reparto del
   * `.sticky-cta` sea correcto después de marcar la venta DESDE AQUÍ. El flujo
   * empuja `(confianza)/vendida/[id]` y vuelve con `router.back()`, así que esta
   * pantalla nunca se desmonta; sin esto seguiría ofreciendo "Editar publicación"
   * y "Marcar como vendida" sobre una publicación que ya se vendió, y el primero
   * llevaría a un formulario que la base va a rechazar.
   *
   * `recargas` alimenta también a `useVentaDetalle`: con el listing fresco pero
   * la venta vieja, `accionVenta()` vería `estado='vendida'` + `venta=null` y
   * pintaría el aviso de "ya se vendió" en lugar de "Cambiar comprador", justo
   * después de registrar al comprador.
   */
  const primerFoco = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primerFoco.current) {
        primerFoco.current = false;
        return;
      }
      setRecargas((n) => n + 1);
    }, [])
  );

  const estado: 'loading' | 'ready' | 'error' =
    errorPara === listingId ? 'error' : cargadoPara === listingId ? 'ready' : 'loading';

  /**
   * Vistas (RF-09). Una sola vez por publicación abierta: el `ref` es lo que
   * evita que el doble montaje de desarrollo cuente dos veces.
   *
   * NO lleva `if (!isOwner)`. La exclusión del dueño ya vive dentro de la
   * función (`user_id is distinct from auth.uid()`, migración 20260906000442) y
   * repetirla aquí sería lógica de autorización duplicada en el cliente, que es
   * justo lo que prohíbe CLAUDE.md §0 regla 7. Tampoco se hace `await`: que la
   * pantalla pinte no depende del contador.
   */
  const vistaContada = useRef<number | null>(null);
  useEffect(() => {
    if (!idValido || vistaContada.current === listingId) return;
    vistaContada.current = listingId;
    void incrementListingView(listingId).catch((e) =>
      console.warn('[detalle] no se pudo contar la vista:', e?.message ?? e)
    );
  }, [listingId, idValido]);

  // Datos secundarios: los del vendedor si soy comprador, los stats si soy dueño.
  useEffect(() => {
    if (!listing) return;

    let vigente = true;
    if (isOwner) {
      fetchStatsPropias(listing.id)
        .then((s) => vigente && setStats(s))
        .catch((e) => console.warn('[detalle] no se pudieron leer los stats:', e?.message ?? e));
    } else {
      fetchVentasVendedor(listing.vendedor.id)
        .then((n) => vigente && setVentas(n))
        .catch((e) => console.warn('[detalle] no se pudieron contar las ventas:', e?.message ?? e));
    }

    return () => {
      vigente = false;
    };
  }, [listing, isOwner]);

  /**
   * Compartir — texto plano y NINGÚN link, a propósito.
   *
   * El proyecto todavía no tiene universal links (iOS) / App Links (Android) ni
   * una página web de respaldo, así que cualquier URL que pusiéramos aquí sería
   * un link roto para quien no tenga la app instalada — peor que no poner nada.
   * Ver la deuda consciente de CLAUDE.md §8.
   *
   * Va `Share` de react-native y no `expo-sharing`, que es para compartir
   * ARCHIVOS. Se pinta en las tres variantes de Detalle (comprador, vendida y
   * vista vendedor) porque el frame lo tiene en las tres: a diferencia de la
   * bandera, este botón nunca dependió de `isOwner`.
   */
  async function compartir() {
    if (!listing) return;
    try {
      await Share.share({
        message: `${listing.titulo}\n${formatPrecio(listing.precio)}\nPublicado en Relevo`,
      });
    } catch (e: any) {
      // Cancelar la hoja nativa NO entra aquí (resuelve con
      // `action: 'dismissedAction'`), así que esto es un fallo de verdad.
      console.warn('[compartir] no se pudo abrir:', e?.message ?? e);
    }
  }

  /**
   * RF-13 — el contacto por WhatsApp, en tres pasos y en este orden: conseguir
   * el número, registrar el contacto, abrir el deep link. El porqué de cada uno
   * está en el cuerpo, junto al paso que lo explica.
   */
  async function contactarPorWhatsapp() {
    if (!listing) return;

    /**
     * EL NÚMERO VA PRIMERO, Y ESO CAMBIÓ EL ORDEN DE ESTA FUNCIÓN.
     *
     * Antes se registraba el contacto y se abría WhatsApp con un placeholder,
     * así que nada podía impedir el contacto. Ahora el número puede no llegar
     * —y hay dos motivos distintos por los que no llega— y en ese caso no hubo
     * contacto: registrarlo dejaría en "¿A quién le vendiste?" (RF-12) a
     * alguien que nunca pudo escribirle.
     */
    let telefono: string | null = null;
    try {
      telefono = await fetchTelefonoVendedor(listing.vendedor.id);
    } catch (e: any) {
      console.warn(`[contacto] no se pudo leer el teléfono del vendedor: ${e?.message ?? e}`);
      mostrar('No pudimos abrir WhatsApp. Revisa tu conexión.', 'error');
      return;
    }

    if (!telefono) {
      /**
       * `seller_whatsapp` devuelve null por TRES causas y no dice cuál — no
       * revela por qué negó. Las tres se separan aquí, cada una con un dato que
       * el cliente ya tiene:
       *
       *  1. quien llama está suspendido → `profile.estado`, de la propia sesión;
       *  2. el vendedor está suspendido → `listing.vendedor.estado`, que viene
       *     en el embed (ver `VENDEDOR` en `src/lib/listings.ts`);
       *  3. el vendedor no guardó número → lo que queda.
       *
       * El orden importa: (1) va primero porque es lo que le pasa a QUIEN está
       * leyendo, y saber que su propia cuenta está suspendida le explica también
       * todo lo demás que no le funciona.
       *
       * Esto NO es lógica de autorización duplicada (CLAUDE.md §0 regla 7): el
       * candado es la RPC —el número no salió de la base, mire el cliente lo que
       * mire— y aquí solo se elige el texto. Mismo criterio que el guard de
       * reactivación, que traduce el `raise exception` del trigger de fotos a un
       * toast.
       *
       * El mensaje del vendedor suspendido es NEUTRO a propósito: `estado` es
       * consultable por cualquier autenticado, pero una cosa es que el dato
       * exista y otra anunciar en pantalla que una cuenta está sancionada.
       */
      mostrar(
        profile?.estado === 'suspendido'
          ? 'Tu cuenta está suspendida y no puede contactar vendedores'
          : listing.vendedor.estado === 'suspendido'
            ? 'Esta cuenta no está disponible para contacto'
            : 'Este vendedor todavía no ha dejado un WhatsApp',
        'error'
      );
      return;
    }

    /**
     * RF-13. El registro va con `await`, pero su fallo no cancela el contacto:
     * negarle al usuario abrir WhatsApp por un fallo de log sería peor que
     * perder la fila. Ahora bien, esa fila no es cosmética — alimenta "¿A quién
     * le vendiste?" y de ahí las calificaciones (RF-12) — así que el fallo se le
     * dice al usuario con un toast, además de quedar en consola con los ids
     * para poder correlacionarlo con los logs del proyecto.
     */
    if (userId) {
      try {
        await registrarContacto(listing.id, userId);
      } catch (e: any) {
        console.warn(
          `[contacto] falló el registro — listing_id=${listing.id} user_id=${userId} ` +
            `code=${e?.code ?? '?'} message=${e?.message ?? e}`
        );
        mostrar('No pudimos registrar el contacto', 'error');
      }
    }

    void Linking.openURL(
      urlWhatsapp(telefono, `Hola, vi tu publicación "${listing.titulo}" en Relevo`)
    );
  }

  if (!idValido || estado === 'error') {
    return (
      <Screen>
        <ErrorState
          onRetry={() => {
            setErrorPara(null);
            setRecargas((n) => n + 1);
          }}
          title="No pudimos abrir la publicación"
          sub="Revisa tu conexión e intenta de nuevo."
        />
      </Screen>
    );
  }

  // Sin skeleton propio: el frame no tiene uno para Detalle y no se inventa.
  if (estado === 'loading' || !listing) return null;

  const categoria = getCategoria(listing.categoriaId);
  const tint = categoria?.tint ?? 'brick';
  const favorito = favoritos.has(listing.id);
  const createdAt = new Date(listing.createdAt);

  return (
    <>
      <Screen contentStyle={{ paddingBottom: insets.bottom + 90 }}>
        <View style={[styles.photo, { backgroundColor: TINT_BG[tint] }]}>
          {/* `.detail-track` — todas las fotos de la publicación (`fotos` ya viene
              ordenada por `orden`), deslizables en horizontal. Va por DEBAJO de
              `.nav`, `.badge` y los dots, que son absolutos y se declaran después
              en el JSX para no viajar con el scroll.

              El ícono de categoría tintado sigue siendo el fallback de las
              publicaciones sin fotos, no el contenido principal. */}
          <PhotoCarousel
            ref={carruselRef}
            fotos={listing.fotos}
            onIndiceChange={setIndiceFoto}
            contentFit="cover"
            fallback={<CategoryIcon categoriaId={categoria?.slug ?? ''} size={64} color={TINT_FG[tint]} />}
            // Sin fotos no hay nada que ampliar: ahí se ve el ícono de categoría,
            // y abrir un visor a pantalla completa sobre él no significa nada.
            onPressFoto={listing.fotos.length > 0 ? setFotoAmpliada : undefined}
            style={StyleSheet.absoluteFill}
          />

          {/* El MISMO `.sold-badge` del grid de Perfil y de "Mis publicaciones".
              Va DESPUÉS del carrusel y ANTES del chrome, que es exactamente el
              orden del frame: cubre las fotos y queda por debajo de los botones
              y los dots. */}
          {listing.estado === 'vendida' ? (
            <View style={styles.soldBadge} pointerEvents="none">
              <Text style={styles.soldBadgeText}>Vendido</Text>
            </View>
          ) : null}

          <View style={styles.nav}>
            <RoundIconButton onPress={() => router.back()}>
              <IconChevronLeft size={16} color={Colors.ink} />
            </RoundIconButton>
            <View style={styles.navActions}>
              <RoundIconButton onPress={compartir}>
                <IconShare size={15} color={Colors.ink} />
              </RoundIconButton>
              {isOwner ? (
                // más opciones: pendiente de (publicar)/(confianza)
                <RoundIconButton onPress={() => {}}>
                  <IconKebab size={17} color={Colors.ink} />
                </RoundIconButton>
              ) : (
                <RoundIconButton
                  onPress={() =>
                    router.push({
                      pathname: '/reportar/[id]',
                      // `listing.userId` y no `listing.vendedor.id`: es el MISMO
                      // campo con el que se calcula `isOwner` arriba, que es
                      // justo la condición que decide pintar esta bandera. Dos
                      // fuentes distintas para la misma pregunta se
                      // desincronizan sin dar ningún error.
                      params: { id: String(listingId), sellerId: listing.userId },
                    })
                  }
                >
                  <IconFlag size={15} color={Colors.ink} />
                </RoundIconButton>
              )}
            </View>
          </View>

          <View style={styles.badge}>
            <Text style={styles.badgeText}>{CONDICION_LABEL[listing.condicion]}</Text>
          </View>

          {/* Un punto por foto real, siguiendo al carrusel. Con 0 o 1 foto no se
              pinta ninguno: `PhotoDots` se encarga. */}
          <PhotoDots total={listing.fotos.length} activo={indiceFoto} />
        </View>

        <View style={styles.body}>
          <Text style={styles.price}>{formatPrecio(listing.precio)}</Text>
          <Text style={styles.title}>{listing.titulo}</Text>
          <View style={styles.meta}>
            <IconMapPin size={12} color={Colors.inkSoft} />
            <Text style={styles.metaText}>{listing.campusNombre}</Text>
            <Text style={styles.metaSep}>·</Text>
            <Text style={styles.metaText}>{formatRelativo(createdAt)}</Text>
            <Text style={styles.metaSep}>·</Text>
            <Text style={styles.metaText}>{listing.vistasCount} vistas</Text>
          </View>

          {!isOwner ? (
            <Pressable
              style={styles.sellerCard}
              onPress={() =>
                router.push({
                  pathname: '/(cuenta)/perfil-publico/[id]',
                  params: { id: listing.vendedor.id },
                })
              }
              accessibilityRole="button"
            >
              <Avatar
                path={listing.vendedor.fotoUrl}
                nombre={listing.vendedor.nombre}
                style={styles.sellerAvatar}
                textStyle={styles.sellerAvatarText}
              />
              <View style={styles.sellerInfo}>
                <View style={styles.sellerNameRow}>
                  <Text style={styles.sellerName}>{listing.vendedor.nombre ?? ''}</Text>
                  {/* La palomita significa "verificado por correo institucional",
                      y toda fila de public.users llegó ahí pasando por el OTP:
                      no hay un usuario no verificado que mostrar. */}
                  <View style={styles.verifiedTick}>
                    <IconCheck size={8} color={Colors.paper} />
                  </View>
                </View>
                <Text style={styles.sellerSub}>
                  {listing.vendedor.carrera ? `${listing.vendedor.carrera} · ` : ''}
                  {ventas} {ventas === 1 ? 'venta' : 'ventas'}
                </Text>
              </View>
              <IconChevronRight size={16} color={Colors.inkSoft} />
            </Pressable>
          ) : (
            <View style={styles.statRow}>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{listing.vistasCount}</Text>
                <Text style={styles.statLabel}>Vistas</Text>
              </View>
              {/* Favoritos llega por RPC, no por query: la RLS de `favorites` es
                  `user_id = auth.uid()`, así que ni el dueño de la publicación
                  puede contarlos con un select. Ver la migración
                  20260908000443. */}
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{stats.favoritos}</Text>
                <Text style={styles.statLabel}>Favoritos</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{stats.contactos}</Text>
                <Text style={styles.statLabel}>Contactos</Text>
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Descripción</Text>
            <Text style={styles.desc}>{listing.descripcion ?? ''}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Detalles</Text>
            <View style={styles.specRow}>
              <Text style={styles.specKey}>Categoría</Text>
              <Text style={styles.specVal}>{categoria?.nombre ?? ''}</Text>
            </View>
            <View style={styles.specRow}>
              <Text style={styles.specKey}>Condición</Text>
              <Text style={styles.specVal}>{CONDICION_LABEL[listing.condicion]}</Text>
            </View>
            <View style={styles.specRow}>
              <Text style={styles.specKey}>Zona de entrega</Text>
              <Text style={styles.specVal}>{listing.campusNombre}</Text>
            </View>
            <View style={[styles.specRow, styles.specRowLast]}>
              <Text style={styles.specKey}>Publicado</Text>
              <Text style={styles.specVal}>{formatRelativo(createdAt)}</Text>
            </View>
          </View>
        </View>

        {/*
          El `.sticky-cta` tiene SEIS repartos. Los tres del dueño los decide el
          estado de la publicación; los tres del resto son del frame "Detalle
          (vendida)" y los distingue la fila de venta, NO el estado: los que
          preguntaron y no compraron ven lo mismo que cualquier otro, porque
          `listing_sales` solo la ven las dos partes y "soy el comprador" es una
          pregunta que la RLS ya contestó.
        */}
        <View style={[styles.cta, { paddingBottom: insets.bottom + 22 }]}>
          {isOwner ? (
            <>
              {/* El derivado de tres estados, compartido con "Editar
                  publicación" y la hoja de "Mis publicaciones". Sobre una
                  vendida corregible este ghost se queda SOLO, y su flex:1 lo
                  deja a ancho completo sin estilo aparte. */}
              {accionDeVenta ? (
                <GhostButton
                  label={LABEL_ACCION_VENTA[accionDeVenta]}
                  onPress={() =>
                    router.push({
                      pathname: '/(confianza)/vendida/[id]',
                      params: { id: String(listing.id), titulo: listing.titulo },
                    })
                  }
                  style={styles.flexBtn}
                />
              ) : null}
              {/* Vendida es terminal (RF-08): no se edita. El candado es el
                  `using` de `listings_update_own` (20260913000454), que rechaza
                  el UPDATE mire el cliente lo que mire — esto solo evita ofrecer
                  un formulario que no va a poder guardar.

                  El estilo ya no es un ternario: `accionVenta()` devuelve
                  'marcar' para TODO estado distinto de vendida, así que cuando
                  este botón se pinta el ghost está siempre al lado y el flex:1.2
                  siempre reparte contra algo. La rama `editBtnSolo` que había
                  aquí era inalcanzable. */}
              {puedeEditar ? (
                <PrimaryButton
                  label="Editar publicación"
                  onPress={() => router.push(`/(publicar)/editar/${listing.id}`)}
                  style={styles.editBtn}
                />
              ) : null}
              {/* Vendida y sin nada pendiente —ya calificada, o "No fue a través
                  de Relevo"—: sin esto el contenedor quedaría vacío. Es el mismo
                  aviso que ve cualquier otro autenticado. */}
              {!accionDeVenta && !puedeEditar ? <VendidoNotice /> : null}
            </>
          ) : listing.estado === 'vendida' ? (
            <>
              <Pressable
                style={styles.favBtn}
                onPress={() => toggleFavorito(listing.id)}
                accessibilityRole="button"
              >
                <IconHeart size={18} color={favorito ? Colors.brick : Colors.ink} filled={favorito} />
              </Pressable>
              {soyComprador && !yaCalifique ? (
                <PrimaryButton
                  label="Calificar al vendedor"
                  onPress={() =>
                    router.push({
                      pathname: '/(confianza)/calificar',
                      params: {
                        toUserId: listing.vendedor.id,
                        listingId: String(listing.id),
                        nombre: listing.vendedor.nombre ?? '',
                        fotoUrl: listing.vendedor.fotoUrl ?? '',
                      },
                    })
                  }
                  style={styles.editBtnSolo}
                />
              ) : (
                // Cualquier otro autenticado —incluidos los que preguntaron y no
                // compraron. Sin WhatsApp: contactar por algo ya vendido no
                // tiene sentido.
                <VendidoNotice />
              )}
            </>
          ) : (
            <>
              <Pressable
                style={styles.favBtn}
                onPress={() => toggleFavorito(listing.id)}
                accessibilityRole="button"
              >
                <IconHeart size={18} color={favorito ? Colors.brick : Colors.ink} filled={favorito} />
              </Pressable>
              <Pressable
                style={styles.whatsappBtn}
                onPress={() => void contactarPorWhatsapp()}
                accessibilityRole="button"
              >
                <IconWhatsapp size={17} color={Colors.paper} />
                <Text style={styles.whatsappText}>Contactar por WhatsApp</Text>
              </Pressable>
            </>
          )}
        </View>

      </Screen>
      {/* Montaje condicional, no un prop `visible`: cada apertura tiene que ser
          un montaje nuevo para que `indiceInicial` se aplique de verdad.

          Al cerrar, las DOS mitades de la sincronización con el hero — los dots
          y el scroll real. Son dos `ScrollView` distintos, así que sin esto el
          hero se quedaría en la foto donde estaba antes de abrir el visor, y el
          usuario vería la app olvidar lo que acaba de hacer. El `irA` va sin
          animar y mientras el Modal todavía tapa: para cuando termina el fade,
          el hero ya está en su sitio. */}
      {fotoAmpliada !== null ? (
        <PhotoViewer
          fotos={listing.fotos}
          indiceInicial={fotoAmpliada}
          onCerrar={(indiceFinal) => {
            setIndiceFoto(indiceFinal);
            carruselRef.current?.irA(indiceFinal);
            setFotoAmpliada(null);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * El `.notice` del `.sticky-cta` de una publicación vendida.
 *
 * Local a este archivo y no un componente del sistema de diseño: lo usan las DOS
 * ramas de esta misma pantalla —el dueño sin nada pendiente y cualquier otro
 * autenticado— y no lo pide nadie más. Se extrajo cuando pasó a tener dos
 * consumidores, no antes.
 *
 * Va SIN su `.notice-icon`: ese círculo es --brick, el color de error del
 * sistema, y aquí no falló nada — la publicación simplemente ya se vendió.
 */
function VendidoNotice() {
  return (
    <View style={styles.vendidoNotice}>
      <Text style={styles.vendidoText}>Esta publicación ya se vendió.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: {
    width: '100%',
    height: 340,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nav: {
    position: 'absolute',
    top: 16,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  navActions: {
    flexDirection: 'row',
    gap: 8,
  },
  badge: {
    position: 'absolute',
    bottom: 34,
    right: 20,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: Radii.sm,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  badgeText: {
    ...Typography.caption,
    color: Colors.ink,
  },
  body: {
    paddingTop: 18,
    paddingHorizontal: 20,
  },
  price: {
    ...Typography.priceLarge,
    color: Colors.ink,
    marginBottom: 6,
  },
  title: {
    ...Typography.detailTitle,
    color: Colors.ink,
    marginBottom: 10,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  metaText: {
    ...Typography.meta,
    color: Colors.inkSoft,
  },
  metaSep: {
    ...Typography.meta,
    color: Colors.line,
  },
  sellerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.xl,
    padding: 13,
    paddingHorizontal: 14,
    marginBottom: 20,
  },
  sellerAvatar: {
    width: 44,
    height: 44,
    borderRadius: Radii.full,
    backgroundColor: Colors.forestTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerAvatarText: {
    ...Typography.sellerAvatarInitials,
    color: Colors.forest,
  },
  sellerInfo: {
    flex: 1,
  },
  sellerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sellerName: {
    ...Typography.emphasis,
    color: Colors.ink,
  },
  verifiedTick: {
    width: 14,
    height: 14,
    borderRadius: Radii.full,
    backgroundColor: Colors.forest,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerSub: {
    ...Typography.rowSub,
    color: Colors.inkSoft,
    marginTop: 2,
  },
  statRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 22,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.lg,
    paddingVertical: 13,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  statNum: {
    ...Typography.price,
    color: Colors.ink,
  },
  statLabel: {
    ...Typography.statLabel,
    color: Colors.inkSoft,
    marginTop: 3,
  },
  section: {
    marginBottom: 22,
  },
  sectionTitle: {
    ...Typography.emphasis,
    color: Colors.ink,
    marginBottom: 9,
  },
  desc: {
    ...Typography.paragraph,
    color: Colors.inkSoft,
  },
  specRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  specRowLast: {
    borderBottomWidth: 0,
  },
  specKey: {
    ...Typography.auth,
    lineHeight: undefined,
    color: Colors.inkSoft,
  },
  specVal: {
    ...Typography.bodyStrong,
    color: Colors.ink,
  },
  cta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 14,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(243,240,234,0.94)',
    borderTopWidth: 1,
    borderTopColor: Colors.line,
    flexDirection: 'row',
    gap: 10,
  },
  favBtn: {
    width: 48,
    height: 48,
    borderRadius: Radii.lg,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  whatsappBtn: {
    flex: 1,
    borderRadius: Radii.lg,
    backgroundColor: Colors.brick,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  whatsappText: {
    ...Typography.buttonWhatsapp,
    color: Colors.paper,
  },
  flexBtn: {
    flex: 1,
    width: undefined,
  },
  editBtn: {
    flex: 1.2,
    width: undefined,
    marginTop: 0,
  },
  // Sin el ghost al lado, el flex:1.2 no reparte contra nada y solo confunde.
  editBtnSolo: {
    flex: 1,
    width: undefined,
    marginTop: 0,
  },
  // .notice dentro del .sticky-cta, SIN su .notice-icon: ese círculo es
  // --brick, el color de error del sistema, y aquí no falló nada — la
  // publicación simplemente ya no está disponible. Lleva flex:1 para ocupar el
  // lugar del .whatsapp-btn al que reemplaza.
  vendidoNotice: {
    flex: 1,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  // .notice-text{font-size:12.5px; color:var(--ink-soft); line-height:1.45;}
  vendidoText: {
    ...Typography.meta,
    color: Colors.inkSoft,
    lineHeight: 18.125, // 12.5 × 1.45
  },
  // .sold-badge{position:absolute; inset:0; background:rgba(34,31,28,0.55);}
  // Va sobre el carrusel y por DEBAJO del chrome, igual que en el frame.
  soldBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(34,31,28,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // .sold-badge{color:#fff; font-size:11px; font-weight:600; letter-spacing:0.03em;}
  soldBadgeText: {
    ...Typography.caption,
    color: '#FFFFFF',
    letterSpacing: 0.33,
  },
});
