# Variables d'environnement — inventaire de production

Dérivé de `apps/api/src/config/env.validation.ts` (source de vérité de l'API) et du code de `apps/web`. Mis à jour dans la même PR que tout changement de variable.

**Colonne « Quand »** : *exéc.* = lue au démarrage ou à l'exécution ; *build* = figée dans le JavaScript au `next build` (`NEXT_PUBLIC_*`), donc présente **au moment du build**, pas seulement au démarrage.

## Garde de démarrage en production (API)

Avec `NODE_ENV=production`, l'API refuse de démarrer, en listant les noms (jamais les valeurs), si :
- une variable obligatoire manque (liste ci-dessous) ;
- `WEB_APP_BASE_URL`, `CONNECT_ONBOARDING_RETURN_URL` ou `CONNECT_ONBOARDING_REFRESH_URL` n'est pas posée (elles ont un défaut localhost en développement) ;
- `LOG_LEVEL=debug`.

Côté web, `NEXT_PUBLIC_API_URL` absente en production fait échouer `next build` (plus de repli sur `localhost:5000`).

## API (`apps/api/.env`)

| Variable | Obligatoire en prod | Quand | Secret | Exemple | Notes |
|---|---|---|---|---|---|
| `NODE_ENV` | oui | exéc. | non | `production` | ⚠️ Sans `production`, TypeORM journalise chaque requête SQL avec ses paramètres (courriels, point cherché). Désactive aussi Swagger. |
| `PORT` | non (défaut 3000) | exéc. | non | `5000` | |
| `LOG_LEVEL` | non (défaut `log`) | exéc. | non | `log` | ⚠️ Jamais `debug` : le cache de géocodage journalise les adresses saisies. Refusé au boot en production. |
| `TRUSTED_PROXY_IPS` | oui en pratique | exéc. | non | `10.0.0.5` | Hors périmètre D1 (PR D2). Défaut `loopback` : à renseigner dès que le web est sur un autre hôte. |
| `DATABASE_URL` | oui | exéc. | oui | `postgresql://user:pass@host:5432/linkr` | |
| `REDIS_URL` | oui | exéc. | oui | `redis://host:6379` | Ne jamais `FLUSHDB` (files BullMQ). |
| `JWT_ACCESS_SECRET` | oui | exéc. | oui | 32+ caractères aléatoires | Doit différer du secret de rafraîchissement. |
| `JWT_REFRESH_SECRET` | oui | exéc. | oui | 32+ caractères aléatoires | |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | non | exéc. | non | `15m` / `7d` | |
| `STRIPE_SECRET_KEY` | oui | exéc. | oui | `sk_test_…` | ⚠️ Clés de **TEST** pendant toute la version d'essai (le bandeau du site dit « paiements en mode test »). |
| `STRIPE_WEBHOOK_SECRET` | oui | exéc. | oui | `whsec_…` | Celui du point de terminaison du **déploiement**, pas celui de `stripe listen`. Lu une fois au démarrage : redémarrer après changement. |
| `STRIPE_PUBLISHABLE_KEY` | oui | exéc. | non | `pk_test_…` | Validée, inutilisée par l'API. Même compte Stripe que la clé du web. |
| `STRIPE_CONNECT_CLIENT_ID` | non | — | non | — | Dormante. |
| `CONNECT_ONBOARDING_RETURN_URL` | **oui en prod** | exéc. | non | `https://app.exemple.ca/dashboard/paiements/retour` | Lue au constructeur : redémarrage requis. |
| `CONNECT_ONBOARDING_REFRESH_URL` | **oui en prod** | exéc. | non | `https://app.exemple.ca/dashboard/paiements/reprise` | Idem. |
| `WEB_APP_BASE_URL` | **oui en prod** | exéc. | non | `https://app.exemple.ca` | Base des liens absolus des courriels (réinitialisation, notifications). |
| `PLATFORM_COMMISSION_RATE_PERCENT` | oui | exéc. | non | `10` | |
| `PLATFORM_DEPOSIT_RATE_PERCENT` | oui | exéc. | non | `20` | |
| `PLATFORM_AUTO_RELEASE_HOURS` | oui | exéc. | non | `72` | Lue au démarrage. |
| `PLATFORM_DEFAULT_CURRENCY` | non | exéc. | non | `CAD` | |
| `SMTP_HOST` / `SMTP_PORT` | oui | exéc. | non | `smtp-relay.brevo.com` / `587` | |
| `SMTP_SECURE` | non | exéc. | non | `false` | `true` seulement pour TLS implicite (465). |
| `SMTP_USER` / `SMTP_PASSWORD` | non, mais ensemble | exéc. | oui | — | L'une sans l'autre fait échouer le boot. |
| `EMAIL_FROM_ADDRESS` | oui | exéc. | non | `no-reply@exemple.ca` | |
| `EMAIL_FROM_NAME` | non | exéc. | non | `Linkr` | |
| `NOMINATIM_USER_AGENT` | oui | exéc. | non | `Linkr/1.0 (support@linkrapp.com)` | Exigé par les conditions de Nominatim. |
| `NOMINATIM_BASE_URL` / `GEOCODING_PROVIDER` | non | exéc. | non | défauts | Instance auto-hébergée à prévoir avant la production réelle. |
| `STORAGE_DRIVER` | non (défaut `local`) | exéc. | non | `s3` | `local` écrit sur le disque du conteneur (portfolio, documents). |
| `STORAGE_LOCAL_DIR` | non | exéc. | non | `./storage/uploads` | Volume persistant requis si `local`. |
| `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | si `s3` | exéc. | `…KEY`/`…SECRET` oui | — | |
| `STORAGE_ENDPOINT` | non | exéc. | non | — | Fournisseurs compatibles S3. |
| `GOOGLE_OAUTH_*`, `APPLE_OAUTH_*` | non | — | oui | — | OAuth non exposé dans le web ; ne pas activer (dette §6). |

## Web (`apps/web`, `.env.local` ou environnement du build)

| Variable | Obligatoire en prod | Quand | Secret | Exemple | Notes |
|---|---|---|---|---|---|
| `NODE_ENV` | oui | build + exéc. | non | `production` | Posé par `next build` / `next start`. |
| `NEXT_PUBLIC_API_URL` | **oui** | **build** | non | `https://api.exemple.ca` | Absente en production : `next build` échoue. Utilisée côté serveur seulement ; si le serveur web atteint l'API par une adresse interne, voir la dette « URL interne » (§6). |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | oui (sinon l'ajout de carte est éteint) | **build** | non | `pk_test_…` | Clé de TEST pendant l'essai, du même compte que `STRIPE_SECRET_KEY`. |
| `NEXT_PUBLIC_MAPTILER_KEY` | oui (sinon « Carte indisponible ») | **build** | non (publique) | — | Clé de **production distincte** de celle du développement, restreinte au domaine de production, **sans `localhost`**. |

## Hors variables

`SUPPORT_EMAIL` est une constante (`apps/web/src/lib/constants.ts`), pas une variable.
