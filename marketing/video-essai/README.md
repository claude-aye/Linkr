# Vidéo LinkedIn — version d'essai

Motion design de 50 s (1440×1080, 30 fps) qui présente Linkr et renvoie vers `linkrapp.com`.
Hors du workspace pnpm : aucun paquet, aucune dépendance du projet.

- `index.html` + `anim.js` : la vidéo. Chaque image est une fonction pure du temps
  (`window.renderFrame(t)`), donc la capture image par image est déterministe.
- `timeline.json` : les instants partagés par l'image et le son (battements, coupes, impacts…),
  régénéré par `tools/make-timeline.py`.
- `tools/audio.py` : bande-son entièrement synthétisée (numpy + scipy), libre de droits.
- `assets/globe-dots.json` : points du globe, calculés depuis Natural Earth (domaine public)
  par `tools/make-globe-dots.js`.
- Photos : celles de l'accueil (`apps/web/public/images/accueil`, licence Unsplash, voir `CREDITS.md`).
- Polices : Geist et Parisienne (SIL OFL 1.1, licences dans `fonts/`).

## Rendu

Prérequis : Chromium + Playwright (préinstallés dans l'environnement cloud), ffmpeg, Python 3 avec numpy et scipy.

```bash
cd marketing/video-essai
python3 tools/make-timeline.py
python3 tools/audio.py                                   # -> audio/soundtrack.wav
# preview basse résolution (720×540)
node tools/render.js --scale 0.5 --out frames-preview --quality 88
./tools/encode.sh frames-preview out/linkr-essai-preview-720x540.mp4 23
# version finale (1440×1080)
node tools/render.js --scale 1 --out frames-final --quality 95
./tools/encode.sh frames-final out/linkr-essai-1440x1080.mp4 16
# contrôle : aucun texte hors de la zone de sécurité (marges de 8 %)
node tools/render.js --qa 2.5,5.2,10.5,13.9,16.9,20.8,24.9,28.9,32.9,36.95,42.9,47,49.9
```

`encode.sh` normalise le son à -14 LUFS (loudnorm) et sort du H.264 + AAC, `+faststart`.
