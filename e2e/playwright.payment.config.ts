import { defineConfig } from '@playwright/test';

// Importer la configuration de base charge e2e/.env.e2e et valide E2E_BASE_URL.
import base, { PAYMENT_SPEC } from './playwright.config';

/**
 * Configuration du SEUL parcours de paiement (`pnpm test:paiement`).
 *
 * Consentement explicite : sans E2E_ALLOW_PAYMENT=1, la configuration refuse de
 * se charger. Rien n'est lancé, aucun navigateur, aucune requête vers l'essai.
 */
if (process.env.E2E_ALLOW_PAYMENT !== '1') {
  throw new Error(
    'PARCOURS DE PAIEMENT REFUSÉ : E2E_ALLOW_PAYMENT doit valoir « 1 ». Ce parcours enregistre une ' +
      'carte de test, crée une demande et déclenche deux prélèvements Stripe en mode test sur l’essai. ' +
      'Voir docs/deploy/tests-fumee.md, section « Parcours de paiement ».',
  );
}

export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: PAYMENT_SPEC,
  // Un parcours chaîné de bout en bout (carte, demande, acompte, exécution, solde,
  // webhook) : bien plus long qu'un test de fumée.
  timeout: 6 * 60_000,
  // Jamais de relance automatique : une relance créerait une seconde demande.
  retries: 0,
});
