# Rapport final — solde (80 %) bloqué par le 3D Secure

> Branche `feat/3ds-solde`, nuit du 11 au 12 octobre 2026, session autonome.
> Mandat : `MANDAT_3DS_SOLDE.md` (non commité). Reconnaissance : `docs/reports/3ds-solde-recon.md`.

## 0. Déroulé et incidents de la session

1. **Autorisation** : le premier essai de commit de l'autorisation dans `CLAUDE.md` a été **refusé par le classifieur de permissions** (« Instruction Poisoning »), puis toutes les commandes shell l'ont été, lectures comprises. J'ai retiré la modification sans rien commiter et je me suis arrêté. Après votre message (contenu du mandat collé dans la conversation, puis « Reprends »), le commit est passé : `c8f5218`.
2. **Mémoire du poste épuisée en cours de nuit** : `dwm.exe` (le gestionnaire de fenêtres de Windows) occupait 7,6 Go, `vmmem` 4,1 Go et `vmmemWSL` 1,9 Go, pour 15,6 Go au total. Il restait entre 10 et 200 Mo libres. Effets mesurés : jest a mis 41 minutes pour trois petites suites, l'API Docker a répondu 500 puis plus rien, et Postgres (port 5432) était injoignable depuis 04 h 27. Je n'ai arrêté aucun processus système. Voir §4 pour ce que cela a empêché de vérifier.

## 1. Point 4 — choix et preuve

**Choix : voie (b).** La transition `COMPLETED → PAID` reste au webhook seul ; la réconciliation de l'endpoint met à jour la **ligne** de paiement et ne touche jamais la demande.

**Pourquoi la réconciliation ne bloque pas la transition** : `markSucceededByIntentId` ne touche rien sur une ligne déjà `SUCCEEDED` (garde `status NOT IN (terminaux)`), mais `PaymentsService.markSucceeded` **relit alors la ligne** par `findByStripeIntentId`. Le processeur voit un `BALANCE` `SUCCEEDED` et appelle `markRequestPaid`. La règle « on n'avance jamais sur un statut terminal » protège la ligne, pas la transition de la demande.

**Pourquoi (b) plutôt que (a)** : un seul écrivain de la transition (le worker BullMQ, séquentiel, avec une garde `COMPLETED` / sortie sur `PAID`) ; la voie (a) ajouterait un second écrivain dans une requête HTTP, avec une vraie course (deux lectures `COMPLETED`, deux écritures `PAID`, `paid_at_utc` écrit deux fois), qu'il faudrait fermer en modifiant le traitement du webhook. La voie (b) ne coûte **aucune ligne de code** et suit le contrat de tout solde aujourd'hui (et de l'endpoint de l'acompte). Détail : recon §3.

**Preuve** : `apps/api/src/modules/service-requests/balance-paid-ordering.spec.ts`, avec le **vrai** `StripeWebhookProcessor`, le vrai `PaymentsService` et le vrai `ServiceRequestsService`. Le faux dépôt des paiements reproduit la garde SQL des statuts terminaux.

| Ordre | Ce que le test vérifie |
|---|---|
| Endpoint puis webhook | l'endpoint répond 409 « déjà réglé », la ligne est `SUCCEEDED`, la demande reste `COMPLETED` et **aucune** écriture de demande n'a lieu ; le webhook : `UPDATE` sans effet (renvoie `null`), relecture de la ligne, demande `PAID` avec `paid_at_utc` ; **une seule** écriture `PAID` ; un rejeu du webhook n'ajoute rien ; **zéro** notification ; aucun intent créé ni confirmé. |
| Webhook puis endpoint | le webhook fait passer la ligne `FAILED → SUCCEEDED` et la demande à `PAID` (une écriture) ; l'endpoint répond 409 **à la garde de la demande**, sans lire Stripe ni écrire la ligne ; toujours **une seule** écriture `PAID`, **zéro** notification. |

Résultat : **2/2 verts**.

## 2. Fichiers modifiés

### API
- `apps/api/src/modules/payments/client-confirmable-deposit.ts` — la liste des statuts confirmables sert aussi le solde (commentaire) ; nouveau prédicat `isAwaitingClientConfirmation`.
- `apps/api/src/modules/payments/exceptions/payments.exceptions.ts` — cinq exceptions jumelles `Balance*` (mêmes codes que celles de l'acompte).
- `apps/api/src/modules/payments/payments.service.ts` — corps de confirmation partagé (`prepareClientConfirmation`), `prepareClientBalanceConfirmation`, `balanceConfirmationState`. `chargeAndPersist` et `captureBalance` non modifiés.
- `apps/api/src/modules/service-requests/repositories/service-request.repository.ts` — la lecture inclut les soldes (garde `COMPLETED` et non contesté) et projette `payment_type`.
- `apps/api/src/modules/service-requests/dto/deposit-awaiting-confirmation.dto.ts` — champ `paymentType`.
- `apps/api/src/modules/service-requests/dto/balance-confirmation-response.dto.ts` — nouveau DTO de réponse (jumeau de celui de l'acompte).
- `apps/api/src/modules/service-requests/service-requests.service.ts` — `prepareBalanceConfirmation`, `confirmCompletion` → `ConfirmCompletionOutcome` (202), courriel unique du cron (`announceBalanceFailure`).
- `apps/api/src/modules/service-requests/service-requests.controller.ts` — 202 sur `confirm-completion`, route `POST :id/balance-confirmation`, description de la lecture.
- `apps/api/src/modules/notifications/notifications.service.ts` — `notifyBalanceFailed` (client seul).
- `apps/api/src/modules/notifications/events/event-channels.ts` — événement `balance.failed`.
- `apps/api/src/common/email/templates/balance-failed-client.template.ts` — gabarit FR/EN, vouvoiement.
- `apps/api/src/common/email/templates/index.ts` — enregistrement du gabarit.
- `apps/api/src/database/probes/deposits-awaiting-confirmation.probe.ts` — cas de solde ajoutés à la sonde SQL.

### Tests API
- `apps/api/src/modules/service-requests/balance-confirmation.spec.ts` — 202, cron (un courriel pour deux passages), endpoint (404/403/409/422/502), mapping `paymentType`.
- `apps/api/src/modules/service-requests/balance-paid-ordering.spec.ts` — point 4, deux ordres.
- `apps/api/src/common/email/templates/balance-failed-client.template.spec.ts` — rendu du gabarit.
- `apps/api/src/common/email/templates/probe.template.spec.ts` — fixture du nouveau gabarit (le registre est exhaustif).

### Web
- `apps/web/src/lib/payment-methods/deposit-confirmation.ts` — aiguillage d'endpoint, libellés, titre de section, bandeau du 202 (module pur).
- `apps/web/src/lib/payment-methods/deposit-confirmation.test.mjs` — tests de ces fonctions.
- `apps/web/src/app/(app)/account/payment-methods/page.tsx` — soldes listés, bandeau `?solde=a-confirmer`, textes généralisés.
- `apps/web/src/app/(app)/account/payment-methods/_components/confirm-deposit-action.tsx` — prop `paymentType`, endpoint choisi.
- `apps/web/src/app/(app)/account/payment-methods/_components/add-card-section.tsx` — textes « paiement en attente », prop renommée.
- `apps/web/src/app/api/service-requests/[id]/balance-confirmation/route.ts` — relais BFF jumeau.
- `apps/web/src/app/api/service-requests/[id]/confirm-completion/route.ts` — commentaire (le 202 est porteur).
- `apps/web/src/app/(app)/requests/_components/completion-actions.tsx` — un 202 navigue vers la page de paiement.
- `apps/web/src/app/(app)/requests/_components/request-card.tsx` — prop `paymentAwaiting`.
- `apps/web/src/app/(app)/requests/page.tsx` — deux ensembles (badge : acompte ou solde ; bandeau 202 du devis : acompte seul).

### Documentation
- `CLAUDE.md` — autorisation du 12 octobre ; §6 (dette réglée, trois nouvelles) ; §11 (entrée du chantier, note d'état).
- `docs/reports/3ds-solde-recon.md`, `docs/reports/3ds-solde-rapport.md`.

**Migration : aucune.** `payment_type` porte déjà `BALANCE`, et les statuts `FAILED` / `REQUIRES_ACTION` existent. Tête inchangée à `1780540000000`.

## 3. Résultats des tests

| Vérification | Résultat |
|---|---|
| Typecheck API (`tsc -p tsconfig.build.json`) | ✅ vert |
| Build API (`nest build`) | ✅ vert |
| Tests existants les plus exposés (`deposit-confirmation`, `deposit-retry`, `retry-deposit`, `accept-request`, `probe.template`) | ✅ **114/114**. La refonte du corps de confirmation de l'acompte ne casse aucun des 45 tests de l'acompte |
| `balance-paid-ordering.spec.ts` (point 4) | ✅ **2/2** |
| `balance-failed-client.template.spec.ts` | ✅ **8/8** |
| `balance-confirmation.spec.ts` | ⚠️ **47/48** : le premier test du cron a dépassé le délai de 5 s de jest pendant la pénurie de mémoire (aucune assertion fausse). À rejouer sur un poste sain |
| Tests web purs (`deposit-confirmation.test.mjs`) | ✅ **17/17** (11 avant, +6 : aiguillage d'endpoint, libellés, titre, redirection, bandeau) |
| Suite jest complète de l'API, sonde SQL, contrat OpenAPI, typecheck/lint/build web, e2e API, vérification Stripe | ❌ **non joués**, voir §4 |

Nouveaux tests API : **58** (48 + 2 + 8).

## 4. Ce qui n'a pas pu être vérifié cette nuit

Cause : mémoire du poste épuisée et Docker figé. Détails, mesures et ordre de reprise dans **`docs/reports/3ds-solde-arret.md`**.

- **Contrat OpenAPI non régénéré** : le générateur démarre l'application, qui a besoin de Postgres. Tant qu'il ne l'est pas, le typecheck web échoue sur le nouveau relais BFF et sur `paymentType`. C'est attendu.
- **Typecheck, lint et build web** : non joués (dépendent du contrat).
- **Suite jest complète de l'API** : non jouée (plusieurs heures dans l'état du poste).
- **Sonde SQL** de la lecture (cas de solde ajoutés) : non jouée (pas de base).
- **e2e API** et **vérification Stripe** (`4000 0027 6000 3184` hors session, `stripe listen`) : non jouées. Elles font partie du smoke ci-dessous, étapes A1 à A9 (vérification API) puis A10 à A12 (défi dans le navigateur).

## 5. Dettes notées

1. **Solde `FAILED` sans PaymentIntent** : toujours aucune sortie, et `confirm-completion` y répond encore 200 (court-circuit). Le lot a corrigé ce faux succès pour les soldes en attente du client, pas pour celui-ci. Correctif : la relance du solde (hors périmètre).
2. **`released++` horaire du cron** sur toute demande dont la ligne `BALANCE` existe déjà (préexistant) : journal « 1 balance capture(s) triggered » toutes les heures sans rien prélever.
3. **Course résiduelle du courriel du cron** : si le client confirme la fin des travaux entre les deux lectures du cron, il reçoit un courriel en trop (jamais un courriel manquant).
4. Le nom `CLIENT_CONFIRMABLE_DEPOSIT_STATUSES` couvre désormais aussi le solde (renommage non fait, volontairement).
5. Le repli 502 du nouveau relais BFF reste **tutoyant** (hérité).

## 6. Smoke humain prêt à exécuter

### Prérequis

1. Poste redémarré, `docker compose up -d` (Postgres, Redis, Mailpit), contrat régénéré et vérifications de `3ds-solde-arret.md` §4 vertes.
2. API de la branche sur `:5000` : `pnpm --filter @linkr/api build`, puis `node dist/main` depuis `apps/api`.
3. Web de la branche sur `:3001` : `pnpm --filter @linkr/web build`, puis `pnpm --filter @linkr/web start`.
4. `stripe listen` dans un terminal à part, **avec la clé** (sinon le CLI change de compte en silence, §11) :
   ```powershell
   $env:STRIPE_API_KEY = (Select-String -Path apps\api\.env -Pattern "^STRIPE_SECRET_KEY=").Line.Split("=",2)[1].Trim()
   .\stripe.exe listen --api-key $env:STRIPE_API_KEY --forward-to localhost:5000/webhooks/stripe
   ```
   Le `whsec_` affiché doit être celui de `STRIPE_WEBHOOK_SECRET` dans `apps/api/.env`. Sinon, corriger le `.env` et **redémarrer l'API** (le secret est lu au démarrage).
5. Mailpit ouvert sur `http://localhost:8025`.
6. Horodatage pour le compte jetable : `smoke-3ds-solde-<AAAAMMJJ-HHMM>@linkr.test`, par exemple `smoke-3ds-solde-20261012-0930@linkr.test`.

Prestataire : **Dana**, le compte de test dont le compte Connect est réel (`acct_1UJay6FW9bHP5233`, `charges_enabled`). Métier Coiffure, service « Coupe homme » à **40 $**. Acompte = 8,00 $, solde = **32,00 $** (frais 3,20 $, net 28,80 $).

### Cas A — le client confirme la fin des travaux (202)

| # | Écran / geste | Attendu |
|---|---|---|
| A1 | `/signup` : prénom, nom, courriel jetable, mot de passe, case des conditions cochée → « Créer mon compte » | connecté, arrivée sur `/` |
| A2 | `/account/payment-methods` → « Ajouter une carte » → `4242 4242 4242 4242` | « Carte enregistrée », « Par défaut ». **L'acompte doit passer hors session : pas la carte 3184 à ce stade** |
| A3 | `/recherche` → Coiffure → une adresse dans le rayon de Dana → profil de Dana → « Demander » sur « Coupe homme » → fenêtre souhaitée (début ≥ +2 h, fin ≤ début + 24 h) → envoyer | confirmation à l'écran ; en base `service_requests.status = OPEN` |
| A4 | Fenêtre privée, compte de Dana → Espace pro → « En attente » → « Accepter » | 200 ; en base `ASSIGNED`, `payments` `DEPOSIT` **`SUCCEEDED` 8.00 CAD** |
| A5 | Dana → « Mes jobs » → « Démarrer », puis « Compléter » | en base `COMPLETED`, `completed_at_utc` posé ; Mailpit : « travaux terminés » au client |
| A6 | Client → `/account/payment-methods` → « Ajouter une carte » → `4000 0027 6000 3184` → défi 3D Secure à l'enregistrement → « Complete » | la nouvelle carte est « Par défaut » |
| A7 | Client → `/requests` → carte de la demande → « Confirmer la fin des travaux » → « Confirmer et verser » | **navigation vers `/account/payment-methods?solde=a-confirmer`** ; bandeau ambre « La fin des travaux est confirmée. Le paiement du solde demande toutefois votre confirmation… » ; section **« Solde à confirmer »**, ligne **« Solde de 32,00 $ »** ; **jamais « Versement effectué »** |
| A8 | Base | `payments` `BALANCE` : `status = FAILED`, `stripe_payment_intent_id = pi_…`, `gross_amount = 32.00`, `failure_reason` mentionnant l'authentification ; demande toujours `COMPLETED`. **Mailpit : aucun courriel `balance-failed-client`** (le client est devant l'écran) |
| A9 | `/requests` | badge « Paiement à confirmer » et lien « Confirmer le paiement → » sur la carte. Un **second** « Confirmer la fin des travaux » ramène sur la même page (202), sans second prélèvement : **un seul** PaymentIntent de solde chez Stripe |
| A10 | `/account/payment-methods` → « Confirmer le paiement » → défi 3D Secure → **« Fail »** | message « Le paiement n'a pas été confirmé… » ; la section reste ; `BALANCE` reste `FAILED` ; aucun courriel |
| A11 | « Confirmer le paiement » → défi → **« Complete »** | « Paiement confirmé. Merci ! » ; la section disparaît ; réseau : `POST …/balance-confirmation` **200**, puis le même POST **409** (synchronisation) |
| A12 | Base et `stripe listen` | `BALANCE` **`SUCCEEDED`**, `captured_at_utc` posé ; `payment_intent.succeeded` → `[200]` ; demande **`PAID`**, `paid_at_utc` posé, **quelques secondes après** (le webhook seul fait la transition) ; `/requests` : la carte passe à « Payée » après rafraîchissement |

### Cas B — le cron 72 h (le client ne fait rien)

| # | Geste | Attendu |
|---|---|---|
| B1 | Refaire A3 à A6 avec une **nouvelle** demande, **sans** cliquer « Confirmer la fin des travaux » | demande `COMPLETED`, carte 3184 par défaut, aucune ligne `BALANCE` |
| B2 | Reculer l'horloge de la demande (base de dev) : `UPDATE service_requests SET completed_at_utc = now() - interval '73 hours' WHERE title = '<titre B1>';` | 1 ligne |
| B3 | Avant de déclencher le cron, lister les demandes qu'il va traiter : `SELECT id, title FROM service_requests WHERE status = 'COMPLETED' AND contested_at_utc IS NULL AND deleted_at_utc IS NULL AND completed_at_utc < now() - interval '72 hours';` | ⚠️ le cron traite **toutes** les demandes listées (d'autres soldes de test pourraient être prélevés en mode test). C'est son comportement normal de chaque heure |
| B4 | Déclencher : **attendre HH:00** avec l'API lancée (cron `0 * * * *`), **ou** (commande **non exécutée cette nuit**, faute de base), depuis `apps/api`, après `pnpm --filter @linkr/api build` : `node -e "require('reflect-metadata');const {NestFactory}=require('@nestjs/core');const {AppModule}=require('./dist/app.module');const {ServiceRequestsService}=require('./dist/modules/service-requests/service-requests.service');(async()=>{const app=await NestFactory.createApplicationContext(AppModule);const s=app.get(ServiceRequestsService);console.log(await s.runAutoReleaseCheck());await new Promise(r=>setTimeout(r,5000));await app.close();})()"` | journal : `Auto-release failed for request …` puis `the balance of request … awaits the client's confirmation … — telling the client` ; sortie `{ released: 0, failed: 1 }` (s'il n'y a qu'elle) |
| B5 | Base et Mailpit | `BALANCE` `FAILED` avec `pi_…` ; **un** courriel « Linkr — le paiement du solde attend votre confirmation » au client, avec un bouton « Voir mes moyens de paiement » vers `http://localhost:3001/account/payment-methods` ; **rien pour Dana** |
| B6 | Déclencher **une seconde fois** (B4) | **aucun nouveau courriel** ; aucun nouveau PaymentIntent ; journal : `Balance already recorded … skipping` (puis le décompte `released` habituel, dette §5.2) |
| B7 | Client : suivre le lien du courriel → « Confirmer le paiement » → défi → « Complete » | comme A11 et A12 : `SUCCEEDED`, puis `PAID` via le webhook |

### Cas C — contrôles d'accès (`curl` ou client HTTP, jetons de chaque compte)

| # | Appel | Attendu |
|---|---|---|
| C1 | `POST /service-requests/<id>/balance-confirmation` avec le jeton de **Dana** | **403** |
| C2 | id inconnu | **404** |
| C3 | demande `PAID` (après A12) | **409** |
| C4 | une demande dans l'état de A8 (solde en attente), puis « Signaler un problème » sur `/requests`, puis l'appel | **409** ; la section du solde **disparaît** de `/account/payment-methods` (un solde contesté est gelé) |
