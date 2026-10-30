import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EAGER_THUMBNAILS,
  galleryAlt,
  galleryTitle,
  galleryToShow,
  MARQUEE_SECONDS_PER_PHOTO,
  marqueeDurationSeconds,
  nextIndex,
  previousIndex,
  shouldLoop,
  thumbnailLoading,
  viewerCounter,
  viewerKeyTarget,
} from './public-gallery.ts';

const item = (id, caption = null) => ({
  id,
  caption,
  width: 1200,
  height: 900,
  imageUrl: `/media/portfolio/${id}`,
});

// ── 1. The viewer's moves ──────────────────────────────────────────────────

test('previous stops on the first photo, without wrapping', () => {
  assert.equal(previousIndex(0), null);
  assert.equal(previousIndex(1), 0);
  assert.equal(previousIndex(4), 3);
});

test('next stops on the last photo, without wrapping', () => {
  assert.equal(nextIndex(4, 5), null);
  assert.equal(nextIndex(3, 5), 4);
  assert.equal(nextIndex(0, 5), 1);
});

test('a single photo has neither previous nor next', () => {
  assert.equal(previousIndex(0), null);
  assert.equal(nextIndex(0, 1), null);
});

test('the counter is 1-based: « 1 / 12 », « 3 / 5 », « 12 / 12 »', () => {
  assert.equal(viewerCounter(0, 12), '1 / 12');
  assert.equal(viewerCounter(2, 5), '3 / 5');
  assert.equal(viewerCounter(11, 12), '12 / 12');
});

test('← and → follow the same bounds; any other key does nothing', () => {
  assert.equal(viewerKeyTarget('ArrowLeft', 2, 5), 1);
  assert.equal(viewerKeyTarget('ArrowRight', 2, 5), 3);
  assert.equal(viewerKeyTarget('ArrowLeft', 0, 5), null);
  assert.equal(viewerKeyTarget('ArrowRight', 4, 5), null);
  assert.equal(viewerKeyTarget('Enter', 2, 5), null);
  assert.equal(viewerKeyTarget('ArrowUp', 2, 5), null);
});

// ── 2. The alt text ────────────────────────────────────────────────────────

test('the alt is the caption, trimmed', () => {
  assert.equal(galleryAlt('  Salle de bain refaite ', 'Dana Coiffure'), 'Salle de bain refaite');
});

test('without a caption — null, empty or blank — the alt names the provider', () => {
  for (const caption of [null, '', '   ']) {
    assert.equal(galleryAlt(caption, 'Dana Coiffure'), 'Réalisation de Dana Coiffure');
  }
});

// ── 3. Whether the section shows ───────────────────────────────────────────

test('a failed read shows no section', () => {
  assert.equal(galleryToShow({ kind: 'failed' }), null);
});

test('an empty list shows no section', () => {
  assert.equal(galleryToShow({ kind: 'loaded', data: { items: [] } }), null);
});

test('a body that is not the expected envelope shows no section, without throwing', () => {
  for (const data of [
    null,
    undefined,
    'oops',
    42,
    [],
    {},
    { items: null },
    { items: 'nope' },
    { items: [{ id: 'x' }] },
    { items: [item('a'), { ...item('b'), imageUrl: 7 }] },
  ]) {
    assert.doesNotThrow(() => galleryToShow({ kind: 'loaded', data }));
    assert.equal(galleryToShow({ kind: 'loaded', data }), null, JSON.stringify(data));
  }
});

test('a loaded list keeps the API order, untouched', () => {
  const items = [item('c', 'C'), item('a'), item('b', 'B')];
  assert.deepEqual(galleryToShow({ kind: 'loaded', data: { items } }), items);
});

test('the title carries the count: « Réalisations (5) »', () => {
  assert.equal(galleryTitle(5), 'Réalisations (5)');
  assert.equal(galleryTitle(12), 'Réalisations (12)');
});

test('only the first four thumbnails load eagerly', () => {
  assert.equal(EAGER_THUMBNAILS, 4);
  assert.deepEqual(
    [0, 3, 4, 11].map(thumbnailLoading),
    ['eager', 'eager', 'lazy', 'lazy'],
  );
});

// ── 3b. The strip that scrolls by itself (F2) ────────────────────────────────────────

test('a lap lasts five seconds per photo: 12 photos make a 60 s lap', () => {
  assert.equal(MARQUEE_SECONDS_PER_PHOTO, 5);
  assert.equal(marqueeDurationSeconds(12), 60);
  assert.equal(marqueeDurationSeconds(3), 15);
  assert.equal(marqueeDurationSeconds(1), 5);
});

test('the strip loops only when the photos do not fit, and never under reduced motion', () => {
  const fit = { contentWidth: 700, containerWidth: 760, reducedMotion: false };
  assert.equal(shouldLoop(fit), false);
  assert.equal(shouldLoop({ ...fit, contentWidth: 760 }), false);
  assert.equal(shouldLoop({ ...fit, contentWidth: 761 }), true);
  assert.equal(shouldLoop({ ...fit, contentWidth: 2000, reducedMotion: true }), false);
});

test('a strip that has not been measured yet stays still', () => {
  assert.equal(shouldLoop({ contentWidth: 0, containerWidth: 0, reducedMotion: false }), false);
});

// ── 4. The source: inert captions, no API address, no external link ───────

const here = fileURLToPath(new URL('.', import.meta.url));
const webSrc = join(here, '..', '..');
const GALLERY_SOURCES = [
  join(webSrc, 'app/(app)/providers/[id]/_components/portfolio-gallery.tsx'),
  join(webSrc, 'app/(app)/providers/[id]/page.tsx'),
  join(here, 'public-gallery.ts'),
];

test('no gallery file injects raw HTML', () => {
  for (const path of GALLERY_SOURCES) {
    assert.equal(/dangerouslySetInnerHTML/.test(readFileSync(path, 'utf8')), false, path);
  }
});

test('no gallery file names the API address', () => {
  for (const path of GALLERY_SOURCES) {
    const source = readFileSync(path, 'utf8');
    assert.equal(/NEXT_PUBLIC_API_URL|localhost:5000|:5000/.test(source), false, path);
  }
});

test('no gallery file carries an external href', () => {
  for (const path of GALLERY_SOURCES) {
    const source = readFileSync(path, 'utf8');
    assert.equal(/href=\{?\s*["'`]https?:/.test(source), false, path);
  }
});

test('the gallery shows imageUrl as given and never rebuilds it', () => {
  const source = readFileSync(GALLERY_SOURCES[0], 'utf8');
  assert.match(source, /src=\{item\.imageUrl\}/);
  assert.match(source, /href=\{item\.imageUrl\}/);
  // In a string literal, not in a comment: the URL comes from the API, as is.
  assert.equal(/['"`]\/media\/portfolio/.test(source), false, 'imageUrl must never be rebuilt');
});

test('captions are rendered as text, never inside a link', () => {
  const source = readFileSync(GALLERY_SOURCES[0], 'utf8');
  // The only <a> of the gallery is the thumbnail, whose href is imageUrl.
  // `<a\s`, not `<a\b`: the header comment writes « an `<a>` » in prose.
  const anchors = source.match(/<a\s[^>]*>/g) ?? [];
  assert.equal(anchors.length, 1);
  assert.match(anchors[0], /href=\{item\.imageUrl\}/);
});
