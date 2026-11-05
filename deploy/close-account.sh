#!/usr/bin/env bash
# Fermeture d'un compte sur demande (droit à l'effacement pendant l'essai).
# Copié sur le VPS : /opt/linkr/close-account.sh, avec /opt/linkr/close-account/.
#
#   ./close-account.sh <users.id>             étape 0 (lecture seule) puis étape 1
#                                             dans une transaction ANNULÉE : rien
#                                             n'est modifié, rien n'est supprimé
#   ./close-account.sh <users.id> --execute   étape 0 -> sauvegarde -> phrase ->
#                                             étape 1 COMMIT -> étape 2 fichiers
#                                             (confirmation) -> liste Stripe
#   ./close-account.sh --delete-files <liste> reprise de l'étape 2 seule
#
# ⚠️ Lancé À LA MAIN par l'exploitant, jamais par une tâche planifiée ni par un
# agent. Le compte n'est pas détruit : il est MASQUÉ (suppression douce). La
# destruction est faite par la purge de fin d'essai.
# Mode d'emploi : docs/deploy/fermeture-compte.md.
#
# Codes de sortie : 0 terminé · 1 erreur, rien n'a été validé · 2 refus ou
# blocage, rien n'a été modifié · 4 COMPTE FERMÉ, étape fichiers incomplète
# (liste de reprise conservée) · 5 état du COMMIT incertain.
#
# Le script n'affiche jamais le contenu de .env, ni une adresse courriel, ni
# un nom : seulement des identifiants.

set -euo pipefail

LINKR_DIR="${LINKR_DIR:-/opt/linkr}"
SQL_DIR="$LINKR_DIR/close-account"
OUT_DIR="$LINKR_DIR/close-out"
CONTAINER_UID=1000   # utilisateur `node` de l'image API, propriétaire des fichiers
# Surchargeables pour le banc de test seulement (deploy/tests/), jamais sur le VPS.
UPLOADS_VOLUME="${CLOSE_ACCOUNT_UPLOADS_VOLUME:-linkr_uploads}"
TOOL_IMAGE="${CLOSE_ACCOUNT_TOOL_IMAGE:-alpine:3.20}"
BACKUP="${CLOSE_ACCOUNT_BACKUP:-$LINKR_DIR/backup/backup.sh}"

log() { echo "$(date -u +%FT%TZ) $*"; }
die() { log "ERREUR: $*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
Usage : ./close-account.sh <users.id> [--execute]
        ./close-account.sh --delete-files <liste de reprise>

  <users.id>          identifiant exact du compte (uuid en minuscules)
  (sans --execute)    vérification, puis masquage dans une transaction ANNULÉE
  --execute           sauvegarde, phrase « FERMER <users.id> », COMMIT, puis
                      suppression des fichiers après confirmation
  --delete-files      reprend l'étape fichiers à partir d'une liste conservée
USAGE
}

UID_ARG=""
EXECUTE=0
RESUME=""
case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  --delete-files)
    [ "$#" -eq 2 ] || { usage >&2; exit 2; }
    RESUME="$2" ;;
  *)
    [ "$#" -ge 1 ] && [ "$#" -le 2 ] || { usage >&2; exit 2; }
    UID_ARG="$1"
    case "${2:-}" in
      "") ;;
      --execute) EXECUTE=1 ;;
      *) usage >&2; exit 2 ;;
    esac
    [[ "$UID_ARG" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] \
      || die "identifiant invalide : un uuid en minuscules est attendu (users.id)"
    ;;
esac

cd "$LINKR_DIR"
[ -f .env ] || die ".env introuvable dans $LINKR_DIR"
[ -f "$SQL_DIR/close-account.sql" ] || die "$SQL_DIR/close-account.sql introuvable"
[ -f "$SQL_DIR/delete-keys.sh" ] || die "$SQL_DIR/delete-keys.sh introuvable"

# Même verrou que deploy.sh et purge.sh.
exec 9>"$LINKR_DIR/.deploy.lock"
flock -n 9 || die "un déploiement, une purge ou une fermeture est en cours"

umask 077
mkdir -p "$OUT_DIR"
chmod 700 "$OUT_DIR"

TMP_FILES=()
cleanup() {
  local f
  for f in "${TMP_FILES[@]+"${TMP_FILES[@]}"}"; do
    [ -e "$f" ] && { shred -u "$f" 2>/dev/null || rm -f "$f"; }
  done
}
trap cleanup EXIT
# Pas de « $(…) » ici : un sous-shell perdrait l'enregistrement dans TMP_FILES
# et le fichier (clés comprises) survivrait au script.
newtmp() {  # <nom de variable>
  local f
  f="$(mktemp "$OUT_DIR/.tmp.XXXXXX")"
  TMP_FILES+=("$f")
  printf -v "$1" '%s' "$f"
}

# psql dans le conteneur postgres, rôle et base lus DANS le conteneur : le
# script ne lit pas .env. Variables psql : uid, closing, commit.
run_sql() {  # <closing true|false> <commit true|false>
  if [ -n "${CLOSE_ACCOUNT_PSQL:-}" ]; then
    # Banc de test seulement.
    $CLOSE_ACCOUNT_PSQL -X -q -At -v uid="$UID_ARG" -v closing="$1" -v commit="$2" -f - \
      < "$SQL_DIR/close-account.sql"
  else
    docker compose exec -T postgres sh -c \
      'exec psql -X -q -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh \
      -v uid="$UID_ARG" -v closing="$1" -v commit="$2" -f - \
      < "$SQL_DIR/close-account.sql"
  fi
}

result_of() { sed -n 's/^RESULT|//p' "$1" | tail -n 1; }
show() { grep -E '^(RESULT|PLAN|BLOCK|BADKEY)\|' "$1" || true; }

# Étape 2 : conteneur jetable, sans réseau, racine en lecture seule, sans
# privilège ; il n'agit QUE sur les clés validées par delete-keys.sh.
run_files() {  # <liste> <--dry-run|--delete>
  docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges --user "$CONTAINER_UID:$CONTAINER_UID" \
    -v "$UPLOADS_VOLUME:/data" \
    -v "$1:/keys.txt:ro" \
    -v "$SQL_DIR/delete-keys.sh:/delete-keys.sh:ro" \
    "$TOOL_IMAGE" sh /delete-keys.sh /keys.txt /data "$2"
}

files_step() {  # <liste> ; code 0 si terminé, 4 sinon (liste conservée)
  local list="$1" n summary out code typed
  n="$(grep -c . "$list" || true)"
  if [ "$n" -eq 0 ]; then log "Aucun fichier à supprimer."; return 0; fi

  log "Fichiers : vérification des $n clé(s)..."
  out="$(run_files "$list" --dry-run)" || { printf '%s\n' "$out"; return 4; }
  printf '%s\n' "$out"
  summary="$(printf '%s\n' "$out" | sed -n 's/^SUMMARY|//p')"
  local todo; todo="$(printf '%s' "$summary" | sed -n 's/.*a_supprimer=\([0-9]*\).*/\1/p')"
  if [ "${todo:-0}" -eq 0 ]; then log "Aucun fichier présent à supprimer."; return 0; fi

  echo
  echo "⚠️  $todo fichier(s) vont être SUPPRIMÉS DÉFINITIVEMENT (seules les"
  echo "    sauvegardes des 14 derniers jours en gardent une copie)."
  read -r -p "Tapez « SUPPRIMER $todo FICHIERS » : " typed </dev/tty
  if [ "$typed" != "SUPPRIMER $todo FICHIERS" ]; then
    log "Confirmation différente : aucun fichier supprimé."
    return 4
  fi

  set +e
  out="$(run_files "$list" --delete)"
  code=$?
  set -e
  printf '%s\n' "$out"
  [ "$code" -eq 0 ] || return 4
  return 0
}

keep_list() {  # <liste temporaire> -> liste de reprise conservée
  local kept="$OUT_DIR/$(date -u +%Y%m%dT%H%M%SZ)-files-remaining.txt"
  cp "$1" "$kept"
  chmod 600 "$kept"
  log "Liste de reprise conservée : $kept"
  log "Reprendre : ./close-account.sh --delete-files $kept"
}

# ─── Reprise de l'étape fichiers seule ───────────────────────────────────────
if [ -n "$RESUME" ]; then
  case "$(readlink -f "$RESUME")" in
    "$(readlink -f "$OUT_DIR")"/*) ;;
    *) die "la liste de reprise doit se trouver dans $OUT_DIR" ;;
  esac
  [ -f "$RESUME" ] || die "liste introuvable : $RESUME"
  if files_step "$RESUME"; then
    shred -u "$RESUME" 2>/dev/null || rm -f "$RESUME"
    log "Étape fichiers terminée, liste détruite."
    exit 0
  fi
  log "Étape fichiers incomplète : liste conservée ($RESUME)."
  exit 4
fi

# ─── Étape 0 : lecture seule ─────────────────────────────────────────────────
log "Étape 0 : vérification en lecture seule..."
newtmp CHECK
run_sql false false > "$CHECK" || { show "$CHECK"; die "étape 0 en erreur : rien n'a été modifié."; }
show "$CHECK"
case "$(result_of "$CHECK")" in
  CHECKED) ;;
  REFUSED*) log "REFUS : rien n'a été modifié."; exit 2 ;;
  *) die "étape 0 : résultat inattendu, rien n'a été modifié." ;;
esac

if [ "$EXECUTE" -eq 0 ]; then
  # ─── Simulation de l'étape 1 : transaction ANNULÉE ────────────────────────
  log "Étape 1 (simulation) : masquage dans une transaction annulée..."
  newtmp SIM
  run_sql true false > "$SIM" || { show "$SIM"; die "simulation en erreur : rien n'a été modifié."; }
  show "$SIM"
  case "$(result_of "$SIM")" in
    ROLLED_BACK) ;;
    REFUSED*) log "REFUS : rien n'a été modifié."; exit 2 ;;
    *) die "simulation : résultat inattendu, rien n'a été modifié." ;;
  esac
  log "Fichiers qui seraient supprimés : $(grep -c '^KEY|' "$SIM" || true) ; identifiants Stripe à traiter : $(grep -c '^STRIPE|' "$SIM" || true)."
  log "Simulation terminée : RIEN n'a été modifié. Relancer avec --execute pour fermer le compte."
  exit 0
fi

# ─── Sauvegarde obligatoire ──────────────────────────────────────────────────
log "Sauvegarde avant fermeture..."
"$BACKUP" || die "la sauvegarde a échoué. ARRÊT : rien n'a été modifié."

# ─── Phrase tapée ────────────────────────────────────────────────────────────
echo
read -r -p "Tapez « FERMER $UID_ARG » : " TYPED </dev/tty
[ "$TYPED" = "FERMER $UID_ARG" ] || die "phrase différente : rien n'a été modifié."

# ─── Étape 1 : masquage, COMMIT ──────────────────────────────────────────────
log "Étape 1 : masquage..."
newtmp RUN
set +e
run_sql true true > "$RUN"
code=$?
set -e
show "$RUN"
res="$(result_of "$RUN")"
case "$res" in
  COMMITTED) log "TRANSACTION VALIDÉE : compte fermé (masqué)." ;;
  REFUSED*) log "REFUS : rien n'a été modifié."; exit 2 ;;
  *)
    if [ "$code" -ne 0 ] && [ -z "$res" ]; then
      log "État du COMMIT INCERTAIN (psql code $code) : vérifier users.deleted_at_utc avant toute relance."
      exit 5
    fi
    die "étape 1 : $res. Rien n'a été validé." ;;
esac

# Listes lues AVANT le COMMIT (dans la même transaction).
newtmp KEYS
sed -n 's/^KEY|//p' "$RUN" > "$KEYS"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
STRIPE_LIST="$OUT_DIR/$STAMP-${UID_ARG:0:8}-stripe-ids.txt"
sed -n 's/^STRIPE|//p' "$RUN" > "$STRIPE_LIST"
chmod 600 "$STRIPE_LIST"

# ─── Étape 2 : fichiers, APRÈS le COMMIT seulement ───────────────────────────
if ! files_step "$KEYS"; then
  keep_list "$KEYS"
  log "COMPTE FERMÉ, ÉTAPE FICHIERS INCOMPLÈTE (code 4)."
  log "Liste Stripe : $STRIPE_LIST"
  exit 4
fi

# ─── Étapes 3 et 4 : à la main ───────────────────────────────────────────────
log "Fermeture terminée en base et sur le disque."
log "Étape 3 (Stripe, mode test) : $(grep -c . "$STRIPE_LIST" || true) identifiant(s) dans $STRIPE_LIST"
log "  Bac à sable Stripe PARTAGÉ avec le développement : supprimer UNIQUEMENT ces identifiants, un par un. JAMAIS « Supprimer toutes les données de test »."
log "  Puis détruire la liste : shred -u $STRIPE_LIST"
log "Étape 4 : Brevo, Gmail et registre (docs/deploy/fermeture-compte.md)."
exit 0
