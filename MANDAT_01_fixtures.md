# MANDAT N°1 — Fixtures de développement + documentation de démarrage

**Assigné à :** le collaborateur
**Branche :** `chore/dev-fixtures`
**Statut à la fin :** PR ouverte. **Ne merge pas.**

---

## Pourquoi ce mandat existe

Aujourd'hui, un développeur qui clone Linkr obtient une base avec **un catalogue de
services et aucun compte pour se connecter**. Le seul seed du dépôt
(`quebec-catalog.seed.ts`) crée 7 métiers, 19 services et 7 exigences réglementaires —
zéro utilisateur, zéro prestataire, zéro demande.

Les comptes de test cités partout dans la documentation (`alice@linkr.test`,
`bob@linkr.test`…) et leurs UUID n'existent **que dans la base locale du fondateur**.
Rien dans le dépôt ne peut les reproduire.

Conséquence : tu ne peux ni te connecter, ni créer une demande de service, ni déclencher
une notification — donc rien à envoyer par courriel au mandat n°2.

**Tu es aussi le premier humain à démarrer ce dépôt sur une autre machine.** La §3 de
`ONBOARDING.md` est reconstruite depuis le code, jamais éprouvée. Ce que tu découvres en
la suivant fait partie du livrable.

---

## Livrables

### 1. Un seeder de fixtures de développement

**Nouveau fichier**, à côté de l'existant :
`apps/api/src/database/seeders/dev-fixtures.seed.ts`

⚠️ **Ne modifie pas `quebec-catalog.seed.ts`.** Il utilise les `slug` comme clés
naturelles stables, son upsert est idempotent, et c'est un meilleur patron que des UUID
figés pour un catalogue. Ton seeder le **suppose déjà exécuté** et résout les catégories
par leur `slug`.

**Contenu attendu** — ce décor est **dérivé d'une inspection de la base du fondateur du 8 août
2026**, pas d'une supposition. Les comptes de rebut observés (`smoke-*`, `debug-*`,
`shape-check-*`, `david@linkr.test`) ne sont **pas** reproduits.

**Comptes**, tous avec le mot de passe `Password123!` :

| Compte | Rôle | Prestataire |
|---|---|---|
| `alice@linkr.test` | ADMIN (`users.system_role`) | INDIVIDUAL — « Alice Coiffure » |
| `bob@linkr.test` | USER | INDIVIDUAL — « Bob Services », base à Québec |
| `carol@linkr.test` | USER | **aucun** — cliente pure |
| `carol2@linkr.test` | USER | INDIVIDUAL — « Coiffure Carole », base à Montréal |
| `dave@linkr.test` | USER | **OWNER d'une ORGANIZATION** — voir ci-dessous |

**⚠️ Le prestataire ORGANIZATION est délibéré et important.** La base du fondateur ne contient
**que** des prestataires `INDIVIDUAL` — la branche polymorphe ORGANIZATION n'a **jamais été
exécutée au runtime**, alors que le code la supporte. Il faut donc créer : une ligne
`organizations`, une `organization_memberships` avec `dave` en OWNER, et un `service_providers` de
type `ORGANIZATION` rattaché à cette organisation.

**Cadrage strict :** tu crées le **décor**, tu ne touches **pas** au code de résolution. La dette
« notifications ORGANIZATION illisibles » (§6 de `CLAUDE.md`) reste ouverte — elle devient
simplement observable au lieu de théorique. Si tu constates qu'un OWNER ne voit pas ses
notifications, **c'est le comportement attendu aujourd'hui** : note-le dans la PR, ne le corrige
pas.

Pour chaque prestataire : localisation de base (PostGIS), zones de service, au moins une catégorie
professionnelle **informelle** (coiffure → `NOT_REQUIRED`, donc immédiatement réservable) et au
moins un service professionnel avec un prix.

**Demandes de service — plusieurs statuts, c'est le point.** La base actuelle contient 33 demandes
**toutes `OPEN`** : aucun autre état de la machine n'est observable, donc impossible de vérifier à
l'œil qu'un badge « Terminée » ou « Annulée » s'affiche correctement. Crée **une poignée de
demandes couvrant au minimum `OPEN`, `ASSIGNED`, `COMPLETED` et `CANCELLED`.**

⚠️ **Lis l'enum réel** (`service_requests.status`) plutôt que de te fier à cette liste, et vérifie
si un état `ASSIGNED` exige une ligne `service_request_assignments` associée — la table existe.
Si un état s'avère impossible à produire sans passer par Stripe (typiquement `PAID`), **saute-le et
dis-le dans la PR** : c'est une limite du périmètre, pas un échec.

**Noms de colonnes vérifiés en base** (pour t'éviter des allers-retours) :
`users.system_role` (pas `role`) · `payments.payment_type` (pas `type`) ·
`payments.gross_amount` (pas `amount`) · tous les horodatages en `*_at_utc`.

**UUID écrits en dur**, avec une convention lisible :

```
users                       11111111-1111-4111-8111-00000000000N
service_providers           22222222-2222-4222-8222-00000000000N
service_requests            33333333-3333-4333-8333-00000000000N
organizations               44444444-4444-4444-8444-00000000000N
professional_services       55555555-5555-4555-8555-00000000000N
```

⚠️ Les identifiants du **catalogue** (`service_categories`, `service_items`) ne sont **pas**
concernés : ils sont générés par `quebec-catalog.seed.ts` et se résolvent par `slug`.

⚠️ Vérifie qu'aucun `@IsUUID()` du dépôt n'impose une version spécifique. Si c'est le
cas, adapte la convention et **dis-le dans la PR** plutôt que de la contourner
silencieusement.

**Contraintes :**

- **Idempotent.** Deux exécutions successives ne doivent ni échouer ni dupliquer. Upsert
  sur l'identifiant en dur.
- **Refuse de s'exécuter si `NODE_ENV=production`.** Sortie explicite, code d'erreur non
  nul. Non négociable.
- **Le hachage du mot de passe doit être produit par le même mécanisme que l'inscription
  réelle.** Va le lire dans le module `auth` — ne le réinvente pas, sinon les comptes
  seront créés mais la connexion échouera.
- Aucune nouvelle dépendance npm.
- Aucune migration.
- Aucune donnée Stripe (`stripe_connect_accounts`, `payments`) — hors périmètre.

### 2. Câblage des deux seeders

`apps/api/package.json` ne contient **aucun** script de seed. Le seul mode d'emploi du
catalogue est un commentaire en ligne 10 avec une invocation `npx ts-node`.

Ajoute deux scripts, en t'alignant sur la façon dont `migration:run` est déjà déclaré :

```
seed:catalog   → quebec-catalog.seed.ts
seed:dev       → dev-fixtures.seed.ts
```

### 3. `README.md` — réécriture de la section démarrage

L'actuel **égare activement un nouvel arrivant.** Constats mesurés :

- Il fait copier le `.env.example` de la **racine** (5 variables docker-compose) et ne
  mentionne **jamais** `apps/api/.env`, qui est le fichier réellement attendu par
  `app.module.ts:31`.
- La séquence s'arrête à `docker compose up` : ni `migration:run`, ni seed, ni démarrage
  de l'API ou du web.
- Il annonce « Step 3.1 (Monorepo Foundation) complete » alors que le projet est en phase
  3.14.
- Il situe `apps/web` en « Step 3.10+ » et `apps/mobile` en « Step 3.11+ ».

Réécris la séquence pour qu'elle corresponde à la réalité **que tu viens de vivre**.
Corrige les mentions de phase ou supprime-les — une roadmap dans un README est condamnée
à mentir.

### 4. `apps/web/README.md` — purge

C'est le boilerplate `create-next-app` intact. Il indique `npm run dev` et le port 3000,
alors que `apps/web/package.json:6` déclare `next dev -p 3001`. Remplace-le par quelques
lignes exactes, ou supprime-le.

### 5. `ONBOARDING.md` §3 — corrections

Tu suis la séquence de la §3 en la lisant. **Chaque fois qu'elle te ment, corrige-la.**
Chaque piège que tu rencontres et qui n'y figure pas, ajoute-le.

C'est le seul moment où quelqu'un peut mesurer ça. Une fois ton poste configuré, tu
deviens aussi aveugle que le fondateur.

---

## Hors périmètre

- `quebec-catalog.seed.ts` — non touché
- Toute migration
- `CLAUDE.md` — sa réconciliation est prise en charge en parallèle
- Toute correction de code applicatif rencontrée en chemin : **note-la dans la PR, ne la
  corrige pas.** Une PR = une responsabilité.
- Tout ce qui touche Stripe

---

## Ce qui compte comme terminé

1. Sur une base **entièrement neuve** (volume Docker supprimé) :
   `migration:run` → `seed:catalog` → `seed:dev` aboutit sans erreur.
2. Connexion réussie avec `bob@linkr.test` / `Password123!` sur
   `POST http://localhost:5000/auth/login`.
3. `seed:dev` relancé une seconde fois : aucune erreur, aucun doublon.
4. Les UUID obtenus en base correspondent **exactement** à ceux écrits en dur — prouvé
   par une sortie `psql`, pas par lecture du code.
5. Le tableau de bord prestataire de bob (`http://localhost:3001`) affiche la demande
   `OPEN`, et les demandes des autres statuts s'affichent avec le bon badge.
6. Connexion réussie avec `dave@linkr.test`, et `GET /service-providers/me` retourne le
   prestataire **ORGANIZATION** — prouvé par une sortie, pas par lecture de code.
7. La séquence du `README.md` réécrit a été suivie **telle quelle**, dans l'ordre, sans
   connaissance implicite.

**Dans la description de PR**, joins :
- la liste de ce qui a cassé pendant le démarrage à froid et comment tu l'as contourné ;
- tout écart constaté entre la documentation et le code, **même hors périmètre**.

Cette liste a autant de valeur que le code.
