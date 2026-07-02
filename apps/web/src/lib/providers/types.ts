import type { components } from '@linkr/api-client';

/**
 * Provider-dashboard types (Phase 3.12-front).
 *
 * Two generated-type gaps force local mirrors here (the same justified
 * exception as `lib/auth/types.ts` and `lib/verifications/types.ts`):
 *
 * 1. `ServiceProviderResponseDto` / `ProviderServiceRequestItemDto` degrade
 *    their nullable fields to `Record<string, never> | null` in `schema.d.ts`
 *    (backend `@ApiProperty({ nullable: true })` without a concrete type —
 *    known JSONB/nullable quirk, cf. CLAUDE.md §6 tech debt). The interfaces
 *    below mirror the real backend DTOs with faithful `string | null` types.
 *
 * 2. `GET /service-providers/{id}/service-requests` is DECLARED as a bare
 *    `ProviderServiceRequestItemDto[]` in the OpenAPI (`isArray: true`
 *    annotation), but the controller actually returns the pagination envelope
 *    `{ items, total, page, limit }` at runtime. `ProviderServiceRequestList`
 *    types the real payload; the caller casts through it.
 *
 * Source of truth:
 * apps/api/src/modules/service-providers/dto/service-provider-response.dto.ts
 * apps/api/src/modules/service-requests/dto/provider-service-request-item.dto.ts
 * apps/api/src/modules/service-requests/provider-service-requests.controller.ts
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

/** Real runtime payload of `GET /service-providers/{id}/service-requests`. */
export interface ProviderServiceRequestList {
  items: ProviderServiceRequestItem[];
  total: number;
  page: number;
  limit: number;
}
