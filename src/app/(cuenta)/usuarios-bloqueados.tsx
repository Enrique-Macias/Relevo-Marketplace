/**
 * Frames "Usuarios bloqueados" y "Usuarios bloqueados vacío" (UGC-1, grupo
 * Cuenta). Se abre desde Configuración → Privacidad.
 *
 * Solo MIS bloqueos: la RLS de `user_bloqueos` no devuelve nunca una fila en la
 * que yo solo aparezco como bloqueado, así que esta lista no puede revelar
 * quién me bloqueó. Cada fila: avatar, nombre y "Desbloquear" (nada de fecha ni
 * motivo, UGC-1B).
 *
 * Desbloquear NO pide confirmación (es reversible, UGC-1A): borra solo mi fila,
 * la saca de la lista DESPUÉS de que la base respondió bien y avisa con un
 * toast. Mientras una fila se desbloquea, su acción queda apagada.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { IconBan } from '@/components/icons';
import { PageHeader } from '@/components/PageHeader';
import { Screen } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { Colors, Radii, ScreenPadding, Typography } from '@/constants/theme';
import {
  desbloquearUsuario,
  fetchUsuariosBloqueados,
  nombreParaBloqueo,
  type UsuarioBloqueado,
} from '@/lib/bloqueos';
import { useSession } from '@/lib/session';

export default function UsuariosBloqueadosScreen() {
  const { session } = useSession();
  const { mostrar } = useToast();
  const userId = session?.user.id ?? null;

  const [items, setItems] = useState<UsuarioBloqueado[]>([]);
  const [estado, setEstado] = useState<'loading' | 'ready' | 'error'>('loading');
  // Ids con un desbloqueo en curso: su "Desbloquear" queda apagado (doble tap).
  const [enCurso, setEnCurso] = useState<ReadonlySet<string>>(new Set());

  const cargar = useCallback(async (uid: string) => {
    try {
      setItems(await fetchUsuariosBloqueados(uid));
      setEstado('ready');
    } catch (e: any) {
      console.warn('[usuarios-bloqueados] no se pudo leer la lista:', e?.message ?? e);
      setEstado('error');
    }
  }, []);

  // `montadoRef` leído ANTES de la llamada: el mismo recurso de Detalle y
  // Perfil público para que `react-hooks/set-state-in-effect` no marque la
  // carga inicial, y un guard real contra cargar tras desmontar.
  const montadoRef = useRef(true);
  useEffect(() => {
    return () => {
      montadoRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!userId || !montadoRef.current) return;
    void cargar(userId);
  }, [userId, cargar]);

  async function desbloquear(u: UsuarioBloqueado) {
    if (!userId || enCurso.has(u.id)) return;
    setEnCurso((prev) => new Set(prev).add(u.id));
    try {
      await desbloquearUsuario(userId, u.id);
      setItems((prev) => prev.filter((x) => x.id !== u.id));
      mostrar(`Desbloqueaste a ${nombreParaBloqueo(u.nombre)}`);
    } catch (e: any) {
      console.warn('[usuarios-bloqueados] no se pudo desbloquear:', e?.code ?? '?', e?.message ?? e);
      mostrar('No pudimos desbloquear a este usuario. Intenta de nuevo.', 'error');
    } finally {
      setEnCurso((prev) => {
        const sig = new Set(prev);
        sig.delete(u.id);
        return sig;
      });
    }
  }

  const header = <PageHeader title="Usuarios bloqueados" />;

  if (estado === 'error') {
    return (
      <Screen header={header}>
        <ErrorState
          title="No pudimos cargar tus usuarios bloqueados"
          sub="Revisa tu conexión e intenta de nuevo."
          onRetry={() => {
            if (!userId) return;
            setEstado('loading');
            void cargar(userId);
          }}
        />
      </Screen>
    );
  }

  // Sin skeleton propio: el frame no tiene uno y no se inventa. El header sí se
  // pinta, para que "atrás" funcione mientras carga.
  if (estado === 'loading') {
    return (
      <Screen header={header}>
        <View />
      </Screen>
    );
  }

  if (items.length === 0) {
    return (
      <Screen header={header}>
        {/* Sin `.empty-actions`, como "Notificaciones vacío": bloquear se hace
            desde un perfil o una publicación, no desde aquí. */}
        <EmptyState
          icon={<IconBan size={30} color={Colors.inkSoft} />}
          title="No has bloqueado a nadie"
          sub="Si bloqueas a alguien desde su perfil o desde una publicación, aparecerá aquí y podrás desbloquearlo."
        />
      </Screen>
    );
  }

  return (
    <Screen header={header}>
      <View style={styles.body}>
        <Text style={styles.sub}>No ven tus publicaciones ni tú las suyas, y no pueden contactarse.</Text>
        {items.map((u, i) => {
          const ocupado = enCurso.has(u.id);
          return (
            <View key={u.id} style={[styles.row, i === items.length - 1 && styles.rowLast]}>
              <Avatar path={u.fotoUrl} nombre={u.nombre} style={styles.avatar} textStyle={styles.avatarText} />
              <View style={styles.info}>
                <Text style={styles.nombre} numberOfLines={1}>
                  {nombreParaBloqueo(u.nombre)}
                </Text>
              </View>
              <Pressable
                onPress={() => void desbloquear(u)}
                disabled={ocupado}
                accessibilityRole="button"
                accessibilityState={{ disabled: ocupado }}
                hitSlop={8}
              >
                <Text style={[styles.accion, ocupado && styles.accionOcupada]}>
                  {ocupado ? '…' : 'Desbloquear'}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // .form-body{padding:18px 20px …} — el mismo de "¿A quién le vendiste?".
  body: {
    paddingTop: 18,
    paddingHorizontal: ScreenPadding,
    paddingBottom: 24,
  },
  // .auth-sub con text-align:left, max-width:none, margin-bottom:18px.
  sub: {
    ...Typography.auth,
    color: Colors.inkSoft,
    marginBottom: 18,
  },
  // .buyer-row — la misma geometría que `BuyerRow`, sin la segunda línea ni el
  // radio (aquí la acción es texto).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  // .buyer-avatar{width:38px; height:38px; border-radius:50%; background:slate-tint;}
  avatar: {
    width: 38,
    height: 38,
    borderRadius: Radii.full,
    backgroundColor: Colors.slateTint,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    ...Typography.avatarInitials,
    color: Colors.slate,
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  // .buyer-name{font-size:13.5px; font-weight:600;}
  nombre: {
    ...Typography.emphasis,
    color: Colors.ink,
  },
  // Texto en --brick 13/600: el mismo recurso que "Activar" en Configuración.
  // 13px no coincide con ningún rol de Typography, igual que allá.
  accion: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.brick,
  },
  accionOcupada: {
    color: Colors.inkSoft,
  },
});
