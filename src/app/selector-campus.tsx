/**
 * Selector de campus: hoja del Feed para cambiar QUÉ parte del catálogo se mira
 * (fase 2B). Tres niveles de alcance: todas las universidades, una universidad
 * entera ("Todos los campus de …") o un campus, de CUALQUIER universidad.
 *
 * Elegir aquí no cambia el perfil ni dónde se publica, y dura la sesión
 * (`explorar-state.tsx`, `Alcance`). Fijar el campus del perfil es otro
 * componente (`CampusBottomSheet`), acotado a la universidad propia.
 *
 * "Detectar campus más cercano" (fase 2C) vive en este mismo archivo, no en un
 * componente aparte: necesita `catalogo` (ya en memoria, con coordenadas) y
 * `elegir()`, y separarlo solo movería ese acoplamiento a props.
 */

import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { BlinkingDots } from '@/components/BlinkingDots';
import { GhostButton } from '@/components/Buttons';
import { IconLocationCrosshair } from '@/components/icons';
import { ListRow, SearchField } from '@/components/ListRow';
import { Notice } from '@/components/Notice';
import { SheetScreen } from '@/components/SheetScreen';
import { useToast } from '@/components/Toast';
import { Colors, Typography } from '@/constants/theme';
import { useExplorarState, type Alcance, type UniversidadCatalogo } from '@/lib/explorar-state';
import { obtenerUbicacionAproximada, ubicacionDisponible } from '@/lib/geolocalizacion';
import { useSession } from '@/lib/session';
import { campusMasCercano } from '@/lib/ubicacion';

/** Minúsculas y sin acentos: "leon" encuentra "Nuevo León". */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

type Grupo = {
  universidad: UniversidadCatalogo;
  /** Con búsqueda: solo si machea la UNIVERSIDAD (entonces sale el grupo entero). */
  conTodos: boolean;
  campus: UniversidadCatalogo['campus'];
};

/**
 * Qué se pinta, según el texto del buscador:
 *  - sin texto: todos los grupos, cada uno con su "Todos los campus de …";
 *  - si machea la universidad: su grupo entero, con "Todos";
 *  - si solo machean campus o ciudades: esos campus bajo el rótulo de su
 *    universidad, SIN "Todos" (no es lo que se buscó).
 * Una universidad sin campus no se lista: su "Todos" no tendría nada que mostrar.
 */
function armarGrupos(catalogo: UniversidadCatalogo[], q: string): Grupo[] {
  const grupos: Grupo[] = [];
  for (const universidad of catalogo) {
    if (universidad.campus.length === 0) continue;
    if (!q || normalizar(universidad.nombre).includes(q)) {
      grupos.push({ universidad, conTodos: true, campus: universidad.campus });
      continue;
    }
    const campus = universidad.campus.filter(
      (c) => normalizar(c.nombre).includes(q) || normalizar(c.ciudad).includes(q)
    );
    if (campus.length > 0) grupos.push({ universidad, conTodos: false, campus });
  }
  return grupos;
}

/** Los seis estados persistentes de "Detectar campus más cercano" (frames en
 * `design/relevo-app.html`, grupo Explorar) — 'inactivo'/'buscando' no llevan
 * `.notice`. 'timeout' y cualquier otro fallo comparten el frame "error de
 * ubicación": distinguir la causa exacta no cambia lo que el usuario puede
 * hacer. */
type EstadoDeteccion =
  | 'inactivo'
  | 'buscando'
  | 'sin_cercano'
  | 'servicios_desactivados'
  | 'permiso_denegado'
  | 'permiso_denegado_permanente'
  | 'error';

const COPY_DETECCION: Partial<Record<EstadoDeteccion, string>> = {
  sin_cercano: 'No encontramos ningún campus cerca de tu ubicación. Elige uno de la lista.',
  servicios_desactivados:
    'La ubicación de tu teléfono está desactivada. Actívala desde Ajustes para poder detectar tu campus.',
  permiso_denegado:
    'No pudimos acceder a tu ubicación. Puedes intentarlo de nuevo o elegir un campus de la lista.',
  permiso_denegado_permanente:
    'Desactivaste el acceso a tu ubicación para Relevo. Actívalo desde Ajustes para poder detectar tu campus.',
  error: 'No pudimos obtener tu ubicación. Inténtalo de nuevo o elige un campus de la lista.',
};

export default function SelectorCampusScreen() {
  const [busqueda, setBusqueda] = useState('');
  const { alcance, setAlcance, catalogo, getCampus } = useExplorarState();
  const { profile } = useSession();
  const { mostrar: mostrarToast } = useToast();
  const universidadPropiaId = profile?.universidad_id ?? null;

  const [deteccion, setDeteccion] = useState<EstadoDeteccion>('inactivo');
  // "Intento vigente": se incrementa al tocar el botón de nuevo, al elegir un
  // campus a mano, y al desmontar. Un resultado de `obtenerUbicacionAproximada()`
  // que llegue con un valor VIEJO se descarta sin tocar el estado del sheet —
  // ver CLAUDE.md, decisión de la fase 2C sobre la carrera timeout/manual.
  const intentoRef = useRef(0);

  useEffect(() => {
    return () => {
      intentoRef.current += 1;
    };
  }, []);

  const q = normalizar(busqueda.trim());

  // La universidad propia primero; las demás ya vienen por nombre del catálogo.
  const ordenado = [
    ...catalogo.filter((u) => u.id === universidadPropiaId),
    ...catalogo.filter((u) => u.id !== universidadPropiaId),
  ];
  const grupos = armarGrupos(ordenado, q);

  const elegir = (nuevo: Alcance) => {
    intentoRef.current += 1;
    setAlcance(nuevo);
    router.back();
  };

  const detectarCampusCercano = async () => {
    intentoRef.current += 1;
    const intento = intentoRef.current;
    setDeteccion('buscando');

    const resultado = await obtenerUbicacionAproximada();
    if (intentoRef.current !== intento) return; // se eligió algo más, o se desmontó

    if (resultado.estado !== 'encontrado') {
      setDeteccion(resultado.estado === 'timeout' ? 'error' : resultado.estado);
      return;
    }

    const todosLosCampus = catalogo.flatMap((u) => u.campus);
    const cercano = campusMasCercano(resultado.coords, todosLosCampus);
    if (!cercano) {
      setDeteccion('sin_cercano');
      return;
    }

    const campus = getCampus(cercano.id);
    if (!campus) {
      setDeteccion('error');
      return;
    }

    setDeteccion('inactivo');
    mostrarToast(`Detectamos ${campus.nombre} como tu campus más cercano.`, 'exito');
    elegir({ tipo: 'campus', campus });
  };

  return (
    <SheetScreen title="Elige tu campus">
      <View style={{ marginBottom: 4 }}>
        <SearchField placeholder="Busca tu universidad o campus" value={busqueda} onChangeText={setBusqueda} />
      </View>

      {/* Build viejo sin el módulo nativo (CLAUDE.md §9, `ubicacionDisponible()`):
          el botón se oculta entero en vez de avisar y no hacer nada al tocarlo. */}
      {ubicacionDisponible() ? (
        deteccion === 'buscando' ? (
          <View style={[styles.locRow, { opacity: 0.7 }]}>
            <BlinkingDots dotColor={Colors.brick} style={styles.locDots} />
            <Text style={styles.locText}>Detectando tu ubicación…</Text>
          </View>
        ) : (
          <Pressable style={styles.locRow} accessibilityRole="button" onPress={detectarCampusCercano}>
            <IconLocationCrosshair size={16} color={Colors.brick} />
            <Text style={styles.locText}>Detectar campus más cercano</Text>
          </Pressable>
        )
      ) : null}

      {COPY_DETECCION[deteccion] ? (
        <>
          <Notice text={COPY_DETECCION[deteccion]!} />
          {deteccion === 'permiso_denegado_permanente' ? (
            <GhostButton
              label="Ir a Ajustes"
              onPress={() => Linking.openSettings()}
              style={{ marginBottom: 24 }}
            />
          ) : null}
        </>
      ) : null}

      {/* Con texto en el buscador se oculta: no es un resultado de la búsqueda. */}
      {!q ? (
        <ListRow
          name="Todas las universidades"
          sub="Todo el catálogo de Relevo"
          selected={alcance?.tipo === 'todo'}
          last={false}
          onPress={() => elegir({ tipo: 'todo' })}
        />
      ) : null}

      {grupos.map(({ universidad, conTodos, campus }) => (
        <View key={universidad.id}>
          <Text style={styles.sectionLabel}>
            {universidad.id === universidadPropiaId
              ? `${universidad.nombre} · Tu universidad`
              : universidad.nombre}
          </Text>
          {conTodos ? (
            <ListRow
              name={`Todos los campus de ${universidad.nombre}`}
              sub={`${universidad.campus.length} campus`}
              selected={alcance?.tipo === 'universidad' && alcance.universidad.id === universidad.id}
              last={false}
              onPress={() =>
                elegir({ tipo: 'universidad', universidad: { id: universidad.id, nombre: universidad.nombre } })
              }
            />
          ) : null}
          {campus.map((c, i) => (
            <ListRow
              key={c.id}
              name={c.nombre}
              sub={c.ciudad}
              selected={alcance?.tipo === 'campus' && alcance.campus.id === c.id}
              last={i === campus.length - 1}
              onPress={() => elegir({ tipo: 'campus', campus: c })}
            />
          ))}
        </View>
      ))}

      {/* Solo alcanzable escribiendo en el buscador (o si el catálogo no cargó). */}
      {grupos.length === 0 ? (
        <Text style={styles.sinResultados}>No encontramos esa universidad o campus.</Text>
      ) : null}
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  // .current-loc-row{display:flex; align-items:center; gap:10px; padding:13px 0; color:var(--brick); font-weight:600; font-size:13.5px;}
  locRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
  },
  locText: {
    ...Typography.emphasis,
    color: Colors.brick,
  },
  // `.splash-dots` trae `margin-top:36px` pensado para el Splash; en esta fila
  // no aplica (mismo criterio que `.primary-btn.is-busy .splash-dots`).
  locDots: {
    marginTop: 0,
  },
  // .list-section-label{font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; padding:16px 0 4px;}
  sectionLabel: {
    ...Typography.caption,
    color: Colors.inkSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.44,
    paddingTop: 16,
    paddingBottom: 4,
  },
  sinResultados: {
    ...Typography.meta,
    color: Colors.inkSoft,
    paddingTop: 20,
    textAlign: 'center',
  },
});
