import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  boundsFor,
  buildProviderFeatureCollection,
  mapFallbackReason,
  resultElementId,
  withMapTilerKey,
} from './map-data.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

test('features are [lng, lat] — longitude first', () => {
  const fc = buildProviderFeatureCollection([
    { id: 'a', approximateLocation: { lat: 46.7775, lng: -71.27355 } },
  ]);
  assert.equal(fc.type, 'FeatureCollection');
  assert.deepEqual(fc.features[0].geometry.coordinates, [-71.27355, 46.7775]);
  assert.equal(fc.features[0].id, 'a');
  assert.deepEqual(fc.features[0].properties, { id: 'a' });
});

test('a provider without an approximate location is left off the map', () => {
  const fc = buildProviderFeatureCollection([
    { id: 'a', approximateLocation: null },
    { id: 'b', approximateLocation: { lat: 46.8, lng: -71.2 } },
    { id: 'c', approximateLocation: { lat: Number.NaN, lng: -71.2 } },
    { id: 'd', approximateLocation: { lat: 46.8, lng: Number.POSITIVE_INFINITY } },
  ]);
  assert.deepEqual(
    fc.features.map((f) => f.id),
    ['b'],
  );
});

test('providers of one cell keep the SAME coordinate (clustered, never spread)', () => {
  const cell = { lat: 46.7775, lng: -71.27355 };
  const fc = buildProviderFeatureCollection([
    { id: 'a', approximateLocation: cell },
    { id: 'b', approximateLocation: { ...cell } },
  ]);
  assert.deepEqual(fc.features[0].geometry.coordinates, fc.features[1].geometry.coordinates);
});

test('features carry only the id — no name, no distance, no other field', () => {
  const fc = buildProviderFeatureCollection([
    {
      id: 'a',
      approximateLocation: { lat: 1, lng: 2 },
      displayName: 'Dana',
      distanceMeters: 200,
    },
  ]);
  assert.deepEqual(Object.keys(fc.features[0]).sort(), ['geometry', 'id', 'properties', 'type']);
  assert.deepEqual(Object.keys(fc.features[0].properties), ['id']);
});

test('empty list → empty collection', () => {
  assert.deepEqual(buildProviderFeatureCollection([]), { type: 'FeatureCollection', features: [] });
});

test('fallback: missing or blank key wins over everything', () => {
  assert.equal(mapFallbackReason(undefined, true), 'missing-key');
  assert.equal(mapFallbackReason(null, true), 'missing-key');
  assert.equal(mapFallbackReason('', true), 'missing-key');
  assert.equal(mapFallbackReason('   ', false), 'missing-key');
});

test('fallback: no WebGL', () => {
  assert.equal(mapFallbackReason('k', false), 'no-webgl');
});

test('fallback: none with a key and WebGL', () => {
  assert.equal(mapFallbackReason('k', true), null);
});

test('the key is added to MapTiler URLs only', () => {
  assert.equal(
    withMapTilerKey('https://api.maptiler.com/tiles/v3/tiles.json', 'K'),
    'https://api.maptiler.com/tiles/v3/tiles.json?key=K',
  );
  assert.equal(
    withMapTilerKey('https://api.maptiler.com/tiles/v3/1/2/3.pbf?mtsid=x', 'K'),
    'https://api.maptiler.com/tiles/v3/1/2/3.pbf?mtsid=x&key=K',
  );
  assert.equal(withMapTilerKey('https://tile.openstreetmap.org/1/2/3.png', 'K'),
    'https://tile.openstreetmap.org/1/2/3.png');
  assert.equal(withMapTilerKey('http://api.maptiler.com/x', 'K'), 'http://api.maptiler.com/x');
  assert.equal(withMapTilerKey('https://api.maptiler.com.evil.test/x', 'K'),
    'https://api.maptiler.com.evil.test/x');
  assert.equal(withMapTilerKey('not a url', 'K'), 'not a url');
});

test('a URL that already has a key keeps it; placeholders survive', () => {
  assert.equal(withMapTilerKey('https://api.maptiler.com/x?key=A', 'K'), 'https://api.maptiler.com/x?key=A');
  assert.equal(
    withMapTilerKey('https://api.maptiler.com/fonts/{fontstack}/{range}.pbf', 'K'),
    'https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=K',
  );
});

test('bounds enclose every finite point', () => {
  assert.deepEqual(
    boundsFor([
      [-71.27, 46.77],
      [-71.52, 46.85],
      [-71.2, 46.94],
      [Number.NaN, 0],
    ]),
    { west: -71.52, south: 46.77, east: -71.2, north: 46.94 },
  );
  assert.equal(boundsFor([]), null);
});

test('result element id is stable', () => {
  assert.equal(resultElementId('abc'), 'resultat-abc');
});

test('the versioned style never contains a key, and only MapTiler sources', () => {
  const raw = readFileSync(join(here, 'linkr-light.style.json'), 'utf8');
  assert.doesNotMatch(raw, /key=/i);
  assert.doesNotMatch(raw, /openstreetmap\.org\/\{z\}|tile\.openstreetmap/);
  const style = JSON.parse(raw);
  for (const source of Object.values(style.sources)) {
    if (source.url) assert.match(source.url, /^https:\/\/api\.maptiler\.com\//);
  }
  assert.match(style.glyphs, /^https:\/\/api\.maptiler\.com\//);
});

test('the module imports nothing (web-tests contract)', () => {
  const src = readFileSync(join(here, 'map-data.ts'), 'utf8');
  assert.doesNotMatch(src, /^\s*import\s/m);
});
