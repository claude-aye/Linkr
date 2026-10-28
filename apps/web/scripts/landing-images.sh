#!/usr/bin/env bash
# Regenerates the landing-page images in public/images/accueil/ (R5b).
#
# Usage (from the repository root, Git Bash or any POSIX shell):
#   bash apps/web/scripts/landing-images.sh <directory holding the originals>
#
# The originals are NOT in the repository (several MB each). They are the
# photos listed in public/images/accueil/CREDITS.md, saved under these names:
#   hero.jpg coiffure.jpg esthetique.jpg decoration.jpg petits-travaux.jpg
#   construction.jpg electricite.jpg pro.jpg
# CREDITS.md gives the download URL of each one.
#
# The tool is fetched on demand by `pnpm dlx` and pinned to an exact version.
# It is deliberately NOT a dependency of the project.
#
# Metadata: sharp converts every image to sRGB and, without --withMetadata,
# writes no EXIF, no XMP, no IPTC and no ICC profile. Never add that flag:
# a phone photo carries the GPS position where it was taken.
set -euo pipefail

SRC="${1:?usage: landing-images.sh <originals directory>}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/images/accueil"
SHARP=(pnpm dlx sharp-cli@6.1.0)
AVIF=(-f avif -q 50 --effort 6)
WEBP=(-f webp -q 72 --effort 6)

mkdir -p "$OUT"

# render <source> <name> <width> <height> [extract top left width height]
render() {
  local src="$1" name="$2" w="$3" h="$4"
  shift 4
  local crop=()
  if [ "$#" -eq 4 ]; then crop=(extract "$1" "$2" "$3" "$4" --); fi
  "${SHARP[@]}" -i "$SRC/$src" -o "$OUT/$name-$w.avif" "${AVIF[@]}" "${crop[@]}" resize "$w" "$h"
  "${SHARP[@]}" -i "$SRC/$src" -o "$OUT/$name-$w.webp" "${WEBP[@]}" "${crop[@]}" resize "$w" "$h"
}

# Hero: landscape 3:2 for wide screens, portrait 2:3 crop for phones.
render hero.jpg hero-paysage 1280 853
render hero.jpg hero-paysage 1920 1280
render hero.jpg hero-portrait 640 960 0 904 1559 2338
render hero.jpg hero-portrait 828 1242 0 904 1559 2338

# Trade cards, 4:5. Each crop keeps the gesture and leaves out faces,
# readable text and brand marks.
card() {
  local src="$1" name="$2"
  shift 2
  for w in 320 480 640; do render "$src" "$name" "$w" $((w * 5 / 4)) "$@"; done
}
card coiffure.jpg coiffure 0 752 1281 1601
card esthetique.jpg esthetique 0 480 1280 1600
card decoration.jpg decoration 0 676 1287 1609
card petits-travaux.jpg petits-travaux 0 480 1920 2400
card construction.jpg construction 240 0 2400 3000
card electricite.jpg electricite 120 0 2400 3000

# « Côté pro » image, 3:2, whole frame.
for w in 480 640 960; do render pro.jpg pro "$w" $((w * 2 / 3)); done

echo "Done: $OUT"
