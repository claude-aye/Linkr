import type { components } from '@linkr/api-client';

/**
 * The address → coordinates transport, shared by every form that needs it.
 *
 * It is the EXISTING phase-3.14 chain, not a second one: same BFF relay
 * (`app/api/geocode/route.ts` → `GET /geocode`), same generated contract types,
 * same three-way classification that `create-request-form.tsx` performs inline.
 * Only the transport + classification live here; what a form DOES with an
 * unresolved address is policy and stays in the form:
 *
 *   - the request form degrades (searched area, then the Québec placeholder) —
 *     a blocked client is a lost client;
 *   - the provider form BLOCKS — a provider's base location decides which city
 *     he shows up in, and a silent fallback would make him invisible to his real
 *     neighbours.
 *
 * Debt (tracked, NOT fixed here): `create-request-form.tsx` still carries its own
 * inline copy of this transport. Converging it onto this module means touching
 * that form's degradation logic, which is out of this PR's scope. This module is
 * where it should converge.
 */

/** Straight from the generated contract — 3.14b-back typed it honestly. */
export type GeocodeCandidate = components['schemas']['GeocodeCandidateDto'];
type GeocodeResult = components['schemas']['GeocodeResultDto'];

/**
 * The three — and only three — outcomes of geocoding an address.
 *
 * `no-match`: the service answered and placed nothing (truncated address, typo).
 * A statement about the ADDRESS.
 * `unavailable`: a technical failure — non-2xx (including an expired session's
 * relayed 401), network error, unreadable payload. A statement about US, never
 * about the address the user typed. The distinction drives the copy and the
 * remedy offered (correct the address vs. retry).
 */
export type GeocodeOutcome =
  | { kind: 'candidates'; candidates: GeocodeCandidate[] }
  | { kind: 'no-match' }
  | { kind: 'unavailable' };

/**
 * Geocodes `address` through the BFF relay. Never throws, never posts anything,
 * never picks a « best match » — the geocoder proposes, the user disposes
 * (locked since 3.14b).
 */
export async function geocodeAddress(address: string): Promise<GeocodeOutcome> {
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(address)}`);
    if (!res.ok) {
      return { kind: 'unavailable' };
    }
    const body = (await res.json()) as GeocodeResult;
    const candidates = body?.candidates;
    if (!Array.isArray(candidates)) {
      // Well-formed HTTP, malformed payload → a technical failure too.
      return { kind: 'unavailable' };
    }
    return candidates.length > 0
      ? { kind: 'candidates', candidates }
      : { kind: 'no-match' };
  } catch {
    // Network error, or a body that is not readable JSON.
    return { kind: 'unavailable' };
  }
}
