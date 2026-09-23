import { ApiProperty } from '@nestjs/swagger';
import { QuoteStatus } from '../../quotes/enums/quote-status.enum';
import type { ProviderTenderRecord } from '../repositories/service-request.repository';

/**
 * One open PROJECT_TENDER as the provider who could quote on it sees it
 * (`GET /service-providers/:id/tenders`).
 *
 * ⚠️ NO ADDRESS, NO CLIENT. Neither `serviceAddress`, nor `serviceLocation`, nor
 * the client's name or id appear here, and that is a harder line than the
 * dashboard next door draws. The reason is who the reader is: a provider on the
 * dashboard is the ASSIGNED or the TARGETED one — a named counterparty in a
 * booking. A reader of this feed is merely a geographic match, exactly like a
 * recipient of `NEW_TENDER_MATCH`, and there may be dozens of them. Serving the
 * street address of every tender to every provider in the radius is a broadcast,
 * not a disclosure to a counterparty. What the reader actually needs in order to
 * decide whether to quote is how far it is — hence {@link distanceKm} — and that
 * is a number computed from a point he never receives.
 *
 * Dedicated DTO, like every provider-facing projection in this module: the
 * client-facing `ServiceRequestResponseDto` stays untouched.
 */
export class ProviderTenderItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ format: 'uuid' })
  serviceCategoryId!: string;

  @ApiProperty({
    description: 'Libellés i18n du métier',
    additionalProperties: { type: 'string' }, // types the JSONB map (codegen → Record<string, string>)
    example: { 'fr-CA': 'Plomberie', 'en-CA': 'Plumbing' },
  })
  serviceCategoryNameTranslations!: Record<string, string>;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  desiredStartAtUtc!: Date | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  desiredEndAtUtc!: Date | null;

  @ApiProperty({
    description: 'Budget indicatif du client, ou null.',
    type: 'string',
    nullable: true,
    example: '1500.50',
  })
  estimatedAmount!: string | null;

  @ApiProperty({ type: 'string', nullable: true, example: 'CAD' })
  estimatedCurrency!: string | null;

  /**
   * Never null on this endpoint: the feed only returns tenders whose deadline is
   * still ahead (`quotes_deadline_utc > NOW()`), which excludes NULL by
   * three-valued logic. Declared non-nullable so the card that is built around
   * this date does not carry a null branch that cannot occur.
   */
  @ApiProperty({ type: 'string', format: 'date-time' })
  quotesDeadlineUtc!: Date;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAtUtc!: Date;

  /**
   * Whole kilometres between the provider's base and the tender's coordinate.
   *
   * This is the ONLY thing the feed says about where the job is, and it is
   * deliberately lossy: rounded to the kilometre, derived server-side, and
   * computed from a point that never leaves the database. A tender a few hundred
   * metres away therefore reads `0` — "in your neighbourhood", which is all the
   * reader is entitled to before he has a contract.
   */
  @ApiProperty({ type: 'integer', example: 12 })
  distanceKm!: number;

  /**
   * The provider's own most recent quote on this tender, or null.
   *
   * ⚠️ MOST RECENT, NOT "THE" QUOTE. `uq_quote_one_live_per_provider_per_request`
   * is PARTIAL (`WHERE status = 'SUBMITTED'`), which is precisely what lets a
   * provider withdraw and re-submit — so a (provider, tender) couple can carry
   * several rows, of which at most one is live. A tender whose quote was
   * withdrawn stays in the feed, carrying `WITHDRAWN`, because the provider can
   * quote again and the feed is where he would do it.
   */
  @ApiProperty({ type: 'string', format: 'uuid', nullable: true })
  myQuoteId!: string | null;

  @ApiProperty({ enum: QuoteStatus, nullable: true })
  myQuoteStatus!: QuoteStatus | null;

  static from(record: ProviderTenderRecord): ProviderTenderItemDto {
    const dto = new ProviderTenderItemDto();
    dto.id = record.id;
    dto.title = record.title;
    dto.description = record.description;
    dto.serviceCategoryId = record.serviceCategoryId;
    // Defensive on the joined label, like every other labelled projection here:
    // a renderable item beats a crash if a join were unexpectedly absent.
    dto.serviceCategoryNameTranslations =
      record.serviceCategoryNameTranslations ?? {};
    dto.desiredStartAtUtc = record.desiredStartAtUtc;
    dto.desiredEndAtUtc = record.desiredEndAtUtc;
    dto.estimatedAmount = record.estimatedAmount;
    dto.estimatedCurrency = record.estimatedCurrency;
    dto.quotesDeadlineUtc = record.quotesDeadlineUtc;
    dto.createdAtUtc = record.createdAtUtc;
    // Metres → whole kilometres. Rounded HERE rather than in SQL so the rule is
    // reachable by a unit test, mirroring `distanceMeters` on the discovery card.
    dto.distanceKm = Math.round(record.distanceMeters / 1000);
    dto.myQuoteId = record.myQuoteId;
    dto.myQuoteStatus = record.myQuoteStatus;
    return dto;
  }
}
