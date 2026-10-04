// Tests du bandeau « Acompte à confirmer » (`/account/payment-methods`).
//
// Même banc que les autres : runner natif de Node, sans dépendance —
// `pnpm --filter @linkr/web test`. Les messages sont écrits en toutes lettres :
// ce sont eux que le client lit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONFIRMATION_FAILED_MESSAGE,
  UNEXPECTED_MESSAGE,
  formatDepositAmount,
  isSettledIntentStatus,
  prepareErrorMessage,
} from './deposit-confirmation.ts';

test('401 : session expirée', () => {
  assert.equal(prepareErrorMessage(401), 'Votre session a expiré. Veuillez vous reconnecter.');
});

test('403 et 404 : même message, le paiement n\'est plus accessible', () => {
  assert.equal(prepareErrorMessage(403), "Ce paiement n'est plus accessible depuis votre compte.");
  assert.equal(prepareErrorMessage(404), prepareErrorMessage(403));
});

test('409 : rien à confirmer, la page va être actualisée', () => {
  assert.equal(
    prepareErrorMessage(409),
    "Ce paiement n'est plus à confirmer ici. La page va être actualisée.",
  );
});

test('422 : aucune carte par défaut — le message dit QUOI faire, distinct du 409', () => {
  assert.equal(
    prepareErrorMessage(422),
    'Enregistrez une carte par défaut ci-dessous, puis confirmez le paiement.',
  );
  assert.notEqual(prepareErrorMessage(422), prepareErrorMessage(409));
});

test('502 : service de paiement indisponible', () => {
  assert.equal(
    prepareErrorMessage(502),
    'Le service de paiement est momentanément indisponible. Veuillez réessayer dans quelques minutes.',
  );
});

test('tout autre statut : repli générique', () => {
  for (const status of [0, 400, 500, 503]) {
    assert.equal(prepareErrorMessage(status), UNEXPECTED_MESSAGE);
  }
});

test('aucun message ne tutoie, aucun ne cite Stripe', () => {
  const all = [401, 403, 404, 409, 422, 502, 500].map(prepareErrorMessage).concat(CONFIRMATION_FAILED_MESSAGE);
  for (const m of all) {
    assert.doesNotMatch(m, /\b(tu|ton|ta|tes|réessaie)\b/i);
    assert.doesNotMatch(m, /stripe/i);
  }
});

test('statuts réglés : succeeded, processing, requires_capture', () => {
  for (const s of ['succeeded', 'processing', 'requires_capture']) {
    assert.equal(isSettledIntentStatus(s), true, s);
  }
});

test('statuts NON réglés : le client n\'a pas payé', () => {
  for (const s of ['requires_action', 'requires_payment_method', 'requires_confirmation', 'canceled', undefined, null, '']) {
    assert.equal(isSettledIntentStatus(s), false, String(s));
  }
});

test('montant en fr-CA', () => {
  // Espace insécable fine avant le symbole : comparer après normalisation.
  assert.equal(formatDepositAmount('30.00', 'CAD').replace(/\s/g, ' '), '30,00 $');
});

test('devise inconnue ou montant illisible : la paire brute, rien d\'inventé', () => {
  assert.equal(formatDepositAmount('30.00', 'ZZZZ'), '30.00 ZZZZ');
  assert.equal(formatDepositAmount('abc', 'CAD'), 'abc CAD');
});
