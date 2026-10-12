import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assembleSignupBody } from './signup-body.ts';

const LOCALE = { countryCode: 'CA', subdivisionCode: 'CA-QC', preferredCurrency: 'CAD' };
const VERSION = '2026-10-11';

const incoming = () => ({
  email: 'smoke-l2@linkr.test',
  password: 'Password123!',
  firstName: 'Léa',
  lastName: 'Test',
  acceptTerms: true,
});

test('adds the terms version server-side and relays the consent', () => {
  const body = assembleSignupBody(incoming(), LOCALE, VERSION);
  assert.deepEqual(body, {
    email: 'smoke-l2@linkr.test',
    password: 'Password123!',
    firstName: 'Léa',
    lastName: 'Test',
    countryCode: 'CA',
    subdivisionCode: 'CA-QC',
    preferredCurrency: 'CAD',
    acceptTerms: true,
    termsVersion: VERSION,
  });
});

test('the version is the server one, even if the browser sends another', () => {
  const body = assembleSignupBody({ ...incoming(), termsVersion: '1999-01-01' }, LOCALE, VERSION);
  assert.equal(body?.termsVersion, VERSION);
});

test('stray keys are dropped, never relayed', () => {
  const body = assembleSignupBody(
    {
      ...incoming(),
      displayName: 'HACKED',
      phone: '+15145551234',
      countryCode: 'FR',
      termsAcceptedAtUtc: '2020-01-01T00:00:00Z',
      junk: 1,
    },
    LOCALE,
    VERSION,
  );
  assert.ok(body);
  assert.deepEqual(Object.keys(body).sort(), [
    'acceptTerms',
    'countryCode',
    'email',
    'firstName',
    'lastName',
    'password',
    'preferredCurrency',
    'subdivisionCode',
    'termsVersion',
  ]);
  assert.equal(body.countryCode, 'CA');
});

test('no consent → null (absent, false, or the string "true")', () => {
  const without = incoming();
  delete without.acceptTerms;
  assert.equal(assembleSignupBody(without, LOCALE, VERSION), null);
  assert.equal(assembleSignupBody({ ...incoming(), acceptTerms: false }, LOCALE, VERSION), null);
  assert.equal(assembleSignupBody({ ...incoming(), acceptTerms: 'true' }, LOCALE, VERSION), null);
});

test('a missing or non-string field → null', () => {
  assert.equal(assembleSignupBody({ ...incoming(), email: 42 }, LOCALE, VERSION), null);
  assert.equal(assembleSignupBody(null, LOCALE, VERSION), null);
  assert.equal(assembleSignupBody('nope', LOCALE, VERSION), null);
});
