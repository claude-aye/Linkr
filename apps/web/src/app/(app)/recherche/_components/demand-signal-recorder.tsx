'use client';

import { useEffect } from 'react';

/**
 * Records that this search found nobody — the only client island on `/recherche`,
 * and it renders nothing.
 *
 * ⚠️ WHY AN ISLAND AND NOT THE SERVER COMPONENT THAT ALREADY KNOWS THE ANSWER.
 * `/recherche` establishes `total === 0` while rendering. Writing from there
 * would count link prefetches, double renders, `router.refresh()` and
 * back-navigations — a demand map built on renders measures the browser, not the
 * market. So the write is an explicit POST mutation, and it is mounted only in
 * the zero branch: a failed `discover` renders « Recherche impossible » instead
 * and this component never exists, so a 5xx can never be mistaken for an absence
 * of supply. (The API re-verifies the claim anyway — belt and braces.)
 *
 * A `<Link>` prefetch cannot fire it either: prefetch fetches the RSC payload and
 * downloads chunks, it never mounts a client component or runs its effects.
 *
 * ⚠️ DEDUP LIVES HERE BECAUSE IT CANNOT LIVE ON THE SERVER. Telling « the same
 * search seen twice » from « two people searching the same thing » needs to know
 * who is asking, and a demand signal deliberately carries no identity. The
 * browser session is the only place that can hold the distinction without an
 * identifier. THE UNIT OF MEASURE IS ONE SIGNAL PER SEARCH PER BROWSING SESSION,
 * never one per render.
 *
 * Two guards, on purpose, keyed identically:
 *  - a module-level Set, which survives soft navigation (the module stays loaded)
 *    and absorbs React's double-mount in development;
 *  - `sessionStorage`, which additionally survives a hard reload, F5 and the
 *    back/forward cache — where the in-memory Set is gone.
 * Both are marked BEFORE the request is sent, so a re-render mid-flight cannot
 * race a second one out.
 *
 * The key is the EXACT searched coordinate, not the stored sector: the identity
 * of « the same search » is the URL the user is looking at. Two distinct points
 * inside one sector are two searches; the coarsening is a storage property, not a
 * counting one.
 *
 * Fire-and-forget: nothing on screen depends on the outcome, so failures are
 * swallowed. `keepalive` lets the request outlive an immediate navigation.
 */

/** Searches already signalled in this page session. */
const signalled = new Set<string>();

function searchKey(categoryId: string, lat: number, lng: number): string {
  return `linkr:demand-signal:${categoryId}:${lat}:${lng}`;
}

export function DemandSignalRecorder({
  categoryId,
  lat,
  lng,
}: {
  categoryId: string;
  /** The exact searched coordinate — the API rounds it before storing. */
  lat: number;
  lng: number;
}) {
  useEffect(() => {
    const key = searchKey(categoryId, lat, lng);
    if (signalled.has(key)) return;

    // `sessionStorage` throws in some privacy modes; a failure there degrades to
    // the in-memory guard alone rather than dropping the signal entirely.
    try {
      if (window.sessionStorage.getItem(key) !== null) {
        signalled.add(key);
        return;
      }
      window.sessionStorage.setItem(key, '1');
    } catch {
      /* no persistent guard available — the Set below still holds */
    }
    signalled.add(key);

    void fetch('/api/demand-signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId, lat, lng }),
      keepalive: true,
    }).catch(() => {
      /* the map losing one signal must never disturb the page */
    });
  }, [categoryId, lat, lng]);

  return null;
}
