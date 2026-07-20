import type { components } from '@linkr/api-client';

/**
 * Geo-discovery types (Phase 3.14a).
 *
 * TWO generated-contract gaps force local shapes here — the same justified
 * escape hatch as `lib/auth/types.ts` and the mirrors in `lib/providers/types.ts`:
 *
 * 1. THE ENVELOPE LIES. `GET /service-providers/discover` is annotated in
 *    `schema.d.ts` as a BARE array `DiscoveredProviderDto[]`, but the runtime
 *    returns a pagination envelope `{ items, total, page, limit }` (ground-truth
 *    smoke on the real stack). Same class of quirk already fixed at the contract
 *    for other endpoints (#23, 3.12a-back-fix, 3.13-A). 3.14a is FRONT-PURE, so
 *    we do NOT touch the backend: we mirror the envelope and TRACK the debt
 *    (« fix contrat discover (annotation → DTO d'enveloppe) », CLAUDE.md).
 *
 * 2. NULLABLE SCALARS DEGRADE. The item's `displayName` / `headline` degrade to
 *    `Record<string, never> | null` (backend `@ApiPropertyOptional` without a
 *    concrete type — the JSONB/nullable quirk of CLAUDE.md §6). We SURGICALLY
 *    re-type ONLY those two to their real `string | null` shape; every other
 *    field (the enums, the numbers) stays DERIVED from the generated schema so
 *    it can never silently drift.
 *
 * `GET /service-categories` ships no response schema at all (`content: never`)
 * and returns a bare array, so the trade selector reads a minimal local
 * `CategoryOption` too — only the fields the `<select>` needs.
 *
 * Source of truth:
 * apps/api/src/modules/service-providers/dto/discovered-provider.dto.ts
 */

/** One discovered provider — the real runtime shape of a `discover` item. */
export type DiscoveredProvider = Omit<
  components['schemas']['DiscoveredProviderDto'],
  'displayName' | 'headline'
> & {
  /** Public name (business_name → organization.display_name). Nullable. */
  displayName: string | null;
  /** LinkedIn-style tagline — hidden entirely when null. */
  headline: string | null;
};

/** Pagination envelope actually returned at runtime by `discover`. */
export interface DiscoveredProviderList {
  items: DiscoveredProvider[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Minimal option for the trade `<select>`. `GET /service-categories` has no
 * response schema in the contract, so we read only what the selector needs.
 */
export interface CategoryOption {
  id: string;
  /** Trade i18n name map; resolve via `pickTranslation`. */
  nameTranslations: Record<string, string>;
  sortOrder: number;
}
