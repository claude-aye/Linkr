# ÉTAT — Travail autonome CC

**Dernière session :** 2026-08-17 · `main` @ `1fdb07d` · migration `1780500000000`

## Chantier en cours

**G — Passe interface / responsive.** Tranche 1 sur 2 livrée.

## Découpage retenu

- [x] Tranche 1 — Shell `(app)` : cibles tactiles + point de retour à la ligne de la nav (PR #72, mergée)
- [ ] Tranche 2 — Cibles tactiles **dans les pages** (hors shell)  ← PROCHAINE

Le découpage vient de la mesure, pas d'un découpage a priori : la tranche 1 traite la
surface que **toutes** les pages authentifiées portent, la tranche 2 traite les pages
elles-mêmes. Après G-2, le chantier suivant est **H — recherche par métier depuis
l'accueil** (§8 du mandat).

## Ce que la prochaine session doit savoir

1. **N'entreprends pas une chasse au débordement horizontal : il n'y en a pas.** Mesuré
   sur 5 pages × 3 largeurs (320/375/414 px), `scrollWidth === innerWidth` partout, avant
   **et** après. La dette mobile de ce dépôt est la **taille des cibles**, pas la casse de
   mise en page. La sonde est décrite dans la PR #72 (Playwright + Chromium `/opt/pw-browsers`,
   déjà installés ; mesurer `getBoundingClientRect().height` sur `a,button,input,select,textarea`).
2. **Cible connue et non corrigée pour G-2 : « Voir le détail → » à 16 px** sur les cartes du
   tableau de bord. Auditer aussi `/requests`, `/recherche`, `/providers/[id]`, les formulaires.
   Plancher visé : 24 px (WCAG 2.5.8 AA), 44 px quand c'est gratuit.
3. **Le piège flex qui a mordu en G-1, et qui remordra en G-2 :** un élément flex **rétrécit
   avant de passer à la ligne**. Sans `shrink-0`, les libellés cassent en plein milieu et les
   éléments grossissent **sans qu'aucune sonde de débordement ne vire au rouge**. Mesurer la
   hauteur, pas seulement `scrollWidth`.
4. **Docker est absent du bac à sable** (`dial unix /var/run/docker.sock`). Le rituel §4 du
   mandat n'est donc pas jouable tel quel : monter la stack à la main (Postgres 16 +
   `postgresql-16-postgis-3` **après un `apt-get update`**, sinon 404 sur une dépendance ;
   `initdb` sous l'utilisateur `postgres` ; `redis-server --daemonize yes`), puis
   `migration:run` + le seed `quebec-catalog.seed.ts`. Compter ~5 min.
5. **`git fetch origin --prune` n'est pas optionnel, et ça s'est vérifié dès la première
   commande de la première session :** une réf `origin/main` périmée affichait un faux delta
   de 17 fichiers entre `main` et la branche de travail. Le `--prune` a aussi supprimé une réf
   de branche qui n'existait plus côté distant.
6. **La branche `claude/linkr-autonomie-o16ak7` existe encore côté distant** au commit
   pré-squash `7f67661` (le `git push --delete` a échoué, sans conséquence : son contenu est
   intégralement dans `main`). La repartir de `main` (`git checkout -B <nom> origin/main`) ;
   un `--force-with-lease` est légitime, elle ne porte que de l'historique déjà mergé.

## ⛔ En attente de décision humaine

**Raccourcir le libellé de nav « Mon tableau de bord » en « Tableau de bord » ?**

- **Le fait mesuré :** ce libellé fait 144 px à lui seul et il est le seul à forcer une 3ᵉ
  rangée d'en-tête chez le prestataire. Les 3 liens réclament 371 px ; il y en a 366 à
  414 px — **il manque 5 px**.
- **Ce que ça achèterait :** une rangée d'en-tête en moins dès ~414 px (largeur très
  répandue : iPhone Plus/Pro Max), ce qui efface la régression de +18 px que la PR #72
  assume à cette largeur.
- **Option recommandée : oui, raccourcir.** « Tableau de bord » est sans ambiguïté dans une
  nav où l'utilisateur est déjà connecté, et le mot « Mon » ne porte aucune information que
  le contexte ne donne pas.
- **Pourquoi je ne l'ai pas fait :** c'est de la **copie produit**, pas de la technique
  (mandat §3.15). Micro-ajuster le padding pour gagner ces 5 px serait fragile — ça dépend
  des métriques de police — donc je n'ai pas contourné non plus.

## Dettes créées par la dernière PR

**Aucune dette créée.** Un arbitrage assumé et deux dettes **relevées** (préexistantes, non
créées ici) :

- *Arbitrage :* des cibles à 44 px coûtent de la hauteur d'en-tête là où elle tenait déjà —
  **+18 px à 414 px** (prestataire) et **+10 px au-delà de 768 px**. Chiffré dans la PR #72
  pour être renversable sur un chiffre, pas sur une impression.
- *Relevée :* `body { font-family: Arial, Helvetica, sans-serif; }` dans `globals.css`
  **écrase les polices Geist** que `app/layout.tsx` charge et expose pourtant en
  `--font-geist-sans`. Reliquat du scaffold `create-next-app` : les polices sont téléchargées
  à chaque visite et **jamais utilisées**. Correctif = une ligne, mais rayon d'impact visuel
  sur toute l'application → **PR dédiée**, jamais en passager d'une autre.
- *Relevée :* aucune vérification en **mode sombre** n'a été faite, nulle part, à ce jour.
