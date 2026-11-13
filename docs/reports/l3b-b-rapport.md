# Rapport L3b-B — `POST /payment-methods/setup-intent` exige une adresse confirmée

Branche `feat/l3b-setup-intent`, depuis `main` à `43337d5` (autorisation mergée en #194). Aucune migration.

## Étape 0
- Autorisation L3b-B présente dans `CLAUDE.md` §11 (texte et date du 13 novembre 2026), mergée avant ce travail.
- Lignes de départ : `createSetupIntent` à `payment-methods.controller.ts:68` (le rapport L3b citait :60) ; l'appel `fetch('/api/payment-methods/setup-intent')` à `add-card-section.tsx:94` (le rapport citait :101).
- Aucune condition d'arrêt rencontrée : seul `payment-methods.controller.ts` est touché sous `payments`.

## Changements
- Contrôleur : `@RequireVerifiedEmail()` + `@ApiResponse` 403, même ordre que `POST /payment-methods`.
- Web : `setupIntentErrorMessage` (`lib/email-verification/states.ts`) ; `add-card-section.tsx` l'utilise. 403 `EMAIL_NOT_VERIFIED` → message dédié ; 403 sans code → message d'origine ; 401 inchangé.
- Tests : `require-verified-email.spec.ts` (19 routes gardées, exception « À trancher » retirée), `payment-methods.setup-intent.spec.ts` (vrai service, Stripe simulé), `setup-intent-message.test.mjs`.
- Contrat régénéré : +3 / +7 lignes, un seul 403.
- `CLAUDE.md` : dette §6 soldée (la ligne suivante est inchangée), entrée §11 L3b-B, §13 nº 24.

## Vérifications
- jest complet : 923/923. Tests web : 304/304. Typecheck web vert. Build API vert. Garde miroir verte.
- Mutation : retirer le décorateur fait rougir 3 tests (2 du nouveau spec, 1 de classification).
- Non joué ici : smoke humain, lint, `next build`, CI.

## Smoke humain (dev)
1. Compte NON confirmé → « Ajouter une carte » : message « Confirmez votre adresse courriel… », aucun nouvel objet côté Stripe.
2. Compte confirmé → le formulaire s'ouvre ; carte `4242…` puis `3184` (le défi 3D Secure fonctionne toujours).
3. Ne jamais utiliser « Supprimer toutes les données de test » dans Stripe (bac à sable partagé).

Aucun autre fichier sous arrêt dur modifié.
