import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminGuard } from '../../common/guards/admin.guard';
import { StripeConnectModule } from '../stripe-connect/stripe-connect.module';
import { UsersModule } from '../users/users.module';
import { Payment } from './entities/payment.entity';
import { PaymentMethod } from './entities/payment-method.entity';
import { Refund } from './entities/refund.entity';
import { PaymentRepository } from './repositories/payment.repository';
import { PaymentMethodRepository } from './repositories/payment-method.repository';
import { RefundRepository } from './repositories/refund.repository';
import { PaymentsService } from './payments.service';
import { PaymentMethodsService } from './payment-methods.service';
import { RefundsService } from './refunds.service';
import { PaymentMethodsController } from './payment-methods.controller';
import { AdminPaymentsController } from './admin-payments.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, PaymentMethod, Refund]),
    // StripeConnectModule → StripeService (PaymentIntents/Refunds) +
    // StripeConnectAccountRepository (recipient charges_enabled / stripe_account_id).
    // UsersModule → UsersRepository (stripe_customer_id + AdminGuard role check).
    // No service-requests/quotes import ⇒ acyclic (request transitions are driven
    // by the webhook worker, which depends on BOTH modules).
    StripeConnectModule,
    UsersModule,
  ],
  controllers: [PaymentMethodsController, AdminPaymentsController],
  providers: [
    PaymentRepository,
    PaymentMethodRepository,
    RefundRepository,
    PaymentsService,
    PaymentMethodsService,
    RefundsService,
    AdminGuard,
  ],
  exports: [PaymentsService, RefundsService],
})
export class PaymentsModule {}
