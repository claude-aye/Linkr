import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMAIL_NOT_VERIFIED_CODE,
  EMAIL_NOT_VERIFIED_MESSAGE,
  isEmailNotVerified,
} from './states.ts';

const json = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

test('L3: a 403 with code EMAIL_NOT_VERIFIED is recognised', async () => {
  assert.equal(EMAIL_NOT_VERIFIED_CODE, 'EMAIL_NOT_VERIFIED');
  const res = json(403, { statusCode: 403, code: 'EMAIL_NOT_VERIFIED', message: 'x' });
  assert.equal(await isEmailNotVerified(res), true);
});

test('L3: a 403 WITHOUT the code keeps its existing meaning', async () => {
  assert.equal(await isEmailNotVerified(json(403, { statusCode: 403, message: 'Not your request' })), false);
  assert.equal(await isEmailNotVerified(json(403, { code: 'SOMETHING_ELSE' })), false);
  assert.equal(await isEmailNotVerified(json(403, null)), false);
  assert.equal(await isEmailNotVerified(new Response('not json', { status: 403 })), false);
});

test('L3: the code on another status is ignored (only the 403 is read)', async () => {
  for (const status of [400, 401, 409, 422, 502]) {
    assert.equal(await isEmailNotVerified(json(status, { code: 'EMAIL_NOT_VERIFIED' })), false, String(status));
  }
});

test('L3: the body is read from a clone — the caller can still read it', async () => {
  const res = json(403, { code: 'EMAIL_NOT_VERIFIED', message: 'x' });
  assert.equal(await isEmailNotVerified(res), true);
  assert.deepEqual(await res.json(), { code: 'EMAIL_NOT_VERIFIED', message: 'x' });
});

test('L3: the message is the agreed copy, in the vouvoiement', () => {
  assert.equal(
    EMAIL_NOT_VERIFIED_MESSAGE,
    'Confirmez votre adresse courriel pour effectuer cette action. Le bandeau en haut de la page vous permet de recevoir un nouveau courriel.',
  );
});
