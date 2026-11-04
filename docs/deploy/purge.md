# Purge des comptes e2e (mode A)

Supprime de la production les données créées par les tests de fumée (`e2e/`), et rien d'autre. Lancée **à la main** sur le VPS, par l'exploitant, jamais par une tâche planifiée ni par un agent. Code : `apps/api/src/database/purge/`, service `purge` de `deploy/compose.yaml`, enveloppe `deploy/purge.sh`.

## Ce qui est supprimé

| Comptes | Repérés par | Mode |
|---|---|---|
| `e2e-prestataire@linkrapp.com`, `e2e-client@linkrapp.com` | égalité exacte de l'adresse (casse ignorée) | **transactions seulement** : le compte reste |
| anciens `e2e+prestataire-aaaammjj-xxxxxxxx@gmail.com`, `e2e+client-…` | expression régulière ancrée `^e2e\+(prestataire\|client)-[0-9]{8}-[0-9a-f]{8}@gmail\.com$` **et** prénom `e2e` | **suppression complète** |

La liste est écrite dans le code (`purge-rules.ts`). Jamais de `LIKE`, jamais de motif partiel : `xe2e+…`, `e2e+x@gmail.com`, `…@gmail.com.autre` ou un prénom autre que `e2e` ne sont pas visés (testé).

- **Comptes fixes** : leurs demandes et tout ce qui en dépend (affectations, pièces jointes, devis, avis, notifications, paiements, remboursements), et leurs cartes (`payment_methods`). Restent : l'utilisateur, sa connexion, le prestataire, ses métiers, ses services, ses zones, son portfolio et son compte Stripe Connect.
- **Anciens comptes** : tout, y compris l'utilisateur, ses connexions, ses jetons de réinitialisation, son prestataire, ses métiers, services, zones, documents, photos et son compte Connect.
- **Jamais** : un ADMIN (refus net s'il est dans la liste), une table du catalogue, une donnée d'un autre compte. Les demandes sont choisies par **propriétaire** ; le titre `e2e-paiement-…` n'est qu'un signalement.

**Contrôle de fermeture.** Si une ligne d'un compte hors liste pointe vers une entité e2e (un vrai testeur a réservé le prestataire e2e, un devis e2e sur un vrai appel d'offres, une notification d'un tiers sur une demande e2e, une adhésion à une organisation…), la purge **s'arrête** et liste ces lignes. Elle ne modifie jamais une donnée tierce : c'est à l'exploitant de décider. Même chose si `service_items.suggested_by_user_id` ou `approved_by_user_id` pointe vers un compte visé (D6) : le catalogue n'est jamais modifié.

## Garde-fous

- **Simulation par défaut.** Sans `--execute`, le script lit dans une transaction `READ ONLY` annulée : rien ne peut s'écrire.
- **Rôle dédié `linkr_purge`** : `SELECT` et `DELETE` sur la liste fermée des tables, `SELECT` seul sur les cinq tables protégées, rien d'autre. Au démarrage, le script refuse un super-utilisateur, un rôle qui peut écrire dans une table protégée, ou un rôle sans `DELETE` sur la liste.
- **Liste fermée** des tables modifiables ; au démarrage, son intersection avec `service_categories`, `service_items`, `regulatory_requirements`, `typeorm_migrations`, `spatial_ref_sys` doit être vide.
- **Une seule transaction** : `lock_timeout = '5s'`, verrou des 20 tables de la liste (`LOCK TABLE … IN SHARE ROW EXCLUSIVE MODE`), plan recalculé, phrase comparée, `DELETE … WHERE id = ANY($1)` table par table avec le nombre de lignes attendu, vérification qu'aucune ligne ne pointe encore vers un identifiant supprimé, vérification des comptes fixes, empreinte du catalogue (nombre de lignes et md5 des cinq tables) identique avant et après. Au moindre écart : `ROLLBACK`, rien n'a changé. Jamais de `TRUNCATE`, jamais d'ordre de schéma.
- **Phrase tapée** : `PURGER E2E <n> COMPTES <empreinte>`. L'empreinte résume les comptes et chaque ligne visée : si la base change entre la simulation et l'exécution, la phrase ne correspond plus et rien n'est supprimé.
- **Aucun accès Internet, aucune clé Stripe** : le service est sur le réseau `backend` (`internal`) et ne reçoit que `PURGE_DATABASE_URL`, `PURGE_STORAGE_DIR`, `PURGE_OUT_DIR` et `PURGE_CONFIRM`.
- **Même verrou que `deploy.sh`** (`/opt/linkr/.deploy.lock`) : jamais une purge pendant un déploiement.
- **Sauvegarde d'abord** : `--execute` lance `backup/backup.sh` ; s'il échoue, arrêt.

⚠️ **Pourquoi `LOCK TABLE` et pas `SELECT … FOR UPDATE`.** PostgreSQL exige le droit `UPDATE` pour `FOR UPDATE`, que `linkr_purge` n'a pas (mesuré : « permission denied for table users »). `SHARE ROW EXCLUSIVE` se prend avec le seul droit `DELETE`. Pendant la transaction (une à deux secondes), les écritures de l'application sur ces 20 tables **attendent** ; les lectures ne sont pas bloquées. Si un verrou ne vient pas en 5 s, tout est annulé : relancer plus tard.

## Mise en place sur le VPS (une fois)

1. Générer un mot de passe hexadécimal : `openssl rand -hex 32`.
2. Créer le rôle, sans laisser le mot de passe dans un historique :

   ```bash
   cd /opt/linkr
   docker compose exec -e PSQL_HISTORY=/dev/null postgres psql -U linkr -d linkr
   ```

   puis coller ces trois lignes, en remplaçant `<mot de passe généré>` par la valeur de l'étape 1 :

```sql
CREATE ROLE linkr_purge LOGIN PASSWORD '<mot de passe généré>';
GRANT SELECT, DELETE ON TABLE refunds, payments, reviews, notifications, quotes, service_request_attachments, service_request_assignments, service_requests, payment_methods, portfolio_items, verification_documents, professional_services, professional_service_categories, professional_service_zones, stripe_connect_accounts, service_providers, organization_memberships, password_reset_tokens, user_auth_providers, users TO linkr_purge;
GRANT SELECT ON TABLE service_categories, service_items, regulatory_requirements, typeorm_migrations, spatial_ref_sys TO linkr_purge;
```

   Ce texte est la sortie de `docker compose --profile tools run --rm -T purge --print-role-sql` (aucune connexion à la base) ; un test vérifie que cette page le recopie exactement. **Aucune migration** ne crée ce rôle.
3. Ajouter à `/opt/linkr/.env` (déjà `chmod 600`) : `PURGE_DATABASE_URL=postgresql://linkr_purge:<mot de passe>@postgres:5432/linkr`.
4. Copier `deploy/purge.sh` en `/opt/linkr/purge.sh` (`chmod 755`) et `deploy/compose.yaml` en `/opt/linkr/compose.yaml` (le service `purge` doit y être).
5. Le dossier des listes, `/opt/linkr/purge-out`, est créé par `purge.sh` en `chmod 700`. Il doit appartenir à l'uid 1000 (utilisateur `node` de l'image) : `sudo chown 1000:1000 /opt/linkr/purge-out` si `purge.sh` le demande. Il est hors du dépôt et hors du volume `uploads`.

Une table ajoutée plus tard n'est **pas** couverte par ces droits : c'est voulu (voir « Après une migration »).

## Utilisation

```bash
cd /opt/linkr
./purge.sh
```

Simulation : comptes visés (identifiant, mode, libellé sans adresse), lignes par table dans l'ordre de suppression, fichiers du volume à supprimer, nombre d'identifiants Stripe, signalements, puis l'empreinte et la ligne `PURGE_PHRASE=…`. Codes de sortie : `0` terminé, `2` refus (configuration, rôle, ADMIN, phrase), `3` purge bloquée (contrôle de fermeture ou catalogue), `1` erreur.

```bash
./purge.sh --execute
```

Verrou, sauvegarde, plan affiché, puis la phrase **tapée à la main** (jamais copiée d'un fichier). Le script recalcule le plan sous verrou et refuse si l'empreinte a changé.

### Lire le rapport

- `Transaction validée. Lignes supprimées :` le nombre de lignes par table.
- `Comptes fixes après purge : comptes=2 prestataires=1 connect=1` : identique à avant, sinon la transaction aurait été annulée.
- `Catalogue : empreintes identiques avant et après.`
- `Fichiers : N supprimé(s), … NON supprimé(s)` : les fichiers sont supprimés **après** le COMMIT, seulement ceux des lignes supprimées. Un échec est listé dans `purge-out/<horodatage>-files-remaining.txt` ; un passage suivant ne supprime que les fichiers de cette liste **sans ligne en base**.
- `Liste Stripe : /purge-out/<horodatage>-stripe-ids.txt` (sur l'hôte : `/opt/linkr/purge-out/…`, `chmod 600`), suivi de l'avertissement ci-dessous.
- `PURGE BLOQUÉE — …` : chaque ligne tierce, table et identifiant. Rien n'a été supprimé.

## Ce qui reste à la main

**Stripe.** La liste contient les `cus_`, `acct_` et `pm_` des seules entités supprimées (pour les comptes fixes, seulement les `pm_` des cartes supprimées : leur `cus_` et leur `acct_` restent).

> Bac à sable Stripe PARTAGÉ avec le développement : NE JAMAIS utiliser « Supprimer toutes les données de test ». Supprimer à la main uniquement ces identifiants.

Après traitement, détruire le fichier (`shred -u`).

**Gmail.** Les anciens comptes `e2e+…@gmail.com` écrivaient à la boîte d'un inconnu (la partie locale « e2e »). Ces courriels sont hors de notre portée ; rien à faire, sinon ne plus jamais utiliser ces adresses.

**Brevo.** Les journaux de courriels transactionnels gardent les adresses destinataires selon la rétention de Brevo. Vérifier dans la console Brevo s'il existe des contacts ou journaux à supprimer pour les adresses e2e.

**Sauvegardes.** La sauvegarde prise avant la purge, et les précédentes, contiennent encore les données supprimées. Elles disparaissent par la rotation de 14 jours (`rclone delete --min-age 14d`), qui ne tourne **que si la minuterie `linkr-backup.timer` tourne**. Une restauration dans cette fenêtre ramène les comptes purgés : relancer la purge après toute restauration.

## Après une migration

Toute nouvelle table avec une clé étrangère vers `users`, `service_providers`, `service_requests`, `payments` ou une autre table de la liste doit être ajoutée au plan (`purge-plan.ts`), aux arêtes vérifiées (`purge-execute.ts`), à la liste fermée et aux droits du rôle (`GRANT`). Sans cela : une clé `RESTRICT` fait échouer la purge (sûr), mais une clé `CASCADE` supprimerait des lignes en silence (les cascades s'exécutent avec les droits du propriétaire de la table, pas ceux de `linkr_purge`).
