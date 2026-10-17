# Portfolio — P3 : rapport

Branche `feat/portfolio-p3`, depuis `main` = `365dc26`. Web seulement. Recon : `portfolio-p3-recon.md`.

## Ce qui est livré

- **Section « Réalisations (N) »** sur `/providers/{id}`, entre la présentation et « Services ». Une grille de 2 colonnes à 375 px et 3 sur ordinateur, avec des vignettes carrées. Aucune photo → aucune section.
- **Visionneuse** (`<dialog>` natif, sans dépendance) : « n / N », boutons « Précédente » et « Suivante », touches ← et →, bornes désactivées sans boucle. Elle se ferme par Échap, par « Fermer » ou par un clic sur le fond, et le focus revient sur la vignette d'origine.
- **Lecture côté serveur**, en parallèle avec le catalogue et les avis. Un échec du portfolio fait disparaître la section, jamais la page.
- **Légendes en texte inerte**, sans aucun lien sortant. Le seul lien de la galerie est la vignette, vers l'image (`/media/portfolio/{id}`, interne).
- **Espace pro élargi** (`max-w-3xl` → `max-w-4xl`), pour que les 7 onglets tiennent sur une ligne.

## Écarts au mandat, décidés après la recon

1. **La page reste privée.** Un visiteur non connecté est renvoyé vers `/login`, comme avant P3. L'objectif « connecté ou non » et le smoke « en fenêtre privée » ne sont donc pas tenus. C'est la décision d'Ayé du 17 octobre : l'ouverture appartient au chantier « `discover` public », parce que l'API des avis exige un JWT.
2. **La barre d'onglets passe encore sur deux lignes à 830 px.** Le mandat situait le problème « vers 830 px ». La recon a montré qu'il touchait toutes les largeurs d'ordinateur : la section était plafonnée à 768 px et les onglets de Dana en demandent 817. La correction choisie (élargir l'Espace pro, sans défilement) donne :

   | Fenêtre | Largeur de la barre | Rangées |
   |---|---|---|
   | 1280 px | 896 px | **1** |
   | 900 px | 837 px | **1** |
   | 830 px | 767 px | **2** |
   | 375 px | liste verticale | inchangé |

   La bascule se fait vers **880 px** de fenêtre avec les compteurs de Dana. En dessous, et jusqu'à 640 px, la barre passe encore à la ligne. Un défilement horizontal en repli reste possible plus tard (option « les deux » non retenue).

## Vérifications

- `apps/web` : typecheck vert, lint (0 erreur, les 2 avertissements existants de `price-display.test.mjs`), `node --test` **227 → 245** (+18 dans `public-gallery.test.mjs`), build.
- Garde miroir et garde des migrations : vertes.
- **Diff vide** sous `apps/api`, `packages/api-client` et dans les migrations (`git diff --stat main -- apps/api packages/api-client` ne renvoie rien).

## Smoke de l'agent (navigateur, pile de dev réelle, jeton de test forgé pour Dana, aucun mot de passe saisi)

- **1280 px**, page de Dana : « Réalisations (12) », sections dans l'ordre Réalisations · Services · Avis, 3 colonnes, les deux premières vignettes en `eager` et les suivantes en `lazy`, ordre identique à `position` en base.
- **Visionneuse au clavier** : ouverture sur « 1 / 12 » avec le focus sur « Fermer », ← sans effet sur la première, → jusqu'à « 12 / 12 » puis « Suivante » désactivé, image en `object-contain`. Échap ferme, et le focus revient sur la vignette 1.
- **À la souris** : clic sur la vignette 3 → « 3 / 12 », « Suivante » → « 4 / 12 », un clic sur l'image ne ferme pas, un clic sur le fond ferme, focus sur la vignette 3. Boutons à 44 px.
- **375 px** : 2 colonnes, aucun défilement horizontal. Visionneuse en plein écran, avec un fond **opaque** (une première version translucide laissait lire la page derrière, corrigé). Depuis la dernière photo, « Précédente » puis « Suivante » : le focus passe sur « Précédente » quand « Suivante » se désactive. « Fermer » rend le focus à la vignette 12.
- **Légende hostile** (posée puis retirée par l'API) : `<b>Appelez 514-555-1234</b> https://example.com …` s'affiche **littéralement**, sans balise ni lien. Tronquée sur une ligne sous la vignette, entière dans la visionneuse. Elle sert aussi d'`alt`.
- **Sans photo** (David) : aucune section, aucun mot « Réalisation » sur la page.
- **Portfolio en 500** (table renommée quelques secondes, puis restaurée ; `GET …/portfolio` → 500, profil → 200) : la page répond 200 avec le profil et les services, **sans** la section. La ligne de journal côté serveur n'a pas été lue : le serveur web de dev ne tourne pas dans un terminal accessible à l'agent.
- **Espace pro** : voir le tableau ci-dessus.

## Smoke humain

Préalables : la pile Docker, l'API `:5000` et le web `:3001` tournent sur cette branche. Dana a 12 photos.

1. **Page de Dana (connecté).** Connectez-vous avec **Carol** (la page reste privée, voir les écarts). Ouvrez `http://localhost:3001/providers/0444f7a2-112c-4e6b-9aa8-f0fc191d287f`. Vous pouvez aussi passer par « Trouver un pro » → Coiffure → une adresse près de la base de Dana → la carte « Dana White ». **Attendu** : sous le nom de Dana, « Réalisations (12) », puis « Services », puis « Avis ». Les photos sont dans le même ordre que l'onglet « Portfolio » de Dana. En fenêtre privée sans connexion, vous arrivez sur `/login` : c'est voulu.
2. **Visionneuse.** Cliquez la première vignette. **Attendu** : la photo en entier sur fond noir, « 1 / 12 » en haut à gauche, « Précédente » grisé. Appuyez sur → trois fois → « 4 / 12 », puis ← → « 3 / 12 ». Allez jusqu'à « 12 / 12 » : « Suivante » est grisé. Appuyez sur Échap : la visionneuse se ferme, et un Tab montre que le focus est sur la première vignette. Rouvrez-la, puis cliquez sur la zone noire autour de la photo : elle se ferme.
3. **Ordre.** Connectez-vous avec Dana, Espace pro → « Portfolio », descendez la première photo d'un cran avec « Descendre ». Rechargez la page de Dana (étape 1). **Attendu** : les deux premières vignettes ont changé de place.
4. **Sans photo.** Ouvrez `http://localhost:3001/providers/85954604-9238-463c-ac5d-a8126c5ca09d` (David Kolmogorov). **Attendu** : le nom, « Services », « Avis », et **aucune** section « Réalisations ».
5. **Téléphone, par le tunnel Cloudflared** vers `:3001`. Connectez-vous avec Carol et ouvrez la page de Dana. **Attendu** : 2 colonnes, aucun défilement horizontal. Touchez une vignette : la photo s'ouvre en plein écran. « Suivante » et « Précédente » fonctionnent au toucher, et « Fermer » ramène à la grille.
6. **Espace pro sur ordinateur.** Connectez-vous avec Dana, ouvrez l'Espace pro, fenêtre large. **Attendu** : les 7 onglets sur une ligne, « Portfolio » à droite de « Avis ». Réduisez la fenêtre : la barre reste sur une ligne jusqu'à environ 880 px. Plus étroit, elle repasse sur deux lignes (écart nº 2 ci-dessus). En dessous de 640 px, la liste verticale est inchangée.

Remettez l'ordre des photos de Dana si vous l'avez changé à l'étape 3.
