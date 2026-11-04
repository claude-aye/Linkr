# Tests de fumée de l'essai

Six parcours Playwright, lancés **à la main** depuis le poste de dev contre l'essai, pour rejouer les mêmes vérifications après chaque déploiement. Pas de CI. Code : `e2e/` (paquet autonome, voir plus bas).

## Prérequis

- Node 22 ou plus (la config lit `.env.e2e` avec `process.loadEnvFile`) et pnpm.
- Une fois : `cd e2e && pnpm install --ignore-workspace && pnpm exec playwright install chromium`.

## Configuration

Copier `e2e/.env.e2e.example` en `e2e/.env.e2e` (ignoré par Git) :

| Variable | Rôle |
|---|---|
| `E2E_BASE_URL` | **Obligatoire**, sans valeur par défaut. Seule URL visée, sans barre finale. |
| `E2E_PROVIDER_EMAIL` / `E2E_PROVIDER_PASSWORD` | Facultatives. Compte prestataire à réutiliser. |
| `E2E_CLIENT_EMAIL` / `E2E_CLIENT_PASSWORD` | Facultatives. Compte client à réutiliser. |

Sans identifiants, la suite crée les comptes (courriel `e2e+prestataire-aaaammjj-xxxxxxxx@gmail.com`, mot de passe aléatoire) et les mémorise dans `e2e/.auth/accounts.json` (ignoré par Git), avec l'état de session. Aux lancements suivants elle les réutilise : aucun compte n'est recréé.

## Lancer

```bash
cd e2e
pnpm test          # lance les 6 parcours
pnpm test:list     # liste sans rien exécuter
pnpm typecheck
pnpm report        # ouvre le rapport HTML du dernier lancement
```

Durée : environ 1 min 30 au premier lancement, 1 min ensuite.

## Parcours

| Test | Vérifie |
|---|---|
| A | Accueil en HTTPS ; `https://www.<domaine>` redirige en 301 vers l'apex. |
| B | Inscription prestataire, connexion, création du profil (« 1 rue des Remparts, Québec », rayon 25 km). |
| C | **Prioritaire.** « Mes métiers » propose les 7 métiers (3 réglementés grisés, 4 actifs) et n'affiche pas « La liste des métiers n’a pas pu être chargée ». |
| D | Déclaration de Coiffure ; la ligne apparaît avec « Aucune vérification requise ». Rejouable (un 409 « déjà déclaré » compte comme un succès). |
| E | Un client cherche « Coiffure » autour de « Place d’Youville, Québec » et retrouve le prestataire de B et D. |
| F | Mauvais mot de passe : « Identifiants invalides », reste sur `/login`, aucune erreur JavaScript. |

B et E utilisent les **vrais** services externes (Nominatim, MapTiler), sans doublure. Les adresses sont fixes : le cache de géocodage de l'API (30 jours) évite Nominatim après le premier lancement. Les candidats d'adresse sont choisis par **libellé** (« Agglomération de Québec »), jamais par position : le géocodeur place Montréal avant Québec pour « Place d’Youville ». Un échec de géocodage produit un message qui commence par « ÉCHEC DE GÉOCODAGE (service externe…) », distinct d'un échec applicatif.

## Lire le rapport

Les parcours se suivent (B alimente C, D et E) : si B échoue, la suite s'arrête. En cas d'échec, `e2e/test-results/` contient une trace Playwright (`pnpm exec playwright show-trace <trace.zip>`) et une capture ; elles peuvent montrer des courriels de test, ne jamais les committer.

## Comptes créés et purge de fin d'essai

Tous les comptes ont le prénom **« e2e »** ; le profil prestataire s'appelle `e2e-prestataire-aaaammjj` ; les courriels commencent par `e2e+`. C'est le critère pour les retrouver et les purger en fin d'essai. Il n'y a aucune purge automatique : la suite n'écrit jamais en base.

## Budget de débit

Les routes d'authentification sont limitées par IP (`login` 30/h, `signup` 10/h). Un lancement à froid consomme 2 inscriptions et 2 connexions ; un lancement à chaud, 1 à 2 connexions. Ne pas relancer en boucle, ne jamais écrire de test qui vise le 429.

## Limites

- Hors périmètre : paiement par carte, onboarding Stripe Connect, réinitialisation de mot de passe par courriel (manuel).
- Pas d'accès base, SSH ni API en dehors de ce que fait le navigateur.
- Le test A dérive l'adresse `www.` de `E2E_BASE_URL` ; il est ignoré pour `localhost`, une IP ou une URL en `http:`.
- Le jeton de rafraîchissement est à usage unique : l'état de session mémorisé peut être périmé au lancement suivant, la suite se reconnecte alors (1 connexion).

## Pourquoi `e2e/` est hors du workspace

`e2e/` a son propre `pnpm-lock.yaml` et un `pnpm-workspace.yaml` vide, et s'installe avec `--ignore-workspace`. Le lockfile racine, les Dockerfiles de production et les workflows n'en savent rien, pour que Playwright ne puisse jamais entrer dans une image ni dans la CI. `e2e` figure dans `.dockerignore`.
