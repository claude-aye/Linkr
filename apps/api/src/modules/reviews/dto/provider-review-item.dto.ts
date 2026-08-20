import { ApiProperty } from '@nestjs/swagger';
import { ProviderReviewRecord } from '../repositories/reviews.repository';

/**
 * One review as a PUBLIC reader sees it on a provider's profile.
 *
 * ⚠️ THIS IS THE FIRST SURFACE OF THE PROJECT THAT MAKES A CLIENT PUBLICLY
 * LEGIBLE. Until now a client's full name reached only the assigned provider, in
 * an authenticated context. A review publishes that someone bought a service,
 * from whom, and when — on a page built to be shared (Direct Profile Sharing is
 * the acquisition lever). The mitigation is the display name below; everything
 * else a reader does not need is simply absent: no user id, no request id, no
 * address, no amount.
 */
export class ProviderReviewItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 5, example: 5 })
  rating!: number;

  @ApiProperty({ type: 'string', nullable: true, example: 'Travail impeccable.' })
  comment!: string | null;

  /**
   * First name + last initial — « Carol R. ».
   *
   * ⚠️ MASKED AT THE MAPPER, NEVER BY A SQL FILTER — the Loi 25 shape already in
   * place for soft-deleted client names. Enough for credibility (a review signed
   * by nobody is worth nothing) without publishing a client's full identity.
   *
   * ⚠️ `display_name` IS DELIBERATELY NOT USED, even when the user set one. It
   * is free text: a user who typed their full legal name there would have it
   * republished here, and the masking has to be structural rather than dependent
   * on what someone happened to type. Deriving it from the name parts alone is
   * what makes « first name + initial » true of every row.
   *
   * A soft-deleted author is masked entirely, falling back to `—`, mirroring
   * `ProviderServiceRequestItemDto.clientDisplayName`. The review itself stays:
   * removing it would silently move the provider's average.
   */
  @ApiProperty({
    description:
      "Author's first name plus last initial (« Carol R. »), or « — » if the account was deleted. Never the full name, never display_name.",
    type: 'string',
    example: 'Carol R.',
  })
  authorDisplayName!: string;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAtUtc!: Date;

  static from(record: ProviderReviewRecord): ProviderReviewItemDto {
    const dto = new ProviderReviewItemDto();
    dto.id = record.id;
    dto.rating = record.rating;
    dto.comment = record.comment;
    dto.authorDisplayName = maskAuthorName(record);
    dto.createdAtUtc = record.createdAtUtc;
    return dto;
  }
}

/**
 * « Carol Roy » → « Carol R. ». A missing last name yields the first name alone
 * rather than a dangling « . »; nothing usable at all yields `—`.
 */
function maskAuthorName(record: ProviderReviewRecord): string {
  if (record.authorDeleted) return '—';

  const first = (record.authorFirstName ?? '').trim();
  const last = (record.authorLastName ?? '').trim();
  const initial = last ? `${[...last][0].toUpperCase()}.` : '';

  return [first, initial].filter(Boolean).join(' ') || '—';
}
