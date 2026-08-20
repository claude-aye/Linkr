# ÉTAT — Travail autonome CC

**Dernière session :** 2026-08-20 (session 10) · `main` @ `8564a9d` · migration `1780520000000`

## Chantier en cours

**D — avis et évaluations.** **Trois tranches mergées dans la session** : 1a (#80), 1b (#81), 2 (#82).
Le chantier est **utilisable de bout en bout** : un client évalue une transaction terminée, voit et
retire son avis ; un prestataire répond une fois ; le profil affiche la note au seuil de trois.

⚠️ **Session très longue, assumée** : **trois** PR dans une session, à la demande explicite de
l'humain. Déroge à mandat §4, signalé sur le moment à chaque fois. **La prochaine session repart
normalement : une PR, puis fin.**

## Découpage retenu

- [x] Session 9 — atteindre `COMPLETED` (PR #79)
- [x] **D tranche 1a — table `reviews`, écriture, retrait, lecture agrégée** (PR #80)
- [x] **D tranche 1b — l'interface cliente + le seuil à l'écran** (PR #81)
- [x] **D tranche 2 — la réponse du prestataire** (PR #82)
- [ ] **D tranche 3 — intégration à `discover`** ← **PROCHAINE**. Tri et/ou affichage de la note
      dans la liste de résultats. ⚠️ **C'est là que vit l'avertissement N+1** : **une requête
      groupée pour toute la page, jamais une par prestataire.** L'agrégat existe déjà
      (`findByProviderWithAggregate`) mais il est **par prestataire** — le réutiliser tel quel dans
      une boucle serait exactement le défaut à éviter. Prévoir une méthode qui agrège **pour un
      ensemble d'ids**, et **rappeler que la moyenne reste gatée à trois** (D-4) : une carte de
      résultat ne doit pas afficher une note que le profil refuse d'afficher.
- [ ] H tranche 2b — « Prévenez-moi » — **TOUJOURS BLOQUÉE** (chantier courriels du collaborateur).

**G-2 (cibles tactiles dans les pages) reste DÉPRIORITISÉ**, opportuniste. « Voir le détail → » =
16 px sur le tableau de bord (mesuré session 9), **non corrigé**. Toutes les cibles introduites par
les trois PR de cette session sont à **44 px**, mesurées.

Bande d'horodatage : `1780510000000` → `1780599999999`. `…510000000` (#76) et `…520000000` (#80)
pris. **La prochaine migration prend `…530000000`.** Bande du collaborateur `…480/490` : intouchable.

## Décisions D — arrêtées, ne se relitigent pas

**D-1 — L'avis est lié à une transaction terminée.** Seul le client d'une demande passée en
`COMPLETED` peut évaluer, et seulement le prestataire de cette demande. Infalsifiable par
construction : un faux avis ne peut pas exister, donc aucune modération n'est à inventer
pour l'écarter.

**D-2 — Le prestataire peut répondre, une seule fois, et le client ne contre-répond pas.**
L'asymétrie est le cœur du problème : un client mécontent coûte des semaines de revenus à
un artisan en trente secondes. Une réponse unique rétablit l'équilibre sans ouvrir un fil
qui dégénère. **La réponse est une colonne sur la ligne d'avis, jamais une seconde entité :**
« une seule réponse » devient une propriété du schéma plutôt qu'une règle applicative à
faire respecter.

**D-3 — Pas de modification, suppression possible par l'auteur.** Modifier après une
réponse déjà publiée accolerait cette réponse à un texte qu'elle ne commentait pas — un
mécanisme de piégeage, sans usage légitime qu'une suppression suivie d'un nouvel avis ne
couvre. La suppression, elle, doit exister (droit de retrait). **Elle est DOUCE, elle
emporte la réponse du prestataire** (une réponse orpheline commente un texte illisible),
**et la note agrégée EXCLUT les avis supprimés.** Ne pas grossir la dette « suppression
douce en cascade sur 2 tables sur 20 » : celle-ci se traite correctement dès le départ.

**D-4 — Aucune moyenne affichée en dessous de TROIS avis.** Le compte et les avis
s'affichent ; la moyenne, non. Une moyenne sur un avis n'est pas une statistique, c'est une
opinion déguisée — et elle condamne ou survend un artisan sur un échantillon d'un. Troisième
application du même principe produit : le silence sur `GEOCODED`, le « pas encore assez pour
décider » de la carte de la demande, et ceci. **La plateforme ne prétend jamais savoir ce
qu'elle ne sait pas.**

**D-5 — Note obligatoire de 1 à 5, commentaire facultatif, aucune sous-note.** La note
s'agrège, donc elle est requise. Le commentaire obligatoire ferait chuter le volume, et
c'est le volume qui rend le seuil de trois atteignable. Pas de sous-notes par critère :
trois fois la friction, trois fois les colonnes, et elles corrèlent trop pour dire grand
chose de plus. **La note est un entier contraint en base — `CHECK` entre 1 et 5, jamais un
flottant.** Ce qui ne peut pas être représenté ne peut pas arriver.

**D-6 — Une demande `REFUNDED` après complétion reste évaluable** (décision rendue sur #81) :

> REFUNDED reste évaluable — décision retenue, ne pas ajouter d'exclusion. Le service a eu lieu,
> `completedAtUtc` en atteste, et exclure un client remboursé biaiserait la moyenne à la hausse en
> retirant la parole à celui qui a le plus à dire. Le contrepoids est D-2, le droit de réponse du
> prestataire.
>
> L'invariant : **le droit d'évaluer se teste sur `completedAtUtc`, jamais sur le statut courant** —
> un statut est transitoire, un horodatage de complétion ne l'est pas. C'est ce qui a failli faire
> mourir le droit d'évaluer 72 h après le travail.

Portée en `CLAUDE.md` §13.1 (**entrée 11**) sous l'amendement §3.9.

**Décision d'accès (rendue sur #80)** : `GET /service-providers/:providerId/reviews` est
**AUTHENTIFIÉE**, pas `@Public()`. Son consommateur vit sous `(app)` et est privé, donc une route
publique n'aurait **aucun appelant** — et une surface publique sans appelant est une surface qu'on
oublie de surveiller. **L'ouverture appartient au chantier « `discover` public »**, qui la prendra
**avec** le limiteur de débit et le `trust proxy`. ⚠️ **Le masquage « Carol R. » n'est PAS une
conséquence de ce choix** : c'est la bonne conception **même pour un lecteur authentifié**. Ne pas
le relâcher, ni maintenant, ni le jour où la route s'ouvrira.

## Ce que la prochaine session doit savoir

1. **⚠️ LE DÉFAUT LE PLUS IMPORTANT DE LA SESSION, ET IL EST GÉNÉRALISABLE : une garde sur un
   STATUT COURANT expire quand le statut avance.** #80 exigeait `status === 'COMPLETED'` ; le cron
   d'auto-libération fait passer en `PAID` après 72 h, donc le droit d'évaluer mourait
   silencieusement trois jours après le travail. **Invisible au smoke parce que `COMPLETED → PAID`
   est inatteignable sans Stripe réel.** #81 corrige avec `completedAtUtc !== null`. **Chercher ce
   motif ailleurs dans le dépôt** — c'est écrit en §13.1 entrée 11.
2. **⚠️ TRANCHE 3 = LE PIÈGE N+1.** L'agrégat existant est **par prestataire**
   (`findByProviderWithAggregate`) : l'appeler dans une boucle sur les résultats de `discover` est
   exactement ce qu'il ne faut pas faire. Écrire une méthode qui agrège **pour un ensemble d'ids**,
   en une requête. Et **la moyenne reste gatée à trois** — une carte de résultat ne doit pas
   afficher une note que le profil refuse d'afficher.
3. **⚠️ LE MUR ET LA PORTE — deux 409 qui se ressemblent et ne se comportent pas pareil.** Client :
   « cette demande a déjà un avis » est une **porte** (retirer puis réécrire, l'index partiel libère
   le créneau). Prestataire : « cet avis a déjà une réponse » est un **mur** (écrite une fois,
   jamais modifiée, jamais retirée ; seul le retrait de l'avis la fait disparaître). Ne pas
   « harmoniser » les deux.
4. **⚠️ 403 vs 404 — la divergence est raisonnée, pas une incohérence.** `DELETE /reviews/:id` → 404
   sur ce qui n'est pas à l'appelant (les avis d'un client ne sont énumérables par personne).
   `POST /reviews/:id/response` → 403 (les ids **sont** énumérables via la liste d'un prestataire,
   donc un 403 ne divulgue rien).
5. **La colonne `provider_response` est désormais ÉCRITE et EXPOSÉE** (#82). La paire
   `provider_response` / `provider_responded_at_utc` est gardée par `chk_reviews_response_paired` :
   **les deux, ou aucune**, dans la même instruction.
6. **⚠️ `POST /reviews` ET `POST /reviews/:id/response` SONT LIMITÉS À 10/h PAR APPELANT, ET LA
   GARDE COMPTE LES TENTATIVES.** Vérifié en me faisant couper au milieu d'un smoke par mes propres
   400/403/409. Compteur **en mémoire par processus** : redémarrer l'API le remet à zéro.
7. **⚠️ `3.5` N'EST PAS REJETÉ PAR LA BASE** — PostgreSQL l'arrondit à `4` avant le `CHECK` (mesuré
   par `INSERT` brut). Seul `@IsInt()` du DTO le rejette (400). Ne jamais relâcher ce validateur.
8. **Plafonds solidaires** : 50 avis par profil (et par tableau de bord) ↔ 100 avis propres ↔ 100
   demandes de `/requests`. Si l'un bouge, bouger les autres.
9. **⚠️ L'API GitHub `create_or_update_file` NE FAIT AUCUNE SUBSTITUTION SHELL** — j'ai passé
   `$(cat)` et **écrasé `JOURNAL_AUTONOMIE.md` par 6 octets** (restauré au commit suivant, rien
   perdu). **Toujours passer le contenu littéral, et RELIRE le fichier distant après écriture.**
   Elle a aussi **échoué deux fois en transport** (`connection timeout`) sans rien écrire : **vérifier
   le SHA distant avant de conclure**, puis réessayer — c'est idempotent tant que le SHA n'a pas bougé.
10. **Montage de la stack** : Docker **absent**, bac à sable **non persisté**, et **Postgres est
    retombé en cours de session** (le relancer sans hésiter). Recette : `apt-get update`,
    `postgresql-16-postgis-3`, rôle `linkr` SUPERUSER, `CREATE EXTENSION postgis` **et** `pgcrypto`,
    `pnpm install --frozen-lockfile`, `.env` depuis `.env.example` (**`PORT=5000`**),
    `redis-server --daemonize yes`, `migration:run`, seed Québec, puis
    `completed-service-request.seed.ts`.
11. **⚠️ PLAYWRIGHT N'EST PAS RÉSOLVABLE DEPUIS LE DÉPÔT** — importer par **chemin absolu**
    (`from '/opt/node22/lib/node_modules/playwright/index.mjs'`) ; `NODE_PATH` ne suffit pas en ESM.
    Chromium : `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, `--no-sandbox`.
12. **⚠️ INJECTION DE FAUTE SANS PROXY, ET C'EST BIEN PLUS SIMPLE** : `ALTER TABLE x RENAME TO
    x_hidden`, tester, puis renommer en sens inverse. Une seule route casse, les données sont
    intactes, et ça prouve une dégradation par section pour de vrai. Utilisé en #82.
13. **⚠️ `estimatedAmount` est un NOMBRE, pas une chaîne** dans `POST /service-requests` — un
    `"150.00"` fait 400.
14. **Ni écrire un avis, ni y répondre ne notifie qui que ce soit.** `notifications` est le chantier
    du collaborateur : **non touché, délibérément**. À arbitrer avec lui, pas à trancher seul.
15. **§13.1 a gagné DEUX entrées cette session** — **10** (D-3/D-4/D-5 verbatim) et **11** (D-6 +
    l'invariant `completedAtUtc`), sous l'amendement §3.9. **Modifier ou supprimer** une entrée
    existante reste un arrêt dur.
16. **Ma base n'est pas celle de l'humain.** La mienne est repartie de zéro ; la sienne porte les
    ~43 demandes et les lignes `SONDE-*`/`SMOKE-*` verrouillées en `ON DELETE RESTRICT`.
17. **Rappels** : écrire `ETAT`/`JOURNAL` sur `main` **via l'API GitHub** · ne jamais lancer
    Prettier sur `apps/web` · lire le nom de branche **depuis la PR** · `MANDAT_01_fixtures.md`
    toujours pas entamé (assigné au collaborateur).

## ⛔ En attente de décision humaine

**AUCUNE.** Les six décisions D sont arrêtées et portées ; la question d'accès de #80 et la question
`REFUNDED` de #81 sont tranchées.

**Relevé, non bloquant** : le 502-laisse-`ASSIGNED` (session 9) reste un arbitrage produit **et** un
arrêt dur technique — à trancher quand l'humain le voudra, jamais par moi.

## Dettes créées par la session

1. **Ni l'écriture d'un avis ni la réponse ne notifient** — `notifications` est le chantier du
   collaborateur, non touché.
2. **Pas de pagination** : 50 avis par profil et par tableau de bord, 100 avis propres, 100
   demandes — **solidaires** (point 8).
3. `updateReturningRows()` recopié une **6ᵉ** fois (payment / refund / quote / stripe-connect /
   notifications / reviews) — le helper partagé reste un chore distinct.
4. La dette « helper de statut partagé » entre tableau de bord et `/requests` : **inchangée**.

**Soldée** : la contrainte de lancement de #80 (« pas d'avis en production avant que le retrait soit
atteignable par son auteur ») — levée par #81.

**Conséquence assumée, pas une dette** : les FK de `reviews` sont `ON DELETE RESTRICT`, donc une
demande `COMPLETED` portant un avis — et le prestataire qu'il nomme — ne peuvent plus jamais être
supprimés en dur. Cohérent avec la suppression douce partout (§13).

**Relevées, inchangées** : cibles tactiles **dans les pages** (G-2) · aucun index des consoles
admin · `locality` au géocodage · le foyer *feature toggling* · les 5 occurrences restantes de
« tableau de bord » · `globals.css` écrase les polices Geist · aucune vérification en **mode
sombre** · notifications prestataire ORGANIZATION illisibles · `docker/data/` tracké par git ·
verrou du refus `REJECTED` · `trust proxy` absent de `main.ts` · repli 502 des BFF **tutoyant**.
