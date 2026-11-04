#!/usr/bin/env bash
# Banc de deploy/purge.sh : codes de sortie relayés, libellés, témoin de
# sauvegarde effacé à la sortie. Faux `docker` et fausse sauvegarde : rien ne
# touche une base, un volume ni le réseau.
#
# À lancer dans un conteneur Linux jetable (flock et stat -c y sont), en root :
#   docker run --rm -v "$PWD/deploy:/deploy:ro" debian:bookworm-slim bash /deploy/tests/purge-sh.test.sh
# Jamais sur le VPS.

set -uo pipefail

SRC="${PURGE_SH:-/deploy/purge.sh}"
pass=0
fail=0
ok() { pass=$((pass + 1)); echo "ok   $*"; }
ko() { fail=$((fail + 1)); echo "FAIL $*"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else ko "$1 (attendu « $3 », obtenu « $2 »)"; fi; }
contains() { if printf '%s' "$2" | grep -qF -- "$3"; then ok "$1"; else ko "$1 (« $3 » absent)"; fi; }
absent() { if printf '%s' "$2" | grep -qF -- "$3"; then ko "$1 (« $3 » présent)"; else ok "$1"; fi; }

ROOT="$(mktemp -d)"
LD="$ROOT/linkr"
BIN="$ROOT/bin"
mkdir -p "$LD/backup" "$LD/purge-out" "$BIN"
cp "$SRC" "$LD/purge.sh"
chmod 755 "$LD/purge.sh"
echo 'PURGE_DATABASE_URL=postgresql://linkr_purge:x@postgres:5432/linkr' > "$LD/.env"
chown 1000:1000 "$LD/purge-out"
WITNESS="$LD/purge-out/backup-witness.txt"
CALLS="$ROOT/calls.log"

cat > "$LD/backup/backup.sh" <<'EOF'
#!/usr/bin/env bash
[ "${FAKE_BACKUP_FAIL:-0}" = 1 ] && { echo "ERREUR: sauvegarde simulée en échec"; exit 1; }
echo "OK ovh:linkr-backups-prod/db/linkr-db-20261104T120000Z.dump.age (4242 o)"
EOF
chmod 755 "$LD/backup/backup.sh"

# Faux docker : `docker compose --profile tools run --rm -T purge [--execute]`.
cat > "$BIN/docker" <<EOF
#!/usr/bin/env bash
w=no; [ -f "$WITNESS" ] && w=yes
if [ "\${!#}" = "--execute" ]; then
  echo "execute witness=\$w confirm=[\${PURGE_CONFIRM-UNSET}]" >> "$CALLS"
  echo "\${FAKE_EXEC_OUT:-=== EXÉCUTION ===}"
  exit "\${FAKE_EXEC_CODE:-0}"
fi
echo "simulate witness=\$w" >> "$CALLS"
echo "=== SIMULATION — rien n’est écrit ==="
exit "\${FAKE_SIM_CODE:-0}"
EOF
chmod 755 "$BIN/docker"

run() {  # $@ = arguments de purge.sh ; sortie dans OUT, code dans CODE
  : > "$CALLS"
  OUT="$(cd "$LD" && env PATH="$BIN:$PATH" LINKR_DIR="$LD" "$LD/purge.sh" "$@" 2>&1)"
  CODE=$?
}
stale() { printf '2026-11-04T12:00:00Z linkr-db-20261104T120000Z.dump.age\n' > "$WITNESS"; }

echo "== Simulation (sans --execute) : codes relayés (M-a) =="
for c in 0 2 3; do
  stale
  FAKE_SIM_CODE=$c run
  check "simulation code $c relayé" "$CODE" "$c"
  check "simulation code $c : témoin effacé à la sortie (M-b)" "$([ -f "$WITNESS" ] && echo present || echo absent)" absent
done

echo "== --execute : simulation préalable en refus ou bloquée (M-a) =="
for c in 1 2 3; do
  FAKE_SIM_CODE=$c run --execute
  check "--execute, simulation code $c relayé" "$CODE" "$c"
  contains "--execute, simulation code $c : rien modifié" "$OUT" "rien n'a été modifié"
  check "--execute, simulation code $c : aucune exécution" "$(grep -c '^execute' "$CALLS")" 0
  check "--execute, simulation code $c : témoin effacé (M-b)" "$([ -f "$WITNESS" ] && echo present || echo absent)" absent
done

echo "== --execute : codes de l'exécution (I-a) =="
for c in 0 1 2 3 4 5 130 137 143 255; do
  FAKE_SIM_CODE=0 FAKE_EXEC_CODE=$c run --execute
  check "exécution code $c relayé" "$CODE" "$c"
  contains "exécution code $c : le témoin existait pendant l'exécution" "$(cat "$CALLS")" "execute witness=yes"
  contains "exécution code $c : plan vide, phrase vide" "$(cat "$CALLS")" "confirm=[]"
  check "exécution code $c : témoin effacé à la sortie (M-b)" "$([ -f "$WITNESS" ] && echo present || echo absent)" absent
  case "$c" in
    1|2|3) contains "code $c : « aucune transaction validée »" "$OUT" "Échec (code $c) : aucune transaction validée." ;;
    0) contains "code 0 : purge terminée" "$OUT" "Purge terminée." ;;
    4) contains "code 4 : base purgée" "$OUT" "BASE PURGÉE, ÉTAPE FICHIERS INCOMPLÈTE (code 4)" ;;
    5) contains "code 5 : commit incertain" "$OUT" "COMMIT INCERTAIN (code 5)" ;;
    *)
      absent "code $c : jamais « aucune transaction validée »" "$OUT" "aucune transaction validée"
      contains "code $c : état inconnu" "$OUT" "code inattendu ($c) : état inconnu, lire le rapport ci-dessus et vérifier la base avant de relancer"
      ;;
  esac
done

echo "== --execute : sauvegarde en échec =="
stale
FAKE_BACKUP_FAIL=1 run --execute
check "sauvegarde en échec : code 1" "$CODE" 1
check "sauvegarde en échec : docker jamais appelé" "$(wc -l < "$CALLS" | tr -d ' ')" 0
check "sauvegarde en échec : témoin absent (effacé avant, jamais écrit)" "$([ -f "$WITNESS" ] && echo present || echo absent)" absent

echo "== Verrou pris : le témoin d'une purge en cours n'est pas effacé =="
stale
flock "$LD/.deploy.lock" sleep 3 &
holder=$!
sleep 0.5
run --execute
check "verrou pris : code 1" "$CODE" 1
contains "verrou pris : message" "$OUT" "un déploiement ou une purge est en cours"
check "verrou pris : témoin de l'autre purge conservé" "$([ -f "$WITNESS" ] && echo present || echo absent)" present
wait "$holder"
rm -f "$WITNESS"

echo
echo "$pass ok, $fail en échec"
rm -rf "$ROOT"
[ "$fail" -eq 0 ]
