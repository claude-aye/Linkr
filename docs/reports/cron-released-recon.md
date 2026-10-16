# Recon — compteur `released` du cron d'auto-libération

Mandat : `MANDAT_CRON_RELEASED.md` (voie (a), décision du 16 octobre 2026).
Branche : `fix/cron-released-count`, depuis `main` à `ebae71d`. Lecture seule, aucune modification.

## 1. Emplacements

| Élément | Fichier |
|---|---|
| `findAwaitingRelease` | `apps/api/src/modules/service-requests/repositories/service-request.repository.ts:952` |
| Boucle du cron et compteur `released` | `ServiceRequestsService.runAutoReleaseCheck`, `service-requests.service.ts:1486-1517` (`released++` à la ligne 1499) |
| Déclencheur horaire | `ServiceRequestsCron.handleAutoRelease`, `service-requests.cron.ts` (`@Cron('0 * * * *')`) |
| Appel de capture | `releaseBalance` (`service-requests.service.ts:1407`) → `PaymentsService.captureBalance` (`payments.service.ts:420`) |

Prédicat actuel de `findAwaitingRelease` : `status = 'COMPLETED'`, `contested_at_utc IS NULL`, `deleted_at_utc IS NULL`, `completed_at_utc IS NOT NULL`, `completed_at_utc < now() - make_interval(hours => $1)`. Rien sur `payments`.

## 2. Le court-circuit « déjà une ligne `BALANCE` »

Il vit dans **`captureBalance`** (`payments.service.ts`, sous arrêt dur), pas dans la boucle :

```ts
const existingBalance = await this.paymentRepo.findByServiceRequestAndType(serviceRequestId, PaymentType.BALANCE);
if (existingBalance) { this.logger.log(`Balance already recorded …; skipping`); return; }
```

`findByServiceRequestAndType` (`payment.repository.ts:146`) : `WHERE service_request_id = $1 AND payment_type = $2`.

- **Statuts pris en compte : tous.** Aucun filtre de statut : `PENDING`, `PROCESSING`, `REQUIRES_ACTION`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `REFUNDED`, `PARTIALLY_REFUNDED` court-circuitent tous.
- **Soft delete : sans objet.** `payments` n'a **pas** de colonne `deleted_at_utc` (historique immuable, déviation documentée au §5.7). Aucune règle à reprendre.
- **Endroit** : après les gardes de statut de la demande et **après** la garde « acompte réglé » (`DepositNotSettledException`), avant tout calcul et tout appel Stripe. Il retourne sans erreur → la boucle fait `released++`.

Prédicat à reprendre dans la sélection : `NOT EXISTS (SELECT 1 FROM payments p WHERE p.service_request_id = sr.id AND p.payment_type = 'BALANCE')`.

### Conséquence de l'ordre des gardes — à signaler

Comme la garde « acompte réglé » passe **avant** le court-circuit, une demande `COMPLETED` dont la ligne `BALANCE` existe **et** dont l'acompte n'est plus `SUCCEEDED` (cas réel : un remboursement admin partiel ou total de l'acompte, alors que le solde attend le client) lève aujourd'hui `DepositNotSettledException` **à chaque passage** : `failed++` et une ligne `ERROR` toutes les heures. Après le correctif, cette demande n'est plus sélectionnée : plus d'erreur horaire. C'est la conséquence directe de la voie (a), pas un choix supplémentaire ; elle ne peut pas être évitée sans toucher `captureBalance`. Le compteur `failed` cesse donc, lui aussi, de compter un non-événement. Rare, et le résultat est plus juste ; signalé pour arbitrage dans la PR.

## 3. La garde du courriel `balance-failed-client`

Dans la boucle : `balanceExistedBefore` est lu par `balanceConfirmationState(id).exists` **avant** `releaseBalance` (initialisé à `true`, donc une lecture ratée vaut « ligne existante » et ne déclenche jamais de courriel). Après la tentative, et seulement si `!balanceExistedBefore`, `announceBalanceFailureIfAwaitingClient` relit l'état et n'envoie que si la ligne attend le client.

Preuve que l'exclusion ne la change pas :
- **Passage où la ligne naît** : la demande n'a pas de ligne `BALANCE` → elle est sélectionnée comme avant → `balanceExistedBefore = false` → même chemin, même courriel éventuel.
- **Passages suivants** : avant, la demande était sélectionnée, `balanceExistedBefore = true`, aucun courriel. Après, elle n'est pas sélectionnée : aucun courriel. Même résultat.
- La garde (`balanceExistedBefore`, `announceBalanceFailureIfAwaitingClient`) n'a pas besoin d'être modifiée.

## 4. `deposits-awaiting-confirmation` n'utilise pas `findAwaitingRelease`

`GET /service-requests/deposits-awaiting-confirmation` → `listDepositsAwaitingConfirmation` (`service-requests.service.ts:1002`) → `ServiceRequestRepository.findDepositsAwaitingClientConfirmation` (`:1016`). `grep -rn findAwaitingRelease apps/api/src` ne trouve que le dépôt, `runAutoReleaseCheck` et le mock de `balance-confirmation.spec.ts`. `confirmCompletion` ne l'utilise pas non plus.

## 5. Index sur `payments`

Migration `1780440000000-CreatePaymentsDomain` :
- `uq_payments_request_type` : contrainte `UNIQUE (service_request_id, payment_type)` → index B-tree composite, exactement la clé de la sous-requête `NOT EXISTS`.
- `idx_payments_request` sur `(service_request_id)`.
- `uq_payments_stripe_intent` (partiel, sans rapport).

Aucun index manquant. **Aucune migration.**

## Garde défensive dans la boucle

Le mandat demande de « conserver le court-circuit dans la boucle » sans incrémenter `released`. Le seul court-circuit existant est dans `captureBalance`, qui ne dit pas à son appelant s'il a sauté (retour `void`) et qu'on ne peut pas modifier. La boucle lit déjà `balanceExistedBefore` avant la capture : la garde consistera à ne **pas** appeler `releaseBalance` et à ne **pas** compter quand cette lecture voit une ligne (course : la ligne est née entre la sélection et le traitement, typiquement par le `confirm-completion` du client).

Fenêtre résiduelle assumée : une ligne créée **entre** cette lecture et la lecture interne de `captureBalance` est encore comptée une fois (le court-circuit de `captureBalance` reste muet). Fermer cette fenêtre exigerait que `captureBalance` renvoie un résultat : arrêt dur, hors périmètre.

## Observation e2e et smoke humain

`findAwaitingRelease` filtre déjà `status = 'COMPLETED'` : une demande `PAID` n'a **jamais** été sélectionnée. Les « 3 balance capture(s) triggered » du 12 octobre viennent donc de demandes `COMPLETED` portant déjà une ligne `BALANCE` (solde réglé dont le webhook n'avait pas encore fait passer la demande en `PAID`, ou solde en attente du client). Docker était arrêté pendant la recon : je n'ai pas pu interroger la base de dev. Le rapport final donnera la requête SQL qui liste ces demandes avant le smoke.

## Conditions d'arrêt

Aucune n'est atteinte : le correctif tient dans la requête de sélection (`service-request.repository.ts`) et dans la boucle de `service-requests.service.ts`. Aucun fichier `payments`, aucune migration, aucune modification de la garde du courriel.
