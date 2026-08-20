import type { components } from '@linkr/api-client';

/**
 * One of the caller's own reviews.
 *
 * Consumed NATIVELY from the generated schema — no local mirror and no cast.
 * `MyReviewItemDto` carries an explicit `@ApiProperty` with a concrete type on
 * every property, `nullable` included, so `comment` generates as
 * `string | null` rather than degrading to `Record<string, never>` (the
 * *nullable* debt, CLAUDE.md §6). This alias exists only to give the shape a
 * short name at the call sites.
 */
export type MyReview = components['schemas']['MyReviewItemDto'];

/** A provider's reviews with their aggregate — also native, also cast-free. */
export type ProviderReviewList = components['schemas']['ProviderReviewListDto'];
export type ProviderReview = components['schemas']['ProviderReviewItemDto'];
