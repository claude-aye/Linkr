import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../../common/guards/admin.guard';
import { UsersModule } from '../users/users.module';
import { ServiceProvidersModule } from '../service-providers/service-providers.module';
import { ServiceRequestsModule } from '../service-requests/service-requests.module';
import { PaymentsModule } from '../payments/payments.module';
import { ReviewsDataModule } from '../reviews/reviews-data.module';
import { Quote } from './entities/quote.entity';
import { QuoteRepository } from './repositories/quote.repository';
import { QuotesService } from './quotes.service';
import { ReceivedQuotesService } from './received-quotes.service';
import { QuotesController } from './quotes.controller';
import { QuotesCron } from './quotes.cron';

@Module({
  imports: [
    TypeOrmModule.forFeature([Quote]),
    // UsersModule → UsersRepository for AdminGuard; ServiceProvidersModule →
    // provider + category-eligibility repositories; ServiceRequestsModule →
    // ServiceRequestsService (request state-machine + assignment creation reuse).
    UsersModule,
    ServiceProvidersModule,
    ServiceRequestsModule,
    // PaymentsService → deposit capture after a quote is accepted.
    PaymentsModule,
    // `ReviewsRepository` → the rating aggregate on the client's received-quotes
    // list. The DATA module (a leaf importing only TypeORM), never
    // `ReviewsModule`: no cycle is possible, and quotes gets the table's rule
    // (D-3, D-4) without the reviews feature. See `reviews-data.module.ts`.
    ReviewsDataModule,
  ],
  controllers: [QuotesController],
  providers: [QuoteRepository, QuotesService, ReceivedQuotesService, QuotesCron, AdminGuard],
  exports: [QuotesService],
})
export class QuotesModule {}
