import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tooManyCreatedMessage } from './retry-after.ts';

const res = (retryAfter) =>
  new Response(null, { status: 429, headers: retryAfter ? { 'Retry-After': retryAfter } : {} });

test('the creation 429 quotes the delay and does not say "your device"', () => {
  const message = tooManyCreatedMessage(res('1800'));
  assert.match(message, /environ 30 minutes/);
  assert.doesNotMatch(message, /appareil/);
});

test('without a readable Retry-After it invents no number', () => {
  assert.match(tooManyCreatedMessage(res(null)), /patienter quelques minutes/);
});
