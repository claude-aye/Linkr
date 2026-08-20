import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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
 * ⚠️ AUTHENTICATED — NO `@Public()`, UNLIKE ITS TWO SIBLINGS on the same profile
 * (`GET /service-providers/:id` and `.../services`). Decided deliberately: the
 * page that consumes it lives under `(app)` and is private, so a public route
 * here would have NO CALLER TODAY — and a public surface with no caller is a
 * surface nobody remembers to watch. Opening it belongs to the « public
 * discover » chantier, which will take it together with the rate limiter and
 * `trust proxy`; opening one route ahead of that is deciding at the wrong moment
 * and without the others.
 *
 * ⚠️ THE MASKING STAYS, AND NOT AS A CONSEQUENCE OF THE ABOVE. « Carol R. » is
 * not a mitigation of anonymous access — it is the right design for an
 * AUTHENTICATED reader too: a client's full identity has no business being
 * republished to another logged-in stranger either. Do not relax it if this
 * route later becomes public, and do not relax it because it is not public now.
 *
 * No provider-existence check, matching `.../services`: an unknown id gets an
 * empty list, a count of zero and no average.
 */
@ApiTags('reviews')
@Controller('service-providers/:providerId/reviews')
export class ProviderReviewsController {
  constructor(private readonly service: ReviewsService) {}

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
