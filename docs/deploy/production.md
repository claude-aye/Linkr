# Production — conteneurs (PR D3)

Cible : VPS OVH, Ubuntu 26.04 amd64, Docker + Compose. Les images sont **construites par GitHub Actions** et publiées dans GHCR **en privé** (`ghcr.io/claude-aye/linkr-api`, `ghcr.io/claude-aye/linkr-web`). Le serveur ne construit rien : il télécharge.

## Topologie

```
Internet ─► caddy :80, :443/tcp, :443/udp   (SEUL service qui publie des ports)
             ├─ www.linkrapp.com      → redirection 301 vers linkrapp.com
             ├─ POST /webhooks/stripe* → api:5000
             └─ tout le reste          → web:3001   (y compris /api/*, les relais BFF de Next)

web ─► api:5000      (réseau Docker interne ; NEXT_PUBLIC_API_URL=http://api:5000)
api ─► postgres:5432, redis:6379

réseau edge    : caddy, web, api   (sortie Internet : ACME, Stripe, Brevo, Nominatim)
réseau backend : api, postgres, redis, migrate   (internal : aucune sortie, aucun accès depuis caddy)
volumes        : postgres_data, redis_data, uploads, caddy_data, caddy_config
```

- **L'API n'a aucune route publique sauf le webhook Stripe.** Le navigateur ne lui parle jamais : le serveur web l'appelle en interne. Ne jamais ajouter de route Caddy vers l'API « pour tester » ; ne jamais router `/api/*` vers NestJS (ce sont les 41 relais BFF du web).
- **Seul `caddy` a une section `ports`.** Docker écrit ses propres règles iptables et **contourne UFW** : un `ports:` sur un autre service l'exposerait à Internet malgré le pare-feu. Postgres, Redis, l'API et le web n'ont aucun port publié.
- En-têtes ajoutés par Caddy : HSTS (1 an, sans `includeSubDomains`), `X-Content-Type-Options: nosniff` et `Referrer-Policy: strict-origin-when-cross-origin` (posés seulement si l'application ne l'a pas fait : `/reset-password` garde `no-referrer`). Aucune CSP : elle demande d'énumérer Stripe.js, ses iframes 3D Secure et MapTiler, PR dédiée.

## Adresse du client (PR D2)

Chaîne : `Internet → caddy → web → api`. Les limiteurs par IP de l'API (`login`, `signup`, `forgot-password`, `reset-password`) doivent compter le **visiteur**, pas le conteneur web.

1. **Caddy écrase** `X-Forwarded-For` avec l'adresse qu'il voit (`header_up X-Forwarded-For {remote_host}`) et supprime `X-Real-IP` et `X-Client-IP`, vers le web **et** vers l'API (snippet `client_ip_headers`). Aucune valeur fournie par le client ne passe.
2. **Le web** (`apps/web/src/lib/http/client-ip.ts`) relaie **une seule** adresse à l'API dans `X-Forwarded-For`. Une chaîne (`a, b`) est refusée : derrière Caddy elle n'arrive jamais.
3. **L'API** croit cet en-tête seulement si le pair est dans `TRUSTED_PROXY_IPS` = `172.30.10.0/24`, le sous-réseau fixé du réseau `edge` (posé dans le compose, pas dans `api.env`). Tout autre pair est ignoré : l'API retombe sur l'adresse TCP (échec fermé).

**Trace mesurée (smoke local, Caddyfile de production, image web `standalone`)** : client sans en-tête et client avec `X-Forwarded-For: 6.6.6.6, 7.7.7.7` + `X-Real-IP: 8.8.8.8` forgés → le web reçoit `x-forwarded-for: 172.30.10.1` (une valeur, Next n'ajoute rien), `x-real-ip` absent ; l'API reçoit `x-forwarded-for: 172.30.10.1` depuis le pair web `172.30.10.x`. Sous Docker Desktop, `172.30.10.1` est la passerelle Docker : **seul le VPS montre la vraie adresse du visiteur.**

### Sous-réseau Docker

À lancer sur le VPS **avant** le premier `docker compose up` (un sous-réseau qui chevauche une route existante fait échouer la création du réseau ou casse le routage) :

```bash
docker network ls
docker network inspect $(docker network ls -q) --format '{{.Name}} {{range .IPAM.Config}}{{.Subnet}} {{end}}'
ip route
```

Aucune ligne ne doit contenir `172.30.10.`. Si le sous-réseau est pris, en changer **aux deux endroits** de `deploy/compose.yaml` (`networks.edge.ipam` et `TRUSTED_PROXY_IPS` du service `api`). Un réseau `linkr_edge` déjà créé sans `ipam` doit être supprimé (`docker compose down`) pour prendre le nouveau sous-réseau.

### IPv6

Aucun enregistrement `AAAA` n'existe. **Ajouter un `AAAA` exige de revoir l'adresse source vue par Caddy** : selon la configuration de Docker (`ip6tables`, `userland-proxy`), le trafic IPv6 vers un port publié peut passer par `docker-proxy`, qui remplace l'adresse du client par celle de la passerelle. Tous les visiteurs IPv6 partageraient alors un seul compteur. Vérifier `remote_ip` dans le journal d'accès de Caddy avant de publier l'`AAAA`.

### Vérifications sur le VPS (non faisables en local)

- **Adresse réelle** : activer temporairement le journal d'accès de Caddy (`log` dans le site) ou `docker compose logs caddy`, faire une requête depuis un poste dont on connaît l'IP publique, et vérifier que `remote_ip` vaut cette IP (pas `172.30.10.1`).
- **En-tête forgé ignoré** : 31 tentatives de connexion ratées depuis un même poste, chacune avec un `X-Forwarded-For` différent :
  ```bash
  for i in $(seq 1 31); do curl -s -o /dev/null -w '%{http_code}
' -H "X-Forwarded-For: 198.51.100.$i" -H 'content-type: application/json' -d '{"email":"inconnu@linkr.test","password":"x"}' https://linkrapp.com/api/auth/login; done
  ```
  Les 30 premières répondent `401`, la 31ᵉ `429`. Si toutes répondent `401`, l'en-tête forgé est cru : **ne pas ouvrir aux testeurs**.
- **Compteurs séparés** : juste après, la même requête depuis une **autre** IP publique (partage de connexion du téléphone) répond `401`, pas `429`. Si elle répond `429`, tous les visiteurs partagent un compteur (confiance mal configurée).

## Fichiers

| Fichier | Rôle |
|---|---|
| `apps/api/Dockerfile` | Build multi-étapes, dépendances installées dans le conteneur depuis le lockfile, image finale avec les seules dépendances de production, utilisateur `node`, `NODE_ENV=production` en dur. Healthcheck `GET /health` (base + Redis). |
| `apps/web/Dockerfile` | Sortie Next `standalone`, les trois `NEXT_PUBLIC_*` en arguments de build (refus si vide), utilisateur `node`. Healthcheck `GET /robots.txt`. |
| `.dockerignore` | Contexte = racine du monorepo ; aucun `node_modules` du poste, aucun `.env`. |
| `deploy/compose.yaml` | Services, réseaux, volumes, `restart: unless-stopped`, journaux `json-file` 10 Mo × 3. |
| `deploy/Caddyfile` | Proxy inverse, HTTPS automatique. |
| `deploy/.env.example` | Variables du compose (tag d'image, ACME, Postgres). |
| `deploy/api.env.example` | Variables d'exécution de l'API. Inventaire : `env.md`. |
| `.github/workflows/images.yml` | Build amd64 + push GHCR (tags `<sha complet>` et `latest`) sur `main` ; build seul sur PR. |

## Migrations

Jamais au démarrage de l'API. Service ponctuel `migrate` (même image, profil `tools`) :

```bash
docker compose --profile tools run --rm migrate
```

À lancer **après la sauvegarde** et **avant** `docker compose up -d` de la nouvelle version. La première migration crée les extensions `postgis` et `pgcrypto` (l'utilisateur `POSTGRES_USER` de l'image est superutilisateur).

## Catalogue de référence

Les métiers, services et exigences réglementaires ne viennent d'aucune migration : **le fichier `apps/api/src/database/seeders/quebec-catalog.seed.ts` est la source de vérité**. Sans lui, `GET /service-categories` renvoie `[]` et le tableau de bord prestataire ne propose aucun métier.

```bash
docker compose --profile tools run --rm seed-catalog
```

À lancer **après `migrate`** au premier déploiement, puis à chaque modification du catalogue (nouvelle image déployée d'abord). Jamais lancé par `deploy.sh`. Rejouable sans risque : une 2ᵉ exécution n'écrit rien.

**Journal** (une ligne par entrée, clé = `slug`, jamais renommé) :

| Symbole | Sens |
|---|---|
| `+` | absent de la base, créé |
| `~` | existant, nom / description / ordre réalignés sur le fichier |
| `=` | identique, rien d'écrit |
| `!` | divergence **non appliquée** (voir ci-dessous) |
| `?` | présent en base, absent du fichier : signalé seulement, jamais supprimé |

Le résumé final donne les compteurs `created / updated / unchanged / diverged / not-in-file`. Premier lancement attendu : `created=33` (7 métiers, 19 services, 7 exigences).

**Ajouter un métier ou un service** : éditer les tableaux `CATEGORIES` / `ITEMS` / `REQUIREMENTS` du fichier avec un `slug` neuf, merger, déployer l'image, relancer la commande. **Ne jamais renommer un slug** : ce serait une nouvelle entrée, et l'ancienne resterait en base.

**Que fait `!` ?** Le `regulation_level` d'un métier et les champs d'une exigence (`authority_full_name_translations`, `required_document_type`, `input_type`, `is_required`) décident des vérifications exigées des prestataires. Le seed ne les modifie jamais sur une ligne existante. Une divergence est une **décision humaine** : migration ou requête SQL ponctuelle, après relecture, jamais un écrasement automatique par un redéploiement.

**Retirer un métier** : on le désactive (`UPDATE service_categories SET is_active = false WHERE slug = '…'`), on ne le supprime pas. Le seed ne touche ni `is_active` ni `approval_status` d'une ligne existante : un métier désactivé reste désactivé.

## Premier déploiement (`deploy.sh` automatise ensuite les mises à jour : voir « Mise à jour »)

1. **GitHub** : Variables du dépôt `NEXT_PUBLIC_API_URL=http://api:5000`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (clé de test), `NEXT_PUBLIC_MAPTILER_KEY` (clé de production restreinte à `linkrapp.com`, sans `localhost`). Merger sur `main` → le workflow publie les images. Vérifier dans *Packages* que les deux paquets sont **privés**.
2. **DNS** : `A` de `linkrapp.com` et `www.linkrapp.com` vers le VPS (**aucun `AAAA`** : voir « Adresse du client »), **avant** le premier démarrage de Caddy (sinon le défi ACME échoue et Let's Encrypt limite les essais).
3. **Serveur** : Docker Engine + plugin Compose ; UFW autorise 22, 80, 443/tcp, 443/udp. Copier `deploy/` (compose, Caddyfile, exemples) dans `/opt/linkr`. Vérifier que le sous-réseau `172.30.10.0/24` est libre (« Sous-réseau Docker » ci-dessous).
4. **Accès GHCR** : jeton GitHub *classic* limité à `read:packages`, puis `echo "$JETON" | docker login ghcr.io -u claude-aye --password-stdin`.
5. **Secrets** : `cp .env.example .env` et `cp api.env.example api.env`, remplir, `chmod 600 .env api.env`. `IMAGE_TAG` = SHA complet du commit publié. Mot de passe Postgres en hexadécimal (`openssl rand -hex 32`) : il est inséré tel quel dans `DATABASE_URL`.
6. `docker compose pull && docker compose up -d postgres redis && docker compose --profile tools run --rm migrate && docker compose --profile tools run --rm seed-catalog`
7. `docker compose up -d`, puis `docker compose ps` (tous `healthy`) et `curl -I https://linkrapp.com`.
8. **Stripe** : créer le point de terminaison `https://linkrapp.com/webhooks/stripe` (mode test), copier son `whsec_` dans `api.env` (`STRIPE_WEBHOOK_SECRET`), puis `docker compose up -d api` (le secret est lu au démarrage).

**Retour arrière** : remettre l'ancien `IMAGE_TAG` puis `docker compose up -d`. Une migration déjà appliquée ne se défait pas ainsi (`migration:revert` explicite, après lecture de son `down()`).

## Mise à jour (`deploy/deploy.sh`)

Sur le VPS, depuis `/opt/linkr` (le script y est copié : `scp deploy/deploy.sh deploy/backup/* …`) :

```bash
./deploy.sh <SHA complet du commit publié>
```

Le SHA est toujours explicite : 40 caractères hexadécimaux minuscules, `latest` et les SHA courts sont refusés. Ordre des étapes :

1. Verrou (`flock`) : deux déploiements simultanés sont refusés.
2. `docker compose pull api web` avec le nouveau tag, **avant** de toucher quoi que ce soit : si le tag n'existe pas dans GHCR, rien n'a changé.
3. `backup/backup.sh`. Si la sauvegarde échoue : **arrêt**, rien n'est modifié.
4. Nouveau `IMAGE_TAG` dans `.env` (l'ancien `.env` est gardé en `.env.bak`, `chmod 600`, écrasé à chaque déploiement), puis `docker compose --profile tools run --rm migrate`. Si `migrate` échoue : l'ancien tag est remis, rien n'est redémarré.
5. `docker compose up -d`, puis attente (180 s au plus, variable `WAIT_TIMEOUT`) que `api` et `web` soient `healthy`.
6. Si un service n'est pas sain : l'ancien tag est remis, `up -d` relancé, l'état de `docker compose ps` est affiché, et le script se termine en erreur.

Le script n'affiche jamais le contenu de `.env`.

> **⚠️ Le retour arrière ne défait QUE l'image, jamais la base.** Une migration appliquée reste appliquée, et si `migrate` échoue la base peut être partiellement migrée. Revenir en arrière côté base : `migration:revert` explicite après lecture du `down()`, ou restauration de la sauvegarde (« Sauvegardes »). Écrire des migrations compatibles avec l'image précédente reste la seule vraie protection.

> **Si `deploy/compose.yaml` ou `deploy/Caddyfile` changent dans une PR, les recopier sur le VPS (`scp`) AVANT de lancer `deploy.sh`.** Le script ne tire que les images : il ne met pas ces fichiers à jour.

## Sauvegardes

Une sauvegarde chiffrée par jour, plus une avant chaque déploiement (`deploy.sh`).

**Schéma.** `backup/backup.sh` produit deux fichiers dans un répertoire temporaire (`/opt/linkr/backup/tmp.*`, effacé en sortie) : `pg_dump -Fc` de la base et archive `tar.gz` du volume `linkr_uploads` (photos du portfolio), pris l'un après l'autre dans la même exécution. Chacun est **chiffré avec `age`** vers une clé publique (`backup/age-recipient.txt`) puis envoyé par `rclone` vers OVH Object Storage (région BHS), bucket `linkr-backups-prod`, dossiers `db/` et `uploads/`. Après chaque envoi, la taille distante est comparée à la taille locale. Rétention : **14 jours** (`rclone delete --min-age 14d`). En fin de succès, un signal est envoyé à Healthchecks.io ; **sans signal pendant 26 h, Healthchecks alerte**.

**Minuterie.** `linkr-backup.timer` : tous les jours à **3 h, heure de Québec** (`America/Toronto`), `Persistent=true` (une exécution manquée parce que le serveur était éteint est rattrapée au démarrage). `linkr-backup.service` : `oneshot`, utilisateur `ubuntu`, après `docker.service`. Installation : copier les deux unités dans `/etc/systemd/system/`, puis `sudo systemctl daemon-reload && sudo systemctl enable --now linkr-backup.timer`. Lancer à la main : `sudo systemctl start linkr-backup.service`, puis `journalctl -u linkr-backup.service`.

**Fichiers qui ne vivent que sur le serveur** (ignorés par git) : `backup/rclone.conf` (accès OVH), `backup/age-recipient.txt` (clé **publique**), `backup/healthcheck.url`. Les versions réelles se copient avec `chmod 600`.

**Clés.** Le VPS ne détient que la clé **publique** : un serveur compromis ne peut pas lire les sauvegardes passées. La clé **privée** est dans Bitwarden, avec une copie hors ligne. Sans elle, les sauvegardes sont irrécupérables : vérifier qu'on peut la lire avant d'en avoir besoin.

**Restauration dans un Postgres jetable** (sans jamais écrire la clé privée sur le disque). Depuis un poste de confiance, avec `rclone`, `age` et Docker :

```bash
# 1. Récupérer le fichier chiffré
rclone --config rclone.conf copyto ovh:linkr-backups-prod/db/linkr-db-<HORODATAGE>.dump.age db.dump.age

# 2. Postgres jetable (même image que la production)
docker run -d --name linkr-restore -e POSTGRES_PASSWORD=restore postgis/postgis:16-3.4

# 3. Déchiffrer et restaurer ; la clé privée n'est saisie qu'en mémoire (rien sur le disque)
read -rs AGE_KEY && echo
age -d -i <(printf '%s\n' "$AGE_KEY") db.dump.age \
  | docker exec -i linkr-restore pg_restore -U postgres -d postgres --no-owner --clean --if-exists
unset AGE_KEY

# 4. Vérifier, puis tout jeter
docker exec linkr-restore psql -U postgres -c 'SELECT count(*) FROM users;'
docker rm -f linkr-restore && rm db.dump.age
```

Les uploads se restaurent de la même façon : `age -d … | tar -tzf -` pour lister, `tar -xzf -` dans un dossier jetable pour extraire. La base et les uploads d'une même exécution portent des horodatages proches : restaurer la paire la plus proche, sinon des photos référencées manquent (ou des fichiers restent orphelins).

> **⚠️ À refaire après la première semaine de testeurs : un test de restauration avec de vraies données.** Les sauvegardes actuelles ont été éprouvées sur une base presque vide. Une sauvegarde jamais restaurée n'est pas une sauvegarde.

**Sous-traitants ajoutés par les sauvegardes** (à reporter dans l'ÉFVP, `docs/compliance/efvp-2026-10.md`, avant la production) :

| Service | Reçoit | Notes |
|---|---|---|
| OVH Object Storage (BHS, Canada) | Les sauvegardes, **chiffrées** : OVH ne peut pas les lire | Même fournisseur que le VPS |
| Healthchecks.io | **Un signal vide** (une requête HTTP sans corps ni donnée) à la fin de chaque sauvegarde réussie | Aucun renseignement personnel |

## ⚠️ Avant d'ouvrir aux testeurs

- **PR D2 — à vérifier sur le VPS.** La configuration est en place (« Adresse du client ») ; les deux vérifications « En-tête forgé ignoré » et « Compteurs séparés » doivent passer avant d'ouvrir. Sinon tous les visiteurs partagent un seul compteur sur `login`, `signup`, `forgot-password` et `reset-password`, et le premier qui l'épuise bloque tout le monde.
- **Sauvegardes** (« Sauvegardes » ci-dessus) : le volume `uploads` (photos du portfolio, `STORAGE_DRIVER=local`) doit être sauvegardé **avec** la base, au même moment : une base restaurée sans ses fichiers référence des photos absentes, et l'inverse laisse des fichiers orphelins. `redis_data` porte les files BullMQ en cours, pas des données durables.
