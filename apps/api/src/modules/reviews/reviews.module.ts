import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard';
import { ServiceRequestsModule } from '../service-requests/service-requests.module';
import { Review } from './entities/review.entity';
import { ProviderReviewsController } from './provider-reviews.controller';
import { ReviewsRepository } from './repositories/reviews.repository';
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
 * Nothing is exported: reviews have one writer and one reader, and both are this
 * module's own controllers. Tranche 3 (reviews inside `discover`) will be an
 * aggregate read, and the N+1 warning belongs there — one grouped query for the
 * whole page, never one per provider.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Review]), ServiceRequestsModule],
  controllers: [ReviewsController, ProviderReviewsController],
  providers: [ReviewsRepository, ReviewsService, RateLimitGuard],
})
export class ReviewsModule {}
