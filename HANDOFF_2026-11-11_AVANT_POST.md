# HANDOFF — 11 novembre 2026 (fin de séance) → avant la publication du post

Séance du 5 au 11 novembre : durcissement de la version d'essai avant d'inviter des testeurs (limites de débit, courriels, arrêt d'urgence, modération, marquage Stripe, révision légale).
Suite de `HANDOFF_2026-11-01_FIN.md`, dont les dettes (§6) restent valables sauf mention contraire ci-dessous.

**État de `main`** : `e6fa90e` (#184). **Déployé en production le 2026-11-11 : `e6fa90ed3339a38f23f4ecf33349e80e03b982be`.**
**Site en ligne : https://linkrapp.com** (version d'essai, mode test Stripe).

---

## 1. Livré (PR fusionnées depuis le 5 novembre)

| PR | Commit | Contenu |
|---|---|---|
| #173 | `5caf1f2` | Limite de débit et longueur sur la création de demande (20/h par utilisateur, description ≤ 5000). |
| #174 | `dfda3ce` | Courriels sans texte libre d'un autre compte. |
| #175 | `05398c2` | Inscription : seuil de 10/h à **20/h par IP**. |
| #176 | `4f78335` | Garde miroir : retrait de la constante orpheline `REASON_MAX_CHARS`. |
| #177 | `52c18a7` | Budget quotidien des courriels : **200/jour pour les non essentiels** (jour de Toronto), essentiels prioritaires (réinitialisation, échecs d'acompte et de solde). |
| #178 | `6f6b968` | Arrêt d'urgence Caddy : drapeaux fichier `flags/signups-closed` et `flags/maintenance`. |
| #179 | `ceb4a19` | Prestataire e2e placé à l'aéroport, rayon 1 km (hors de la recherche publique). |
| #180 | `a40e0cd` | Page publique « Guide du testeur ». |
| #181 | `c22d2ba` | Rappel « données de test » aux écrans de paiement et d'onboarding Stripe. |
| #182 | `4f3b341` | Révision de la politique, des conditions et de l'ÉFVP. **`LEGAL_VERSION` et `CURRENT_TERMS_VERSION` = `2026-11-11`** (le titre de la PR dit encore `2026-11-07` ; la valeur dans le code est `2026-11-11`). |
| #183 | `b456952` | Procédures SQL manuelles de modération (`docs/deploy/moderation-sql.md`). |
| #184 | `e6fa90e` | Marquage `metadata.linkr_env` des objets Stripe (`STRIPE_ENV_LABEL`). |

(Avant la séance, mêmes jours : #170 à #172, déjà mergées le 4 et 5 novembre.)

---

## 2. Fait à la main le 11 novembre

- `STRIPE_ENV_LABEL=trial` posé dans `api.env`.
- `Caddyfile` et `compose.yaml` recopiés sur le VPS ; dossier `flags` créé.
- Drapeaux testés : **503 / 200 / 503 / 200** (fermeture des inscriptions, réouverture, maintenance, réouverture).
- SQL du prestataire e2e appliqué (`docs/deploy/migration-prestataire-e2e.md`).
- Rôle `linkr_moderation` créé.
- `pg_hba.conf` contrôlé : **aucun `trust` sur le réseau**.
- Destination du webhook Stripe alignée sur le code : **6 événements** (`account.updated`, `charge.refunded`, `payment_intent.payment_failed`, `payment_intent.processing`, `payment_intent.succeeded`, `refund.updated`) ; `payment_intent.canceled` retiré.
- Tests de fumée **6/6** et `test:paiement` **verts en production**.

---

## 2 bis. Situation après le post (ajout du 11 novembre)

- **Le post LinkedIn a été publié le 2026-11-03**, avec le texte du brouillon du §10 du handoff du 5 novembre. L'affirmation « adresse non partagée » de ce handoff est **périmée**.
- Environ **38 comptes** créés depuis le 2026-11-08, au rythme de 1 à 2 par heure, **sans aucune activité applicative** (0 profil prestataire, 0 demande, 0 avis, 0 photo).
- Au moins une dizaine d'adresses externes ont reçu un courriel de réinitialisation entre le 9 et le 11 novembre (Brevo), et au moins un lien a été cliqué : il s'agit très probablement de vraies personnes. Aucun autre type de courriel n'est parti vers elles.
- **Inscriptions fermées le 2026-11-11** (`flags/signups-closed` posé sur le VPS, `/signup` répond 503). **Rien n'a été supprimé.** Réouverture seulement sur décision explicite, après les PR de vérification d'adresse (mandat L, niveau N2 : L1 API et migration, L2 web, L3 garde sur les actions envers des tiers).
- **Décision d'exploitation du 2026-11-11** : aucun avis n'est envoyé aux inscrits pour la version légale 2026-11-11 (phase de test). C'est une décision d'exploitation, pas un avis juridique. `CLAUDE.md` §13 nº 22 reste la règle écrite : à rouvrir avec l'avis juridique avant la production.

---

## 3. Décisions

- **Bac à sable Stripe PARTAGÉ avec le développement.** Stripe refuse un second bac à sable sans vérification d'entreprise. Nettoyage de fin d'essai **par identifiants listés**, jamais « Supprimer toutes les données de test ».
- **La production utilise la MÊME clé Stripe que le développement.** La clé restreinte `linkr-prod-trial` existe dans Bitwarden mais **n'est PAS dans `api.env`** (un compte rendu antérieur disait le contraire : c'était faux). Ne l'utiliser qu'après vérification de ses droits en écriture (comptes Connect, liens de compte, remboursements, transferts) **et** un `test:paiement` complet.
- **Risque H1 accepté pour l'essai** (accès limité à l'exploitant) : **à ajouter à l'ÉFVP.**
- **Confirmation de l'adresse courriel** : chantier complet **après le post**, en tête de liste.
- **Brevo** : plan à 300 envois/jour, remise à zéro à minuit, heure de l'Est.

---

## 4. Procédures et documents

- `docs/deploy/arret-urgence.md`
- `docs/deploy/moderation-sql.md`
- `docs/deploy/migration-prestataire-e2e.md`
- `docs/deploy/purge.md`
- `docs/deploy/fermeture-compte.md`

---

## 5. Dettes ouvertes

**Paiement et webhooks**
- **PR webhook** : seconde destination Connect pour `account.updated` (M1). Tant qu'elle n'existe pas, un prestataire qui quitte Stripe sans passer par la page de retour reste bloqué en 409. Ajouter un bouton « Vérifier de nouveau ».

**Fin d'essai et production**
- **Purge de fin d'essai (mode B)** : étape 1 = **extraire la liste Stripe de la base AVANT toute destruction**.
- **Anonymisation codée (mode C)** : condition ferme avant la production.

**Limites et surveillance**
- Limite de débit de `/geocode`.
- Surveillance externe et alerte.
- Limite d'envoi des photos de portfolio.
- Compteur de débit **par processus** : une seule instance de l'API.
- Remise à zéro Brevo en heure d'été (le jour de budget suit `America/Toronto`, à revérifier au changement d'heure).

**Journaux**
- Filtrage : jeton de `reset-password` et `lat`/`lng` dans les erreurs Caddy ; `Key (email)=(…)` dans PostgreSQL.

**Authentification**
- L'inscription ne met pas l'adresse en minuscules, alors que la réinitialisation la met en minuscules : un compte inscrit avec une majuscule ne peut jamais réinitialiser son mot de passe.
- OAuth Google/Apple : ne relier un compte que si l'adresse locale est vérifiée.

**Exploitation et CI**
- Nettoyage des anciennes images Docker.
- `deploy/tests/` absent de la CI.
- Lint de l'API (`eslint.config`).
- Worktrees `Linkr-f1` et `Linkr-f2` (Permission denied).

**Code et textes**
- Commentaire faux dans `decline-request-action.tsx`, lignes 45 à 49.
- Relecture des formulations Brevo par une personne (politique §5, ÉFVP §4).
- Ligne 57 de la politique (« tenus par contrat ») contre la case OVH non cochée.
- Garde-fous de modération : limites de (d) (prestataire d'organisation, avis et devis du suspendu).

---

## 6. Avant de rouvrir les inscriptions (dans cet ordre)

1. Contrôles de fin de déploiement : droits de `linkr_moderation`, SHA déployé, `linkr_env=trial` visible dans Stripe.
2. Vérification d'adresse (mandat L, niveau N2) : L1 API et migration, L2 web, L3 garde sur les actions envers des tiers.
3. Relecture Brevo (formulations de la politique et de l'ÉFVP).
4. Décision explicite de réouverture des inscriptions.
5. **Ne pas annoncer de fin d'essai** tant que la purge de fin d'essai n'est pas écrite **et répétée**.
