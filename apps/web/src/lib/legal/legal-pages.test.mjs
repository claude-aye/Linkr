import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LEGAL_DOCUMENTS,
  LEGAL_LINKS,
  LEGAL_PATHS,
  LEGAL_VERSION,
  formatLastUpdated,
} from './legal-pages.ts';

test('the four documents have distinct paths, and every path is public', () => {
  const paths = Object.values(LEGAL_DOCUMENTS).map((doc) => doc.path);
  assert.equal(new Set(paths).size, 4);
  assert.deepEqual([...LEGAL_PATHS].sort(), [...paths].sort());
});

test('the published paths are the four agreed ones', () => {
  assert.deepEqual([...LEGAL_PATHS].sort(), [
    '/conditions',
    '/confidentialite',
    '/privacy',
    '/terms',
  ]);
});

test('every document links to a twin in the OTHER language, and back', () => {
  for (const doc of Object.values(LEGAL_DOCUMENTS)) {
    const twin = LEGAL_DOCUMENTS[doc.alternate];
    assert.notEqual(twin.locale, doc.locale, `${doc.key} → ${twin.key}`);
    assert.equal(twin.alternate, doc.key, `${twin.key} does not point back`);
  }
});

test('the footer links of each language stay in that language', () => {
  for (const [locale, links] of Object.entries(LEGAL_LINKS)) {
    assert.equal(LEGAL_DOCUMENTS[links.privacy].locale, locale);
    assert.equal(LEGAL_DOCUMENTS[links.terms].locale, locale);
  }
});

test('the lang attribute matches the locale', () => {
  for (const doc of Object.values(LEGAL_DOCUMENTS)) {
    assert.equal(doc.lang, doc.locale === 'fr' ? 'fr-CA' : 'en-CA');
  }
});

test('the version is a civil day', () => {
  assert.match(LEGAL_VERSION, /^\d{4}-\d{2}-\d{2}$/);
});

test('the last-updated line renders the civil day, never the day before', () => {
  // Midnight UTC is still the previous evening in Toronto: a formatter in the
  // display time zone would print the 10th here.
  assert.equal(
    formatLastUpdated('fr', '2026-10-11'),
    'Dernière mise à jour : 11 octobre 2026',
  );
  assert.equal(formatLastUpdated('en', '2026-10-11'), 'Last updated: October 11, 2026');
});

test('a malformed version fails loudly instead of printing « Invalid Date »', () => {
  assert.throws(() => formatLastUpdated('fr', '11/10/2026'));
  assert.throws(() => formatLastUpdated('fr', '2026-13-45'));
});
