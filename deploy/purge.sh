#!/usr/bin/env bash
# Purge des comptes e2e (mode A). Copié sur le VPS : /opt/linkr/purge.sh
#
#   ./purge.sh             SIMULATION (par défaut) : affiche le plan, n'écrit rien
#   ./purge.sh --execute   verrou -> sauvegarde -> témoin -> plan -> phrase tapée -> transaction
#
# ⚠️ Lancé À LA MAIN, jamais par une tâche planifiée ni par un agent.
# Le conteneur `purge` n'a ni accès Internet ni clé Stripe : la liste des
# identifiants Stripe est écrite dans purge-out/ et se traite À LA MAIN.
# Mode d'emploi : docs/deploy/purge.md.
#
# Codes de sortie relayés depuis le conteneur : 0 terminé · 1 erreur, aucune
# transaction validée · 2 refus · 3 purge bloquée · 4 BASE PURGÉE, étape
# fichiers incomplète · 5 état du COMMIT incertain · tout autre code : état
# inconnu (conteneur tué ou interrompu). En --execute, la simulation préalable
# relaie aussi son code (2, 3) sans rien modifier. Le témoin de sauvegarde est
# effacé à la sortie, succès ou échec.
#
# Variables facultatives : LINKR_DIR (défaut /opt/linkr). Le script n'affiche
# jamais le contenu de .env.

set -euo pipefail

LINKR_DIR="${LINKR_DIR:-/opt/linkr}"
OUT_DIR="$LINKR_DIR/purge-out"
WITNESS="$OUT_DIR/backup-witness.txt"
CONTAINER_UID=1000   # utilisateur `node` de l'image API

log() { echo "$(date -u +%FT%TZ) $*"; }
die() { log "ERREUR: $*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage : ./purge.sh [--execute]

  (sans argument)  simulation : comptes visés, lignes par table, fichiers,
                   identifiants Stripe, empreinte. Rien n'est écrit.
  --execute        sauvegarde, témoin de sauvegarde, puis la phrase
                   « PURGER E2E <n> COMPTES <empreinte> » à taper à la main,
                   puis une seule transaction. Plan vide : seulement la
                   reprise des fichiers restants, sans phrase.
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

# Le témoin de sauvegarde ne survit jamais à ce script, succès ou échec (M-b) :
# un témoin resté en place laisserait passer, pendant 15 minutes, un
# « docker compose run purge --execute » lancé à la main. Posé APRÈS le verrou :
# un second lancement refusé par flock ne doit pas effacer le témoin d'une purge
# en cours.
BACKUP_LOG=""
trap 'rm -f "$WITNESS" ${BACKUP_LOG:+"$BACKUP_LOG"}' EXIT

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
#    Sa sortie est affichée et lue pour retrouver le nom de la sauvegarde.
log "Sauvegarde avant purge..."
rm -f "$WITNESS"
BACKUP_LOG="$(mktemp)"
if ! "$LINKR_DIR/backup/backup.sh" 2>&1 | tee "$BACKUP_LOG"; then
  die "la sauvegarde a échoué. ARRÊT : rien n'a été modifié."
fi
BACKUP_NAME="$(grep -oE 'linkr-db-[0-9]{8}T[0-9]{6}Z\.dump\.age' "$BACKUP_LOG" | tail -n 1 || true)"
[ -n "$BACKUP_NAME" ] || die "nom de la sauvegarde introuvable dans sa sortie. ARRÊT : rien n'a été modifié."

# 2. Témoin lu par le conteneur (refus de --execute s'il a plus de 15 minutes).
#    Garde-fou contre l'oubli de la sauvegarde, PAS contre un agent ou une
#    personne qui a un shell sur ce serveur.
( umask 022; printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BACKUP_NAME" > "$WITNESS" )
log "Témoin de sauvegarde écrit : $BACKUP_NAME"

# 3. Plan (simulation), affiché à l'opérateur.
log "Plan de purge..."
set +e
PLAN="$(run_purge)"
code=$?
set -e
printf '%s\n' "$PLAN"
if [ "$code" -ne 0 ]; then
  # Code relayé tel quel (M-a) : 2 refus, 3 purge bloquée, 1 erreur.
  log "ERREUR: simulation en échec, refus ou purge bloquée (code $code) : rien n'a été modifié." >&2
  exit "$code"
fi
EXPECTED="$(printf '%s\n' "$PLAN" | sed -n 's/^PURGE_PHRASE=//p' | tail -n 1)"

if [ -z "$EXPECTED" ]; then
  # Plan vide : pas de phrase, seulement la reprise des fichiers restants
  # (le script ne supprime que des fichiers sans ligne en base).
  log "Rien à purger en base : reprise des fichiers restants."
  export PURGE_CONFIRM=""
else
  # 4. Phrase tapée à la main (jamais lue d'un fichier ni d'une variable).
  echo
  read -r -p "Phrase de confirmation : " TYPED </dev/tty
  [ "$TYPED" = "$EXPECTED" ] || die "phrase différente du plan : rien n'a été modifié."
  export PURGE_CONFIRM="$TYPED"   # interpolé par compose dans le service purge
fi

# 5. Exécution : le script recalcule le plan sous verrou et refuse si
#    l'empreinte a changé depuis la simulation. Son rapport n'est pas capturé :
#    il s'affiche tel quel, y compris en cas d'échec après le COMMIT.
log "Exécution..."
set +e
run_purge --execute
code=$?
set -e
case "$code" in
  0) log "Purge terminée. Traiter la liste Stripe à la main (docs/deploy/purge.md), puis la détruire." ;;
  4) log "BASE PURGÉE, ÉTAPE FICHIERS INCOMPLÈTE (code 4) : lire le rapport ci-dessus avant toute relance." ;;
  5) log "État du COMMIT INCERTAIN (code 5) : vérifier la base, conserver la liste Stripe .pending." ;;
  1|2|3) log "Échec (code $code) : aucune transaction validée." ;;
  # Tout autre code (130, 137, 143, 255…) : conteneur tué ou interrompu, peut-être
  # APRÈS le COMMIT. Rien ne permet d'affirmer qu'aucune transaction n'a eu lieu.
  *) log "code inattendu ($code) : état inconnu, lire le rapport ci-dessus et vérifier la base avant de relancer." ;;
esac
exit "$code"
