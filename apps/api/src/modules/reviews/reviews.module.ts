import { Module } from '@nestjs/common';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { ServiceProvidersModule } from '../service-providers/service-providers.module';
import { ServiceRequestsModule } from '../service-requests/service-requests.module';
import { ProviderReviewsController } from './provider-reviews.controller';
import { ReviewsDataModule } from './reviews-data.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

/**
 * Leaf module — nothing imports it, so its one domain import cannot create a
 * cycle. It needs `ServiceRequestRepository` to read the request a review claims
 * to be about (client, status, assigned provider): the three facts that make a
 * review unfalsifiable, and none of which may come from the request body.
 *
 * `RateLimitGuard` is registered as a module-local provider, the same way
 * `AdminGuard` and demand-signals' own copy are — the codebase's convention for
 * a guard, rather than inventing a `RateLimitModule` as a second pattern for the
 * same job.
 *
 * Nothing is exported from HERE: the controllers and the service are this
 * module's own. What discovery needed in tranche 3 is the repository, and it
 * takes it from `ReviewsDataModule` — see that file for why the split exists.
 * The N+1 guard lives in the repository as `findAggregatesForProviders`: one
 * grouped query for the whole page, never one per provider.
 */
@Module({
  imports: [
    // The repository moved to a LEAF module so `ServiceProvidersModule` can
    // read the rating aggregate for a discovery page without importing this
    // module back — that would be a cycle, since this module imports it.
    ReviewsDataModule,
    ServiceRequestsModule,
    // `ServiceProvidersService.loadOwnedProvider` — the ownership guard behind
    // the provider's reply (404 unknown / 403 not managed). Still one-way:
    // nothing imports `reviews`, so importing this sink cannot create a cycle,
    // exactly as `demand-signals` does.
    ServiceProvidersModule,
  ],
  controllers: [ReviewsController, ProviderReviewsController],
  providers: [ReviewsService, RateLimitGuard],
})
export class ReviewsModule {}
