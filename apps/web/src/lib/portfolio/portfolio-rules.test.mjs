import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PORTFOLIO_CAPTION_MAX,
  PORTFOLIO_LIMITS,
  PORTFOLIO_MAX_BYTES,
  PORTFOLIO_MAX_ITEMS,
} from './portfolio-limits.ts';
import {
  ACCEPT_ATTRIBUTE,
  NEXT_PROXY_BODY_LIMIT,
  PORTFOLIO_LIMIT_REACHED,
  UNAVAILABLE_MESSAGE,
  UNSUPPORTED_TYPE_MESSAGE,
  captionErrorMessage,
  deleteErrorMessage,
  inspectUploadRequest,
  isPortfolioFull,
  megabytesLabel,
  moveItem,
  photoCountLabel,
  portfolioFullMessage,
  preUploadCheck,
  remainingSlots,
  reorderErrorMessage,
  uploadErrorMessage,
} from './portfolio-rules.ts';

const L = PORTFOLIO_LIMITS;

test('the limits object carries the mirrored constants', () => {
  assert.deepEqual(L, {
    maxItems: PORTFOLIO_MAX_ITEMS,
    maxBytes: PORTFOLIO_MAX_BYTES,
    captionMax: PORTFOLIO_CAPTION_MAX,
  });
});

// ── 1. Error translation ──────────────────────────────────────────────────

test('upload errors: every status gives its message', () => {
  assert.equal(uploadErrorMessage(413, null, L), 'Cette photo dépasse 5 Mo.');
  assert.equal(uploadErrorMessage(415, null, L), UNSUPPORTED_TYPE_MESSAGE);
  assert.match(UNSUPPORTED_TYPE_MESSAGE, /JPEG, PNG ou WebP/);
  assert.match(UNSUPPORTED_TYPE_MESSAGE, /HEIC/);
  assert.match(UNSUPPORTED_TYPE_MESSAGE, /Le plus compatible/);
  assert.equal(uploadErrorMessage(422, null, L), 'Cette image est trop grande en pixels.');
  assert.match(uploadErrorMessage(400, null, L), /140 caractères/);
  assert.match(uploadErrorMessage(401, null, L), /session a expiré/);
  assert.match(uploadErrorMessage(404, null, L), /profil prestataire/);
  for (const status of [0, 500, 502, 503]) {
    assert.equal(uploadErrorMessage(status, null, L), UNAVAILABLE_MESSAGE, String(status));
  }
  assert.equal(
    UNAVAILABLE_MESSAGE,
    'Le service est momentanément indisponible. Réessayez plus tard.',
  );
});

test('the 409 is « portfolio full » only with the PORTFOLIO_LIMIT_REACHED code', () => {
  assert.equal(
    uploadErrorMessage(409, PORTFOLIO_LIMIT_REACHED, L),
    'Votre portfolio est complet (12 photos). Supprimez-en une pour en ajouter une autre.',
  );
  assert.equal(uploadErrorMessage(409, PORTFOLIO_LIMIT_REACHED, L), portfolioFullMessage(L));
  assert.notEqual(uploadErrorMessage(409, null, L), portfolioFullMessage(L));
  assert.notEqual(uploadErrorMessage(409, 'SOMETHING_ELSE', L), portfolioFullMessage(L));
});

test('caption, reorder and delete errors', () => {
  assert.equal(captionErrorMessage(400, L), 'La légende ne doit pas dépasser 140 caractères.');
  assert.match(captionErrorMessage(404, L), /n’existe plus/);
  assert.equal(captionErrorMessage(502, L), UNAVAILABLE_MESSAGE);
  assert.match(reorderErrorMessage(422), /réaffiché/);
  assert.match(reorderErrorMessage(400), /réaffiché/);
  assert.match(reorderErrorMessage(0), /réaffiché/);
  assert.equal(deleteErrorMessage(502), UNAVAILABLE_MESSAGE);
  assert.match(deleteErrorMessage(401), /session a expiré/);
});

test('every message says « vous », never « tu »', () => {
  const messages = [
    ...[0, 400, 401, 404, 409, 413, 415, 422, 502].map((s) =>
      uploadErrorMessage(s, s === 409 ? PORTFOLIO_LIMIT_REACHED : null, L),
    ),
    ...[400, 401, 404, 502].map((s) => captionErrorMessage(s, L)),
    ...[400, 401, 422, 502].map((s) => reorderErrorMessage(s)),
    ...[401, 502].map((s) => deleteErrorMessage(s)),
  ];
  for (const m of messages) {
    assert.equal(/\b(tu|ton|ta|tes|réessaie)\b/i.test(m), false, m);
  }
});

// ── 2. Pre-upload check ───────────────────────────────────────────────────

test('5 242 880 bytes pass, 5 242 881 are refused', () => {
  assert.equal(preUploadCheck({ size: 5242880, type: 'image/jpeg' }, L), null);
  assert.equal(
    preUploadCheck({ size: 5242881, type: 'image/jpeg' }, L),
    'Cette photo dépasse 5 Mo.',
  );
});

test('only JPEG, PNG and WebP are declared types the screen lets through', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'IMAGE/PNG']) {
    assert.equal(preUploadCheck({ size: 10, type }, L), null, type);
  }
  for (const type of ['image/heic', 'image/heif', 'image/gif', 'text/plain', 'application/pdf']) {
    assert.equal(preUploadCheck({ size: 10, type }, L), UNSUPPORTED_TYPE_MESSAGE, type);
  }
});

test('an empty declared type goes to the API, which reads the bytes', () => {
  assert.equal(preUploadCheck({ size: 10, type: '' }, L), null);
});

test('no file is refused before any call', () => {
  assert.equal(preUploadCheck(null, L), 'Choisissez une photo.');
  assert.equal(preUploadCheck(undefined, L), 'Choisissez une photo.');
});

test('the accept attribute lists the three types and nothing else', () => {
  assert.equal(ACCEPT_ATTRIBUTE, 'image/jpeg,image/png,image/webp');
});

test('megabytesLabel', () => {
  assert.equal(megabytesLabel(5242880), '5 Mo');
  assert.equal(megabytesLabel(1572864), '1,5 Mo');
});

// ── 3. New order ──────────────────────────────────────────────────────────

const IDS = ['a', 'b', 'c', 'd'];

test('moving the first up or the last down does nothing', () => {
  assert.equal(moveItem(IDS, 0, -1), null);
  assert.equal(moveItem(IDS, 3, 1), null);
  assert.equal(moveItem(['solo'], 0, 1), null);
  assert.equal(moveItem([], 0, 1), null);
});

test('an index outside the list moves nothing', () => {
  assert.equal(moveItem(IDS, -1, 1), null);
  assert.equal(moveItem(IDS, 4, -1), null);
  assert.equal(moveItem(IDS, 1.5, 1), null);
});

test('a move swaps two neighbours and keeps the exact set of ids', () => {
  assert.deepEqual(moveItem(IDS, 1, -1), ['b', 'a', 'c', 'd']);
  assert.deepEqual(moveItem(IDS, 1, 1), ['a', 'c', 'b', 'd']);
  for (let i = 0; i < IDS.length; i++) {
    for (const delta of [-1, 1]) {
      const next = moveItem(IDS, i, delta);
      if (next === null) continue;
      assert.equal(next.length, IDS.length);
      assert.deepEqual([...next].sort(), [...IDS].sort());
      assert.equal(new Set(next).size, IDS.length);
    }
  }
});

test('the input list is never mutated', () => {
  const ids = ['a', 'b'];
  moveItem(ids, 0, 1);
  assert.deepEqual(ids, ['a', 'b']);
});

// ── 4. Counter and « full » ───────────────────────────────────────────────

test('the counter agrees in number', () => {
  assert.equal(photoCountLabel(0, L), '0 photo sur 12');
  assert.equal(photoCountLabel(1, L), '1 photo sur 12');
  assert.equal(photoCountLabel(3, L), '3 photos sur 12');
  assert.equal(photoCountLabel(12, L), '12 photos sur 12');
});

test('full at 12, not before', () => {
  assert.equal(isPortfolioFull(11, L), false);
  assert.equal(isPortfolioFull(12, L), true);
  assert.equal(isPortfolioFull(13, L), true);
  assert.equal(remainingSlots(3, L), 9);
  assert.equal(remainingSlots(12, L), 0);
  assert.equal(remainingSlots(13, L), 0);
});

// ── Upload relay inspection ───────────────────────────────────────────────

const MULTIPART = 'multipart/form-data; boundary=----x';

test('a complete multipart body goes through', () => {
  assert.deepEqual(inspectUploadRequest(MULTIPART, '1000', 1000, L), { ok: true });
  // No Content-Length (chunked): nothing to compare against.
  assert.deepEqual(inspectUploadRequest(MULTIPART, null, 1000, L), { ok: true });
});

test('a non-multipart or empty body is a 400', () => {
  assert.equal(inspectUploadRequest('application/json', '10', 10, L).status, 400);
  assert.equal(inspectUploadRequest(null, '10', 10, L).status, 400);
  assert.equal(inspectUploadRequest('multipart/form-data', '10', 10, L).status, 400);
  assert.equal(inspectUploadRequest(MULTIPART, '0', 0, L).status, 400);
});

test('a body Next truncated is a 413, never forwarded', () => {
  const short = inspectUploadRequest(MULTIPART, String(NEXT_PROXY_BODY_LIMIT + 500), NEXT_PROXY_BODY_LIMIT, L);
  assert.equal(short.ok, false);
  assert.equal(short.status, 413);
  assert.equal(short.message, 'Cette photo dépasse 5 Mo.');
  // Fills the proxy buffer to the byte, length unknown → truncated too.
  assert.equal(inspectUploadRequest(MULTIPART, null, NEXT_PROXY_BODY_LIMIT, L).status, 413);
  assert.equal(NEXT_PROXY_BODY_LIMIT, 10485760);
});

// ── 5. The browser never talks to the API ─────────────────────────────────

const here = fileURLToPath(new URL('.', import.meta.url));
const webSrc = join(here, '..', '..');

function filesUnder(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

test('neither the tab nor its relays name NEXT_PUBLIC_API_URL or port 5000', () => {
  const sources = [
    join(webSrc, 'app/(app)/dashboard/_components/portfolio-section.tsx'),
    join(here, 'portfolio-rules.ts'),
    join(here, 'portfolio-limits.ts'),
    ...filesUnder(join(webSrc, 'app/api/service-providers/me/portfolio')),
  ];
  assert.ok(sources.length >= 6);
  for (const path of sources) {
    const source = readFileSync(path, 'utf8');
    assert.equal(/NEXT_PUBLIC_API_URL|localhost:5000|:5000/.test(source), false, path);
  }
});

test('the tab talks only to the web relays and shows imageUrl as given', () => {
  const source = readFileSync(
    join(webSrc, 'app/(app)/dashboard/_components/portfolio-section.tsx'),
    'utf8',
  );
  assert.match(source, /'\/api\/service-providers\/me\/portfolio'/);
  assert.match(source, /src=\{item\.imageUrl\}/);
  // In a string literal, not in a comment: the URL comes from the API, as is.
  assert.equal(/['"`]\/media\/portfolio/.test(source), false, 'imageUrl must never be rebuilt');
  assert.equal(/capture=/.test(source), false, 'no capture: gallery AND camera');
  assert.match(source, /loading="lazy"/);
});

test('there is no GET relay: the list is read by the Server Component (§13.1 nº 6)', () => {
  for (const path of filesUnder(join(webSrc, 'app/api/service-providers/me/portfolio'))) {
    assert.equal(/export async function GET/.test(readFileSync(path, 'utf8')), false, path);
  }
});
