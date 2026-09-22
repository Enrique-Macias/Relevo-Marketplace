/**
 * "Perfil" (perfil propio) — última pantalla del grupo Cuenta.
 *
 * Reusa, para el propio usuario, la misma capa de datos que ya resolvió el
 * bloque de avatar/nombre/rating para OTRO usuario en "Perfil público"
 * (`fetchPerfilPublico`/`fetchReviews` de `src/lib/perfil-publico.ts`, sin
 * modificar): la RLS de `users`/`ratings` (`using(true)`) ya permite leerlos
 * con el propio id, así que no hace falta una segunda implementación.
 *
 * A diferencia de "Perfil público" (una ruta de Stack que remonta cada vez),
 * este es un TAB que no se desmonta — por eso la carga de datos son DOS
 * efectos: el `useEffect` que de verdad pide los datos (dispara también en el
 * primer montaje) y un `useFocusEffect` aparte cuyo único trabajo es refrescar
 * al volver de otra pantalla (Editar publicación, Mis publicaciones, Marcar
 * como vendida, Favoritos pueden cambiar estos números mientras el tab sigue
 * montado), saltando su propia primera invocación para no duplicar esa carga
 * inicial.
 */

import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { ConfirmModal } from '@/components/ConfirmModal';
import { ErrorState } from '@/components/ErrorState';
import {
  IconCheck,
  IconCheckCircle,
  IconChevronRight,
  IconHelpCircle,
  IconLogout,
  IconPencil,
  IconSettings,
  IconStar,
  IconTag,
} from '@/components/icons';
import { CategoryIcon } from '@/components/icons/categories';
import { ListingPhoto } from '@/components/ListingPhoto';
import { Screen } from '@/components/Screen';
import { SectionHead } from '@/components/SectionHead';
import { SkeletonPerfil } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';
import { useExplorarState } from '@/lib/explorar-state';
import { Avatar } from '@/components/Avatar';
import { formatPrecio } from '@/lib/format';
import { fetchActivasVendedor, fetchMisListings, fetchVentasVendedor, type MiListing } from '@/lib/listings';
import { fetchPerfilPublico, fetchReviews, type PerfilPublico, type Review } from '@/lib/perfil-publico';
import { fetchFavoritosCount } from '@/lib/favoritos';
import { useSession } from '@/lib/session';

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

export default function PerfilScreen() {
  const { session, profile, refreshProfile, signOut } = useSession();
  const { mostrar } = useToast();
  const userId = session?.user.id ?? null;

  const [perfil, setPerfil] = useState<PerfilPublico | null>(null);
  const [reviews, setReviews] = useState<{ items: Review[]; total: number }>({
    items: [],
    total: 0,
  });
  const [activas, setActivas] = useState(0);
  const [vendidas, setVendidas] = useState(0);
  const [favoritosCount, setFavoritosCount] = useState(0);
  const [misListings, setMisListings] = useState<MiListing[]>([]);

  // Mismo idioma que "Perfil público": contra qué id está lo cargado (o el
  // error), en vez de una bandera booleana de loading.
  const [cargadoPara, setCargadoPara] = useState<string | null>(null);
  const [errorPara, setErrorPara] = useState<string | null>(null);

  /**
   * Las seis consultas, extraídas a una función llamable en vez de vivir
   * dentro de un efecto atado a un contador `recargas` — necesario para poder
   * distinguir la carga FRÍA (nada en pantalla todavía: un fallo pinta
   * `ErrorState`, como siempre) de una recarga TIBIA (foco o pull-to-refresh:
   * un fallo NUNCA debe tapar un perfil bueno ya visible, solo avisar). Antes
   * las dos compartían el mismo camino de error —`setErrorPara`—, así que
   * CUALQUIER falla del refresco por foco reemplazaba un perfil bueno con
   * `ErrorState`; con `opts.silent` eso queda cerrado.
   *
   * Guard de una sola vuelo (`cargandoRef`) en vez de por `recargas`: es lo
   * que permite que el foco y el gesto de pull-to-refresh llamen a la MISMA
   * función sin arriesgarse a dispararla dos veces a la vez — quien llegue
   * segundo no-opea.
   */
  const cargandoRef = useRef(false);

  const cargarPerfil = useCallback(async (id: string, opts?: { silent?: boolean }) => {
    if (cargandoRef.current) return;
    cargandoRef.current = true;

    try {
      const [p, r, a, v, f, mis] = await Promise.all([
        fetchPerfilPublico(id),
        fetchReviews(id),
        fetchActivasVendedor(id),
        fetchVentasVendedor(id),
        fetchFavoritosCount(id),
        fetchMisListings({ userId: id, limit: 2 }),
      ]);
      setPerfil(p);
      setReviews(r);
      setActivas(a);
      setVendidas(v);
      setFavoritosCount(f);
      setMisListings(mis.items);
      setCargadoPara(id);
      // Un refresco exitoso saca a la pantalla de un error previo — mismo
      // criterio que `useListings.refrescar()`.
      setErrorPara(null);
    } catch (e: any) {
      console.warn('[perfil] no se pudo cargar el perfil:', e?.message ?? e);
      // Frío (nada que mostrar todavía): se pinta ErrorState, como antes.
      // Tibio (ya hay contenido bueno en pantalla): NO se toca `errorPara` —
      // el llamador decide si avisa (ver `onRefresh` y el foco, abajo).
      if (opts?.silent) throw e;
      setErrorPara(id);
    } finally {
      cargandoRef.current = false;
    }
  }, []);

  /**
   * `montadoRef`, leído ANTES de la llamada: es lo que evita que
   * `react-hooks/set-state-in-effect` marque este `useEffect` — mismo blind
   * spot ya documentado en CLAUDE.md §9 para `useListings`, y de regalo un
   * guard real contra reinvocar la carga si el efecto llegara a correr
   * después de desmontar.
   */
  const montadoRef = useRef(true);
  useEffect(() => {
    return () => {
      montadoRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!userId || !montadoRef.current) return;
    void cargarPerfil(userId);
  }, [userId, cargarPerfil]);

  /**
   * Refresco silencioso al volver al tab — no al montar, eso ya lo cubre el
   * efecto de arriba. Mismo patrón que `mis-publicaciones.tsx`/`favoritos.tsx`:
   * llama a la MISMA función que usa el gesto de pull, así que su guard de una
   * sola vuelo evita que las dos disparen carga a la vez.
   */
  const primerFoco = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primerFoco.current) {
        primerFoco.current = false;
        return;
      }
      if (!userId) return;
      void cargarPerfil(userId, { silent: true }).catch((e: any) =>
        console.warn('[perfil] falló el refresh al enfocar:', e?.message ?? e)
      );
    }, [userId, cargarPerfil])
  );

  const [refrescando, setRefrescando] = useState(false);
  const onRefresh = useCallback(async () => {
    if (!userId) return;
    setRefrescando(true);
    try {
      await cargarPerfil(userId, { silent: true });
    } catch (e: any) {
      console.warn('[perfil] falló el refresh:', e?.message ?? e);
      mostrar('No se pudo actualizar. Intenta de nuevo.', 'error');
    } finally {
      setRefrescando(false);
    }
  }, [userId, cargarPerfil, mostrar]);

  /**
   * AVISO DEL AVATAR BORRADO POR MODERACIÓN (RF-18).
   *
   * `moderarAvatar()` (`supabase/functions/moderar-contenido/index.ts`) borra el
   * objeto y pone `foto_url` en `null` cuando Vision da `VERY_LIKELY`. Sin esto,
   * el usuario ve volver sus iniciales sin ninguna explicación, y en momentos
   * distintos según la pantalla: aquí al reenfocar el tab, y en el header del
   * Feed NUNCA —pinta `profile.foto_url` de la sesión, que solo se mueve con
   * `refreshProfile()`—.
   *
   * LA SEÑAL ES INEQUÍVOCA, y por eso alcanza con compararla: el cliente jamás
   * escribe `null` en esa columna. `guardarFotoPerfil()` (`src/lib/perfil.ts`)
   * siempre escribe un path, y `guardarPerfil()` ni siquiera incluye la columna.
   * El ÚNICO productor de `null` es la Edge Function.
   *
   * VA EN SU PROPIO EFECTO y no dentro del `.then` de la carga: ahí tendría que
   * leer `profile`, que `refreshProfile()` cambia, y eso lo volvería una
   * dependencia del efecto que hace las SEIS consultas de esta pantalla —o sea
   * una recarga completa por cada aviso. Aquí el ciclo se cierra solo: tras el
   * refresh, `profile.foto_url` ya es `null` y el guard de abajo corta.
   *
   * `avisadoParaRef` GUARDA EL PATH AVISADO, NO UN BOOLEANO, y esa diferencia
   * es un bug real encontrado en pruebas manuales (2026-09-21), no una
   * precaución teórica. La primera versión usaba un booleano como cinturón para
   * la ventana en la que `refreshProfile()` todavía no resolvió — y **esta
   * pantalla es un TAB que no se desmonta** (ver el docblock de arriba), así que
   * ese booleano no era un cinturón sino un PESTILLO PERMANENTE: tras el primer
   * aviso quedaba en `true` para el resto de la sesión y **el segundo avatar
   * moderado ya no avisaba nunca**. Con el path, cada moderación es un evento
   * distinto (cada subida estrena uuid, `rutaAvatar()`) y solo se silencia la
   * repetición del MISMO. Es exactamente el criterio que `Avatar.tsx` ya usa
   * para `pathFallido` — "se guarda el PATH que falló, no un booleano"— y que
   * aquí se había perdido.
   *
   * **La sesión NO se estanca, y conviene saberlo porque es la hipótesis
   * natural al ver este síntoma:** `editar-perfil/index.tsx` le pasa
   * `onGuardada: refreshProfile` a `useFotoPerfil()`, que lo espera tras cada
   * subida exitosa (`src/lib/perfil.ts`), así que `profile.foto_url` sí vale el
   * path nuevo cuando llega el segundo veredicto. El pestillo era lo único roto.
   *
   * Y el síntoma que acompaña —"el header del Feed no muestra la foto nueva ni
   * un instante"— tampoco es un segundo bug: con `foto_url` apuntando a un
   * objeto ya borrado, `expo-image` falla y `Avatar` cae a iniciales por su
   * `onError`. Se ve idéntico a que la sesión tuviera `null`.
   *
   * LÍMITE CONOCIDO, documentado como deuda en `.claude/rules/cuenta-perfil.md`:
   * si el usuario no abre Perfil, o no ve el toast, no queda rastro. Un aviso
   * persistente exige frame (CLAUDE.md §0 regla 4) y dónde guardar el "ya se lo
   * dijimos", o sea esquema.
   */
  const avisadoParaRef = useRef<string | null>(null);
  useEffect(() => {
    // Sin foto conocida no hubo transición que avisar (cuenta que nunca puso
    // una, o aviso ya dado y la sesión ya refrescada).
    const conocida = profile?.foto_url;
    if (!conocida) return;
    if (!perfil || perfil.fotoUrl !== null) return;
    if (avisadoParaRef.current === conocida) return;

    avisadoParaRef.current = conocida;
    mostrar('Quitamos tu foto de perfil porque no pasó la revisión de contenido', 'error');
    // Para que el header del Feed deje de pintar la foto ya borrada.
    void refreshProfile();
  }, [perfil, profile, mostrar, refreshProfile]);

  const estado: 'loading' | 'ready' | 'error' =
    errorPara === userId ? 'error' : cargadoPara === userId ? 'ready' : 'loading';

  const [confirmando, setConfirmando] = useState(false);
  const [cerrandoSesion, setCerrandoSesion] = useState(false);

  const cerrarSesion = async () => {
    setCerrandoSesion(true);
    await signOut();
    // No hay que navegar a mano ni cerrar el modal aquí: cambiar la sesión
    // dispara el guard de (tabs)/_layout.tsx, que ya redirige a /splash — el
    // desmontaje de esta pantalla se encarga de todo lo demás.
  };

  return (
    <>
      <Screen
        refreshControl={
          <RefreshControl
            refreshing={refrescando}
            onRefresh={onRefresh}
            tintColor={Colors.brick}
            colors={[Colors.brick]}
          />
        }
      >
        <StatusBar style="dark" />

        <View style={styles.top}>
          <Text style={styles.wordmark}>Perfil</Text>
          {/* Ajustes: sin pantalla en el inventario de 54 ni en product-spec.md. */}
          <Pressable onPress={() => {}} accessibilityRole="button" hitSlop={12}>
            <IconSettings size={20} color={Colors.ink} />
          </Pressable>
        </View>

        {estado === 'error' ? (
          <ErrorState
            onRetry={() => {
              setErrorPara(null);
              if (userId) void cargarPerfil(userId);
            }}
            title="No pudimos cargar tu perfil"
            sub="Revisa tu conexión e intenta de nuevo."
          />
        ) : estado === 'loading' || !perfil ? (
          <SkeletonPerfil />
        ) : (
          <>
            <View style={styles.block}>
              <Avatar
                path={perfil.fotoUrl}
                nombre={perfil.nombre}
                style={styles.avatar}
                textStyle={styles.avatarText}
              />
              <View style={styles.nameRow}>
                <Text style={styles.name}>{perfil.nombre ?? ''}</Text>
                {/* Decorativo: toda fila de `users` pasó por OTP — mismo
                    criterio que "Perfil público" y Detalle. */}
                <View style={styles.verifiedTick}>
                  <IconCheck size={8} color={Colors.paper} />
                </View>
              </View>
              <Text style={styles.sub}>
                {perfil.carrera ? `${perfil.carrera} · ` : ''}
                {perfil.universidadNombre ?? ''}
              </Text>
              {/* Sin reseñas, la fila entera desaparece: "0.0" se leería como
                  una mala calificación, no como "sin historial" — mismo
                  criterio que "Perfil público". */}
              {reviews.total > 0 ? (
                <View style={styles.rating}>
                  <IconStar size={13} color={Colors.gold} filled />
                  <Text style={styles.ratingText}>
                    {perfil.ratingPromedio.toFixed(1)} · {reviews.total}{' '}
                    {reviews.total === 1 ? 'calificación' : 'calificaciones'}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.statRow}>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{activas}</Text>
                <Text style={styles.statLabel}>Activas</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{vendidas}</Text>
                <Text style={styles.statLabel}>Vendidos</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{favoritosCount}</Text>
                <Text style={styles.statLabel}>Favoritos</Text>
              </View>
            </View>

            {/* Sin publicaciones, la sección entera desaparece — mismo
                criterio que el bloque de rating: no hay frame de "Perfil" con
                0 publicaciones en el inventario de 54. */}
            {misListings.length > 0 ? (
              <>
                <SectionHead
                  title="Mis publicaciones"
                  linkLabel="Ver todas"
                  onPressLink={() => router.push('/mis-publicaciones')}
                />
                <View style={styles.grid}>
                  <MiniListingCard item={misListings[0]} />
                  {misListings[1] ? (
                    <MiniListingCard item={misListings[1]} />
                  ) : (
                    // Conteo impar: la segunda celda queda vacía, no se
                    // estira la primera — mismo criterio que Categoría/Búsqueda.
                    <View style={styles.gridSpacer} />
                  )}
                </View>
              </>
            ) : null}

            <View style={styles.menuList}>
              <MenuRow
                icon={<IconTag size={16} color={Colors.inkSoft} />}
                label="Mis publicaciones"
                onPress={() => router.push('/mis-publicaciones')}
              />
              <MenuRow
                icon={<IconPencil size={16} color={Colors.inkSoft} />}
                label="Editar perfil"
                onPress={() => router.push('/editar-perfil')}
              />
              {/* Verificación: sin pantalla en el inventario de 54 ni en
                  product-spec.md — mismo criterio que Compartir/Reportar/kebab
                  en Detalle. */}
              <MenuRow
                icon={<IconCheckCircle size={16} color={Colors.inkSoft} />}
                label="Verificación"
                onPress={() => {}}
              />
              {/* Ayuda y soporte: idem. */}
              <MenuRow
                icon={<IconHelpCircle size={16} color={Colors.inkSoft} />}
                label="Ayuda y soporte"
                onPress={() => {}}
              />
              <MenuRow
                icon={<IconLogout size={16} color={Colors.inkSoft} />}
                label="Cerrar sesión"
                onPress={() => setConfirmando(true)}
                chevron={false}
                last
              />
            </View>
          </>
        )}

        {/*
          El FAB de "Publicar" NO va aquí aunque el diseño lo dibuje sobre esta
          pantalla: dentro del contenido de una pantalla de `NativeTabs` se pinta
          pero no recibe el toque (CLAUDE.md §9). Vive en `(tabs)/_layout.tsx`
          como hermano del navegador, y ese layout decide mostrarlo solo en
          Perfil.
        */}
      </Screen>

      <ConfirmModal
        visible={confirmando}
        icon={<IconLogout size={22} color={Colors.brick} />}
        title="¿Cerrar sesión?"
        body="Tendrás que verificar tu correo de nuevo la próxima vez que quieras entrar a Relevo."
        confirmLabel="Cerrar sesión"
        onConfirm={cerrarSesion}
        onCancel={() => setConfirmando(false)}
        confirming={cerrandoSesion}
      />
    </>
  );
}

/** `.menu-row` — ícono + label + chevron opcional. */
function MenuRow({
  icon,
  label,
  onPress,
  chevron = true,
  last = false,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  chevron?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      style={[styles.menuRow, last && styles.menuRowLast]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={styles.menuIcon}>{icon}</View>
      <Text style={styles.menuLabel}>{label}</Text>
      {chevron ? <IconChevronRight size={14} color={Colors.inkSoft} /> : null}
    </Pressable>
  );
}

/**
 * `.card` de la mini-grid "Mis publicaciones" del frame Perfil — PRIMERA vez
 * que el diseño pinta `.sold-badge` sobre una tarjeta de grid (hasta ahora ese
 * overlay solo vivía en la fila plana de `mis-publicaciones.tsx`). No se reusa
 * `ProductCard`: esta tarjeta no lleva corazón, badge de condición ni meta de
 * campus/fecha — su `.info` es solo precio+título.
 */
function MiniListingCard({ item }: { item: MiListing }) {
  const { getCategoria } = useExplorarState();
  const categoria = getCategoria(item.categoriaId);
  const tint = categoria?.tint ?? 'brick';

  return (
    <Pressable style={styles.card} onPress={() => router.push(`/detalle/${item.id}`)}>
      <View style={[styles.thumb, { backgroundColor: TINT_BG[tint] }]}>
        <ListingPhoto
          path={item.fotoPath}
          fallback={<CategoryIcon categoriaId={categoria?.slug ?? ''} size={30} color={TINT_FG[tint]} />}
          style={styles.foto}
          accessibilityLabel={item.titulo}
        />
        {item.estado === 'vendida' ? (
          <View style={styles.soldBadge}>
            <Text style={styles.soldBadgeText}>Vendido</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.info}>
        <Text style={styles.price}>{formatPrecio(item.precio)}</Text>
        <Text style={styles.title} numberOfLines={1}>
          {item.titulo}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // .profile-top{display:flex; align-items:center; justify-content:space-between; padding:16px 20px 0;}
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: ScreenPadding,
    paddingTop: 16,
  },
  // .wordmark con el override inline `font-size:20px` del frame "Perfil".
  wordmark: {
    ...Typography.profileWordmark,
    color: Colors.ink,
  },
  // .profile-block{display:flex; flex-direction:column; align-items:center; text-align:center; padding:12px 20px 20px;}
  block: {
    alignItems: 'center',
    paddingHorizontal: ScreenPadding,
    paddingTop: 12,
    paddingBottom: 20,
  },
  // .profile-avatar{width:76px; height:76px; border-radius:50%; background:forest-tint; margin-bottom:12px;}
  avatar: {
    width: 76,
    height: 76,
    borderRadius: Radii.full,
    backgroundColor: Colors.forestTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: {
    ...Typography.profileAvatarInitials,
    color: Colors.forest,
  },
  // .profile-name-row{display:flex; align-items:center; gap:6px;}
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    ...Typography.profileName,
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
  // .profile-sub{font-size:12.5px; margin-top:4px;}
  sub: {
    ...Typography.meta,
    color: Colors.inkSoft,
    marginTop: 4,
  },
  // .profile-rating{display:flex; align-items:center; gap:5px; margin-top:9px;}
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 9,
  },
  ratingText: {
    ...Typography.meta,
    color: Colors.inkSoft,
  },
  // .stat-row{display:grid; grid-template-columns:repeat(3,1fr); gap:10px; padding:0 20px 22px;}
  statRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 22,
  },
  // .stat-card{background:card; border:1px solid line; border-radius:14px; padding:13px 6px; text-align:center;}
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
  // .grid{display:grid; grid-template-columns:repeat(2,1fr); gap:12px; padding:0 20px 20px;}
  // — el `padding-bottom:20px` inline del frame Perfil, no los 90 del Feed:
  // aquí sigue el `.menu-list`, no el fondo de la pantalla.
  grid: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 20,
  },
  gridSpacer: {
    flex: 1,
  },
  // Mismo `.card` que ProductCard, sin corazón/badge/meta.
  card: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: Radii.xl,
    borderWidth: 1,
    borderColor: Colors.line,
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    aspectRatio: 4 / 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foto: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  // .sold-badge{position:absolute; inset:0; background:rgba(34,31,28,0.55);}
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
  soldBadgeText: {
    ...Typography.caption,
    color: '#FFFFFF',
    letterSpacing: 0.33,
  },
  info: {
    paddingTop: 11,
    paddingHorizontal: 12,
    paddingBottom: 13,
  },
  price: {
    ...Typography.price,
    color: Colors.ink,
    marginBottom: 5,
  },
  title: {
    ...Typography.bodyStrong,
    color: Colors.ink,
  },
  // .menu-list{padding:2px 20px 100px;}
  menuList: {
    paddingTop: 2,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 100,
  },
  // .menu-row{display:flex; align-items:center; gap:12px; padding:13px 0; border-bottom:1px solid var(--line);}
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  // .menu-row:last-child{border-bottom:none;}
  menuRowLast: {
    borderBottomWidth: 0,
  },
  // .menu-icon{width:34px; height:34px; border-radius:10px; background:var(--paper);}
  menuIcon: {
    width: 34,
    height: 34,
    // El mismo 10px que `.status-row-icon` — el radio que CLAUDE.md §2 anota
    // como fuera de `Radii`.
    borderRadius: 10,
    backgroundColor: Colors.paper,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // .menu-label{flex:1; font-size:13.5px; font-weight:500;}
  menuLabel: {
    ...Typography.rowLabel,
    color: Colors.ink,
    flex: 1,
  },
});
