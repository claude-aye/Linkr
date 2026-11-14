# Octroi du rôle ADMIN

Accorder le rôle `ADMIN` au compte de l'exploitant, et le retirer. Aucune route ne le fait : c'est une écriture SQL, exécutée **à la main, sur le VPS, par l'exploitant**.

- **Un seul ADMIN vivant.** La transaction refuse d'en créer un second.
- **Jamais attribué par un agent**, une CI ni une tâche planifiée. Un agent peut préparer la commande ; il ne l'exécute pas.
- **Compte confirmé seulement** (`email_verified_at_utc` posé). Un compte non confirmé est refusé : confirmer l'adresse d'abord.

## Quand l'utiliser

- Avant la première revue de pièces de vérification ou la première lecture de la carte de la demande (`/admin/verifications`, `/admin/demand-signals`).
- Pour retirer le rôle (retour arrière ci-dessous) : erreur d'octroi, compte compromis, fin de l'essai.

## Ce que le rôle change

`AdminGuard` relit `users.system_role` **en base à chaque requête** ; le jeton ne porte aucun rôle. L'octroi et le retrait prennent donc effet **à la requête suivante**, sans reconnexion.

Un ADMIN, en plus des consoles `/admin/*` :

- lit toute demande (`GET /service-requests/:id`), toute pièce jointe, les zones de tout prestataire et les pièces de vérification ;
- n'est **jamais** fermé par `close-account.sh` (refus net) ;
- fait **refuser** la purge des comptes e2e s'il figure dans sa liste (il n'y figure pas : sa liste ne retient que les adresses e2e).

## Rôle de base de données

Le rôle **propriétaire** (`$POSTGRES_USER`, depuis le conteneur `postgres`). C'est le seul qui peut écrire `users.system_role`. **Ne jamais accorder cette colonne à `linkr_moderation` ni à `linkr_purge`.**

## 1. Lecture préalable (lecture seule)

Remplacer `<préfixe>` par les premiers caractères de l'identifiant du compte à promouvoir ; l'identifiant complet à utiliser ensuite est celui que cette requête affiche. La sortie ne contient aucune adresse.

```bash
cd /opt/linkr
docker compose exec -T -e PGOPTIONS="-c default_transaction_read_only=on" postgres \
  sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
BEGIN READ ONLY;
SELECT id,
       system_role,
       email_verified_at_utc IS NOT NULL AS confirme,
       deleted_at_utc IS NOT NULL AS supprime
  FROM users
 WHERE id::text LIKE '<préfixe>%';
SELECT count(*) AS admins_vivants FROM users
 WHERE system_role = 'ADMIN' AND deleted_at_utc IS NULL;
ROLLBACK;
SQL
```

Attendu : **une seule ligne**, `USER`, `confirme = t`, `supprime = f`, et `admins_vivants = 0`. Sinon, arrêt :

- `confirme = f` : confirmer l'adresse depuis le bandeau de l'application, puis relancer ;
- plus d'une ligne : le préfixe est ambigu, utiliser l'identifiant complet ;
- `admins_vivants` ≥ 1 : un ADMIN existe déjà, le retirer d'abord (§ 3).

Noter l'**identifiant complet** affiché : c'est `<id>` ci-dessous.

## 2. Octroi (simulation, puis validation)

La transaction est **annulée** par défaut. Elle n'est validée que si `-v commit=true` est passé **et** qu'exactement une ligne a changé **et** qu'il reste un seul ADMIN vivant.

```bash
cd /opt/linkr
docker compose exec -T postgres \
  sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh \
  -v id=<id> -v commit=false <<'SQL'
\if :{?commit} \else \set commit false \endif
BEGIN;
SET LOCAL lock_timeout = '5s';
UPDATE users SET system_role = 'ADMIN', updated_at_utc = now()
 WHERE id = :'id'
   AND system_role = 'USER'
   AND deleted_at_utc IS NULL
   AND email_verified_at_utc IS NOT NULL
RETURNING id, system_role;
SELECT :ROW_COUNT = 1 AS une_ligne,
       (SELECT count(*) FROM users
         WHERE system_role = 'ADMIN' AND deleted_at_utc IS NULL) = 1 AS seul_admin \gset
\if :une_ligne
  \if :seul_admin
    \if :commit
      COMMIT;
      \echo 'VALIDÉ : rôle ADMIN accordé à 1 compte.'
    \else
      ROLLBACK;
      \echo 'SIMULATION : 1 compte passerait ADMIN. Relancer avec -v commit=true.'
    \endif
  \else
    ROLLBACK;
    \echo 'ANNULÉ : il existerait plus d''un ADMIN. Rien n''est modifié.'
  \endif
\else
  ROLLBACK;
  \echo 'ANNULÉ : 0 ligne (compte inconnu, supprimé, non confirmé ou déjà ADMIN). Rien n''est modifié.'
\endif
SQL
```

1. Lancer avec `-v commit=false` : attendu `SIMULATION : 1 compte passerait ADMIN.`
2. Relancer la **même** commande avec `-v commit=true` : attendu `VALIDÉ`.

Tout autre message : rien n'a été modifié. Ne jamais forcer par un `UPDATE` à la main.

## 3. Retour arrière

Même forme, simulation d'abord :

```bash
cd /opt/linkr
docker compose exec -T postgres \
  sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh \
  -v id=<id> -v commit=false <<'SQL'
\if :{?commit} \else \set commit false \endif
BEGIN;
SET LOCAL lock_timeout = '5s';
UPDATE users SET system_role = 'USER', updated_at_utc = now()
 WHERE id = :'id' AND system_role = 'ADMIN'
RETURNING id, system_role;
SELECT :ROW_COUNT = 1 AS une_ligne \gset
\if :une_ligne
  \if :commit
    COMMIT;
    \echo 'VALIDÉ : rôle ramené à USER.'
  \else
    ROLLBACK;
    \echo 'SIMULATION : 1 compte reviendrait à USER. Relancer avec -v commit=true.'
  \endif
\else
  ROLLBACK;
  \echo 'ANNULÉ : 0 ligne (compte inconnu ou pas ADMIN). Rien n''est modifié.'
\endif
SQL
```

Effet immédiat : la requête suivante de ce compte sur `/admin/*` répond 403.

## 4. Vérification après octroi

1. Relancer la lecture du § 1 : `system_role = ADMIN`, `admins_vivants = 1`. Ce compte unique est le vôtre, donc les comptes e2e fixes restent `USER`.
2. Connecté avec ce compte, ouvrir `https://linkrapp.com/admin/demand-signals` et `https://linkrapp.com/admin/verifications` : la page s'affiche (tableau ou état vide), sans « Accès réservé aux administrateurs ».
3. Connecté avec un compte `USER` (par exemple le compte e2e client), ouvrir la même page : « Accès réservé aux administrateurs » (l'API répond 403).

## Registre

Noter, hors du dépôt : la date, l'identifiant, l'action (octroi ou retrait) et la raison. Jamais d'adresse courriel.

## Voir aussi

[fermeture-compte.md](fermeture-compte.md) (refuse un ADMIN) · [purge.md](purge.md) (refuse un ADMIN dans sa liste) · [moderation-sql.md](moderation-sql.md) (`admin_id` = cet identifiant).
