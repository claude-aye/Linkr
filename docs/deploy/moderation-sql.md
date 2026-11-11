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
GRANT SELECT (id, system_role, created_at_utc, deleted_at_utc, sessions_invalidated_at_utc) ON users TO linkr_moderation;
GRANT UPDATE (deleted_at_utc, sessions_invalidated_at_utc, updated_at_utc) ON users TO linkr_moderation;
GRANT SELECT (id, user_id, provider_type, is_active, created_at_utc, deleted_at_utc) ON service_providers TO linkr_moderation;
GRANT UPDATE (deleted_at_utc, updated_at_utc) ON service_providers TO linkr_moderation;
GRANT SELECT (id, service_provider_id, author_user_id, service_request_id, rating, comment, provider_response, created_at_utc, deleted_at_utc) ON reviews TO linkr_moderation;
GRANT UPDATE (deleted_at_utc, updated_at_utc) ON reviews TO linkr_moderation;
GRANT SELECT (id, service_provider_id, storage_key, caption, created_at_utc, deleted_at_utc) ON portfolio_items TO linkr_moderation;
GRANT UPDATE (deleted_at_utc, updated_at_utc) ON portfolio_items TO linkr_moderation;
GRANT SELECT (id, client_user_id, request_type, status, assigned_service_provider_id, requested_service_provider_id, created_at_utc, deleted_at_utc) ON service_requests TO linkr_moderation;
GRANT UPDATE (status, cancelled_at_utc, cancellation_reason, cancelled_by_user_id, updated_at_utc) ON service_requests TO linkr_moderation;
GRANT SELECT (id, service_request_id, payment_type, status, payer_user_id, recipient_service_provider_id) ON payments TO linkr_moderation;
GRANT SELECT (id, service_request_id, service_provider_id, status) ON quotes TO linkr_moderation;
SQL
```

Contrôle : `\dp users` (avec le rôle propriétaire) doit montrer ces seules colonnes pour `linkr_moderation`. Le rôle n'a aucun droit `INSERT` ni `DELETE`.

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
grep '^KEY|' "moderation-out/$STAMP-photo.txt" | cut -d'|' -f2 > "moderation-out/$STAMP-keys.txt"
chmod 600 "moderation-out/$STAMP-keys.txt"
for MODE in --dry-run --delete; do
  docker run --rm --network none --read-only --cap-drop ALL \
    --security-opt no-new-privileges --user 1000:1000 \
    -v linkr_uploads:/data \
    -v "$PWD/moderation-out/$STAMP-keys.txt:/keys.txt:ro" \
    -v "$PWD/close-account/delete-keys.sh:/delete-keys.sh:ro" \
    alpine:3.20 sh /delete-keys.sh /keys.txt /data "$MODE"
done
```

Attendu : `SUMMARY|lignes=1|a_supprimer=1|…|supprimes=0|…` en simulation, puis `…|supprimes=1|echecs=0`. Ensuite `shred -u moderation-out/$STAMP-*`.

- Une ligne `BADKEY|<id>` : la clé n'a pas la forme attendue. Le fichier reste. Le noter au registre, ne jamais effacer à la main.
- `delete-keys.sh` refuse aussi les liens symboliques et tout autre préfixe.
- Le fichier reste dans les sauvegardes des 14 derniers jours.

Registre : `photo-retiree`, `portfolio_items.id`, 1 ligne, fichier effacé (oui ou non), motif.

## 5. (d) Suspendre un compte, même avec des demandes ouvertes

À la différence de [fermeture-compte.md](fermeture-compte.md), qui refuse tant qu'une activité est en cours, la suspension s'applique **tout de suite**. Elle masque le compte, sans rien détruire, et elle est réversible (§ d3).

Effet, dans une seule transaction :

- `users.deleted_at_utc` et `sessions_invalidated_at_utc` à maintenant : la connexion est refusée (le compte n'est plus trouvé) et le rafraîchissement aussi (401). ⚠️ Un jeton d'accès déjà émis reste valable **jusqu'à 15 minutes** (il n'est pas contrôlé en base).
- son prestataire est supprimé en douceur : absent de la recherche et des appels d'offres, profil et photos en 404, ses devis ouverts ne peuvent plus être acceptés.
- ses demandes `DRAFT` ou `OPEN` **comme client**, et les réservations `OPEN` qui **visent son prestataire**, passent `CANCELLED`. Sans cela, un prestataire pourrait encore accepter une demande du compte suspendu et prélever un acompte sur sa carte enregistrée.

Les demandes `ASSIGNED`, `IN_PROGRESS` et `COMPLETED` ne sont **pas** touchées : elles portent de l'argent. Le bloc les liste (`A_TRAITER|…`), avec les paiements en cours. Chacune se traite ensuite à part (§ e, et la section 8).

### (d1) Simulation : ce qui serait touché

```bash
modsql -v uid=<users.id> <<'SQL'
-- (d1) activité du compte
WITH p AS (SELECT id FROM service_providers WHERE user_id = :'uid')
SELECT 'demande' AS quoi, sr.id, sr.status::text AS statut,
       CASE WHEN sr.client_user_id = :'uid' THEN 'client' ELSE 'prestataire' END AS role
  FROM service_requests sr
 WHERE sr.deleted_at_utc IS NULL
   AND sr.status IN ('DRAFT', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED')
   AND (sr.client_user_id = :'uid'
        OR sr.assigned_service_provider_id IN (SELECT id FROM p)
        OR sr.requested_service_provider_id IN (SELECT id FROM p))
UNION ALL
SELECT 'paiement', pay.id, pay.status::text, pay.payment_type::text
  FROM payments pay
 WHERE pay.status IN ('PENDING', 'PROCESSING', 'REQUIRES_ACTION')
   AND (pay.payer_user_id = :'uid' OR pay.recipient_service_provider_id IN (SELECT id FROM p))
UNION ALL
SELECT 'devis ouvert', q.id, q.status::text, 'prestataire'
  FROM quotes q
 WHERE q.status = 'SUBMITTED' AND q.service_provider_id IN (SELECT id FROM p)
ORDER BY 1, 3;
SQL
```

### (d2) Suspendre (simulation, puis `-v commit=true`)

```bash
modsql -v uid=<users.id> -v admin_id=<users.id de l'exploitant> -v commit=false <<'SQL'
-- (d2) suspendre un compte
\if :{?commit} \else \set commit false \endif
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
  UPDATE service_requests
     SET status = 'CANCELLED', cancelled_at_utc = now(),
         cancellation_reason = 'Annulée par le soutien de Linkr.',
         cancelled_by_user_id = :'admin_id', updated_at_utc = now()
   WHERE deleted_at_utc IS NULL
     AND ((client_user_id = :'uid' AND status IN ('DRAFT', 'OPEN'))
          OR (requested_service_provider_id IN (SELECT id FROM p) AND status = 'OPEN'))
  RETURNING 1)
SELECT count(*) AS n_demandes FROM x \gset

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
-- Ce qui reste à traiter à la main (argent en jeu).
WITH p AS (SELECT id FROM service_providers WHERE user_id = :'uid')
SELECT 'A_TRAITER|demande|' || sr.id || '|' || sr.status AS a_traiter
  FROM service_requests sr
 WHERE sr.deleted_at_utc IS NULL
   AND sr.status IN ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED')
   AND (sr.client_user_id = :'uid' OR sr.assigned_service_provider_id IN (SELECT id FROM p))
UNION ALL
SELECT 'A_TRAITER|paiement|' || pay.id || '|' || pay.status
  FROM payments pay
 WHERE pay.status IN ('PENDING', 'PROCESSING', 'REQUIRES_ACTION')
   AND (pay.payer_user_id = :'uid' OR pay.recipient_service_provider_id IN (SELECT id FROM p));

\if :commit
  COMMIT;
  \echo 'VALIDÉ : compte suspendu.'
\else
  ROLLBACK;
  \echo 'SIMULATION : rien n''est modifié. Relancer avec -v commit=true.'
\endif
SQL
```

Le nombre de demandes annulées affiché en simulation doit être celui de § d1 (lignes `DRAFT`/`OPEN`). Sinon, ne pas valider : quelque chose a changé entre-temps.

Registre : `compte-suspendu`, `users.id`, demandes annulées (identifiants, depuis § d1), prestataire masqué (0 ou 1), lignes `A_TRAITER`, motif.

### (d3) Lever la suspension

Rétablit le compte et le prestataire masqués **par la même transaction** (même horodatage). Les demandes annulées ne sont **pas** rouvertes.

```bash
modsql -v uid=<users.id> -v commit=false <<'SQL'
-- (d3) lever une suspension
\if :{?commit} \else \set commit false \endif
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
- Un compte fermé par [fermeture-compte.md](fermeture-compte.md) ne doit **jamais** être rétabli ici : ses photos et pièces sont effacées. Ce bloc ne distingue pas les deux ; le registre, si.

Registre : `suspension-levee`, `users.id`, motif.

## 6. (e) Annuler une demande abusive

Même effet que l'annulation par l'API (`POST /service-requests/:id/cancel`) : statut `CANCELLED`, date, motif, auteur. Permis depuis `DRAFT`, `OPEN`, `ASSIGNED` et `IN_PROGRESS` (machine à états). Les devis, l'assignation et les paiements ne sont pas touchés, comme par l'API.

Simulation :

```bash
modsql -v id=<service_requests.id> <<'SQL'
-- (e1) état d'une demande
SELECT sr.id, sr.request_type, sr.status, sr.created_at_utc, sr.deleted_at_utc IS NOT NULL AS masquee,
       (SELECT string_agg(pay.payment_type || ':' || pay.status, ', ')
          FROM payments pay WHERE pay.service_request_id = sr.id) AS paiements,
       (SELECT count(*) FROM quotes q WHERE q.service_request_id = sr.id AND q.status = 'SUBMITTED') AS devis_ouverts
  FROM service_requests sr
 WHERE sr.id = :'id';
SQL
```

Annuler (simulation, puis `-v commit=true`). Le bloc refuse si un paiement est en cours (`PENDING`, `PROCESSING`, `REQUIRES_ACTION`). Si un acompte est déjà prélevé (`SUCCEEDED`), il refuse aussi, sauf avec `-v avec_paiement=true` : l'annulation ne rembourse rien (section 8).

```bash
modsql -v id=<service_requests.id> -v admin_id=<users.id de l'exploitant> -v commit=false <<'SQL'
-- (e2) annuler une demande
\if :{?commit} \else \set commit false \endif
\if :{?avec_paiement} \else \set avec_paiement false \endif
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT count(*) = 1 AS found,
       coalesce(bool_or(status IN ('DRAFT', 'OPEN', 'ASSIGNED', 'IN_PROGRESS')), false) AS annulable
  FROM (SELECT status FROM service_requests
         WHERE id = :'id' AND deleted_at_utc IS NULL FOR UPDATE) s \gset
SELECT count(*) = 1 AS admin_ok FROM users
 WHERE id = :'admin_id' AND system_role = 'ADMIN' AND deleted_at_utc IS NULL \gset
SELECT count(*) FILTER (WHERE status IN ('PENDING', 'PROCESSING', 'REQUIRES_ACTION')) = 0 AS rien_en_cours,
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
\if :rien_en_cours
\else
  ROLLBACK;
  \echo 'ANNULÉ : un paiement est en cours. Attendre son issue.'
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

Registre : `demande-annulee`, `service_requests.id`, statut avant, paiement prélevé (oui ou non), motif.

## 7. Registre

Le même fichier que pour les fermetures de compte : hors du dépôt, `chmod 600`, sur le poste de l'exploitant. Une ligne par action :

```
2026-11-11T14:05Z | avis-retire | reviews.id=<uuid> | 1 ligne | motif=contenu-injurieux | signalement=<n° de fil de soutien>
```

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
- **Organisations** : aucune adhésion n'est touchée (fonction non utilisée pendant l'essai).

## 9. Banc d'essai

Le 11 novembre 2026, chaque bloc de ce document a été extrait tel quel et exécuté sur une copie jetable de la base de développement (`linkr_moderation_probe`), avec le rôle `linkr_moderation` créé par la section 1. Base et rôle ont été supprimés ensuite. Résultats :

- rôle : lecture de `users.email` et `DELETE` refusés (« permission denied ») ;
- (a) : les deux lectures répondent ;
- (b) : simulation sans effet, validation, seconde validation refusée (0 ligne), identifiant inconnu refusé ;
- (c) : simulation, validation avec `KEY|…`, clé piégée (`portfolio/../x.webp`) sortie en `BADKEY|<id>` ; puis `delete-keys.sh` sur un volume jetable : le fichier de la photo effacé, l'autre fichier intact ;
- (d) : avec une demande `OPEN` comme client, une réservation `OPEN` qui vise le prestataire et une demande `OPEN` d'un tiers : les deux premières annulées, la troisième intacte, la demande `ASSIGNED` listée en `A_TRAITER`, compte et prestataire masqués ; refus d'un ADMIN et d'un `admin_id` qui n'est pas ADMIN ; seconde suspension refusée ; levée refusée tant que l'adresse est reprise, puis acceptée ;
- (e) : refus sur `COMPLETED`, sur un acompte `SUCCEEDED` sans `avec_paiement`, sur un paiement `PENDING` ; annulation d'une demande `OPEN` et d'une demande à acompte `FAILED` ; seconde annulation refusée.

Non joué : l'exécution sur le VPS (rôle créé à la main, volume `linkr_uploads` réel).
