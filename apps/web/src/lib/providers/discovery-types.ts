import type { components } from '@linkr/api-client';

/**
 * Catalogue types shared by the trade selectors (Phase 3.14a).
 *
 * `GET /service-providers/discover` is no longer mirrored here: since R2a its
 * contract is a real `DiscoveredProviderListDto` envelope with concrete
 * nullable types, consumed natively from `@linkr/api-client`.
 *
 * `GET /service-categories` still ships no response schema at all
 * (`content: never`) and returns a bare array, so the trade selector reads a
 * minimal local `CategoryOption` — only the fields the `<select>` needs.
 *
 * Source of truth:
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
  /**
   * URL slug (`plomberie`, `coiffure`…) — the key of
   * `GET /service-categories/{slug}/items`, which the dashboard's « Mes
   * services » reads per declared trade. On the wire for the same reason as
   * `regulationLevel` below (whole entity serialized).
   */
  slug: string;
  /** Trade i18n name map; resolve via `pickTranslation`. */
  nameTranslations: Record<string, string>;
  sortOrder: number;
  /** REGULATED → the API would file the claim as PENDING; INFORMAL → NOT_REQUIRED. */
  regulationLevel: RegulationLevel;
}

/**
 * One APPROVED catalogue item of a trade, as returned by
 * `GET /service-categories/{slug}/items` (approved, active, non-deleted, by
 * `sortOrder` then creation). Same contract gap as `GET /service-categories`:
 * no response schema (`content: never`), the whole `ServiceItem` entity is
 * serialized — so a minimal mirror of what « Mes services » reads.
 *
 * Source of truth:
 * apps/api/src/modules/services-catalog/entities/service-item.entity.ts
 */
export interface CatalogServiceItem {
  id: string;
  /** Item i18n name map; resolve via `pickTranslation`. */
  nameTranslations: Record<string, string>;
  sortOrder: number;
}
