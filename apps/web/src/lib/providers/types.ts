import type { components } from '@linkr/api-client';

/**
 * Provider-dashboard types (Phase 3.12-front).
 *
 * One generated-type gap forces local mirrors here (the same justified
 * exception as `lib/auth/types.ts` and `lib/verifications/types.ts`):
 *
 * `ServiceProviderResponseDto` / `ProviderServiceRequestItemDto` degrade
 * their nullable fields to `Record<string, never> | null` in `schema.d.ts`
 * (backend `@ApiProperty({ nullable: true })` without a concrete type —
 * known JSONB/nullable quirk, cf. CLAUDE.md §6 tech debt). The interfaces
 * below mirror the real backend DTOs with faithful `string | null` types.
 *
 * NB: the pagination envelope of
 * `GET /service-providers/{id}/service-requests` is now typed natively by the
 * generated `ProviderServiceRequestListDto` (contract fixed — the endpoint no
 * longer lies with `isArray`), so no local envelope mirror is needed; only the
 * item shape is still mirrored for the nullable quirk above.
 *
 * Source of truth:
 * apps/api/src/modules/service-providers/dto/service-provider-response.dto.ts
 * apps/api/src/modules/service-requests/dto/provider-service-request-item.dto.ts
 */

/** Status/type unions — derived from the generated schema, NOT hand-mirrored. */
export type ServiceRequestStatus =
  components['schemas']['ProviderServiceRequestItemDto']['status'];
export type ServiceRequestType =
  components['schemas']['ProviderServiceRequestItemDto']['requestType'];

/** GeoJSON Point as serialized by the API — coordinates are [lng, lat]. */
export interface GeoJsonPoint {
  type: 'Point';
  coordinates: number[];
}

/**
 * Mirror of `ServiceProviderResponseDto` (shared by `GET /service-providers/me`
 * and `GET /service-providers/{id}`). Every `*Utc` field is a `Date`
 * server-side but crosses the JSON boundary as an ISO-8601 string.
 */
export interface ProviderProfile {
  id: string;
  providerType: 'INDIVIDUAL' | 'ORGANIZATION';
  userId: string | null;
  organizationId: string | null;
  /** Resolved business name (falls back to organization.display_name for orgs). */
  businessName: string | null;
  headline: string | null;
  bio: string | null;
  serviceBaseLocation: GeoJsonPoint;
  serviceRadiusKm: number;
  isActive: boolean;
  activatedAtUtc: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
}

/**
 * Public bookable-service item — the response element of
 * `GET /service-providers/{providerId}/services` (Phase 3.13-2-front).
 *
 * UNLIKE `ProviderProfile`, this is NOT a full hand-mirror: the generated
 * `ProviderServiceCatalogItemDto` types its two i18n maps NATIVELY as
 * `Record<string, string>` (the backend annotates them with
 * `additionalProperties`), so we consume the generated type as-is. We only
 * SURGICALLY override its three nullable SCALARS — `priceAmount`,
 * `estimatedDurationMinutes`, `descriptionOverride` — which still degrade to
 * `Record<string, never>` in `schema.d.ts` (backend `@ApiPropertyOptional()`
 * without a concrete type — the JSONB/nullable quirk of CLAUDE.md §6, left
 * explicitly OPEN by 3.13-2a-back). At runtime `priceAmount` /
 * `estimatedDurationMinutes` are numbers and `descriptionOverride` a string.
 *
 * Source of truth:
 * apps/api/src/modules/service-providers/dto/provider-service-catalog-item.dto.ts
 */
export type ProviderCatalogItem = Omit<
  components['schemas']['ProviderServiceCatalogItemDto'],
  'priceAmount' | 'estimatedDurationMinutes' | 'descriptionOverride'
> & {
  priceAmount: number | null;
  estimatedDurationMinutes: number | null;
  descriptionOverride: string | null;
};

/**
 * Verification status of a declared trade. DERIVED from the generated schema
 * (`DiscoveredProviderDto` is the one place the contract spells this enum out)
 * rather than hand-written, so the union cannot silently drift.
 */
export type PscVerificationStatus =
  components['schemas']['DiscoveredProviderDto']['categoryVerificationStatus'];

/**
 * Mirror of `ProviderCategoryResponseDto` — one declared trade, as returned by
 * `GET /service-providers/{providerId}/categories` (owner view: every status,
 * soft-deleted rows excluded, oldest first).
 *
 * A FULL hand-mirror, unlike `ProviderCatalogItem`: that controller carries no
 * `@ApiResponse`, so the operation is generated with `content?: never` and the
 * DTO is not emitted in `components.schemas` at all — there is nothing to
 * derive from except the status union above. Contract debt of the same family
 * as `GET /service-categories` and `/auth/me`; NOT fixed here (this slice is
 * front-pure). Fixing it backend-side means annotating the controller with
 * `@ApiOkResponse({ type: ProviderCategoryResponseDto, isArray: true })` —
 * honest, since the runtime really does return a bare array.
 *
 * ⚠️ It carries `serviceCategoryId` (a UUID) and NO label: the trade's name
 * must be joined client-side against the catalog (`GET /service-categories`).
 *
 * Source of truth:
 * apps/api/src/modules/service-providers/dto/provider-category-response.dto.ts
 */
export interface ProviderCategory {
  id: string;
  serviceProviderId: string;
  serviceCategoryId: string;
  verificationStatus: PscVerificationStatus;
  requestedAtUtc: string;
  verifiedAtUtc: string | null;
  rejectionReason: string | null;
  /** The provider can pause a trade (`PATCH …/categories/{pscId}`; no web UI yet). */
  isActive: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
}

/**
 * Mirror of `ProviderServiceRequestItemDto` (Vision B item: assigned job OR
 * OPEN direct booking targeted at the provider). Amounts are decimal strings
 * (e.g. `"150.00"`); GPS and `clientUserId` are excluded upstream (Loi 25).
 */
export interface ProviderServiceRequestItem {
  id: string;
  status: ServiceRequestStatus;
  requestType: ServiceRequestType;
  title: string;
  description: string;
  serviceAddress: string;
  estimatedAmount: string | null;
  estimatedCurrency: string | null;
  finalAmount: string | null;
  finalCurrency: string | null;
  scheduledAtUtc: string | null;
  desiredStartAtUtc: string | null;
  desiredEndAtUtc: string | null;
  acceptedAtUtc: string | null;
  completedAtUtc: string | null;
  paidAtUtc: string | null;
  responseDeadlineUtc: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  assignedServiceProviderId: string | null;
  requestedServiceProviderId: string | null;
  serviceCategoryId: string;
  serviceItemId: string | null;
  /** Trade i18n name map; resolve via `pickTranslation`. */
  serviceCategoryNameTranslations: Record<string, string>;
  /** Service i18n name map — null for an open tender without a specific item. */
  serviceItemNameTranslations: Record<string, string> | null;
  /** Backend already defaults to `—` when the client has no usable name. */
  clientDisplayName: string;
}
