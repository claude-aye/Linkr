# ÉTAT — Travail autonome CC

**Dernière session :** 2026-08-20 (session 9) · `main` @ `40fb65a` · migration `1780510000000` (inchangée)

## Chantier en cours

**D — avis et évaluations.** Le terrain est prêt : **`COMPLETED` est atteignable** depuis la PR #79.
Les **cinq décisions** du chantier sont arrêtées (plus bas) et **ne se relitigent pas**.

## Découpage retenu

- [x] **Session 9 — atteindre `COMPLETED` (PR #79, mergée)** — hors file, brief humain
- [ ] **D tranche 1 — la table `avis` + l'écriture** ← **PROCHAINE**, première vraie migration sous autonomie
- [ ] D tranche 2 — lecture, moyenne au seuil de 3, réponse du prestataire
- [ ] H tranche 2b — « Prévenez-moi » — **TOUJOURS BLOQUÉE** tant que le chantier courriels du
      collaborateur est en bac à sable. **Rien n'est amorcé, délibérément.**

**G-2 (cibles tactiles dans les pages) reste DÉPRIORITISÉ** — opportuniste, dans la PR qui touche la
page. **Mesuré en session 9 sur une carte réellement rendue** : « Voir le détail → » = **16 px**,
3 cibles sous le plancher 24 px de WCAG 2.5.8, sur les cartes de jobs du tableau de bord.

Bande d'horodatage : `1780510000000` → `1780599999999` (**`…510000000` pris par #76** ; **la prochaine
migration prend `…520000000`** — ce sera celle de D. La bande du collaborateur `…480/490` reste
intouchable).

## Décisions D — arrêtées avant le chantier

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

## Ce que la prochaine session doit savoir

1. **⚠️ `COMPLETED` EST ATTEIGNABLE — joue la fixture, ne refais pas l'enquête.**
   `npx ts-node -r tsconfig-paths/register src/database/seeders/completed-service-request.seed.ts`
   (idempotent, clés naturelles, refuse `NODE_ENV=production`). Elle laisse **trois** demandes,
   **une par état** : `ASSIGNED` / `IN_PROGRESS` / `COMPLETED`. Prestataire `bob@linkr.test`,
   client `carol@linkr.test`, métier `coiffure` — tout surchargeable par `FIXTURE_*`.
2. **⚠️ L'ÉTAT ET L'ARGENT SONT SÉPARÉS PAR UN `commit`, ET C'EST LA CLÉ DE TOUT.**
   `assertPayable` est une vérification de **données pures** (aucun réseau) : elle veut
   `stripe_connect_accounts.charges_enabled` **ET** un moyen de paiement par défaut côté client —
   **deux** gardes, **deux** messages 409 différents. Mais `captureDeposit` part **APRÈS**
   `commitTransaction()` et fait un **vrai appel synchrone** à `api.stripe.com`. Donc le
   `POST /accept` peut répondre **502** alors que la demande **EST `ASSIGNED`**.
3. **⚠️ LE DÉPÔT EST `FAILED` PAR CONCEPTION, DANS TOUT ENVIRONNEMENT — ne pas partir en chasse.**
   Avec les identifiants fabriqués (le défaut), Stripe les rejette **aussi** avec de vraies clés de
   test. Un dépôt `SUCCEEDED` exige trois objets Stripe test réels que **seul l'onboarding Connect
   réel produit** (chantier distinct, non planifié). Couture prévue : `FIXTURE_STRIPE_ACCOUNT_ID` /
   `_CUSTOMER_ID` / `_PAYMENT_METHOD_ID`.
4. **`COMPLETED → PAID` reste INATTEIGNABLE**, et **D n'en a pas besoin** (il se greffe sur
   `COMPLETED`). Aucun `PAID` n'existe toujours dans l'histoire de la base.
5. **⚠️ `ASSIGNED → IN_PROGRESS → COMPLETED` est financièrement INERTE** — `startRequest` et
   `completeRequest` n'appellent **aucun** `paymentsService`. Seul `confirmCompletion` capture le
   solde. Mesuré, pas déduit.
6. **Dette relevée en #79, NON corrigée, arbitrage humain** : un 502 de capture laisse la demande
   `ASSIGNED` **sans dépôt** — en production, une panne Stripe ferait voir au prestataire « Service
   momentanément indisponible » alors que **le job lui est assigné**, avec un `DEPOSIT` `FAILED` que
   rien ne reprend. **Toute correction touche la logique de capture ⇒ arrêt dur.**
7. **⚠️ MON `main` LOCAL ÉTAIT PÉRIMÉ ET LE DIFF MENTAIT — le piège du mandat §4 a mordu pour de
   vrai.** `git diff main` montrait 14 fichiers (le contenu de #78) parce que la réf locale traînait
   à `966bcd2`. **Toujours `git fetch origin --prune` puis differ contre `origin/main`**, jamais
   contre `main`.
8. **⚠️ `pkill -f <motif>` A TUÉ MON PROPRE SHELL** (le motif matchait ma ligne de commande) — même
   famille que le piège `grep` sur `ps` déjà noté deux fois. **Écrire le PID au lancement et tuer par
   ce PID.** Idem : `C="curl --noproxy *"` se fait **globber** par le shell — utiliser une fonction.
9. **Montage de la stack** : Docker **absent**, et le bac à sable **N'A PAS persisté** cette fois
   (contrairement aux sessions 7→8 — **sonder, ne jamais présumer**). Recette : `apt-get update`,
   `postgresql-16-postgis-3`, rôle `linkr` SUPERUSER, `CREATE EXTENSION postgis`, `pnpm install`,
   `.env` depuis `.env.example` (**`PORT=5000`**), `migration:run`, seed Québec. Migrations =
   `typeorm_migrations`. Chromium : `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (**pas**
   `/opt/pw-browsers/chromium/…`), `--no-sandbox`.
10. **Salle blanche = créer une SECONDE base** (`CREATE DATABASE linkr_clean`, additif, jamais un
    `DROP`) **et redémarrer l'API dessus** — sinon la fixture parle en HTTP à une base et en SQL à
    une autre. Le piège est silencieux.
11. **`common/rate-limit/` attend toujours son deuxième usager.** `@RateLimit({ limit, windowSeconds })`
    au site d'appel + garde en **provider local du module**. Une route non décorée est **inerte**.
    **⚠️ Le jour du `discover` public** : `main.ts` ne pose **aucun `trust proxy`** ⇒ tous les
    anonymes partageraient un budget derrière un répartiteur.
12. **Le contrat propre en amont paie immédiatement** : `@ApiProperty` à **type concret** +
    `additionalProperties` sur les maps i18n ⇒ **zéro `Record<string, never>`**, donc zéro miroir et
    zéro cast côté front. **À appliquer d'emblée aux DTO d'avis.**
13. **L'amendement §3.9 est actif** : tu peux **AJOUTER** une entrée `CLAUDE.md` §13.1 quand la
    décision humaine est écrite **mot pour mot** dans ce fichier. **Modifier ou supprimer** une
    entrée existante reste un arrêt dur. *(Aucune entrée ajoutée en session 9.)*
14. **Ma base n'est pas celle de l'humain.** La mienne est repartie de zéro cette session ; celle de
    l'humain porte les ~40 demandes, les notifications et les lignes `SONDE-*`/`SMOKE-*` verrouillées
    en `ON DELETE RESTRICT`. **Aucun de mes comptes n'affirme quoi que ce soit sur la sienne.**
15. **Rappels toujours valables** : écrire `ETAT`/`JOURNAL` sur `main` **via l'API GitHub** · ne
    jamais lancer Prettier sur `apps/web` · `MANDAT_01_fixtures.md` toujours pas entamé
    (`dev-fixtures.seed.ts` et `seed:*` **assignés au collaborateur** — nom délibérément non pris
    en #79).

## ⛔ En attente de décision humaine

**AUCUNE.** Les cinq décisions D sont arrêtées et portées ci-dessus.

**Relevé, non bloquant** : le 502-laisse-`ASSIGNED` (point 6) est un arbitrage produit **et** un arrêt
dur technique — à trancher quand l'humain le voudra, jamais par moi.

## Dettes créées par la dernière PR

**Aucune dette de code.** #79 en **solde une** (« `JobCard` jamais smoké », ouverte depuis la phase F —
le composant est désormais rendu, mesuré et capturé) et n'ajoute aucun fichier de production.

**Conséquences assumées et écrites** (des propriétés connues, pas des dettes) : les dépôts de fixture
sont `FAILED` **par conception** · le cron de libération horaire balaiera la demande `COMPLETED` et
échouera sur `DepositNotSettledException` après 72 h (journalisé, jamais bloquant, mais bruyant en
développement) · `COMPLETED → PAID` reste inatteignable.

**Relevées, inchangées** : le 502-laisse-`ASSIGNED` (nouveau, point 6) · cibles tactiles **dans les
pages** (G-2 — « Voir le détail → » à 16 px, désormais **mesuré**) · aucun index des consoles admin ·
`locality` au géocodage · le foyer *feature toggling* · les 5 occurrences restantes de « tableau de
bord » · `globals.css` écrase les polices Geist · aucune vérification en **mode sombre** ·
notifications prestataire ORGANIZATION illisibles · `docker/data/` tracké par git · verrou du refus
`REJECTED` (différé au chantier réglementé).
