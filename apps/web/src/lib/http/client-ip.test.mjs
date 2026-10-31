import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveClientIp, withClientIp } from './client-ip.ts';

const req = (forwarded) =>
  new Request('http://web:3001/api/auth/login', {
    headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
  });

// --- The real case, observed in the D2 smoke ------------------------------------
// Production Caddyfile in front of `next start`: whether or not the client forged
// `X-Forwarded-For: 6.6.6.6, 7.7.7.7`, the route handler received exactly
// `x-forwarded-for: 172.30.10.1` (the peer Caddy saw — Docker Desktop's gateway
// in the smoke, the visitor's address on the VPS).

test('the single address Caddy writes is the one relayed (observed trace)', () => {
  assert.equal(resolveClientIp(req('172.30.10.1')), '172.30.10.1');
});

test('a public IPv4 and an IPv6 address are relayed as is', () => {
  assert.equal(resolveClientIp(req('203.0.113.7')), '203.0.113.7');
  assert.equal(resolveClientIp(req('2001:db8::1')), '2001:db8::1');
});

test('surrounding whitespace is trimmed', () => {
  assert.equal(resolveClientIp(req(' 203.0.113.7 ')), '203.0.113.7');
});

// --- Anything else fails closed (no header goes to the API) ---------------------

test('a chain is refused: production never sends one, so no entry is trusted', () => {
  assert.equal(resolveClientIp(req('6.6.6.6, 172.30.10.1')), null);
  assert.equal(resolveClientIp(req('172.30.10.1, 6.6.6.6')), null);
  assert.equal(resolveClientIp(req('6.6.6.6,7.7.7.7')), null);
});

test('missing, empty or malformed values are refused', () => {
  assert.equal(resolveClientIp(req(undefined)), null);
  assert.equal(resolveClientIp(req('')), null);
  assert.equal(resolveClientIp(req('unknown')), null);
  assert.equal(resolveClientIp(req('1.2.3.4; rm')), null);
  assert.equal(resolveClientIp(req('1'.repeat(46))), null);
});

test('withClientIp adds the header only when an address is credible', () => {
  const base = { 'content-type': 'application/json' };
  assert.deepEqual(withClientIp(base, req('203.0.113.7')), {
    ...base,
    'X-Forwarded-For': '203.0.113.7',
  });
  assert.deepEqual(withClientIp(base, req('6.6.6.6, 203.0.113.7')), base);
});
