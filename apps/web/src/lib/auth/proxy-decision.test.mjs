import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decideProxyRoute } from './proxy-decision.ts';

const decide = (pathname, { access = false, refresh = false, open = false } = {}) =>
  decideProxyRoute({ pathname, hasAccess: access, hasRefresh: refresh, isAlwaysOpen: open });

// --- `/`: the four cookie cases ------------------------------------------------

test('/ with no cookie lets through (landing), never a redirect', () => {
  assert.deepEqual(decide('/'), { kind: 'next' });
});

test('/ with the access cookie lets through (hub)', () => {
  assert.deepEqual(decide('/', { access: true }), { kind: 'next' });
  assert.deepEqual(decide('/', { access: true, refresh: true }), { kind: 'next' });
});

test('/ with only the refresh cookie refreshes, and a failure PASSES (no redirect)', () => {
  assert.deepEqual(decide('/', { refresh: true }), { kind: 'refresh', onFailure: 'pass' });
});

// --- exact match ---------------------------------------------------------------

test('paths that only start with / are not the home', () => {
  for (const path of ['//', '/x', '/recherche', '/ ', '/%2F']) {
    assert.deepEqual(decide(path), { kind: 'deny' }, path);
    assert.deepEqual(decide(path, { refresh: true }), { kind: 'refresh', onFailure: 'deny' }, path);
  }
});

// --- sign-in surfaces while signed in --------------------------------------------

test('/login and /signup send a signed-in visitor to /, not /dashboard', () => {
  assert.deepEqual(decide('/login', { access: true }), { kind: 'redirect', to: '/' });
  assert.deepEqual(decide('/signup', { access: true }), { kind: 'redirect', to: '/' });
});

test('/login and /signup stay open to anonymous visitors, with no refresh', () => {
  assert.deepEqual(decide('/login'), { kind: 'next' });
  assert.deepEqual(decide('/signup', { refresh: true }), { kind: 'next' });
});

test('the reset pages stay reachable while signed in', () => {
  assert.deepEqual(decide('/forgot-password', { access: true }), { kind: 'next' });
  assert.deepEqual(decide('/reset-password', { access: true }), { kind: 'next' });
});

// --- (app) stays protected -------------------------------------------------------

test('protected pages deny an anonymous visitor', () => {
  for (const path of ['/recherche', '/dashboard', '/requests', '/providers/new']) {
    assert.deepEqual(decide(path), { kind: 'deny' }, path);
  }
});

test('protected pages refresh and deny on failure; pass with the access cookie', () => {
  assert.deepEqual(decide('/dashboard', { refresh: true }), { kind: 'refresh', onFailure: 'deny' });
  assert.deepEqual(decide('/dashboard', { access: true }), { kind: 'next' });
});

test('protected API routes deny an anonymous caller', () => {
  assert.deepEqual(decide('/api/service-requests'), { kind: 'deny' });
});

// --- unchanged exemptions --------------------------------------------------------

test('auth BFF and always-open paths let through', () => {
  assert.deepEqual(decide('/api/auth/login'), { kind: 'next' });
  assert.deepEqual(decide('/confidentialite', { open: true }), { kind: 'next' });
});
