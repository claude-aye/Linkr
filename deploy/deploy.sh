#!/usr/bin/env bash
# Mise à jour de Linkr en production (PR D4). Copié sur le VPS : /opt/linkr/deploy.sh
#
#   ./deploy.sh <SHA>     SHA complet (40 caractères hexadécimaux, minuscules)
#
# Le tag est toujours un SHA explicite, jamais `latest`.
#
# Déroulement : verrou -> pull des images (rien n'est touché si le tag est absent
# de GHCR) -> sauvegarde (si elle échoue, ARRÊT, rien n'est modifié) -> nouveau
# IMAGE_TAG dans .env -> migrations -> up -d -> attente que api et web soient
# healthy -> sinon retour à l'ancien tag.
#
# ⚠️ LE RETOUR ARRIÈRE NE DÉFAIT QUE L'IMAGE, PAS LA BASE. Une migration déjà
# appliquée reste appliquée. Si `migrate` échoue, la base peut être partiellement
# migrée : le script remet l'ancien tag et s'arrête, sans rien défaire d'autre.
# Pour revenir en arrière côté base : migration:revert explicite après lecture
# du down(), ou restauration de la sauvegarde (docs/deploy/production.md).
#
# Si deploy/compose.yaml ou deploy/Caddyfile ont changé, les recopier (scp)
# AVANT de lancer ce script.
#
# Variables facultatives : LINKR_DIR (défaut /opt/linkr), WAIT_TIMEOUT
# (secondes, défaut 180). Le script n'affiche jamais le contenu de .env.

set -euo pipefail

LINKR_DIR="${LINKR_DIR:-/opt/linkr}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-180}"
WAIT_INTERVAL="${WAIT_INTERVAL:-3}"

log() { echo "$(date -u +%FT%TZ) $*"; }
die() { log "ERREUR: $*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage : ./deploy.sh <SHA>

  SHA   identifiant complet du commit publié dans GHCR (40 caractères
        hexadécimaux minuscules). `latest` et les SHA courts sont refusés.

Le retour arrière automatique ne défait QUE l'image (IMAGE_TAG). Il ne défait
JAMAIS la base : une migration appliquée reste appliquée.
USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then usage; exit 0; fi
[ "$#" -eq 1 ] || { usage >&2; exit 2; }
NEW_TAG="$1"
if ! [[ "$NEW_TAG" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERREUR: '$NEW_TAG' n'est pas un SHA complet (40 caractères hexadécimaux minuscules)." >&2
  exit 2
fi

cd "$LINKR_DIR"
[ -f .env ] || die ".env introuvable dans $LINKR_DIR"

# Verrou : un seul déploiement à la fois.
exec 9>"$LINKR_DIR/.deploy.lock"
flock -n 9 || die "un autre déploiement est en cours"

current_tag() { grep -E '^IMAGE_TAG=' .env | tail -n 1 | cut -d= -f2- || true; }

write_tag() {  # $1 = tag ; ne touche qu'à la ligne IMAGE_TAG
  if grep -qE '^IMAGE_TAG=' .env; then
    sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" .env
  else
    printf 'IMAGE_TAG=%s\n' "$1" >> .env
  fi
  [ "$(current_tag)" = "$1" ] || die "impossible d'écrire IMAGE_TAG dans .env"
}

OLD_TAG="$(current_tag)"
log "Tag actuel : ${OLD_TAG:-<aucun>} ; nouveau tag : $NEW_TAG"

# 2. Le tag existe-t-il dans GHCR ? Rien n'est modifié tant que le pull n'a pas
#    réussi (la variable d'environnement prime sur .env pour Compose).
#    Seules api et web sont tirées : migrate utilise l'image de l'api, et les
#    images tierces (postgres, redis, caddy) ne changent pas à chaque déploiement.
log "Téléchargement des images..."
IMAGE_TAG="$NEW_TAG" docker compose pull api web \
  || die "pull impossible : le tag $NEW_TAG existe-t-il dans GHCR (docker login ghcr.io fait) ? Rien n'a été modifié."

# 3. Sauvegarde obligatoire avant toute modification.
log "Sauvegarde avant déploiement..."
"$LINKR_DIR/backup/backup.sh" \
  || die "la sauvegarde a échoué. ARRÊT : rien n'a été modifié."

# 4. Nouveau tag + migrations.
cp -p .env .env.bak
chmod 600 .env.bak
write_tag "$NEW_TAG"

rollback_image() {
  if [ -z "$OLD_TAG" ]; then
    log "Aucun ancien tag à rétablir (premier déploiement ?)."
    return 1
  fi
  log "Retour à l'ancienne image $OLD_TAG (la base n'est PAS défaite)..."
  write_tag "$OLD_TAG"
}

log "Migrations..."
if ! docker compose --profile tools run --rm migrate; then
  rollback_image || true
  {
    echo
    echo "ERREUR: les migrations ont échoué. L'ancien IMAGE_TAG est rétabli dans .env, rien n'est redémarré."
    echo "La base peut être PARTIELLEMENT migrée : rien n'a été défait automatiquement."
    echo "Lire la sortie ci-dessus, puis décider (migration:revert après lecture du down(), ou restauration de la sauvegarde)."
  } >&2
  exit 1
fi

# 5. Démarrage et attente de la santé.
health_of() {  # $1 = service
  local id
  id="$(docker compose ps -q "$1" 2>/dev/null | head -n 1)"
  if [ -z "$id" ]; then echo absent; return; fi
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo inconnu
}

wait_healthy() {
  local waited=0 api web
  while :; do
    api="$(health_of api)"; web="$(health_of web)"
    if [ "$api" = healthy ] && [ "$web" = healthy ]; then return 0; fi
    if [ "$waited" -ge "$WAIT_TIMEOUT" ]; then
      log "Délai dépassé (${WAIT_TIMEOUT}s) : api=$api web=$web"
      return 1
    fi
    sleep "$WAIT_INTERVAL"
    waited=$((waited + WAIT_INTERVAL))
  done
}

log "Démarrage..."
ok=1
# `up -d` échoue lui-même si une dépendance (healthy) ne le devient pas.
docker compose up -d || ok=0
if [ "$ok" -eq 1 ]; then
  log "Attente de la santé de api et web (max ${WAIT_TIMEOUT}s)..."
  wait_healthy || ok=0
fi

# 6. Échec : retour à l'ancienne image.
if [ "$ok" -eq 0 ]; then
  echo "ERREUR: la nouvelle version n'est pas saine." >&2
  if rollback_image; then
    docker compose up -d || true
  fi
  echo >&2
  docker compose ps >&2 || true
  echo >&2
  echo "Retour arrière : image seulement. La base reste migrée." >&2
  exit 1
fi

log "Déploiement terminé : $NEW_TAG"
docker compose ps
