# Portfolio P1 — reconnaissance (étape 0)

Branche `feat/portfolio-p1`, depuis `main` à `30b6f5a`. Lecture seule, sauf l'ajout de
`sharp` (seule dépendance autorisée), fait pour mesurer son installation.

**Verdict : aucune condition d'arrêt n'est remplie.** Deux écarts au mandat sont relevés
plus bas (§3 Dockerfile, §6 variable d'URL) ; aucun n'exige de toucher `payments`,
l'authentification ou une migration existante.

## 1. Couche de stockage `common/storage/`

- Port `IStorageService` (`storage.interface.ts`) : `upload({ buffer, key, mimeType })`,
  `getStream(key) → { stream, mimeType? }`, `delete(key)`. Jeton d'injection
  `STORAGE_SERVICE`, module `@Global()`.
- **Lecture en flux et suppression existent déjà** : aucune refonte, aucun ajout.
- Adaptateur local (`STORAGE_DRIVER=local`, défaut) : écrit sous `STORAGE_LOCAL_DIR`
  (`./storage/uploads`), garde contre la traversée de chemin, `delete` idempotent (une
  absence n'est pas une erreur), `getStream` lève `404` si le fichier manque.
- Adaptateur S3 : `PutObject` / `GetObject` / `DeleteObject`, non exercé en dev.
- Clés : chemins relatifs, jamais une URL (`verifications/{pscId}/{uuid}{ext}`). La clé
  `portfolio/{providerId}/{uuid}.webp` suit le même format.
- ⚠️ `getStream` ne renvoie **pas** de taille. Le `Content-Length` viendra de
  `byte_size` (la taille de la sortie, enregistrée en base).

## 2. Envoi de fichiers existant

`verifications.controller.ts` et `service-request-attachments.controller.ts` :
`FileInterceptor('file', { limits: { fileSize }, fileFilter })` de
`@nestjs/platform-express` (multer, **stockage en mémoire** → `file.buffer`), puis une
validation défensive dans le service. Le dépassement de `limits.fileSize` est transformé
par Nest en `PayloadTooLargeException` (**413**) : multer coupe la lecture à la limite.
P1 reprend ce schéma, **sans** `fileFilter` sur le type déclaré : le type est lu dans
les octets par `sharp` (§2 du mandat).

## 3. `sharp`

- **Pas une dépendance directe de l'API** avant ce chantier ; il était déjà dans le
  lockfile en `0.34.5`, comme dépendance optionnelle de `next`.
- Ajouté à `apps/api` en **`0.34.5` exact** (même version que celle déjà verrouillée).
  Diff du lockfile réduit à `sharp` seul : `pnpm add` montait aussi `turbo` (spécifié
  `latest` à la racine) de 2.11.2 à 2.11.8. J'ai restauré le lockfile et n'ai gardé que
  les trois lignes d'importeur `sharp` et la levée de `optional: true` sur `sharp` et
  `@img/colour` (exactement ce que `pnpm add` produit). `pnpm install --frozen-lockfile`
  passe.
- **Windows** (Node 24.16, pnpm 9.15.4) : `require('sharp')` OK, vips 8.17.3, sortie
  WebP produite. Le binaire précompilé `@img/sharp-win32-x64` suffit :
  `ignoredBuiltDependencies: sharp` dans `pnpm-workspace.yaml` n'empêche rien (le script
  d'installation ne compile que si le précompilé manque).
- **Linux, `node:20-alpine`** (la base du Dockerfile de l'API) : installation filtrée
  `pnpm install --filter @linkr/api --frozen-lockfile` réussie, script
  `node install/check.js` passé, binaire `linuxmusl-x64`, `sharp 0.34.5 / vips 8.17.3`,
  chaîne `rotate → resize → webp` exécutée.
- ⚠️ **Défaut préexistant, sans lien avec `sharp`** : le `apps/api/Dockerfile` réel
  échoue à l'étape 1 **avant** de résoudre la moindre dépendance —
  `ERR_PNPM_JSON_PARSE` sur `packages/shared-config/package.json`, que `touch` crée
  vide. Il ne copie pas non plus `pnpm-lock.yaml`, alors qu'il passe
  `--frozen-lockfile`. Le test Linux ci-dessus utilise donc la même base et la même
  commande d'installation, avec le lockfile et des `package.json` minimaux valides.
  **Non corrigé ici** (chantier déploiement) ; signalé en dette.
- Piège de test relevé : `withExif({ IFD0: { Orientation: '6' } })` n'écrit **pas**
  l'orientation que libvips lit (orientation relue : 1). La fixture « portrait » doit
  être faite avec `withMetadata({ orientation: 6 })` (relue 6, `rotate()` → 600×800,
  sans `rotate()` → 800×600). Ceci ne concerne que les **tests** : le code de production
  n'appelle jamais `withMetadata`.

## 4. Conventions de routes et RBAC

- Route « me » existante : `GET /service-providers/me` (`findByUserId`, profil
  INDIVIDUAL non supprimé, **en pause inclus**), déclarée **avant** `GET :id` sinon
  `ParseUUIDPipe` répond 400. Les routes P1 seront donc `…/service-providers/me/portfolio`.
  ⚠️ `me/portfolio` et `:id/portfolio` ont la même forme : elles vivent dans **un seul**
  contrôleur, `me` déclaré en premier.
- Garde globale JWT ; `@Public()` pour ouvrir une route.
- Admin : `AdminGuard` (`common/guards/admin.guard.ts`) relit `system_role` en base,
  `403` sinon ; enregistré en **provider local** du module, qui doit importer
  `UsersModule`. Routes admin préfixées `admin/` (`admin/payments/:id/refund`…).
- Erreurs : `HttpException` de domaine dans `modules/*/exceptions/`, corps Nest standard
  `{ statusCode, message, error }`. **Aucun champ `code` n'existe encore** dans le dépôt :
  le `409` du plafond portera un corps `{ statusCode, error, message, code:
  'PORTFOLIO_LIMIT_REACHED' }` (forme objet de `HttpException`).
- Verrou : `SELECT … FOR UPDATE` déjà employé (`quote.repository`,
  `service-request.repository`, `payment-method.repository`) dans une transaction
  `QueryRunner`.
- 404 plutôt que 403 sur l'objet d'autrui : précédent `DELETE /reviews/:id`.

## 5. Visibilité publique d'un prestataire

`GET /service-providers/:id` (`@Public()`) → `getPublicById` → `findById` :
**`WHERE id = $1 AND deleted_at_utc IS NULL`**, rien d'autre. Un prestataire **en pause**
(`is_active = false`) a donc toujours une page publique (son catalogue, lui, est vide,
parce que `findPublicCatalogByProviderId` filtre `sp.is_active`). La page web
`/providers/[id]` lit cet endpoint et n'ajoute aucun filtre (`notFound()` sur 404/400).

**Condition retenue pour P1, à l'identique : prestataire existant et non supprimé.**
Un prestataire en pause garde son portfolio visible, comme son profil. Si l'on veut
cacher les photos d'un prestataire en pause, c'est une décision produit qui vaut aussi
pour le profil — hors périmètre.

## 6. Côté web

- Les relais BFF et les Server Components appellent l'API par `getServerApiClient()`
  (`lib/auth/session.ts`, `server-only`), dont la base vient de
  **`process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:5000'`**. Il n'existe **aucune**
  variable d'URL interne distincte.
- ⚠️ **Écart au mandat** : il demande à la fois « la même variable d'URL interne que les
  relais BFF » et « aucun usage de `NEXT_PUBLIC_API_URL` ni de `localhost:5000` dans ce
  relais ». La seule variable des relais **est** `NEXT_PUBLIC_API_URL`. Résolution
  retenue : le relais passe par `getServerApiClient()` comme les autres relais. Il ne
  contient donc aucune référence littérale à la variable ni au port, et l'URL de base
  reste résolue à un seul endroit. Aucune nouvelle variable d'environnement n'est créée.
  (En production derrière un reverse-proxy, une URL interne distincte de l'URL publique
  pourrait devenir utile ; c'est une question de déploiement, notée en dette.)
- Usages relevés de `NEXT_PUBLIC_API_URL` / `localhost:5000` (7 sites) :
  - **côté serveur seulement** : `lib/auth/session.ts`, `lib/auth/refresh.ts`, et les
    relais `app/api/auth/{login,signup,forgot-password,reset-password}/route.ts` ;
  - **un seul qui atteint le navigateur** : `app/(app)/admin/verifications/page.tsx:59`
    construit `fileHref = ${API_BASE_URL}${doc.downloadUrl}`, rendu dans un lien HTML.
    Le navigateur appelle donc `localhost:5000` directement (sans jeton → 401). C'est la
    dette connue « BFF file-proxy » de 3.11c-A. **Non corrigé** (hors chantier).
- `proxy.ts` : matcher `/((?!_next/static|_next/image|favicon.ico|.*\..*).*)`. Un chemin
  `/media/portfolio/{uuid}` n'a pas de point : le proxy s'y applique, et en
  deny-by-default il **redirige un visiteur anonyme vers `/login`**. Il faut donc ouvrir
  `/media/portfolio/*` (avant les pages publiques, comme `LEGAL_PATHS`). Le prédicat ira
  dans un module pur sans import, testable par `node --test`.
- Racine des routes : `apps/web/src/app/…` (et non `apps/web/app/…`) → le relais sera
  `apps/web/src/app/media/portfolio/[itemId]/route.ts`, hors des groupes `(app)`/`(auth)`.
- Tests web : `node --experimental-strip-types --test "src/**/*.test.mjs"`, modules testés
  **sans aucun import** (CI sans installation). La logique du relais (validation de
  l'uuid, choix et copie des en-têtes) sera donc dans un module pur, le `route.ts` n'en
  étant que le câblage.

## 7. Migrations

- Tête : `1780540000000-AddUserTermsAcceptance`. Nouvelle migration :
  **`1780550000000-CreatePortfolioItems`** (tête + 10000000).
- Garde (`scripts/check-migration-drops.mjs`, workflow `migration-guard.yml`) : refuse un
  `DROP INDEX` dans un `up()` sans marqueur. La nouvelle migration n'en a aucun.
- Convention : migration écrite à la main, `COMMENT ON`, miroirs d'entité (`@Index`,
  `@Check`, `comment`) pour que `migration:generate` ne propose pas de les retirer.

## 8. Garde miroir

`scripts/check-mirrored-constants.mjs` : tableau `MIRRORS` (nom, raison, fichiers) ; la
regex ne lit qu'un **littéral** (nombre ou chaîne entre apostrophes). Conséquences :
- `PORTFOLIO_MAX_BYTES = 5 * 1024 * 1024` **ne serait pas lu** : il sera écrit
  `5242880` des deux côtés, avec le calcul en commentaire.
- Les chemins des deux fichiers sont à ajouter aux filtres `paths` de
  `.github/workflows/mirror-guard.yml`.
- Côté web, les constantes vivront dans un module pur (`lib/portfolio/…`), comme
  `tender-rules.ts`.
