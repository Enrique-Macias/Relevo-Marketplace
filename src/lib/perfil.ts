/**
 * El perfil propio: el teléfono de RF-13 y la lectura/escritura de "Editar
 * perfil".
 *
 * El número es el único dato del perfil que NO se lee con un select: está fuera
 * del grant de columna (RNF-05, migración 20260910000448) y solo sale por la RPC
 * `seller_whatsapp`. Ese reparto es lo que hace que un autenticado no pueda
 * bajarse el directorio de teléfonos entero en un request, como sí podría si
 * `telefono` viviera junto a `nombre` y `carrera`.
 *
 * De este lado eso significa normalizar lo que el usuario teclea, guardarlo, y
 * pedir el de alguien más cuando hay que abrir WhatsApp. El resto del archivo es
 * lo que "Editar perfil" necesita y `useSession()` no puede dar: los NOMBRES de
 * universidad y campus (el perfil de la sesión solo trae los ids) y la escritura
 * de las columnas editables.
 */

import { type CountryCode } from 'libphonenumber-js/min';
import { useCallback, useRef, useState } from 'react';

import { type OpcionCatalogo } from '@/lib/catalogos';
import {
  LADO_MAXIMO,
  PermisoCamaraDenegadoError,
  PermisoDenegadoError,
  elegirFotos,
  recortarAvatar,
} from '@/lib/foto-picker';
import { type Rect } from '@/lib/recorte';
import {
  FormatoNoSoportadoError,
  FotoDemasiadoGrandeError,
  MAX_BYTES_AVATAR,
  borrarAvatar,
  subirAvatar,
  type FotoLocal,
} from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { aE164, normalizarNombre } from '@/lib/validacion-perfil';

/*
 * Captura del número (país + nacional → E.164): `src/lib/validacion-perfil.ts`
 * (`telefonoValido`, `aE164`, `separarE164`). Vive allá y no aquí porque este
 * archivo importa Supabase y Expo, y el probe que amarra esas reglas con el
 * check `users_telefono_e164` necesita cargarlas desde Node.
 */

/**
 * El deep link de RF-13. `wa.me` quiere el internacional SIN `+`, sin espacios
 * y sin guiones — de ahí el `slice(1)` sobre el E.164 y no un replace suelto.
 */
export function urlWhatsapp(e164: string, mensaje: string): string {
  return `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(mensaje)}`;
}

/**
 * Guarda el número del propio usuario.
 *
 * Solo la columna `telefono`: es la única del grant de update que toca esta
 * pantalla, y mandar cualquier otra —aunque sea con su mismo valor— rechaza el
 * statement completo con 42501. Misma trampa que ya documenta
 * `(onboarding)/completar-perfil.tsx`.
 */
export async function guardarTelefono(
  userId: string,
  pais: CountryCode,
  texto: string
): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({ telefono: aE164(pais, texto) })
    .eq('id', userId);

  if (error) throw error;
}

/**
 * Sube la foto de perfil y la deja guardada (RF-03). Devuelve la ruta nueva.
 *
 * SE PERSISTE AL SUBIRLA, NO AL TOCAR "GUARDAR", y la diferencia con Publicar
 * —que sí difiere la subida hasta el final— tiene una causa concreta: allá la
 * carpeta del objeto ES `{listing_id}/` y la policy exige que ese listing ya
 * exista, así que no hay dónde subir antes. Aquí la fila de `users` SIEMPRE
 * existe (la crea `private.handle_new_user()` al verificarse el correo), así
 * que no hay precondición que esperar — y diferir reintroduciría el huérfano
 * que `publicar-fotos.md` ya tiene como deuda abierta: el usuario sube, se
 * arrepiente, sale sin guardar y el objeto queda sin que nadie lo apunte.
 * Por lo mismo `foto_url` NO entra en `CambiosPerfil`/`guardarPerfil()`.
 *
 * EL ORDEN ES LOAD-BEARING: subir el nuevo → escribir `foto_url` → borrar el
 * anterior. Al revés, un fallo del update dejaría `foto_url` apuntando a un
 * objeto ya borrado, o sea un avatar roto que degrada a iniciales para siempre.
 * El borrado va al final y es best-effort (ver `borrarAvatar`): un huérfano es
 * caro, no incorrecto, y propagarlo dejaría al usuario sin poder cambiar su
 * foto por un problema de red.
 *
 * Solo la columna `foto_url`, mismo motivo que `guardarTelefono()`: colar
 * `correo`/`estado`/`rating_promedio` rechaza el statement entero con 42501.
 */
export async function guardarFotoPerfil(
  userId: string,
  foto: FotoLocal,
  fotoAnterior: string | null
): Promise<string> {
  const path = await subirAvatar(userId, foto);

  const { error } = await supabase.from('users').update({ foto_url: path }).eq('id', userId);
  if (error) {
    // El objeto ya subió pero nadie lo apunta: se limpia antes de propagar, que
    // es la única ventana en la que todavía sabemos su ruta.
    await borrarAvatar(path);
    throw error;
  }

  if (fotoAnterior) await borrarAvatar(fotoAnterior);

  return path;
}

/**
 * El número de otro usuario, para abrir WhatsApp con él.
 *
 * Devuelve `null` en DOS casos que el llamador tiene que saber distinguir, y no
 * puede distinguirlos con esto solo:
 *  - el vendedor no tiene número guardado (publicaciones anteriores a que la
 *    columna existiera, o dadas de alta desde Studio);
 *  - QUIEN LLAMA está suspendido — un suspendido no puede contactar por
 *    WhatsApp (tabla de decisión de CLAUDE.md §3), y esta RPC es donde esa
 *    regla se hace cumplir.
 *
 * La distinción se hace arriba, con el `estado` de la propia sesión. No hay
 * forma de sacarla de aquí, y es a propósito: la función no dice por qué negó.
 */
export async function fetchTelefonoVendedor(userId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('seller_whatsapp', { p_user_id: userId });
  if (error) throw error;
  return data ?? null;
}

export type PerfilEditable = {
  nombre: string;
  /**
   * RUTA dentro del bucket PÚBLICO `avatars`, o null (RF-03). Se lee aquí y no
   * de `useSession()` por lo mismo que el resto de este tipo: la pantalla ya
   * hace este fetch, y `PROFILE_COLUMNS` sí la trae pero el perfil de la sesión
   * solo se refresca con `refreshProfile()`.
   */
  fotoUrl: string | null;
  carrera: string;
  universidad: OpcionCatalogo | null;
  campus: OpcionCatalogo | null;
};

/**
 * Lo que "Editar perfil" necesita y `useSession()` no tiene: los NOMBRES de la
 * universidad y el campus. El perfil de la sesión guarda solo los ids
 * (`PROFILE_COLUMNS`, `src/lib/session.tsx:29`), y un `SelectField` sin nombre
 * pintaría su placeholder — que se leería como "no tienes universidad", no como
 * "todavía no cargo".
 *
 * Los embeds no necesitan desambiguar la FK, al revés que
 * `users!listings_user_id_fkey` en `src/lib/listings.ts`: entre `users` y cada
 * catálogo hay UN solo camino (`users_universidad_id_fkey`, y hacia `campus`
 * la FK compuesta `users_campus_universidad_fkey`, que REEMPLAZÓ a la suelta
 * en 20260924000466 justo para no abrir un segundo camino), así que no hay
 * `PGRST201` que esquivar. Es el mismo
 * caso que `fetchPerfilPublico` (`src/lib/perfil-publico.ts`), que ya embebe
 * `universidades` de esta misma forma.
 *
 * `telefono` NO se pide aquí y no es un olvido: está fuera del grant de select y
 * pedirlo haría fallar la query entera con 42501. Va aparte, por
 * `fetchTelefonoVendedor()`.
 */
export async function fetchPerfilEditable(userId: string): Promise<PerfilEditable | null> {
  const { data, error } = await supabase
    .from('users')
    .select('nombre, foto_url, carrera, universidad:universidades(id, nombre), campus:campus(id, nombre)')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // Mismo `as any` que `fetchPerfilPublico`: los tipos generados no modelan el
  // alias del embed.
  const row = data as any;
  return {
    nombre: row.nombre ?? '',
    fotoUrl: row.foto_url ?? null,
    carrera: row.carrera ?? '',
    universidad: row.universidad ?? null,
    campus: row.campus ?? null,
  };
}

export type CambiosPerfil = {
  nombre: string;
  /** Vacío significa "sin carrera" y se guarda como `null`, no como `''`. */
  carrera: string;
  /**
   * Solo el campus: `universidad_id` salió del grant de update (20260924000466)
   * y mandarlo, aunque fuera con el mismo valor, rechazaría el statement entero
   * con 42501. Que el campus sea de la universidad del usuario lo garantiza la
   * base (FK compuesta), no esta función.
   */
  campusId: number;
  /**
   * AUSENTE por default, y esa ausencia es la que protege el número guardado.
   *
   * El tipo es `string` y no `string | null` a propósito: desde "Editar perfil"
   * no existe forma de BORRAR un teléfono —el frame no dibuja esa afordancia— y
   * así ni siquiera es expresable. Quien decide mandarlo es la pantalla, y solo
   * cuando el usuario TOCÓ el campo; ver el comentario de `guardarPerfil`.
   *
   * País + lo tecleado, no el E.164: la base no guarda el país, así que es
   * `aE164()` quien los junta (20260927000470).
   */
  telefono?: { pais: CountryCode; nacional: string };
};

/**
 * Las columnas editables del perfil (nombre, carrera, campus y, si viene, el
 * teléfono), en UN solo statement. La foto va aparte (`guardarFotoPerfil()`).
 *
 * Por qué no se reusa `guardarTelefono()` de arriba: aquella escribe una sola
 * columna, que es lo correcto en Publicar. Aquí partiría el guardado en dos
 * statements y un fallo en el segundo dejaría el perfil a medias (nombre nuevo,
 * teléfono viejo) sin nada que se lo dijera al usuario. Todas estas columnas
 * están en el mismo grant de update (`20260906000438:110` + `20260910000448:62`),
 * así que un solo update es legal — pero OJO: no metas aquí `correo`, `estado` ni
 * `rating_promedio`, que están fuera del grant y harían fallar el statement
 * completo con 42501 aunque fueran con su mismo valor.
 *
 * `telefono` solo viaja si viene en `cambios`. Esa decisión NO se toma
 * comparando el texto final contra el valor precargado, y el motivo es un caso
 * real de pérdida de datos: a un usuario SUSPENDIDO, `seller_whatsapp` le
 * devuelve `null` aunque tenga número guardado (valida al llamante,
 * 20260911000449), así que su campo se precarga vacío. Si "cambió" se calculara
 * por comparación, cambiar solo la carrera mandaría un teléfono vacío sobre un
 * número real. La pantalla rastrea si el usuario TOCÓ el campo y solo entonces
 * lo pasa.
 */
export async function guardarPerfil(userId: string, cambios: CambiosPerfil): Promise<void> {
  const { error } = await supabase
    .from('users')
    .update({
      // Normalizado (NFC, sin espacios al borde ni dobles): la base no
      // normaliza, rechaza (`users_nombre_valido`).
      nombre: normalizarNombre(cambios.nombre),
      carrera: cambios.carrera.trim() || null,
      campus_id: cambios.campusId,
      ...(cambios.telefono !== undefined
        ? { telefono: aE164(cambios.telefono.pais, cambios.telefono.nacional) }
        : {}),
    })
    .eq('id', userId);

  if (error) throw error;
}

// ---------------------------------------------------------------------------
// El círculo de foto de "Completar perfil" y "Editar perfil" (RF-03)
// ---------------------------------------------------------------------------

const MB_AVATAR = Math.round(MAX_BYTES_AVATAR / (1024 * 1024));

/** Traduce lo que lanzó la subida al aviso que lee el usuario. */
function avisoDe(e: unknown): string {
  if (e instanceof PermisoDenegadoError) {
    return 'Necesitamos permiso para abrir tus fotos';
  }
  if (e instanceof PermisoCamaraDenegadoError) {
    return 'Necesitamos acceso a tu cámara para tomar la foto';
  }
  if (e instanceof FotoDemasiadoGrandeError) {
    return `Esa foto pesa más de ${MB_AVATAR} MB. Elige otra.`;
  }
  if (e instanceof FormatoNoSoportadoError) {
    return 'Ese formato de imagen no es compatible';
  }
  return 'No pudimos actualizar tu foto. Intenta de nuevo.';
}

/**
 * Lo que necesitan la hoja "Foto de perfil" y el "Editor de foto de perfil"
 * para pintarse. Lo arma `useFotoPerfil()` y lo consume `ModalesFotoPerfil`
 * (`src/components/EditorFotoPerfil.tsx`): este módulo no importa componentes.
 */
export type ModalesFotoPerfilEstado = {
  hojaVisible: boolean;
  cerrarHoja: () => void;
  elegirCamara: () => void;
  elegirGaleria: () => void;
  /** La foto en el editor; `null` = editor cerrado. */
  editorUri: string | null;
  cancelarEditor: () => void;
  elegirOtra: () => void;
  usar: (rect: Rect) => void;
};

/**
 * El estado del círculo de foto, compartido por las DOS pantallas que lo pintan
 * (D1 de `docs/design-1-fase5-plan.md`).
 *
 * El flujo (DESIGN-1 fase 5): tocar el círculo abre la hoja "Foto de perfil";
 * Tomar foto o Elegir de la galería abre el picker; la foto elegida entra al
 * editor de recorte; "Usar foto" recorta el círculo (`recortarAvatar()`), sube,
 * escribe `foto_url` y refresca la sesión. Cancelar en cualquier punto no sube
 * nada.
 *
 * El picker normaliza a `LADO_MAXIMO` (1600) y no a `LADO_MAXIMO_AVATAR`: el
 * usuario todavía va a acercar, y recortar sobre 512 px dejaría el avatar
 * borroso. El tope del avatar lo aplica `recortarAvatar()`, al final.
 *
 * NO importa `useToast`: ningún módulo de `src/lib/` importa un componente en
 * runtime (solo tipos), así que el aviso sale por `onAviso` y la pantalla decide
 * con qué lo muestra.
 *
 * Con `diferida` (PL-016, solo "Completar perfil"), "Usar foto" recorta pero NO
 * sube: la foto queda en el teléfono (`pendiente`) hasta `subirPendiente()`, que
 * la pantalla llama al tocar Continuar, DESPUÉS de registrar la aceptación de
 * los Términos. Sin aceptación la base rechaza escribir `foto_url`
 * (`users_exige_terminos`) y subir el objeto (`avatars_objects_insert_own`).
 *
 * El guard de reentrada va en un `ref` y no en el estado, mismo motivo que
 * `agregarFoto()` de Publicar: tiene que valer ANTES del primer `await`, sin
 * esperar a un re-render, o un doble tap abre el picker dos veces. Se toma al
 * abrir el picker y se suelta al terminar (cancelar, fallar o guardar).
 */
export function useFotoPerfil({
  userId,
  inicial,
  onAviso,
  onGuardada,
  diferida = false,
}: {
  userId: string;
  inicial: string | null;
  diferida?: boolean;
  onAviso: (texto: string, variante?: 'exito' | 'error') => void;
  /** Se llama tras escribir `foto_url`. Las pantallas hacen `refreshProfile()`. */
  onGuardada?: () => void | Promise<void>;
}) {
  const [fotoUrl, setFotoUrl] = useState<string | null>(inicial);
  const [subiendo, setSubiendo] = useState(false);
  const [hojaVisible, setHojaVisible] = useState(false);
  const [editorUri, setEditorUri] = useState<string | null>(null);
  const [pendiente, setPendiente] = useState<FotoLocal | null>(null);
  const enCurso = useRef(false);

  const cambiar = useCallback(() => {
    if (enCurso.current) return;
    setHojaVisible(true);
  }, []);

  const cerrarHoja = useCallback(() => setHojaVisible(false), []);

  /**
   * Abre el picker y devuelve la uri normalizada, o `null` si no hay foto
   * (canceló, formato no soportado o falló, ya avisado). No toma el guard: lo
   * hace quien la llama, porque "Elegir otra" la llama con el editor abierto.
   */
  const elegir = useCallback(
    async (origen: 'galeria' | 'camara'): Promise<string | null> => {
      try {
        const { fotos, descartadas } = await elegirFotos(1, undefined, {
          ladoMaximo: LADO_MAXIMO,
          origen,
        });
        // Sin fotos y sin descartadas = canceló, que no es un error.
        if (fotos.length === 0) {
          if (descartadas > 0) onAviso('Ese formato de imagen no es compatible', 'error');
          return null;
        }
        return fotos[0].uri;
      } catch (e: any) {
        console.warn('[foto-perfil] no se pudo abrir el picker:', e?.message ?? e);
        const conocido =
          e instanceof PermisoDenegadoError || e instanceof PermisoCamaraDenegadoError;
        onAviso(
          !conocido && origen === 'camara' ? 'No pudimos abrir la cámara' : avisoDe(e),
          'error'
        );
        return null;
      }
    },
    [onAviso]
  );

  const abrir = useCallback(
    async (origen: 'galeria' | 'camara') => {
      if (enCurso.current) return;
      enCurso.current = true;
      const uri = await elegir(origen);
      if (uri) {
        setEditorUri(uri);
      } else {
        enCurso.current = false;
      }
    },
    [elegir]
  );

  const elegirCamara = useCallback(() => void abrir('camara'), [abrir]);
  const elegirGaleria = useCallback(() => void abrir('galeria'), [abrir]);

  const cancelarEditor = useCallback(() => {
    setEditorUri(null);
    enCurso.current = false;
  }, []);

  // Con el editor abierto el guard ya está tomado; si cancela, se queda la foto
  // que ya estaba en el editor.
  const elegirOtra = useCallback(async () => {
    const uri = await elegir('galeria');
    if (uri) setEditorUri(uri);
  }, [elegir]);

  const usar = useCallback(
    async (rect: Rect) => {
      const uri = editorUri;
      if (!uri) return;
      // El editor se cierra primero: la espera se ve en el círculo de la
      // pantalla (`subiendo`), igual que antes del editor.
      setEditorUri(null);
      setSubiendo(true);
      try {
        const recortada = await recortarAvatar(uri, rect);
        if (diferida) {
          setPendiente(recortada);
          return;
        }
        const path = await guardarFotoPerfil(userId, recortada, fotoUrl);
        setFotoUrl(path);
        await onGuardada?.();
      } catch (e: any) {
        console.warn('[foto-perfil] no se pudo actualizar:', e?.message ?? e);
        onAviso(avisoDe(e), 'error');
      } finally {
        enCurso.current = false;
        setSubiendo(false);
      }
    },
    [diferida, editorUri, fotoUrl, onAviso, onGuardada, userId]
  );

  /**
   * Sube la foto `pendiente` (modo `diferida`). Devuelve false si falló, ya
   * avisado: la foto se conserva para reintentar.
   */
  const subirPendiente = useCallback(async (): Promise<boolean> => {
    if (!pendiente) return true;
    setSubiendo(true);
    try {
      const path = await guardarFotoPerfil(userId, pendiente, fotoUrl);
      setFotoUrl(path);
      setPendiente(null);
      await onGuardada?.();
      return true;
    } catch (e: any) {
      console.warn('[foto-perfil] no se pudo subir la foto pendiente:', e?.message ?? e);
      onAviso(avisoDe(e), 'error');
      return false;
    } finally {
      setSubiendo(false);
    }
  }, [fotoUrl, onAviso, onGuardada, pendiente, userId]);

  const modales: ModalesFotoPerfilEstado = {
    hojaVisible,
    cerrarHoja,
    elegirCamara,
    elegirGaleria,
    editorUri,
    cancelarEditor,
    elegirOtra: () => void elegirOtra(),
    usar: (rect) => void usar(rect),
  };

  return { fotoUrl, subiendo, cambiar, modales, pendiente, subirPendiente };
}
