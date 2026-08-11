# ONBOARDING — Linkr

> Ce document est **versionné dans le dépôt**. S'il te ment, corrige-le et pousse la
> correction. C'est ton premier commit légitime.
>
> **Dernière révision :** 8 août 2026 · `main` @ `6099475`

---

## 1. Ce qu'est Linkr

Linkr est une **place de marché de services** qui met en relation des clients et des
prestataires de métiers — plombiers, électriciens, coiffeurs, hommes à tout faire. Le
MVP cible le **Québec**, avec une visée « glocale » : le socle est conçu pour s'étendre
à d'autres juridictions.

**Deux différenciateurs, et il faut les avoir en tête pour bien coder ici :**

1. **La plateforme gère la transaction de bout en bout.** Elle ne se contente pas de
   présenter un numéro de téléphone : demande, acceptation, dépôt, solde, remboursement
   passent par Stripe Connect. C'est ce qui la sépare des annuaires de mise en relation
   comme RenoMatch.
2. **Elle couvre les métiers réglementés ET informels.** Un plombier doit prouver sa
   licence (RBQ, CMEQ, CMMTQ, CCQ) et un cycle de vérification l'impose ; un coiffeur
   n'a aucune licence d'État à fournir et est validé par l'identité et, à terme, la
   communauté. Les deux cohabitent dans le même modèle de données.

**Le risque produit principal est le démarrage à froid** : une place de marché sans
prestataires n'attire aucun client, et sans clients n'attire aucun prestataire. Beaucoup
de décisions du dépôt s'expliquent par là — notamment le refus d'ajouter de la modération
préventive à l'inscription des métiers informels.

---

## 2. Comment on travaille

| | |
|---|---|
| **Claude Ayé** | Fondateur, architecte, **seul valideur de merge** |
| **Toi** | Développeur. Tu conçois sur ton chantier, tu ouvres des PR, tu ne merges jamais sur `main` |

**Langues :** français (Québec) pour les échanges et les décisions ; **anglais** pour le
code, les noms de branches et les messages de commit.

**Une PR = une responsabilité.** Une PR qui fait deux choses est refusée même si les deux
sont bonnes. Le corollaire : découpe tôt, en écriture → lecture → affichage quand la
question s'y prête.

**Tu ne merges pas.** Ce n'est pas une question de confiance : le pipeline n'a **aucune
CI** (le répertoire `.github` est vide) et aucun relecteur tiers. La relecture humaine est
le seul filet, et elle est faite par une personne qui a le contexte des onze phases
précédentes.

---

## 3. Démarrage à froid

> ⚠️ **Cette section n'a jamais été exécutée sur une autre machine que celle du
> fondateur.** Elle est reconstruite depuis le code, pas depuis l'expérience. Tu es le
> premier à l'éprouver — **note tout ce qui casse et corrige ce fichier.** C'est une
> partie explicite de ton mandat, pas une politesse.

### Prérequis

- **Node ≥ 20** (le dépôt déclare `engines.node >= 20.0.0`)
- **pnpm 9.15.4** — la version est épinglée par `packageManager` à la racine
- **Docker Desktop**
- **Git**

### Séquence

```powershell
git clone https://github.com/claude-aye/Linkr.git C:\Dev\Linkr
cd C:\Dev\Linkr
pnpm install
```

**Fichiers d'environnement — il y en a trois, pas un.**

```powershell
# 1. Racine — variables docker-compose UNIQUEMENT (5 variables)
Copy-Item .env.example .env

# 2. API — le fichier qui compte réellement (37 variables)
Copy-Item apps/api/.env.example apps/api/.env

# 3. Web — optionnel (toutes les variables ont un repli codé en dur)
Copy-Item apps/web/.env.example apps/web/.env.local
```

Puis **édite `apps/api/.env`** :
- `JWT_ACCESS_SECRET` et `JWT_REFRESH_SECRET` — génère les tiennes, minimum 32
  caractères, et **elles doivent différer l'une de l'autre** (Joi le vérifie). Ce ne sont
  pas des secrets partagés : chaque poste a les siennes.
- `DATABASE_URL` / `REDIS_URL` — aligne-les sur ce que tu as mis dans le `.env` racine.
- **Les valeurs Stripe (`sk_test_change_me`, `whsec_change_me`, `pk_test_change_me`) : ne
  les touche pas.** Elles sont factices mais satisfont la validation. Tu n'as pas d'accès
  Stripe et tu n'en as pas besoin — voir §4.

**Infrastructure :**

```powershell
docker compose --project-directory . -f docker/docker-compose.yml up -d
```

⚠️ Le `--project-directory .` n'est pas décoratif. Les volumes sont déclarés en chemins
relatifs (`./data/postgres`) ; sans ce drapeau, ils atterrissent au mauvais endroit et tu
obtiens une base vide sans comprendre pourquoi.

Trois services démarrent : `linkr-postgres` (PostGIS 16-3.4, port 5432), `linkr-redis`
(port 6379), `linkr-pgadmin` (port 5050).

**Schéma et données :**

```powershell
pnpm --filter @linkr/api migration:run
# puis le catalogue et les fixtures — voir le mandat n°1
```

⚠️ `synchronize` est à `false`. Le schéma n'est **jamais** créé automatiquement au
démarrage : sans `migration:run`, ta base est vide et l'API échouera de façon obscure.

**Lancer :**

```powershell
pnpm --filter @linkr/api build
pnpm --filter @linkr/api start     # API → http://localhost:5000 · Swagger /api/docs
pnpm --filter @linkr/web dev       # Web → http://localhost:3001
```

⚠️ **N'utilise pas `nest start --watch`.** Il est cassé sur Windows avec Node 24 et
`@nestjs/cli@11.0.21` : `treeKill` plante sur un processus fantôme et tue le watcher. Le
contournement est `build` puis `start`.

### Pièges connus (Windows / PowerShell 5.1)

- Les scripts `.ps1` doivent être en **ASCII pur**.
- `curl.exe` sur PS 5.1 **avale les guillemets doubles** d'un JSON en ligne. Écris
  toujours le corps dans un fichier — `Out-File -Encoding ascii` — et passe
  `--data "@body.json"`.
- `ConvertTo-Json` par défaut tronque à 2 niveaux. Pour du GeoJSON : `-Depth 5`.
- `$PID` est une variable réservée de PowerShell. N'y assigne rien.
- Les fonctions d'aide (login, appels API) sont **portée session** : à recoller dans
  chaque nouveau terminal.
- Au `git switch`, Windows peut râler « Deletion of directory failed » sur des dossiers
  fraîchement supprimés. C'est un problème de handle, sans conséquence. Réponds `n`.

---

## 4. Règles non négociables

1. **Jamais de suppression physique.** Soft delete via `deleted_at_utc`, partout.
2. **Jamais de montant sans devise.** Tout `*_amount` est accompagné d'un `*_currency`
   (ISO 4217).
3. **Jamais d'horodatage sans UTC.** Toutes les colonnes datetime portent le suffixe
   `_utc`.
4. **Jamais de modification d'une migration déjà mergée.** Elle a été appliquée sur des
   bases qui ne peuvent pas revenir en arrière. Une correction est une **nouvelle**
   migration.
5. **Jamais de `FLUSHDB` sur Redis.** La base 0 est partagée entre le cache de géocodage
   (`linkr:geocode:v1:*`) et les files BullMQ. Un `FLUSHDB` détruit les jobs en vol.
6. **Pas d'accès Stripe.** Tes clés sont factices et le resteront. Tu peux créer des
   comptes, des prestataires, des demandes et déclencher des notifications ; tu ne peux
   pas aller jusqu'à l'acceptation avec dépôt. C'est voulu, ce n'est pas un bogue à
   contourner.
7. **La stack Docker fait foi.** Ni le sandbox de ton assistant IA, ni un Postgres local
   improvisé ne sont la vérité terrain.
8. **Tu ne merges pas sur `main`.**

---

## 5. Vérifier ton travail

**Lis cette section en entier. C'est celle qui coûte le plus cher à ignorer.**

Sur beaucoup de projets, « ça compile et la CI est verte » suffit à dire que c'est bon.
**Ici, deux des trois vérifications automatiques sont cassées, et il n'y a pas de CI.**

| Vérification | État | Pourquoi |
|---|---|---|
| `openapi.json` | ❌ peu fiable | Le plugin Swagger n'est pas activé dans `nest-cli.json` — beaucoup de DTO sortent vides |
| `migration:generate` | ❌ peu fiable | Elle veut renommer ~20 clés étrangères nommées à la main vers les noms auto-générés de TypeORM. Le diff est noyé dans du bruit systématique |
| Sondes SQL manuelles | ✅ **le seul filet réel** | |

**Conséquence pratique :** après toute migration, tu vérifies le schéma **au `psql`**, pas
au diff.

```powershell
# Structure d'une table
docker exec linkr-postgres psql -U linkr -d linkr -c "\d notifications"

# Contraintes CHECK et clés étrangères
docker exec linkr-postgres psql -U linkr -d linkr -c "\d+ notifications"
```

**Et une règle de méthode qui vaut plus que les outils :**

> **Une sortie qui ressemble au résultat attendu n'est pas une preuve.**

Cas réel du dépôt : un test de garde d'appartenance a renvoyé un `404` exactement comme
prévu — sauf que le `404` venait du **routeur** (l'URL construite était
`/notifications//read`, avec un identifiant vide), jamais de la garde testée. La sortie
était parfaite et ne prouvait rien.

Quand tu valides quelque chose, valide **ce qui a produit** le résultat, pas seulement le
résultat.

**Avant chaque smoke test :**
- `pnpm --filter @linkr/api migration:run` — même si ta PR n'ajoute pas de migration
- **Reconnecte-toi.** Le JWT d'accès expire en **15 minutes**

---

## 6. Circuit d'une PR

```powershell
git switch main
git pull
git switch -c feat/ma-fonctionnalite
# ... travail ...
git push -u origin feat/ma-fonctionnalite
gh pr create --base main --fill
```

**Nommage de branche :** `feat/…`, `fix/…`, `chore/…`, `refactor/…`, `docs/…`

**Messages de commit :** Conventional Commits, avec un scope qui correspond au module
NestJS.

```
feat(notifications): add email channel worker
fix(payments): handle stripe webhook signature failure
chore(seed): wire dev fixtures to pnpm script
```

**Avant d'ouvrir la PR**, vérifie toi-même la portée :

```powershell
git diff main...HEAD --stat
```

Si le nombre de fichiers ne correspond pas à ce que tu penses avoir touché, **arrête-toi
et comprends pourquoi** avant de pousser.

**Migrations, à deux :** le nom d'une migration est un horodatage choisi à la main. Si on
en crée chacun une sur des branches parallèles, elles peuvent s'ordonner différemment
selon la machine. **Annonce-le avant d'en créer une.**

**Et : tu documentes tes décisions.** Quand tu tranches un arbitrage de conception, écris
le « pourquoi » et l'alternative écartée — dans la description de PR ou dans `CLAUDE.md`.
Ce dépôt est reprenable parce que les raisons sont écrites. Une décision sans raison
écrite sera « corrigée » par quelqu'un dans six mois.

---

## 7. Ton assistant IA

Tu travailleras avec ton propre Project Claude. Trois documents dedans, **et pas un de
plus** :

1. `CLAUDE.md` — l'architecture de référence
2. `ONBOARDING.md` — ce fichier
3. Le handoff du 7 août 2026 — l'état présent

⚠️ **Le risque, et il est réel :** un assistant frais lit le code sans connaître les
arbitrages passés. Il sera confiant, cohérent, et parfois en contradiction directe avec
une décision verrouillée.

Exemple vécu : la condition `PROJECT_TENDER` dans `service-requests.service.ts:116`
**ressemble à un bogue de câblage**. Ce n'en est pas un — la « corriger » enverrait la
demande d'un client à **tous** les prestataires du rayon.

**La règle :** toute divergence avec une décision documentée comme verrouillée remonte à
Claude Ayé **avant** implémentation. Ton assistant est un exécutant sur une architecture
existante, pas un second architecte.

---

## 8. Ce qui n'est pas à jour

Le Project contient une douzaine de fichiers `HANDOFF_*.md`. **Ce sont un journal de
bord, pas de la documentation.** La plupart décrivent des états qui n'existent plus — API
sur le port 3000, numérotation de roadmap périmée, dettes depuis longtemps payées.

Ils ont tous l'air également autoritaires et rien ne signale ce qui est mort.

- **`CLAUDE.md`** = référence d'architecture
- **`ONBOARDING.md`** = ce fichier, référence de démarrage
- **Handoffs** = archéologie. Consultables sur demande, jamais en lecture d'entrée.

Même `CLAUDE.md` a de la dérive connue et en cours de correction (§6 et §12 notamment).
**En cas de doute, le code gagne, et tu signales l'écart.**

---

## 9. Tes mandats

**N°1 — Fixtures de développement + réparation de la documentation de démarrage.**
Spécification dans `MANDAT_01_fixtures.md`. Mise en jambes de faible enjeu : tu parcours
le graphe d'entités et tu rends le dépôt démarrable pour le suivant.

**N°2 — Le chantier courriel (« la sonnette »).** Aujourd'hui Linkr écrit des
notifications en base et **rien ne prévient personne**. Un prestataire ne découvre une
demande qu'en ouvrant son tableau de bord. Sur ce chantier tu **conçois** : fournisseur
d'envoi, file BullMQ dédiée, gabarits, et surtout le traitement des échecs — il n'existe
aujourd'hui **aucun** `@OnWorkerEvent('failed')`, aucune file de rejeu, aucune alerte. Un
courriel perdu serait silencieux.

**Développement en bac à sable, zéro envoi réel.** Le nom de domaine et le compte
fournisseur restent chez Claude Ayé et se brancheront au déploiement.
