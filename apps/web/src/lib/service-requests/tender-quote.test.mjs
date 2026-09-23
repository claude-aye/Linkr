// Tests des règles client du DEVIS sur un appel d'offres (PR 3).
//
// Même banc que `tender-rules.test.mjs` : runner natif de Node, sans
// dépendance — `pnpm --filter @linkr/web test`. Aucune horloge : ces règles ne
// dépendent pas de « maintenant » (la validité découle de la date limite du
// tender, et la date de début proposée n'a aucune règle serveur).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_DURATION_MINUTES,
  TENDER_SELECTION_WINDOW_DAYS,
  assembleQuote,
  parseDurationHours,
  proposedStartToUtc,
  quoteValidUntil,
  tendersToHandleCount,
} from './tender-rules.ts';

const DAY = 24 * 60 * 60 * 1000;
const DEADLINE = '2026-09-29T14:00:00.000Z';

function draft(overrides = {}) {
  return {
    amount: '850,50',
    durationHours: '1,5',
    description: '  Coupe et coloration.  ',
    proposedStartDate: '',
    ...overrides,
  };
}

// --- heures → minutes ------------------------------------------------------

test('0,5 heure → 30 minutes (virgule québécoise), 0.5 aussi', () => {
  assert.deepEqual(parseDurationHours('0,5'), { kind: 'ok', minutes: 30 });
  assert.deepEqual(parseDurationHours('0.5'), { kind: 'ok', minutes: 30 });
});

test('les heures entières et les demi-heures sont converties en minutes ENTIÈRES', () => {
  assert.deepEqual(parseDurationHours('3'), { kind: 'ok', minutes: 180 });
  assert.deepEqual(parseDurationHours('2,50'), { kind: 'ok', minutes: 150 });
  assert.deepEqual(parseDurationHours(' 1 '), { kind: 'ok', minutes: 60 });
  const r = parseDurationHours('12,5');
  assert.equal(r.kind, 'ok');
  assert.ok(Number.isInteger(r.minutes));
});

test('0 est refusé (la durée doit être > 0)', () => {
  assert.deepEqual(parseDurationHours('0'), { kind: 'invalid', reason: 'not-positive' });
  assert.deepEqual(parseDurationHours('0,0'), { kind: 'invalid', reason: 'not-positive' });
});

test('le négatif est refusé — jamais corrigé en silence', () => {
  assert.deepEqual(parseDurationHours('-1'), { kind: 'invalid', reason: 'format' });
  assert.deepEqual(parseDurationHours('-0,5'), { kind: 'invalid', reason: 'format' });
});

test('hors du pas de 0,5 → refusé', () => {
  assert.deepEqual(parseDurationHours('1,25'), { kind: 'invalid', reason: 'step' });
  assert.deepEqual(parseDurationHours('0,1'), { kind: 'invalid', reason: 'step' });
});

test('vide et format illisible → refusés, chacun avec sa raison', () => {
  assert.deepEqual(parseDurationHours(''), { kind: 'invalid', reason: 'empty' });
  assert.deepEqual(parseDurationHours('   '), { kind: 'invalid', reason: 'empty' });
  assert.deepEqual(parseDurationHours('deux'), { kind: 'invalid', reason: 'format' });
  assert.deepEqual(parseDurationHours('1h30'), { kind: 'invalid', reason: 'format' });
});

test('au-delà de la capacité int4 de la colonne → refusé (pas une 500 au cast)', () => {
  const hours = String((MAX_DURATION_MINUTES + 60) / 60);
  assert.equal(parseDurationHours(hours).kind, 'invalid');
});

// --- date → midi UTC -------------------------------------------------------

test('une date de début proposée devient MIDI UTC ce jour-là', () => {
  assert.equal(proposedStartToUtc('2026-10-05'), '2026-10-05T12:00:00.000Z');
});

test('midi UTC se relit le MÊME jour civil au Québec (jamais la veille)', () => {
  const iso = proposedStartToUtc('2026-01-01');
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
  assert.equal(day, '2026-01-01');
});

test('champ vide → null (facultatif)', () => {
  assert.equal(proposedStartToUtc(''), null);
});

test('une date impossible ou hors format → invalid, jamais un autre jour', () => {
  assert.equal(proposedStartToUtc('2026-02-30'), 'invalid');
  assert.equal(proposedStartToUtc('2026-13-01'), 'invalid');
  assert.equal(proposedStartToUtc('05/10/2026'), 'invalid');
  assert.equal(proposedStartToUtc('2026-10-05T09:00'), 'invalid');
});

// --- validité = échéance + 7 j --------------------------------------------

test('la fenêtre de sélection miroir vaut 7 jours', () => {
  assert.equal(TENDER_SELECTION_WINDOW_DAYS, 7);
});

test('validité = date limite des devis + 7 jours EXACTEMENT', () => {
  const valid = quoteValidUntil(DEADLINE);
  assert.equal(valid, '2026-10-06T14:00:00.000Z');
  assert.equal(Date.parse(valid) - Date.parse(DEADLINE), 7 * DAY);
});

test('la validité est une durée FIXE, même à travers le changement d’heure', () => {
  // 1ᵉʳ novembre 2026 : l'heure normale revient à Toronto. 7 × 24 h, pas 7 jours civils.
  const deadline = '2026-10-30T13:00:00.000Z';
  assert.equal(Date.parse(quoteValidUntil(deadline)) - Date.parse(deadline), 7 * DAY);
});

test('date limite illisible → null, jamais un instant fabriqué', () => {
  assert.equal(quoteValidUntil('pas une date'), null);
});

// --- compteur « à traiter » -----------------------------------------------

test('compteur : tout ce qui n’a pas de devis SUBMITTED est à traiter', () => {
  const items = [
    { myQuoteStatus: null },
    { myQuoteStatus: 'SUBMITTED' },
    { myQuoteStatus: 'WITHDRAWN' },
    { myQuoteStatus: 'EXPIRED' },
    { myQuoteStatus: 'SUBMITTED' },
  ];
  assert.equal(tendersToHandleCount(items), 3);
});

test('compteur : liste vide → 0 ; tout soumis → 0', () => {
  assert.equal(tendersToHandleCount([]), 0);
  assert.equal(tendersToHandleCount([{ myQuoteStatus: 'SUBMITTED' }]), 0);
});

// --- assemblage -----------------------------------------------------------

test('un devis valide part avec montant, minutes, description TRIMMÉE et validité', () => {
  const r = assembleQuote(draft(), DEADLINE);
  assert.equal(r.kind, 'ready');
  assert.deepEqual(r.body, {
    amount: 850.5,
    estimatedDurationMinutes: 90,
    description: 'Coupe et coloration.',
    validUntilUtc: '2026-10-06T14:00:00.000Z',
  });
});

test('le corps ne porte JAMAIS de devise (figée côté serveur, dans le relais)', () => {
  const r = assembleQuote(draft(), DEADLINE);
  assert.equal('currency' in r.body, false);
});

test('une date de début proposée voyage à midi UTC', () => {
  const r = assembleQuote(draft({ proposedStartDate: '2026-10-05' }), DEADLINE);
  assert.equal(r.body.proposedStartAtUtc, '2026-10-05T12:00:00.000Z');
});

test('sans date de début, la clé est ABSENTE (pas null, pas vide)', () => {
  const r = assembleQuote(draft(), DEADLINE);
  assert.equal('proposedStartAtUtc' in r.body, false);
});

test('chaque champ fautif est signalé à son propre champ', () => {
  const r = assembleQuote(
    { amount: '', durationHours: '0', description: '   ', proposedStartDate: '2026-02-30' },
    DEADLINE,
  );
  assert.equal(r.kind, 'invalid');
  assert.deepEqual(Object.keys(r.errors).sort(), [
    'amount',
    'description',
    'duration',
    'proposedStart',
  ]);
});

test('montant : 0, trois décimales, texte → refusés', () => {
  for (const amount of ['0', '850,555', 'huit cents']) {
    const r = assembleQuote(draft({ amount }), DEADLINE);
    assert.equal(r.kind, 'invalid', amount);
    assert.ok(r.errors.amount, amount);
  }
});

test('date limite du tender illisible → no-deadline, rien ne part', () => {
  assert.deepEqual(assembleQuote(draft(), 'n/a'), { kind: 'no-deadline' });
});
