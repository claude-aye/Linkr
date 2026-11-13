import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EMAIL_NOT_VERIFIED_MESSAGE, setupIntentErrorMessage } from './states.ts';

const messages = { generic: 'GENERIC', sessionExpired: 'EXPIRED' };
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('L3b-B: 403 with EMAIL_NOT_VERIFIED shows the dedicated message', async () => {
  const res = json(403, { statusCode: 403, code: 'EMAIL_NOT_VERIFIED', message: 'x' });
  assert.equal(await setupIntentErrorMessage(res, messages), EMAIL_NOT_VERIFIED_MESSAGE);
});

test('L3b-B: a 403 without the code keeps the original message', async () => {
  assert.equal(await setupIntentErrorMessage(json(403, { statusCode: 403 }), messages), 'GENERIC');
});

test('L3b-B: 401 and other statuses keep their own messages', async () => {
  assert.equal(await setupIntentErrorMessage(json(401, {}), messages), 'EXPIRED');
  assert.equal(await setupIntentErrorMessage(json(502, {}), messages), 'GENERIC');
});
