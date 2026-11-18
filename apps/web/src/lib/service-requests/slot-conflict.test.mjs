import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SLOT_CONFLICT_CODE,
  SLOT_CONFLICT_MESSAGE,
  SLOT_TAKEN_CODE,
  SLOT_TAKEN_MESSAGE,
  hasConflictCode,
} from './slot-conflict.ts';

function response(status, body) {
  return {
    status,
    clone: () => ({
      json: async () => {
        if (body === undefined) throw new SyntaxError('not json');
        return body;
      },
    }),
  };
}

test('a 409 carrying the code is recognised', async () => {
  assert.equal(await hasConflictCode(response(409, { code: SLOT_TAKEN_CODE }), SLOT_TAKEN_CODE), true);
  assert.equal(
    await hasConflictCode(response(409, { code: SLOT_CONFLICT_CODE }), SLOT_CONFLICT_CODE),
    true,
  );
});

test('another 409 (state transition, no code) is not', async () => {
  assert.equal(
    await hasConflictCode(response(409, { message: 'Transition from ASSIGNED to ASSIGNED' }), SLOT_TAKEN_CODE),
    false,
  );
  assert.equal(await hasConflictCode(response(409, { code: SLOT_CONFLICT_CODE }), SLOT_TAKEN_CODE), false);
});

test('only a 409 is read', async () => {
  assert.equal(await hasConflictCode(response(400, { code: SLOT_TAKEN_CODE }), SLOT_TAKEN_CODE), false);
});

test('a body that is not JSON answers false', async () => {
  assert.equal(await hasConflictCode(response(409, undefined), SLOT_TAKEN_CODE), false);
  assert.equal(await hasConflictCode(response(409, null), SLOT_TAKEN_CODE), false);
});

test('the copy is the decided one', () => {
  assert.equal(SLOT_TAKEN_MESSAGE, "Ce créneau vient d'être pris. Choisissez-en un autre.");
  assert.equal(
    SLOT_CONFLICT_MESSAGE,
    'Vous avez déjà un rendez-vous confirmé sur ce créneau. Refusez cette demande ou proposez une autre heure au client.',
  );
});
