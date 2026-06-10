import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceProvidersModule } from '../service-providers/service-providers.module';
import { UsersModule } from '../users/users.module';
import { StripeConnectAccount } from './entities/stripe-connect-account.entity';
import { StripeConnectAccountRepository } from './repositories/stripe-connect-account.repository';
import { StripeService } from './stripe.service';
import { StripeConnectService } from './stripe-connect.service';
import { StripeConnectController } from './stripe-connect.controller';
import { StripeWebhooksController } from './stripe-webhooks.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([StripeConnectAccount]),
    // ServiceProvidersModule → ServiceProviderRepository (resolve/own provider);
    // UsersModule → UsersRepository (owning user country_code + email).
    ServiceProvidersModule,
    UsersModule,
  ],
  controllers: [StripeConnectController, StripeWebhooksController],
  providers: [
    StripeService,
    StripeConnectAccountRepository,
    StripeConnectService,
  ],
  exports: [StripeService, StripeConnectService],
})
export class StripeConnectModule {}
