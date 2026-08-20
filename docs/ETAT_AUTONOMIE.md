# ÉTAT — Travail autonome CC

**Dernière session :** 2026-08-20 (session 11) · `main` @ `8338cce` · migration `1780520000000`

## Chantier en cours

**D — avis et évaluations : TERMINÉ.** La tranche 3 (#83) referme le chantier. Un client évalue une
transaction terminée, la retire, la réécrit ; un prestataire répond une fois ; le profil **et
maintenant la liste de résultats** affichent la note au seuil de trois.

**Session normale : une PR, puis fin.** (La session 10 en avait fait trois, à la demande explicite
de l'humain ; le régime de §4 est rétabli.)

## Découpage retenu

- [x] Session 9 — atteindre `COMPLETED` (PR #79)
- [x] **D tranche 1a — table `reviews`, écriture, retrait, lecture agrégée** (PR #80)
- [x] **D tranche 1b — l'interface cliente + le seuil à l'écran** (PR #81)
- [x] **D tranche 2 — la réponse du prestataire** (PR #82)
- [x] **D tranche 3 — les avis dans `discover`** (PR #83)
- [ ] **E — messagerie client ↔ prestataire** ← **PROCHAINE** (mandat §8, chantier 4). Lourd :
      **à découper et à écrire ici AVANT d'ouvrir la première tranche.** Sans canal, les gens
      contournent par téléphone et la transaction sort de la plateforme avec la commission.
- [ ] H tranche 2b — « Prévenez-moi » — **TOUJOURS BLOQUÉE** (chantier courriels du collaborateur).

**G-2 (cibles tactiles dans les pages) reste DÉPRIORITISÉ**, opportuniste. « Voir le détail → » =
16 px sur le tableau de bord, **non corrigé**. Les cartes de résultat de `/recherche` mesurent
**98 px** (mesuré session 11).

Bande d'horodatage : `1780510000000` → `1780599999999`. `…510000000` (#76) et `…520000000` (#80)
pris. **La prochaine migration prend `…530000000`.** Bande du collaborateur `…480/490` : intouchable.

## Chantier différé, avec sa condition de déclenchement

**Sélecteur de tri client (proximité / avis) — différé, avec condition chiffrée.**
Demandé et arbitré : l'idée est bonne, le moment ne l'est pas. Aujourd'hui l'immense
majorité des prestataires afficherait « aucun avis » : un tri par note produirait une liste
dont les premiers sont ceux réservés tôt et dont le reste est dans un ordre arbitraire — le
client clique, la liste n'a pas l'air triée, et le contrôle lui-même perd sa crédibilité.
S'y ajoute un départage sans bonne réponse : mettre les non-notés en bas reproduit l'effet
cumulatif en pire (choisi par le client, donc dédouané par la plateforme) ; en haut n'a
aucun sens ; mêlés rend le tri illisible.
**Condition de réouverture, mesurable en base** : une part significative des prestataires
**actifs** franchit le seuil de trois avis. À vérifier par sonde, pas à l'intuition.
Même discipline que le silence sur `GEOCODED`, le « pas encore assez pour décider » de la
carte de la demande, et le seuil de trois : **la plateforme n'offre pas un outil qui
prétend trier quand elle n'a rien pour trier.**

## Décisions D — arrêtées, ne se relitigent pas

Les six décisions **D-1 à D-6** sont portées en `CLAUDE.md` §13.1 (**entrées 10 et 11**) et dans
les entrées §11 des PR #80/#81/#82. Elles ne sont pas recopiées ici : §13.1 fait autorité.

**Décision d'accès (#80)** : `GET /service-providers/:providerId/reviews` est **AUTHENTIFIÉE**, pas
`@Public()`. L'ouverture appartient au chantier « `discover` public », **avec** le limiteur de débit
et le `trust proxy`. ⚠️ Le masquage « Carol R. » n'est **PAS** une conséquence de ce choix : c'est la
bonne conception **même pour un lecteur authentifié**. Ne pas le relâcher le jour où la route s'ouvre.

**Décision de tri (#83)** : la **proximité reste le tri unique** de `discover`. La note est
**affichée, jamais classante** — le cahier des charges pose l'affichage comme un filtre de proximité
**absolu**, et trier par réputation **compose** (qui a des avis est vu, donc réservé, donc accumule
des avis), ce qui condamne chaque nouvelle recrue à l'invisibilité. **Coût assumé** : deux
prestataires également proches, l'un noté l'autre non, ne se départagent pas.

## Ce que la prochaine session doit savoir

1. **⚠️ LE SEUIL DE TROIS A UNE SEULE SOURCE, ET ELLE EST FRAGILE À LA DUPLICATION.**
   `ratingAggregateSql(over: '' | ' OVER ()')` dans `reviews.repository.ts` porte le cast du compte,
   le `CASE`, le seuil et l'arrondi. Les deux lecteurs (profil en fenêtre `OVER ()`, `discover` en
   `GROUP BY`) le partagent : **le suffixe est le paramètre, la règle non.** Une troisième surface
   qui recopierait le `CASE` pourrait gater à un autre nombre **sans qu'aucun test n'échoue** — le
   symptôme serait une carte affichant une moyenne que le profil refuse d'afficher.
2. **⚠️ LE PIÈGE N+1 EST INVISIBLE SUR UNE FIXTURE, ET C'EST GÉNÉRALISABLE.** Avec deux
   prestataires, une requête par carte et une requête pour la page sont indiscernables — même
   réponse, même écran, même temps. La propriété à tester n'est jamais « la valeur est juste », c'est
   « **le compte de requêtes ne dépend pas du nombre de résultats** ». Mesuré au journal Postgres
   (`log_statement='all'`, compter les `execute <unnamed>`) : **3 énoncés pour 1 résultat, 3 pour 3**.
   Verrouillé aussi par test unitaire. **Chercher ce motif ailleurs** quand une liste s'enrichit.
3. **⚠️ `origin/main` ÉTAIT PÉRIMÉ DANS LE CONTENEUR** (`966bcd2` au lieu de `b78fdde`) : le premier
   `git diff origin/main` affichait **toute la session 10** comme nouvelle. Exactement le symptôme
   silencieux du mandat §4. **`git fetch origin --prune` AVANT de conclure quoi que ce soit d'un
   diff** — l'élagage du rituel d'ouverture n'est pas décoratif.
4. **`ReviewsDataModule` existe et ne doit pas être « simplifié ».** Module **feuille** (TypeORM
   seul) qui fournit et exporte `ReviewsRepository`, importé par `ReviewsModule` **et**
   `ServiceProvidersModule`. Il casse un cycle **réel** (`ReviewsModule → ServiceProvidersModule`
   existe déjà). **Ne pas** le remplacer par un enregistrement en provider local des deux côtés à la
   manière des gardes : c'est le seul endroit où D-3 et D-4 sont appliqués, et deux enregistrements
   casseraient au boot le jour où le dépôt gagne une dépendance de constructeur.
5. **La dégradation de `discover` est par section, comme partout ailleurs** : la lecture de note est
   dans son propre `try/catch`, un échec rend `reviewCount=0 / averageRating=null` et **jamais** une
   erreur de recherche. **Conséquence assumée** : après un échec, une carte est indiscernable d'un
   prestataire jamais évalué — les deux se taisent.
6. **Il n'y a QU'UNE surface de liste de prestataires** (`/recherche`) — vérifié : les 4 autres
   appels `/service-providers/*` du front lisent **un seul** prestataire. Pas de risque de divergence
   entre deux listes (contrairement au piège « offert ≠ résolvable », §13.1 entrée 8).
7. **⚠️ POUR SMOKER LES AVIS IL FAUT ≥ 3 AVIS VIVANTS SUR UN MÊME PRESTATAIRE**, donc ≥ 3 demandes
   `COMPLETED` (l'index unique n'en autorise qu'un par demande). Le seeder de la session 9 en produit
   **une**. J'ai utilisé un script **jetable, non commité** pilotant l'API réelle (2 prestataires de
   plus, 5 demandes jusqu'à `COMPLETED`, puis les avis). **Une fixture « prestataire noté »
   réutilisable manque toujours** — elle appartient à `dev-fixtures.seed.ts`, livrable du
   collaborateur, **non préempté**.
8. **⚠️ `POST /reviews` ET `POST /reviews/:id/response` SONT LIMITÉS À 10/h PAR APPELANT, ET LA
   GARDE COMPTE LES TENTATIVES** (400/403/409 compris). Compteur **en mémoire par processus** :
   redémarrer l'API le remet à zéro.
9. **Plafonds solidaires** : 50 avis par profil (et par tableau de bord) ↔ 100 avis propres ↔ 100
   demandes de `/requests`. Si l'un bouge, bouger les autres.
10. **⚠️ L'API GitHub `create_or_update_file` NE FAIT AUCUNE SUBSTITUTION SHELL** — passer le contenu
    **littéral**, et **RELIRE le fichier distant après écriture**. Elle peut échouer en transport
    sans rien écrire : vérifier le SHA distant avant de conclure, puis réessayer (idempotent tant que
    le SHA n'a pas bougé).
11. **Montage de la stack** : Docker **absent**, bac à sable **non persisté**, et **Postgres est
    retombé en cours de session** (le relancer sans hésiter — un script `stack.sh` idempotent au
    scratchpad paie tout de suite). Recette : `apt-get update`, `postgresql-16-postgis-3`, rôle
    `linkr` SUPERUSER, `CREATE EXTENSION postgis` **et** `pgcrypto`, `pnpm install --frozen-lockfile`,
    `.env` depuis `.env.example` (**`PORT=5000`**), `redis-server --daemonize yes`, `migration:run`,
    seed Québec, puis `completed-service-request.seed.ts`.
    ⚠️ **Ne pas `pkill -f "pnpm start"` ni un motif qui matche son propre shell** : ça tue la session
    bash (exit 144). Lancer les serveurs avec `nohup … &`.
12. **⚠️ PLAYWRIGHT N'EST PAS RÉSOLVABLE DEPUIS LE DÉPÔT** — importer par **chemin absolu**
    (`from '/opt/node22/lib/node_modules/playwright/index.mjs'`). Chromium :
    `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, `--no-sandbox`.
13. **⚠️ INJECTION DE FAUTE SANS PROXY** : `ALTER TABLE x RENAME TO x_hidden`, tester, renommer en
    sens inverse. **Et poser un CONTRÔLE** : en session 11, le 500 du profil (qui n'a pas de repli)
    au même instant est ce qui prouve que le 200 de `discover` n'était pas un faux négatif.
14. **Ni écrire un avis, ni y répondre, ni en afficher un ne notifie qui que ce soit.**
    `notifications` est le chantier du collaborateur : **non touché, délibérément**.
15. **Ma base n'est pas celle de l'humain.** La mienne est repartie de zéro ; la sienne porte les
    ~43 demandes et les lignes `SONDE-*`/`SMOKE-*` verrouillées en `ON DELETE RESTRICT`.
16. **Rappels** : écrire `ETAT`/`JOURNAL` sur `main` **via l'API GitHub** · ne jamais lancer Prettier
    sur `apps/web` · lire le nom de branche **depuis la PR** · `MANDAT_01_fixtures.md` toujours pas
    entamé (assigné au collaborateur).

## ⛔ En attente de décision humaine

**AUCUNE.** Les six décisions D sont arrêtées et portées ; le tri de `discover` est tranché
(proximité seule) et le sélecteur de tri est enregistré ci-dessus comme chantier différé avec sa
condition de réouverture.

**Relevés, non bloquants — deux arbitrages produit qui attendent l'humain, jamais moi :**

1. **Le 502-laisse-`ASSIGNED`** (session 9) : une panne Stripe laisse la demande assignée **sans
   dépôt**, avec un `DEPOSIT` `FAILED` que rien ne reprend. Toute correction touche la capture ⇒
   **arrêt dur §3**.
2. **« Deux causes, un 409 » sur l'écran client des avis** : « cette demande a déjà un avis » **ou**
   « le travail n'est pas terminé » se mappent au même code, et le verrou 3.12b impose le mappage par
   **code HTTP seul**. La sortie honnête est de **distinguer les codes côté API**, jamais de parser
   le corps côté front. **Décision d'architecture**, hors périmètre de la tranche 3.

## Dettes créées par la dernière PR

1. **`ratingFmt` mirroité** dans `provider-card.tsx` depuis `reviews-block.tsx` (const local non
   exporté des deux côtés) — même forme que la dette « helper de statut partagé », **ni élargie ni
   payée**.
2. **Pas de fixture « prestataire noté » réutilisable** (point 7 ci-dessus) — relevée, non prise.

**Inchangées** : dette de contrat `discover` (**annotation « tableau nu » mensongère** vs enveloppe
au runtime → miroir + cast front ; le correctif est un DTO d'enveloppe dédié, patron 3.12a-back-fix)
· écrire un avis **ne notifie personne** · pas de pagination (plafonds solidaires, point 9) ·
`updateReturningRows()` recopié **6×** · repli 502 des BFF **tutoyant** · cibles tactiles **dans les
pages** (G-2) · aucun index des consoles admin · `locality` au géocodage · le foyer *feature
toggling* · les 5 occurrences restantes de « tableau de bord » · `globals.css` écrase les polices
Geist · aucune vérification en **mode sombre** · notifications prestataire ORGANIZATION illisibles ·
`docker/data/` tracké par git · verrou du refus `REJECTED` · `trust proxy` absent de `main.ts`.

**Conséquence assumée, pas une dette** : les FK de `reviews` sont `ON DELETE RESTRICT`, donc une
demande `COMPLETED` portant un avis — et le prestataire qu'il nomme — ne peuvent plus jamais être
supprimés en dur. Cohérent avec la suppression douce partout (§13).
