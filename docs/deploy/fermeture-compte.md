# Fermeture d'un compte sur demande (essai)

Procédure qui tient l'engagement de la politique de confidentialité, section 7 : une demande d'effacement envoyée à support@linkrapp.com est **traitée à la main dans les 30 jours**, et toutes les données de l'essai sont **détruites au plus tard par la purge de fin d'essai**.

Pendant l'essai, le compte n'est **pas détruit** : il est **masqué** (suppression douce). Les seuls fichiers effacés tout de suite sont les photos de portfolio et les pièces de vérification **du prestataire de ce compte**. L'anonymisation codée (mode C) est une **condition ferme avant la production** (CLAUDE.md §6).

Outil : `deploy/close-account.sh`, avec `deploy/close-account/close-account.sql` et `deploy/close-account/delete-keys.sh`. Lancé **à la main** sur le VPS par l'exploitant, jamais par une tâche planifiée ni par un agent (CLAUDE.md §13 nº 21).

Ce document traite une **demande de la personne**. Pour réagir à un **abus** (suspendre un compte même avec des demandes ouvertes, retirer un avis ou une photo, annuler une demande) : [moderation-sql.md](moderation-sql.md).

## Installation sur le VPS (une fois, puis à chaque changement de ces fichiers)

```bash
scp deploy/close-account.sh linkr:/opt/linkr/close-account.sh
scp -r deploy/close-account linkr:/opt/linkr/
ssh linkr 'chmod 755 /opt/linkr/close-account.sh'
```

Les sorties vont dans `/opt/linkr/close-out/` (`chmod 700`, créé par le script), hors du dépôt.

## 1. Recevoir la demande et vérifier l'identité

1. La demande doit venir de l'**adresse exacte du compte**. Sinon, répondre seulement : « Pour des raisons de sécurité, écrivez-nous depuis l'adresse courriel de votre compte. » Cette réponse ne dit **jamais** si un compte existe.
2. Répondre **à l'adresse du compte**, jamais à une adresse de réponse différente, pour demander la confirmation. N'agir qu'après la réponse. Aucune pièce d'identité n'est demandée.
3. Ne rien divulguer dans les échanges : ni données du compte, ni demandes, ni montants.

Le délai de 30 jours court à partir de la confirmation.

## 2. Trouver l'identifiant du compte (lecture seule)

Adresse comparée **brute**, sans `lower()` : une adresse qui ne diffère que par la casse est un autre compte.

```bash
docker compose exec -T postgres sh -c 'psql -X -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT id, deleted_at_utc FROM users WHERE email = '"'"'adresse@exacte.ca'"'"'"'
```

Une seule ligne vivante est attendue. Ne jamais recopier l'adresse dans le registre ni dans un ticket : seulement l'identifiant.

## 3. Simulation (par défaut)

```bash
cd /opt/linkr && ./close-account.sh <users.id>
```

- **Étape 0, lecture seule** (transaction `READ ONLY`, annulée). Le script **refuse**, sans rien modifier (code 2), si le compte :
  - a une demande `OPEN`, `ASSIGNED`, `IN_PROGRESS` ou `COMPLETED` (travail fait, solde non payé), **comme client ou comme prestataire** (assigné ou ciblé, profil supprimé compris) ;
  - a un paiement `PENDING`, `PROCESSING` ou `REQUIRES_ACTION`, ou un remboursement `PENDING`, comme payeur ou bénéficiaire ;
  - a un devis `SUBMITTED` encore ouvert ;
  - est le dernier `OWNER` actif d'une organisation ;
  - est un ADMIN, n'existe pas ou est déjà fermé.

  Dans ce cas, répondre à la personne que la demande, le paiement ou le devis doit d'abord être terminé, annulé ou retiré **par l'entremise du soutien** (conditions, section 2), puis relancer.
- **Étape 1 simulée** : le masquage tourne dans une transaction **annulée**. Le script affiche ce qui serait masqué, le nombre de fichiers et d'identifiants Stripe. Rien n'est modifié.

## 4. Fermeture (`--execute`)

```bash
cd /opt/linkr && ./close-account.sh <users.id> --execute
```

Ordre appliqué par le script, toujours le même :

0. **Étape 0** de nouveau, en lecture seule. Refus = arrêt.
1. **Sauvegarde** (`backup/backup.sh`). Échec = arrêt, rien de modifié.
2. **Phrase tapée** : `FERMER <users.id>`. Différente = arrêt.
3. **Étape 1, transaction** : le compte est verrouillé, l'étape 0 est **revérifiée sous verrou**, puis, par `UPDATE` seulement :
   - `users.deleted_at_utc` et `sessions_invalidated_at_utc` à maintenant (connexion et rafraîchissement refusés ; un jeton d'accès déjà émis expire en 15 minutes au plus) ;
   - jetons de réinitialisation non utilisés : consommés ;
   - adhésions aux organisations : quittées ;
   - cartes (`payment_methods`), photos (`portfolio_items`), pièces de vérification et prestataire : supprimés en douceur (le prestataire sort de la recherche, son profil et son portfolio répondent 404).

   Dans la même transaction, **avant** le COMMIT, sont lues : les clés des fichiers (photos et pièces du **propre** prestataire du compte, jamais les pièces jointes des demandes) et les identifiants Stripe. Une clé dont la forme ne correspond pas exactement au préfixe de son propriétaire (`portfolio/<prestataire>/<uuid>.webp`, `verifications/<métier du prestataire>/<uuid>[.<ext>]`) est signalée `BADKEY` par l'identifiant de sa ligne, et jamais supprimée. Puis **COMMIT**. Aucune ligne n'est détruite.
4. **Étape 2, fichiers**, **après** le COMMIT seulement. Les clés sont dans un fichier temporaire `chmod 600` de `close-out/`, détruit à la fin. Un conteneur jetable (`alpine`), **sans réseau**, racine en lecture seule, sans privilège, utilisateur 1000, avec le volume `linkr_uploads` monté, exécute `delete-keys.sh` :
   - une simulation d'abord, qui compte les fichiers présents et les clés refusées ;
   - puis, après la confirmation tapée `SUPPRIMER <n> FICHIERS`, la suppression.

   `delete-keys.sh` n'accepte que `portfolio/<uuid>/<uuid>.webp` et `verifications/<uuid>/<uuid>[.<ext>]` : minuscules, chiffres et tirets, aucun `..`, aucun chemin absolu, aucun autre préfixe (les pièces jointes des demandes, troisième préfixe de la purge, sont refusées ici). Un dossier du chemin qui est un lien symbolique, ou une cible qui n'est pas un fichier ordinaire, est refusé. Une clé refusée est signalée par son numéro de ligne, jamais affichée, jamais supprimée. Un fichier supprimé n'existe plus que dans les sauvegardes des 14 derniers jours.

   Si l'étape échoue ou si la confirmation est refusée : **le compte est fermé**, la liste est conservée (`close-out/<horodatage>-files-remaining.txt`), code 4. Reprendre avec :

   ```bash
   ./close-account.sh --delete-files /opt/linkr/close-out/<horodatage>-files-remaining.txt
   ```
5. **Étape 3, Stripe (mode test)**, seulement si l'étape 0 a réussi (la liste n'est écrite qu'après le COMMIT) : `close-out/<horodatage>-<8 premiers caractères>-stripe-ids.txt`, une ligne par identifiant (`customer|cus_…`, `payment_method|pm_…`, `connect_account|acct_…`). Les supprimer **un par un** dans le tableau de bord Stripe, en mode test.

   > Bac à sable Stripe PARTAGÉ avec le développement : **JAMAIS** « Supprimer toutes les données de test ».

   Puis `shred -u` de la liste.
6. **Étape 4, Gmail, Brevo, registre** :
   - Brevo : dans la console, supprimer le contact de l'adresse s'il existe, et vérifier les journaux d'envoi. Ce qui ne peut pas être supprimé reste selon la durée de conservation de Brevo (la politique le dit).
   - Gmail : garder le fil de la demande (pièce justificative) jusqu'à la purge de fin d'essai, puis le supprimer avec les autres messages de soutien.
   - Registre (hors du dépôt, fichier `chmod 600` sur le poste de l'exploitant) : numéro de demande, date de réception, date de confirmation, date de traitement, étapes faites (masquage, fichiers, Stripe, Brevo), `users.id`. **Ni courriel, ni nom.**
7. Répondre à la personne, à l'adresse du compte, que le compte est fermé et que ses renseignements seront détruits au plus tard par la purge de fin d'essai.

## Codes de sortie

| Code | Sens |
|---|---|
| 0 | terminé |
| 1 | erreur, rien n'a été validé |
| 2 | refus ou blocage, rien n'a été modifié |
| 4 | compte fermé, étape fichiers incomplète (liste de reprise conservée) |
| 5 | état du COMMIT incertain : vérifier `users.deleted_at_utc` avant toute relance |

## Ce que ce script ne fait pas

- Il ne **détruit** aucune ligne et n'anonymise rien. Nom, courriel, empreinte du mot de passe, demandes, paiements et avis restent en base, inaccessibles, jusqu'à la purge de fin d'essai. Les avis écrits par le compte restent affichés sous « — ».
- Il ne supprime pas les pièces jointes des demandes : elles font partie de l'historique de l'autre partie, et partent avec la purge de fin d'essai.
- Un appelant connecté qui connaît l'identifiant du prestataire peut encore lire ses avis reçus par l'API (`GET /service-providers/{id}/reviews` ne vérifie pas que le prestataire existe) ; l'interface ne les affiche plus.
- L'adresse courriel est libérée : quelqu'un peut créer un nouveau compte avec elle (index unique partiel).
- Il s'exécute avec le rôle propriétaire de la base (les `UPDATE` sont figés dans le fichier SQL, par identifiant). Un rôle dédié serait plus strict : dette.

## Banc de test

Poste de développement seulement, jamais sur le VPS :

```bash
bash deploy/tests/close-account.test.sh
```

Il copie la base de développement migrée dans `linkr_closeaccount_probe`, crée des volumes jetables, puis supprime tout. Il vérifie : refus sur une demande `OPEN` (client), refus sur un job `IN_PROGRESS` (prestataire), refus d'un ADMIN, simulation sans effet, compte propre fermé (masquage, deux clés valides, deux clés piégées en `BADKEY`, trois identifiants Stripe, données des autres comptes inchangées), second passage refusé, et tri des clés : remontée de chemin, chemin absolu, préfixe inconnu, pièce jointe de demande, lien symbolique et casse refusés, seuls les deux fichiers du compte supprimés.

L'orchestration du script shell (verrou, sauvegarde, phrases) se vérifie avec `deploy/tests/close-account-sh.test.sh`, dans un conteneur Debian jetable avec un faux `docker` :

```bash
docker run --rm -v "$PWD/deploy:/deploy:ro" debian:bookworm-slim bash /deploy/tests/close-account-sh.test.sh
```
