#!/bin/bash
# PL-016: aplica 20261026000490 y carga las versiones legales `staging-prueba`
# en UNA ejecución, para que el hueco entre las dos (la migración crea el
# catálogo VACÍO, y sin versión vigente nadie puede aceptar: las acciones de P3
# quedan bloqueadas para todos) dure segundos y no una pausa de revisión.
#
#   bash scripts/pl016-activar.sh --destino local
#   bash scripts/pl016-activar.sh --destino staging --pooler-host <aws-….pooler.supabase.com> --solo-preflight
#   bash scripts/pl016-activar.sh --destino staging --pooler-host <aws-….pooler.supabase.com>
#   bash scripts/pl016-activar.sh --destino staging --pooler-host <…> --solo-insert
#
# Orden (todo lo que puede fallar sin efectos va ANTES del push):
#   1. Guardas locales: destino, project-ref, sha256 de la migración, archivo
#      legal íntegro y hashes del insert = SHA256SUMS.
#   2. Preflight de solo lectura por psql: la conexión que usará el insert
#      funciona, y la base está en 53 / …489 sin `documentos_legales`.
#   3. Dry-run: tiene que proponer EXACTAMENTE la …490, sin seeds ni roles.
#   (--solo-preflight termina aquí, sin escribir nada.)
#   4. Confirmación tecleada.
#   5. `supabase db push`  →  6. insert (docs/legal/versiones/staging-prueba/
#      insert-staging.sql) en cuanto el push regresa, con reintento.
#   7. Verificación de solo lectura contra la huella medida en LOCAL.
# Si 6 o 7 fallan, el script lo dice y se detiene: la recuperación es
# docs/pl-016-recuperacion.sql (nivel 1 o 2), decidida por el usuario.
#
# --solo-insert es la salida de "el push entró y el insert no": exige la …490
# aplicada (54 / …490) con el catálogo VACÍO, se salta el dry-run y el push, y
# hace 6 y 7. Con el catálogo ya cargado se niega (el insert no es idempotente).
#
# NO soporta PROD: PROD no existe todavía (PL-001) y estas versiones son
# borradores. Nunca llama a `db reset` ni usa `--include-seed`.
#
# Para STAGING: psql corre DENTRO del contenedor local de Postgres (la máquina
# no tiene psql) contra el session pooler, igual que `crear-admin.mjs
# --remoto`. La contraseña se pide sin eco y viaja como `docker exec -e
# PGPASSWORD` SIN valor (Docker la toma del entorno; no aparece en `ps` ni en
# el historial). `db push --linked` usa el login del CLI, como en los pushes
# anteriores.
set -euo pipefail

REF_STAGING='ukxfnydfhmryrzhdqkvj'
MIGRACION='supabase/migrations/20261026000490_aceptacion_terminos.sql'
MIGRACION_SHA='7d24418a9220bb5c8aff737147ce9e4c2d20fc3f42392b1613109b860fbfd721'
ARCHIVO='docs/legal/versiones/staging-prueba'
CONTENEDOR='supabase_db_relevo-marketplace'
# Huella tras la …490, medida en LOCAL el 2026-10-27 (pl016-activar.sh
# --destino local). Antes de la …490, LOCAL y STAGING dieron la misma.
HUELLA_ESPERADA='607054781d89825780574e80b9a19ab6|9|2e30a75f96edc31e898840e3043898c6|b4461a8291c4a36a68f3e21fc818e4ab|2|7|4|88|52|46|fd7ed8d7f66328405a5190fea7c1df9e'

destino=''; pooler=''; solo_preflight=0; solo_insert=0
while [ $# -gt 0 ]; do
  case "$1" in
    --destino) destino="${2:-}"; shift 2 ;;
    --pooler-host) pooler="${2:-}"; shift 2 ;;
    --solo-preflight) solo_preflight=1; shift ;;
    --solo-insert) solo_insert=1; shift ;;
    *) echo "argumento desconocido: $1" >&2; exit 2 ;;
  esac
done

fallo() { echo "✗ $*" >&2; exit 1; }
paso() { echo; echo "── $*"; }
ahora() { python3 -I -c 'import time; print(f"{time.time():.1f}")'; }
[ "$solo_preflight$solo_insert" = 11 ] && fallo "--solo-preflight y --solo-insert no van juntos"

# >>> valida_dryrun — recibe el STDOUT del dry-run (con --output-format json)
# en un archivo. Pasa solo si stdout es EXACTAMENTE una línea con un objeto
# JSON que diga: dryRun true, upToDate false, migrations == [la …490],
# seeds == [] y roles == [] (con su tipo: una clave ausente o null se rechaza).
# Cualquier otra cosa en stdout (texto, otra línea, JSON roto) se rechaza.
valida_dryrun() {
  python3 -I - "$1" <<'PY'
import json, sys
lineas = [l for l in open(sys.argv[1], encoding="utf-8", errors="replace").read().splitlines() if l.strip()]
if len(lineas) != 1:
    print(f"✗ stdout tiene {len(lineas)} líneas; se esperaba 1 (el JSON de --output-format json)"); sys.exit(1)
try:
    j = json.loads(lineas[0])
except ValueError:
    print("✗ stdout no es JSON:", lineas[0][:100]); sys.exit(1)
if not isinstance(j, dict):
    print("✗ el JSON no es un objeto"); sys.exit(1)
print("JSON del dry-run:", json.dumps(j, ensure_ascii=False))
esperado = {"dryRun": True, "upToDate": False,
            "migrations": ["20261026000490_aceptacion_terminos.sql"], "seeds": [], "roles": []}
malos = [k for k, v in esperado.items() if k not in j or j[k] != v or type(j[k]) is not type(v)]
if malos:
    print("✗ no cuadra:", ", ".join(f"{k}={json.dumps(j.get(k, '<ausente>'))}" for k in malos)); sys.exit(1)
PY
}
# <<< valida_dryrun

cd "$(git rev-parse --show-toplevel)"

# ── 1. Guardas locales ─────────────────────────────────────────────────────
paso "1. Guardas locales"
case "$destino" in
  local) ;;
  staging)
    [ "$(cat supabase/.temp/project-ref 2>/dev/null)" = "$REF_STAGING" ] \
      || fallo "el proyecto enlazado no es STAGING ($REF_STAGING)"
    [[ "$pooler" =~ ^[a-z0-9.-]+\.pooler\.supabase\.com$ ]] \
      || fallo "falta --pooler-host <aws-….pooler.supabase.com> (Dashboard → Connect → Session pooler)"
    ;;
  *) fallo "--destino tiene que ser local o staging (PROD no está soportado)" ;;
esac
[ "$(shasum -a 256 "$MIGRACION" | cut -d' ' -f1)" = "$MIGRACION_SHA" ] \
  || fallo "$MIGRACION no es la revisada (sha256 distinto)"
(cd "$ARCHIVO" && shasum -a 256 -c -s SHA256SUMS) || fallo "el archivo legal no coincide con SHA256SUMS"
for h in $(cut -d' ' -f1 "$ARCHIVO/SHA256SUMS"); do
  [ "$(grep -c "$h" "$ARCHIVO/insert-staging.sql")" -ge 2 ] \
    || fallo "el hash $h de SHA256SUMS no está en insert-staging.sql"
done
docker exec "$CONTENEDOR" true 2>/dev/null || fallo "el contenedor $CONTENEDOR no está corriendo (supabase start)"
echo "destino=$destino · migración y archivo legal íntegros"

if [ "$destino" = staging ]; then
  read -rsp "Contraseña de la base de STAGING (no se muestra): " PGPASSWORD; echo
  export PGPASSWORD PGHOST="$pooler" PGPORT=5432 PGUSER="postgres.$REF_STAGING" PGDATABASE=postgres PGSSLMODE=require
  psqlx() { docker exec -i -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE \
              "$CONTENEDOR" psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }
  push_flags=(--linked)
else
  psqlx() { docker exec -i "$CONTENEDOR" psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
  push_flags=(--local)
fi

# Las consultas de una línea no heredan el stdin de la terminal: `docker exec
# -i` se tragaría lo que el usuario teclea después (la confirmación).
psqlc() { psqlx "$@" </dev/null; }

huella() {
  psqlx <<'SQL'
select concat_ws('|',
  (select md5(string_agg(format('%s.%s.%s|%s|%s|%s|%s', schemaname, tablename, policyname, cmd, roles, coalesce(qual,''), coalesce(with_check,'')), E'\n' order by schemaname, tablename, policyname))
     from pg_policies
    where policyname in ('listings_insert_own','listing_photos_insert_own','listing_photos_objects_insert_own',
                         'avatars_objects_insert_own','ratings_insert_own','ratings_update_own',
                         'listing_contacts_insert_own','listing_sales_insert_seller','listing_sales_update_seller')),
  (select count(*) from pg_policies
    where policyname in ('listings_insert_own','listing_photos_insert_own','listing_photos_objects_insert_own',
                         'avatars_objects_insert_own','ratings_insert_own','ratings_update_own',
                         'listing_contacts_insert_own','listing_sales_insert_seller','listing_sales_update_seller')),
  (select md5(prosrc) from pg_proc where oid = 'public.seller_whatsapp(uuid)'::regprocedure),
  (select md5(coalesce(array_to_string(proacl,','),'')) from pg_proc where oid = 'public.seller_whatsapp(uuid)'::regprocedure),
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('documentos_legales','aceptaciones_legales')),
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname,p.proname) in (('public','aceptar_terminos'),('public','estado_terminos'),
          ('private','version_vigente'),('private','terminos_vigentes_aceptados'),
          ('private','documento_legal_inmutable'),('private','exige_terminos_listing'),('private','exige_terminos_perfil'))),
  (select count(*) from pg_trigger where tgname in ('listings_exige_terminos','users_exige_terminos','documentos_legales_inmutable','documentos_legales_sin_truncate')),
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','admin')),
  (select count(*) from pg_policies),
  (select count(*) from pg_trigger where not tgisinternal),
  (select md5(string_agg(format('%s.%s|%s|%s|%s|%s', n.nspname, p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig,','),''),
                                coalesce(array_to_string(p.proacl,','),''), p.prosrc), E'\n' order by n.nspname, p.proname))
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname,p.proname) in (('public','aceptar_terminos'),('public','estado_terminos'),
          ('private','version_vigente'),('private','terminos_vigentes_aceptados'),
          ('private','documento_legal_inmutable'),('private','exige_terminos_listing'),('private','exige_terminos_perfil'))));
SQL
}

# Versiones staging-prueba vigentes (0 si la tabla no existe).
vigentes() {
  psqlx <<'SQL'
select case when to_regclass('public.documentos_legales') is null then 0 else
  (select count(*) from public.documentos_legales d
    where d.version = 'staging-prueba' and private.version_vigente(d.tipo) = d.version) end;
SQL
}

# ── 2. Preflight de solo lectura ───────────────────────────────────────────
paso "2. Preflight (solo lectura)"
estado="$(psqlc -c "select count(*) || '|' || max(version) || '|' || coalesce(to_regclass('public.documentos_legales')::text, 'sin-tabla') from supabase_migrations.schema_migrations")" \
  || fallo "no se pudo conectar con psql: nada se ha escrito"
echo "migraciones|última|catálogo = $estado"
if [ "$solo_insert" = 1 ]; then
  [ "$estado" = '54|20261026000490|documentos_legales' ] || fallo "--solo-insert exige la …490 aplicada (54|20261026000490|documentos_legales)"
  n_docs="$(psqlc -c "select count(*) from public.documentos_legales")"
  echo "filas en documentos_legales = $n_docs"
  [ "$n_docs" = 0 ] || fallo "el catálogo ya tiene filas: no se vuelve a insertar (revisa con la verificación)"
else
[ "$estado" = '53|20261025000489|sin-tabla' ] || fallo "la base no está en el estado previo esperado (53|20261025000489|sin-tabla)"

# ── 3. Dry-run ─────────────────────────────────────────────────────────────
paso "3. Dry-run"
# `--output-format json` es OBLIGATORIO: sin él, el CLI (2.116.0, medido)
# escribe TEXTO en stdout ("Finished supabase db push.") en una terminal
# normal, y JSON solo cuando detecta un agente (AI_AGENT/CLAUDECODE en el
# entorno, `--agent auto`). Con el flag, stdout es el JSON en los dos casos;
# el progreso va a stderr y no se valida.
d_dry="$(mktemp -d)"; trap 'rm -rf "$d_dry"' EXIT
rc=0; supabase db push "${push_flags[@]}" --dry-run --skip-vault --output-format json >"$d_dry/out" 2>"$d_dry/err" </dev/null || rc=$?
grep -E '•|DRY RUN|Would push|Initialising' "$d_dry/err" "$d_dry/out" -h || true
if [ "$rc" != 0 ]; then
  sed -E 's#(://[^:@/]*:)[^@]*@#\1[REDACTED]@#g' "$d_dry/err" "$d_dry/out"
  fallo "el dry-run falló (salida $rc)"
fi
valida_dryrun "$d_dry/out" \
  || { echo "── stdout crudo del dry-run:"; sed -E 's#(://[^:@/]*:)[^@]*@#\1[REDACTED]@#g' "$d_dry/out"
       fallo "el dry-run no propone EXACTAMENTE la …490 (sin seeds ni roles)"; }
echo "✓ propone solo 20261026000490_aceptacion_terminos.sql"

if [ "$solo_preflight" = 1 ]; then
  echo; echo "✓ Preflight completo. No se escribió nada."; exit 0
fi
fi

# ── 4. Confirmación ────────────────────────────────────────────────────────
paso "4. Confirmación"
if [ "$solo_insert" = 1 ]; then
  clave="INSERTAR-$(echo "$destino" | tr a-z A-Z)"
  read -rp "Escribe $clave para cargar staging-prueba (la …490 ya está aplicada): " confirma
else
  clave="ACTIVAR-$(echo "$destino" | tr a-z A-Z)"
  read -rp "Escribe $clave para aplicar la …490 y cargar staging-prueba: " confirma
fi
[ "$confirma" = "$clave" ] || fallo "cancelado: nada se ha escrito"

# ── 5. Push ────────────────────────────────────────────────────────────────
if [ "$solo_insert" = 1 ]; then
  paso "5. (--solo-insert: sin push)"
else
paso "5. supabase db push ${push_flags[*]} --skip-vault"
supabase db push "${push_flags[@]}" --skip-vault --yes 2>&1 | grep -vE 'new version|recommend' \
  || fallo "el push falló. Revisa si la …490 quedó aplicada antes de reintentar (readback)."
fi
t_push="$(ahora)"

# ── 6. Insert inmediato ────────────────────────────────────────────────────
paso "6. Insert de staging-prueba"
for intento in 1 2 3; do
  if psqlx < "$ARCHIVO/insert-staging.sql"; then break; fi
  # Si el commit llegó pero la respuesta no, ya están cargadas: no se repite.
  [ "$(vigentes 2>/dev/null || echo 0)" = 2 ] && break
  echo "intento $intento falló"
  [ "$intento" = 3 ] && fallo "EL INSERT NO ENTRÓ: la …490 está aplicada con el catálogo vacío y las acciones de P3 están bloqueadas para todos. Volver a correr este script NO sirve (su preflight exige 53 migraciones): reintenta solo el insert (ver el procedimiento) o aplica el NIVEL 1 de docs/pl-016-recuperacion.sql."
done
t_insert="$(ahora)"
echo "✓ cargadas · del fin del push (o del arranque de --solo-insert) al commit del insert: $(python3 -I -c "print(round($t_insert - $t_push, 1))") s"

# ── 7. Verificación de solo lectura ────────────────────────────────────────
paso "7. Verificación"
fallos=0
mig="$(psqlc -c "select count(*) || '|' || max(version) from supabase_migrations.schema_migrations")"
echo "migraciones = $mig"; [ "$mig" = '54|20261026000490' ] || { echo "✗ se esperaba 54|20261026000490"; fallos=1; }
h="$(huella)"
echo "huella     = $h"; [ "$h" = "$HUELLA_ESPERADA" ] || { echo "✗ se esperaba $HUELLA_ESPERADA"; fallos=1; }
v="$(vigentes)"
echo "vigentes   = $v"; [ "$v" = 2 ] || { echo "✗ se esperaban 2 versiones staging-prueba vigentes"; fallos=1; }
cat_="$(psqlc -c "select count(*) || '|' || (select count(*) from public.aceptaciones_legales) from public.documentos_legales")"
echo "catálogo|aceptaciones = $cat_"; [ "$cat_" = '2|0' ] || { echo "✗ se esperaba 2|0"; fallos=1; }
psqlc -c "select tipo || ' ' || version || ' ' || url || ' ' || encode(contenido_sha256,'hex') from public.documentos_legales order by tipo"

[ "$fallos" = 0 ] || fallo "la verificación no cuadra: NO se recupera solo. Decide con docs/pl-016-recuperacion.sql."
echo; echo "✓ PL-016 activado en $destino."
