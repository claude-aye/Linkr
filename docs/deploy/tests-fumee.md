# Tests de fumée de l'essai

Six parcours Playwright, lancés **à la main** depuis le poste de dev contre l'essai, pour rejouer les mêmes vérifications après chaque déploiement. Pas de CI. Code : `e2e/` (paquet autonome, voir plus bas). Le **parcours de paiement** est un septième test, lancé à part (section « Parcours de paiement »).

## Prérequis

- Node 22 ou plus (la config lit `.env.e2e` avec `process.loadEnvFile`) et pnpm.
- Une fois : `cd e2e && pnpm install --ignore-workspace && pnpm exec playwright install chromium`.

## Configuration

Copier `e2e/.env.e2e.example` en `e2e/.env.e2e` (ignoré par Git) :

| Variable | Rôle |
|---|---|
| `E2E_BASE_URL` | **Obligatoire**, sans valeur par défaut. Seule URL visée, sans barre finale. |
| `E2E_PROVIDER_EMAIL` / `E2E_CLIENT_EMAIL` | Facultatives. Remplacent l'adresse fixe du compte ; **adresse `@linkrapp.com` seulement** (sinon refus). |
| `E2E_PROVIDER_PASSWORD` / `E2E_CLIENT_PASSWORD` | Facultatives. Mot de passe d'un compte déjà inscrit dont `accounts.json` ne connaît pas le mot de passe (autre poste). Elles ne suppriment plus l'inscription : elle est tentée, et un « courriel déjà utilisé » mène à la connexion avec ce mot de passe. |
| `E2E_ALLOW_PAYMENT` | Parcours de paiement seulement. Doit valoir `1` (voir plus bas). |

Les comptes ont des **adresses fixes** : `e2e-prestataire@linkrapp.com` et `e2e-client@linkrapp.com` (une règle Cloudflare Email Routing par adresse). Jamais d'alias `e2e+…@gmail.com` : chez Gmail, la partie locale « e2e » est la boîte d'un inconnu, qui recevrait les courriels transactionnels.

Au premier lancement, la suite inscrit chaque compte avec un mot de passe aléatoire et le mémorise dans `e2e/.auth/accounts.json` (ignoré par Git), avec l'état de session. Aux lancements suivants elle les réutilise. Si l'inscription répond « Un compte existe déjà avec ce courriel » alors qu'aucun mot de passe n'est connu, la suite échoue avec « Compte existant, mot de passe inconnu : définir E2E_PROVIDER_PASSWORD » (ou `E2E_CLIENT_PASSWORD`) et ne tente rien d'autre.

Les anciens comptes `e2e+…@gmail.com` sont **abandonnés** : ils restent en base jusqu'à la purge de fin d'essai, et la suite ignore leur entrée dans `accounts.json`.

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
| B | Inscription prestataire, connexion, création du profil `e2e-prestataire-linkrapp` (« 1 rue des Remparts, Québec », rayon 25 km). |
| C | **Prioritaire.** « Mes métiers » propose les 7 métiers (3 réglementés grisés, 4 actifs) et n'affiche pas « La liste des métiers n’a pas pu être chargée ». |
| D | Déclaration de Coiffure ; la ligne apparaît avec « Aucune vérification requise ». Rejouable (un 409 « déjà déclaré » compte comme un succès). |
| E | Un client cherche « Coiffure » autour de « Place d’Youville, Québec » et retrouve le prestataire de B et D. |
| F | Mauvais mot de passe : « Identifiants invalides », reste sur `/login`, aucune erreur JavaScript. |

B et E utilisent les **vrais** services externes (Nominatim, MapTiler), sans doublure. Les adresses sont fixes : le cache de géocodage de l'API (30 jours) évite Nominatim après le premier lancement. Les candidats d'adresse sont choisis par **libellé** (« Agglomération de Québec »), jamais par position : le géocodeur place Montréal avant Québec pour « Place d’Youville ». Un échec de géocodage produit un message qui commence par « ÉCHEC DE GÉOCODAGE (service externe…) », distinct d'un échec applicatif.

## Lire le rapport

Les parcours se suivent (B alimente C, D et E) : si B échoue, la suite s'arrête. En cas d'échec, `e2e/test-results/` contient une trace Playwright (`pnpm exec playwright show-trace <trace.zip>`) et une capture ; elles peuvent montrer des courriels de test, ne jamais les committer.

## Comptes créés et purge de fin d'essai

Tous les comptes ont le prénom **« e2e »**. Comptes actuels : `e2e-prestataire@linkrapp.com` (profil `e2e-prestataire-linkrapp`) et `e2e-client@linkrapp.com`. Anciens comptes abandonnés : courriels `e2e+…@gmail.com`, profils `e2e-prestataire-aaaammjj`. Les demandes du parcours de paiement sont titrées `e2e-paiement-aaaammjjThhmmZ`. C'est le critère pour les retrouver et les purger en fin d'essai. Il n'y a aucune purge automatique : la suite n'écrit jamais en base.

## Budget de débit

Les routes d'authentification sont limitées par IP (`login` 30/h, `signup` 10/h). Un lancement à froid consomme 2 inscriptions et 2 connexions ; un lancement à chaud, 1 à 2 connexions. Ne pas relancer en boucle, ne jamais écrire de test qui vise le 429.

## Limites

- Hors périmètre des six tests de fumée : paiement (voir « Parcours de paiement »), onboarding Stripe Connect, réinitialisation de mot de passe par courriel (manuel).
- Pas d'accès base, SSH ni API en dehors de ce que fait le navigateur.
- Le test A dérive l'adresse `www.` de `E2E_BASE_URL` ; il est ignoré pour `localhost`, une IP ou une URL en `http:`.
- Le jeton de rafraîchissement est à usage unique : l'état de session mémorisé peut être périmé au lancement suivant, la suite se reconnecte alors (1 connexion).

## Parcours de paiement

Un seul test chaîné (`e2e/tests/payment.spec.ts`), découpé en étapes : un client réserve « Coupe homme » chez `e2e-prestataire-linkrapp`, enregistre la carte de test, le prestataire accepte (acompte de 20 % prélevé hors session), démarre et termine, le client confirme (solde de 80 %), et le webhook Stripe fait passer la demande à « Payée ».

**Il ne tourne jamais dans `pnpm test`** (`testIgnore` de `playwright.config.ts`, donc pas non plus dans un `playwright test` nu), ni en CI. Il a sa propre configuration, `playwright.payment.config.ts`, qui **refuse de se charger** si `E2E_ALLOW_PAYMENT` ne vaut pas `1` : aucun navigateur n'est lancé, aucune requête ne part.

### Prérequis, dans l'ordre

1. La PR qui introduit ce parcours est mergée.
2. `pnpm test` lancé une fois : il crée les comptes `e2e-prestataire@linkrapp.com` et `e2e-client@linkrapp.com`, le profil prestataire et le métier Coiffure.
3. **À la main** : se connecter avec le compte prestataire e2e (mot de passe dans `e2e/.auth/accounts.json`), faire l'onboarding Stripe Connect depuis la bande « Configurez vos paiements », et **revenir par le bouton de Stripe** vers le site. C'est la page de retour (`/dashboard/paiements/retour`) qui synchronise le compte : `account.updated` d'un compte connecté n'est pas vérifiable par l'API sur ce point de terminaison (dette `CLAUDE.md` §6).
4. Lancer, depuis `e2e/` :

```bash
E2E_ALLOW_PAYMENT=1 pnpm test:paiement
```

Sous PowerShell : `$env:E2E_ALLOW_PAYMENT = '1'; pnpm test:paiement`, puis `Remove-Item Env:E2E_ALLOW_PAYMENT`. `pnpm test:paiement:list` liste le test sans rien exécuter (la variable est aussi exigée).

### Étapes

| Étape | Vérifie |
|---|---|
| 0 | Profil prestataire présent ; aucune bande Connect bloquante (« Configurez vos paiements », « Vérification en cours », « Stripe a besoin d’informations », « Vous ne pouvez pas encore être payé », « Votre compte de paiement est bloqué ») ; service « Coupe homme » à 40 $ ajouté s'il manque (un 409 compte comme succès). « Vos versements sont suspendus » n'est qu'un avertissement. |
| 1 | Carte de test ajoutée sur « Mes cartes », et la confirmation du SetupIntent répond `livemode: false`. |
| 2 | Demande orpheline d'un lancement précédent signalée (avertissement), jamais reprise. Recherche, profil, « Demander », formulaire (début = maintenant + 3 h, arrondi au quart d'heure, en UTC), même montant affiché qu'au profil, 201. |
| 3 | Acceptation : réponse **200** exigée (une 202 « acompte non réglé » fait échouer le test), aucun « Relancer le prélèvement », la demande est « Acceptée » côté client. |
| 4 | « Démarrer » puis « Compléter ». |
| 5 | « Confirmer la fin des travaux », réponse 200, « Versement effectué », puis rechargement jusqu'à « Payée » (90 s au plus, sans attente fixe). Sinon : « WEBHOOK NON REÇU (la demande est restée Complétée) ». |

Durée prévue : 2 à 3 minutes.

### Garde-fous (ne jamais les assouplir)

| Garde-fou | Où |
|---|---|
| Refus sans `E2E_ALLOW_PAYMENT=1` (configuration et fichier de test) | `playwright.payment.config.ts`, en tête de `tests/payment.spec.ts` |
| Bandeau « Version d'essai · … en mode test » visible avant l'ajout de la carte, avant « Accepter » et avant « Confirmer et verser » | `expectTrialBanner`, `lib/payment.ts` |
| Toute requête vers `api.stripe.com` portant `pk_live_` est bloquée et arrête le parcours | `installPaymentGuards`, `lib/payment.ts` |
| La confirmation du SetupIntent doit répondre `livemode: false` | `expectTestModeSetupConfirm`, `lib/payment.ts` |
| Une seule carte, la constante littérale `4242424242424242`, vérifiée avant la saisie et relue après | `TEST_CARD_NUMBER`, `assertTestCard`, `typeTestCard`, `lib/payment.ts` |
| Le cadre principal ne quitte jamais l'origine de `E2E_BASE_URL` (les iframes Stripe ne sont pas concernées) | `installPaymentGuards`, `lib/payment.ts` |

La suite ne connaît **aucune** clé Stripe et n'appelle jamais l'API Stripe : tout passe par le navigateur. Le bandeau est du texte figé dans le layout : il prouve qu'on est sur l'essai, pas le mode de Stripe. La preuve du mode test est `livemode: false` : le SetupIntent est créé par la clé secrète de l'API, et Stripe refuse qu'une clé publiable de test confirme un SetupIntent créé en mode réel.

### Ce que crée chaque lancement

- 1 demande titrée `e2e-paiement-aaaammjjThhmmZ` (UTC), qui finit « Payée » ;
- 2 paiements de test (acompte et solde) et leurs PaymentIntents chez Stripe ;
- 1 carte enregistrée sur le compte client (une nouvelle à chaque lancement : le dédoublonnage se fait sur l'identifiant Stripe, pas sur le numéro) ;
- 3 courriels vers `e2e-*@linkrapp.com` (`direct-booking` au prestataire, `request-accepted` et `job-completed` au client) ;
- des notifications in-app.

Aucune purge par l'interface. Repères de purge : titre `e2e-paiement-*`, adresses `e2e-*@linkrapp.com`.

Une demande qui n'est pas allée au bout (lancement en échec) reste dans son état ; une demande `OPEN` expire seule à l'heure de début souhaitée. Le lancement suivant la signale et en crée une nouvelle.

### Lire un échec

- Message en « PRÉCONDITION » : rien n'a été prélevé ; refaire l'onboarding Connect ou relancer `pnpm test`.
- « ACOMPTE NON RÉGLÉ (202) » ou « SOLDE NON RÉGLÉ (202) » : la carte a exigé une confirmation ; à examiner à la main.
- « WEBHOOK NON REÇU » : vérifier la destination Stripe (`payment_intent.succeeded`) et les journaux de l'API.
- Les traces (`test-results/`) contiennent la clé publiable de test et le numéro de la carte de test dans les requêtes réseau : rien de secret, mais ne jamais les committer.

### Ce qui reste manuel

Onboarding Stripe Connect, cartes 3D Secure, échec d'acompte (`payment_intent.payment_failed`), contestation, remboursements admin, cron d'auto-libération (72 h), contenu des courriels.

## Pourquoi `e2e/` est hors du workspace

`e2e/` a son propre `pnpm-lock.yaml` et un `pnpm-workspace.yaml` vide, et s'installe avec `--ignore-workspace`. Le lockfile racine, les Dockerfiles de production et les workflows n'en savent rien, pour que Playwright ne puisse jamais entrer dans une image ni dans la CI. `e2e` figure dans `.dockerignore`.
