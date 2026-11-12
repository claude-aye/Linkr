# Purge des comptes e2e (mode A)

Supprime de la production les données créées par les tests de fumée (`e2e/`), et rien d'autre. Lancée **à la main** sur le VPS, par l'exploitant, jamais par une tâche planifiée ni par un agent. Code : `apps/api/src/database/purge/`, service `purge` de `deploy/compose.yaml`, enveloppe `deploy/purge.sh`.

## Ce qui est supprimé

| Comptes | Repérés par | Mode |
|---|---|---|
| `e2e-prestataire@linkrapp.com`, `e2e-client@linkrapp.com` | égalité **exacte** de l'adresse brute **et** prénom `e2e` | **transactions seulement** : le compte reste |
| anciens `e2e+prestataire-aaaammjj-xxxxxxxx@gmail.com`, `e2e+client-…` | expression régulière ancrée, **sensible à la casse**, `^e2e\+(prestataire\|client)-[0-9]{8}-[0-9a-f]{8}@gmail\.com$`, **et** prénom `e2e` | **suppression complète** |

La liste est écrite dans le code (`purge-rules.ts`). L'adresse est comparée **brute** : jamais de `lower()`, de `toLowerCase()` ni de `trim()`, jamais de `LIKE`. L'inscription ne normalise pas l'adresse et l'index unique porte sur l'adresse brute, donc `E2E-Client@LinkrApp.com` est un **autre** compte, que n'importe qui peut créer : il n'est pas visé. Même chose pour une adresse écrite avec le signe Kelvin (U+212A, que `lower()` transformerait en « k »), une variante en majuscules d'une ancienne adresse Gmail, `xe2e+…`, `e2e+x@gmail.com`, `…@gmail.com.autre`, ou un compte (fixe compris) dont le prénom n'est pas `e2e`. Si une adresse fixe correspond à **plus d'une ligne** (supprimée en douceur comprise), la purge refuse net.

- **Comptes fixes** : leurs demandes et tout ce qui en dépend (affectations, pièces jointes, devis, avis, notifications, paiements, remboursements), et leurs cartes (`payment_methods`). Restent : l'utilisateur, sa connexion, le prestataire, ses métiers, ses services, ses zones, son portfolio et son compte Stripe Connect.
- **Anciens comptes** : tout, y compris l'utilisateur, ses connexions, ses jetons de réinitialisation, son prestataire, ses métiers, services, zones, documents, photos et son compte Connect.
- **Jamais** : un ADMIN (refus net s'il est dans la liste), une table du catalogue, une donnée d'un autre compte. Les demandes sont choisies par **propriétaire** ; le titre `e2e-paiement-…` n'est qu'un signalement.

**Contrôle de fermeture.** Si une ligne d'un compte hors liste pointe vers une entité e2e (un vrai testeur a réservé le prestataire e2e, un devis e2e sur un vrai appel d'offres, une notification d'un tiers sur une demande e2e, une adhésion à une organisation…), la purge **s'arrête** et liste ces lignes. Elle ne modifie jamais une donnée tierce : c'est à l'exploitant de décider (voir « Purge bloquée »). Même chose si `service_items.suggested_by_user_id` ou `approved_by_user_id` pointe vers un compte visé (D6) : le catalogue n'est jamais modifié.

## Garde-fous

- **Simulation par défaut.** Sans `--execute`, le script lit dans une transaction `READ ONLY` annulée : rien ne peut s'écrire, ni en base ni sur le disque.
- **Rôle dédié `linkr_purge`** : `SELECT` et `DELETE` sur la liste fermée des tables, sauf `user_auth_providers`, `email_verification_tokens` et `password_reset_tokens`, où il ne lit que `id` et `user_id` (jamais `password_hash`, `token_hash` ni l'adresse d'un jeton de confirmation) ; `SELECT` seul sur les cinq tables protégées ; rien d'autre. Au démarrage, le script refuse un super-utilisateur, un rôle qui peut écrire dans une table protégée, un rôle qui peut lire `password_hash` ou `token_hash`, ou un rôle sans `DELETE` sur la liste.
- **Liste fermée** des tables modifiables ; au démarrage, son intersection avec `service_categories`, `service_items`, `regulatory_requirements`, `typeorm_migrations`, `spatial_ref_sys` doit être vide.
- **Une seule transaction** : `lock_timeout = '5s'`, verrou des 21 tables de la liste (`LOCK TABLE … IN SHARE ROW EXCLUSIVE MODE`), plan recalculé, phrase comparée, `DELETE … WHERE id = ANY($1)` table par table avec le nombre de lignes attendu, vérification qu'aucune ligne ne pointe encore vers un identifiant supprimé, vérification des comptes fixes, empreinte du catalogue (nombre de lignes et md5 des cinq tables) identique avant et après. Au moindre écart : `ROLLBACK`, rien n'a changé. Jamais de `TRUNCATE`, jamais d'ordre de schéma.
- **Phrase tapée** : `PURGER E2E <n> COMPTES <empreinte>`, où `<n>` est le nombre de comptes **supprimés en entier** ; les comptes fixes gardés sont affichés à part (« Comptes fixes gardés : 2 »). L'empreinte couvre tous les comptes visés et chaque ligne visée : si la base change entre la simulation et l'exécution, la phrase ne correspond plus et rien n'est supprimé.
- **Sauvegarde d'abord, et témoin** : `--execute` lance `backup/backup.sh` ; s'il échoue, arrêt. `purge.sh` écrit ensuite `purge-out/backup-witness.txt` (horodatage UTC et nom de la sauvegarde de base). Le conteneur refuse `--execute` sans témoin, avec un témoin illisible, daté du futur ou de plus de 15 minutes.
- **Aucun accès Internet, aucune clé Stripe** : le service est sur le réseau `backend` (`internal`) et ne reçoit que `PURGE_DATABASE_URL`, `PURGE_STORAGE_DIR`, `PURGE_OUT_DIR` et `PURGE_CONFIRM`.
- **Même verrou que `deploy.sh`** (`/opt/linkr/.deploy.lock`) : jamais une purge pendant un déploiement.

> ⚠️ **Le témoin et la phrase protègent contre l'ERREUR D'USAGE, pas contre la malveillance.** Ils empêchent d'oublier la sauvegarde ou de purger un plan qui a changé, par exemple en lançant le conteneur à la main au lieu de `purge.sh`. Quiconque a un shell sur le VPS peut écrire un témoin et lire la phrase dans la simulation : ce n'est pas une barrière contre un agent ou une personne qui dispose de ce shell. **La barrière reste la règle « aucun agent n'écrit en production »** (CLAUDE.md, §13 nº 20).

⚠️ **Pourquoi `LOCK TABLE` et pas `SELECT … FOR UPDATE`.** PostgreSQL exige le droit `UPDATE` pour `FOR UPDATE`, que `linkr_purge` n'a pas (mesuré : « permission denied for table users »). `SHARE ROW EXCLUSIVE` se prend avec le seul droit `DELETE`. Pendant la transaction (une à deux secondes), les écritures de l'application sur ces 21 tables **attendent** ; les lectures ne sont pas bloquées. Si un verrou ne vient pas en 5 s, tout est annulé : relancer plus tard.

## Mise en place sur le VPS (une fois)

0. **Image** : la purge vit dans l'image API. `IMAGE_TAG` (dans `/opt/linkr/.env`) doit désigner une image construite **après** le merge de la PR qui l'apporte ; avec une image plus ancienne, `dist/database/purge/purge.js` n'existe pas et le conteneur échoue au démarrage. Déployer d'abord (`deploy.sh <SHA>`), purger ensuite.
1. Générer un mot de passe hexadécimal : `openssl rand -hex 32`.
2. Créer le rôle, sans laisser le mot de passe dans un historique :

   ```bash
   cd /opt/linkr
   docker compose exec -e PSQL_HISTORY=/dev/null postgres psql -U linkr -d linkr
   ```

   puis coller ces lignes, en remplaçant `<mot de passe généré>` par la valeur de l'étape 1 :

```sql
CREATE ROLE linkr_purge LOGIN PASSWORD '<mot de passe généré>';
GRANT SELECT, DELETE ON TABLE refunds, payments, reviews, notifications, quotes, service_request_attachments, service_request_assignments, service_requests, payment_methods, portfolio_items, verification_documents, professional_services, professional_service_categories, professional_service_zones, stripe_connect_accounts, service_providers, organization_memberships, users TO linkr_purge;
GRANT DELETE ON TABLE user_auth_providers, email_verification_tokens, password_reset_tokens TO linkr_purge;
GRANT SELECT (id, user_id) ON TABLE user_auth_providers TO linkr_purge;
GRANT SELECT (id, user_id) ON TABLE email_verification_tokens TO linkr_purge;
GRANT SELECT (id, user_id) ON TABLE password_reset_tokens TO linkr_purge;
GRANT SELECT ON TABLE service_categories, service_items, regulatory_requirements, typeorm_migrations, spatial_ref_sys TO linkr_purge;
```

   **Rôle déjà créé avant le mandat L1** (table `email_verification_tokens`) : ajouter seulement, avec le même `psql` :

```sql
GRANT DELETE ON TABLE email_verification_tokens TO linkr_purge;
GRANT SELECT (id, user_id) ON TABLE email_verification_tokens TO linkr_purge;
```

   Sans ces deux lignes, la purge refuse de démarrer (droit `DELETE` manquant). Le premier bloc est la sortie de `docker compose --profile tools run --rm -T purge --print-role-sql` (aucune connexion à la base) ; un test vérifie que cette page le recopie exactement. **Aucune migration** ne crée ce rôle. Le `DELETE` sur `organization_memberships` ne sert qu'au verrou : le script n'y supprime jamais rien.
3. Ajouter à `/opt/linkr/.env` (déjà `chmod 600`) : `PURGE_DATABASE_URL=postgresql://linkr_purge:<mot de passe>@postgres:5432/linkr`.
4. Copier `deploy/purge.sh` en `/opt/linkr/purge.sh` (`chmod 755`) et `deploy/compose.yaml` en `/opt/linkr/compose.yaml` (le service `purge` doit y être).
5. Le dossier des listes, `/opt/linkr/purge-out`, est créé par `purge.sh` en `chmod 700`. Il doit appartenir à l'uid 1000 (utilisateur `node` de l'image) : `sudo chown 1000:1000 /opt/linkr/purge-out` si `purge.sh` le demande. Lancer `purge.sh` avec l'utilisateur propriétaire du dossier (`ubuntu`, à vérifier avec `id -u`). Le dossier est hors du dépôt et hors du volume `uploads`.

Une table ajoutée plus tard n'est **pas** couverte par ces droits : c'est voulu (voir « Après une migration »).

## Utilisation

```bash
cd /opt/linkr
./purge.sh
```

Simulation : comptes visés (identifiant, mode, libellé sans adresse), comptes supprimés en entier et comptes fixes gardés, lignes par table dans l'ordre de suppression, fichiers du volume à supprimer, listes de fichiers restants d'un passage précédent, nombre d'identifiants Stripe, signalements, puis l'empreinte et la ligne `PURGE_PHRASE=…`. Rien en base : pas de phrase.

```bash
./purge.sh --execute
```

Verrou, sauvegarde, témoin, plan affiché, puis la phrase **tapée à la main** (jamais copiée d'un fichier). Le script recalcule le plan sous verrou et refuse si l'empreinte a changé.

**Plan vide** (rien à purger en base) : aucune phrase n'est demandée, aucune transaction n'écrit. `--execute` reprend seulement les fichiers listés dans `purge-out/*-files-remaining.txt` par un passage précédent, et ne supprime que ceux **qui n'ont plus aucune ligne en base** ; une clé encore référencée reste dans la liste.

### Codes de sortie (relayés par `purge.sh`)

| Code | Sens |
|---|---|
| 0 | terminé |
| 1 | erreur, aucune transaction validée |
| 2 | refus : configuration, témoin de sauvegarde, phrase, rôle, ADMIN, adresse fixe en double ; **et** purge bloquée détectée **sous verrou** pendant l'exécution (rien supprimé) |
| 3 | purge bloquée détectée par la **simulation** : contrôle de fermeture ou catalogue (rien supprimé) |
| 4 | **BASE PURGÉE, ÉTAPE FICHIERS INCOMPLÈTE** : lire le rapport avant toute relance |
| 5 | **état du COMMIT incertain** : vérifier la base, conserver la liste Stripe `.pending` |
| autre (130, 137, 143, 255…) | **état inconnu** : conteneur tué ou interrompu, peut-être après le COMMIT. Lire le rapport (une ligne `TRANSACTION VALIDÉE` dit que la base est purgée) et relancer la **simulation** avant toute autre action |

En `--execute`, `purge.sh` lance d'abord la simulation : si elle répond 1, 2 ou 3, il s'arrête avec **ce même code**, sans rien modifier. Une purge bloquée apparaît donc normalement en **3** à cette étape. Elle ne sort en **2** que si une ligne tierce apparaît entre la simulation et l'exécution : le plan est recalculé sous verrou, et un plan bloqué y est un refus (`contrôle de fermeture ou catalogue : purge bloquée`). Le témoin de sauvegarde est effacé à la sortie de `purge.sh`, succès ou échec.

### Lire le rapport

- `TRANSACTION VALIDÉE. Lignes supprimées :` est affiché **juste après le COMMIT**, avant toute opération sur les fichiers, avec le nombre de lignes par table, `Comptes fixes après purge : comptes=2 prestataires=1 connect=1` (identique à avant, sinon la transaction aurait été annulée), `Catalogue : empreintes identiques avant et après.` et le chemin de la liste Stripe (`/purge-out/<horodatage>-stripe-ids.txt`, sur l'hôte `/opt/linkr/purge-out/…`, `chmod 600`) suivi de l'avertissement ci-dessous.
- `Fichiers : N supprimé(s), … NON supprimé(s), … clé(s) refusée(s)` : les fichiers sont supprimés **après** le COMMIT, seulement ceux des lignes supprimées. Avant le premier fichier, la liste complète est écrite dans `purge-out/<horodatage>-files-remaining.txt` ; après, elle est réécrite avec ce qui reste, ou effacée si tout est parti. Un processus tué pendant la suppression laisse donc la liste complète, reprise par un passage suivant (voir « Plan vide »). Une clé refusée (forme inattendue, ou qui sortirait du volume) est listée dans `purge-out/<horodatage>-files-refused.txt` et n'est **jamais** reprise automatiquement : l'examiner à la main.
- `BASE PURGÉE, ÉTAPE FICHIERS INCOMPLÈTE : …` (code 4) : la base est purgée, mais une liste n'a pas pu être écrite, la reprise a échoué ou la liste Stripe n'a pas pu être renommée (elle reste alors en `.pending`). Le rapport liste les fichiers dont la suppression n'est pas confirmée : les noter, puis corriger la cause (disque plein, droits de `purge-out`) avant de relancer.
- `état du COMMIT incertain : vérifier la base, conserver <chemin>` (code 5) : la connexion a lâché pendant le COMMIT. Relancer la **simulation** : si les comptes anciens et les demandes ont disparu, le COMMIT est passé et la liste Stripe `.pending` est à traiter comme une liste finale ; sinon, rien n'a changé et la liste `.pending` peut être détruite.
- `PURGE BLOQUÉE — …` (code 3) : chaque ligne tierce, table et identifiant. Rien n'a été supprimé.

## Purge bloquée

Une ligne tierce pointe vers une entité e2e : la purge s'arrête, et **c'est voulu**. Exemple : une notification `NEW_TENDER_MATCH` envoyée à un **vrai** prestataire sur un appel d'offres publié par un compte e2e (la diffusion d'un appel d'offres notifie tous les prestataires du secteur). Les tests e2e ne publient jamais d'appel d'offres pour cette raison.

Marche à suivre :

1. Lire la liste du rapport (table, identifiant, raison). Identifier, en lecture seule, à qui appartient chaque ligne et ce qu'elle désigne.
2. **Ne JAMAIS faire de `DELETE` à la main en super-utilisateur** pour « débloquer » la purge : c'est contourner tous les garde-fous (liste fermée, phrase, empreinte, sauvegarde, vérifications) sur une donnée qui n'est pas e2e.
3. La décision appartient à l'exploitant : laisser la donnée e2e en place tant que la ligne tierce existe, ou traiter la ligne tierce par le chemin normal de l'application, puis relancer la simulation. La règle d'arrêt n'est pas assouplie.

## Adresse fixe en double

Refus `l'adresse fixe « e2e-client » correspond à 2 lignes` (code 2). L'index unique sur l'adresse est **partiel** (`WHERE deleted_at_utc IS NULL`) : si un compte fixe a été supprimé en douceur (par `DELETE /users/me`) puis recréé avec la même adresse, deux lignes existent, et la purge refuse **toute** opération, anciens comptes Gmail compris.

1. Analyser, en lecture seule : `SELECT id, first_name, deleted_at_utc, created_at_utc FROM users WHERE email = 'e2e-client@linkrapp.com';` (adresse exacte, sans `lower()`). Identifier quelle ligne est le compte de test actuel et ce que l'autre porte encore (demandes, cartes, prestataire).
2. La décision appartient à l'exploitant. **Ne JAMAIS faire de `DELETE` à la main en super-utilisateur**, ni sur l'une ni sur l'autre ligne : même raison que pour une purge bloquée.
3. Prévention : **ne jamais appeler `DELETE /users/me` sur un compte e2e**, ni depuis un test, ni à la main. Les comptes fixes sont faits pour durer ; seules leurs transactions sont purgées.

## Fichier `.pending` orphelin

Un `purge-out/<horodatage>-stripe-ids.txt.pending` sans code 5 vient d'un conteneur tué entre l'écriture de la liste et le COMMIT (aucune ligne `TRANSACTION VALIDÉE` dans le rapport, code « autre »). Avant d'en faire quoi que ce soit :

1. Vérifier en base, en lecture seule, que les `pm_` listés y sont encore : `SELECT stripe_payment_method_id FROM payment_methods WHERE stripe_payment_method_id = ANY(ARRAY['pm_…', 'pm_…']);`
2. **S'ils y sont tous** : le COMMIT n'a pas eu lieu, rien n'a été supprimé. Le `.pending` peut être effacé à la main (`shred -u`). Ne **pas** traiter Stripe : ces cartes sont encore utilisées.
3. **S'ils n'y sont plus** : la purge a eu lieu. Conserver la liste et la traiter comme une liste finale (voir « Ce qui reste à la main »), puis relancer la simulation pour confirmer.

## Ce qui reste à la main

**Stripe.** La liste contient les `cus_`, `acct_` et `pm_` des seules entités supprimées (pour les comptes fixes, seulement les `pm_` des cartes supprimées : leur `cus_` et leur `acct_` restent). Supprimer le **client** (`cus_`), ce qui retire ses cartes ; détacher un `pm_` seulement si le client est conservé (comptes fixes).

> Bac à sable Stripe PARTAGÉ avec le développement : NE JAMAIS utiliser « Supprimer toutes les données de test ». Supprimer à la main uniquement ces identifiants.

Après traitement, détruire le fichier (`shred -u`).

**Gmail.** Les anciens comptes `e2e+…@gmail.com` écrivaient à la boîte d'un inconnu (la partie locale « e2e »). Ces courriels sont hors de notre portée ; rien à faire, sinon ne plus jamais utiliser ces adresses.

**Brevo.** Les journaux de courriels transactionnels gardent les adresses destinataires selon la rétention de Brevo. Vérifier dans la console Brevo s'il existe des contacts ou journaux à supprimer pour les adresses e2e.

**Sauvegardes.** La sauvegarde prise avant la purge, et les précédentes, contiennent encore les données supprimées. Elles disparaissent par la rotation de 14 jours (`rclone delete --min-age 14d`), qui ne tourne **que si la minuterie `linkr-backup.timer` tourne**. Une restauration dans cette fenêtre ramène les comptes purgés : relancer la purge après toute restauration.

## Après une migration

Toute nouvelle table avec une clé étrangère vers `users`, `service_providers`, `service_requests`, `payments` ou une autre table de la liste doit être ajoutée au plan (`purge-plan.ts`), aux arêtes vérifiées (`purge-execute.ts`), à la liste fermée et aux droits du rôle (`GRANT`). Sans cela : une clé `RESTRICT` fait échouer la purge (sûr), mais une clé `CASCADE` supprimerait des lignes en silence (les cascades s'exécutent avec les droits du propriétaire de la table, pas ceux de `linkr_purge`).

## Banc de `purge.sh`

`deploy/tests/purge-sh.test.sh` vérifie, avec un faux `docker` et une fausse sauvegarde, les codes relayés, les libellés de fin et l'effacement du témoin. À lancer dans un conteneur jetable, jamais sur le VPS :

```bash
docker run --rm -v "$PWD/deploy:/deploy:ro" debian:bookworm-slim bash /deploy/tests/purge-sh.test.sh
```

## Dettes connues (non corrigées)

- **Témoin périmé pendant la phrase** (M-f) : si l'opérateur met plus de 15 minutes à taper la phrase, le conteneur refuse `--execute` (code 2) alors qu'une sauvegarde complète vient d'être faite. Sans danger ; relancer `./purge.sh --execute` (nouvelle sauvegarde).

- **Notifications des comptes fixes sur de vraies demandes** : un `NEW_TENDER_MATCH` reçu par le prestataire e2e au sujet d'un vrai appel d'offres est supprimé (le destinataire est e2e). C'est une donnée du compte e2e, mais pas une « transaction » au sens strict de D3.
- **Sonde embarquée dans l'image** : `src/database/probes/purge.probe.ts` est compilée dans l'image de production (`tsconfig.build.json` n'exclut pas les sondes). Elle refuse toute base dont le nom ne contient pas « probe », mais son bloc `finally` tente `DROP OWNED`/`DROP ROLE linkr_purge` même quand elle n'a pas créé le rôle (sans effet en pratique : `DROP ROLE` échoue tant que le rôle a des droits ailleurs). L'exclure de l'image touche `tsconfig.build.json`, hors périmètre.
- **Pas de nouvelle vérification de référence avant `unlink`** : `deleteFiles` ne revérifie pas qu'aucune ligne restante ne référence la clé. Défense en profondeur seulement : les clés portent un UUID aléatoire.
- **Traces e2e non purgées** : lignes `demand_signals` (anonymes, elles faussent un peu la carte de recrutement), jobs courriel échoués dans Redis (adresse et variables, jusqu'à 24 h), journaux Docker, sauvegardes, Brevo.
- **Durcissements reportés** : conteneur sans `read_only: true` ; `purge.sh` fait `chmod` de `purge-out` avant de vérifier son propriétaire (message obscur si l'utilisateur n'en est pas propriétaire) ; aucun verrou commun avec la sauvegarde nocturne.
