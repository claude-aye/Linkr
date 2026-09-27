// Tests des règles d'affichage des DEVIS REÇUS (PR 4b « Appel d'offres »).
//
// Même banc que `tender-rules.test.mjs` : runner natif de Node, sans
// dépendance — `pnpm --filter @linkr/web test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  decimalToCents,
  distanceLabel,
  durationLabel,
  reputationOf,
  sortReceivedQuotes,
} from './received-quotes.ts';
import {
  TENDER_SELECTION_WINDOW_DAYS,
  quoteValidUntil,
  quotesReceptionClosed,
  tenderSelectionEndUtc,
} from '../service-requests/tender-rules.ts';

// ── Montants → centimes ─────────────────────────────────────────────────────

test('decimalToCents : chaîne décimale → centimes entiers, sans flottant', () => {
  assert.equal(decimalToCents('850.50'), 85050);
  assert.equal(decimalToCents('1500'), 150000);
  assert.equal(decimalToCents('0.3'), 30);
  assert.equal(decimalToCents('0.10'), 10);
  assert.equal(decimalToCents('0.07'), 7);
  // 0.1 + 0.2 en flottant vaut 0.30000000000000004 : ici, aucune dérive.
  assert.equal(decimalToCents('0.1') + decimalToCents('0.2'), decimalToCents('0.3'));
});

test('decimalToCents : illisible → null, jamais un prix fabriqué', () => {
  assert.equal(decimalToCents(''), null);
  assert.equal(decimalToCents('abc'), null);
  assert.equal(decimalToCents('1,50'), null);
});

// ── Tri ─────────────────────────────────────────────────────────────────────

const q = (id, amount) => ({ id, amount });
// L'ordre de l'API (offres vivantes d'abord, puis arrivée) : c'est l'« arrivée ».
const API_ORDER = [q('a', '900.00'), q('b', '100.00'), q('c', '450.50'), q('d', '100.00')];

test('arrivée : l’ordre de l’API, inchangé, dans un nouveau tableau', () => {
  const out = sortReceivedQuotes(API_ORDER, 'arrival');
  assert.deepEqual(out.map((x) => x.id), ['a', 'b', 'c', 'd']);
  assert.notEqual(out, API_ORDER);
});

test('prix croissant : comparé en centimes', () => {
  const out = sortReceivedQuotes(API_ORDER, 'price');
  assert.deepEqual(out.map((x) => x.id), ['b', 'd', 'c', 'a']);
});

test('prix croissant : égalité → ordre d’arrivée (b avant d, dans les deux sens)', () => {
  const reversed = [q('d', '100.00'), q('b', '100.00')];
  assert.deepEqual(sortReceivedQuotes(reversed, 'price').map((x) => x.id), ['d', 'b']);
  assert.deepEqual(
    sortReceivedQuotes([q('b', '100.00'), q('d', '100')], 'price').map((x) => x.id),
    ['b', 'd'],
  );
});

test('prix croissant : les centimes décident (99.99 < 100.00 < 100.01)', () => {
  const out = sortReceivedQuotes([q('x', '100.01'), q('y', '100.00'), q('z', '99.99')], 'price');
  assert.deepEqual(out.map((x) => x.id), ['z', 'y', 'x']);
});

test('prix croissant : un montant illisible va en queue sans fausser le reste', () => {
  const out = sortReceivedQuotes([q('bad', '??'), q('m', '50.00'), q('n', '10.00')], 'price');
  assert.deepEqual(out.map((x) => x.id), ['n', 'm', 'bad']);
});

test('le tri ne mute pas l’entrée', () => {
  const input = [q('a', '9.00'), q('b', '1.00')];
  sortReceivedQuotes(input, 'price');
  assert.deepEqual(input.map((x) => x.id), ['a', 'b']);
});

// ── Réputation (règle D-4, cinq cas) ────────────────────────────────────────

test('réputation : lecture en échec (null) → indisponible, distinct de zéro', () => {
  assert.deepEqual(reputationOf(null, null), { kind: 'unavailable' });
});

test('réputation : note publiée → note + nombre d’avis', () => {
  assert.deepEqual(reputationOf(3, 4.33), { kind: 'rated', averageRating: 4.33, reviewCount: 3 });
});

test('réputation : 1 avis sans note → le compte seul', () => {
  assert.deepEqual(reputationOf(1, null), { kind: 'count', reviewCount: 1 });
});

test('réputation : 2 avis sans note → le compte seul', () => {
  assert.deepEqual(reputationOf(2, null), { kind: 'count', reviewCount: 2 });
});

test('réputation : 0 avis → rien du tout', () => {
  assert.deepEqual(reputationOf(0, null), { kind: 'none' });
});

// ── Distance, durée ─────────────────────────────────────────────────────────

test('distance : 0 → « À moins de 1 km », N → « À N km », null → rien', () => {
  assert.equal(distanceLabel(0), 'À moins de 1 km');
  assert.equal(distanceLabel(12), 'À 12 km');
  assert.equal(distanceLabel(null), null);
});

test('durée : minutes → heures, virgule québécoise', () => {
  assert.equal(durationLabel(30), '30 min');
  assert.equal(durationLabel(60), '1 h');
  assert.equal(durationLabel(90), '1,5 h');
  assert.equal(durationLabel(120), '2 h');
  assert.equal(durationLabel(100), '1 h 40');
});

// ── Fin de la période de sélection (R7) ─────────────────────────────────────

test('fin de sélection = date limite + fenêtre de sélection, à la milliseconde', () => {
  const deadline = '2026-09-20T14:00:00.000Z';
  const end = tenderSelectionEndUtc(deadline);
  assert.equal(
    Date.parse(end) - Date.parse(deadline),
    TENDER_SELECTION_WINDOW_DAYS * 24 * 3_600_000,
  );
  assert.equal(end, '2026-09-27T14:00:00.000Z');
});

test('fin de sélection et validité d’un devis sont le MÊME instant', () => {
  const deadline = '2026-11-01T03:30:00.000Z'; // à travers le changement d’heure
  assert.equal(tenderSelectionEndUtc(deadline), quoteValidUntil(deadline));
});

test('fin de sélection : date illisible → null', () => {
  assert.equal(tenderSelectionEndUtc('pas une date'), null);
});

test('réception close dès la milliseconde exacte de la date limite (R6)', () => {
  const deadline = '2026-09-20T14:00:00.000Z';
  assert.equal(quotesReceptionClosed(deadline, new Date('2026-09-20T13:59:59.999Z')), false);
  assert.equal(quotesReceptionClosed(deadline, new Date('2026-09-20T14:00:00.000Z')), true);
  assert.equal(quotesReceptionClosed('illisible', new Date()), false);
});
