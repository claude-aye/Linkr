#!/usr/bin/env bash
# Banc de l'arrêt d'urgence (mandat E) : Caddyfile de production, upstreams factices.
# Usage : bash deploy/tests/arret-urgence.test.sh   (Docker requis)
set -uo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
NET=linkr-arret-test; WORK="$(mktemp -d -p "$PWD/tests" .arret.XXXXXX)"; FLAGS="$WORK/flags"; CONF="$WORK/conf"; mkdir "$FLAGS" "$CONF"; FAIL=0
cleanup() { docker rm -f arret-web arret-api arret-caddy >/dev/null 2>&1; docker network rm $NET >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT
chk() { # libellé attendu réel
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1 (attendu $2, reçu $3)"; FAIL=1; fi; }
# Caddyfile de production, seul le bloc global change (HTTPS interne, sans ACME).
sed 's/email {\$ACME_EMAIL}/local_certs/' Caddyfile > "$CONF/Caddyfile"
docker network create $NET >/dev/null
stub() { docker run -d --name "arret-$1" --network $NET --network-alias "$1" node:22-bookworm-slim node -e \
  "require('http').createServer((q,r)=>{r.end('$2 '+q.method+' '+q.url)}).listen($3)" >/dev/null; }
stub web WEB 3001; stub api API 5000
docker run -d --name arret-caddy --network $NET -p 18443:443 -v "$CONF/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$FLAGS:/etc/caddy/flags:ro" caddy:2.10-alpine >/dev/null
sleep 6
req() { # méthode chemin -> "code|corps"
  local o nl=$'\n'
  o="$(curl -sk --resolve linkrapp.com:18443:127.0.0.1 -X "$1" -w "${nl}%{http_code}" "https://linkrapp.com:18443$2")"
  printf '%s|%s' "${o##*$nl}" "${o%$nl*}"; }
code() { local r; r="$(req "$1" "$2")"; printf "%s" "${r%%|*}"; }
body() { local r; r="$(req "$1" "$2")"; printf "%s" "${r#*|}"; }

echo "--- aucun drapeau"
chk "GET /"                200 "$(code GET /)"
chk "GET /signup"          200 "$(code GET /signup)"
chk "POST /api/auth/signup" 200 "$(code POST /api/auth/signup)"
chk "webhook"              200 "$(code POST /webhooks/stripe)"
chk "webhook -> api"       "API POST /webhooks/stripe" "$(body POST /webhooks/stripe)"

echo "--- signups-closed posé"
touch "$FLAGS/signups-closed"
chk "GET /signup 503"           503 "$(code GET /signup)"
chk "POST /api/auth/signup 503" 503 "$(code POST /api/auth/signup)"
case "$(body GET /signup)" in *"Inscriptions temporairement fermées"*) chk "page FR" a a;; *) chk "page FR" a b;; esac
case "$(body POST /api/auth/signup)" in *"temporairement fermées"*) chk "json FR" a a;; *) chk "json FR" a b;; esac
chk "GET / inchangé"            200 "$(code GET /)"
chk "POST /api/auth/signup/ 503" 503 "$(code POST /api/auth/signup/)"
chk "GET /SIGNUP 503" 503 "$(code GET /SIGNUP)"
chk "GET /login inchangé"       200 "$(code GET /login)"
chk "POST /api/auth/login inchangé" 200 "$(code POST /api/auth/login)"
chk "webhook inchangé"          200 "$(code POST /webhooks/stripe)"

echo "--- signups-closed retiré"
rm "$FLAGS/signups-closed"
chk "GET /signup"           200 "$(code GET /signup)"
chk "POST /api/auth/signup" 200 "$(code POST /api/auth/signup)"

echo "--- maintenance posée"
touch "$FLAGS/maintenance"
for p in / /login /signup /recherche /api/auth/login /robots.txt; do chk "GET $p 503" 503 "$(code GET $p)"; done
chk "POST /api/auth/signup 503" 503 "$(code POST /api/auth/signup)"
chk "webhook joignable"  200 "$(code POST /webhooks/stripe)"
chk "webhook -> api"     "API POST /webhooks/stripe" "$(body POST /webhooks/stripe)"
chk "GET /webhooks/stripe (pas POST) 503" 503 "$(code GET /webhooks/stripe)"
case "$(body GET /)" in *"Linkr est en maintenance"*) chk "page FR" a a;; *) chk "page FR" a b;; esac

echo "--- les deux drapeaux, puis retrait"
touch "$FLAGS/signups-closed"; chk "maintenance prime" 503 "$(code GET /signup)"
rm "$FLAGS/maintenance" "$FLAGS/signups-closed"
chk "GET / retour" 200 "$(code GET /)"
chk "GET /signup retour" 200 "$(code GET /signup)"
chk "webhook retour" 200 "$(code POST /webhooks/stripe)"
[ $FAIL = 0 ] && echo "TOUT VERT" || { echo "ÉCHECS"; docker logs arret-caddy 2>&1 | tail -15; exit 1; }
