import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../../common/guards/admin.guard';
import { UsersModule } from '../users/users.module';
import { ServiceProvidersModule } from '../service-providers/service-providers.module';
import { ServiceRequestsModule } from '../service-requests/service-requests.module';
import { Quote } from './entities/quote.entity';
import { QuoteRepository } from './repositories/quote.repository';
import { QuotesService } from './quotes.service';
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
  ],
  controllers: [QuotesController],
  providers: [QuoteRepository, QuotesService, QuotesCron, AdminGuard],
  exports: [QuotesService],
})
export class QuotesModule {}
