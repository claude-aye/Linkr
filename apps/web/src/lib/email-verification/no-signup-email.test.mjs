// Mandate A: sign-up sends no email; the shell band's button sends it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BANNER_LEAD,
  EMAIL_NOT_VERIFIED_IN_DIALOG_MESSAGE,
  EMAIL_NOT_VERIFIED_MESSAGE,
  RESEND_BUTTON_LABEL,
  SENT_MESSAGE,
} from './states.ts';

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const APP = join(SRC, 'app');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const sources = walk(APP).filter((f) => f.endsWith('.tsx'));
const rel = (f) => relative(APP, f).split(sep).join('/');

test('the 403 message points to the band, and names its button', () => {
  assert.match(EMAIL_NOT_VERIFIED_MESSAGE, /bandeau en haut de la page/);
  assert.ok(EMAIL_NOT_VERIFIED_MESSAGE.includes(`« ${RESEND_BUTTON_LABEL} »`));
  assert.equal(SENT_MESSAGE, 'Courriel envoyé, vérifiez votre boîte.');
  assert.ok(BANNER_LEAD.length > 0 && EMAIL_NOT_VERIFIED_IN_DIALOG_MESSAGE.length > 0);
});

test('every screen that shows the 403 message is inside (app), where the layout renders the band', () => {
  const users = sources.filter((f) => /\bEMAIL_NOT_VERIFIED_MESSAGE\b/.test(readFileSync(f, 'utf-8')));
  assert.ok(users.length >= 10, `expected the guarded forms, found ${users.length}`);
  for (const f of users) assert.ok(rel(f).startsWith('(app)/'), `${rel(f)} is outside (app)`);
  const layout = readFileSync(join(APP, '(app)', 'layout.tsx'), 'utf-8');
  assert.match(layout, /user && !user\.emailVerified \? <EmailVerificationBanner \/>/);
});

test('no form gets a send button: only the band and the add-card modal (which covers it)', () => {
  const users = sources
    .filter((f) => /useResendVerification|EmailNotVerifiedNotice/.test(readFileSync(f, 'utf-8')))
    .map(rel)
    .sort();
  assert.deepEqual(users, [
    '(app)/_components/email-verification-banner.tsx',
    '(app)/account/payment-methods/_components/add-card-section.tsx',
    '(app)/account/payment-methods/_components/card-form.tsx',
  ]);
});

test('sign-up no longer lands on « we sent you an email »', () => {
  const signup = readFileSync(join(APP, '(auth)', 'signup', 'page.tsx'), 'utf-8');
  assert.doesNotMatch(signup, /courriel=envoye/);
});
