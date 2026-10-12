# Arrêt — solde 3D Secure (branche `feat/3ds-solde`, 12 octobre 2026, 06 h)

> Arrêt propre au sens du mandat §7 : branche poussée, **aucune PR ouverte**.
> Le code est écrit ; ce qui manque, ce sont les **vérifications** que le mandat exige avant la PR (§5).

## 1. Cause

**Le poste n'a plus de mémoire, et Docker ne sert plus la base.** Mesures à 04 h 25 puis à 06 h :

| Processus | Mémoire privée |
|---|---|
| `dwm.exe` (gestionnaire de fenêtres de Windows) | **7,6 Go** |
| `vmmem` (VM de Docker) | 4,1 Go |
| `vmmemWSL` | 1,9 Go |
| Mémoire physique libre | **10 à 200 Mo** sur 15,6 Go |

Effets mesurés :
- l'API Docker a répondu `500 Internal Server Error` (`/containers/linkr-postgres/json`), puis plus rien ;
- Postgres : le port 5432 accepte la connexion TCP, mais **aucune requête n'aboutit** (handshake jamais terminé). Une connexion a été retentée chaque minute **de 04 h 27 à 05 h 58** : toutes ont échoué ;
- jest : 41 minutes pour trois petites suites, puis 30 minutes pour une seule, avec **un dépassement du délai de 5 s** sur un test (voir §3).

Je n'ai **arrêté aucun processus** (ni `dwm`, ni Docker) : ce sont des processus du système et de l'utilisateur, hors du périmètre. **Un redémarrage du poste (ou au moins de Docker Desktop) est nécessaire avant de reprendre.**

## 2. Pourquoi c'est un arrêt et pas une PR

Le mandat §5 exige « tous verts avant la PR ». Sans base, il est impossible de :
1. **régénérer le contrat** (`openapi.json`, `schema.d.ts`). Le générateur démarre l'application, qui se connecte à Postgres et à Redis, et la règle du dépôt interdit d'écrire ces fichiers à la main. Conséquence : **le typecheck et le build web échouent** sur le nouveau relais (`/service-requests/{id}/balance-confirmation` absent du schéma) et sur la lecture de `paymentType`. C'est attendu, et la régénération le corrige ;
2. lancer le **build web**, le **lint** et le **typecheck** complets ;
3. jouer la **sonde SQL** de la lecture (`deposits-awaiting-confirmation.probe.ts`, cas de solde ajoutés) ;
4. jouer l'**e2e API** et la **vérification Stripe** (`4000 0027 6000 3184` hors session, `stripe listen`).

Une PR dans cet état serait « douteuse » au sens du §7. Le code, lui, n'a révélé aucun problème de fond : les deux voies du point 4 ont été examinées, la voie (b) est propre et prouvée par test, et rien n'a exigé de toucher `chargeAndPersist`, l'arithmétique, les remboursements ou le verrou.

## 3. Ce qui est fait et vérifié

Détails : `docs/reports/3ds-solde-rapport.md` (rapport final prêt, à compléter des chiffres manquants).

| Vérification | Résultat |
|---|---|
| Typecheck API (`tsc -p tsconfig.build.json`) | ✅ vert |
| Build API (`nest build`) | ✅ vert |
| Tests existants les plus exposés (confirmation d'acompte, relance, acceptation, gabarits) | ✅ **114/114** |
| `balance-paid-ordering.spec.ts` (point 4, deux ordres) + spec du gabarit | ✅ **10/10** |
| `balance-confirmation.spec.ts` | ⚠️ **47/48**. Le 48ᵉ (« two passes over a 3-D Secure balance → ONE email ») a dépassé **le délai de 5 s de jest**, sans assertion fausse. Les cinq autres tests du cron, plus lourds ou équivalents, passent. À relancer sur un poste sain **sans relever le délai** ; s'il rate encore, c'est une vraie piste |
| Tests web purs (`deposit-confirmation.test.mjs`) | ✅ **17/17** (+6) |
| Suite jest complète de l'API | ❌ non jouée (aurait pris plusieurs heures dans cet état) |

## 4. Pour reprendre, dans l'ordre

1. Redémarrer le poste (ou Docker Desktop), puis `docker compose up -d` et vérifier `docker ps`.
2. API : `pnpm --filter @linkr/api build` puis régénérer le contrat **en démarrant l'app** : `pnpm --filter @linkr/api openapi:generate`, puis `pnpm --filter @linkr/api-client codegen`. Le diff attendu est **additif** : la route `balance-confirmation`, le schéma `BalanceConfirmationResponseDto`, le champ `paymentType`, la réponse 202 de `confirm-completion`, et les descriptions modifiées.
3. Web : `pnpm --filter @linkr/web typecheck`, `lint`, `test`, `build`. Si `next build` échoue sur `.next/dev/types/validator.ts`, supprimer `apps\web\.next` avec `next dev` arrêté.
4. API : `pnpm --filter @linkr/api exec jest --maxWorkers=2` (suite complète ; la ligne de base de `main` était 478).
5. Sonde : base jetable `linkr_pendingdeposits_probe` (migrations jouées), puis la commande en tête de `deposits-awaiting-confirmation.probe.ts`.
6. `pnpm check:mirrored-constants` (aucune constante miroir ajoutée, contrôle de non-régression) et `pnpm --filter @linkr/api migration:check`. **Aucune migration** n'a été ajoutée, donc pas de `run`/`revert`/`run` à jouer.
7. Vérification Stripe et smoke : `docs/reports/3ds-solde-rapport.md` §6.
8. Si tout est vert : `gh pr create` avec le titre du mandat, `feat(payments): solde 3D Secure — confirmation hors session`.

## 5. Options si une vérification échoue

- **Le 48ᵉ test rate encore sur un poste sain** : il ne fait que deux passages de `runAutoReleaseCheck` et deux `setImmediate`. Un échec répété voudrait dire qu'une promesse du cron ne se résout pas (par exemple `announceBalanceFailure`) : lire le journal du test avant toute autre chose.
- **La sonde SQL contredit la lecture** (ordre, garde « contestée ») : le prédicat SQL est dans `ServiceRequestRepository.findDepositsAwaitingClientConfirmation`. La branche `BALANCE` ne touche pas la branche `DEPOSIT`, et le cas `DEP_CONTESTED` épingle cette séparation.
- **La carte `3184` hors session ne laisse pas d'intent** dans l'erreur (contrairement à la mesure H1 du chantier acompte) : la ligne serait `FAILED` sans intent, `confirm-completion` répondrait 502 et rien ne serait listé. Il faudrait alors relire ce que Stripe renvoie avant toute modification, et ne **jamais** toucher `chargeAndPersist` sans nouvelle autorisation.
