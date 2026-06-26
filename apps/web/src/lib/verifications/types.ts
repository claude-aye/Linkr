import type { components } from '@linkr/api-client';

/**
 * Verification-document types (Phase 3.11c-A, enriched 3.11c-A-ter).
 *
 * The REQUEST DTO is typed in the generated client — reuse it, never mirror it.
 * The LIST RESPONSE of `GET /admin/verification-documents` now DOES ship a schema
 * (`AdminVerificationQueueItemDto[]`, added in 3.11c-A-bis / PR #21), but the
 * generated type degrades its nullable string fields to `Record<string, never> |
 * null` (the backend `@ApiProperty({ nullable: true })` decorators emit no
 * concrete element type). The `VerificationDocument` interface below therefore
 * keeps mirroring the real backend response DTO with faithful `string | null`
 * types for rendering — the same justified exception as `lib/auth/types.ts`.
 *
 * Source of truth:
 * apps/api/src/modules/verifications/dto/admin-verification-queue-item.dto.ts
 * apps/api/src/modules/verifications/dto/verification-document-response.dto.ts
 * apps/api/src/modules/verifications/dto/reject-verification-document.dto.ts
 */

/** Reject body — derived from the generated schema, NOT hand-mirrored. */
export type RejectVerificationDocumentBody =
  components['schemas']['RejectVerificationDocumentDto'];

/** Mirror of the backend `VerificationDocumentReviewStatus` enum (also the queue filter union). */
export type VerificationDocumentReviewStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXPIRED';

/** Mirror of the backend `RequiredDocumentType` enum. */
export type RequiredDocumentType =
  | 'LICENSE_NUMBER'
  | 'COMPETENCY_CARD'
  | 'CERTIFICATION';

/**
 * Mirror of `AdminVerificationQueueItemDto` (which extends
 * `VerificationDocumentResponseDto`). Note: every `*Utc` field is a `Date`
 * server-side but is serialized to an ISO-8601 string once it crosses the JSON
 * boundary, hence `string` here.
 *
 * Beyond the base scalar projection (which still exposes the raw
 * `professionalServiceCategoryId` / `regulatoryRequirementId` for technical
 * reference), the admin queue enriches each item with three joined,
 * human-readable labels (3.11c-A-bis): the trade's i18n name map, the regulatory
 * authority code, and the polymorphic provider display name. The backend already
 * defaults these (`{}` / `'—'`) so a missing join never yields `null`.
 */
export interface VerificationDocument {
  id: string;
  professionalServiceCategoryId: string;
  regulatoryRequirementId: string;
  documentType: RequiredDocumentType;
  documentNumber: string | null;
  /** Relative API download path, e.g. `/verification-documents/{id}/file`. */
  downloadUrl: string;
  fileMimeType: string;
  fileSizeBytes: number;
  issuedAtUtc: string | null;
  expiresAtUtc: string | null;
  reviewStatus: VerificationDocumentReviewStatus;
  reviewedAtUtc: string | null;
  rejectionReason: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  /** Enriched (3.11c-A-bis): trade i18n name map; resolve via `pickTranslation`. */
  serviceCategoryNameTranslations: Record<string, string>;
  /** Enriched (3.11c-A-bis): regulatory authority code, e.g. `RBQ`. */
  authorityCode: string;
  /** Enriched (3.11c-A-bis): polymorphic provider display name. */
  providerDisplayName: string;
}
