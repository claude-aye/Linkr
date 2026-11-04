#!/usr/bin/env bash
# Purge des comptes e2e (mode A). Copié sur le VPS : /opt/linkr/purge.sh
#
#   ./purge.sh             SIMULATION (par défaut) : affiche le plan, n'écrit rien
#   ./purge.sh --execute   verrou -> sauvegarde -> plan -> phrase tapée -> transaction
#
# ⚠️ Lancé À LA MAIN, jamais par une tâche planifiée ni par un agent.
# Le conteneur `purge` n'a ni accès Internet ni clé Stripe : la liste des
# identifiants Stripe est écrite dans purge-out/ et se traite À LA MAIN.
# Mode d'emploi : docs/deploy/purge.md.
#
# Variables facultatives : LINKR_DIR (défaut /opt/linkr). Le script n'affiche
# jamais le contenu de .env.

set -euo pipefail

LINKR_DIR="${LINKR_DIR:-/opt/linkr}"
OUT_DIR="$LINKR_DIR/purge-out"
CONTAINER_UID=1000   # utilisateur `node` de l'image API

log() { echo "$(date -u +%FT%TZ) $*"; }
die() { log "ERREUR: $*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage : ./purge.sh [--execute]

  (sans argument)  simulation : comptes visés, lignes par table, fichiers,
                   identifiants Stripe, empreinte. Rien n'est écrit.
  --execute        sauvegarde, puis la phrase « PURGER E2E <n> COMPTES <empreinte> »
                   à taper à la main, puis une seule transaction.
USAGE
}

EXECUTE=0
case "${1:-}" in
  "") ;;
  --execute) EXECUTE=1 ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { usage >&2; exit 2; }

cd "$LINKR_DIR"
[ -f .env ] || die ".env introuvable dans $LINKR_DIR"
grep -qE '^PURGE_DATABASE_URL=.+' .env || die "PURGE_DATABASE_URL absente de .env (rôle linkr_purge, docs/deploy/purge.md)"

# Même verrou que deploy.sh : jamais une purge pendant un déploiement.
exec 9>"$LINKR_DIR/.deploy.lock"
flock -n 9 || die "un déploiement ou une purge est en cours"

mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"
[ "$(stat -c %u "$OUT_DIR")" = "$CONTAINER_UID" ] \
  || die "$OUT_DIR doit appartenir à l'uid $CONTAINER_UID (sudo chown $CONTAINER_UID:$CONTAINER_UID $OUT_DIR)"

run_purge() {  # arguments passés au script ; PURGE_CONFIRM hérité de l'environnement
  docker compose --profile tools run --rm -T purge "$@"
}

if [ "$EXECUTE" -eq 0 ]; then
  run_purge
  exit $?
fi

# 1. Sauvegarde obligatoire : si elle échoue, ARRÊT, rien n'est touché.
log "Sauvegarde avant purge..."
"$LINKR_DIR/backup/backup.sh" || die "la sauvegarde a échoué. ARRÊT : rien n'a été modifié."

# 2. Plan (simulation), affiché à l'opérateur.
log "Plan de purge..."
set +e
PLAN="$(run_purge)"
code=$?
set -e
printf '%s\n' "$PLAN"
[ "$code" -eq 0 ] || die "simulation en échec ou purge bloquée (code $code) : rien n'a été modifié."
EXPECTED="$(printf '%s\n' "$PLAN" | sed -n 's/^PURGE_PHRASE=//p' | tail -n 1)"
[ -n "$EXPECTED" ] || { log "Rien à purger."; exit 0; }

# 3. Phrase tapée à la main (jamais lue d'un fichier ni d'une variable).
echo
read -r -p "Phrase de confirmation : " TYPED </dev/tty
[ "$TYPED" = "$EXPECTED" ] || die "phrase différente du plan : rien n'a été modifié."

# 4. Exécution : le script recalcule le plan sous verrou et refuse si
#    l'empreinte a changé depuis la simulation.
log "Exécution..."
export PURGE_CONFIRM="$TYPED"   # interpolé par compose dans le service purge
run_purge --execute
log "Purge terminée. Traiter la liste Stripe à la main (docs/deploy/purge.md), puis la détruire."
