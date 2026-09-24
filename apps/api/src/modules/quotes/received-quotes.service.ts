import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { QuoteRepository } from './repositories/quote.repository';
import { quoteAcceptabilityViolation } from './quote-acceptability';
import { ReceivedQuoteItemDto } from './dto/received-quote-item.dto';
import { RequestNotATenderException } from './exceptions/quote.exceptions';
import { ServiceRequestsService } from '../service-requests/service-requests.service';
import { ServiceRequestType } from '../service-requests/enums/service-request-type.enum';
import { NotRequestOwnerException } from '../service-requests/exceptions/service-request.exceptions';
import {
  ProviderRatingAggregate,
  ReviewsRepository,
} from '../reviews/repositories/reviews.repository';

/**
 * The client's side of a tender: the quotes it received, comparable.
 *
 * A service of its own rather than one more method on `QuotesService`: it
 * needs the reviews aggregate, which nothing else in the quotes domain does,
 * and `QuotesService` is constructed by hand in its specs.
 */
@Injectable()
export class ReceivedQuotesService {
  private readonly logger = new Logger(ReceivedQuotesService.name);

  constructor(
    private readonly quotesRepo: QuoteRepository,
    private readonly serviceRequestsService: ServiceRequestsService,
    private readonly reviewsRepo: ReviewsRepository,
  ) {}

  /**
   * ⚠️ THE ORDER OF THE THREE GUARDS IS THE CONTRACT: 404 → 403 → 400.
   * The type check comes AFTER the ownership check so that a stranger gets the
   * same 403 whatever the request is — answering him 400 would tell him it is
   * not a tender, i.e. let him probe the type of a request that is not his.
   * `getRequestRecord` filters soft-deleted rows: a deleted request is a 404.
   */
  async listForClient(
    requestId: string,
    callerUserId: string,
  ): Promise<ReceivedQuoteItemDto[]> {
    const request = await this.serviceRequestsService.getRequestRecord(requestId);
    if (!request) throw new NotFoundException('Service request not found');

    if (request.clientUserId !== callerUserId) {
      throw new NotRequestOwnerException();
    }

    if (request.requestType !== ServiceRequestType.PROJECT_TENDER) {
      throw new RequestNotATenderException();
    }

    const records = await this.quotesRepo.findReceivedForRequest(request.id);

    // ONE aggregate read for the whole list — never one per quote, and never
    // recomputed here: the D-4 threshold lives in that query.
    const providerIds = [...new Set(records.map((r) => r.serviceProviderId))];
    //
    // ⚠️ A FAILED AGGREGATE NEVER COSTS THE LIST. The quotes are the product,
    // the reputation is decoration. On failure `ratings` stays null and every
    // item carries `reviewCount: null` — "reputation unavailable", DISTINCT
    // from 0 ("no review"): inventing a zero would skew the comparison.
    let ratings: Map<string, ProviderRatingAggregate> | null = null;
    try {
      ratings = await this.reviewsRepo.findAggregatesForProviders(providerIds);
    } catch (err) {
      this.logger.error(
        `Received-quotes rating aggregate failed for request ${request.id}; ` +
          `serving ${records.length} quote(s) without reputation`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    // One instant for the whole list: two rows must not disagree about "now".
    const now = new Date();
    return records.map((record) => {
      const violation = quoteAcceptabilityViolation(
        request,
        record,
        {
          providerType: record.providerType,
          userId: record.providerUserId,
          isActive: record.providerIsActive,
          deleted: record.providerDeletedAtUtc !== null,
        },
        now,
      );
      return ReceivedQuoteItemDto.from(
        record,
        ratings === null ? null : ratings.get(record.serviceProviderId),
        violation === null,
      );
    });
  }
}
