# Rapport — compteur `released` du cron d'auto-libération

Mandat : `MANDAT_CRON_RELEASED.md` (voie (a), décision du 16 octobre 2026). Branche `fix/cron-released-count`, depuis `main` à `ebae71d`. Recon : `docs/reports/cron-released-recon.md`.

## Ce qui change

**`findAwaitingRelease`** (`service-request.repository.ts`) gagne une condition :

```sql
AND NOT EXISTS (
  SELECT 1 FROM payments p
   WHERE p.service_request_id = sr.id
     AND p.payment_type = 'BALANCE'
)
```

Ce prédicat est celui du court-circuit de `captureBalance` (`findByServiceRequestAndType`). Il ne filtre pas sur le statut : toute ligne `BALANCE` exclut la demande. Il n'y a pas de règle de suppression douce, parce que `payments` n'a pas de `deleted_at_utc`. La sous-requête utilise l'index `uq_payments_request_type (service_request_id, payment_type)`, donc aucune migration. La table externe reçoit l'alias `sr`, et la sous-requête qualifie ses colonnes : `SELECT_COLUMNS` n'est pas qualifié, et un `id` nu dans la sous-requête désignerait `payments.id`.

**La boucle de `runAutoReleaseCheck`** (`service-requests.service.ts`) a désormais une garde défensive : si `balanceExistedBefore` voit une ligne (née entre la sélection et le traitement), la boucle fait `continue`. Elle n'appelle pas `releaseBalance` et n'incrémente pas `released`. Le court-circuit de `captureBalance` reste en place, sans changement.

**Aucun fichier sous arrêt dur n'est modifié** : ni `payments`, ni `captureBalance`, ni `chargeAndPersist`, ni les webhooks, l'arithmétique, les remboursements ou le verrou. La garde du courriel est inchangée. **Zéro migration. Contrat `openapi.json` / `schema.d.ts` inchangé** (aucun DTO ni aucune route touchés).

## Effets observables

- Une demande `COMPLETED` dont la ligne `BALANCE` existe n'est plus sélectionnée. Le cron ne compte plus « 1 balance capture(s) triggered » toutes les heures pour elle.
- Le courriel `balance-failed-client` fonctionne comme avant : il part au passage où la ligne naît, puis plus jamais (voir la recon, §3).
- **Effet de bord voulu, signalé** : `captureBalance` contrôle l'acompte **avant** son court-circuit. Une demande dont le solde existe et dont l'acompte a été remboursé levait donc `DepositNotSettledException` à chaque passage (`failed++`, une ligne `ERROR` par heure). Elle n'est plus sélectionnée. Le compteur `failed` cesse lui aussi de compter un non-événement. On ne peut pas l'éviter sans toucher `captureBalance`.
- **Fenêtre résiduelle assumée** : si une ligne est créée entre la lecture de la boucle et celle de `captureBalance`, elle est encore comptée une fois. Pour la fermer, `captureBalance` devrait renvoyer un résultat, ce qui touche un fichier sous arrêt dur.
- Les trois demandes du 12 octobre (`289ba18c` « Coloration Fierté », `2ecf4209` « Zigelamelo », `473c2ff8` « Cheveux Teracotta ») sont `COMPLETED` avec un solde `SUCCEEDED`, mais le webhook ne les a jamais fait passer en `PAID`. Le correctif cesse de les compter. **Il ne les fait pas passer en `PAID`** : c'est le travail du webhook, qui n'est jamais arrivé pour elles. Une demande `PAID` n'était d'ailleurs jamais sélectionnée (`status = 'COMPLETED'`).

## Tests ajoutés (`balance-confirmation.spec.ts`)

Le mock de `findAwaitingRelease` du harnais **n'applique pas** le `NOT EXISTS` : il renvoie la demande quoi que contiennent les paiements. Chaque cas « ligne existante » simule donc la **course**, c'est-à-dire le cas le plus fort, que seule la garde de boucle protège.

1. Ligne `BALANCE` déjà `SUCCEEDED`, `FAILED`, `REQUIRES_ACTION` ou `PENDING` : deux passages donnent `{ released: 0, failed: 0 }` à chaque fois. `captureBalance` n'est **jamais** appelé, aucun PaymentIntent n'est créé et aucun courriel n'est envoyé (4 cas).
2. Demande éligible sans ligne `BALANCE` : `{ released: 1, failed: 0 }`, `captureBalance` est appelé une fois.
3. Refus 3D Secure : le premier passage échoue une fois et envoie un courriel. Le second passage donne `{ 0, 0 }` et n'envoie aucun courriel.
4. Solde existant sur un acompte `PARTIALLY_REFUNDED` : `{ 0, 0 }` (avant le correctif : `failed: 1` à chaque passage).

Les tests existants du cron passent **sans modification de leurs assertions**.

**Mutation** : sans la garde de boucle, **6 des 7 nouveaux tests échouent**. Seul le cas « éligible » passe, comme attendu.

## Preuves SQL (Postgres réel, Docker)

- **Base de dev, en lecture seule** (`BEGIN READ ONLY`, la requête livrée extraite du source et exécutée telle quelle) : l'ancien prédicat sélectionne **3** demandes (celles du 12 octobre), le nouveau **0**. La requête ne provoque aucune erreur d'ambiguïté de colonne.
- **Copie jetable** (`CREATE DATABASE linkr_cronreleased_probe TEMPLATE linkr`, supprimée ensuite) :
  - ligne `BALANCE` retirée sur `289ba18c` → la demande est sélectionnée (cas positif) ;
  - ligne `BALANCE` de `2ecf4209` passée en `FAILED`, puis en `REFUNDED` → toujours exclue (tous statuts) ;
  - une demande qui n'a plus que son `DEPOSIT` reste sélectionnée (le `NOT EXISTS` ne regarde que `BALANCE`) ;
  - **mutation** « `NOT EXISTS` sur tout paiement » → 0 au lieu de 1 : la sonde la détecte.
- Aucune sonde existante ne couvrait `findAwaitingRelease`, donc aucun cas n'est ajouté à une sonde (lettre du mandat). Les preuves SQL ci-dessus remplacent ce cas.

## Vérifications

- `@linkr/api` : **build vert**, **jest 543/543** (base `main` 536, +7). Le test ciblé `balance-confirmation.spec.ts` passe à 55/55.
- Sonde `deposits-awaiting-confirmation.probe.ts` : **35/35** sur une base jetable (`linkr_pendingdeposits_probe`, migrée, supprimée ensuite). C'est la non-régression de la lecture : un solde qui attend le client reste listé (la requête de cette lecture n'est pas modifiée).
- `@linkr/web` : typecheck vert, lint **0 erreur** (les 2 avertissements préexistants de `price-display.test.mjs`), `node --test` **196/196**. Aucun fichier web n'est modifié.
- Garde miroir (8 constantes) et garde migrations (21 migrations) : vertes. **Zéro migration.**
- CI : voir la PR.

## Smoke humain

Sur la base de dev, qui contient les trois demandes du 12 octobre.

1. **Avant** : lister les demandes que le cron sélectionnerait.
   ```sql
   SELECT left(sr.id::text,8), sr.title,
          (SELECT p.status FROM payments p WHERE p.service_request_id = sr.id AND p.payment_type='BALANCE') AS balance
   FROM service_requests sr
   WHERE sr.status='COMPLETED' AND sr.contested_at_utc IS NULL AND sr.deleted_at_utc IS NULL
     AND sr.completed_at_utc < now() - interval '72 hours';
   ```
   Attendu : `289ba18c`, `2ecf4209`, `473c2ff8`, toutes avec `balance = SUCCEEDED`. Ces lignes ont un solde : la nouvelle requête les exclut.
2. **Déclencher un passage du cron.** Depuis `apps/api`, après `pnpm --filter @linkr/api build`, l'API arrêtée (ou en laissant la vôtre tourner : ce contexte lance son propre worker) :
   ```bash
   node -e "require('reflect-metadata');const {NestFactory}=require('@nestjs/core');const {AppModule}=require('./dist/app.module');const {ServiceRequestsService}=require('./dist/modules/service-requests/service-requests.service');(async()=>{const app=await NestFactory.createApplicationContext(AppModule);const s=app.get(ServiceRequestsService);console.log(await s.runAutoReleaseCheck());await new Promise(r=>setTimeout(r,5000));await app.close();})()"
   ```
   Attendu : sortie `{ released: 0, failed: 0 }`, **aucune** ligne `Auto-release: … capture(s) triggered` et aucune ligne `Balance already recorded … skipping` dans le journal. Autre méthode : attendre `HH:00` avec l'API lancée.
3. **Second passage** : relancer la même commande. Attendu : de nouveau `{ released: 0, failed: 0 }`, et **aucun courriel** dans Mailpit (`http://localhost:8025` : le nombre de messages ne change pas).

### Rejoué par l'agent le 16 octobre 2026

API arrêtée, Docker relancé (Postgres, Redis, Mailpit), `dist` bâti depuis la branche, commande de l'étape 2 lancée **deux fois** sur la base de dev :

- passage 1 → `{"released":0,"failed":0}`, aucune ligne `Auto-release`, `Balance already recorded` ni `ERROR` ;
- passage 2 → `{"released":0,"failed":0}`, même journal vide ;
- Mailpit : 0 message avant, 0 après. Le conteneur venait de redémarrer, et Mailpit garde ses messages en mémoire : 0 avant le premier passage est donc normal.

Pour comparaison, sur la même base, l'ancien prédicat sélectionne les 3 demandes (requête de lecture seule ci-dessus) : c'est ce qui produisait « 3 balance capture(s) triggered » à chaque heure.
