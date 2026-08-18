# ÉTAT — Travail autonome CC

**Dernière session :** 2026-08-18 · `main` @ `71b9c1c` · migration `1780500000000`

## Chantier en cours

**H — Recherche par métier depuis l'accueil.** Tranche 1 sur 2 livrée.

**Réordonnancement, et pourquoi** (mandat §8 : ne pas réordonner sans l'écrire) : l'état
précédent annonçait **G-2** comme prochaine tranche. **L'humain a fourni un brief de session
dédié à H**, avec des contraintes déjà tranchées (découpage en deux tranches, réponse à la
question produit de l'état vide, décision de copie « Espace pro »). J'ai suivi le brief.
**G-2 reste ouverte et non entamée** — elle n'a rien perdu, elle a été dépassée dans la file.

## Découpage retenu

- [x] Tranche 1 — Entrée par métier depuis l'accueil + état vide honnête (PR #73, mergée)
- [ ] Tranche 2 — Table de captation de la demande insatisfaite  ← PROCHAINE, **porte humaine**

**La tranche 2 n'est PAS auto-mergeable** (brief §7 + mandat §7) : elle crée une table, donc
une migration. Tu prépares, tu prouves `up`/`down` dans ton bac à sable, **et tu t'arrêtes
avant le merge** — l'humain rejoue `migration:run` / `migration:revert` sur la vraie base dev,
celle qui porte les 33 lignes historiques et les lignes `SONDE-*`/`SMOKE-*` en
`ON DELETE RESTRICT`. Ta bande d'horodatage : `1780510000000` → `1780599999999`.

Après H, les chantiers ouverts sont **G-2** (cibles tactiles dans les pages) puis **D — avis
et évaluations** (§8 du mandat).

## Ce que la prochaine session doit savoir

1. **`discover` ne distingue pas les deux zéros — c'est mesuré, ne le re-litige pas.** Un
   métier réglementé déclaré mais `PENDING` et un métier que personne n'a déclaré renvoient
   des réponses **byte-identiques** (`{"items":[],"total":0,"page":1,"limit":20}`). Le seul
   signal séparateur est le `regulationLevel` du **catalogue**, que la page charge déjà.
   `NoResults` le **reçoit** en prop ; ne le fais jamais inférer depuis `total`.
2. **`NoResults` a TROIS branches, pas deux, et la 3ᵉ est le cœur du sujet.** Niveau inconnu
   (catalogue en panne, ou UUID bien formé absent du catalogue) ⇒ on énonce ce qu'on a
   mesuré et **RIEN** sur le pourquoi. Ma v1 à deux branches affirmait « ce métier ne demande
   aucune vérification de licence » sur un métier inconnu. Ne la « simplifie » pas en booléen.
3. **`apps/web` n'a AUCUNE config Prettier** — son style (guillemets simples) est tenu à la
   main. Un `npx prettier --write` y reformate **tout le fichier** en guillemets doubles et
   fabrique un diff hors périmètre. Ne lance jamais Prettier sur `apps/web` ; `apps/api` a un
   `.prettierrc`, lui.
4. **`next start` sert le build chargé en mémoire AU DÉMARRAGE.** Un `build` postérieur au
   serveur est **invisible** : j'ai cru un moment qu'un correctif ne prenait pas alors qu'il
   n'était pas servi. Compare `stat apps/web/.next/BUILD_ID` à l'heure de démarrage du
   processus (`ps -o lstart`) avant de conclure quoi que ce soit d'un smoke.
5. **`git pull` / `git merge` sur `main` sont bloqués par le classifieur** dans le bac à
   sable. Le rituel de fermeture reste faisable : commiter `ETAT`/`JOURNAL` **directement sur
   `main` via l'API GitHub** (`push_files`), ce qui est exactement ce que demande le mandat §9.
6. **Docker toujours absent** (`dial unix /var/run/docker.sock`). Stack montée à la main en
   ~5 min : `apt-get update` puis `postgresql-16-postgis-3` ; le cluster Debian a sa config
   dans `/etc/postgresql/16/main`, donc `pg_ctl` exige
   `-o '-c config_file=/etc/postgresql/16/main/postgresql.conf'` — sans ça il échoue sur un
   `postgresql.conf` introuvable. Rôle `linkr` créé **par la socket unix** (l'auth mot de
   passe échoue avant qu'il existe). Puis `migration:run` + le seed `quebec-catalog.seed.ts`.
7. **Le pattern d'injection de faute vaut d'être réutilisé** : déplacer l'API sur `:5002`, et
   poser sur `:5000` un proxy de 40 lignes qui `500` **une seule** route. Mêmes données, même
   utilisateur, seule la lecture visée échoue — c'est ce qui a prouvé les trois chemins rouges
   de la PR #73.

## ⛔ En attente de décision humaine

**Combien de temps conserve-t-on une recherche restée vide (tranche 2) ?**

- **Pourquoi ça bloque la conception, pas seulement le code :** ce serait la première
  collecte de renseignements personnels auprès de **quelqu'un qui n'est pas utilisateur** —
  un enregistrement **sans propriétaire et sans chemin de suppression**. La Loi 25 exige une
  **durée de conservation décidée à la conception**, pas ajoutée après coup. La colonne et la
  purge se posent dans la **même** migration ou elles ne se posent jamais.
- **Option recommandée : 12 mois, avec `expires_at_utc` écrit à l'insertion.** Une carte de
  la demande a une valeur **saisonnière** (recruter un déneigeur en octobre), donc il faut
  couvrir un cycle annuel complet ; au-delà, une adresse de contact vieille d'un an est un
  passif, pas un actif. Une colonne d'expiration explicite rend la purge **auditable** et
  indépendante d'un cron qu'on oublierait de brancher.
- **Ce que je n'ai pas fait :** rien de la tranche 2 n'est amorcé, pas même « pour préparer
  le terrain » (consigne explicite du brief).

**Décision de copie déjà tranchée par l'humain, en file :** le libellé de nav
« Mon tableau de bord » devient **« Espace pro »**. **Non appliqué en PR #73** parce que H ne
touche pas `(app)/nav.tsx` (consigne du brief : sinon, laisser en file). À appliquer par la
première PR qui touche la nav — vraisemblablement **G-2** — et à noter comme fermeture de la
régression de hauteur mesurée en #72. À arbitrer en même temps : le raccourci de l'accueil
« Accéder à mon tableau de bord prestataire », **non touché**, qui porte le même vocabulaire.

## Dettes créées par la dernière PR

**Une seule, petite et connue :** quand la lecture du catalogue échoue, l'accueil perd
**aussi** son lien d'échappement vers `/recherche` (il vit à l'intérieur de la section qui
dégrade). La nav du shell le porte toujours, donc personne n'est bloqué.

**Relevées, NON corrigées** (inchangées depuis la session précédente) :
`body { font-family: Arial… }` dans `globals.css` qui écrase les polices Geist (PR dédiée,
rayon d'impact visuel global) · aucune vérification en **mode sombre** à ce jour, nulle part ·
deux liens **en ligne dans une phrase** à 16 px introduits par #73, couverts par l'exception
« Inline » de WCAG 2.5.8 (les grossir casserait la lecture) — candidats G-2 s'il veut les
sortir du fil du texte.
