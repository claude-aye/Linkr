import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ProviderReviewListDto } from './dto/provider-review-list.dto';
import { ReviewsService } from './reviews.service';

/**
 * `GET /service-providers/:providerId/reviews` — the public read that a provider
 * profile is built on (tranche 1b will render it at `/providers/[id]`).
 *
 * ⚠️ THE ROUTE PATH SAYS `service-providers`, BUT THE CONTROLLER LIVES IN THE
 * REVIEWS MODULE. A controller's path is independent of its module, and keeping
 * it here is what keeps the dependency ONE-WAY: `reviews → service-requests`,
 * with nothing importing `reviews`. `ServiceProvidersModule` is a sink in this
 * codebase (notifications, payments and quotes all import it), and importing
 * `reviews` back from it would cascade cycles. Exact precedent:
 * `ProviderServiceRequestsController`, which lives in the service-requests
 * module for the same reason (3.12a-back).
 *
 * ⚠️ `@Public()`, LIKE ITS TWO SIBLINGS on the same profile
 * (`GET /service-providers/:id` and `.../services`) — and that is a genuinely
 * new exposure, decided rather than inherited. The mitigation is in the DTO: the
 * author is « Carol R. », never a full name, never `display_name`, and the
 * review carries no user id, no request id, no address and no amount. The
 * decision was taken knowing the profile page is built to be shared.
 *
 * No provider-existence check, matching `.../services`: an unknown id gets an
 * empty list, a count of zero and no average.
 */
@ApiTags('reviews')
@Controller('service-providers/:providerId/reviews')
export class ProviderReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary:
      'List a provider\'s reviews with their aggregate (public). Soft-deleted reviews are excluded inside the aggregate itself, and `averageRating` is null below 3 live reviews (D-4) — gated server-side, never left to the front to hide.',
  })
  @ApiOkResponse({ type: ProviderReviewListDto })
  list(
    @Param('providerId', ParseUUIDPipe) providerId: string,
  ): Promise<ProviderReviewListDto> {
    return this.service.listForProvider(providerId);
  }
}
