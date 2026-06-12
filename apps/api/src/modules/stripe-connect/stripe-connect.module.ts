import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceProvidersModule } from '../service-providers/service-providers.module';
import { UsersModule } from '../users/users.module';
import { StripeConnectAccount } from './entities/stripe-connect-account.entity';
import { StripeConnectAccountRepository } from './repositories/stripe-connect-account.repository';
import { StripeService } from './stripe.service';
import { StripeConnectService } from './stripe-connect.service';
import { StripeConnectController } from './stripe-connect.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([StripeConnectAccount]),
    // ServiceProvidersModule → ServiceProviderRepository (resolve/own provider);
    // UsersModule → UsersRepository (owning user country_code + email).
    ServiceProvidersModule,
    UsersModule,
  ],
  controllers: [StripeConnectController],
  providers: [
    StripeService,
    StripeConnectAccountRepository,
    StripeConnectService,
  ],
  // StripeConnectAccountRepository is exported for PaymentsModule (charges_enabled
  // / stripe_account_id reads). The webhook ingress moved to StripeWebhooksModule.
  exports: [StripeService, StripeConnectService, StripeConnectAccountRepository],
})
export class StripeConnectModule {}
