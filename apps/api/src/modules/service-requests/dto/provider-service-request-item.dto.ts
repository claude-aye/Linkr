import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceRequestStatus } from '../enums/service-request-status.enum';
import { ServiceRequestType } from '../enums/service-request-type.enum';
import { ServiceRequestLocationPrecision } from '../enums/service-request-location-precision.enum';
import { PaymentStatus } from '../../payments/enums/payment-status.enum';
import type { ProviderServiceRequestRecord } from '../repositories/service-request.repository';

/**
 * Provider-facing service-request projection for the prestataire dashboard
 * (`GET /service-providers/:id/service-requests`, Vision B).
 *
 * Enriched with the joined, human-readable labels the dashboard needs (trade /
 * service i18n names + client display name) so the front never renders raw
 * UUIDs. The client's GPS (`serviceLocation`) and `clientUserId` are
 * deliberately omitted — Loi 25 data minimization (the provider needs the human
 * address string and a name, not coordinates nor the client's account id).
 *
 * Dedicated DTO (Approach 1 — total isolation, cf. 3.11c-A-bis):
 * `ServiceRequestResponseDto` and its `toResponseDto` mapper stay untouched.
 */
export class ProviderServiceRequestItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ServiceRequestStatus }) status!: ServiceRequestStatus;
  @ApiProperty({ enum: ServiceRequestType }) requestType!: ServiceRequestType;
  @ApiProperty() title!: string;
  @ApiProperty() description!: string;
  @ApiProperty() serviceAddress!: string;

  /**
   * Provenance of the request's coordinate. This is the side that physically
   * travels, so it is the side that most needs to know the location was
   * degraded.
   *
   * Note the asymmetry, and preserve it: the precision rides along
   * `PROVIDER_SELECT_COLUMNS`, which is geo-safe. The provider learns THAT the
   * position is degraded without ever receiving the point itself (Loi 25 —
   * `serviceLocation` stays excluded from this DTO).
   */
  @ApiProperty({ enum: ServiceRequestLocationPrecision })
  serviceLocationPrecision!: ServiceRequestLocationPrecision;

  @ApiPropertyOptional() estimatedAmount!: string | null;
  @ApiPropertyOptional() estimatedCurrency!: string | null;
  @ApiPropertyOptional() finalAmount!: string | null;
  @ApiPropertyOptional() finalCurrency!: string | null;
  @ApiPropertyOptional() scheduledAtUtc!: Date | null;
  @ApiPropertyOptional() desiredStartAtUtc!: Date | null;
  @ApiPropertyOptional() desiredEndAtUtc!: Date | null;
  @ApiPropertyOptional() acceptedAtUtc!: Date | null;
  @ApiPropertyOptional() completedAtUtc!: Date | null;
  @ApiPropertyOptional() paidAtUtc!: Date | null;
  @ApiPropertyOptional() responseDeadlineUtc!: Date | null;
  @ApiProperty() createdAtUtc!: Date;
  @ApiProperty() updatedAtUtc!: Date;

  // ── Technical metadata (kept for front-side transition wiring; not labels) ──
  @ApiPropertyOptional() assignedServiceProviderId!: string | null;
  @ApiPropertyOptional() requestedServiceProviderId!: string | null;
  @ApiProperty() serviceCategoryId!: string;
  @ApiPropertyOptional() serviceItemId!: string | null;

  // ── Joined labels (anti-UUID) ──────────────────────────────────────────────
  @ApiProperty({
    description: 'Libellés i18n du métier',
    additionalProperties: { type: 'string' }, // types the JSONB map (codegen → Record<string, string>)
    example: { 'fr-CA': 'Plomberie', 'en-CA': 'Plumbing' },
  })
  serviceCategoryNameTranslations!: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Libellés i18n du service (nullable pour un tender ouvert)',
    additionalProperties: { type: 'string' }, // idem
  })
  serviceItemNameTranslations!: Record<string, string> | null;

  @ApiProperty({ description: 'Nom affichable du client', example: 'Marie Tremblay' })
  clientDisplayName!: string;

  /**
   * Status of this request's DEPOSIT, or null when no deposit row exists.
   *
   * A STATUS AND NOTHING ELSE — never the amount, never the 20% rate, which
   * stay backend-only (the accept modal already refuses to show them). It is
   * the readable half of the "explicit state" fix: after an accept whose
   * capture failed, the job IS the provider's and this is what says the money
   * is not, long after the accept response is gone. Null on a request that was
   * never accepted; null on an accepted one means no deposit was ever recorded,
   * which is as retryable as FAILED.
   */
  // `nullable: true` alongside the enum, so the generated client says
  // `| null` instead of merely optional — the runtime really does send null.
  // Same discipline the notifications DTOs use to stay clear of the
  // `Record<string, never>` degradation.
  @ApiPropertyOptional({ enum: PaymentStatus, nullable: true })
  depositStatus!: PaymentStatus | null;

  /**
   * Builds the enriched item from a label-joined record. Defensive on the
   * label fields (`?? {}` / `?? null` / `—` fallback) so a renderable item is
   * produced even if a join were unexpectedly absent.
   */
  static fromWithLabels(
    record: ProviderServiceRequestRecord,
  ): ProviderServiceRequestItemDto {
    const dto = new ProviderServiceRequestItemDto();
    dto.id = record.id;
    dto.status = record.status;
    dto.requestType = record.requestType;
    dto.title = record.title;
    dto.description = record.description;
    dto.serviceAddress = record.serviceAddress;
    dto.serviceLocationPrecision = record.serviceLocationPrecision;
    dto.estimatedAmount = record.estimatedAmount;
    dto.estimatedCurrency = record.estimatedCurrency;
    dto.finalAmount = record.finalAmount;
    dto.finalCurrency = record.finalCurrency;
    dto.scheduledAtUtc = record.scheduledAtUtc;
    dto.desiredStartAtUtc = record.desiredStartAtUtc;
    dto.desiredEndAtUtc = record.desiredEndAtUtc;
    dto.acceptedAtUtc = record.acceptedAtUtc;
    dto.completedAtUtc = record.completedAtUtc;
    dto.paidAtUtc = record.paidAtUtc;
    dto.responseDeadlineUtc = record.responseDeadlineUtc;
    dto.createdAtUtc = record.createdAtUtc;
    dto.updatedAtUtc = record.updatedAtUtc;
    dto.assignedServiceProviderId = record.assignedServiceProviderId;
    dto.requestedServiceProviderId = record.requestedServiceProviderId;
    dto.serviceCategoryId = record.serviceCategoryId;
    dto.serviceItemId = record.serviceItemId;

    dto.serviceCategoryNameTranslations =
      record.serviceCategoryNameTranslations ?? {};
    dto.serviceItemNameTranslations =
      record.serviceItemNameTranslations ?? null;
    const fullName =
      `${record.clientFirstName ?? ''} ${record.clientLastName ?? ''}`.trim();
    dto.clientDisplayName = record.clientDisplayName ?? (fullName || '—');
    dto.depositStatus = record.depositStatus;
    return dto;
  }
}
