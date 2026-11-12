-- Fermeture d'un compte sur demande (droit à l'effacement pendant l'essai).
-- Lancé par deploy/close-account.sh, JAMAIS à la main ni par un agent.
-- Mode d'emploi : docs/deploy/fermeture-compte.md.
--
-- Variables psql obligatoires (posées par le script) :
--   uid      identifiant exact du compte (users.id)
--   closing  false : étape 0, lecture seule (transaction READ ONLY, annulée)
--            true  : étape 1, masquage par UPDATE
--   commit   true seulement avec --execute ; sinon la transaction est ANNULÉE
--
-- ⚠️ CE SCRIPT N'EFFACE RIEN : il MASQUE (suppression douce, sessions
-- invalidées, jetons de réinitialisation consommés). La destruction est faite
-- par la purge de fin d'essai. Les fichiers (photos de portfolio, pièces de
-- vérification) sont supprimés APRÈS le COMMIT, par le script shell, à partir
-- des lignes KEY| écrites ici.
--
-- Sortie lue par le script : lignes « RESULT|… », « PLAN|… », « BLOCK|… »,
-- « KEY|… », « BADKEY|… », « STRIPE|… ». Aucune adresse courriel, aucun nom.

\set ON_ERROR_STOP on
\pset footer off

\if :{?uid}
\else
  \echo RESULT|ERROR|variable uid absente
  \quit
\endif
\if :{?closing}
\else
  \echo RESULT|ERROR|variable closing absente
  \quit
\endif
\if :{?commit}
\else
  \echo RESULT|ERROR|variable commit absente
  \quit
\endif

\if :closing
  BEGIN;
  \set lock_clause 'FOR UPDATE'
\else
  -- Étape 0 : lecture seule, rien ne peut s'écrire.
  BEGIN READ ONLY;
  \set lock_clause ''
\endif
SET LOCAL lock_timeout = '5s';

-- Le compte doit exister, ne pas être déjà fermé, et ne pas être un ADMIN.
-- Agrégat sur une sous-requête : un \gset sur zéro ligne serait une erreur, et
-- FOR UPDATE n'est permis que dans la sous-requête.
SELECT count(*) = 1 AS found,
       coalesce(bool_or(admin), false) AS is_admin
  FROM (SELECT system_role = 'ADMIN' AS admin
          FROM users
         WHERE id = :'uid' AND deleted_at_utc IS NULL
         :lock_clause) s \gset
\if :found
\else
  ROLLBACK;
  \echo RESULT|REFUSED|aucun compte actif ne porte cet identifiant (inconnu ou déjà fermé)
  \quit
\endif
\if :is_admin
  ROLLBACK;
  \echo RESULT|REFUSED|compte administrateur : jamais fermé par ce script
  \quit
\endif

-- ─── Étape 0 : blocages (même requête dans les deux phases) ────────────────
-- Prestataires du compte : TOUS, supprimés compris (une demande peut encore
-- viser un profil déjà supprimé).
SELECT count(*) = 0 AS clear,
       coalesce(string_agg(line, E'\n' ORDER BY line), '') AS blocker_lines
  FROM (
    WITH p AS (SELECT id FROM service_providers WHERE user_id = :'uid')
    -- Demandes non terminées, comme client OU comme prestataire (assigné ou
    -- ciblé). COMPLETED = travail fait, solde pas encore payé.
    SELECT 'BLOCK|service_requests|' || sr.id || '|' || sr.status ||
           CASE WHEN sr.client_user_id = :'uid' THEN ' (client)' ELSE ' (prestataire)' END AS line
      FROM service_requests sr
     WHERE sr.deleted_at_utc IS NULL
       AND sr.status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED')
       AND (sr.client_user_id = :'uid'
            OR sr.assigned_service_provider_id IN (SELECT id FROM p)
            OR sr.requested_service_provider_id IN (SELECT id FROM p))
    UNION ALL
    -- Paiements en cours ou à confirmer (payeur ou bénéficiaire).
    SELECT 'BLOCK|payments|' || pay.id || '|' || pay.status
      FROM payments pay
     WHERE pay.status IN ('PENDING', 'PROCESSING', 'REQUIRES_ACTION')
       AND (pay.payer_user_id = :'uid'
            OR pay.recipient_service_provider_id IN (SELECT id FROM p))
    UNION ALL
    -- Remboursements en cours sur ces paiements.
    SELECT 'BLOCK|refunds|' || r.id || '|' || r.status
      FROM refunds r
      JOIN payments pay ON pay.id = r.payment_id
     WHERE r.status = 'PENDING'
       AND (pay.payer_user_id = :'uid'
            OR pay.recipient_service_provider_id IN (SELECT id FROM p))
    UNION ALL
    -- Devis encore ouvert, envoyé par le prestataire du compte : à retirer d'abord.
    SELECT 'BLOCK|quotes|' || q.id || '|' || q.status
      FROM quotes q
     WHERE q.status = 'SUBMITTED'
       AND q.service_provider_id IN (SELECT id FROM p)
    UNION ALL
    -- Dernier OWNER actif d'une organisation (même règle que DELETE /users/me).
    SELECT 'BLOCK|organization_memberships|' || m.organization_id || '|dernier OWNER actif'
      FROM organization_memberships m
     WHERE m.user_id = :'uid'
       AND m.role = 'OWNER' AND m.is_active = true AND m.left_at_utc IS NULL
       AND (SELECT count(*) FROM organization_memberships m2
             WHERE m2.organization_id = m.organization_id
               AND m2.role = 'OWNER' AND m2.is_active = true AND m2.left_at_utc IS NULL) = 1
  ) b \gset

\if :clear
\else
  ROLLBACK;
  \echo :blocker_lines
  \echo 'RESULT|REFUSED|activité en cours : la terminer ou l''annuler d''abord par l''entremise du soutien'
  \quit
\endif

-- ─── Clés de fichiers, lues AVANT toute écriture, pour CE compte seul ──────
-- Bornées aux photos de portfolio et aux pièces de vérification de SON propre
-- prestataire ; jamais les pièces jointes des demandes (historique de l'autre
-- partie, laissé à la purge de fin d'essai). Une clé dont la forme ne
-- correspond pas EXACTEMENT au préfixe de son propriétaire sort en BADKEY
-- (identifiant de ligne seulement) et n'est jamais supprimée.
\if :closing
  WITH p AS (SELECT id FROM service_providers WHERE user_id = :'uid')
  SELECT CASE
           WHEN pi.storage_key ~ ('^portfolio/' || pi.service_provider_id || '/[0-9a-f-]{36}\.webp$')
             THEN 'KEY|' || pi.storage_key
           ELSE 'BADKEY|portfolio_items|' || pi.id
         END
    FROM portfolio_items pi
   WHERE pi.service_provider_id IN (SELECT id FROM p)
  UNION ALL
  SELECT CASE
           WHEN vd.file_url ~ ('^verifications/' || psc.id || '/[0-9a-f-]{36}(\.[a-z0-9]{1,10})?$')
             THEN 'KEY|' || vd.file_url
           ELSE 'BADKEY|verification_documents|' || vd.id
         END
    FROM verification_documents vd
    JOIN professional_service_categories psc ON psc.id = vd.professional_service_category_id
   WHERE psc.service_provider_id IN (SELECT id FROM (SELECT id FROM service_providers WHERE user_id = :'uid') p2);

  -- Identifiants Stripe (mode test) à supprimer À LA MAIN, un par un.
  SELECT 'STRIPE|customer|' || stripe_customer_id
    FROM users WHERE id = :'uid' AND stripe_customer_id IS NOT NULL
  UNION ALL
  SELECT 'STRIPE|payment_method|' || stripe_payment_method_id
    FROM payment_methods WHERE owner_user_id = :'uid'
  UNION ALL
  SELECT 'STRIPE|connect_account|' || sca.stripe_account_id
    FROM stripe_connect_accounts sca
   WHERE sca.service_provider_id IN (SELECT id FROM service_providers WHERE user_id = :'uid');
\endif

\if :closing
  -- ─── Étape 1 : masquage, par UPDATE seulement ─────────────────────────────
  WITH x AS (
    UPDATE password_reset_tokens SET consumed_at_utc = now()
     WHERE user_id = :'uid' AND consumed_at_utc IS NULL RETURNING 1)
  SELECT count(*) AS n_tokens FROM x \gset

  -- Mandat L1 : les liens de confirmation d'adresse encore valides cessent de servir.
  WITH x AS (
    UPDATE email_verification_tokens SET consumed_at_utc = now()
     WHERE user_id = :'uid' AND consumed_at_utc IS NULL RETURNING 1)
  SELECT count(*) AS n_verif_tokens FROM x \gset

  WITH x AS (
    UPDATE organization_memberships
       SET left_at_utc = now(), is_active = false, updated_at_utc = now()
     WHERE user_id = :'uid' AND left_at_utc IS NULL RETURNING 1)
  SELECT count(*) AS n_memberships FROM x \gset

  WITH x AS (
    UPDATE payment_methods SET deleted_at_utc = now()
     WHERE owner_user_id = :'uid' AND deleted_at_utc IS NULL RETURNING 1)
  SELECT count(*) AS n_cards FROM x \gset

  WITH x AS (
    UPDATE portfolio_items SET deleted_at_utc = now(), updated_at_utc = now()
     WHERE deleted_at_utc IS NULL
       AND service_provider_id IN (SELECT id FROM service_providers WHERE user_id = :'uid')
    RETURNING 1)
  SELECT count(*) AS n_photos FROM x \gset

  WITH x AS (
    UPDATE verification_documents SET deleted_at_utc = now(), updated_at_utc = now()
     WHERE deleted_at_utc IS NULL
       AND professional_service_category_id IN (
         SELECT psc.id FROM professional_service_categories psc
          WHERE psc.service_provider_id IN (SELECT id FROM service_providers WHERE user_id = :'uid'))
    RETURNING 1)
  SELECT count(*) AS n_documents FROM x \gset

  WITH x AS (
    UPDATE service_providers SET deleted_at_utc = now(), updated_at_utc = now()
     WHERE user_id = :'uid' AND deleted_at_utc IS NULL RETURNING 1)
  SELECT count(*) AS n_providers FROM x \gset

  WITH x AS (
    UPDATE users
       SET deleted_at_utc = now(), sessions_invalidated_at_utc = now(), updated_at_utc = now()
     WHERE id = :'uid' AND deleted_at_utc IS NULL RETURNING 1)
  SELECT count(*) = 1 AS users_ok FROM x \gset

  \if :users_ok
  \else
    ROLLBACK;
    \echo 'RESULT|ERROR|le compte n''a pas été masqué (0 ligne) : transaction annulée'
    \quit
  \endif

  \echo PLAN|jetons_reinitialisation|:n_tokens
  \echo PLAN|jetons_confirmation|:n_verif_tokens
  \echo PLAN|adhesions|:n_memberships
  \echo PLAN|cartes|:n_cards
  \echo PLAN|photos_portfolio|:n_photos
  \echo PLAN|pieces_verification|:n_documents
  \echo PLAN|prestataires|:n_providers
  \echo PLAN|compte|1

  \if :commit
    COMMIT;
    \echo RESULT|COMMITTED
  \else
    ROLLBACK;
    \echo RESULT|ROLLED_BACK
  \endif
\else
  ROLLBACK;
  \echo RESULT|CHECKED
\endif
