// Tests des règles client de l'appel d'offres (PR 1b).
//
// `apps/web` n'a pas de banc de test : ces tests tournent sous le runner natif
// de Node, sans dépendance — `pnpm --filter @linkr/web test`. Écrits en `.mjs`
// parce qu'un fichier `.ts` qui importe `./tender-rules.ts` exigerait
// `allowImportingTsExtensions` dans le tsconfig de l'app ; le module testé, lui,
// est du TypeScript chargé tel quel par `--experimental-strip-types`.
//
// Horloge : tous les tests passent un `now` explicite, jamais `Date.now()`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEADLINE_SUBMIT_MARGIN_MINUTES,
  MAX_ESTIMATED_AMOUNT,
  assembleTender,
  ceilToQuarterHour,
  checkDesiredWindow,
  checkQuotesDeadline,
  defaultDeadline,
  hasAnyValidDeadline,
  isRelativeDeadlineAvailable,
  parseBudget,
  relativeDeadlineMs,
} from './tender-rules.ts';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// 2026-09-22 14:07:31.250 UTC — volontairement PAS sur un quart d'heure.
const NOW = Date.UTC(2026, 8, 22, 14, 7, 31, 250);

function draft(overrides = {}) {
  return {
    categoryId: '0c44ccbd-fceb-4129-b81f-3e40c02ccdd3',
    title: '  Rénover une salle de bain  ',
    description: '  Refaire la céramique.  ',
    address: '  1 rue Test, Laval  ',
    location: { lat: 45.554, lng: -73.701 },
    hasWindow: false,
    windowStartMs: null,
    windowEndMs: null,
    deadlineChoice: '7d',
    customDeadlineMs: null,
    budget: '',
    ...overrides,
  };
}

// --- Date limite au submit, avec marge -------------------------------------

test('ceilToQuarterHour keeps an exact quarter and rounds anything else UP', () => {
  const quarter = Date.UTC(2026, 8, 22, 14, 15);
  assert.equal(ceilToQuarterHour(quarter), quarter);
  assert.equal(ceilToQuarterHour(quarter + 1), quarter + 15 * MIN);
  assert.equal(ceilToQuarterHour(quarter - 1), quarter);
});

test('a relative deadline is now + duration + 15 min, rounded to the NEXT quarter hour', () => {
  // 14:07:31.250 + 48 h + 15 min = 14:22:31.250 → 14:30.
  assert.equal(relativeDeadlineMs('48h', NOW), Date.UTC(2026, 8, 24, 14, 30));
  assert.equal(relativeDeadlineMs('7d', NOW), Date.UTC(2026, 8, 29, 14, 30));
  assert.equal(relativeDeadlineMs('14d', NOW), Date.UTC(2026, 9, 6, 14, 30));
});

test('the margin keeps the 48 h option above the floor even after 14 min of latency', () => {
  const deadline = relativeDeadlineMs('48h', NOW);
  assert.ok(deadline - NOW >= 48 * HOUR + DEADLINE_SUBMIT_MARGIN_MINUTES * MIN);
  // The server measures its « now » later: still valid 14 minutes afterwards.
  assert.equal(checkQuotesDeadline(deadline, NOW + 14 * MIN, null), null);
});

test('the relative deadline is computed at SUBMIT time: an hour-old form moves it by an hour', () => {
  assert.equal(relativeDeadlineMs('48h', NOW + HOUR) - relativeDeadlineMs('48h', NOW), HOUR);
  // assembleTender uses the now it is given, not a value frozen at render.
  const early = assembleTender(draft({ deadlineChoice: '48h' }), NOW);
  const late = assembleTender(draft({ deadlineChoice: '48h' }), NOW + HOUR);
  assert.equal(early.kind, 'ready');
  assert.equal(late.kind, 'ready');
  assert.equal(
    Date.parse(late.body.quotesDeadlineUtc) - Date.parse(early.body.quotesDeadlineUtc),
    HOUR,
  );
});

// --- R1 : bornes inclusives -------------------------------------------------

test('R1 bounds are INCLUSIVE, like the server', () => {
  assert.equal(checkQuotesDeadline(NOW + 48 * HOUR, NOW, null), null);
  assert.equal(checkQuotesDeadline(NOW + 48 * HOUR - 1, NOW, null), 'too-soon');
  assert.equal(checkQuotesDeadline(NOW + 30 * DAY, NOW, null), null);
  assert.equal(checkQuotesDeadline(NOW + 30 * DAY + 1, NOW, null), 'too-far');
  const start = NOW + 10 * DAY;
  assert.equal(checkQuotesDeadline(start - 24 * HOUR, NOW, start), null);
  assert.equal(checkQuotesDeadline(start - 24 * HOUR + 1, NOW, start), 'too-close-to-start');
});

// --- Options désactivées ----------------------------------------------------

test('without a window, every relative option is available', () => {
  for (const choice of ['48h', '7d', '14d']) {
    assert.equal(isRelativeDeadlineAvailable(choice, NOW, null), true, choice);
  }
});

test('an option is disabled when the date it would produce is too close to the start', () => {
  // Start in 5 days: 48 h still fits, 7 d and 14 d do not.
  const start = NOW + 5 * DAY;
  assert.equal(isRelativeDeadlineAvailable('48h', NOW, start), true);
  assert.equal(isRelativeDeadlineAvailable('7d', NOW, start), false);
  assert.equal(isRelativeDeadlineAvailable('14d', NOW, start), false);
});

test('the 15-minute margin counts when deciding availability', () => {
  // start − 24 h lands exactly on now + 48 h: the bare 48 h would fit, but the
  // margined option (48 h 15 min, rounded) does not.
  const start = NOW + 72 * HOUR;
  assert.equal(isRelativeDeadlineAvailable('48h', NOW, start), false);
  assert.equal(hasAnyValidDeadline(NOW, start), true);
});

test('a start under 72 h leaves no valid deadline at all', () => {
  assert.equal(hasAnyValidDeadline(NOW, NOW + 72 * HOUR - 1), false);
  assert.equal(hasAnyValidDeadline(NOW, NOW + 72 * HOUR), true);
  assert.equal(hasAnyValidDeadline(NOW, null), true);
});

// --- Défaut : min(7 j, début − 24 h) -----------------------------------------

test('the default is 7 days when nothing constrains it', () => {
  assert.deepEqual(defaultDeadline(NOW, null), { choice: '7d' });
  assert.deepEqual(defaultDeadline(NOW, NOW + 20 * DAY), { choice: '7d' });
});

test('the default becomes start − 24 h when the window forces an earlier date', () => {
  const start = NOW + 5 * DAY;
  assert.deepEqual(defaultDeadline(NOW, start), {
    choice: 'custom',
    deadlineMs: start - 24 * HOUR,
  });
});

test('there is no default when the start leaves no room', () => {
  assert.deepEqual(defaultDeadline(NOW, NOW + 60 * HOUR), { choice: null });
});

// --- R2 : fenêtre -------------------------------------------------------------

test('R2: both bounds required together, end strictly after start', () => {
  const start = NOW + 10 * DAY;
  assert.equal(checkDesiredWindow(null, start + HOUR, NOW), 'missing-start');
  assert.equal(checkDesiredWindow(start, null, NOW), 'missing-end');
  assert.equal(checkDesiredWindow(start, start, NOW), 'end-not-after-start');
  assert.equal(checkDesiredWindow(start, start - 1, NOW), 'end-not-after-start');
  assert.equal(checkDesiredWindow(start, start + 1, NOW), null);
});

test('R2 has NO 24 h width ceiling — the direct-booking cap is not inherited', () => {
  const start = NOW + 10 * DAY;
  assert.equal(checkDesiredWindow(start, start + 60 * DAY, NOW), null);
});

test('a start under 72 h is refused at the start field, with the reason', () => {
  const result = assembleTender(
    draft({ hasWindow: true, windowStartMs: NOW + 60 * HOUR, windowEndMs: NOW + 90 * HOUR }),
    NOW,
  );
  assert.equal(result.kind, 'invalid');
  assert.match(result.errors.windowStart, /72 heures/);
  assert.match(result.errors.windowStart, /48 heures/);
  assert.match(result.errors.windowStart, /24 heures/);
  // The deadline is not ALSO blamed: the root cause is the start.
  assert.equal(result.errors.deadline, undefined);
});

test('a start under 72 h is the reported cause even when the end is still empty', () => {
  assert.equal(checkDesiredWindow(NOW + 48 * HOUR, null, NOW), 'start-too-soon');
  const result = assembleTender(
    draft({
      hasWindow: true,
      windowStartMs: NOW + 48 * HOUR,
      windowEndMs: null,
      // No default exists for such a start: the form sends no choice.
      deadlineChoice: null,
    }),
    NOW,
  );
  assert.equal(result.kind, 'invalid');
  assert.match(result.errors.windowStart, /72 heures/);
  assert.equal(result.errors.windowEnd, undefined);
  assert.equal(result.errors.deadline, undefined);
});

test('a window is ignored entirely when « dates flexibles » is chosen', () => {
  const result = assembleTender(
    draft({ hasWindow: false, windowStartMs: NOW + HOUR, windowEndMs: NOW }),
    NOW,
  );
  assert.equal(result.kind, 'ready');
  assert.equal(result.body.desiredStartAtUtc, undefined);
  assert.equal(result.body.desiredEndAtUtc, undefined);
});

test('a relative option violating the window is refused at submit', () => {
  const start = NOW + 5 * DAY;
  const result = assembleTender(
    draft({ hasWindow: true, windowStartMs: start, windowEndMs: start + DAY, deadlineChoice: '7d' }),
    NOW,
  );
  assert.equal(result.kind, 'invalid');
  assert.match(result.errors.deadline, /24 heures/);
});

test('a custom deadline is validated as is (no margin, no rounding)', () => {
  const custom = NOW + 3 * DAY + 7 * MIN;
  const ok = assembleTender(draft({ deadlineChoice: 'custom', customDeadlineMs: custom }), NOW);
  assert.equal(ok.kind, 'ready');
  assert.equal(ok.body.quotesDeadlineUtc, new Date(custom).toISOString());

  const tooSoon = assembleTender(
    draft({ deadlineChoice: 'custom', customDeadlineMs: NOW + 47 * HOUR }),
    NOW,
  );
  assert.equal(tooSoon.kind, 'invalid');
  assert.match(tooSoon.errors.deadline, /48 heures/);

  const missing = assembleTender(draft({ deadlineChoice: 'custom', customDeadlineMs: null }), NOW);
  assert.equal(missing.kind, 'invalid');
  assert.ok(missing.errors.deadline);
});

// --- R4 : paire budget --------------------------------------------------------

test('an empty budget sends NEITHER amount NOR currency', () => {
  for (const raw of ['', '   ', ' ']) {
    const result = assembleTender(draft({ budget: raw }), NOW);
    assert.equal(result.kind, 'ready');
    assert.equal('estimatedAmount' in result.body, false);
    assert.equal('estimatedCurrency' in result.body, false);
  }
});

test('a filled budget sends the amount AND the pinned currency CAD', () => {
  const result = assembleTender(draft({ budget: '1 500,50' }), NOW);
  assert.equal(result.kind, 'ready');
  assert.equal(result.body.estimatedAmount, 1500.5);
  assert.equal(result.body.estimatedCurrency, 'CAD');
});

test('parseBudget accepts the Québec formats and refuses the rest', () => {
  assert.deepEqual(parseBudget('1500'), { kind: 'ok', amount: 1500 });
  assert.deepEqual(parseBudget('1500.5'), { kind: 'ok', amount: 1500.5 });
  assert.deepEqual(parseBudget('1 500,25'), { kind: 'ok', amount: 1500.25 });
  assert.deepEqual(parseBudget('0'), { kind: 'invalid', reason: 'not-positive' });
  assert.deepEqual(parseBudget('0,00'), { kind: 'invalid', reason: 'not-positive' });
  assert.deepEqual(parseBudget('12,345'), { kind: 'invalid', reason: 'format' });
  assert.deepEqual(parseBudget('-5'), { kind: 'invalid', reason: 'format' });
  assert.deepEqual(parseBudget('abc'), { kind: 'invalid', reason: 'format' });
  assert.deepEqual(parseBudget('1,5,0'), { kind: 'invalid', reason: 'format' });
  assert.deepEqual(parseBudget(String(MAX_ESTIMATED_AMOUNT)), {
    kind: 'ok',
    amount: MAX_ESTIMATED_AMOUNT,
  });
  assert.deepEqual(parseBudget('10000000000'), { kind: 'invalid', reason: 'too-large' });
});

test('an invalid budget is reported at the budget field', () => {
  const result = assembleTender(draft({ budget: '0' }), NOW);
  assert.equal(result.kind, 'invalid');
  assert.ok(result.errors.budget);
});

// --- Blocage sans adresse géocodée -------------------------------------------

test('without a PICKED geocoded candidate, nothing is ever ready to post', () => {
  const result = assembleTender(draft({ location: null }), NOW);
  assert.deepEqual(result, { kind: 'needs-location' });
});

test('field errors are reported BEFORE asking for a location', () => {
  const result = assembleTender(draft({ location: null, title: '   ' }), NOW);
  assert.equal(result.kind, 'invalid');
  assert.ok(result.errors.title);
});

test('the posted body is GEOCODED, [lng, lat], trimmed, and carries no booking field', () => {
  const result = assembleTender(draft(), NOW);
  assert.equal(result.kind, 'ready');
  const { body } = result;
  assert.equal(body.requestType, 'PROJECT_TENDER');
  assert.equal(body.serviceLocationPrecision, 'GEOCODED');
  assert.deepEqual(body.serviceLocation, { type: 'Point', coordinates: [-73.701, 45.554] });
  assert.equal(body.title, 'Rénover une salle de bain');
  assert.equal(body.description, 'Refaire la céramique.');
  assert.equal(body.serviceAddress, '1 rue Test, Laval');
  for (const key of ['serviceItemId', 'requestedServiceProviderId', 'responseDeadlineUtc']) {
    assert.equal(key in body, false, key);
  }
});

test('a window, when valid, travels as two UTC instants', () => {
  const start = NOW + 10 * DAY;
  const end = start + 3 * DAY;
  const result = assembleTender(
    draft({ hasWindow: true, windowStartMs: start, windowEndMs: end }),
    NOW,
  );
  assert.equal(result.kind, 'ready');
  assert.equal(result.body.desiredStartAtUtc, new Date(start).toISOString());
  assert.equal(result.body.desiredEndAtUtc, new Date(end).toISOString());
});

test('the missing fields are each reported at their own field', () => {
  const result = assembleTender(
    draft({ categoryId: '', title: '', description: '', address: '', deadlineChoice: null }),
    NOW,
  );
  assert.equal(result.kind, 'invalid');
  for (const field of ['category', 'title', 'description', 'address', 'deadline']) {
    assert.ok(result.errors[field], field);
  }
});
