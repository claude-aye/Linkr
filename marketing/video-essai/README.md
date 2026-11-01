# Vidéo LinkedIn — version d'essai (v3)

Motion design de 45 s (1440×1080, 30 fps, fond blanc) pour recruter les premiers testeurs de
Linkr. Pensée pour la lecture automatique sans le son : le logo et l'accroche sont lisibles dès
la première image, chaque scène porte un seul message écrit.
Hors du workspace pnpm : aucun paquet, aucune dépendance du projet.

| Scène | Temps | Message |
|---|---|---|
| Ouverture | 0,0–4,8 s | « Vous avez un besoin ? Ils ont du talent à revendre. » puis « Le bon pro, juste à côté de chez vous. » |
| Besoins | 4,8–8,4 s | Coiffure, esthétique, décoration, petits travaux |
| Proximité → Confiance → Prix | 8,4–20,4 s | Une seule carte qui évolue : zones approximatives, avis, prix affichés |
| Devis | 20,4–25,8 s | Appel d'offres, devis triés par prix |
| Paiement | 25,8–31,2 s | Acompte 20 %, solde 80 % une fois le travail terminé |
| Pour les pros | 31,2–36,0 s | Des clients près de chez vous, 10 % de frais |
| Bientôt | 36,0–39,0 s | Métiers réglementés, licences RBQ · CMEQ · CCQ |
| Appel à l'action | 39,0–45,0 s | linkrapp.com, mode test Stripe, « Conçu au Québec » |

- `anim.js` : **toutes les durées et tous les easings sont dans le bloc `CONFIG` en tête de fichier.**
  Chaque image est une fonction pure du temps (`window.renderFrame(t)`), donc la capture est déterministe.
- `tools/export-config.js` : copie `CONFIG` dans `timeline.json`, lu par la bande-son.
- `tools/audio.py` : piano et cordes pincées, 100 BPM, motif signature de 4 notes (do-fa-sol-la) sur le
  logo et sur linkrapp.com. Entièrement synthétisé (numpy + scipy), libre de droits.
- Photos : celles de l'accueil (`apps/web/public/images/accueil`, licence Unsplash, voir `CREDITS.md`).
- Polices : Geist, Geist Mono et Parisienne (SIL OFL 1.1, licences dans `fonts/`).

## Rendu

Prérequis : Chromium + Playwright (préinstallés dans l'environnement cloud), ffmpeg, Python 3 avec numpy et scipy.

```bash
cd marketing/video-essai
node tools/export-config.js                    # CONFIG -> timeline.json
python3 tools/audio.py                         # -> audio/soundtrack.wav
node tools/render.js --scale 1 --out frames-final --quality 95
./tools/encode.sh frames-final out/linkr-essai-1440x1080.mp4 16
# contrôle : aucun texte hors de la zone de sécurité (marges de 8 %)
node tools/render.js --qa 0,2.5,5.5,9.8,14,17.6,22,27,32.5,37.5,41.5,44.99
```

`encode.sh` normalise le son à -14 LUFS (loudnorm) et sort du H.264 + AAC, `+faststart`.
Preview basse résolution : `--scale 0.5` au rendu, puis `encode.sh … 23`.
