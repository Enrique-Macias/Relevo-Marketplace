import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.ts';
import { BUCKET_FOTOS, diagnosticarFalloDeFoto } from '../lib/fotos.ts';
import { pedirTotp } from '../lib/puerta-totp.ts';
import { IconImage } from './Iconos.tsx';

/**
 * Una foto del bucket PRIVADO `listing-photos` (D-A2 de la Ola 2).
 *
 * `<img src>` no manda `Authorization`, así que la foto se descarga con el
 * token de la sesión (`storage.download()` → `/object/{bucket}/…`, la policy
 * `listing_photos_objects_select_admin` se re-evalúa en cada request) y se
 * pinta como object URL. La CSP del build permite `img-src blob:` por esto.
 * Signed URLs, descartadas: evalúan la RLS al firmar y seguirían sirviendo la
 * foto después de que venza el TOTP (CLAUDE.md §9).
 *
 *   - El object URL se libera en el cleanup del efecto y cada vez que cambia
 *     `ruta`. Si el componente se desmonta antes de que termine `download()`, el
 *     resultado se ignora y no se crea ningún object URL huérfano.
 *   - Si falla, el diagnóstico es COMPARTIDO (`lib/fotos.ts`): N fotos, una
 *     llamada a `admin.sesion()` y como mucho un modal. Si la sesión se renovó,
 *     reintenta UNA vez sola; si no (o se canceló el modal), queda en "no
 *     disponible" con un "Reintentar" que es una acción del usuario, no un bucle.
 */
// Si `ruta` cambia, el padre monta otra foto (`key={ruta}`): este componente no
// reinicia su estado en un efecto.
export function FotoListing({ ruta, clase = '', principal }: { ruta: string; clase?: string; principal?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [fallo, setFallo] = useState(false);
  const [intento, setIntento] = useState(0); // lo sube "Reintentar"

  useEffect(() => {
    let vivo = true;
    let creado: string | null = null;

    const descargar = () => supabase.storage.from(BUCKET_FOTOS).download(ruta);

    void (async () => {
      let r = await descargar();
      if (r.error && vivo) {
        const d = await diagnosticarFalloDeFoto();
        if (d === 'reintentar' && vivo) r = await descargar(); // una sola vez
      }
      if (!vivo) return;
      if (r.error || !r.data) { setFallo(true); return; }
      creado = URL.createObjectURL(r.data);
      setUrl(creado);
    })();

    return () => {
      vivo = false;
      if (creado) URL.revokeObjectURL(creado);
    };
  }, [ruta, intento]);

  const reintentar = async () => {
    // Acción del usuario: si el TOTP es lo que falta, se pide aquí mismo; si
    // se cancela de nuevo, la foto sigue "no disponible" sin reintentar sola.
    const { data } = await supabase.rpc('sesion');
    const s = data as unknown as { aal: string | null; totp_reciente: boolean } | null;
    if (s && (s.aal !== 'aal2' || !s.totp_reciente)
        && !(await pedirTotp(s.aal !== 'aal2' ? 'mfa_requerido' : 'totp_vencido'))) return;
    setUrl(null);
    setFallo(false);
    setIntento((n) => n + 1);
  };

  if (fallo) {
    return (
      <div className={`foto no-disponible ${clase}`}>
        <IconImage tam={20} />
        La foto no está disponible
        <button type="button" className="btn ghost-btn" onClick={() => void reintentar()}>Reintentar</button>
      </div>
    );
  }
  if (!url) return <div className={`foto skeleton ${clase}`} aria-busy="true" />;
  return (
    <div className={`foto ${clase}`}>
      <img src={url} alt={principal ? 'Foto principal de la publicación' : 'Foto de la publicación'} />
    </div>
  );
}
