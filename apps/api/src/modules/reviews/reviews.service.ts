import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ServiceRequestRepository } from '../service-requests/repositories/service-request.repository';
import { CreateReviewDto } from './dto/create-review.dto';
import { MyReviewItemDto } from './dto/my-review-item.dto';
import { MyReviewListDto } from './dto/my-review-list.dto';
import { ProviderReviewItemDto } from './dto/provider-review-item.dto';
import { ProviderReviewListDto } from './dto/provider-review-list.dto';
import { ReviewResponseDto } from './dto/review-response.dto';
import {
  ReviewAlreadyExistsException,
  ReviewRequiresCompletedRequestException,
  ReviewSubjectMissingException,
} from './exceptions/review.exceptions';
import {
  PG_UNIQUE_VIOLATION,
  ReviewsRepository,
} from './repositories/reviews.repository';

/**
 * Hard cap on the reviews returned for one provider.
 *
 * A server constant, not a query parameter: there is no pagination and no
 * cursor here, the same deliberate shape as the dashboard, `/requests` and the
 * demand map. `reviewCount` in the envelope is what tells the reader the cap
 * bit — and the aggregate is computed over the whole set regardless, so a
 * truncated list never distorts the average.
 */
export const PROVIDER_REVIEWS_LIMIT = 50;

/**
 * Hard cap on the caller's own reviews.
 *
 * 100 rather than 50, deliberately: the consumer is the client's requests page,
 * which itself loads `?limit=100` requests and joins the two by request id. A
 * smaller cap here would silently hide the review of an older-but-visible
 * request — the retraction button would vanish for a review that is still on
 * screen. The two caps are meant to match; if one moves, move the other.
 */
export const MY_REVIEWS_LIMIT = 100;

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly reviewsRepo: ReviewsRepository,
    private readonly requestRepo: ServiceRequestRepository,
  ) {}

  /**
   * Writes the client's review of a COMPLETED request.
   *
   * ⚠️ THE AUTHORIZATION IS `confirmCompletion`'s, COPIED RATHER THAN REINVENTED
   * (brief §8.2): load the request, then `clientUserId !== caller` → 403, then
   * check the state. Note what that pattern deliberately does NOT have — an
   * admin bypass. `ServiceRequestsService.getById` grants one, and reusing it
   * here would let an administrator publish a review under their own name about
   * someone else's transaction. The owner-only shape is the correct one for
   * anything the caller AUTHORS, as opposed to anything they merely read.
   *
   * ⚠️ THE PROVIDER IS READ FROM THE REQUEST, NEVER FROM THE BODY (D-1). That,
   * plus the COMPLETED gate, is what makes a review unfalsifiable by
   * construction — and therefore what makes a moderation surface unnecessary.
   *
   * 404 before 403 on purpose: an unknown id and someone else's id are told
   * apart here only because the id is one the caller supplied about their own
   * transaction; the 403 is the same one `confirmCompletion` returns.
   */
  async create(
    callerUserId: string,
    dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    const request = await this.requestRepo.findById(dto.serviceRequestId);
    if (!request) throw new NotFoundException('Service request not found');

    if (request.clientUserId !== callerUserId) {
      throw new ForbiddenException('Only the client can review this request');
    }
    // ⚠️ THE GATE IS `completedAtUtc`, NOT `status === COMPLETED`, AND THE
    // DIFFERENCE IS A 72-HOUR WINDOW. D-1 says « a request that HAS REACHED
    // COMPLETED », and a request does not stay there: the hourly auto-release
    // cron captures the balance after PLATFORM_AUTO_RELEASE_HOURS and the
    // webhook moves it COMPLETED → PAID. Gating on the CURRENT status would
    // therefore let the right to review expire silently three days after the
    // job — exactly the window in which people actually write one — and a
    // refund (COMPLETED/PAID → REFUNDED) would close it too. `completed_at_utc`
    // is an audit-trail timestamp: stamped once when the job is marked done,
    // never cleared, and null for everything that never got there (measured:
    // OPEN / ASSIGNED / IN_PROGRESS all carry null). It is the literal encoding
    // of D-1's wording.
    if (request.completedAtUtc === null) {
      throw new ReviewRequiresCompletedRequestException();
    }

    const serviceProviderId = request.assignedServiceProviderId;
    if (!serviceProviderId) throw new ReviewSubjectMissingException();

    // Clean 409 on the ordinary path; the partial unique index below is the
    // backstop for two simultaneous writes.
    const existing = await this.reviewsRepo.findActiveByRequestId(request.id);
    if (existing) throw new ReviewAlreadyExistsException();

    // An empty comment is stored as NULL, never as ''. The DTO already trims and
    // rejects a blank string; this keeps a defensive `?? null` at the boundary
    // rather than letting whitespace become a "comment" the reader has to
    // render.
    const comment = dto.comment && dto.comment.length > 0 ? dto.comment : null;

    let record;
    try {
      record = await this.reviewsRepo.insertOne({
        serviceRequestId: request.id,
        serviceProviderId,
        authorUserId: callerUserId,
        rating: dto.rating,
        comment,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ReviewAlreadyExistsException();
      throw err;
    }

    this.logger.log(
      `Client ${callerUserId} reviewed request ${request.id} (provider ${serviceProviderId}, rating ${dto.rating})`,
    );
    return ReviewResponseDto.from(record);
  }

  /**
   * The author retracts their review — soft, and it takes the provider's reply
   * with it (D-3).
   *
   * ⚠️ 404 ON ANYTHING THAT IS NOT THE CALLER'S LIVE REVIEW, NEVER 403. Unknown,
   * already deleted, and belonging to someone else are one answer: a 403 would
   * confirm a given id is a real review of someone else's, and there is nothing
   * to gain by saying so. Same call as the notifications read.
   *
   * A second delete is therefore a 404 rather than a silent 204 — honest, and it
   * costs the caller nothing, since the review is already gone either way.
   */
  async remove(callerUserId: string, reviewId: string): Promise<void> {
    const deleted = await this.reviewsRepo.softDeleteByAuthor(
      reviewId,
      callerUserId,
    );
    if (!deleted) throw new NotFoundException('Review not found');

    this.logger.log(`Client ${callerUserId} deleted review ${reviewId}`);
  }

  /**
   * The caller's own reviews — what makes « see » and « retract » survive a
   * page reload.
   *
   * Without it the review id would exist only in the POST response, and D-3's
   * right of retraction would last exactly one page view: the public item
   * carries neither the request id nor an author id, on purpose, so nothing
   * else can tell the caller which review is theirs.
   */
  async listMine(callerUserId: string): Promise<MyReviewListDto> {
    const records = await this.reviewsRepo.findMine(callerUserId, MY_REVIEWS_LIMIT);

    const dto = new MyReviewListDto();
    dto.items = records.map((record) => MyReviewItemDto.from(record));
    dto.limit = MY_REVIEWS_LIMIT;
    return dto;
  }

  /**
   * A provider's reviews and their aggregate.
   *
   * No provider-existence check, matching the sibling public read
   * `GET /service-providers/:providerId/services`, which also answers with an
   * empty result for an unknown id rather than spending a round trip to say 404.
   * Zero reviews and an unknown provider are the same honest answer here: an
   * empty list, a count of zero, and no average.
   */
  async listForProvider(
    serviceProviderId: string,
  ): Promise<ProviderReviewListDto> {
    const { items, reviewCount, averageRating } =
      await this.reviewsRepo.findByProviderWithAggregate(
        serviceProviderId,
        PROVIDER_REVIEWS_LIMIT,
      );

    const dto = new ProviderReviewListDto();
    dto.items = items.map((record) => ProviderReviewItemDto.from(record));
    dto.reviewCount = reviewCount;
    dto.averageRating = averageRating;
    dto.limit = PROVIDER_REVIEWS_LIMIT;
    return dto;
  }
}

/** Narrow a caught error down to PostgreSQL's unique-violation SQLSTATE. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
