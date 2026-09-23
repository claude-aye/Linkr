/**
 * The hybrid-geo eligibility predicate (CLAUDE.md §5.3) — the single source of
 * truth for "does this provider cover this point for this trade?".
 *
 * ⚠️ THIS EXISTS SO THE PREDICATE HAS EXACTLY ONE SOURCE, READ IN BOTH
 * DIRECTIONS. Three callers now ask the same question from two opposite ends:
 *
 *   • point → providers   discovery, the tender fan-out, and the demand-signal
 *                         verification all start from a client coordinate and
 *                         ask which providers qualify;
 *   • provider → points   the tender feed starts from ONE provider and asks
 *                         which open tenders it qualifies for.
 *
 * Writing the second direction as its own "mirror" query would have been
 * shorter and would have worked on the day it was written. It is also exactly
 * how a coverage rule drifts: the mirror could forget `psc.is_active`, keep
 * `ST_Contains` instead of `ST_Covers`, or drop the zone branch — and nothing
 * would fail. A provider would simply stop seeing tenders that the search
 * engine says are his, with no error anywhere, and the two surfaces would
 * disagree about the same fact.
 *
 * What changes between the callers is the EXPRESSION of the point and of the
 * category — not the rule. So those are the parameters, and the rule is not.
 *
 * ⚠️ BOTH ARGUMENTS ARE SQL, AND THEY ARE COMPILE-TIME LITERALS, NEVER REQUEST
 * DATA. That is enforced by the type system rather than by this comment: the
 * parameters are unions of the literal constants declared below, so a plain
 * `string` — which is what any caller-supplied value would be — does not
 * compile. A fourth call site must add its expression HERE, in the file that
 * carries the alias contract, instead of interpolating at its own call site.
 */

/** Client coordinate bound as `$1` = lng, `$2` = lat. */
export const ELIGIBILITY_POINT_FROM_PARAMS =
  'ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography' as const;

/** Trade bound as `$3`. */
export const ELIGIBILITY_CATEGORY_FROM_PARAM = '$3' as const;

/**
 * The tender's own coordinate, read from the enclosing query's `sr` row.
 *
 * ⚠️ THE `::geography` CAST IS NOT COSMETIC. `service_requests.service_location`
 * is `geometry(Point, 4326)` while `service_providers.service_base_location` and
 * `professional_service_zones.zone_polygon` are `geography` — the spatial
 * functions below would otherwise resolve to their geometry overloads, where
 * `ST_DWithin`'s distance is in DEGREES and not metres. That is a silently wrong
 * answer, not an error. See the debt note in CLAUDE.md §6 about what the cast
 * costs on the index side.
 */
export const ELIGIBILITY_POINT_FROM_TENDER =
  'sr.service_location::geography' as const;

/** The tender's own trade, read from the enclosing query's `sr` row. */
export const ELIGIBILITY_CATEGORY_FROM_TENDER =
  'sr.service_category_id' as const;

export type EligibilityPointExpr =
  | typeof ELIGIBILITY_POINT_FROM_PARAMS
  | typeof ELIGIBILITY_POINT_FROM_TENDER;

export type EligibilityCategoryExpr =
  | typeof ELIGIBILITY_CATEGORY_FROM_PARAM
  | typeof ELIGIBILITY_CATEGORY_FROM_TENDER;

/**
 * Aliases this fragment declares: `sp` (the candidate provider), `psc` (its
 * claim on the trade) and `z` (its named zones, scoped to a nested EXISTS).
 *
 * ⚠️ AN EMBEDDING QUERY MUST NOT REUSE THESE. The tender feed embeds the whole
 * fragment inside an `EXISTS` and correlates back to its own `sr` row through
 * the point/category expressions above; reusing `sp` outside would shadow the
 * candidate and turn the EXISTS into a tautology. The feed therefore names the
 * calling provider `me`, and its other aliases (`sr`, `sc`, `mq`, `q`) are
 * disjoint from these three by construction.
 *
 * ⚠️ THE `organizations` JOIN IS DELIBERATELY ABSENT. It only ever served
 * discovery's `display_name` fallback, which is a projection concern and not an
 * eligibility one; discovery recovers it with a correlated scalar subquery on
 * the same FK. Keeping it here would drag a fourth alias into every EXISTS that
 * embeds this, for a column no eligibility test reads.
 *
 * `service_radius_km = 0` ⇒ `ST_DWithin(..., 0)` is false, so such a provider is
 * retained only through a covering zone — the OR handles that naturally.
 */
export function eligibilityFromWhere(
  point: EligibilityPointExpr,
  category: EligibilityCategoryExpr,
): string {
  return `
      FROM service_providers sp
      INNER JOIN professional_service_categories psc
        ON psc.service_provider_id = sp.id
        AND psc.service_category_id = ${category}
        AND psc.verification_status IN ('VERIFIED', 'NOT_REQUIRED')
        AND psc.is_active = true
        AND psc.deleted_at_utc IS NULL
      WHERE sp.is_active = true
        AND sp.deleted_at_utc IS NULL
        AND (
          ST_DWithin(sp.service_base_location, ${point}, sp.service_radius_km * 1000)
          OR EXISTS (
            SELECT 1 FROM professional_service_zones z
            WHERE z.service_provider_id = sp.id
              AND z.deleted_at_utc IS NULL
              AND ST_Covers(z.zone_polygon, ${point})
          )
        )
    `;
}
