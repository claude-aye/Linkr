import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiBaseUrl, DEV_API_BASE_URL } from './api-base-url.ts';

test('valeur fournie : retournée telle quelle, en production aussi', () => {
  assert.equal(resolveApiBaseUrl('https://api.example.com', 'production'), 'https://api.example.com');
});

test('développement sans variable : repli localhost', () => {
  assert.equal(resolveApiBaseUrl(undefined, 'development'), DEV_API_BASE_URL);
  assert.equal(resolveApiBaseUrl('', undefined), DEV_API_BASE_URL);
});

test('production sans variable (absente, vide ou blanche) : erreur claire', () => {
  for (const v of [undefined, '', '   ']) {
    assert.throws(() => resolveApiBaseUrl(v, 'production'), /NEXT_PUBLIC_API_URL is required in production/);
  }
});
