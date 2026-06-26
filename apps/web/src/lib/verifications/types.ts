import type { components } from '@linkr/api-client';

/**
 * Verification-document types (Phase 3.11c-A).
 *
 * The REQUEST DTO is typed in the generated client — reuse it, never mirror it.
 * The LIST RESPONSE is not: `GET /admin/verification-documents` ships no response
 * schema in the OpenAPI (its generated `data` resolves to `never`), so the
 * `VerificationDocument` interface below mirrors the real backend response DTO for
 * rendering — the same justified exception as `lib/auth/types.ts`.
 *
 * Source of truth:
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
 * Mirror of `VerificationDocumentResponseDto`. Note: every `*Utc` field is a `Date`
 * server-side but is serialized to an ISO-8601 string once it crosses the JSON
 * boundary, hence `string` here. The DTO is intentionally lean — it exposes IDs
 * (`professionalServiceCategoryId`, `regulatoryRequirementId`), NOT joined
 * provider / category / authority names.
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
}
