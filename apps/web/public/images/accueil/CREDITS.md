# Images de l'accueil public — crédits

Toutes les photos viennent d'Unsplash, sous la licence Unsplash
(<https://unsplash.com/license>) : usage commercial permis, sans attribution
obligatoire. Les auteurs sont crédités ici par courtoisie.

| Fichiers | Auteur | Page source | Original téléchargé |
|---|---|---|---|
| `hero-paysage-*`, `hero-portrait-*` | Vatsal Tyagi | <https://unsplash.com/photos/ASwNz2xEco0> | `https://images.unsplash.com/photo-1726912051143-3c732c0f580a?w=3508&q=92&fm=jpg` → `hero.jpg` |
| `coiffure-*` | engin akyurt | <https://unsplash.com/photos/35NAaB_Nmx8> | `https://images.unsplash.com/photo-1582095133179-bfd08e2fc6b3?w=2400&q=92&fm=jpg` → `coiffure.jpg` |
| `esthetique-*` | Giorgio Trovato | <https://unsplash.com/photos/gb6gtiTZKB8> | `https://images.unsplash.com/photo-1632345031435-8727f6897d53?w=2400&q=92&fm=jpg` → `esthetique.jpg` |
| `decoration-*` | Barney Goodman | <https://unsplash.com/photos/Azz07JvM-EA> | `https://images.unsplash.com/photo-1789841417999-67a24a247c90?w=2400&q=92&fm=jpg` → `decoration.jpg` |
| `petits-travaux-*` | Valentina Giarre | <https://unsplash.com/photos/cfNchb3VAI8> | `https://images.unsplash.com/photo-1615974679600-665fb9468c4f?w=2400&q=92&fm=jpg` → `petits-travaux.jpg` |
| `construction-*` | Defrino Maasy | <https://unsplash.com/photos/CW8eLBgzGPI> | `https://images.unsplash.com/photo-1788330937192-907ee7b8db55?w=2400&q=92&fm=jpg` → `construction.jpg` |
| `electricite-*` | Kelly Sikkema | <https://unsplash.com/photos/fZirmwarM0E> | `https://images.unsplash.com/photo-1610056494071-9373f12bf769?w=2400&q=92&fm=jpg` → `electricite.jpg` |
| `pro-*` | Minh Đức | <https://unsplash.com/photos/IAR-l-Cq4Is> | `https://images.unsplash.com/photo-1756736668704-7894673ccd84?w=2400&q=92&fm=jpg` → `pro.jpg` |

## Modifications

Pour chaque image : recadrage (portrait 2:3 du hero pour téléphone, cartes
4:5 qui gardent le geste et écartent visages, texte lisible et marques),
redimensionnement, conversion en sRGB, encodage AVIF (qualité 50) et WebP
(qualité 72), **suppression de toutes les métadonnées** (EXIF, GPS, XMP, IPTC,
profil ICC). Les recadrages exacts sont dans le script.

## Régénération

Les originaux ne sont pas dans le dépôt. Les télécharger aux URL ci-dessus sous
les noms indiqués, dans un dossier hors du dépôt, puis, depuis la racine :

```bash
bash apps/web/scripts/landing-images.sh /c/Dev/linkr-images-originals
```

L'outil (`sharp-cli@6.1.0`) est récupéré par `pnpm dlx` ; ce n'est pas une
dépendance du projet. Ne jamais ajouter `--withMetadata`.

## Vérification des métadonnées

Depuis `apps/api` (où `sharp` est installé) :

```bash
node -e "const s=require('sharp'),fs=require('fs'),D='../web/public/images/accueil/';(async()=>{for(const f of fs.readdirSync(D).filter(f=>/\.(avif|webp)$/.test(f))){const m=await s(D+f).metadata();console.log(f,!!m.exif,!!m.icc,!!m.xmp,!!m.iptc)}})()"
```

Chaque ligne doit finir par `false false false false`.
