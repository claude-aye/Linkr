# Reconnaissance — solde (80 %) bloqué par le 3D Secure

> Branche `feat/3ds-solde`, 12 octobre 2026. Lecture du code de `main` (`3460aab`) avant toute modification.
> Mandat : `MANDAT_3DS_SOLDE.md` (non commité). Autorisation inscrite dans `CLAUDE.md` (commit `c8f5218`).

## 1. Le chemin de l'acompte, de bout en bout

| Maillon | Où | Réutilisable tel quel ? |
|---|---|---|
| Échec hors session | `PaymentsService.chargeAndPersist` : sur une `StripeError`, `recordFailure(paymentId, détail, intentIdFromError(err))` → ligne `FAILED` **avec** l'id du PaymentIntent quand l'erreur en porte un (cas `authentication_required`, mesuré en H1 du chantier acompte : PI `requires_payment_method`, id dans l'erreur). | Oui, partagé acompte/solde. **Non touché** (arrêt dur). |
| Statuts « à confirmer par le client » | `payments/client-confirmable-deposit.ts` : `CLIENT_CONFIRMABLE_DEPOSIT_STATUSES = [FAILED, REQUIRES_ACTION]`, une seule liste lue par la lecture SQL, la garde du `POST` et l'écriture conditionnelle de la carte. | Oui. La liste ne dépend pas du type de paiement : un solde refusé hors session atterrit dans les mêmes statuts. À documenter comme partagée, pas à dupliquer. |
| Lecture | `GET /service-requests/deposits-awaiting-confirmation` → `ServiceRequestRepository.findDepositsAwaitingClientConfirmation` (SQL brut, `payment_type = DEPOSIT`, statuts ci-dessus, intent non nul, payeur = client = appelant, demande vivante `ASSIGNED/IN_PROGRESS/COMPLETED`, non supprimée). | **À généraliser** : ajouter la branche `BALANCE` (demande `COMPLETED` **et non contestée**) et projeter `payment_type`. |
| Endpoint de préparation | `POST :id/deposit-confirmation` → `ServiceRequestsService.prepareDepositConfirmation` (404 → 403 → 409 sur le statut de la demande) → `PaymentsService.prepareClientDepositConfirmation` (garde de la ligne, lecture du PI au clic, garde d'égalité montant/devise, carte par défaut actuelle, écriture **unique** de `payment_method_id`, réconciliation `attachIntent` + 409 si le PI est déjà réglé). | **À généraliser** : le corps de `prepareClientDepositConfirmation` ne dépend du type que par `PaymentType.DEPOSIT` et par les classes d'exception. Il devient un helper privé paramétré, appelé par deux méthodes publiques. Le comportement de l'acompte ne change pas (ses 45 tests le gardent). |
| Écriture de la carte | `PaymentRepository.setPaymentMethodWhileAwaitingClient` : par id de ligne, conditionnelle aux statuts confirmables. | Oui, tel quel (indépendant du type). |
| Webhook | `StripeWebhookProcessor` : `payment_intent.succeeded` → `PaymentsService.markSucceeded` ; si la ligne est un `BALANCE` `SUCCEEDED` → `ServiceRequestsService.markRequestPaid`. `payment_intent.payment_failed` → `markFailed` (renvoie `null` sur une ligne déjà `FAILED`) ; seul un `DEPOSIT` déclenche des courriels. | Oui, tel quel (voir §3, point 4). |
| Courriels | `notifyDepositFailed` (client + prestataire), gabarits `deposit-failed-client` / `deposit-failed-provider`, registre `EVENT_CHANNELS['deposit.failed']`. | Non réutilisable tel quel : le solde ne prévient **que** le client (mandat §3.4). Nouveau gabarit `balance-failed-client`, nouvel événement `balance.failed`. |
| Front | `/account/payment-methods` (Server Component, lecture locale), `ConfirmDepositAction` (POST → `confirmCardPayment` → POST de synchronisation → `router.refresh()`), relais BFF `api/service-requests/[id]/deposit-confirmation`, module pur `lib/payment-methods/deposit-confirmation.ts` (mapping par code HTTP). `/requests` lit la même liste pour le badge « Paiement à confirmer ». | Le composant et le mapping se généralisent par un seul paramètre (`paymentType` → chemin de l'endpoint). Les codes HTTP de l'endpoint du solde sont **les mêmes** que ceux de l'acompte (401/403/404/409/422/502) : le mapping FR est réutilisable tel quel. Un relais BFF jumeau pour `balance-confirmation`. |

## 2. `captureBalance` aujourd'hui

**Deux appelants**, tous deux par `ServiceRequestsService.releaseBalance` :

1. `confirmCompletion` (le client confirme la fin des travaux) ;
2. `runAutoReleaseCheck` (cron horaire `0 * * * *`, demandes `COMPLETED`, non contestées, complétées depuis plus de `PLATFORM_AUTO_RELEASE_HOURS`).

`captureBalance` : gardes (demande `COMPLETED`, non contestée, acompte `SUCCEEDED`), court-circuit si une ligne `BALANCE` existe (quel que soit son statut), calcul du solde, `INSERT` `PENDING`, puis `chargeAndPersist` (`off_session: true, confirm: true`, clé `bal_<id>`).

**Ce qui se passe sur une carte qui exige le 3D Secure** (`4000 0027 6000 3184`), par lecture de code :

- Stripe refuse avec `card_error` / `authentication_required` ; le PI reste `requires_payment_method` et son id est dans l'erreur (même mesure que H1 du chantier acompte).
- `chargeAndPersist` enregistre la ligne `BALANCE` en `FAILED` **avec** l'id du PI, puis lève `BalanceChargeFailedException` (502).
- **Via `confirm-completion`** : 502, l'écran affiche « Le paiement n'a pas pu être effectué. Veuillez réessayer dans quelques minutes. » Un second clic **répond 200** : `captureBalance` court-circuite sur la ligne existante, sans erreur. L'écran affiche alors « Versement effectué » alors que rien n'a été payé. **C'est pire qu'un cul-de-sac : c'est un faux succès.**
- **Via le cron** : premier passage `failed++` et une ligne d'erreur dans le journal, aucun courriel. Passages suivants : court-circuit silencieux, compté `released++` à chaque heure.
- **Webhook** : `payment_intent.payment_failed` sur le PI du solde → `markFailed` renvoie `null` (ligne déjà `FAILED`) et le processeur ignore de toute façon les `BALANCE`. Rien ne part.
- **Personne ne peut agir** : la lecture ne liste que les `DEPOSIT`, aucun endpoint ne confirme un solde, et la relance du solde n'existe pas (hors périmètre).

**Indistinction 3D Secure / refus** : un refus de carte ordinaire (`card_declined`) laisse **le même** état (`FAILED`, PI `requires_payment_method`). Le statut du PI ne permet pas de les distinguer. C'est pourquoi le chantier acompte traite les deux de la même façon : le client confirme le même PI, avec sa carte par défaut actuelle (éventuellement remplacée). Le solde reprend ce mécanisme sans en inventer un autre. « En attente d'authentification » désigne donc, ici comme pour l'acompte : **ligne `FAILED` ou `REQUIRES_ACTION`, avec un PaymentIntent**.

## 3. Point 4 — la réconciliation de l'endpoint bloque-t-elle `COMPLETED → PAID` ?

**Non.** Lu dans le code :

- `PaymentRepository.markSucceededByIntentId` est un `UPDATE … WHERE status NOT IN (SUCCEEDED, REFUNDED, CANCELLED, PARTIALLY_REFUNDED)` : sur une ligne déjà `SUCCEEDED`, il ne touche rien et renvoie `null`.
- Mais `PaymentsService.markSucceeded` **retombe sur `findByStripeIntentId`** quand l'`UPDATE` ne renvoie rien : « Returns the POST-state payment row (even on a replay where the conditional UPDATE was a no-op) so the webhook worker can idempotently drive a BALANCE → request PAID transition ».
- Le processeur teste ensuite `payment.paymentType === BALANCE && payment.status === SUCCEEDED` et appelle `markRequestPaid`.

Donc si l'endpoint marque d'abord la ligne `SUCCEEDED` (réconciliation), le webhook qui arrive ensuite relit la ligne, la voit `SUCCEEDED`, et fait quand même passer la demande à `PAID`. La règle « on n'avance jamais sur un statut terminal » protège la **ligne de paiement**, pas la transition de la demande.

### Choix : voie (b) — la transition `COMPLETED → PAID` reste au webhook seul

La réconciliation de l'endpoint du solde met à jour la **ligne** (`attachIntent`, comme pour l'acompte) et **ne touche pas la demande**.

Raisons :

1. **Un seul écrivain de la transition.** Aujourd'hui, `COMPLETED → PAID` n'a qu'une source : le webhook, traité par un worker BullMQ séquentiel, avec `markRequestPaid` qui sort sur `PAID` et refuse tout statut autre que `COMPLETED`. La voie (a) ajouterait un second écrivain, sur un autre processus (requête HTTP vs worker), avec une course réelle : les deux lisent `COMPLETED`, les deux écrivent `PAID` (l'`update` de `markRequestPaid` n'est pas conditionnel) et `paid_at_utc` est écrit deux fois. La rendre sûre demanderait un `UPDATE … WHERE status = 'COMPLETED'` dans `markRequestPaid`, c'est-à-dire une modification du traitement du webhook pour un gain de quelques secondes d'affichage.
2. **La voie (b) ne coûte aucune ligne de code** : le mécanisme de relecture existe déjà, exprès pour ce cas.
3. **Aucune dépendance nouvelle** : tout solde, aujourd'hui, ne passe à `PAID` que par le webhook. Le solde confirmé dans le navigateur suit la même règle que le solde prélevé hors session.
4. **Même contrat que l'acompte** : l'endpoint de l'acompte ne fait aucune transition de demande non plus.

Coût accepté : entre la confirmation dans le navigateur et l'arrivée du webhook (quelques secondes), la demande reste `COMPLETED`. Le bandeau de la page de paiement disparaît tout de suite (la ligne est réconciliée), mais la carte de `/requests` affiche encore les boutons de fin de prestation. Un clic sur « Confirmer la fin des travaux » pendant cet intervalle répond 200 (la ligne existe et n'est plus à confirmer), ce qui est vrai : le paiement est fait.

### Les deux ordres d'arrivée (à prouver par test)

| Ordre | Endpoint | Webhook | Résultat |
|---|---|---|---|
| Endpoint puis webhook | PI `succeeded` → ligne réconciliée `SUCCEEDED`, demande `COMPLETED`, 409 « déjà réglé » | `markSucceeded` : `UPDATE` sans effet, relecture → ligne `BALANCE SUCCEEDED` → `markRequestPaid` → `PAID` | une seule transition |
| Webhook puis endpoint | — | ligne `FAILED → SUCCEEDED`, `markRequestPaid` → `PAID` | une seule transition |
| | demande `PAID` → 409 à la garde de la demande, **avant** toute lecture Stripe | — | aucune écriture |

Aucun courriel n'est lié à `PAID` (`markRequestPaid` n'appelle aucune notification) : « pas de double courriel » se vérifie en comptant **zéro** appel au service de notifications sur les deux séquences.

## 4. Ce qu'il faut construire

1. **Lecture** : branche `BALANCE` dans la même requête SQL ; champ `paymentType` (`DEPOSIT` | `BALANCE`) dans l'item. Garde de demande pour le solde : `COMPLETED` **et** `contested_at_utc IS NULL` (le même couple que `confirmCompletion` et le cron). Un solde contesté est gelé : il ne doit pas offrir de bouton.
2. **Endpoint** `POST :id/balance-confirmation` : 404 → 403 → 409 (demande pas `COMPLETED`, ou contestée), puis le helper partagé paramétré par `BALANCE`. Exceptions jumelles, mêmes codes que celles de l'acompte.
3. **`confirm-completion`** : après la tentative de capture, lire si la ligne `BALANCE` attend la confirmation du client. Si oui → **202** (et l'erreur de capture n'est pas propagée). Sinon, comportement inchangé. Le 202 n'est donc rendu **que** lorsqu'un bouton existe sur `/account/payment-methods` (leçon du lot D1 : un 202 ne doit pas promettre un bouton absent).
4. **Cron** : courriel `balance-failed-client` **uniquement** à la vraie transition, c'est-à-dire quand la ligne `BALANCE` n'existait pas avant ce passage et attend la confirmation du client après. Les passages suivants trouvent la ligne existante : rien ne part. Le prestataire ne reçoit rien.
5. **Front** : libellé distinct (« Solde de … » / « Acompte de … »), bouton qui appelle le bon endpoint selon `paymentType`, 202 de `confirm-completion` → navigation vers `/account/payment-methods?solde=a-confirmer`, bandeau sur cette page.

**Aucune migration** : `payment_type` porte déjà `BALANCE`, et les statuts `FAILED` / `REQUIRES_ACTION` existent.

## 5. Zones sous arrêt dur, non touchées

`chargeAndPersist`, `captureBalance` (aucune ligne modifiée : ses gardes, son court-circuit et son arithmétique restent tels quels), `resolveAgreedAmount`, l'arithmétique de l'acompte et du solde, les remboursements, le verrou de `retryDeposit`, la relance du solde par le prestataire (qui n'existe pas).

## 6. Dettes relevées pendant la lecture (non corrigées)

1. **Solde `FAILED` sans PaymentIntent** (erreur Stripe sans intent, ou panne réseau avant la réponse) : aucune voie de sortie. Le client n'a pas de bouton (rien à confirmer), le cron court-circuite, et la relance du solde n'existe pas. Pire : un nouveau `confirm-completion` répond 200 (court-circuit), donc l'écran dit « Versement effectué ». Correctif : la relance du solde (hors périmètre), ou un code distinct sur `confirm-completion` quand la ligne existe sans être réglée.
2. **Le cron compte `released++` à chaque heure** pour toute demande dont la ligne `BALANCE` existe déjà (court-circuit), y compris un solde en attente du client. Le journal « 1 balance capture(s) triggered » se répète indéfiniment sans que rien ne soit prélevé. Correctif : exclure de `findAwaitingRelease` les demandes qui ont déjà une ligne `BALANCE`, ou compter le court-circuit à part.
3. `resolveAgreedAmount` n'est pas unifiée sur `resolveAgreedPrice` (dette §6 déjà inscrite, inchangée).
