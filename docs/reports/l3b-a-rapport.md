# L3b-A — rapport

Branche `feat/l3b-classement-routes`, depuis `main` `b43cbac`. Zéro migration, aucun fichier `payments/**`.

## Les 21 routes
**Gardées (7)** : `POST /reviews/:id/response`, `POST /service-requests/:id/attachments`, `POST /service-providers/:id/zones`, `POST /service-items/suggest`, `POST /organizations`, `POST /organizations/:orgId/members`, `PUT /organizations/:orgId/members/:membershipId/role`.
**Libres, « Own » (10)** : `DELETE …/attachments/:attachmentId`, `PATCH /service-providers/:id`, `PATCH …/zones/:zoneId`, `PATCH …/categories/:pscId`, `PATCH …/services/:serviceId`, `PUT …/me/portfolio/order`, `PATCH …/me/portfolio/:itemId`, `PATCH /organizations/:id`, `DELETE /organizations/:id`, `DELETE …/members/:membershipId`.
**Libre, D-L3b-2 (1)** : `POST /demand-signals`. **Libres, N2 étendue (2)** : les deux `…/accept` (D-L3b-1).
**Inchangée (1)** : `POST /payment-methods/setup-intent` (exception temporaire, L3b-B).

## Étape 0
1. Les 21 routes correspondent au rapport.
2. « Appelant » du plafond de `POST /demand-signals` = le compte (`user:<sub>`) ; écrit en dette.
3. Routes de membres : `OrganizationRoleGuard` (classe) passe avant `EmailVerifiedGuard` (méthode). Ailleurs la garde de méthode précède le service.

## Preuves
Jest 921/921 ; `node --test` web 301/301 ; typecheck web vert. Mutation : décorateur de `POST /organizations` retiré → 2 tests du classement rouges (restauré).

## Smoke humain
Compte NON confirmé (jeton valide) :
```bash
curl -s -X POST http://localhost:5000/organizations -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
```
Attendu : 403, `code: EMAIL_NOT_VERIFIED`. Page « Avis reçus » : répondre à un avis affiche le message dédié. Compte confirmé : rien ne change (400 de validation sur le corps vide).
