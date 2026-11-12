# HANDOFF — 12 novembre 2026 → réouverture des inscriptions

Suite de `HANDOFF_2026-11-11_AVANT_POST.md`, dont les dettes restent valables sauf mention contraire.

**État de `main`** : `79f5741` (#188). **Déployé en production le 2026-11-11 à 20 h 10 (heure de Toronto) : `6ea8ae40ce9507da2d830d37923771f463027254`** (#187).
**Site** : https://linkrapp.com (version d'essai, mode test Stripe).

---

## 1. État

PR fusionnées depuis le handoff du 11 novembre :

| PR | Commit | Contenu |
|---|---|---|
| #185 | `030c3fb` | Handoff du 11 novembre. |
| #186 | `07af5a3` | Vérification de l'adresse courriel, côté API (L1). |
| #187 | `6ea8ae4` | Vérification de l'adresse courriel, côté web (L2). |
| #188 | `79f5741` | Décision sur le suivi des clics Brevo. |

Inscriptions rouvertes le soir du 2026-11-11 : `flags/` vide, `/signup` répond 200.

## 2. Fait à la main sur le VPS

- Copie de `deploy/close-account/`, `purge.sh` et `compose.yaml`.
- Migration `CreateEmailVerificationTokens1780560000000` appliquée.
- Deux `GRANT` sur `email_verification_tokens` pour `linkr_purge`.
- Simulation de purge normale : comptes e2e fixes gardés, aucune suppression de compte.
- Comptes e2e client et prestataire confirmés par le courriel de vérification.
- `pnpm test` 6/6 et `test:paiement` verts après la réouverture.
- Premier soir : journaux de l'API sans erreur ni WARN.

## 3. Comportement actuel

- Courriel de vérification à l'inscription : essentiel, plafond 40 par jour (jour de Toronto).
- Renvoi : 3/h et 5/jour par utilisateur, plafond 20 par jour.
- 200 courriels non essentiels par jour ; marge de 40 pour les essentiels non plafonnés, sur les 300 envois de Brevo (remise à zéro à minuit, heure de l'Est).
- Au plafond d'inscription : 503, aucun compte créé, « inscriptions saturées, réessayez demain ».
- Bandeau « Confirmez votre adresse » pour tout compte non confirmé.
- **Aucune garde ne bloque encore un compte non confirmé** (L3 non faite). Les ~38 comptes créés avant L1 restent non confirmés, sans vérification rétroactive.

## 4. Décisions

- Post LinkedIn publié le 2026-11-03.
- Aucun avis aux inscrits pour la version légale 2026-11-11 : décision d'exploitation, à rouvrir avec l'avis juridique. `CLAUDE.md` §13 nº 22 reste la règle écrite.
- Suivi des clics Brevo accepté pour l'essai : les liens de vérification et de réinitialisation passent par un redirecteur de Brevo, aucun réglage du plan ne le coupe.
- Bac à sable Stripe partagé avec le développement, clé partagée (la clé restreinte de Bitwarden n'est **pas** dans `api.env`).
- Aucun texte légal modifié pour la vérification d'adresse (politique lignes ~19 et ~37 : peut-être du fond, à trancher avec l'avis juridique).

## 5. Procédures

- Fermer les inscriptions en urgence : `touch /opt/linkr/flags/signups-closed` (`rm` pour rouvrir).
- Plafond atteint : `DEL` de la clé Redis du jour, **jamais `FLUSHDB`** (`docs/deploy/arret-urgence.md`).
- Modération SQL : `docs/deploy/moderation-sql.md`.
- `deploy/close-account/close-account.sql` est à recopier **après** toute migration qui touche une table liée aux utilisateurs.

## 6. Dettes (sans doublon avec le handoff du 11 novembre)

- L3 : garde sur les actions envers des tiers.
- PR webhook Connect (`account.updated`).
- Purge de fin d'essai (mode B) ; étape 1 = extraire la liste Stripe.
- Anonymisation (mode C) avant la production.
- Couper le suivi des clics Brevo.
- Clé Stripe distincte pour la production.
- Relecture des formulations Brevo par une personne (politique §5, ÉFVP §4).
- Avis juridique : textes, ligne 57 de la politique, avis aux inscrits.
- Casse des adresses (inscription vs réinitialisation).
- OAuth : ne relier qu'une adresse locale confirmée.
- Jeton de réinitialisation sans adresse figée.
- 503 du renvoi et de l'inscription jamais déclenchés sur une vraie API.
- `deploy/tests/` absent de la CI.
- Lint API : pas d'`eslint.config`.
- Deux anciens runs CI de #186 restés en file d'attente chez GitHub (non annulés).
- Worktrees `Linkr-f1` et `Linkr-f2` : `Permission denied` à la suppression.
- Compteurs de débit par processus : une seule instance de l'API.

## 7. Surveillance

- Brevo : envois du jour sur 300.
- Journaux de l'API : `PERMANENTLY FAILED`, WARN de budget à 80 %.
- Bloc (a) de `moderation-sql.md`.
- Un rejet Brevo observé le soir du 11 novembre : cause à vérifier dans les journaux Brevo.

## 8. Ordre suggéré pour la prochaine session

1. Lire les 24 premières heures de données.
2. Décider de L3 et de la vérification rétroactive.
3. Relecture Brevo et avis juridique.
4. PR webhook.
5. Purge de fin d'essai.

Ne pas annoncer de fin d'essai tant que la purge de fin d'essai n'est pas écrite et répétée.
