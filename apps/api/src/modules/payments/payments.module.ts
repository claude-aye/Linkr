import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StripeConnectModule } from '../stripe-connect/stripe-connect.module';
import { UsersModule } from '../users/users.module';
import { Payment } from './entities/payment.entity';
import { PaymentMethod } from './entities/payment-method.entity';
import { PaymentRepository } from './repositories/payment.repository';
import { PaymentMethodRepository } from './repositories/payment-method.repository';
import { PaymentsService } from './payments.service';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodsController } from './payment-methods.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, PaymentMethod]),
    // StripeConnectModule → StripeService (PaymentIntents) + StripeConnectAccountRepository
    // (recipient charges_enabled / stripe_account_id). UsersModule → UsersRepository
    // (stripe_customer_id). No service-requests/quotes import ⇒ acyclic.
    StripeConnectModule,
    UsersModule,
  ],
  controllers: [PaymentMethodsController],
  providers: [
    PaymentRepository,
    PaymentMethodRepository,
    PaymentsService,
    PaymentMethodsService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
