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

## Premier déploiement (le futur `deploy.sh` automatisera les étapes 4 à 7)

1. **GitHub** : Variables du dépôt `NEXT_PUBLIC_API_URL=http://api:5000`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (clé de test), `NEXT_PUBLIC_MAPTILER_KEY` (clé de production restreinte à `linkrapp.com`, sans `localhost`). Merger sur `main` → le workflow publie les images. Vérifier dans *Packages* que les deux paquets sont **privés**.
2. **DNS** : `A` de `linkrapp.com` et `www.linkrapp.com` vers le VPS (**aucun `AAAA`** : voir « Adresse du client »), **avant** le premier démarrage de Caddy (sinon le défi ACME échoue et Let's Encrypt limite les essais).
3. **Serveur** : Docker Engine + plugin Compose ; UFW autorise 22, 80, 443/tcp, 443/udp. Copier `deploy/` (compose, Caddyfile, exemples) dans `/opt/linkr`. Vérifier que le sous-réseau `172.30.10.0/24` est libre (« Sous-réseau Docker » ci-dessous).
4. **Accès GHCR** : jeton GitHub *classic* limité à `read:packages`, puis `echo "$JETON" | docker login ghcr.io -u claude-aye --password-stdin`.
5. **Secrets** : `cp .env.example .env` et `cp api.env.example api.env`, remplir, `chmod 600 .env api.env`. `IMAGE_TAG` = SHA complet du commit publié. Mot de passe Postgres en hexadécimal (`openssl rand -hex 32`) : il est inséré tel quel dans `DATABASE_URL`.
6. `docker compose pull && docker compose up -d postgres redis && docker compose --profile tools run --rm migrate`
7. `docker compose up -d`, puis `docker compose ps` (tous `healthy`) et `curl -I https://linkrapp.com`.
8. **Stripe** : créer le point de terminaison `https://linkrapp.com/webhooks/stripe` (mode test), copier son `whsec_` dans `api.env` (`STRIPE_WEBHOOK_SECRET`), puis `docker compose up -d api` (le secret est lu au démarrage).

**Retour arrière** : remettre l'ancien `IMAGE_TAG` puis `docker compose up -d`. Une migration déjà appliquée ne se défait pas ainsi (`migration:revert` explicite, après lecture de son `down()`).

## ⚠️ Avant d'ouvrir aux testeurs

- **PR D2 — à vérifier sur le VPS.** La configuration est en place (« Adresse du client ») ; les deux vérifications « En-tête forgé ignoré » et « Compteurs séparés » doivent passer avant d'ouvrir. Sinon tous les visiteurs partagent un seul compteur sur `login`, `signup`, `forgot-password` et `reset-password`, et le premier qui l'épuise bloque tout le monde.
- **Sauvegardes (PR séparée)** : le volume `uploads` (photos du portfolio, `STORAGE_DRIVER=local`) doit être sauvegardé **avec** la base, au même moment : une base restaurée sans ses fichiers référence des photos absentes, et l'inverse laisse des fichiers orphelins. `redis_data` porte les files BullMQ en cours, pas des données durables.
