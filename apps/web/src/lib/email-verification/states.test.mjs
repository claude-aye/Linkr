import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resendOutcome, verifyOutcome, INVALID_LINK_MESSAGE } from './states.ts';

test('verify: 204 succeeds, 400 is one invalid state, 429 and others are distinct', () => {
  assert.equal(verifyOutcome(204).kind, 'success');
  assert.equal(verifyOutcome(400).kind, 'invalid');
  assert.equal(verifyOutcome(429).kind, 'rate-limited');
  for (const s of [500, 502, 503, 404]) assert.equal(verifyOutcome(s).kind, 'network', String(s));
});

test('the invalid-link copy reveals nothing about the token', () => {
  assert.match(INVALID_LINK_MESSAGE, /invalide ou expiré/);
  assert.doesNotMatch(INVALID_LINK_MESSAGE, /utilisé|remplacé|consommé/);
});

test('resend: SENT and ALREADY_VERIFIED', () => {
  assert.equal(resendOutcome(200, 'SENT').message, 'Courriel envoyé, vérifiez votre boîte.');
  assert.equal(resendOutcome(200, 'ALREADY_VERIFIED').kind, 'already-verified');
});

test('resend: 429, 401 and the two 503 codes get their own sentence', () => {
  assert.equal(resendOutcome(429, undefined).kind, 'rate-limited');
  assert.equal(resendOutcome(401, undefined).kind, 'reauth');
  assert.match(resendOutcome(503, 'EMAIL_VERIFICATION_BUDGET_EXHAUSTED').message, /saturés/);
  assert.match(resendOutcome(503, 'EMAIL_VERIFICATION_SEND_FAILED').message, /a échoué/);
  assert.match(resendOutcome(503, undefined).message, /indisponible/);
  assert.match(resendOutcome(502, undefined).message, /indisponible/);
});
