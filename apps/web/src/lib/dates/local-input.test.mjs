// Tests de `local-input.ts` — voir `tender-rules.test.mjs` pour le runner.
//
// Les tests sont indépendants du fuseau de la machine : l'aller-retour
// champ → instant → champ doit être l'identité quel que soit le fuseau
// (c'est la propriété qui compte — la dette D0b porte sur QUEL fuseau, pas
// sur la cohérence des deux sens).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fromLocalInputValue, toLocalInputValue } from './local-input.ts';

test('field → instant → field is the identity', () => {
  for (const value of ['2026-09-15T14:00', '2026-01-03T00:05', '2026-12-31T23:59']) {
    assert.equal(toLocalInputValue(new Date(fromLocalInputValue(value))), value);
  }
});

test('toLocalInputValue truncates to the minute and is built from LOCAL parts', () => {
  const d = new Date(2026, 8, 15, 14, 7, 59, 999);
  assert.equal(toLocalInputValue(d), '2026-09-15T14:07');
});

test('fromLocalInputValue reads a zoneless value as LOCAL time (D0b)', () => {
  assert.equal(fromLocalInputValue('2026-09-15T14:00'), new Date(2026, 8, 15, 14, 0).getTime());
});

test('fromLocalInputValue refuses anything that is not the field format', () => {
  for (const value of ['', '2026-09-15', '2026-09-15T14', '2026-09-15T14:00Z', 'demain', '2026-13-45T99:99']) {
    assert.equal(fromLocalInputValue(value), null, JSON.stringify(value));
  }
});
