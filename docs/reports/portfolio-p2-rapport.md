# Portfolio — P2 : rapport

Branche `feat/portfolio-p2`, depuis `main` = `36244eb`. **Web seulement.**

## Ce qui est livré

- Un **septième onglet « Portfolio »** dans l'Espace pro (`/dashboard?onglet=portfolio`), ajouté en dernier pour ne déplacer aucun des six onglets verrouillés. Il n'est jamais l'onglet par défaut. Sans profil prestataire, aucun onglet n'apparaît (comportement existant).
- **Quatre relais BFF** sous `apps/web/src/app/api/service-providers/me/portfolio/` : `POST` (multipart), `PUT order`, `PATCH {itemId}`, `DELETE {itemId}`. Tous passent par `getServerApiClient()` et le cookie de session.
- L'îlot client `dashboard/_components/portfolio-section.tsx` : compteur, ajout, grille, légende, ordre, suppression, état vide, mention Loi 25.
- Le module pur `lib/portfolio/portfolio-rules.ts` et ses tests `portfolio-rules.test.mjs`.

## Écarts au mandat, signalés

1. **Pas de relais `GET`.** Le §13.1 nº 6 (décision verrouillée) réserve le BFF aux mutations. Une lecture qu'une navigation peut porter passe par le Server Component. C'est le cas ici : la page lit la liste côté serveur, comme les six autres onglets. Après chaque mutation, `router.refresh()` la relit, et c'est aussi ce qui remet l'ordre du serveur à l'écran après un échec. Un test vérifie qu'aucun relais du portfolio n'exporte de `GET`.
2. **Le 409 lit le corps.** Le mappage se fait par statut seul (verrou 3.12b), sauf pour ce 409 : son champ `code` existe depuis P1 précisément pour que l'écran le nomme. Un 409 **sans** ce code ne dit pas « portfolio complet ».

## Décisions techniques

- **Envoi transmis tel quel.** Le relais lit les octets reçus et les renvoie à l'API avec leur `Content-Type` d'origine, frontière multipart comprise. Aucun `FormData` n'est reconstruit et l'image n'est jamais touchée.
- **Taille du corps.** `proxy.ts` tourne sur `/api/*`, donc Next tamponne le corps de chaque requête. Au-delà de 10 Mo (`proxyClientMaxBodySize`, non configuré), il le **tronque sans erreur**. Un envoi de 5 Mo tient sans réglage. Le relais détecte quand même un corps tronqué (octets reçus inférieurs au `Content-Length`, ou tampon plein) et répond 413, au lieu de transmettre un fichier coupé.
- **Type déclaré vide.** Le contrôle avant envoi refuse un type **déclaré** hors JPEG/PNG/WebP. Un type vide part à l'API, qui lit le vrai type dans les octets.
- Vignettes : `<img src={item.imageUrl}>`, l'URL relative de l'API utilisée telle quelle, avec `width`, `height`, `loading="lazy"` et un `alt` égal à la légende ou à « Photo du portfolio ».

## Vérifications

| Vérification | Résultat |
|---|---|
| `pnpm --filter @linkr/web typecheck` | vert |
| `pnpm --filter @linkr/web lint` | 0 erreur (les 2 avertissements existants de `price-display.test.mjs`) |
| `node --test` | **227/227** (204 avant, +23) |
| `next build` (Turbopack) | vert, les 3 routes de relais listées `ƒ` |
| Garde miroir | 11 constantes, toutes d'accord |
| Garde migrations | 22 migrations, aucun `DROP INDEX` non marqué |
| Diff sous `apps/api`, `packages/api-client`, migrations | **vide** (`git diff --stat main -- apps/api packages/api-client`) |

**Mutations jouées, toutes mordent** : plafond de taille en `>=` (1 rouge), « descendre le dernier » autorisé (2 rouges), 409 « complet » sans regarder le `code` (1 rouge).

**Smoke de l'agent sur la pile réelle** (API `:5000` de l'humain, compte bob, jeton de test forgé, aucun mot de passe saisi ; les photos de test ont été supprimées ensuite, le portfolio de bob est revenu à 0) :
- HTTP par les relais : une photo EXIF « portrait » (800×600, orientation 6) est stockée en **600×800** ; un texte renommé `.jpg` donne 415 ; un fichier de 5 242 881 octets donne 413 ; un corps non multipart donne 400 ; sans session, 401 ; un ordre incomplet donne 422 ; la 13ᵉ photo donne 409 avec `code: PORTFOLIO_LIMIT_REACHED` ; légende posée, retirée, 141 caractères refusés (400) ; suppression 204 puis 404.
- Navigateur à 375 px : grille de 2 colonnes, aucun défilement horizontal, tous les boutons à 44 px, libellés sur une ligne. « Monter » déplace la photo, et l'ordre tient après rechargement. Un échec simulé du `PUT` réaffiche l'ordre du serveur avec son message. Le dialogue de suppression fonctionne et le compteur baisse. Un ajout par le formulaire passe (« Envoi en cours… », puis « Photo ajoutée. »). Le HEIC est refusé **sans appel**. À 12, le bouton est désactivé et le message s'affiche.

**Non joué par l'agent** : le tunnel Cloudflared et l'appareil photo d'un vrai téléphone ; une vraie panne de l'API (502), couverte seulement par les tests (l'API en cours d'exécution n'a pas été arrêtée).

## Smoke humain

Préalables : la pile Docker et l'API (`:5000`) tournent, le web tourne sur `:3001` **sur cette branche**. Le portfolio de Dana est vide.

1. **État vide.** Ouvrez `http://localhost:3001/login`, connectez-vous avec Dana. Dans la barre du haut, cliquez « Espace pro », puis l'onglet **« Portfolio »** (le dernier). Attendu : « 0 photo sur 12 · 12 places restantes », le texte « Votre portfolio est vide… », et sous le bouton « Les données de localisation de vos photos sont retirées automatiquement. »
2. **Photo portrait.** Cliquez « Choisir un fichier », prenez une photo de téléphone prise **à la verticale**. Tapez une légende, par exemple « Salle de bain refaite » : le compteur affiche « 21 / 140 caractères ». Cliquez « Ajouter la photo ». Attendu : le bouton affiche « Envoi en cours… », puis la vignette apparaît **debout**, avec sa légende en dessous, et le compteur passe à « 1 photo sur 12 ».
3. **Format refusé.** Choisissez un fichier `.heic` (attendu : le message « Format non accepté… réglez Appareil photo › Formats sur « Le plus compatible ». » s'affiche **tout de suite**, avant tout clic). Puis renommez un fichier `.txt` en `.jpg`, choisissez-le et cliquez « Ajouter la photo » : le même message s'affiche, venu de l'API (415).
4. **Légende.** Sur la vignette, cliquez « Légende », remplacez le texte par « Douche italienne », cliquez « Enregistrer » : la nouvelle légende s'affiche. Cliquez de nouveau « Légende », videz le champ, cliquez « Enregistrer » : la vignette affiche « Sans légende ».
5. **Ordre.** Ajoutez deux autres photos (3 au total). Sur la deuxième, cliquez « Monter » : elle passe en tête. Sur la nouvelle première, « Monter » est grisé ; sur la dernière, « Descendre » est grisé. Rafraîchissez la page (F5) : l'ordre est conservé.
6. **Suppression.** Sur une vignette, cliquez « Supprimer ». Le dialogue « Supprimer cette photo ? Elle sera effacée définitivement. » s'ouvre. Cliquez « Supprimer » : la photo disparaît et le compteur baisse d'un.
7. **Téléphone, par le tunnel Cloudflared.** Lancez le tunnel vers `:3001`, ouvrez son adresse sur le téléphone, connectez-vous avec Dana, Espace pro → « Portfolio ». Touchez « Choisir un fichier » : le téléphone propose la galerie **et** l'appareil photo. Prenez une photo avec l'appareil photo, puis « Ajouter la photo ». Attendu : la vignette s'affiche, debout, et la grille tient sur deux colonnes sans défilement horizontal.
8. **Portfolio complet.** Ajoutez des photos jusqu'à 12. Attendu : « 12 photos sur 12 », le champ et le bouton « Ajouter la photo » sont grisés, et le message « Votre portfolio est complet (12 photos). Supprimez-en une pour en ajouter une autre. » s'affiche.

Pour finir, supprimez les photos de test de Dana si vous voulez repartir de zéro.
