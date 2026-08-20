# ÉTAT — Travail autonome CC

**Dernière session :** 2026-08-20 (session 10) · `main` @ `f06e196` · migration `1780510000000`
**⚠️ La tête de migration NE BOUGE PAS tant que #80 n'est pas mergée.** `1780520000000` vit sur la
branche, pas sur `main`.

## Chantier en cours

**D — avis et évaluations.** Tranche **1a préparée et prouvée** : **PR #80, À PORTE HUMAINE, NON
MERGÉE** (elle porte une migration — mandat §7). Les cinq décisions D-1 à D-5 restent arrêtées.

## Découpage retenu

- [x] Session 9 — atteindre `COMPLETED` (PR #79, mergée) — hors file, brief humain
- [~] **D tranche 1a — la table `reviews` : écriture, suppression douce, lecture agrégée**
      (**PR #80, en attente de merge humain**)
- [ ] **D tranche 1b — l'interface client : écrire, voir, supprimer** ← **PROCHAINE** (autonome),
      **une fois #80 mergée**
- [ ] D tranche 2 — la réponse du prestataire (la **colonne existe déjà** ; il manque l'endpoint et
      l'écran)
- [ ] D tranche 3 — intégration à `discover` (tri, affichage en liste)
- [ ] H tranche 2b — « Prévenez-moi » — **TOUJOURS BLOQUÉE** tant que le chantier courriels du
      collaborateur est en bac à sable. **Rien n'est amorcé, délibérément.**

**G-2 (cibles tactiles dans les pages) reste DÉPRIORITISÉ** — opportuniste, dans la PR qui touche la
page. Mesuré en session 9 : « Voir le détail → » = **16 px**, sous le plancher 24 px de WCAG 2.5.8.

Bande d'horodatage : `1780510000000` → `1780599999999`. **`…510000000` pris par #76, `…520000000`
pris par #80 (sur la branche)** ; la prochaine migration prend **`…530000000`**. La bande du
collaborateur `…480/490` reste intouchable.

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

1. **⛔ NE RIEN EMPILER SUR #80 TANT QU'ELLE N'EST PAS MERGÉE.** Elle porte la migration
   `1780520000000`. Si elle est mergée : `git fetch origin --prune`, `migration:run`, et 1b part de
   là. Si elle ne l'est pas encore, **le chantier D est en attente** — prendre autre chose plutôt
   que de brancher une 1b sur une table qui n'existe pas sur `main`.
2. **La ligne de `JOURNAL_AUTONOMIE.md` pour #80 est DUE AU MERGE, pas avant** (le journal
   n'enregistre que des PR mergées). À écrire dans la première session qui suit le merge.
3. **⚠️ LE CONTRAT EST PROPRE, DONC 1b N'A NI MIROIR NI CAST À ÉCRIRE.** `ReviewResponseDto`,
   `ProviderReviewItemDto` et `ProviderReviewListDto` sont générés **sans un seul
   `Record<string, never>`** (compté dans le généré) : `comment: string | null`,
   `averageRating: number | null`, enveloppe typée nativement. Consommer
   `components['schemas'][…]` directement. C'est la 3ᵉ fois que l'annotation soignée en amont
   paie tout de suite.
4. **⚠️ LE SEUIL DE TROIS EST DÉJÀ APPLIQUÉ EN SQL — le front n'a RIEN à masquer.**
   `averageRating` vaut `null` **sur le fil** sous 3 avis vivants. Ne pas recalculer une moyenne
   depuis `items` côté front : la liste est plafonnée à 50, un calcul dérivé mentirait dès que le
   plafond mord (même piège que `unreadCount` des notifications).
5. **⚠️ POUR 1b : la suppression est le livrable, pas un bonus.** Écrit comme **contrainte de
   lancement** — *pas d'avis en production avant que le retrait soit atteignable par son auteur*.
   Aujourd'hui `DELETE /reviews/:id` n'existe qu'au `curl`. Tant que 1b n'est pas livrée, toute
   demande de retrait se traite à la main.
6. **⚠️ `POST /reviews` EST LIMITÉ À 10 / heure PAR APPELANT, ET LA GARDE COMPTE LES TENTATIVES.**
   Vérifié en me faisant couper au milieu d'un smoke par mes propres 400/403/409. Le compteur est
   **en mémoire par processus** : redémarrer l'API le remet à zéro. À savoir avant de conclure à un
   bogue pendant un smoke de 1b.
7. **⚠️ `3.5` N'EST PAS REJETÉ PAR LA BASE — PostgreSQL l'arrondit à `4` avant le `CHECK`**
   (mesuré par `INSERT` brut). Seul `@IsInt()` du DTO le rejette (400). Ne jamais relâcher ce
   validateur.
8. **Le patron d'autorisation « l'appelant est le client de cette demande » est celui de
   `confirmCompletion`, PAS `ServiceRequestsService.getById`** — ce dernier porte un contournement
   ADMIN qui laisserait un administrateur publier un avis sous son propre nom sur la transaction
   d'un tiers. `ServiceRequestsModule` exporte désormais `ServiceRequestRepository` pour ça.
9. **Points 1 à 6 de la session 9 restent vrais** : la fixture `completed-service-request.seed.ts`
   est idempotente et donne **trois** demandes (`ASSIGNED` / `IN_PROGRESS` / `COMPLETED`) ·
   `assertPayable` est une vérification de données pures mais `captureDeposit` part **après** le
   commit (502 possible sur une demande pourtant `ASSIGNED`) · le dépôt est `FAILED` **par
   conception** · `COMPLETED → PAID` reste inatteignable · `ASSIGNED → IN_PROGRESS → COMPLETED` est
   financièrement inerte · le 502-laisse-`ASSIGNED` reste un arbitrage humain.
10. **Montage de la stack** : Docker **absent**, et le bac à sable **n'avait ENCORE PAS persisté**
    (3ᵉ session de suite où il faut sonder plutôt que présumer). Recette confirmée : `apt-get
    update`, `postgresql-16-postgis-3`, rôle `linkr` SUPERUSER, `CREATE EXTENSION postgis` **et**
    `pgcrypto`, `pnpm install --frozen-lockfile`, `.env` depuis `.env.example` (**`PORT=5000`**,
    `DATABASE_URL`, `REDIS_URL`), `redis-server --daemonize yes`, `migration:run`, seed Québec.
11. **⚠️ `estimatedAmount` est un NOMBRE, pas une chaîne** dans `POST /service-requests` — un
    `"150.00"` fait 400 (« must be a number conforming to the specified constraints »). Une minute
    perdue à chaque session qui sème une demande à la main.
12. **⚠️ Écrire un avis ne notifie PERSONNE.** Le prestataire n'apprend pas qu'il a été évalué.
    `notifications` est le chantier du collaborateur : **non touché, délibérément**. À arbitrer
    avec lui, pas à trancher seul.
13. **L'amendement §3.9 a servi** : `CLAUDE.md` §13.1 gagne une **entrée 10** portant les textes
    **verbatim** de D-3, D-4 et D-5, avec trois notes de portage signalées hors texte. Modifier ou
    supprimer une entrée existante reste un arrêt dur.
14. **Ma base n'est pas celle de l'humain.** La mienne est repartie de zéro (2 users, 1 prestataire,
    7 demandes) ; la sienne porte 43 demandes, les notifications et les lignes `SONDE-*`/`SMOKE-*`
    verrouillées en `ON DELETE RESTRICT`. **Aucun de mes comptes n'affirme quoi que ce soit sur la
    sienne.**
15. **Rappels toujours valables** : écrire `ETAT`/`JOURNAL` sur `main` **via l'API GitHub** · ne
    jamais lancer Prettier sur `apps/web` · `MANDAT_01_fixtures.md` toujours pas entamé
    (`dev-fixtures.seed.ts` et `seed:*` **assignés au collaborateur**) · lire le nom de branche
    **depuis la PR**, jamais le supposer.

## ⛔ En attente de décision humaine

**UNE — et elle est dans le corps de #80, à trancher avant le merge.**

**`GET /service-providers/:providerId/reviews` est-il `@Public()` ?** Je l'ai livré **public**, comme
ses deux sœurs du même profil (`GET /service-providers/:id` et `.../services`), parce que le brief §6
tranche le masquage en raisonnant explicitement sur *« une page conçue pour être partagée »* — donc
sur des lecteurs anonymes. **Mais le brief ne dit pas littéralement « rends l'endpoint public »**, et
mandat §3.10 fait de tout élargissement d'un DTO public un arrêt dur.

**Mon option recommandée : garder `@Public()`**, parce que la mitigation est déjà en place et
structurelle (prénom + initiale **au mapper** ; `display_name` délibérément inutilisé même quand
l'utilisateur en a un ; auteur supprimé → `—` ; ni `authorUserId`, ni `serviceRequestId`, ni adresse,
ni montant dans l'item).

**La bascule coûte une ligne** (retirer `@Public()`) et **ne coûte rien aujourd'hui** : la page
`/providers/[id]` est privée sous `(app)`, donc un lien partagé passe déjà par `/login`. Dis-le avant
de merger et je le change.

**Relevé, non bloquant** : le 502-laisse-`ASSIGNED` (session 9, point 6) reste un arbitrage produit
**et** un arrêt dur technique.

## Dettes créées par la dernière PR

1. **⚠️ CONTRAINTE DE LANCEMENT — pas d'avis en production avant la tranche 1b.** Le schéma permet
   à un client de retirer son avis, **l'interface non**. Acceptable en développement ; **plus du
   tout avec de vrais utilisateurs**.
2. **Écrire un avis ne notifie personne** (point 12 ci-dessus).
3. **Pas de pagination** au-delà du plafond de 50 avis — dette commune au tableau de bord,
   `/requests`, `/recherche` et la carte de la demande.
4. `updateReturningRows()` recopié localement pour la **sixième** fois (payment / refund / quote /
   stripe-connect / notifications / reviews) — le helper partagé reste un chore distinct.

**Conséquence assumée, pas une dette** : les FK de `reviews` sont `ON DELETE RESTRICT`, donc une
demande `COMPLETED` portant un avis — et le prestataire qu'il nomme — ne pourront plus jamais être
supprimés en dur. Cohérent avec la suppression douce partout (§13).

**Relevées, inchangées** : cibles tactiles **dans les pages** (G-2) · aucun index des consoles
admin · `locality` au géocodage · le foyer *feature toggling* · les 5 occurrences restantes de
« tableau de bord » · `globals.css` écrase les polices Geist · aucune vérification en **mode
sombre** · notifications prestataire ORGANIZATION illisibles · `docker/data/` tracké par git ·
verrou du refus `REJECTED` (différé au chantier réglementé) · `trust proxy` absent de `main.ts`.
