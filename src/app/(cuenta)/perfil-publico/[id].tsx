/**
 * "Perfil público" — el perfil de solo lectura de OTRO usuario (grupo Cuenta).
 *
 * Se llega aquí desde el `.seller-card` de "Detalle de publicación". Es la
 * PRIMERA pantalla que muestra `rating_promedio`: Detalle ya lo trae en el
 * embed de `vendedor` pero nunca lo pinta, así que el criterio de "sin
 * reseñas" de abajo no viene de ningún lado — se decide aquí.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { ErrorState } from '@/components/ErrorState';
import {
  IconChevronLeft,
  IconCheck,
  IconFlag,
  IconShare,
  IconStar,
  IconWhatsapp,
} from '@/components/icons';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Colors, Radii, Typography } from '@/constants/theme';
import { iniciales, mesesEnRelevo } from '@/lib/format';
import { fetchActivasVendedor, fetchVentasVendedor } from '@/lib/listings';
import { fetchTelefonoVendedor, urlWhatsapp } from '@/lib/perfil';
import { fetchPerfilPublico, fetchReviews, type PerfilPublico, type Review } from '@/lib/perfil-publico';
import { useSession } from '@/lib/session';

export default function PerfilPublicoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useSession();
  const { mostrar } = useToast();

  const [perfil, setPerfil] = useState<PerfilPublico | null>(null);
  const [activas, setActivas] = useState(0);
  const [vendidas, setVendidas] = useState(0);
  const [reviews, setReviews] = useState<{ items: Review[]; total: number }>({
    items: [],
    total: 0,
  });
  // Mismo idioma que Detalle: contra qué id está lo cargado (o el error), en
  // vez de un `setState` sincrónico para "volver a loading" dentro del efecto.
  const [cargadoPara, setCargadoPara] = useState<string | null>(null);
  const [errorPara, setErrorPara] = useState<string | null>(null);
  const [recargas, setRecargas] = useState(0);

  useEffect(() => {
    if (!id) return;

    let vigente = true;

    Promise.all([
      fetchPerfilPublico(id),
      fetchActivasVendedor(id),
      fetchVentasVendedor(id),
      fetchReviews(id),
    ])
      .then(([p, a, v, r]) => {
        if (!vigente) return;
        setPerfil(p);
        setActivas(a);
        setVendidas(v);
        setReviews(r);
        setCargadoPara(id);
      })
      .catch((e) => {
        if (!vigente) return;
        console.warn('[perfil-publico] no se pudo leer el perfil:', e?.message ?? e);
        setErrorPara(id);
      });

    return () => {
      vigente = false;
    };
  }, [id, recargas]);

  const estado: 'loading' | 'ready' | 'error' =
    errorPara === id ? 'error' : cargadoPara === id ? 'ready' : 'loading';

  /**
   * Mismo criterio que `contactarPorWhatsapp()` de Detalle (los mismos 3
   * motivos de `null`, el mismo orden de prioridad, el mismo tono neutro para
   * el vendedor suspendido), pero SIN `registrarContacto()`: esta pantalla no
   * tiene ninguna publicación en contexto y `listing_contacts.listing_id` es
   * NOT NULL — ya documentado en CLAUDE.md §8 como el caso que deja fuera a
   * este botón.
   */
  async function contactarPorWhatsapp() {
    if (!perfil) return;

    let telefono: string | null = null;
    try {
      telefono = await fetchTelefonoVendedor(perfil.id);
    } catch (e: any) {
      console.warn(`[perfil-publico] no se pudo leer el teléfono: ${e?.message ?? e}`);
      mostrar('No pudimos abrir WhatsApp. Revisa tu conexión.', 'error');
      return;
    }

    if (!telefono) {
      mostrar(
        profile?.estado === 'suspendido'
          ? 'Tu cuenta está suspendida y no puede contactar vendedores'
          : perfil.estado === 'suspendido'
            ? 'Esta cuenta no está disponible para contacto'
            : 'Este vendedor todavía no ha dejado un WhatsApp',
        'error'
      );
      return;
    }

    void Linking.openURL(urlWhatsapp(telefono, 'Hola, te escribo desde Relevo'));
  }

  /**
   * Mismo criterio que `compartir()` de Detalle: texto plano y NINGÚN link,
   * porque el proyecto sigue sin universal links/App Links ni página de
   * respaldo (CLAUDE.md §8, deuda consciente de "Compartir"). No hay un
   * constructor de texto compartido que reusar — Detalle también lo arma
   * inline —, así que este sigue el mismo patrón en vez de estrenar una
   * abstracción para un solo consumidor más.
   *
   * `.filter(Boolean).join('\n')` en vez de un template literal: `carrera` y
   * `universidadNombre` son nullable, y un template con `${perfil.nombre}`
   * sobre un perfil sin nombre imprimiría literalmente "null" en la hoja de
   * share nativa.
   */
  async function compartir() {
    if (!perfil) return;
    try {
      await Share.share({
        message: [perfil.nombre, perfil.universidadNombre, 'Perfil en Relevo']
          .filter(Boolean)
          .join('\n'),
      });
    } catch (e: any) {
      // Cancelar la hoja nativa NO entra aquí (resuelve con
      // `action: 'dismissedAction'`), así que esto es un fallo de verdad.
      console.warn('[perfil-publico] no se pudo compartir:', e?.message ?? e);
    }
  }

  if (!id || estado === 'error') {
    return (
      <Screen>
        <ErrorState
          onRetry={() => {
            setErrorPara(null);
            setRecargas((n) => n + 1);
          }}
          title="No pudimos abrir este perfil"
          sub="Revisa tu conexión e intenta de nuevo."
        />
      </Screen>
    );
  }

  // Sin skeleton propio: el frame no tiene uno — mismo criterio que Detalle.
  if (estado === 'loading' || !perfil) return null;

  const esPropio = profile?.id === id;

  return (
    <Screen
      header={
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
            <IconChevronLeft size={18} color={Colors.ink} />
          </Pressable>
          {/* Los dos íconos de la derecha van agrupados, como en `.detail-nav`:
              con `space-between`, tres hijos sueltos empujarían compartir al
              centro. */}
          <View style={styles.navActions}>
            {/* Texto plano, sin link — ver `compartir()` arriba. Se pinta
                siempre, también en el perfil propio, igual que en Detalle. */}
            <Pressable onPress={compartir} accessibilityRole="button" hitSlop={12}>
              <IconShare size={18} color={Colors.ink} />
            </Pressable>
            {/* RF-14, objetivo USUARIO. Guard de UX nada más: el candado es el
                `check` de tabla de 20260906000441 (`reported_user_id <>
                reporter_id`). Se esconde en el perfil propio con el mismo
                criterio con el que Detalle esconde su bandera cuando `isOwner`
                — hoy no se llega aquí con el id propio (el `.seller-card` que
                navega acá ya está gateado por `!isOwner`), pero la ruta sí es
                alcanzable por deep link. */}
            {!esPropio && (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: '/reportar/[id]',
                    // El `id` de ESTA ruta es la persona reportada, así que la
                    // hoja no necesita un param aparte para su guard. `nombre`
                    // viaja solo para el título, que ya está en pantalla aquí.
                    params: { id, tipo: 'usuario', nombre: perfil.nombre ?? '' },
                  })
                }
                accessibilityRole="button"
                hitSlop={12}
              >
                <IconFlag size={18} color={Colors.ink} />
              </Pressable>
            )}
          </View>
        </View>
      }
    >
      <View style={styles.block}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{iniciales(perfil.nombre)}</Text>
        </View>
        <View style={styles.nameRow}>
          <Text style={styles.name}>{perfil.nombre ?? ''}</Text>
          {/* Decorativo: toda fila de `users` pasó por OTP — mismo criterio
              que el `.verified-tick` de Detalle. */}
          <View style={styles.verifiedTick}>
            <IconCheck size={8} color={Colors.paper} />
          </View>
        </View>
        <Text style={styles.sub}>
          {perfil.carrera ? `${perfil.carrera} · ` : ''}
          {perfil.universidadNombre ?? ''}
        </Text>
        {/* Sin reseñas, la fila entera desaparece: "0.0" se leería como una
            mala calificación, no como "sin historial" (ver el comentario del
            archivo). */}
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
          <Text style={styles.statNum}>{mesesEnRelevo(new Date(perfil.createdAt))}</Text>
          <Text style={styles.statLabel}>En Relevo</Text>
        </View>
      </View>

      <View style={styles.whatsappWrap}>
        <Pressable
          style={styles.whatsappBtn}
          onPress={() => void contactarPorWhatsapp()}
          accessibilityRole="button"
        >
          <IconWhatsapp size={16} color={Colors.paper} />
          <Text style={styles.whatsappText}>Contactar por WhatsApp</Text>
        </Pressable>
      </View>

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>Calificaciones</Text>
      </View>

      {/* Sin reseñas, la sección se queda solo con su título — no se inventa
          un empty-state para un sub-bloque que no tiene frame propio. */}
      {reviews.items.length > 0 ? (
        <View style={styles.reviewList}>
          {reviews.items.map((r, i) => (
            <View
              key={r.id}
              style={[
                styles.reviewRow,
                i === reviews.items.length - 1 && styles.reviewRowLast,
              ]}
            >
              <View style={styles.reviewTop}>
                <View style={styles.reviewAvatar}>
                  <Text style={styles.reviewAvatarText}>{iniciales(r.fromNombre)}</Text>
                </View>
                <Text style={styles.reviewName}>{r.fromNombre ?? ''}</Text>
                <View style={styles.reviewStars}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <IconStar key={n} size={11} color={Colors.gold} filled={n <= r.estrellas} />
                  ))}
                </View>
              </View>
              {r.comentario ? <Text style={styles.reviewText}>{r.comentario}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  // .profile-top{display:flex; align-items:center; justify-content:space-between; padding:16px 20px 0;}
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  // .profile-top .nav-actions{gap:26px;} — override acotado sobre
  // `.nav-actions{gap:8px}`. Sin `.round-btn` (a diferencia de `.detail-nav`),
  // el espacio ink-a-ink de Detalle con gap:8 es en realidad 26px por el
  // padding de los círculos; aquí, con íconos bare del mismo tamaño, hace
  // falta ese mismo valor directo en el gap. NO tocar `.detail-nav`/`RoundIconButton`
  // con este número: es un ajuste local a este header.
  navActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 26,
  },
  // .profile-block{display:flex; flex-direction:column; align-items:center; text-align:center; padding:12px 20px 20px;}
  block: {
    alignItems: 'center',
    paddingHorizontal: 20,
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
  // .verified-tick — mismo círculo que en Detalle.
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
    paddingHorizontal: 20,
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
  // El contenedor `<div style="padding:0 20px 20px;">` del botón de WhatsApp.
  whatsappWrap: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  // .whatsapp-btn, con el override inline del frame: border-radius:14px; padding:13px 0;
  whatsappBtn: {
    borderRadius: Radii.lg,
    backgroundColor: Colors.brick,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
  },
  whatsappText: {
    ...Typography.buttonWhatsapp,
    color: Colors.paper,
  },
  // .section-head{padding:22px 20px 12px;} con el override inline de este frame: padding-top:2px;
  sectionHead: {
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 12,
  },
  sectionTitle: {
    ...Typography.sectionTitle,
    color: Colors.ink,
  },
  // .menu-list{padding:2px 20px 100px;} con el override inline de este frame: padding-top:0;
  reviewList: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  // .review-row{padding:13px 0; border-bottom:1px solid line;} / :last-child sin borde.
  reviewRow: {
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  reviewRowLast: {
    borderBottomWidth: 0,
  },
  // .review-top{display:flex; align-items:center; gap:8px; margin-bottom:5px;}
  reviewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 5,
  },
  // .review-avatar{width:26px; height:26px; border-radius:50%; background:slate-tint;}
  reviewAvatar: {
    width: 26,
    height: 26,
    borderRadius: Radii.full,
    backgroundColor: Colors.slateTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewAvatarText: {
    ...Typography.reviewAvatarInitials,
    color: Colors.slate,
  },
  reviewName: {
    ...Typography.reviewName,
    color: Colors.ink,
  },
  // .review-stars{display:flex; gap:2px; margin-left:auto;}
  reviewStars: {
    flexDirection: 'row',
    gap: 2,
    marginLeft: 'auto',
  },
  reviewText: {
    ...Typography.reviewText,
    color: Colors.inkSoft,
  },
});
