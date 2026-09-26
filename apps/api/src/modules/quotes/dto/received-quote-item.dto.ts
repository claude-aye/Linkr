import { ApiProperty } from '@nestjs/swagger';
import { QuoteStatus } from '../enums/quote-status.enum';
import { ProviderType } from '../../service-providers/enums/provider-type.enum';
import { PscVerificationStatus } from '../../service-providers/enums/psc-verification-status.enum';
import type { ReceivedQuoteRecord } from '../repositories/quote.repository';
import type { ProviderRatingAggregate } from '../../reviews/repositories/reviews.repository';

/**
 * One quote on a tender, as the CLIENT who published it compares it
 * (`GET /service-requests/:id/received-quotes`).
 *
 * Dedicated DTO: `QuoteResponseDto` — the answer of submit / withdraw / accept
 * and of `GET /service-requests/:id/quotes` — stays untouched.
 *
 * ⚠️ NO CONTACT DETAILS. No email, no phone, no address of the provider: the
 * client compares offers here, he does not reach around the platform. What he
 * gets is what a discovery card already shows (name, headline, rating, trust
 * status, distance) plus the quote itself.
 */
export class ReceivedQuoteItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    type: 'string',
    description: 'Decimal serialized as string, paired with currency.',
    example: '850.50',
  })
  amount!: string;

  @ApiProperty({ type: 'string', example: 'CAD' })
  currency!: string;

  /**
   * The deposit accepting this quote would charge, to the cent — computed by
   * the same function `captureDeposit` uses, so what the client is shown
   * before paying is what he pays. Same decimal format as `amount`, same
   * `currency`. Null when the amount is too small to yield a non-zero
   * deposit. No fee, no net: the client has no business seeing them.
   */
  @ApiProperty({
    type: 'string',
    nullable: true,
    description:
      'Deposit charged on acceptance, decimal serialized as string, in `currency`. Null when the amount yields no non-zero deposit.',
    example: '170.10',
  })
  depositAmount!: string | null;

  @ApiProperty({ type: 'integer', example: 120 })
  estimatedDurationMinutes!: number;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  proposedStartAtUtc!: Date | null;

  @ApiProperty({ type: 'string' })
  description!: string;

  @ApiProperty({ enum: QuoteStatus })
  status!: QuoteStatus;

  @ApiProperty({ type: 'string', format: 'date-time' })
  validUntilUtc!: Date;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAtUtc!: Date;

  @ApiProperty({ format: 'uuid' })
  serviceProviderId!: string;

  @ApiProperty({ enum: ProviderType })
  providerType!: ProviderType;

  /** Null when the provider is soft-deleted (masked), or has no name at all. */
  @ApiProperty({
    type: 'string',
    nullable: true,
    description: 'Public name: business_name, falling back to organization.display_name. Null if the provider was deleted.',
  })
  displayName!: string | null;

  @ApiProperty({ type: 'string', nullable: true })
  headline!: string | null;

  /**
   * Live reviews. `null` = reputation UNAVAILABLE (the aggregate read failed),
   * distinct from `0` = no review yet.
   */
  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 4,
    description: 'Live reviews; null when reputation is unavailable (distinct from 0).',
  })
  reviewCount!: number | null;

  /**
   * Already gated by the reviews aggregate: null below three live reviews
   * (D-4). A consumer never re-derives it from `reviewCount`.
   */
  @ApiProperty({ type: 'number', nullable: true, example: 4.33 })
  averageRating!: number | null;

  /**
   * The provider's REAL standing on this tender's trade, today — not a badge
   * frozen at submission. Null when the claim no longer exists.
   */
  @ApiProperty({ enum: PscVerificationStatus, nullable: true })
  verificationStatus!: PscVerificationStatus | null;

  /** Whole km, provider base → tender. Null if the provider was deleted. */
  @ApiProperty({ type: 'integer', nullable: true, example: 12 })
  distanceKm!: number | null;

  /**
   * Whether `POST /quotes/:id/accept` would accept this quote right now,
   * decided by the SAME function `accept` runs (`quote-acceptability.ts`).
   */
  @ApiProperty({ type: 'boolean' })
  acceptable!: boolean;

  static from(
    record: ReceivedQuoteRecord,
    /** `null` = the aggregate read failed; `undefined` = no live review. */
    rating: ProviderRatingAggregate | undefined | null,
    acceptable: boolean,
    depositAmount: string | null,
  ): ReceivedQuoteItemDto {
    // A deleted provider's quote stays listed (the client sees the real number
    // of offers) but carries no identity — masked HERE, not filtered in SQL,
    // same pattern as the dashboard's deleted client (3.12a-back).
    const deleted = record.providerDeletedAtUtc !== null;

    const dto = new ReceivedQuoteItemDto();
    dto.id = record.id;
    dto.amount = record.amount;
    dto.currency = record.currency;
    dto.depositAmount = depositAmount;
    dto.estimatedDurationMinutes = record.estimatedDurationMinutes;
    dto.proposedStartAtUtc = record.proposedStartAtUtc;
    dto.description = record.description;
    dto.status = record.status;
    dto.validUntilUtc = record.validUntilUtc;
    dto.createdAtUtc = record.createdAtUtc;
    dto.serviceProviderId = record.serviceProviderId;
    dto.providerType = record.providerType;
    dto.displayName = deleted ? null : record.providerDisplayName;
    dto.headline = deleted ? null : record.providerHeadline;
    // null = unavailable (failed read) → both null. No aggregate row = no live
    // review → 0 / null, the same reading discovery makes.
    dto.reviewCount = rating === null ? null : (rating?.reviewCount ?? 0);
    dto.averageRating = rating?.averageRating ?? null;
    dto.verificationStatus = record.verificationStatus;
    dto.distanceKm =
      deleted || record.distanceMeters === null
        ? null
        : Math.round(record.distanceMeters / 1000);
    dto.acceptable = acceptable;
    return dto;
  }
}
