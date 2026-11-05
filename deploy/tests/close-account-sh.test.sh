#!/usr/bin/env bash
# Banc de deploy/close-account.sh : ordre des étapes, refus, phrases, codes de
# sortie, fichiers temporaires détruits. Faux `docker` et fausse sauvegarde :
# rien ne touche une base, un volume ni le réseau.
#
# À lancer dans un conteneur Linux jetable (flock, script et stat y sont), en root :
#   docker run --rm -v "$PWD/deploy:/deploy:ro" debian:bookworm-slim bash /deploy/tests/close-account-sh.test.sh
# Jamais sur le VPS.

set -uo pipefail

SRC="${CLOSE_SH:-/deploy/close-account.sh}"
pass=0; fail=0
ok() { pass=$((pass + 1)); echo "ok   $*"; }
ko() { fail=$((fail + 1)); echo "FAIL $*"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else ko "$1 (attendu « $3 », obtenu « $2 »)"; fi; }
contains() { if printf '%s' "$2" | grep -qF -- "$3"; then ok "$1"; else ko "$1 (« $3 » absent)"; fi; }
absent() { if printf '%s' "$2" | grep -qF -- "$3"; then ko "$1 (« $3 » présent)"; else ok "$1"; fi; }

ROOT="$(mktemp -d)"
LD="$ROOT/linkr"
BIN="$ROOT/bin"
CALLS="$ROOT/calls.log"
mkdir -p "$LD/close-account" "$LD/backup" "$BIN"
cp "$SRC" "$LD/close-account.sh"
chmod 755 "$LD/close-account.sh"
: > "$LD/close-account/close-account.sql"
: > "$LD/close-account/delete-keys.sh"
echo 'POSTGRES_USER=x' > "$LD/.env"
UIDX=11111111-1111-4111-8111-111111111111

cat > "$ROOT/backup.sh" <<EOF
#!/usr/bin/env bash
echo backup >> "$CALLS"
[ "\${FAKE_BACKUP_FAIL:-0}" = 1 ] && exit 1
exit 0
EOF
chmod 755 "$ROOT/backup.sh"

cat > "$BIN/docker" <<EOF
#!/usr/bin/env bash
if [ "\$1" = compose ]; then
  cat > /dev/null
  closing=; commit=
  for a in "\$@"; do case "\$a" in closing=*) closing=\${a#closing=} ;; commit=*) commit=\${a#commit=} ;; esac; done
  echo "sql closing=\$closing commit=\$commit" >> "$CALLS"
  if [ "\$closing" = false ]; then echo "RESULT|\${FAKE_STEP0:-CHECKED}"; exit 0; fi
  echo "KEY|portfolio/a/b.webp"
  echo "STRIPE|customer|cus_x"
  echo "PLAN|compte|1"
  if [ "\$commit" = true ]; then echo "RESULT|\${FAKE_COMMIT:-COMMITTED}"; else echo "RESULT|ROLLED_BACK"; fi
  exit 0
fi
mode="\${!#}"
echo "files \$mode" >> "$CALLS"
if [ "\$mode" = --dry-run ]; then
  echo "SUMMARY|lignes=1|a_supprimer=\${FAKE_TODO:-1}|absents=0|refusees=0|supprimes=0|echecs=0"; exit 0
fi
echo "SUMMARY|lignes=1|a_supprimer=1|absents=0|refusees=0|supprimes=1|echecs=0"
exit "\${FAKE_FILES_CODE:-0}"
EOF
chmod 755 "$BIN/docker"

run() {  # <saisie tapée> <arguments…> ; sortie dans OUT, code dans CODE
  local input="$1"; shift
  : > "$CALLS"
  OUT="$(printf '%b' "$input" | env PATH="$BIN:$PATH" LINKR_DIR="$LD" CLOSE_ACCOUNT_BACKUP="$ROOT/backup.sh" \
    script -qec "$LD/close-account.sh $*" /dev/null 2>&1)"
  CODE="$(printf '%s' "$OUT" | tr -d '\r' | sed -n 's/^__CODE=//p' | tail -n 1)"
}
# `script` ne relaie pas le code : on l'imprime depuis une enveloppe.
cat > "$ROOT/wrap.sh" <<EOF
#!/usr/bin/env bash
"$LD/close-account.sh.real" "\$@"
echo "__CODE=\$?"
EOF
mv "$LD/close-account.sh" "$LD/close-account.sh.real"
cp "$ROOT/wrap.sh" "$LD/close-account.sh"; chmod 755 "$LD/close-account.sh"
calls() { cat "$CALLS"; }
tmp_left() { find "$LD/close-out" -name '.tmp.*' 2>/dev/null | wc -l | tr -d ' '; }

echo "== Identifiant invalide =="
run "" "pas-un-uuid"
check "uuid invalide : code 1" "$CODE" 1
check "uuid invalide : aucun appel" "$(wc -l < "$CALLS" | tr -d ' ')" 0

echo "== Étape 0 en refus =="
FAKE_STEP0="REFUSED|activité en cours" run "" "$UIDX" --execute
check "refus : code 2" "$CODE" 2
absent "refus : aucune sauvegarde" "$(calls)" backup
absent "refus : jamais d'étape 1" "$(calls)" "closing=true"

echo "== Simulation par défaut =="
run "" "$UIDX"
check "simulation : code 0" "$CODE" 0
contains "simulation : étape 0 lecture seule" "$(calls)" "sql closing=false commit=false"
contains "simulation : étape 1 annulée" "$(calls)" "sql closing=true commit=false"
absent "simulation : jamais de COMMIT" "$(calls)" "commit=true"
absent "simulation : aucun fichier" "$(calls)" "files"
check "simulation : temporaires détruits" "$(tmp_left)" 0

echo "== --execute : sauvegarde en échec =="
FAKE_BACKUP_FAIL=1 run "" "$UIDX" --execute
check "sauvegarde KO : code 1" "$CODE" 1
absent "sauvegarde KO : jamais d'étape 1" "$(calls)" "closing=true"

echo "== --execute : phrase fausse =="
run "FERMER autre\n" "$UIDX" --execute
check "phrase fausse : code 1" "$CODE" 1
absent "phrase fausse : jamais d'étape 1" "$(calls)" "closing=true"

echo "== --execute : confirmation des fichiers refusée =="
rm -rf "$LD/close-out"
run "FERMER $UIDX\nnon\n" "$UIDX" --execute
check "fichiers refusés : code 4" "$CODE" 4
contains "fichiers refusés : COMMIT fait" "$(calls)" "sql closing=true commit=true"
contains "fichiers refusés : simulation des fichiers" "$(calls)" "files --dry-run"
absent "fichiers refusés : aucune suppression" "$(calls)" "files --delete"
check "fichiers refusés : liste de reprise conservée" "$(ls "$LD/close-out" | grep -c files-remaining)" 1
check "fichiers refusés : liste Stripe écrite" "$(cat "$LD"/close-out/*-stripe-ids.txt)" "customer|cus_x"
check "fichiers refusés : liste Stripe chmod 600" "$(stat -c %a "$LD"/close-out/*-stripe-ids.txt)" 600
check "fichiers refusés : temporaires détruits" "$(tmp_left)" 0
order="$(calls | tr '\n' ';')"
contains "ordre : étape 0, sauvegarde, COMMIT, fichiers" "$order" "sql closing=false commit=false;backup;sql closing=true commit=true;files --dry-run;"

echo "== Reprise --delete-files =="
REM="$(ls "$LD"/close-out/*files-remaining.txt)"
run "SUPPRIMER 1 FICHIERS\n" --delete-files "$REM"
check "reprise : code 0" "$CODE" 0
contains "reprise : suppression" "$(calls)" "files --delete"
check "reprise : liste détruite" "$([ -e "$REM" ] && echo present || echo absent)" absent
run "" --delete-files /etc/passwd
check "reprise hors close-out : refus" "$CODE" 1

echo "== --execute : tout confirmé =="
rm -rf "$LD/close-out"
run "FERMER $UIDX\nSUPPRIMER 1 FICHIERS\n" "$UIDX" --execute
check "complet : code 0" "$CODE" 0
contains "complet : suppression" "$(calls)" "files --delete"
contains "complet : rappel Stripe" "$OUT" "JAMAIS « Supprimer toutes les données de test »"
check "complet : aucune liste de reprise" "$(ls "$LD/close-out" | grep -c files-remaining)" 0
check "complet : temporaires détruits" "$(tmp_left)" 0

echo "== --execute : COMMIT non confirmé =="
FAKE_COMMIT="ERROR|x" run "FERMER $UIDX\n" "$UIDX" --execute
check "commit en erreur : code 1" "$CODE" 1
absent "commit en erreur : aucun fichier" "$(calls)" "files"

echo "== Verrou pris =="
flock "$LD/.deploy.lock" sleep 3 &
holder=$!
sleep 0.5
run "" "$UIDX"
check "verrou pris : code 1" "$CODE" 1
check "verrou pris : aucun appel" "$(wc -l < "$CALLS" | tr -d ' ')" 0
wait "$holder"

echo
echo "$pass ok, $fail en échec"
rm -rf "$ROOT"
[ "$fail" -eq 0 ]
