#!/bin/sh
# Suppression des fichiers d'un compte fermé (étape 2 de la fermeture).
# Lancé par deploy/close-account.sh dans un conteneur JETABLE, SANS RÉSEAU,
# racine en lecture seule, le volume uploads monté sur <dossier> et la liste de
# clés montée en lecture seule. Jamais lancé à la main sur l'hôte.
#
#   delete-keys.sh <fichier-de-clés> <dossier> --dry-run|--delete
#
# Une clé n'est supprimée que si elle a EXACTEMENT la forme d'une photo de
# portfolio ou d'une pièce de vérification :
#   portfolio/<uuid>/<uuid>.webp
#   verifications/<uuid>/<uuid>[.<ext>]
# (lettres minuscules, chiffres et tirets seulement ; aucun « .. », aucun
# chemin absolu, aucun autre préfixe — les pièces jointes des demandes ne sont
# JAMAIS acceptées ici). Chaque dossier du chemin doit être un vrai dossier,
# jamais un lien symbolique, et la cible un fichier ordinaire. Une clé refusée
# est signalée par son NUMÉRO DE LIGNE (jamais affichée) et jamais supprimée.
#
# Sortie : une ligne « SUMMARY|… » ; « REFUSED|<ligne>|<raison> » et
# « FAILED|<ligne> » au besoin. Code 0, sauf 4 si une suppression a échoué et
# 2 si les arguments sont invalides.

set -u
LC_ALL=C
export LC_ALL

KEYS="${1:-}"
DATA="${2:-}"
MODE="${3:-}"
case "$MODE" in
  --dry-run|--delete) ;;
  *) echo "usage: delete-keys.sh <clés> <dossier> --dry-run|--delete" >&2; exit 2 ;;
esac
[ -f "$KEYS" ] || { echo "liste de clés introuvable" >&2; exit 2; }
[ -d "$DATA" ] && [ ! -L "$DATA" ] || { echo "dossier de données introuvable" >&2; exit 2; }

UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
PATTERN="^(portfolio/$UUID/$UUID\\.webp|verifications/$UUID/$UUID(\\.[a-z0-9]{1,10})?)\$"

n=0; valid=0; refused=0; absent=0; deleted=0; failed=0

refuse() { refused=$((refused + 1)); echo "REFUSED|$n|$1"; }

while IFS= read -r key || [ -n "$key" ]; do
  n=$((n + 1))
  [ -n "$key" ] || { refuse "ligne vide"; continue; }
  if [ "${#key}" -gt 512 ]; then refuse "trop longue"; continue; fi
  if ! printf '%s\n' "$key" | grep -Eq "$PATTERN"; then refuse "forme inattendue"; continue; fi

  prefix="${key%%/*}"          # portfolio | verifications
  rest="${key#*/}"
  owner="${rest%%/*}"          # <uuid> du prestataire ou du métier
  dir1="$DATA/$prefix"
  dir2="$dir1/$owner"
  path="$DATA/$key"

  if [ -L "$dir1" ] || [ -L "$dir2" ] || [ -L "$path" ]; then refuse "lien symbolique"; continue; fi
  if [ ! -e "$path" ]; then absent=$((absent + 1)); continue; fi
  if [ ! -f "$path" ]; then refuse "pas un fichier ordinaire"; continue; fi

  valid=$((valid + 1))
  if [ "$MODE" = "--delete" ]; then
    if rm -f -- "$path" && [ ! -e "$path" ]; then
      deleted=$((deleted + 1))
    else
      failed=$((failed + 1)); echo "FAILED|$n"
    fi
  fi
done < "$KEYS"

echo "SUMMARY|lignes=$n|a_supprimer=$valid|absents=$absent|refusees=$refused|supprimes=$deleted|echecs=$failed"
[ "$failed" -eq 0 ] || exit 4
exit 0
