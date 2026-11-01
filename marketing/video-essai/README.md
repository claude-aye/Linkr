# Vidéo LinkedIn — version d'essai (v4)

Motion design de 45 s (1440×1080, 30 fps) pour recruter les premiers testeurs de Linkr. Pensée pour
la lecture automatique sans le son : le logo et l'accroche sont lisibles dès la première image,
chaque scène porte un seul message écrit. Ouverture en fondu du sombre vers le blanc, puis fond
blanc jusqu'à la fin, transitions rythmées sur la musique.
Hors du workspace pnpm : aucun paquet, aucune dépendance du projet.

| Scène | Temps | Message |
|---|---|---|
| Ouverture | 0,0–4,5 s | Fondu sombre → blanc. « Vous avez un besoin ? Ils ont du talent à revendre. » puis « Le bon pro, juste à côté de chez vous. » |
| Besoins | 4,5–7,5 s | Coiffure, esthétique, décoration, petits travaux |
| Proximité → Confiance → Prix | 7,5–17,0 s | Une seule carte qui évolue : zones approximatives, avis, prix affichés, demande envoyée |
| Devis | 17,0–21,5 s | Appel d'offres, devis triés par prix, acompte affiché avant d'accepter |
| Paiement | 21,5–25,5 s | Acompte 20 %, solde 80 % une fois le travail terminé |
| Pour les pros | 25,5–29,5 s | Des clients près de chez vous, 10 % de frais |
| Courriels | 29,5–32,5 s | Un courriel à chaque étape |
| Deux rôles | 32,5–35,5 s | Client et pro, un seul compte |
| Bientôt | 35,5–38,0 s | Métiers réglementés, licences RBQ · CMEQ · CCQ |
| Appel à l'action | 38,0–45,0 s | linkrapp.com, mode test Stripe, « Conçu au Québec » |

- `anim.js` : **toutes les durées et tous les easings sont dans le bloc `CONFIG` en tête de fichier**
  (coupes, transitions et événements calés sur 120 BPM). Chaque image est une fonction pure du
  temps (`window.renderFrame(t)`), donc la capture est déterministe.
- `tools/export-config.js` : copie `CONFIG` dans `timeline.json`, lu par la bande-son.
- `tools/audio.py` : funk-électro originale à 120 BPM (batterie breakbeat, basse synthé, accords
  cuivrés, mélodie), motif signature de 4 notes (do-fa-sol-la) sur le logo et sur linkrapp.com,
  effets calés sur l'image. Entièrement synthétisée (numpy + scipy), aucun échantillon, libre de droits.
- Photos : celles de l'accueil (`apps/web/public/images/accueil`, licence Unsplash, voir `CREDITS.md`).
- Polices : Geist, Geist Mono et Parisienne (SIL OFL 1.1, licences dans `fonts/`).

## Rendu

Prérequis : Chromium + Playwright (préinstallés dans l'environnement cloud), ffmpeg, Python 3 avec numpy et scipy.

```bash
cd marketing/video-essai
node tools/export-config.js                    # CONFIG -> timeline.json
python3 tools/audio.py                         # -> audio/soundtrack.wav
node tools/render.js --scale 1 --out frames-final --quality 93
./tools/encode.sh frames-final out/linkr-essai-v4-1440x1080.mp4 16
# contrôle : aucun texte hors de la zone de sécurité (marges de 8 %) sur les images au repos
node tools/render.js --qa 0,2.6,5.4,9.5,12.9,15.2,19.8,24.9,27.6,31.8,34.6,36.9,40.5,44.9
```

`encode.sh` normalise le son à -14 LUFS (loudnorm) et sort du H.264 + AAC, `+faststart`.
Preview basse résolution : `--scale 0.5` au rendu, puis `encode.sh … 23`.
Contrôle v4 : 0 texte hors zone sur les images au repos, au plus 2 flashs par seconde sur une
zone de 480×360 px (seuil : 3), -14,0 LUFS intégrés.
