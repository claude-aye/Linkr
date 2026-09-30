// Tests du prix affiché sur une carte de demande (dette « Prix convenu »).
//
// Même banc que `tender-rules.test.mjs` : runner natif de Node, sans
// dépendance — `pnpm --filter @linkr/web test`. Aucune horloge.
//
// Les LIBELLÉS sont écrits en toutes lettres ici, et non relus depuis le module :
// ce sont eux que l'utilisateur lit, et un libellé de repli qui bougerait sans
// que ce fichier le sache serait une régression invisible.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGREED_PRICE_LABEL,
  CLIENT_PRICE_LABELS,
  JOB_PRICE_LABELS,
  priceDisplay,
} from './price-display.ts';

/** Les deux vues, et les libellés de repli EXACTS qu'elles affichent aujourd'hui. */
const VIEWS = [
  { name: 'client', labels: CLIENT_PRICE_LABELS, direct: 'Montant estimé', tender: 'Budget indicatif' },
  { name: 'job prestataire', labels: JOB_PRICE_LABELS, direct: 'Prix estimé', tender: 'Budget indicatif' },
];

const NONE = { agreedAmount: null, agreedCurrency: null };

function direct(over = {}) {
  return {
    requestType: 'DIRECT_BOOKING',
    estimatedAmount: '150.00',
    estimatedCurrency: 'CAD',
    ...NONE,
    ...over,
  };
}

function tender(over = {}) {
  return {
    requestType: 'PROJECT_TENDER',
    estimatedAmount: '50.00', // le BUDGET indicatif du client
    estimatedCurrency: 'CAD',
    ...NONE,
    ...over,
  };
}

test('les libellés exportés sont exactement ceux affichés avant ce changement', () => {
  assert.deepEqual(CLIENT_PRICE_LABELS, { direct: 'Montant estimé', tender: 'Budget indicatif' });
  assert.deepEqual(JOB_PRICE_LABELS, { direct: 'Prix estimé', tender: 'Budget indicatif' });
  assert.equal(AGREED_PRICE_LABEL, 'Prix convenu');
});

for (const view of VIEWS) {
  test(`[${view.name}] directe OPEN : libellé de repli et montant estimé`, () => {
    assert.deepEqual(priceDisplay(direct(), view.labels), {
      label: view.direct,
      amount: '150.00',
      currency: 'CAD',
    });
  });

  test(`[${view.name}] directe acceptée : « Prix convenu » + le montant convenu`, () => {
    assert.deepEqual(
      priceDisplay(direct({ agreedAmount: '150.00', agreedCurrency: 'CAD' }), view.labels),
      { label: 'Prix convenu', amount: '150.00', currency: 'CAD' },
    );
  });

  test(`[${view.name}] tender OPEN avec budget : « Budget indicatif » + le budget`, () => {
    assert.deepEqual(priceDisplay(tender(), view.labels), {
      label: 'Budget indicatif',
      amount: '50.00',
      currency: 'CAD',
    });
  });

  test(`[${view.name}] tender OPEN sans budget : libellé de repli, rien à montrer`, () => {
    assert.deepEqual(
      priceDisplay(tender({ estimatedAmount: null, estimatedCurrency: null }), view.labels),
      { label: 'Budget indicatif', amount: null, currency: null },
    );
  });

  test(`[${view.name}] tender accepté : c'est le DEVIS qui sort, pas le budget`, () => {
    const shown = priceDisplay(
      tender({ agreedAmount: '30.00', agreedCurrency: 'CAD' }),
      view.labels,
    );
    assert.deepEqual(shown, { label: 'Prix convenu', amount: '30.00', currency: 'CAD' });
    // Un seul montant : le budget de 50 $ ne figure nulle part dans le résultat.
    assert.ok(!JSON.stringify(shown).includes('50.00'));
  });

  test(`[${view.name}] tender accepté sans budget : « Prix convenu » quand même`, () => {
    assert.deepEqual(
      priceDisplay(
        tender({
          estimatedAmount: null,
          estimatedCurrency: null,
          agreedAmount: '250.00',
          agreedCurrency: 'CAD',
        }),
        view.labels,
      ),
      { label: 'Prix convenu', amount: '250.00', currency: 'CAD' },
    );
  });

  test(`[${view.name}] CANCELLED après acceptation : « Prix convenu », aucune condition sur le statut`, () => {
    // L'entrée ne porte même pas de statut : la règle n'en lit aucun.
    const shown = priceDisplay(
      tender({ agreedAmount: '410.00', agreedCurrency: 'CAD' }),
      view.labels,
    );
    assert.equal(shown.label, 'Prix convenu');
    assert.equal(shown.amount, '410.00');
  });

  test(`[${view.name}] anomalie (accepté, agreed null) : repli sur le budget, JAMAIS « Prix convenu »`, () => {
    const shown = priceDisplay(tender(), view.labels);
    assert.notEqual(shown.label, 'Prix convenu');
    assert.equal(shown.label, 'Budget indicatif');
    assert.equal(shown.amount, '50.00');
  });

  test(`[${view.name}] la devise voyage avec le montant convenu (celle du devis, pas de la demande)`, () => {
    assert.deepEqual(
      priceDisplay(tender({ agreedAmount: '175.50', agreedCurrency: 'USD' }), view.labels),
      { label: 'Prix convenu', amount: '175.50', currency: 'USD' },
    );
  });

  test(`[${view.name}] un contrat plus ancien (champs absents) retombe sur le repli`, () => {
    const { agreedAmount: _a, agreedCurrency: _c, ...legacy } = direct();
    assert.deepEqual(priceDisplay(legacy, view.labels), {
      label: view.direct,
      amount: '150.00',
      currency: 'CAD',
    });
  });
}

test('vue job prestataire : une directe sans prix convenu dit « Prix estimé », un tender « Budget indicatif »', () => {
  assert.equal(priceDisplay(direct(), JOB_PRICE_LABELS).label, 'Prix estimé');
  assert.equal(priceDisplay(tender(), JOB_PRICE_LABELS).label, 'Budget indicatif');
});

test('vue client : une directe sans prix convenu dit « Montant estimé », un tender « Budget indicatif »', () => {
  assert.equal(priceDisplay(direct(), CLIENT_PRICE_LABELS).label, 'Montant estimé');
  assert.equal(priceDisplay(tender(), CLIENT_PRICE_LABELS).label, 'Budget indicatif');
});
