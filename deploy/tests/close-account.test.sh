#!/usr/bin/env bash
# Banc de la fermeture de compte : le SQL (deploy/close-account/close-account.sql)
# contre une BASE JETABLE, et le tri des clés (delete-keys.sh) contre un VOLUME
# JETABLE. Poste de développement seulement, JAMAIS sur le VPS.
#
#   bash deploy/tests/close-account.test.sh
#
# Prérequis : Docker, et le conteneur Postgres de développement
# (CLOSE_TEST_PG_CONTAINER, défaut linkr-postgres) avec une base migrée
# (CLOSE_TEST_SOURCE_DB, défaut linkr), copiée dans linkr_closeaccount_probe
# puis supprimée. Aucune ligne de la base source n'est modifiée.

set -uo pipefail
export MSYS_NO_PATHCONV=1

PG="${CLOSE_TEST_PG_CONTAINER:-linkr-postgres}"
PGU="${CLOSE_TEST_PG_USER:-linkr}"
SRC_DB="${CLOSE_TEST_SOURCE_DB:-linkr}"
DB=linkr_closeaccount_probe
VOL=linkr_closeaccount_probe_uploads
TOOLVOL=linkr_closeaccount_probe_tool
IMG="${CLOSE_TEST_TOOL_IMAGE:-alpine:3.20}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SQL="$HERE/close-account/close-account.sql"
DEL="$HERE/close-account/delete-keys.sh"

pass=0; fail=0
ok() { pass=$((pass + 1)); echo "ok   $*"; }
ko() { fail=$((fail + 1)); echo "FAIL $*"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else ko "$1 (attendu « $3 », obtenu « $2 »)"; fi; }
contains() { if printf '%s' "$2" | grep -qF -- "$3"; then ok "$1"; else ko "$1 (« $3 » absent)"; fi; }
absent() { if printf '%s' "$2" | grep -qF -- "$3"; then ko "$1 (« $3 » présent)"; else ok "$1"; fi; }

q() { docker exec -i "$PG" psql -X -q -At -v ON_ERROR_STOP=1 -U "$PGU" -d "$DB" -c "$1"; }
close_sql() {  # <uid> <closing> <commit>
  docker exec -i "$PG" psql -X -q -At -U "$PGU" -d "$DB" \
    -v uid="$1" -v closing="$2" -v commit="$3" -f - < "$SQL"
}
cleanup() {
  docker exec "$PG" dropdb -U "$PGU" --if-exists "$DB" >/dev/null 2>&1
  docker volume rm -f "$VOL" "$TOOLVOL" >/dev/null 2>&1
}
trap cleanup EXIT

case "$DB" in *probe*) ;; *) echo "refus : la base de test doit contenir « probe »"; exit 1 ;; esac

echo "== Base jetable ($DB, copie de $SRC_DB)"
cleanup
docker exec "$PG" createdb -U "$PGU" "$DB" || { echo "createdb impossible"; exit 1; }
docker exec "$PG" sh -c "pg_dump -U '$PGU' '$SRC_DB' | psql -q -U '$PGU' -d '$DB'" >/dev/null 2>&1

# Empreinte des données d'AUTRES comptes : elle ne doit jamais bouger.
others_hash() {
  q "SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
       SELECT u.id || coalesce(u.deleted_at_utc::text,'') || coalesce(u.sessions_invalidated_at_utc::text,'') AS x FROM users u WHERE u.id <> '$1'
       UNION ALL SELECT sp.id || coalesce(sp.deleted_at_utc::text,'') FROM service_providers sp WHERE sp.user_id IS DISTINCT FROM '$1'
       UNION ALL SELECT sr.id || sr.status || coalesce(sr.deleted_at_utc::text,'') FROM service_requests sr
       UNION ALL SELECT pm.id || coalesce(pm.deleted_at_utc::text,'') FROM payment_methods pm WHERE pm.owner_user_id IS DISTINCT FROM '$1'
       UNION ALL SELECT pi.id || coalesce(pi.deleted_at_utc::text,'') FROM portfolio_items pi WHERE pi.service_provider_id NOT IN (SELECT id FROM service_providers WHERE user_id = '$1')
     ) t"
}

# ─── T1 : client avec une demande OPEN -> refus, rien modifié ──────────────
OPEN_CLIENT="$(q "SELECT u.id FROM users u WHERE u.deleted_at_utc IS NULL AND u.system_role = 'USER'
  AND EXISTS (SELECT 1 FROM service_requests sr WHERE sr.client_user_id = u.id AND sr.status = 'OPEN' AND sr.deleted_at_utc IS NULL)
  LIMIT 1")"
[ -n "$OPEN_CLIENT" ] || { ko "T1 : aucun client avec une demande OPEN dans la base source"; }
if [ -n "$OPEN_CLIENT" ]; then
  out="$(close_sql "$OPEN_CLIENT" true true)"
  contains "T1 demande OPEN : refus" "$out" "RESULT|REFUSED|activité en cours"
  contains "T1 demande OPEN : ligne de blocage" "$out" "|OPEN (client)"
  absent  "T1 demande OPEN : aucune clé lue" "$out" "KEY|"
  check   "T1 demande OPEN : compte intact" "$(q "SELECT deleted_at_utc IS NULL FROM users WHERE id = '$OPEN_CLIENT'")" "t"
fi

# ─── T2 : prestataire avec un job IN_PROGRESS -> refus ─────────────────────
PROV_ROW="$(q "SELECT sp.id || ' ' || sp.user_id FROM service_providers sp JOIN users u ON u.id = sp.user_id
  WHERE sp.provider_type = 'INDIVIDUAL' AND u.system_role = 'USER' AND u.deleted_at_utc IS NULL
    AND EXISTS (SELECT 1 FROM service_requests sr WHERE sr.assigned_service_provider_id = sp.id AND sr.deleted_at_utc IS NULL)
  LIMIT 1")"
PROV="${PROV_ROW%% *}"; PROV_USER="${PROV_ROW##* }"
if [ -n "$PROV" ]; then
  # Une seule demande de ce prestataire passe en IN_PROGRESS, les autres en PAID :
  # c'est bien IN_PROGRESS, comme prestataire, qui bloque.
  q "UPDATE service_requests SET status = 'PAID' WHERE assigned_service_provider_id = '$PROV' OR requested_service_provider_id = '$PROV' OR client_user_id = '$PROV_USER'" >/dev/null
  q "UPDATE service_requests SET status = 'IN_PROGRESS' WHERE id = (SELECT id FROM service_requests WHERE assigned_service_provider_id = '$PROV' AND client_user_id <> '$PROV_USER' LIMIT 1)" >/dev/null
  q "UPDATE payments SET status = 'SUCCEEDED' WHERE status IN ('PENDING','PROCESSING','REQUIRES_ACTION') AND (payer_user_id = '$PROV_USER' OR recipient_service_provider_id = '$PROV')" >/dev/null
  q "UPDATE quotes SET status = 'WITHDRAWN' WHERE status = 'SUBMITTED' AND service_provider_id = '$PROV'" >/dev/null
  out="$(close_sql "$PROV_USER" true true)"
  contains "T2 IN_PROGRESS prestataire : refus" "$out" "RESULT|REFUSED|activité en cours"
  contains "T2 IN_PROGRESS prestataire : ligne de blocage" "$out" "|IN_PROGRESS (prestataire)"
  check    "T2 IN_PROGRESS prestataire : profil intact" "$(q "SELECT deleted_at_utc IS NULL FROM service_providers WHERE id = '$PROV'")" "t"
else
  ko "T2 : aucun prestataire avec un job dans la base source"
fi

# ─── Compte propre fabriqué : client + prestataire + photos + pièce + carte ─
SRC_USER="$(q "SELECT id FROM users WHERE system_role = 'USER' AND deleted_at_utc IS NULL LIMIT 1")"
SRC_SP="$(q "SELECT id FROM service_providers WHERE provider_type = 'INDIVIDUAL' LIMIT 1")"
SRC_PI="$(q "SELECT id FROM portfolio_items LIMIT 1")"
SRC_PSC="$(q "SELECT professional_service_category_id FROM verification_documents LIMIT 1")"
SRC_VD="$(q "SELECT id FROM verification_documents LIMIT 1")"
SRC_PM="$(q "SELECT id FROM payment_methods WHERE owner_user_id IS NOT NULL LIMIT 1")"
SRC_SCA="$(q "SELECT id FROM stripe_connect_accounts LIMIT 1")"
U=11111111-1111-4111-8111-111111111111
SP=22222222-2222-4222-8222-222222222222
PSC=33333333-3333-4333-8333-333333333333
K1="portfolio/$SP/44444444-4444-4444-8444-444444444441.webp"
K2="verifications/$PSC/44444444-4444-4444-8444-444444444442.pdf"
fixture() {
  q "CREATE TEMP TABLE t AS SELECT * FROM $1 WHERE id = '$2'; UPDATE t SET $3; INSERT INTO $1 SELECT * FROM t;" >/dev/null \
    || ko "fixture $1"
}
fixture users "$SRC_USER" "id = '$U', email = 'probe-close@linkr.test', stripe_customer_id = 'cus_probe_close', system_role = 'USER', deleted_at_utc = NULL"
fixture service_providers "$SRC_SP" "id = '$SP', user_id = '$U', deleted_at_utc = NULL, is_active = true"
fixture portfolio_items "$SRC_PI" "id = '55555555-5555-4555-8555-555555555551', service_provider_id = '$SP', storage_key = '$K1', deleted_at_utc = NULL"
# Clé piégée en base : remontée de chemin -> BADKEY, jamais transmise.
fixture portfolio_items "$SRC_PI" "id = '55555555-5555-4555-8555-555555555552', service_provider_id = '$SP', storage_key = 'portfolio/$SP/../../sentinel', deleted_at_utc = NULL"
# Clé d'un AUTRE prestataire posée sur ce compte : préfixe qui ne correspond pas -> BADKEY.
fixture portfolio_items "$SRC_PI" "id = '55555555-5555-4555-8555-555555555553', service_provider_id = '$SP', storage_key = 'portfolio/$SRC_SP/44444444-4444-4444-8444-444444444443.webp', deleted_at_utc = NULL"
fixture professional_service_categories "$SRC_PSC" "id = '$PSC', service_provider_id = '$SP', deleted_at_utc = NULL"
fixture verification_documents "$SRC_VD" "id = '66666666-6666-4666-8666-666666666661', professional_service_category_id = '$PSC', file_url = '$K2', deleted_at_utc = NULL"
fixture payment_methods "$SRC_PM" "id = '77777777-7777-4777-8777-777777777771', owner_user_id = '$U', owner_organization_id = NULL, stripe_payment_method_id = 'pm_probe_close', deleted_at_utc = NULL"
fixture stripe_connect_accounts "$SRC_SCA" "id = '88888888-8888-4888-8888-888888888881', service_provider_id = '$SP', stripe_account_id = 'acct_probe_close'"

# Mandat L1 : un lien de confirmation encore valide, consommé à la fermeture.
q "INSERT INTO email_verification_tokens (user_id, token_hash, email, expires_at_utc) VALUES ('$U', 'probe-close-verif', 'probe-close@linkr.test', now() + interval '1 day')" >/dev/null || ko "fixture email_verification_tokens"
BEFORE="$(others_hash "$U")"

# ─── T3a : étape 0 lecture seule, puis étape 1 ANNULÉE ─────────────────────
out="$(close_sql "$U" false false)"
contains "T3 étape 0 : vérifié" "$out" "RESULT|CHECKED"
absent   "T3 étape 0 : aucune clé lue en lecture seule" "$out" "KEY|"
out="$(close_sql "$U" true false)"
contains "T3 simulation : annulée" "$out" "RESULT|ROLLED_BACK"
check    "T3 simulation : compte intact" "$(q "SELECT deleted_at_utc IS NULL FROM users WHERE id = '$U'")" "t"
check    "T3 simulation : profil intact" "$(q "SELECT deleted_at_utc IS NULL FROM service_providers WHERE id = '$SP'")" "t"

# ─── T3b : COMMIT ──────────────────────────────────────────────────────────
out="$(close_sql "$U" true true)"
contains "T3 COMMIT : validé" "$out" "RESULT|COMMITTED"
check    "T3 COMMIT : exactement 2 clés valides" "$(printf '%s\n' "$out" | grep -c '^KEY|')" "2"
contains "T3 COMMIT : photo" "$out" "KEY|$K1"
contains "T3 COMMIT : pièce de vérification" "$out" "KEY|$K2"
check    "T3 COMMIT : 2 clés refusées (remontée, autre prestataire)" "$(printf '%s\n' "$out" | grep -c '^BADKEY|')" "2"
absent   "T3 COMMIT : la clé piégée n'est jamais affichée" "$out" "sentinel"
check    "T3 COMMIT : 3 identifiants Stripe" "$(printf '%s\n' "$out" | grep -c '^STRIPE|')" "3"
check    "T3 compte masqué + sessions invalidées" "$(q "SELECT deleted_at_utc IS NOT NULL AND sessions_invalidated_at_utc >= deleted_at_utc - interval '1 second' FROM users WHERE id = '$U'")" "t"
check    "T3 prestataire masqué" "$(q "SELECT deleted_at_utc IS NOT NULL FROM service_providers WHERE id = '$SP'")" "t"
check    "T3 photos masquées" "$(q "SELECT count(*) FROM portfolio_items WHERE service_provider_id = '$SP' AND deleted_at_utc IS NULL")" "0"
check    "T3 pièce masquée" "$(q "SELECT deleted_at_utc IS NOT NULL FROM verification_documents WHERE id = '66666666-6666-4666-8666-666666666661'")" "t"
contains "T3 COMMIT : 1 jeton de confirmation consommé" "$out" "PLAN|jetons_confirmation|1"
check    "T3 lien de confirmation consommé" "$(q "SELECT consumed_at_utc IS NOT NULL FROM email_verification_tokens WHERE token_hash = 'probe-close-verif'")" "t"
check    "T3 carte masquée" "$(q "SELECT deleted_at_utc IS NOT NULL FROM payment_methods WHERE id = '77777777-7777-4777-8777-777777777771'")" "t"
check    "T3 aucune ligne détruite" "$(q "SELECT count(*) FROM users WHERE id = '$U'")" "1"
check    "T3 données des autres comptes intactes" "$(others_hash "$U")" "$BEFORE"
out="$(close_sql "$U" true true)"
contains "T3 deuxième passage : refus (déjà fermé)" "$out" "RESULT|REFUSED|aucun compte actif"

# ─── T4 : compte ADMIN -> refus ────────────────────────────────────────────
ADMIN="$(q "SELECT id FROM users WHERE system_role = 'ADMIN' AND deleted_at_utc IS NULL LIMIT 1")"
if [ -n "$ADMIN" ]; then
  out="$(close_sql "$ADMIN" true true)"
  contains "T4 ADMIN : refus" "$out" "RESULT|REFUSED|compte administrateur"
fi

# ─── T5 : tri des clés dans un conteneur sans réseau ───────────────────────
OTHER="portfolio/$SRC_SP/44444444-4444-4444-8444-444444444443.webp"
LINKED="portfolio/99999999-9999-4999-8999-999999999999/44444444-4444-4444-8444-444444444444.webp"
docker volume create "$VOL" >/dev/null
docker volume create "$TOOLVOL" >/dev/null
docker run --rm -v "$VOL:/data" "$IMG" sh -c "
  mkdir -p /data/portfolio/$SP /data/verifications/$PSC /data/portfolio/$SRC_SP /data/elsewhere /data/service-request-attachments/$SP &&
  echo a > /data/$K1 && echo b > /data/$K2 && echo c > /data/$OTHER && echo s > /data/sentinel &&
  echo e > /data/elsewhere/44444444-4444-4444-8444-444444444444.webp &&
  echo j > /data/service-request-attachments/$SP/44444444-4444-4444-8444-444444444445.jpg &&
  ln -s /data/elsewhere /data/portfolio/99999999-9999-4999-8999-999999999999 &&
  chown -R 1000:1000 /data"
{
  printf '%s\n' "$K1" "$K2" \
    "../sentinel" "portfolio/$SP/../../sentinel" "/data/sentinel" \
    "unknown/$SP/44444444-4444-4444-8444-444444444446.webp" \
    "service-request-attachments/$SP/44444444-4444-4444-8444-444444444445.jpg" \
    "$LINKED" "portfolio/$SP/44444444-4444-4444-8444-444444444447.webp" "PORTFOLIO/$SP/x.webp"
} | docker run --rm -i -v "$TOOLVOL:/t" "$IMG" sh -c 'cat > /t/keys.txt'
docker run --rm -i -v "$TOOLVOL:/t" "$IMG" sh -c 'cat > /t/delete-keys.sh' < "$DEL"

files() {  # <mode>
  docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
    --user 1000:1000 -v "$VOL:/data" -v "$TOOLVOL:/t:ro" "$IMG" sh /t/delete-keys.sh /t/keys.txt /data "$1"
}
listing() { docker run --rm -v "$VOL:/data:ro" "$IMG" sh -c 'cd /data && find . -type f | sort'; }

out="$(files --dry-run)"; code=$?
check    "T5 simulation : code 0" "$code" "0"
contains "T5 simulation : 2 à supprimer, 1 absent, 7 refusées" "$out" "a_supprimer=2|absents=1|refusees=7|supprimes=0"
absent   "T5 simulation : aucune clé affichée" "$out" "sentinel"
check    "T5 simulation : rien supprimé" "$(listing | wc -l | tr -d ' ')" "6"

out="$(files --delete)"; code=$?
check    "T5 suppression : code 0" "$code" "0"
contains "T5 suppression : 2 supprimés, 7 refusées" "$out" "refusees=7|supprimes=2|echecs=0"
left="$(listing)"
absent   "T5 photo supprimée" "$left" "$K1"
absent   "T5 pièce supprimée" "$left" "$K2"
contains "T5 fichier hors volume intact" "$left" "./sentinel"
contains "T5 fichier d'un autre prestataire intact" "$left" "$OTHER"
contains "T5 cible d'un lien symbolique intacte" "$left" "./elsewhere/44444444-4444-4444-8444-444444444444.webp"
contains "T5 pièce jointe de demande intacte" "$left" "service-request-attachments/$SP/"
out="$(files --delete)"
contains "T5 relance : rien de plus" "$out" "a_supprimer=0|absents=3|refusees=7|supprimes=0"

echo
echo "$pass ok, $fail échec(s)"
[ "$fail" -eq 0 ]
