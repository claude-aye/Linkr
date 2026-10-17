import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  PORTFOLIO_MEDIA_PREFIX,
  isPortfolioMediaPath,
  isValidItemId,
  relayPortfolioImage,
} from './portfolio-media.ts';

const ID = '0b6f1c2e-3d4a-4b5c-8d6e-7f8091a2b3c4';
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);

const apiImage = () =>
  new Response(WEBP, {
    status: 200,
    headers: {
      'content-type': 'image/webp',
      'content-length': String(WEBP.length),
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'x-powered-by': 'Express',
      'set-cookie': 'leak=1',
    },
  });

test('the prefix is the one the API returns as imageUrl', () => {
  assert.equal(PORTFOLIO_MEDIA_PREFIX, '/media/portfolio/');
});

test('isPortfolioMediaPath: one segment after the prefix, nothing deeper', () => {
  assert.equal(isPortfolioMediaPath(`/media/portfolio/${ID}`), true);
  // Let through by the proxy; the route itself answers 404.
  assert.equal(isPortfolioMediaPath('/media/portfolio/anything'), true);
  assert.equal(isPortfolioMediaPath('/media/portfolio/'), false);
  assert.equal(isPortfolioMediaPath(`/media/portfolio/${ID}/x`), false);
  assert.equal(isPortfolioMediaPath('/media/other/x'), false);
  assert.equal(isPortfolioMediaPath('/dashboard'), false);
});

test('isValidItemId accepts a uuid and nothing else', () => {
  assert.equal(isValidItemId(ID), true);
  assert.equal(isValidItemId(ID.toUpperCase()), true);
  assert.equal(isValidItemId('not-a-uuid'), false);
  assert.equal(isValidItemId(`${ID}x`), false);
  assert.equal(isValidItemId('../../etc/passwd'), false);
});

test('a malformed id is a 404 and the API is never called', async () => {
  let called = false;
  const res = await relayPortfolioImage('nope', async () => {
    called = true;
    return apiImage();
  });
  assert.equal(res.status, 404);
  assert.equal(called, false);
});

test('a 200 relays the body untouched and only the four allowed headers', async () => {
  let asked;
  const res = await relayPortfolioImage(ID, async (id) => {
    asked = id;
    return apiImage();
  });
  assert.equal(asked, ID);
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), WEBP);
  assert.equal(res.headers.get('content-type'), 'image/webp');
  assert.equal(res.headers.get('content-length'), String(WEBP.length));
  assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('set-cookie'), null);
});

test('an API 404 is relayed as 404, uncached, with no body', async () => {
  const res = await relayPortfolioImage(ID, async () =>
    new Response(JSON.stringify({ statusCode: 404 }), { status: 404 }),
  );
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await res.arrayBuffer()).byteLength, 0);
});

test('an unreachable API is a 502', async () => {
  const res = await relayPortfolioImage(ID, async () => {
    throw new Error('ECONNREFUSED');
  });
  assert.equal(res.status, 502);
});

// The browser must never be sent to the API: the relay and its route file name
// neither the API's variable nor its port. (They are read once, server-side,
// in `lib/auth/session.ts`.)
test('neither the relay nor its route names NEXT_PUBLIC_API_URL or port 5000', () => {
  for (const rel of [
    './portfolio-media.ts',
    '../../app/media/portfolio/[itemId]/route.ts',
  ]) {
    const source = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.equal(/NEXT_PUBLIC_API_URL|localhost:5000|:5000/.test(source), false, rel);
  }
});
