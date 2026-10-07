// Guarda de proyecto para los probes que ESCRIBEN en la base local (DDL, Vault,
// estados de usuarios): en esta máquina puede haber más de un stack de Supabase
// levantado a la vez (medido el 2026-10-07: `passly-local` junto a este), y
// "localhost" no distingue uno de otro.
//
// Aborta si falla CUALQUIERA de las cuatro comprobaciones, e imprime cuál:
//   1. el contenedor `supabase_db_relevo-marketplace` existe y su etiqueta
//      `com.supabase.cli.project` es `relevo-marketplace`;
//   2. su puerto publicado para 5432/tcp es el `[db] port` de config.toml (y el
//      de la conexión TCP del probe, si la usa: `puertoTcp`);
//   3. `project_id` de config.toml es `relevo-marketplace`;
//   4. en la base que recibe el SQL (vía ese mismo contenedor), existe la marca
//      del esquema de Relevo: `public.hook_before_user_created` (1 fila en
//      pg_proc).
//
// Sin dependencias, solo `docker` y la lectura de config.toml.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const CONTENEDOR_DB = 'supabase_db_relevo-marketplace';
const PROYECTO = 'relevo-marketplace';

export function guardaRelevo({ apiUrl, puertoTcp } = {}) {
  const fallas = [];
  const sh = (cmd, args) => {
    try {
      return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (e) {
      return `ERROR: ${(e.stderr || e.message || '').toString().trim()}`;
    }
  };

  const etiqueta = sh('docker', ['inspect', '-f', '{{index .Config.Labels "com.supabase.cli.project"}}', CONTENEDOR_DB]);
  if (etiqueta !== PROYECTO) fallas.push(`1. etiqueta del contenedor ${CONTENEDOR_DB}: "${etiqueta}"`);

  const toml = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  const projectId = toml.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
  const dbPort = toml.match(/^\[db\][\s\S]*?^port\s*=\s*(\d+)/m)?.[1];
  if (projectId !== PROYECTO) fallas.push(`3. project_id de config.toml: "${projectId}"`);

  const publicado = sh('docker', ['port', CONTENEDOR_DB, '5432/tcp']).split('\n')[0];
  const puertoPublicado = publicado.match(/:(\d+)$/)?.[1];
  if (!puertoPublicado || puertoPublicado !== dbPort) {
    fallas.push(`2. puerto publicado de ${CONTENEDOR_DB} ("${publicado}") distinto de [db] port (${dbPort})`);
  }
  if (puertoTcp != null && String(puertoTcp) !== puertoPublicado) {
    fallas.push(`2. la conexión TCP del probe usa ${puertoTcp}, el contenedor publica ${puertoPublicado}`);
  }

  const marca = sh('docker', ['exec', CONTENEDOR_DB, 'psql', '-U', 'postgres', '-At', '-c',
    "select count(*) from pg_proc where proname = 'hook_before_user_created'"]);
  if (marca !== '1') fallas.push(`4. marca del esquema (hook_before_user_created) en pg_proc: "${marca}"`);

  console.log(`guarda: contenedor=${CONTENEDOR_DB} proyecto=${etiqueta} puerto=${puertoPublicado}` +
    (apiUrl ? ` API_URL=${apiUrl}` : ''));
  if (fallas.length > 0) {
    console.error('ABORTO: la guarda de proyecto falló, no se escribe nada:\n  ' + fallas.join('\n  '));
    process.exit(1);
  }
}
