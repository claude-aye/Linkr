# Réaction à un abus : procédures SQL manuelles

Requêtes que l'exploitant exécute **à la main**, sur le VPS, avec `psql`, pour réagir à un abus pendant l'essai. Aucun écran d'administration ne couvre ces cas aujourd'hui.

- **Jamais par une tâche planifiée, une CI ni un agent** (CLAUDE.md §13 nº 23).
- **Toujours la simulation d'abord.** Chaque bloc s'exécute par défaut dans une transaction **annulée** (`commit=false`). Il affiche ce qui serait modifié et le nombre de lignes. On relance le même bloc avec `-v commit=true` pour valider.
- **Contrôle du nombre de lignes.** Chaque bloc annule la transaction si le nombre de lignes modifiées n'est pas celui attendu.
- **Suppression douce seulement** (`deleted_at_utc`), jamais de `DELETE` (CLAUDE.md §13 nº 1). Seul le fichier d'une photo est effacé du volume.
- **Rien ne part vers une personne.** Aucune notification, aucun courriel. Prévenir quelqu'un se fait à la main, depuis la boîte de soutien.
- **Pas pendant un déploiement, une purge ou une fermeture de compte.** Chaque bloc pose `lock_timeout = 5s` : si une ligne est verrouillée, la transaction échoue sans rien modifier. Relancer plus tard.

Voir aussi : [arret-urgence.md](arret-urgence.md) (fermer les inscriptions ou tout le site), [fermeture-compte.md](fermeture-compte.md) (fermeture sur demande de la personne), [purge.md](purge.md) (comptes e2e).

## 0. Urgence : fermer les inscriptions d'abord

Si l'abus vient de comptes créés en série, fermer les inscriptions **avant** toute requête. C'est immédiat, sans déploiement ni redémarrage (détail : [arret-urgence.md](arret-urgence.md)) :

```bash
cd /opt/linkr && touch flags/signups-closed      # /signup et POST /api/auth/signup → 503
curl -s -o /dev/null -w '%{http_code}\n' https://linkrapp.com/signup   # 503 attendu
```

Les comptes existants se connectent toujours. Pour tout fermer : `touch flags/maintenance` (le webhook Stripe reste servi). Rouvrir : `rm flags/signups-closed` (ou `rm flags/maintenance`).

## 1. Mise en place (une fois)

### Rôle `linkr_moderation`

Un rôle dédié, sans mot de passe. Il ne peut se connecter que par le socket local du conteneur `postgres` (le `pg_hba.conf` de l'image accepte le socket local, et exige un mot de passe sur le réseau). Il ne lit **ni courriel, ni nom, ni téléphone, ni empreinte de mot de passe**, et ne modifie que les colonnes listées.

```bash
cd /opt/linkr
docker compose exec -T postgres sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
CREATE ROLE linkr_moderation LOGIN;
GRANT SELECT (id, system_role, created_at_utc, deleted_at_utc) ON users TO linkr_moderation;
GRANT UPDATE (deleted_at_utc, sessions_invalidated_at_utc, updated_at_utc) ON users TO linkr_moderation;
GRANT SELECT (id, user_id, deleted_at_utc) ON service_providers TO linkr_moderation;
GRANT UPDATE (deleted_at_utc, updated_at_utc) ON service_providers TO linkr_moderation;
GRANT SELECT (id, service_provider_id, author_user_id, service_request_id, rating, comment, provider_response, created_at_utc, deleted_at_utc) ON reviews TO linkr_moderation;
GRANT UPDATE (deleted_at_utc, updated_at_utc) ON reviews TO linkr_moderation;
GRANT SELECT (id, service_provider_id, storage_key, caption, created_at_utc, deleted_at_utc) ON portfolio_items TO linkr_moderation;
GRANT UPDATE (deleted_at_utc, updated_at_utc) ON portfolio_items TO linkr_moderation;
GRANT SELECT (id, client_user_id, request_type, status, assigned_service_provider_id, requested_service_provider_id, accepted_at_utc, completed_at_utc, created_at_utc, deleted_at_utc) ON service_requests TO linkr_moderation;
GRANT UPDATE (status, cancelled_at_utc, cancellation_reason, cancelled_by_user_id, updated_at_utc) ON service_requests TO linkr_moderation;
GRANT SELECT (id, service_request_id, payment_type, status, payer_user_id, recipient_service_provider_id, stripe_payment_intent_id) ON payments TO linkr_moderation;
GRANT SELECT (id, service_request_id, service_provider_id, status) ON quotes TO linkr_moderation;
-- Lus seulement par (d3), pour reconnaître une fermeture de compte.
GRANT SELECT (owner_user_id, deleted_at_utc) ON payment_methods TO linkr_moderation;
GRANT SELECT (id, service_provider_id) ON professional_service_categories TO linkr_moderation;
GRANT SELECT (professional_service_category_id, deleted_at_utc) ON verification_documents TO linkr_moderation;
SQL
```

Contrôle : `\dp users` (avec le rôle propriétaire) doit montrer ces seules colonnes pour `linkr_moderation`. Le rôle n'a aucun droit `INSERT` ni `DELETE`.

Contrôle de la connexion, à faire **sur le VPS** (la règle ci-dessus a été mesurée sur le conteneur de développement, même image `postgis/postgis:16-3.4`) :

```bash
docker compose exec -T postgres sh -c 'grep -v "^#" "$PGDATA/pg_hba.conf" | grep -v "^$"'
```

Attendu : `local all all trust`, `host … 127.0.0.1/32 trust`, `host … ::1/128 trust`, puis `host all all all scram-sha-256`. Un rôle sans mot de passe est alors refusé par le réseau Docker (l'API, `migrate`, Caddy) et accepté seulement depuis le conteneur `postgres` lui-même. ⚠️ **Ne jamais poser `POSTGRES_HOST_AUTH_METHOD=trust`** dans `deploy/.env` : la dernière ligne deviendrait `trust`, et ce rôle serait joignable sans mot de passe depuis n'importe quel conteneur du réseau `backend`.

**Toute nouvelle colonne de contact sur ces tables ne doit jamais être ajoutée à ces `GRANT`.**

### Raccourci `modsql`

À coller dans le terminal du VPS, à chaque session (rien n'est installé) :

```bash
cd /opt/linkr && mkdir -p -m 700 moderation-out
modsql() {
  docker compose exec -T postgres sh -c \
    'exec psql -X -q -v ON_ERROR_STOP=1 -U linkr_moderation -d "$POSTGRES_DB" "$@"' sh "$@"
}
```

`moderation-out/` reçoit les listes de clés de fichiers (§ c). Il est hors du dépôt, en `chmod 700`.

### Trouver un identifiant

Le rôle ne lit pas les courriels. Les identifiants viennent du signalement : l'URL d'un profil (`/providers/<service_providers.id>`), d'une demande (`/requests/<id>/devis`, `/dashboard/requests/<id>`) ou d'une photo (`/media/portfolio/<portfolio_items.id>`). Si on n'a qu'une adresse courriel, la lecture se fait avec le rôle propriétaire, comme à la section 2 de [fermeture-compte.md](fermeture-compte.md) (adresse comparée brute, une seule ligne vivante attendue), et l'adresse n'est **jamais** recopiée au registre.

L'identifiant de l'administrateur qui agit (`admin_id`, utilisé en § e et § d) est le `users.id` du compte de l'exploitant, `system_role = 'ADMIN'`.

## 2. (a) Inscriptions récentes

Lecture seule. Aucune adresse, aucun nom : seulement les identifiants, les dates et l'activité.

Inscriptions par heure sur les 48 dernières heures (repérer une rafale) :

```bash
modsql <<'SQL'
-- (a1) inscriptions par heure
SELECT date_trunc('hour', created_at_utc) AS heure_utc, count(*) AS inscriptions
  FROM users
 WHERE created_at_utc > now() - interval '48 hours'
 GROUP BY 1 ORDER BY 1 DESC;
SQL
```

Les 50 derniers comptes, avec leur activité :

```bash
modsql -v jours=7 <<'SQL'
-- (a2) derniers comptes et activité
SELECT u.id, u.created_at_utc, u.system_role, u.deleted_at_utc IS NOT NULL AS masque,
       sp.id AS prestataire,
       (SELECT count(*) FROM service_requests sr
         WHERE sr.client_user_id = u.id AND sr.created_at_utc > now() - interval '24 hours') AS demandes_24h,
       (SELECT count(*) FROM reviews r
         WHERE r.author_user_id = u.id AND r.deleted_at_utc IS NULL) AS avis,
       (SELECT count(*) FROM portfolio_items pi
         WHERE pi.service_provider_id = sp.id AND pi.deleted_at_utc IS NULL) AS photos
  FROM users u
  LEFT JOIN service_providers sp ON sp.user_id = u.id AND sp.deleted_at_utc IS NULL
 WHERE u.created_at_utc > now() - make_interval(days => :jours)
 ORDER BY u.created_at_utc DESC
 LIMIT 50;
SQL
```

Rien n'est écrit au registre pour une simple lecture.

## 3. (b) Retirer un avis

Effet : l'avis disparaît du profil et de la note moyenne (l'agrégat exclut les avis supprimés), avec la réponse du prestataire, qui vit sur la même ligne.

Repérer l'avis parmi ceux d'un prestataire (le texte affiché est celui déjà public) :

```bash
modsql -v pid=<service_providers.id> <<'SQL'
-- (b1) avis d'un prestataire
SELECT id, created_at_utc, rating, left(comment, 80) AS debut_commentaire,
       provider_response IS NOT NULL AS repondu, deleted_at_utc IS NOT NULL AS retire
  FROM reviews
 WHERE service_provider_id = :'pid'
 ORDER BY created_at_utc DESC
 LIMIT 20;
SQL
```

Retirer (simulation, puis la même commande avec `-v commit=true`) :

```bash
modsql -v id=<reviews.id> -v commit=false <<'SQL'
-- (b2) retirer un avis
\if :{?commit} \else \set commit false \endif
BEGIN;
SET LOCAL lock_timeout = '5s';
WITH x AS (
  UPDATE reviews SET deleted_at_utc = now(), updated_at_utc = now()
   WHERE id = :'id' AND deleted_at_utc IS NULL
  RETURNING 1)
SELECT count(*) = 1 AS ok FROM x \gset
\if :ok
  \if :commit
    COMMIT;
    \echo 'VALIDÉ : 1 avis retiré.'
  \else
    ROLLBACK;
    \echo 'SIMULATION : 1 avis serait retiré. Relancer avec -v commit=true.'
  \endif
\else
  ROLLBACK;
  \echo 'ANNULÉ : 0 ligne (avis inconnu ou déjà retiré). Rien n''est modifié.'
\endif
SQL
```

⚠️ **L'auteur peut écrire un nouvel avis sur la même demande** : l'index unique ne porte que sur les avis vivants (`ux_reviews_request_active`). Si l'abus vient de l'auteur, le suspendre (§ d).

Registre : `avis-retire`, `reviews.id`, 1 ligne, motif.

## 4. (c) Retirer une photo de portfolio (ligne + fichier)

Effet : la ligne est supprimée en douceur (la photo disparaît du profil et du compteur), puis le fichier est effacé du volume `linkr_uploads`. Même ordre que l'API (Loi 25) : la ligne d'abord, le fichier ensuite.

Repérer la photo :

```bash
modsql -v pid=<service_providers.id> <<'SQL'
-- (c1) photos d'un prestataire
SELECT id, created_at_utc, caption, deleted_at_utc IS NOT NULL AS retiree
  FROM portfolio_items
 WHERE service_provider_id = :'pid'
 ORDER BY created_at_utc DESC;
SQL
```

Retirer la ligne. La clé du fichier n'est imprimée qu'après le COMMIT, et seulement si elle a exactement la forme `portfolio/<prestataire>/<uuid>.webp` ; sinon la ligne est quand même retirée et le fichier est laissé (à signaler). La sortie est conservée dans `moderation-out/` :

```bash
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
modsql -At -v id=<portfolio_items.id> -v commit=false <<'SQL' | tee "moderation-out/$STAMP-photo.txt"
-- (c2) retirer une photo
\if :{?commit} \else \set commit false \endif
BEGIN;
SET LOCAL lock_timeout = '5s';
WITH x AS (
  UPDATE portfolio_items SET deleted_at_utc = now(), updated_at_utc = now()
   WHERE id = :'id' AND deleted_at_utc IS NULL
  RETURNING storage_key, service_provider_id)
SELECT count(*) = 1 AS ok,
       coalesce(max(CASE WHEN storage_key ~ ('^portfolio/' || service_provider_id || '/[0-9a-f-]{36}\.webp$')
                         THEN storage_key END), '') AS cle
  FROM x \gset
\if :ok
  \if :commit
    COMMIT;
    \echo 'VALIDÉ : 1 photo retirée.'
    SELECT CASE WHEN :'cle' = '' THEN 'BADKEY|' || :'id' ELSE 'KEY|' || :'cle' END;
  \else
    ROLLBACK;
    \echo 'SIMULATION : 1 photo serait retirée. Relancer avec -v commit=true.'
  \endif
\else
  ROLLBACK;
  \echo 'ANNULÉ : 0 ligne (photo inconnue ou déjà retirée). Rien n''est modifié.'
\endif
SQL
```

Puis effacer le fichier, avec l'outil de la fermeture de compte (installé par [fermeture-compte.md](fermeture-compte.md)), dans un conteneur jetable sans réseau. D'abord la simulation (`--dry-run`), puis `--delete` :

```bash
delkeys() {  # delkeys --dry-run|--delete : outil de la fermeture de compte, conteneur sans réseau
  docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges --user 1000:1000 \
    -v linkr_uploads:/data \
    -v "$PWD/moderation-out/$STAMP-keys.txt:/keys.txt:ro" \
    -v "$PWD/close-account/delete-keys.sh:/delete-keys.sh:ro" \
    alpine:3.20 sh /delete-keys.sh /keys.txt /data "$1"
}
```

**Commande 1, simulation** (n'efface rien) :

```bash
grep '^KEY|' "moderation-out/$STAMP-photo.txt" | cut -d'|' -f2 > "moderation-out/$STAMP-keys.txt"
chmod 600 "moderation-out/$STAMP-keys.txt"
delkeys --dry-run | tee "moderation-out/$STAMP-dryrun.txt"
```

Attendu : `SUMMARY|lignes=1|a_supprimer=1|absents=0|refusees=0|supprimes=0|echecs=0`. Lire cette ligne avant de continuer.

**Commande 2, effacement**, qui refuse de s'exécuter si la simulation n'a pas trouvé exactement un fichier à supprimer :

```bash
if grep -q '^SUMMARY|lignes=1|a_supprimer=1|' "moderation-out/$STAMP-dryrun.txt"; then
  delkeys --delete
else
  echo "ARRÊT : la simulation n'a pas trouvé exactement 1 fichier à supprimer. Rien n'est effacé."
fi
```

Attendu : `…|supprimes=1|echecs=0`. Ensuite `shred -u moderation-out/$STAMP-*`.

⚠️ **Ne pas redéfinir `STAMP`** entre le retrait de la ligne et ces deux commandes : les fichiers de `moderation-out/` portent son horodatage, et une nouvelle valeur les rendrait introuvables (l'effacement s'arrête alors sans rien supprimer).

- Une ligne `BADKEY|<id>` : la clé n'a pas la forme attendue. Le fichier reste. Le noter au registre, ne jamais effacer à la main.
- `delete-keys.sh` refuse aussi les liens symboliques et tout autre préfixe.
- Le fichier reste dans les sauvegardes des 14 derniers jours.
- L'image est servie avec `Cache-Control: public, max-age=3600` : un navigateur qui l'a déjà chargée peut encore l'afficher jusqu'à une heure.

Registre : `photo-retiree`, `portfolio_items.id`, 1 ligne, fichier effacé (oui ou non), motif.

## 5. (d) Suspendre un compte, même avec des demandes ouvertes

À la différence de [fermeture-compte.md](fermeture-compte.md), qui refuse tant qu'une activité est en cours, la suspension s'applique **tout de suite**. Elle masque le compte, sans rien détruire, et elle est réversible (§ d3).

Effet, dans une seule transaction :

- `users.deleted_at_utc` et `sessions_invalidated_at_utc` à maintenant : la connexion est refusée (le compte n'est plus trouvé) et le rafraîchissement aussi (401). ⚠️ Un jeton d'accès déjà émis reste valable **jusqu'à 15 minutes** (il n'est pas contrôlé en base).
- son prestataire `INDIVIDUAL` est supprimé en douceur : absent de la recherche et des appels d'offres, profil et photos en 404.
- ses demandes `DRAFT` ou `OPEN`, **comme client** ou **visant son prestataire**, passent `CANCELLED`. Sans cela, un prestataire pourrait encore accepter une demande du compte suspendu et prélever un acompte sur sa carte enregistrée. (d1) et (d2) utilisent le **même prédicat**, recopié mot pour mot :

  ```sql
  sr.deleted_at_utc IS NULL
  AND sr.status IN ('DRAFT', 'OPEN')
  AND (sr.client_user_id = :'uid' OR sr.requested_service_provider_id IN (SELECT id FROM p))
  ```

Les demandes `ASSIGNED`, `IN_PROGRESS` et `COMPLETED` ne sont **pas** touchées : elles portent de l'argent. Le bloc les liste (`A_TRAITER|…`), avec les paiements en cours. Chacune se traite ensuite à part (§ e, et la section 8).

> **⚠️ Une demande `COMPLETED` laisse moins de 72 h pour décider.** Le cron horaire prélève le solde sur la carte du client 72 h après la fin (`completed_at_utc + PLATFORM_AUTO_RELEASE_HOURS`, 72 h en production : contrôler `api.env`) et le verse au prestataire, **même suspendu** : il ne lit que la demande, jamais le compte. Ces lignes sortent en `A_TRAITER_URGENT|…` avec l'échéance, en tête de liste. Une échéance déjà passée veut dire que le solde est prélevé, ou le sera au prochain passage horaire. **Le gel (`contested_at_utc`) reste une décision écrite**, prise hors de ce document (section 8).

Ce que la suspension ne masque pas :

- **le prestataire d'une organisation** dont la personne est OWNER (seul le prestataire `INDIVIDUAL` est masqué). Sans effet pendant l'essai : aucune organisation n'est utilisée ;
- **ses avis** : ils restent affichés, auteur remplacé par « — ». Si l'abus est dans un avis, le retirer aussi (§ b) ;
- **ses devis ouverts** (`SUBMITTED`) : ils restent listés chez le client, marqués non acceptables, sous « Prestataire indisponible ».

### (d1) Simulation : ce qui serait touché

```bash
modsql -v uid=<users.id> <<'SQL'
-- (d1) activité du compte
WITH p AS (SELECT id FROM service_providers WHERE user_id = :'uid')
SELECT 'demande' AS quoi, sr.id, sr.status::text AS statut,
       CASE WHEN sr.client_user_id = :'uid' THEN 'client' ELSE 'prestataire' END AS role,
       (sr.deleted_at_utc IS NULL
        AND sr.status IN ('DRAFT', 'OPEN')
        AND (sr.client_user_id = :'uid' OR sr.requested_service_provider_id IN (SELECT id FROM p))) AS a_annuler,
       CASE WHEN sr.status = 'COMPLETED'
            THEN to_char((sr.completed_at_utc + interval '72 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
       END AS versement_auto
  FROM service_requests sr
 WHERE sr.deleted_at_utc IS NULL
   AND sr.status IN ('DRAFT', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED')
   AND (sr.client_user_id = :'uid'
        OR sr.assigned_service_provider_id IN (SELECT id FROM p)
        OR sr.requested_service_provider_id IN (SELECT id FROM p))
UNION ALL
SELECT 'paiement', pay.id, pay.status::text, pay.payment_type::text, false, NULL
  FROM payments pay
 WHERE pay.status IN ('PENDING', 'PROCESSING', 'REQUIRES_ACTION')
   AND (pay.payer_user_id = :'uid' OR pay.recipient_service_provider_id IN (SELECT id FROM p))
UNION ALL
SELECT 'devis ouvert', q.id, q.status::text, 'prestataire', false, NULL
  FROM quotes q
 WHERE q.status = 'SUBMITTED' AND q.service_provider_id IN (SELECT id FROM p)
ORDER BY 1, 3;

WITH p AS (SELECT id FROM service_providers WHERE user_id = :'uid')
SELECT count(*) AS attendu
  FROM service_requests sr
 WHERE sr.deleted_at_utc IS NULL
   AND sr.status IN ('DRAFT', 'OPEN')
   AND (sr.client_user_id = :'uid' OR sr.requested_service_provider_id IN (SELECT id FROM p));
SQL
```

La dernière ligne, `attendu`, est le nombre de demandes que (d2) annulera. Le passer à (d2) avec `-v attendu=<n>`.

### (d2) Suspendre (simulation, puis `-v commit=true`)

```bash
modsql -v uid=<users.id> -v admin_id=<users.id de l'exploitant> -v attendu=<n de d1> -v commit=false <<'SQL'
-- (d2) suspendre un compte
\if :{?commit} \else \set commit false \endif
\if :{?attendu}
\else
  \echo 'ANNULÉ : -v attendu=<n> est obligatoire (nombre « attendu » affiché par d1). Rien n''est modifié.'
  \quit
\endif
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT count(*) = 1 AS found, coalesce(bool_or(admin), false) AS is_admin
  FROM (SELECT system_role = 'ADMIN' AS admin FROM users
         WHERE id = :'uid' AND deleted_at_utc IS NULL FOR UPDATE) s \gset
SELECT count(*) = 1 AS admin_ok FROM users
 WHERE id = :'admin_id' AND system_role = 'ADMIN' AND deleted_at_utc IS NULL \gset
\if :found
\else
  ROLLBACK;
  \echo 'ANNULÉ : aucun compte actif ne porte cet identifiant.'
  \quit
\endif
\if :is_admin
  ROLLBACK;
  \echo 'ANNULÉ : compte administrateur, jamais suspendu par ce bloc.'
  \quit
\endif
\if :admin_ok
\else
  ROLLBACK;
  \echo 'ANNULÉ : admin_id ne désigne pas un administrateur actif.'
  \quit
\endif

WITH p AS (SELECT id FROM service_providers WHERE user_id = :'uid'),
     x AS (
  UPDATE service_requests sr
     SET status = 'CANCELLED', cancelled_at_utc = now(),
         cancellation_reason = 'Annulée par le soutien de Linkr.',
         cancelled_by_user_id = :'admin_id', updated_at_utc = now()
   WHERE sr.deleted_at_utc IS NULL
     AND sr.status IN ('DRAFT', 'OPEN')
     AND (sr.client_user_id = :'uid' OR sr.requested_service_provider_id IN (SELECT id FROM p))
  RETURNING 1)
SELECT count(*) AS n_demandes, count(*) = :attendu AS attendu_ok FROM x \gset
\if :attendu_ok
\else
  ROLLBACK;
  \echo 'ANNULÉ :' :n_demandes 'demande(s) à annuler,' :attendu 'attendue(s). Relancer d1. Rien n''est modifié.'
  \quit
\endif

WITH x AS (
  UPDATE service_providers SET deleted_at_utc = now(), updated_at_utc = now()
   WHERE user_id = :'uid' AND deleted_at_utc IS NULL RETURNING 1)
SELECT count(*) AS n_prestataires FROM x \gset

WITH x AS (
  UPDATE users
     SET deleted_at_utc = now(), sessions_invalidated_at_utc = now(), updated_at_utc = now()
   WHERE id = :'uid' AND deleted_at_utc IS NULL RETURNING 1)
SELECT count(*) = 1 AS users_ok FROM x \gset

\if :users_ok
\else
  ROLLBACK;
  \echo 'ANNULÉ : le compte n''a pas été masqué (0 ligne). Rien n''est modifié.'
  \quit
\endif

\echo 'demandes annulées :' :n_demandes
\echo 'prestataire masqué :' :n_prestataires
-- Ce qui reste à traiter à la main (argent en jeu). URGENT d'abord.
WITH p AS (SELECT id FROM service_providers WHERE user_id = :'uid')
SELECT a_traiter FROM (
  SELECT CASE WHEN sr.status = 'COMPLETED'
              THEN 'A_TRAITER_URGENT|demande|' || sr.id || '|COMPLETED|versement automatique le '
                   || to_char((sr.completed_at_utc + interval '72 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
              ELSE 'A_TRAITER|demande|' || sr.id || '|' || sr.status
         END AS a_traiter,
         CASE WHEN sr.status = 'COMPLETED' THEN 0 ELSE 1 END AS urgence
    FROM service_requests sr
   WHERE sr.deleted_at_utc IS NULL
     AND sr.status IN ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED')
     AND (sr.client_user_id = :'uid' OR sr.assigned_service_provider_id IN (SELECT id FROM p))
  UNION ALL
  SELECT 'A_TRAITER|paiement|' || pay.id || '|' || pay.status, 1
    FROM payments pay
   WHERE pay.status IN ('PENDING', 'PROCESSING', 'REQUIRES_ACTION')
     AND (pay.payer_user_id = :'uid' OR pay.recipient_service_provider_id IN (SELECT id FROM p))
) t ORDER BY urgence, a_traiter;

\if :commit
  COMMIT;
  \echo 'VALIDÉ : compte suspendu.'
\else
  ROLLBACK;
  \echo 'SIMULATION : rien n''est modifié. Relancer avec -v commit=true.'
\endif
SQL
```

Registre : `compte-suspendu`, `users.id`, demandes annulées (identifiants, depuis § d1), prestataire masqué (0 ou 1), lignes `A_TRAITER`, motif.

### (d3) Lever la suspension

Rétablit le compte et le prestataire masqués **par la même transaction** (même horodatage). Les demandes annulées ne sont **pas** rouvertes.

Avant de lancer ce bloc, **relire la ligne du registre** : elle doit être `compte-suspendu`, jamais une fermeture sur demande ni une suppression par la personne elle-même. Le bloc exige `-v registre=compte-suspendu`, et refuse l'empreinte d'une fermeture de compte : une carte, une photo ou une pièce de vérification supprimée **au même horodatage** que le compte. Un compte fermé qui n'avait ni carte, ni photo, ni pièce ne laisse pas cette empreinte : le registre reste alors le seul garde-fou.

```bash
modsql -v uid=<users.id> -v registre=compte-suspendu -v commit=false <<'SQL'
-- (d3) lever une suspension
\if :{?commit} \else \set commit false \endif
\if :{?registre}
\else
  \echo 'ANNULÉ : -v registre=compte-suspendu est obligatoire (relire le registre). Rien n''est modifié.'
  \quit
\endif
SELECT :'registre' = 'compte-suspendu' AS registre_ok \gset
\if :registre_ok
\else
  \echo 'ANNULÉ : seule une suspension (registre compte-suspendu) se lève ici. Rien n''est modifié.'
  \quit
\endif
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT count(*) = 1 AS found, max(deleted_at_utc) AS masque_le
  FROM (SELECT deleted_at_utc FROM users
         WHERE id = :'uid' AND deleted_at_utc IS NOT NULL FOR UPDATE) s \gset
\if :found
\else
  ROLLBACK;
  \echo 'ANNULÉ : aucun compte masqué ne porte cet identifiant.'
  \quit
\endif
-- Empreinte d'une fermeture de compte (close-account.sql masque tout au même instant).
SELECT (SELECT count(*) FROM payment_methods
         WHERE owner_user_id = :'uid' AND deleted_at_utc = :'masque_le')
     + (SELECT count(*) FROM portfolio_items pi
          JOIN service_providers sp ON sp.id = pi.service_provider_id
         WHERE sp.user_id = :'uid' AND pi.deleted_at_utc = :'masque_le')
     + (SELECT count(*) FROM verification_documents vd
          JOIN professional_service_categories psc ON psc.id = vd.professional_service_category_id
          JOIN service_providers sp ON sp.id = psc.service_provider_id
         WHERE sp.user_id = :'uid' AND vd.deleted_at_utc = :'masque_le') = 0 AS pas_ferme \gset
\if :pas_ferme
\else
  ROLLBACK;
  \echo 'ANNULÉ : carte, photo ou pièce supprimée au même instant que le compte : c''est une fermeture, pas une suspension. Rien n''est modifié.'
  \quit
\endif
WITH x AS (
  UPDATE service_providers SET deleted_at_utc = NULL, updated_at_utc = now()
   WHERE user_id = :'uid' AND deleted_at_utc = :'masque_le' RETURNING 1)
SELECT count(*) AS n_prestataires FROM x \gset
WITH x AS (
  UPDATE users SET deleted_at_utc = NULL, updated_at_utc = now()
   WHERE id = :'uid' AND deleted_at_utc = :'masque_le' RETURNING 1)
SELECT count(*) = 1 AS users_ok FROM x \gset
\if :users_ok
  \echo 'prestataire rétabli :' :n_prestataires
  \if :commit
    COMMIT;
    \echo 'VALIDÉ : suspension levée. La personne se reconnecte avec son mot de passe.'
  \else
    ROLLBACK;
    \echo 'SIMULATION : rien n''est modifié. Relancer avec -v commit=true.'
  \endif
\else
  ROLLBACK;
  \echo 'ANNULÉ : 0 ligne. Rien n''est modifié.'
\endif
SQL
```

- Si l'adresse courriel a été reprise par un nouveau compte entre-temps, l'`UPDATE` échoue sur l'index unique `ux_users_email` et rien n'est modifié. Le message d'erreur n'affiche pas l'adresse : PostgreSQL masque la valeur de la clé à un rôle qui ne peut pas lire la colonne. Idem pour un nouveau profil prestataire (`ux_service_providers_user`).

Registre : `suspension-levee`, `users.id`, motif.

## 6. (e) Annuler une demande abusive

Même effet que l'annulation par l'API (`POST /service-requests/:id/cancel`) : statut `CANCELLED`, date, motif, auteur. Permis depuis `DRAFT`, `OPEN`, `ASSIGNED` et `IN_PROGRESS` (machine à états). Les devis, l'assignation et les paiements ne sont pas touchés, comme par l'API.

Simulation :

```bash
modsql -v id=<service_requests.id> <<'SQL'
-- (e1) état d'une demande
SELECT sr.id, sr.request_type, sr.status, sr.accepted_at_utc, sr.deleted_at_utc IS NOT NULL AS masquee,
       (SELECT string_agg(pay.payment_type || ':' || pay.status
                          || coalesce(':' || pay.stripe_payment_intent_id, ''), ', ')
          FROM payments pay WHERE pay.service_request_id = sr.id) AS paiements,
       (SELECT count(*) FROM quotes q WHERE q.service_request_id = sr.id AND q.status = 'SUBMITTED') AS devis_ouverts
  FROM service_requests sr
 WHERE sr.id = :'id';
SQL
```

Annuler (simulation, puis `-v commit=true`). Le bloc refuse :

- **un paiement en cours** : `PENDING` ou `PROCESSING`. Attendre son issue ;
- **un acompte que le client peut encore payer** : `FAILED` ou `REQUIRES_ACTION` **avec un PaymentIntent** (`pi_…`, affiché par e1). Le client peut le confirmer depuis son navigateur, même après l'annulation, s'il a commencé avant : l'acompte serait alors prélevé sur une demande annulée, sans remboursement. **Annuler d'abord ce PaymentIntent dans le tableau de bord Stripe** (mode test : Paiements, rechercher le `pi_…`, « Annuler le paiement »), **puis** relancer le bloc avec `-v intent_annule=true` ;
- **une demande `ASSIGNED` acceptée il y a moins de 10 minutes** : l'acompte est prélevé juste **après** l'acceptation, et sa ligne de paiement peut ne pas exister encore. Attendre 10 minutes, relancer e1, puis ce bloc ;
- **un acompte déjà prélevé** (`SUCCEEDED`), sauf avec `-v avec_paiement=true` : l'annulation ne rembourse rien (section 8).

```bash
modsql -v id=<service_requests.id> -v admin_id=<users.id de l'exploitant> -v commit=false <<'SQL'
-- (e2) annuler une demande
\if :{?commit} \else \set commit false \endif
\if :{?avec_paiement} \else \set avec_paiement false \endif
\if :{?intent_annule} \else \set intent_annule false \endif
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT count(*) = 1 AS found,
       coalesce(bool_or(status IN ('DRAFT', 'OPEN', 'ASSIGNED', 'IN_PROGRESS')), false) AS annulable,
       coalesce(bool_or(status = 'ASSIGNED'
                        AND (accepted_at_utc IS NULL OR accepted_at_utc > now() - interval '10 minutes')),
                false) AS trop_recente
  FROM (SELECT status, accepted_at_utc FROM service_requests
         WHERE id = :'id' AND deleted_at_utc IS NULL FOR UPDATE) s \gset
SELECT count(*) = 1 AS admin_ok FROM users
 WHERE id = :'admin_id' AND system_role = 'ADMIN' AND deleted_at_utc IS NULL \gset
SELECT count(*) FILTER (WHERE status IN ('PENDING', 'PROCESSING')) = 0 AS rien_en_cours,
       count(*) FILTER (WHERE status IN ('FAILED', 'REQUIRES_ACTION')
                          AND stripe_payment_intent_id IS NOT NULL) = 0 AS aucun_intent_ouvert,
       count(*) FILTER (WHERE status = 'SUCCEEDED') = 0 AS rien_preleve
  FROM payments WHERE service_request_id = :'id' \gset
\if :found
\else
  ROLLBACK;
  \echo 'ANNULÉ : demande inconnue ou masquée.'
  \quit
\endif
\if :annulable
\else
  ROLLBACK;
  \echo 'ANNULÉ : statut non annulable (COMPLETED, PAID, EXPIRED, CANCELLED ou REFUNDED).'
  \quit
\endif
\if :admin_ok
\else
  ROLLBACK;
  \echo 'ANNULÉ : admin_id ne désigne pas un administrateur actif.'
  \quit
\endif
\if :trop_recente
  ROLLBACK;
  \echo 'ANNULÉ : demande acceptée il y a moins de 10 minutes ; l''acompte peut être en cours de prélèvement. Réessayer plus tard.'
  \quit
\endif
\if :rien_en_cours
\else
  ROLLBACK;
  \echo 'ANNULÉ : un paiement est en cours (PENDING ou PROCESSING). Attendre son issue.'
  \quit
\endif
\if :aucun_intent_ouvert
\elif :intent_annule
  \echo 'ATTENTION : PaymentIntent déclaré annulé dans Stripe (-v intent_annule=true).'
\else
  ROLLBACK;
  \echo 'ANNULÉ : un acompte FAILED ou REQUIRES_ACTION a un PaymentIntent que le client peut encore payer. L''annuler dans Stripe, puis relancer avec -v intent_annule=true.'
  \quit
\endif
\if :rien_preleve
\elif :avec_paiement
  \echo 'ATTENTION : un paiement est prélevé. Le rembourser par l''API (moderation-sql.md, section 8).'
\else
  ROLLBACK;
  \echo 'ANNULÉ : un paiement est prélevé. Relancer avec -v avec_paiement=true si le remboursement est décidé.'
  \quit
\endif
WITH x AS (
  UPDATE service_requests
     SET status = 'CANCELLED', cancelled_at_utc = now(),
         cancellation_reason = 'Annulée par le soutien de Linkr.',
         cancelled_by_user_id = :'admin_id', updated_at_utc = now()
   WHERE id = :'id' AND deleted_at_utc IS NULL
     AND status IN ('DRAFT', 'OPEN', 'ASSIGNED', 'IN_PROGRESS')
  RETURNING 1)
SELECT count(*) = 1 AS ok FROM x \gset
\if :ok
  \if :commit
    COMMIT;
    \echo 'VALIDÉ : demande annulée.'
  \else
    ROLLBACK;
    \echo 'SIMULATION : 1 demande serait annulée. Relancer avec -v commit=true.'
  \endif
\else
  ROLLBACK;
  \echo 'ANNULÉ : 0 ligne. Rien n''est modifié.'
\endif
SQL
```

Registre : `demande-annulee`, `service_requests.id`, statut avant, PaymentIntent annulé dans Stripe (oui ou non), paiement prélevé (oui ou non), motif.

## 7. Registre

Le même fichier que pour les fermetures de compte : hors du dépôt, `chmod 600`, sur le poste de l'exploitant. Une ligne par action :

```
2026-11-11T14:05Z | avis-retire | reviews.id=<uuid> | 1 ligne | motif=contenu-injurieux
```

- ⚠️ **Le registre contient des renseignements personnels pseudonymisés.** Un `users.id`, ou l'identifiant d'un avis, d'une photo ou d'une demande, désigne une personne pour qui peut le relier à la base ; avec un motif comme `fraude` ou `usurpation`, c'est une allégation sur cette personne (Loi 25). Il se traite comme tel : accès réservé à l'exploitant, aucune copie, et **destruction à la purge de fin d'essai**, en même temps que les données de l'essai.
- **Aucun numéro de fil Gmail** : il mènerait au courriel du signalement, donc à une adresse. Le lien entre le signalement et l'action reste dans Gmail (répondre au fil avec la date de l'action), jamais dans le registre.
- **Jamais** : courriel, nom, téléphone, adresse, texte de l'avis, légende de la photo, titre de la demande.
- Motifs : une catégorie fixe (`contenu-injurieux`, `contenu-illicite`, `fraude`, `pourriel`, `usurpation`, `coordonnees-publiees`, `autre`).
- Les sorties de `moderation-out/` sont effacées (`shred -u`) une fois l'action consignée.

## 8. Ce qui ne se fait pas en SQL seul

- **Rembourser.** Une annulation ne rembourse rien. Le remboursement passe par l'API (`POST /admin/payments/:id/refund`, avec un jeton d'administrateur), qui appelle Stripe ; aucune requête SQL ne déplace d'argent. Ne jamais écrire `REFUNDED` à la main.
- **Geler un versement automatique** d'une demande `COMPLETED` (le solde est prélevé 72 h après la fin). Le mécanisme existe (`contested_at_utc`), mais il touche à l'argent : décision écrite d'abord, hors de ce document.
- **Annuler une demande `COMPLETED`** : la machine à états ne le permet pas. Remboursement par l'API ou contestation.
- **Couper un jeton d'accès déjà émis** : il reste valable jusqu'à 15 minutes. Pour un abus en cours qui ne peut pas attendre, `touch flags/maintenance` coupe tout le site.
- **Empêcher une réinscription.** L'adresse d'un compte masqué est libérée (index unique partiel) : la même personne peut recréer un compte. Il n'existe aucune liste d'adresses bannies. En urgence : fermer les inscriptions (§ 0).
- **Prévenir les personnes concernées.** Ni l'annulation ni la suspension n'envoient de courriel. Les écrire depuis la boîte de soutien (lecture de l'adresse avec le rôle propriétaire).
- **Effacer le texte d'une demande.** Une demande annulée reste lisible par ses parties (titre, description). La masquer (`deleted_at_utc`) n'est pas couvert ici : ses effets sur les paiements et les avis liés n'ont pas été contrôlés.
- **Fichiers dans Stripe ou chez Brevo** : hors de la base, à la main dans chaque console.
- **Annuler un PaymentIntent** : à la main, dans le tableau de bord Stripe (§ e). Le webhook `payment_intent.canceled` est ignoré par l'API : la ligne de paiement reste `FAILED` ou `REQUIRES_ACTION`, c'est attendu.
- **Organisations** : aucune adhésion n'est touchée, et le prestataire d'une organisation n'est pas masqué par la suspension (fonction non utilisée pendant l'essai).

## 9. Banc d'essai

Le 11 novembre 2026, chaque bloc de ce document a été extrait tel quel et exécuté sur une copie jetable de la base de développement (`linkr_moderation_probe`), avec le rôle `linkr_moderation` créé par la section 1. Base et rôle ont été supprimés ensuite. Résultats :

- rôle : lecture de `users.email` et `DELETE` refusés (« permission denied ») ;
- (a) : les deux lectures répondent ;
- (b) : simulation sans effet, validation, seconde validation refusée (0 ligne), identifiant inconnu refusé ;
- (c) : simulation, validation avec `KEY|…`, clé piégée (`portfolio/../x.webp`) sortie en `BADKEY|<id>` ; puis `delete-keys.sh` sur un volume jetable : le fichier de la photo effacé, l'autre fichier intact ;
- (d) : avec une demande `OPEN` comme client, une réservation `OPEN` qui vise le prestataire et une demande `OPEN` d'un tiers : les deux premières annulées, la troisième intacte, la demande `ASSIGNED` listée en `A_TRAITER`, compte et prestataire masqués ; refus d'un ADMIN et d'un `admin_id` qui n'est pas ADMIN ; seconde suspension refusée ; levée refusée tant que l'adresse est reprise, puis acceptée ;
- (e) : refus sur `COMPLETED`, sur un acompte `SUCCEEDED` sans `avec_paiement`, sur un paiement `PENDING` ; annulation d'une demande `OPEN` et d'une demande à acompte `FAILED` ; seconde annulation refusée.

Seconde passe, même jour, après la relecture indépendante (blocs modifiés rejoués sur une nouvelle copie jetable, rôle recréé à partir de la section 1, puis base et rôle supprimés) :

- rôle : lecture de `users.sessions_invalidated_at_utc`, `service_providers.provider_type` et `users.email` refusée ; `payments.stripe_payment_intent_id` lisible ; (a) et (b1) répondent toujours ;
- (d1) : colonne `a_annuler` et échéance du versement automatique affichées ; `attendu` = 3 pour une demande `OPEN` comme client, une réservation `OPEN` et une `DRAFT` visant le prestataire ;
- (d2) : sans `attendu` → refus ; `attendu=2` → refus et rien de modifié ; `attendu=3` → les trois demandes annulées, la demande `OPEN` d'un tiers intacte, `A_TRAITER_URGENT` en tête pour la demande `COMPLETED`, puis `A_TRAITER` ;
- (d3) : sans `registre`, ou avec une autre valeur → refus ; empreinte d'une fermeture → refus, testée séparément par une photo, une carte et une pièce de vérification supprimées au même horodatage que le compte ; sans empreinte → levée ;
- (e2) : acompte `FAILED` avec PaymentIntent → refus ; même cas avec `intent_annule=true` → accepté ; `REQUIRES_ACTION` avec PaymentIntent → refus ; `PENDING` → refus même avec `intent_annule=true` ; `ASSIGNED` acceptée il y a 3 minutes → refus ; `SUCCEEDED` → refus ; identifiant vide → erreur, rien de modifié ; `commit=oui` (valeur non reconnue) → reste une simulation ; `OPEN` → annulée, puis seconde annulation refusée ;
- (c) : les deux commandes d'effacement, jouées dans `node:22-bookworm-slim` avec un `delkeys` factice : `a_supprimer=1` → effacement lancé ; `a_supprimer=0` → arrêt sans effacement ; `STAMP` redéfini → arrêt sans effacement. L'appel réel à `delete-keys.sh` est inchangé depuis la première passe ;
- tous les blocs `bash` : `bash -n` dans `node:22-bookworm-slim`.

Non joué : l'exécution sur le VPS (rôle créé à la main, volume `linkr_uploads` réel).
