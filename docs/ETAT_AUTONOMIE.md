# ÉTAT — Travail autonome CC

**Dernière session :** 2026-08-20 (session 10) · `main` @ `53512c4` · migration `1780520000000`

## Chantier en cours

**D — avis et évaluations.**
- **Tranche 1a : MERGÉE** (PR #80, `91dc411`) — table `reviews`, écriture, suppression douce, lecture agrégée.
- **Tranche 1b : PR #81** — l'interface cliente. **Décision D-6 rendue** ; merge en cours.

⚠️ **Session longue assumée** : deux PR dans une session, à la demande explicite de l'humain. Déroge à
mandat §4. Signalé sur le moment, pas découvert après coup.

## Découpage retenu

- [x] Session 9 — atteindre `COMPLETED` (PR #79)
- [x] **D tranche 1a — la table `reviews` (PR #80, mergée)**
- [~] **D tranche 1b — écrire / voir / retirer + seuil à l'écran (PR #81)** — décision D-6 rendue
- [ ] **D tranche 2 — la réponse du prestataire** ← **PROCHAINE** une fois #81 mergée. La **colonne
      existe déjà** (`provider_response` + `provider_responded_at_utc`, posées par #80, jamais écrites,
      absentes des DTO). Il manque : l'endpoint, l'écran prestataire, et l'exposition en lecture.
- [ ] D tranche 3 — intégration à `discover` (tri, affichage en liste). ⚠️ **C'est là que vit
      l'avertissement N+1** : une requête groupée pour toute la page, jamais une par prestataire.
- [ ] H tranche 2b — « Prévenez-moi » — **TOUJOURS BLOQUÉE** (chantier courriels du collaborateur).

**G-2 (cibles tactiles dans les pages) reste DÉPRIORITISÉ**, opportuniste. Mesuré en session 9 :
« Voir le détail → » = 16 px sur le tableau de bord. **Non touché en 1b** (autre page) ; en revanche
toutes les cibles introduites par 1b sont à **44 px**, mesurées.

Bande d'horodatage : `1780510000000` → `1780599999999`. `…510000000` (#76) et `…520000000` (#80) pris.
**La prochaine migration prend `…530000000`.** Bande du collaborateur `…480/490` : intouchable.

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

**Décision d'accès (rendue sur #80)** : `GET /service-providers/:providerId/reviews` est
**AUTHENTIFIÉE**, pas `@Public()`. Son consommateur vit sous `(app)` et est privé, donc une route
publique n'aurait **aucun appelant** — et une surface publique sans appelant est une surface qu'on
oublie de surveiller. **L'ouverture appartient au chantier « `discover` public »**, qui la prendra
**avec** le limiteur de débit et le `trust proxy`. ⚠️ **Le masquage « Carol R. » n'est PAS une
conséquence de ce choix** : c'est la bonne conception **même pour un lecteur authentifié**. Ne pas
le relâcher, ni maintenant, ni le jour où la route s'ouvrira.

**D-6 — Une demande `REFUNDED` après complétion reste évaluable** (décision rendue sur #81) :

> REFUNDED reste évaluable — décision retenue, ne pas ajouter d'exclusion. Le service a eu lieu,
> `completedAtUtc` en atteste, et exclure un client remboursé biaiserait la moyenne à la hausse en
> retirant la parole à celui qui a le plus à dire. Le contrepoids est D-2, le droit de réponse du
> prestataire.
>
> L'invariant : **le droit d'évaluer se teste sur `completedAtUtc`, jamais sur le statut courant** —
> un statut est transitoire, un horodatage de complétion ne l'est pas. C'est ce qui a failli faire
> mourir le droit d'évaluer 72 h après le travail.

Porté en `CLAUDE.md` §13.1 (entrée 11) sous l'amendement §3.9.

## Ce que la prochaine session doit savoir

1. **#81 porte la décision D-6 et part au merge.** Après merge : `git fetch origin --prune`, puis
   la tranche 2 part de là. **Ne rien empiler dessus avant.**
2. **⚠️ LE DÉFAUT LE PLUS IMPORTANT DE LA SESSION, ET IL EST GÉNÉRALISABLE : une garde sur un
   STATUT COURANT expire quand le statut avance.** #80 exigeait `status === 'COMPLETED'` ; le cron
   d'auto-libération fait passer en `PAID` après 72 h, donc le droit d'évaluer mourait
   silencieusement trois jours après le travail. **Invisible au smoke parce que `COMPLETED → PAID`
   est inatteignable sans Stripe réel.** #81 corrige : la garde teste **`completedAtUtc !== null`**,
   un horodatage d'audit posé une fois et jamais effacé. **Chercher ce motif ailleurs** — toute
   garde écrite `status === X` sur un état traversé plutôt que terminal a le même défaut.
3. **⚠️ LA COLONNE `provider_response` EXISTE DÉJÀ ET N'EST DANS AUCUN DTO.** La tranche 2 est
   donc **purement additive au contrat** : un endpoint prestataire, l'exposition en lecture, un
   écran. **Ne pas re-migrer.** La paire `provider_response` / `provider_responded_at_utc` est
   gardée par `chk_reviews_response_paired` (les deux, ou aucune) — l'écriture doit poser les deux.
4. **⚠️ LA MOYENNE ARRIVE DÉJÀ GATÉE À TROIS (D-4), CÔTÉ SQL.** Ne jamais la recalculer depuis
   `items` : ça défait la règle **et** ça ment dès que le plafond de 50 mord. Même piège que
   recalculer un badge de non-lus depuis une page tronquée.
5. **`GET /reviews/mine` existe et c'est ce qui rend « voir » et « retirer » possibles.** Le DTO
   public ne porte **ni** `serviceRequestId` **ni** id d'auteur (minimisation, maintenue) — donc
   rien d'autre ne permet à un client de reconnaître son avis. **Plafonds solidaires** : 100 avis
   propres ↔ `?limit=100` des demandes ↔ 50 avis par profil. Si l'un bouge, bouger les autres.
6. **⚠️ `POST /reviews` EST LIMITÉ À 10/h PAR APPELANT, ET LA GARDE COMPTE LES TENTATIVES.**
   Vérifié en me faisant couper au milieu d'un smoke par mes propres 400/403/409. Compteur **en
   mémoire par processus** : redémarrer l'API le remet à zéro. À savoir avant de crier au bogue.
7. **⚠️ `3.5` N'EST PAS REJETÉ PAR LA BASE** — PostgreSQL l'arrondit à `4` avant le `CHECK` (mesuré
   par `INSERT` brut). Seul `@IsInt()` du DTO le rejette (400). Ne jamais relâcher ce validateur.
8. **Le patron d'autorisation « l'appelant est le client de cette demande » est celui de
   `confirmCompletion`, PAS `ServiceRequestsService.getById`** — ce dernier porte un contournement
   ADMIN qui laisserait un administrateur publier un avis sous son propre nom sur la transaction
   d'un tiers. `ServiceRequestsModule` exporte `ServiceRequestRepository` pour ça.
9. **⚠️ L'API GitHub `create_or_update_file` NE FAIT AUCUNE SUBSTITUTION SHELL.** J'ai passé
   `$(cat)` comme contenu et **écrasé `JOURNAL_AUTONOMIE.md` par 6 octets** ; restauré au commit
   suivant (`53512c4`), rien de perdu. **Toujours passer le contenu littéral**, et **relire le
   fichier distant après écriture**.
10. **Montage de la stack** : Docker **absent**, bac à sable **non persisté** (3ᵉ fois de suite —
    sonder, jamais présumer). Recette : `apt-get update`, `postgresql-16-postgis-3`, rôle `linkr`
    SUPERUSER, `CREATE EXTENSION postgis` **et** `pgcrypto`, `pnpm install --frozen-lockfile`,
    `.env` depuis `.env.example` (**`PORT=5000`**), `redis-server --daemonize yes`, `migration:run`,
    seed Québec, puis `completed-service-request.seed.ts`.
11. **⚠️ PLAYWRIGHT N'EST PAS RÉSOLVABLE DEPUIS LE DÉPÔT** — il vit dans
    `/opt/node22/lib/node_modules/playwright`. Importer par **chemin absolu**
    (`from '/opt/node22/lib/node_modules/playwright/index.mjs'`) ; `NODE_PATH` ne suffit pas en ESM.
    Chromium : `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, `--no-sandbox`.
12. **⚠️ `estimatedAmount` est un NOMBRE, pas une chaîne** dans `POST /service-requests` — un
    `"150.00"` fait 400. Une minute perdue à chaque session qui sème une demande à la main.
13. **Écrire un avis ne notifie PERSONNE.** `notifications` est le chantier du collaborateur :
    **non touché, délibérément**. À arbitrer avec lui, pas à trancher seul.
14. **§13.1 a gagné une entrée 10** (textes **verbatim** de D-3/D-4/D-5, trois notes de portage
    signalées hors texte), sous l'amendement §3.9. **Modifier ou supprimer** une entrée existante
    reste un arrêt dur.
15. **Ma base n'est pas celle de l'humain.** La mienne est repartie de zéro ; la sienne porte les
    ~43 demandes et les lignes `SONDE-*`/`SMOKE-*` verrouillées en `ON DELETE RESTRICT`.
16. **Rappels** : écrire `ETAT`/`JOURNAL` sur `main` **via l'API GitHub** · ne jamais lancer
    Prettier sur `apps/web` · lire le nom de branche **depuis la PR** · `MANDAT_01_fixtures.md`
    toujours pas entamé (assigné au collaborateur).

## ⛔ En attente de décision humaine

**AUCUNE.** La question ouverte sur #81 (`REFUNDED` évaluable) est **tranchée** — voir **D-6**
ci-dessus, portée en §13.1.

**Relevé, non bloquant** : le 502-laisse-`ASSIGNED` (session 9) reste un arbitrage produit **et** un
arrêt dur technique.

## Dettes créées par les deux dernières PR

1. **La contrainte de lancement de #80 est LEVÉE par #81** — le retrait est atteignable par son
   auteur. ⚠️ **Elle se re-referme si #81 n'est pas mergée** : pas d'avis en production sans elle.
2. **Écrire un avis ne notifie personne** (point 13).
3. **Pas de pagination** : 50 avis par profil, 100 avis propres, 100 demandes — **solidaires**.
4. `updateReturningRows()` recopié une **6ᵉ** fois (payment / refund / quote / stripe-connect /
   notifications / reviews) — le helper partagé reste un chore distinct.
5. La dette « helper de statut partagé » entre tableau de bord et `/requests` : **inchangée**.

**Conséquence assumée, pas une dette** : les FK de `reviews` sont `ON DELETE RESTRICT`, donc une
demande `COMPLETED` portant un avis — et le prestataire qu'il nomme — ne peuvent plus jamais être
supprimés en dur. Cohérent avec la suppression douce partout (§13).

**Relevées, inchangées** : cibles tactiles **dans les pages** (G-2) · aucun index des consoles
admin · `locality` au géocodage · le foyer *feature toggling* · les 5 occurrences restantes de
« tableau de bord » · `globals.css` écrase les polices Geist · aucune vérification en **mode
sombre** · notifications prestataire ORGANIZATION illisibles · `docker/data/` tracké par git ·
verrou du refus `REJECTED` · `trust proxy` absent de `main.ts` · repli 502 des BFF **tutoyant**.
