import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Review } from './entities/review.entity';
import { ReviewsRepository } from './repositories/reviews.repository';

/**
 * The reviews DATA, split out from the reviews FEATURE — a leaf module that
 * imports nothing but TypeORM.
 *
 * ⚠️ THIS EXISTS TO BREAK A CYCLE THAT WOULD OTHERWISE BE REAL. Tranche 3 puts
 * a provider's rating on their discovery card, so `ServiceProvidersService`
 * needs `ReviewsRepository`. But `ReviewsModule` already imports
 * `ServiceProvidersModule` (for `loadOwnedProvider`, the ownership guard behind
 * the provider's reply), so importing `ReviewsModule` back from
 * `ServiceProvidersModule` would close the loop. This codebase has zero
 * `forwardRef` and treats that as a property worth keeping, not a coincidence.
 *
 * The split is honest rather than a workaround: the two modules share the
 * reviews TABLE, they do not share the reviews FEATURE. Discovery has no
 * business reaching `ReviewsService`, and this module does not offer it —
 * `ServiceProvidersModule` gets the repository and nothing else, while the
 * controllers, the service and the rate limiter stay behind in `ReviewsModule`.
 *
 * ⚠️ ONE OWNER, DELIBERATELY — do not "simplify" this away by registering
 * `ReviewsRepository` as a module-local provider in both modules the way the
 * guards are. `ReviewsRepository` is the single place D-3 (soft-deleted reviews
 * never count) and D-4 (no average below three) are enforced; two registrations
 * would mean two things to keep in step, and the day it gains a constructor
 * dependency the second one fails to resolve inside a module that has no reason
 * to know reviews exist. A guard is stateless plumbing; this is the domain rule.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Review])],
  providers: [ReviewsRepository],
  exports: [ReviewsRepository],
})
export class ReviewsDataModule {}
