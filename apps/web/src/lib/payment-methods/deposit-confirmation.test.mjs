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

// --- Le solde (lot « solde 3D Secure ») -------------------------------------

import {
  BALANCE_AWAITING_REDIRECT,
  awaitingAmountLabel,
  awaitingExplanation,
  awaitingSectionTitle,
  balanceRedirectBanner,
  confirmationEndpoint,
} from './deposit-confirmation.ts';

const ID = '55555555-5555-4555-8555-555555555555';

test('le bouton appelle le BON endpoint selon paymentType', () => {
  assert.equal(
    confirmationEndpoint(ID, 'DEPOSIT'),
    `/api/service-requests/${ID}/deposit-confirmation`,
  );
  assert.equal(
    confirmationEndpoint(ID, 'BALANCE'),
    `/api/service-requests/${ID}/balance-confirmation`,
  );
});

test('libellé distinct : « Acompte de … » / « Solde de … »', () => {
  assert.equal(awaitingAmountLabel('DEPOSIT', '30.00', 'CAD'), `Acompte de ${formatDepositAmount('30.00', 'CAD')}`);
  assert.equal(awaitingAmountLabel('BALANCE', '120.00', 'CAD'), `Solde de ${formatDepositAmount('120.00', 'CAD')}`);
});

test('explication : le texte de l’acompte est inchangé, celui du solde parle du solde', () => {
  assert.equal(
    awaitingExplanation('DEPOSIT'),
    'Le prélèvement automatique de cet acompte n’a pas abouti : votre banque demande que vous confirmiez le paiement, ou la carte utilisée a été refusée. Le paiement sera fait avec votre carte par défaut, et votre banque peut vous demander une vérification.',
  );
  assert.match(awaitingExplanation('BALANCE'), /solde/);
  assert.doesNotMatch(awaitingExplanation('BALANCE'), /acompte/);
});

test('titre de section accordé au contenu', () => {
  assert.equal(awaitingSectionTitle(['DEPOSIT']), 'Acompte à confirmer');
  assert.equal(awaitingSectionTitle(['DEPOSIT', 'DEPOSIT']), 'Acomptes à confirmer');
  assert.equal(awaitingSectionTitle(['BALANCE']), 'Solde à confirmer');
  assert.equal(awaitingSectionTitle(['BALANCE', 'BALANCE']), 'Soldes à confirmer');
  assert.equal(awaitingSectionTitle(['DEPOSIT', 'BALANCE']), 'Paiements à confirmer');
});

test('le 202 de confirm-completion mène à la page des moyens de paiement', () => {
  assert.equal(BALANCE_AWAITING_REDIRECT, '/account/payment-methods?solde=a-confirmer');
});

test('bandeau du 202 : le bouton n’est promis que si un solde est bien listé', () => {
  assert.match(balanceRedirectBanner(true), /Confirmez le paiement ci-dessous/);
  assert.doesNotMatch(balanceRedirectBanner(false), /Confirmez le paiement ci-dessous/);
  assert.notEqual(balanceRedirectBanner(true), balanceRedirectBanner(false));
});
