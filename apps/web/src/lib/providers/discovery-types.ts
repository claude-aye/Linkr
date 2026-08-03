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
 * apps/api/src/modules/services-catalog/entities/service-category.entity.ts
 */

/**
 * Catalog regulation level of a trade.
 *
 * DERIVED from the generated schema rather than hand-written, so the union can
 * never silently drift from the backend enum. `CreateServiceCategoryDto` (an
 * admin WRITE DTO) is the only place the contract spells this enum out — the
 * public read endpoint ships no schema at all — but it is the same
 * `service_category_regulation_level` enum on the same column.
 */
export type RegulationLevel =
  components['schemas']['CreateServiceCategoryDto']['regulationLevel'];

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
 * Minimal option for a trade `<select>`. `GET /service-categories` has no
 * response schema in the contract, so we read only what the selectors need.
 *
 * Shared by BOTH trade selectors — `/recherche` (geo discovery) and the
 * dashboard's « Mes métiers » form — deliberately: one mirror per endpoint, so
 * the two can never drift apart.
 *
 * `regulationLevel` really is on the wire: `listPublicCategories()` →
 * `findActivePublic()` runs a plain `find()` with NO projection, and the API
 * installs no `ClassSerializerInterceptor`, so the whole `ServiceCategory`
 * entity is serialized. It is what tells the dashboard which trades it must
 * present as non-selectable (see `add-category-form.tsx`).
 */
export interface CategoryOption {
  id: string;
  /** Trade i18n name map; resolve via `pickTranslation`. */
  nameTranslations: Record<string, string>;
  sortOrder: number;
  /** REGULATED → the API would file the claim as PENDING; INFORMAL → NOT_REQUIRED. */
  regulationLevel: RegulationLevel;
}
