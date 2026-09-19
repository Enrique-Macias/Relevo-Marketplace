/**
 * Grupo Confianza — "¿A quién le vendiste?" y "Calificar" (RF-07, RF-12).
 *
 * Como no hay chat interno, el vendedor no sabe automáticamente quién compró:
 * al marcar una publicación como vendida se le muestra la lista de quienes
 * tocaron "Contactar por WhatsApp", y su elección se registra en
 * `listing_sales`. Esa fila es lo que después autoriza la calificación entre
 * las dos partes — ver `private.can_rate()` en la migración 20260912000453.
 */

import { useCallback, useEffect, useState } from 'react';

import { cambiarEstadoListing, type EstadoListing } from '@/lib/listings';
import { supabase } from '@/lib/supabase';

export type Contacto = {
  userId: string;
  nombre: string | null;
  /** RUTA dentro del bucket PÚBLICO `avatars`, o null. La pinta `Avatar`. */
  fotoUrl: string | null;
  createdAt: string;
};

export type Venta = {
  compradorId: string;
  /**
   * Si la ventana de corrección ya se cerró. Ver `congelada()` abajo: la
   * condición es DIRECCIONAL y tiene que coincidir con el `using` de
   * `listing_sales_update_seller`.
   */
  congelada: boolean;
};

/**
 * Los candidatos de "¿A quién le vendiste?".
 *
 * El embed va sin desambiguar (`users(id, nombre)`) y eso NO es un descuido:
 * entre `listing_contacts` y `users` hay UNA sola FK, así que aquí no aplica el
 * `PGRST201` que obliga a escribir `users!listings_user_id_fkey` en
 * `src/lib/listings.ts`. Si algún día se agrega una segunda relación entre esas
 * dos tablas, esta query empieza a fallar y hay que nombrarla.
 *
 * `nombre` sí está en el `grant select` de `users` (20260906000438); `correo` y
 * `telefono` no — por eso se listan las columnas y nunca se pide `*`, que
 * rechazaría la query ENTERA con 42501 en vez de devolverla sin esas columnas.
 *
 * La RLS de `listing_contacts` ya limita el resultado a quien puede verlo: el
 * dueño de la publicación ve quién lo contactó. No hace falta filtrar por
 * vendedor aquí.
 */
export async function fetchContactos(listingId: number): Promise<Contacto[]> {
  const { data, error } = await supabase
    .from('listing_contacts')
    .select('user_id, created_at, usuario:users(id, nombre, foto_url)')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return (data ?? []).map((c: any) => ({
    userId: c.user_id,
    nombre: c.usuario?.nombre ?? null,
    fotoUrl: c.usuario?.foto_url ?? null,
    createdAt: c.created_at,
  }));
}

/**
 * La venta registrada de una publicación, o `null`.
 *
 * La RLS de `listing_sales` decide a quién le devuelve algo: al vendedor y al
 * comprador, a nadie más. Ni siquiera a los otros contactos de esa misma
 * publicación.
 *
 * Trae TAMBIÉN el congelamiento porque los dos consumidores lo necesitan a la
 * vez: la fila decide si se pinta "Cambiar comprador", y el congelamiento
 * decide si esa fila se puede tocar.
 *
 * `vendedorId` va EXPLÍCITO y no se deriva de la sesión, aunque en el camino del
 * vendedor sean lo mismo. Cuando lo derivaba, el camino del COMPRADOR
 * (`useVentaDetalle`) calculaba `congelada` preguntando "¿me califiqué a mí
 * mismo?" — siempre `false`, un valor sin sentido que parecía correcto. No
 * causaba un bug porque nadie lo leía en esa rama, pero el nombre del parámetro
 * mentía y el siguiente consumidor se lo habría creído.
 */
export async function fetchVenta(
  listingId: number,
  vendedorId: string
): Promise<Venta | null> {
  const { data, error } = await supabase
    .from('listing_sales')
    .select('comprador_id')
    .eq('listing_id', listingId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    compradorId: data.comprador_id,
    congelada: await congelada(listingId, vendedorId, data.comprador_id),
  };
}

/**
 * ¿Se cerró ya la ventana de corrección?
 *
 * ESTA CONDICIÓN Y EL `using` DE `listing_sales_update_seller` SON LA MISMA
 * CONDICIÓN ESCRITA DOS VECES. Cambiar una sin la otra no produce ningún error
 * visible — solo una fila de menú que desaparece de más, o un botón que promete
 * algo que la base rechaza.
 *
 * Y ES DIRECCIONAL: cierra la ventana la reseña DEL VENDEDOR hacia el comprador
 * registrado, nunca "cualquier reseña de la venta". Si el vendedor se equivocó
 * de persona y esa persona lo calificó, la corrección SIGUE abierta — y un
 * cliente que leyera esto en cualquier dirección escondería la única salida que
 * le queda al vendedor. El cliente no puede ser más estricto que la base.
 *
 * Es una lectura normal, sin RPC: `ratings_select` es `using (true)` porque las
 * reseñas son públicas (las muestra "Perfil público"). Justamente por eso el
 * filtro por vendedor va EXPLÍCITO: al ser legible por todos, la RLS no acota
 * nada aquí y un `count` sin ese `eq` contaría también la reseña del comprador
 * — que es exactamente la que NO debe congelar.
 */
async function congelada(
  listingId: number,
  vendedorId: string,
  compradorId: string
): Promise<boolean> {
  const { count, error } = await supabase
    .from('ratings')
    .select('id', { count: 'exact', head: true })
    .eq('listing_id', listingId)
    .eq('from_user_id', vendedorId)
    .eq('to_user_id', compradorId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Registra la venta y marca la publicación.
 *
 * EL ORDEN ES OBLIGATORIO: primero la fila de venta, después el estado. Al
 * revés, un fallo entre los dos statements deja la publicación `vendida` sin
 * comprador registrado y SIN SALIDA — la entrada "Marcar como vendida"
 * desaparece en cuanto el estado cambia, y con ella la única forma de registrar
 * al comprador o de calificar a nadie.
 *
 * Con este orden, un fallo del segundo statement deja una venta registrada
 * sobre una publicación todavía activa: la entrada sigue visible, el usuario
 * reintenta, el insert es no-op (`ignoreDuplicates`, el mismo idiom de
 * `favorites` y `push_tokens`) y el update se rehace.
 */
export async function registrarVenta(listingId: number, compradorId: string): Promise<void> {
  const { error } = await supabase
    .from('listing_sales')
    .upsert(
      { listing_id: listingId, comprador_id: compradorId },
      { onConflict: 'listing_id', ignoreDuplicates: true }
    );
  if (error) throw error;

  await cambiarEstadoListing(listingId, 'vendida');
}

/** Se vendió, pero no a través de Relevo: no hay comprador que registrar. */
export async function marcarVendidaSinComprador(listingId: number): Promise<void> {
  await cambiarEstadoListing(listingId, 'vendida');
}

/**
 * Corrige al comprador mal elegido. No toca `listings`: ya está vendida.
 *
 * UN RECHAZO POR CONGELAMIENTO NO LANZA ERROR. El `using` de una policy FILTRA
 * filas, no aborta: el update simplemente afecta 0. Por eso se pide
 * `count: 'exact'` y se compara — sin eso, el caso "ya calificaste, no se puede
 * corregir" se vería exactamente igual que un éxito.
 *
 * Esto NO duplica autorización (CLAUDE.md §0 regla 7): el candado es la policy,
 * que decide mire el cliente lo que mire. Lo único que se elige aquí es que el
 * usuario vea un mensaje en vez de un cambio silencioso que no ocurrió.
 */
export class VentaCongeladaError extends Error {
  constructor() {
    super('La venta ya no se puede corregir');
    this.name = 'VentaCongeladaError';
  }
}

export async function corregirComprador(
  listingId: number,
  compradorId: string
): Promise<void> {
  const { error, count } = await supabase
    .from('listing_sales')
    .update({ comprador_id: compradorId }, { count: 'exact' })
    .eq('listing_id', listingId);

  if (error) throw error;
  if ((count ?? 0) === 0) throw new VentaCongeladaError();
}

/**
 * ¿Esta persona ya calificó a la otra por esta publicación?
 *
 * Existe para no OFRECER un botón que el `unique` de la tabla va a rechazar.
 * No es el candado —ese es el constraint— sino evitar el callejón de tocar
 * "Calificar" y recibir un error.
 */
export async function yaCalifico(
  listingId: number,
  fromUserId: string,
  toUserId: string
): Promise<boolean> {
  const { count, error } = await supabase
    .from('ratings')
    .select('id', { count: 'exact', head: true })
    .eq('listing_id', listingId)
    .eq('from_user_id', fromUserId)
    .eq('to_user_id', toUserId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

/** RF-12. El `unique (from_user_id, to_user_id, listing_id)` impide el duplicado. */
export async function crearRating(input: {
  fromUserId: string;
  toUserId: string;
  listingId: number;
  estrellas: number;
  comentario: string;
}): Promise<void> {
  const { error } = await supabase.from('ratings').insert({
    from_user_id: input.fromUserId,
    to_user_id: input.toUserId,
    listing_id: input.listingId,
    estrellas: input.estrellas,
    comentario: input.comentario.trim() === '' ? null : input.comentario.trim(),
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Reportar una publicación o a un usuario (RF-14)
// ---------------------------------------------------------------------------

/**
 * Los cinco motivos del enum `report_reason`, en el orden del frame.
 *
 * Unión literal local y no `Database['public']['Enums']['report_reason']`, que
 * es la convención del repo para los enums de Postgres — ver `Condicion` en
 * `src/lib/listings.ts`.
 */
export type ReportReason =
  | 'spam_publicidad'
  | 'sospecha_fraude'
  | 'contenido_inapropiado'
  | 'no_es_estudiante'
  | 'otro';

/**
 * Un reporte apunta a UNA publicación o a UN usuario, nunca a los dos ni a
 * ninguno. Eso ya lo exige la base —`num_nonnulls(listing_id, reported_user_id)
 * = 1` en el `with check` de `reports_insert_own`—, y esta unión lo sube al
 * tipo: con `?: never` en la rama contraria, pasar ambos objetivos (o ninguno)
 * no compila, en vez de fallar hasta el 42501 en runtime. El tipo REFLEJA la
 * regla de la base, no la reemplaza — el candado sigue siendo la policy.
 */
type CrearReporteInput = {
  reporterId: string;
  motivo: ReportReason;
  comentario: string;
} & (
  | { listingId: number; reportedUserId?: never }
  | { reportedUserId: string; listingId?: never }
);

/**
 * RF-14, los DOS objetivos: la hoja de Detalle reporta una publicación, la de
 * Perfil público reporta a la persona. Comparten motivos porque el enum
 * `report_reason` no distingue objetivo.
 *
 * NO se manda `listing_titulo`: lo materializa el trigger
 * `capture_report_snapshot` (20260906000441), que además pisa lo que venga del
 * cliente. Es un snapshot a propósito — el reporte tiene que seguir siendo
 * legible aunque después se borre la publicación. Por el mismo motivo tampoco
 * se manda `reported_user_correo`, el snapshot hermano: el cliente ni siquiera
 * puede leer esa columna (queda fuera del grant de select, RNF-05).
 *
 * Tampoco `estado`, que nace en 'pendiente' por default y solo lo mueve
 * `service_role` desde Studio (RF-17): el cliente no tiene grant de update
 * sobre esta tabla.
 *
 * Los rechazos posibles son TRES, todos con SQLSTATE 42501, porque el `with
 * check` de un INSERT sí lanza (a diferencia del `using` de un UPDATE, que
 * filtra en silencio — ver `corregirComprador` arriba): el llamante está
 * suspendido; es el dueño de la publicación que intenta reportar
 * (20260914000455); o es la persona que intenta reportarse a sí misma
 * (el `check` de tabla de 20260906000441, otro candado distinto). Quien los
 * separa para el copy es la pantalla, con `profile.estado`, que ya tiene.
 */
export async function crearReporte(input: CrearReporteInput): Promise<void> {
  const { error } = await supabase.from('reports').insert({
    reporter_id: input.reporterId,
    // Las dos columnas se mandan siempre, una de ellas en null: el `with check`
    // cuenta no-nulos, así que omitir la que no aplica y mandarla null son lo
    // mismo para la base, y mandarlas explícitas deja ver el mutuo-excluyente.
    listing_id: input.listingId ?? null,
    reported_user_id: input.reportedUserId ?? null,
    motivo: input.motivo,
    comentario: input.comentario.trim() === '' ? null : input.comentario.trim(),
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// El derivado de tres estados de la fila de venta
// ---------------------------------------------------------------------------

export type AccionVenta = 'marcar' | 'corregir' | null;

/**
 * Qué dice —o si aparece— la fila/botón de venta, en UN solo lugar.
 *
 * Lo comparten las TRES entradas ("Editar publicación", "Detalle (vista
 * vendedor)" y la hoja de acciones de "Mis publicaciones"), y por eso vive
 * aquí: calcularlo tres veces es la forma de que las tres se desincronicen.
 *
 *   · 'marcar'   — activa o pausada: todavía no se ha vendido.
 *   · 'corregir' — vendida, con comprador registrado y sin congelar. Este es el
 *                  estado que impide un callejón sin salida: al pasar a
 *                  vendida desaparece la entrada original, así que sin él un
 *                  comprador mal elegido sería incorregible desde la app.
 *   · null       — vendida sin comprador (la salida "No fue a través de
 *                  Relevo"), ya congelada por la calificación del vendedor, o
 *                  `pendiente`/`bloqueada` por moderación (RF-18).
 *
 * ESE ÚLTIMO CASO NO ES SOLO UN TIPO MÁS ANCHO, es comportamiento: hasta RF-18
 * esta función devolvía 'marcar' para TODO estado distinto de vendida, así que
 * con el enum de cinco valores una publicación en revisión habría ofrecido
 * "Marcar como vendida" en las TRES superficies que la consumen. Y ese update
 * afecta 0 filas sin lanzar — `listings_update_own` excluye `pendiente` y
 * `bloqueada` de su `using` (20260917000459) — o sea que el usuario habría
 * llegado hasta "¿A quién le vendiste?" para recibir un error al final.
 *
 * El `if` nuevo va ANTES del `!== 'vendida'`, o la primera línea se lo comería.
 */
export function accionVenta(estado: EstadoListing, venta: Venta | null): AccionVenta {
  if (estado === 'pendiente' || estado === 'bloqueada') return null;
  if (estado !== 'vendida') return 'marcar';
  if (venta === null || venta.congelada) return null;
  return 'corregir';
}

export const LABEL_ACCION_VENTA: Record<'marcar' | 'corregir', string> = {
  marcar: 'Marcar como vendida',
  corregir: 'Cambiar comprador',
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

type EstadoCarga = 'loading' | 'ready' | 'error';

/**
 * Lo que necesita "¿A quién le vendiste?": los candidatos y la venta ya
 * registrada (para el modo corrección).
 *
 * Resetea EN RENDER comparando una `key`, no dentro del efecto — el patrón de
 * `useMisListings` y `useNotificaciones`. Hacerlo en el efecto deja pasar un
 * render con los contactos de la publicación ANTERIOR pintados bajo el título
 * de la nueva. Ver CLAUDE.md §9: que la regla `set-state-in-effect` no lo
 * marque no prueba nada.
 */
export function useVenta(listingId: number | null, vendedorId: string | null) {
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [venta, setVenta] = useState<Venta | null>(null);
  const [estado, setEstado] = useState<EstadoCarga>('loading');
  const [recargas, setRecargas] = useState(0);

  const key = `${listingId ?? ''}|${vendedorId ?? ''}|${recargas}`;
  const [keyPintada, setKeyPintada] = useState(key);
  if (key !== keyPintada) {
    setKeyPintada(key);
    setContactos([]);
    setVenta(null);
    setEstado('loading');
  }

  useEffect(() => {
    if (listingId === null || vendedorId === null) return;

    let vigente = true;

    Promise.all([fetchContactos(listingId), fetchVenta(listingId, vendedorId)])
      .then(([c, v]) => {
        if (!vigente) return;
        setContactos(c);
        setVenta(v);
        setEstado('ready');
      })
      .catch((e: any) => {
        if (!vigente) return;
        console.warn('[confianza] falló la carga de la venta:', e?.message ?? e);
        setEstado('error');
      });

    return () => {
      vigente = false;
    };
  }, [listingId, vendedorId, recargas]);

  const recargar = useCallback(() => setRecargas((n) => n + 1), []);

  return { contactos, venta, estado, recargar };
}

/**
 * Lo que necesita el Detalle de una publicación VENDIDA.
 *
 * Hermano de `useVenta` y no el mismo: aquel trae también los contactos, que
 * aquí no se usan —el Detalle no ofrece elegir comprador— y que además el
 * comprador solo vería a medias (`listing_contacts_select` le deja ver los
 * suyos, no los de los demás). Pedirlos sería un request por apertura de
 * Detalle para pintar nada.
 *
 * `vendedorId` entra como parámetro en vez de derivarse: quien mira puede ser
 * el vendedor o el comprador, y `yaCalifique` se pregunta SIEMPRE desde quien
 * mira hacia la otra parte.
 *
 * `recargas` es el contador de quien llama, y existe porque el Detalle no se
 * desmonta al volver del flujo de venta: sin él, la pantalla podía recargar el
 * listing y quedarse con la venta vieja, y esa combinación —`estado='vendida'`
 * con `venta=null`— hace que `accionVenta()` devuelva null y esconda "Cambiar
 * comprador" justo después de registrar al comprador. Va por parámetro en vez de
 * ser estado propio para que listing y venta se refresquen en el mismo gesto;
 * `useVenta`, que sí controla su propio ciclo, tiene el suyo interno.
 */
export function useVentaDetalle(
  listingId: number | null,
  userId: string | null,
  vendedorId: string | null,
  recargas = 0
) {
  const [venta, setVenta] = useState<Venta | null>(null);
  const [yaCalifique, setYaCalifique] = useState(false);

  // Reseteo EN RENDER comparando la key, no dentro del efecto — el patrón de
  // `useMisListings` y `useNotificaciones`. En un tab que reusa la pantalla
  // para otra publicación, hacerlo en el efecto deja pasar un render con la
  // venta ANTERIOR, que aquí decide si se pinta un botón de calificar.
  const key = `${listingId ?? ''}|${userId ?? ''}|${recargas}`;
  const [keyPintada, setKeyPintada] = useState(key);
  if (key !== keyPintada) {
    setKeyPintada(key);
    setVenta(null);
    setYaCalifique(false);
  }

  useEffect(() => {
    if (listingId === null || userId === null || vendedorId === null) return;

    let vigente = true;

    // `vendedorId` es el DUEÑO del listing, no quien llama. En esta ruta los dos
    // difieren —aquí también entra el comprador— y pasar el de la sesión haría
    // que `congelada` preguntara "¿me califiqué a mí mismo?", siempre false.
    fetchVenta(listingId, vendedorId)
      .then(async (v) => {
        if (!vigente) return;
        setVenta(v);

        // Solo se pregunta si hay a quién calificar: el comprador registrado
        // mirando al vendedor. En cualquier otro caso el botón no se pinta y la
        // respuesta no cambiaría nada.
        if (v && v.compradorId === userId) {
          const ya = await yaCalifico(listingId, userId, vendedorId);
          if (vigente) setYaCalifique(ya);
        }
      })
      .catch((e: any) => {
        // Fallo suave a propósito: si esto revienta, el Detalle se sigue
        // pintando sin el botón de calificar en vez de romperse entero. Lo
        // único que se pierde es una afordancia que el inbox vuelve a ofrecer.
        console.warn('[confianza] no se pudo leer la venta:', e?.message ?? e);
      });

    return () => {
      vigente = false;
    };
  }, [listingId, userId, vendedorId, recargas]);

  return { venta, yaCalifique };
}
