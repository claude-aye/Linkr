#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR=/opt/linkr/backup
BUCKET=ovh:linkr-backups-prod
RETENTION=14d
RCLONE="rclone --config $BACKUP_DIR/rclone.conf"
RECIPIENT="$BACKUP_DIR/age-recipient.txt"

cd /opt/linkr
set -a; . ./.env; set +a   # POSTGRES_USER, POSTGRES_DB

TS=$(date -u +%Y%m%dT%H%M%SZ)
TMP=$(mktemp -d "$BACKUP_DIR/tmp.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

log() { echo "$(date -u +%FT%TZ) $*"; }

upload() {  # $1 = fichier local, $2 = destination distante
  local size remote
  size=$(stat -c %s "$1")
  [ "$size" -gt 100 ] || { log "ERREUR: $1 trop petit ($size o)"; exit 1; }
  $RCLONE copyto "$1" "$2"
  remote=$($RCLONE ls "${2%/*}" --include "${2##*/}" | awk '{print $1}')
  [ "$remote" = "$size" ] || { log "ERREUR: taille distante '$remote' != $size"; exit 1; }
  log "OK $2 ($size o)"
}

log "Début de la sauvegarde $TS"

docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" \
  | age -R "$RECIPIENT" > "$TMP/db.dump.age"

docker run --rm -v linkr_uploads:/data:ro alpine:3 tar -C /data -czf - . \
  | age -R "$RECIPIENT" > "$TMP/uploads.tar.gz.age"

upload "$TMP/db.dump.age"          "$BUCKET/db/linkr-db-$TS.dump.age"
upload "$TMP/uploads.tar.gz.age"   "$BUCKET/uploads/linkr-uploads-$TS.tar.gz.age"

$RCLONE delete "$BUCKET/db"      --min-age "$RETENTION"
$RCLONE delete "$BUCKET/uploads" --min-age "$RETENTION"

log "Sauvegarde terminée"
curl -fsS -m 10 --retry 3 "$(cat "$BACKUP_DIR/healthcheck.url")" > /dev/null \
  || log "AVERTISSEMENT: signal Healthchecks non envoyé"
