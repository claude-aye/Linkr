import { FixedWindowCounter } from './fixed-window-counter';

const LIMIT = 3;
const WINDOW_MS = 1000;

describe('FixedWindowCounter', () => {
  let counter: FixedWindowCounter;

  beforeEach(() => {
    counter = new FixedWindowCounter();
  });

  const hit = (key: string, now: number) =>
    counter.hit(key, LIMIT, WINDOW_MS, now);

  it('allows exactly `limit` requests inside one window, then refuses', () => {
    expect(hit('a', 0).allowed).toBe(true);
    expect(hit('a', 100).allowed).toBe(true);
    expect(hit('a', 200).allowed).toBe(true);
    expect(hit('a', 300).allowed).toBe(false);
  });

  it('meters each key independently', () => {
    hit('a', 0);
    hit('a', 0);
    hit('a', 0);
    expect(hit('a', 0).allowed).toBe(false);
    // A different caller is untouched by the first one's spent budget.
    expect(hit('b', 0).allowed).toBe(true);
  });

  it('opens a fresh window once the previous one has closed', () => {
    hit('a', 0);
    hit('a', 0);
    hit('a', 0);
    expect(hit('a', 999).allowed).toBe(false);
    expect(hit('a', 1000).allowed).toBe(true);
  });

  it('does NOT push the reset further away when a refused caller keeps trying', () => {
    // The lock-out property: hammering a closed window must not extend it, or a
    // caller who retries would never get back in.
    hit('a', 0);
    hit('a', 0);
    hit('a', 0);
    for (let t = 300; t < 1000; t += 100) {
      expect(hit('a', t).allowed).toBe(false);
    }
    expect(hit('a', 1000).allowed).toBe(true);
  });

  it('reports whole seconds until the window reopens, never below 1', () => {
    hit('a', 0);
    hit('a', 0);
    hit('a', 0);
    // 700 ms left → rounded up to 1 s.
    expect(hit('a', 300).retryAfterSeconds).toBe(1);
    // 1 ms left still asks for 1 s rather than inviting an instant retry.
    expect(hit('a', 999).retryAfterSeconds).toBe(1);
  });

  it('reports a retry delay spanning several seconds on a longer window', () => {
    const verdict = counter.hit('a', 1, 10_000, 0);
    expect(verdict.allowed).toBe(true);
    expect(counter.hit('a', 1, 10_000, 2_500).retryAfterSeconds).toBe(8);
  });

  it('evicts closed windows so the map cannot grow without bound', () => {
    for (let i = 0; i < 50; i += 1) {
      hit(`caller-${i}`, 0);
    }
    expect(counter.size).toBe(50);

    // One request a full window later sweeps every key that has since closed.
    hit('caller-0', WINDOW_MS);
    expect(counter.size).toBe(1);
  });

  it('keeps still-open windows when it sweeps', () => {
    hit('old', 0);
    hit('recent', 900);
    // Sweeps at 1000: `old` closed at 1000, `recent` stays open until 1900.
    hit('trigger', 1000);
    expect(counter.size).toBe(2);
    // `recent` kept its count rather than being reset by the sweep.
    hit('recent', 1000);
    hit('recent', 1000);
    expect(hit('recent', 1000).allowed).toBe(false);
  });
});
