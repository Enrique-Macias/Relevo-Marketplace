/**
 * "Perfil público" — el perfil de solo lectura de OTRO usuario (grupo Cuenta).
 *
 * Se llega aquí desde el `.seller-card` de "Detalle de publicación". Es la
 * PRIMERA pantalla que muestra `rating_promedio`: Detalle ya lo trae en el
 * embed de `vendedor` pero nunca lo pinta, así que el criterio de "sin
 * reseñas" de abajo no viene de ningún lado — se decide aquí.
 */

import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, RefreshControl, Share, StyleSheet, Text, View } from 'react-native';

import { GhostButton } from '@/components/Buttons';
import { ConfirmarBloqueoModal } from '@/components/ConfirmarBloqueoModal';
import { ErrorState } from '@/components/ErrorState';
import { HojaOpciones } from '@/components/HojaOpciones';
import {
  IconBan,
  IconChevronLeft,
  IconCheck,
  IconFlag,
  IconKebab,
  IconShare,
  IconStar,
  IconUser,
  IconWhatsapp,
} from '@/components/icons';
import { PhotoViewer } from '@/components/PhotoViewer';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Colors, Radii, Typography } from '@/constants/theme';
import { Avatar } from '@/components/Avatar';
import {
  bloquearUsuario,
  desbloquearUsuario,
  fetchRelacion,
  nombreParaBloqueo,
  type RelacionBloqueo,
} from '@/lib/bloqueos';
import { antiguedadEnRelevo } from '@/lib/format';
import { fetchActivasVendedor, fetchVentasVendedor } from '@/lib/listings';
import { fetchTelefonoVendedor, urlWhatsapp } from '@/lib/perfil';
import { fetchPerfilPublico, fetchReviews, type PerfilPublico, type Review } from '@/lib/perfil-publico';
import { useExigirTerminos } from '@/lib/exigir-terminos';
import { useSession } from '@/lib/session';

export default function PerfilPublicoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useSession();
  const { mostrar } = useToast();
  // PL-016: contactar exige haber aceptado los Términos (`seller_whatsapp`).
  const exigirTerminos = useExigirTerminos();
  const miId = profile?.id ?? null;

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

  /**
   * UGC-1: qué perfil se pinta frente a esta persona (`src/lib/bloqueos.ts`).
   * Se carga JUNTO con el resto, en la misma tanda: si la consulta falla, falla
   * la carga entera, nunca se adivina un estado de bloqueo.
   */
  const [relacion, setRelacion] = useState<RelacionBloqueo>('normal');
  const [opcionesAbiertas, setOpcionesAbiertas] = useState(false);
  const [confirmarBloqueo, setConfirmarBloqueo] = useState(false);
  // "Perfil público (foto ampliada)" (DESIGN-1, fase 3).
  const [fotoAbierta, setFotoAbierta] = useState(false);
  const [mutando, setMutando] = useState<'bloquear' | 'desbloquear' | null>(null);

  /**
   * Mismo refactor que "Perfil" (`(tabs)/perfil.tsx`): las cuatro consultas
   * extraídas a una función llamable, con distinción frío/tibio para que un
   * pull-to-refresh fallido nunca tape un perfil bueno ya en pantalla. Esta
   * ruta remonta en cada navegación (a diferencia de "Perfil", que es un tab
   * que nunca se desmonta), así que no hace falta un `useFocusEffect` — solo
   * el gesto de pull llama a esta función en modo `silent`.
   */
  const cargandoRef = useRef(false);
  /**
   * UGC-1. Bloquear o desbloquear cambia lo que estas consultas devuelven, y
   * una carga que ya iba en camino cuando la mutación terminó traería el estado
   * de ANTES. Por eso: cada mutación exitosa sube `versionRef`, una carga que
   * termina con la versión cambiada NO aplica su resultado, y cualquier pedido
   * que llegue con una carga en vuelo queda pendiente en vez de perderse. La
   * recarga pendiente corre al terminar la que estaba en vuelo.
   */
  const versionRef = useRef(0);
  const pendienteRef = useRef(false);
  const cargarRef = useRef<((idPedido: string, opts?: { silent?: boolean }) => Promise<void>) | null>(
    null
  );

  const cargarPerfil = useCallback(
    async (idPedido: string, opts?: { silent?: boolean }) => {
      if (cargandoRef.current) {
        pendienteRef.current = true;
        return;
      }
      cargandoRef.current = true;
      const version = versionRef.current;

      try {
        const [p, a, v, r, rel] = await Promise.all([
          fetchPerfilPublico(idPedido),
          fetchActivasVendedor(idPedido),
          fetchVentasVendedor(idPedido),
          fetchReviews(idPedido),
          miId ? fetchRelacion(miId, idPedido) : Promise.resolve<RelacionBloqueo>('normal'),
        ]);
        if (versionRef.current !== version) {
          pendienteRef.current = true;
          return;
        }
        setPerfil(p);
        setActivas(a);
        setVendidas(v);
        setReviews(r);
        setRelacion(rel);
        setCargadoPara(idPedido);
        setErrorPara(null);
      } catch (e: any) {
        console.warn('[perfil-publico] no se pudo leer el perfil:', e?.message ?? e);
        if (opts?.silent) throw e;
        setErrorPara(idPedido);
      } finally {
        cargandoRef.current = false;
        if (pendienteRef.current) {
          pendienteRef.current = false;
          void cargarRef.current?.(idPedido, { silent: true }).catch((e: any) =>
            console.warn('[perfil-publico] falló la recarga pendiente:', e?.message ?? e)
          );
        }
      }
    },
    [miId]
  );

  useEffect(() => {
    cargarRef.current = cargarPerfil;
  }, [cargarPerfil]);

  /**
   * `montadoRef`, leído ANTES del `void cargarPerfil(id)`: no es solo
   * ceremonia — es lo que hace que `react-hooks/set-state-in-effect` NO
   * marque esta llamada. La regla puede rastrear que `cargarPerfil` termina en
   * un `setState` cuando se invoca directo desde un `useEffect` normal (a
   * diferencia de `useFocusEffect`, que no reconoce como efecto — por eso el
   * foco, más abajo, no se marca); un guard que lee un ref antes de la llamada
   * hace que el análisis estático no pueda probar que sea alcanzable y se
   * rinda, mismo blind spot que CLAUDE.md §9 ya documenta para `useListings`.
   * De regalo, es un guard REAL: evita reinvocar la carga si este efecto
   * llegara a correr después de que el componente se desmontó.
   */
  const montadoRef = useRef(true);
  useEffect(() => {
    return () => {
      montadoRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!id || !montadoRef.current) return;
    void cargarPerfil(id);
  }, [id, cargarPerfil]);

  /**
   * UGC-1. Al VOLVER a esta pantalla (no al montarla): "Reportar" puede haber
   * bloqueado a esta persona en su paso final, y esta ruta sigue montada debajo
   * de la hoja. Sin esto, el perfil seguiría pintando sus contadores y el botón
   * de WhatsApp. Mismo patrón —y mismo ref para saltarse el primer foco— que
   * Detalle.
   */
  const primerFoco = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primerFoco.current) {
        primerFoco.current = false;
        return;
      }
      if (id) {
        void cargarPerfil(id, { silent: true }).catch((e: any) =>
          console.warn('[perfil-publico] falló el refresh al enfocar:', e?.message ?? e)
        );
      }
    }, [id, cargarPerfil])
  );

  const [refrescando, setRefrescando] = useState(false);
  const onRefresh = useCallback(async () => {
    if (!id) return;
    setRefrescando(true);
    try {
      await cargarPerfil(id, { silent: true });
    } catch (e: any) {
      console.warn('[perfil-publico] falló el refresh:', e?.message ?? e);
      mostrar('No se pudo actualizar. Intenta de nuevo.', 'error');
    } finally {
      setRefrescando(false);
    }
  }, [id, cargarPerfil, mostrar]);

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
    if (!exigirTerminos()) return;

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

    void Linking.openURL(urlWhatsapp(telefono, 'Hola, te escribo desde RLVO'));
  }

  /**
   * UGC-1. Bloquear pasa SIEMPRE por "Confirmar bloquear"; el estado local
   * cambia solo DESPUÉS de que la base respondió bien, nunca antes (sin
   * optimismo: un fallo de red no puede dejar un "bloqueado" falso).
   */
  async function bloquear() {
    if (!perfil || !miId || mutando) return;
    setMutando('bloquear');
    try {
      await bloquearUsuario(miId, perfil.id);
      versionRef.current += 1;
      setRelacion('bloqueado_por_mi');
      setConfirmarBloqueo(false);
      mostrar(`Bloqueaste a ${nombreParaBloqueo(perfil.nombre)}`);
      void cargarPerfil(perfil.id, { silent: true }).catch((e: any) =>
        console.warn('[perfil-publico] falló la recarga tras bloquear:', e?.message ?? e)
      );
    } catch (e: any) {
      console.warn('[perfil-publico] no se pudo bloquear:', e?.code ?? '?', e?.message ?? e);
      setConfirmarBloqueo(false);
      mostrar('No pudimos bloquear a este usuario. Intenta de nuevo.', 'error');
    } finally {
      setMutando(null);
    }
  }

  /**
   * Desbloquear NO pide confirmación (es reversible, UGC-1A). Borra solo MI
   * fila; si la otra persona también me bloqueó, la relación queda en "no
   * disponible", y eso no se adivina: se vuelve a preguntar a la base.
   */
  async function desbloquear() {
    if (!perfil || !miId || mutando) return;
    setOpcionesAbiertas(false);
    setMutando('desbloquear');
    try {
      await desbloquearUsuario(miId, perfil.id);
      versionRef.current += 1;
      mostrar(`Desbloqueaste a ${nombreParaBloqueo(perfil.nombre)}`);
      try {
        setRelacion(await fetchRelacion(miId, perfil.id));
      } catch (e: any) {
        // El desbloqueo SÍ ocurrió; lo que falló es releer. La recarga de abajo
        // lo reintenta, y mientras tanto no se afirma ningún estado nuevo.
        console.warn('[perfil-publico] no se pudo releer la relación:', e?.message ?? e);
      }
      void cargarPerfil(perfil.id, { silent: true }).catch((e: any) =>
        console.warn('[perfil-publico] falló la recarga tras desbloquear:', e?.message ?? e)
      );
    } catch (e: any) {
      console.warn('[perfil-publico] no se pudo desbloquear:', e?.code ?? '?', e?.message ?? e);
      mostrar('No pudimos desbloquear a este usuario. Intenta de nuevo.', 'error');
    } finally {
      setMutando(null);
    }
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
        message: [perfil.nombre, perfil.universidadNombre, 'Perfil en RLVO']
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
            if (id) void cargarPerfil(id);
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
  // UGC-1: con un bloqueo en cualquier dirección no se pintan contadores (las
  // publicaciones que contarían ya no se devuelven, así que saldrían en 0) ni
  // el contacto. La identidad y las calificaciones se quedan (UGC-1A).
  const conBloqueo = !esPropio && relacion !== 'normal';

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={refrescando}
          onRefresh={onRefresh}
          tintColor={Colors.brick}
          colors={[Colors.brick]}
        />
      }
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
            {/* UGC-1: el "⋯" sustituye a la bandera de RF-14 y abre "Perfil
                público (opciones)": reportar y bloquear como DOS filas. Se
                esconde en el perfil propio con el mismo criterio que la
                bandera — hoy no se llega aquí con el id propio (el
                `.seller-card` que navega acá ya está gateado por `!isOwner`),
                pero la ruta sí es alcanzable por deep link. */}
            {!esPropio && (
              <Pressable
                onPress={() => setOpcionesAbiertas(true)}
                accessibilityRole="button"
                accessibilityLabel="Más opciones"
                hitSlop={12}
              >
                <IconKebab size={18} color={Colors.ink} />
              </Pressable>
            )}
          </View>
        </View>
      }
    >
      <View style={styles.block}>
        {/* Tocable SOLO con foto, igual que en Perfil. También en los estados
            "bloqueado"/"no disponible": el avatar ya está en pantalla, ampliarlo
            no revela nada nuevo. */}
        <Pressable
          onPress={() => setFotoAbierta(true)}
          disabled={!perfil.fotoUrl}
          accessibilityRole={perfil.fotoUrl ? 'button' : undefined}
          accessibilityLabel={perfil.fotoUrl ? 'Ver foto de perfil' : undefined}
        >
          <Avatar
            path={perfil.fotoUrl}
            nombre={perfil.nombre}
            style={styles.avatar}
            textStyle={styles.avatarText}
          />
        </Pressable>
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

      {conBloqueo ? (
        // Frames "Perfil público (bloqueado)" y "(no disponible)": `.notice`
        // SIN ícono (no falló nada, mismo criterio que "ya se vendió"). El
        // neutro nunca dice por qué: ni bloqueo, ni suspensión, ni baja.
        <View style={styles.bloqueoWrap}>
          <View style={styles.aviso}>
            <Text style={styles.avisoText}>
              {relacion === 'bloqueado_por_mi'
                ? `Bloqueaste a ${nombreParaBloqueo(perfil.nombre)}. No verás sus publicaciones y no podrán contactarse.`
                : 'Este perfil no está disponible.'}
            </Text>
          </View>
          {relacion === 'bloqueado_por_mi' ? (
            <GhostButton
              label={mutando === 'desbloquear' ? '…' : 'Desbloquear'}
              onPress={() => void desbloquear()}
              disabled={mutando !== null}
              style={styles.desbloquearBtn}
            />
          ) : null}
        </View>
      ) : (
        <>
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
              <Text style={styles.statNum}>{antiguedadEnRelevo(new Date(perfil.createdAt))}</Text>
              <Text style={styles.statLabel}>En RLVO</Text>
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
        </>
      )}

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
              <View style={[styles.reviewTop, r.autorEliminado && styles.reviewTopSolo]}>
                {r.autorEliminado ? (
                  // Frame "Perfil público": ícono de persona en vez de
                  // iniciales (ya no hay nombre) y el nombre en --ink-soft
                  // para que no se lea como un usuario real.
                  <View style={styles.reviewAvatar}>
                    <IconUser size={12} color={Colors.slate} />
                  </View>
                ) : (
                  <Avatar
                    path={r.fromFotoUrl}
                    nombre={r.fromNombre}
                    style={styles.reviewAvatar}
                    textStyle={styles.reviewAvatarText}
                  />
                )}
                <Text style={[styles.reviewName, r.autorEliminado && styles.reviewNameEliminado]}>
                  {r.autorEliminado ? 'Usuario eliminado' : (r.fromNombre ?? '')}
                </Text>
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

      <HojaOpciones
        visible={opcionesAbiertas}
        titulo={perfil.nombre ?? 'Usuario'}
        onCerrar={() => setOpcionesAbiertas(false)}
        opciones={[
          {
            key: 'reportar',
            icon: <IconFlag size={16} color={Colors.inkSoft} />,
            label: 'Reportar usuario',
            chevron: true,
            onPress: () => {
              setOpcionesAbiertas(false);
              router.push({
                pathname: '/reportar/[id]',
                // El `id` de ESTA ruta es la persona reportada, así que la
                // hoja no necesita un param aparte para su guard. `nombre`
                // viaja para el título y para la oferta de bloquear al final.
                params: { id, tipo: 'usuario', nombre: perfil.nombre ?? '' },
              });
            },
          },
          relacion === 'bloqueado_por_mi'
            ? {
                key: 'desbloquear',
                icon: <IconBan size={16} color={Colors.inkSoft} />,
                label: 'Desbloquear usuario',
                onPress: () => void desbloquear(),
              }
            : {
                key: 'bloquear',
                icon: <IconBan size={16} color={Colors.danger} />,
                label: 'Bloquear usuario',
                danger: true,
                onPress: () => {
                  setOpcionesAbiertas(false);
                  setConfirmarBloqueo(true);
                },
              },
        ]}
      />
      <ConfirmarBloqueoModal
        visible={confirmarBloqueo}
        nombre={perfil.nombre}
        confirming={mutando === 'bloquear'}
        onConfirm={() => void bloquear()}
        onCancel={() => setConfirmarBloqueo(false)}
      />
      {fotoAbierta && perfil.fotoUrl ? (
        <PhotoViewer
          avatar={{ path: perfil.fotoUrl, nombre: perfil.nombre }}
          onCerrar={() => setFotoAbierta(false)}
        />
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
  // UGC-1, frames "Perfil público (bloqueado)"/"(no disponible)": el mismo
  // contenedor `padding:0 20px 20px` que el botón de WhatsApp al que reemplaza.
  bloqueoWrap: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
  },
  // .notice sin .notice-icon — el mismo par de estilos que el aviso de
  // "ya se vendió" de Detalle (`vendidoNotice`/`vendidoText`).
  aviso: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: Radii.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  avisoText: {
    ...Typography.meta,
    color: Colors.inkSoft,
    lineHeight: 18.125, // 12.5 × 1.45
  },
  // .ghost-btn a ancho completo dentro del `display:flex` del frame.
  desbloquearBtn: {
    width: '100%',
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
  // Frame "Perfil público", reseña de cuenta eliminada: `margin-bottom:0`
  // inline, porque no lleva `.review-text` debajo (el comentario se borró).
  reviewTopSolo: {
    marginBottom: 0,
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
  reviewNameEliminado: {
    color: Colors.inkSoft,
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
