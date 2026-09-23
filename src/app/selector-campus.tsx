/**
 * Selector de campus: hoja del Feed para cambiar QUÉ parte del catálogo se mira
 * (fase 2B). Tres niveles de alcance: todas las universidades, una universidad
 * entera ("Todos los campus de …") o un campus, de CUALQUIER universidad.
 *
 * Elegir aquí no cambia el perfil ni dónde se publica, y dura la sesión
 * (`explorar-state.tsx`, `Alcance`). Fijar el campus del perfil es otro
 * componente (`CampusBottomSheet`), acotado a la universidad propia.
 */

import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconLocationCrosshair } from '@/components/icons';
import { ListRow, SearchField } from '@/components/ListRow';
import { SheetScreen } from '@/components/SheetScreen';
import { Colors, Typography } from '@/constants/theme';
import { useExplorarState, type Alcance, type UniversidadCatalogo } from '@/lib/explorar-state';
import { useSession } from '@/lib/session';

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

export default function SelectorCampusScreen() {
  const [busqueda, setBusqueda] = useState('');
  const { alcance, setAlcance, catalogo } = useExplorarState();
  const { profile } = useSession();
  const universidadPropiaId = profile?.universidad_id ?? null;

  const q = normalizar(busqueda.trim());

  // La universidad propia primero; las demás ya vienen por nombre del catálogo.
  const ordenado = [
    ...catalogo.filter((u) => u.id === universidadPropiaId),
    ...catalogo.filter((u) => u.id !== universidadPropiaId),
  ];
  const grupos = armarGrupos(ordenado, q);

  const elegir = (nuevo: Alcance) => {
    setAlcance(nuevo);
    router.back();
  };

  return (
    <SheetScreen title="Elige tu campus">
      <View style={{ marginBottom: 4 }}>
        <SearchField placeholder="Busca tu universidad o campus" value={busqueda} onChangeText={setBusqueda} />
      </View>

      {/* Geolocalización real: fase 2C, fuera de alcance. */}
      <Pressable style={styles.locRow} accessibilityRole="button">
        <IconLocationCrosshair size={16} color={Colors.brick} />
        <Text style={styles.locText}>Detectar campus más cercano</Text>
      </Pressable>

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
