import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { StripeService } from '../stripe-connect/stripe.service';
import { UsersRepository } from '../users/users.repository';
import { PaymentMethodRepository } from './repositories/payment-method.repository';
import { PaymentMethodType } from './enums/payment-method-type.enum';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { PaymentMethodResponseDto } from './dto/payment-method-response.dto';
import {
  NotPaymentMethodOwnerException,
  PaymentMethodAlreadyExistsException,
  PaymentMethodNotFoundException,
  StripePaymentMethodOperationFailedException,
  UnsupportedPaymentMethodTypeException,
} from './exceptions/payments.exceptions';

/** Postgres unique-violation SQLSTATE (UNIQUE(stripe_payment_method_id)). */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: string; driverError?: { code?: string } };
  return e.code === '23505' || e.driverError?.code === '23505';
}

function mapStripeType(stripeType: string): PaymentMethodType {
  switch (stripeType) {
    case 'card':
      return PaymentMethodType.CARD;
    case 'us_bank_account':
    case 'acss_debit':
      return PaymentMethodType.BANK_ACCOUNT;
    default:
      throw new UnsupportedPaymentMethodTypeException(stripeType);
  }
}

/**
 * User-owned payment methods (Part 6). Manages the lazily-created Stripe
 * Customer, attaches saved methods to it, and mirrors them locally. AuthZ:
 * callers manage only their own methods. Org-owned methods are deferred to the
 * B2B subscription phase.
 */
@Injectable()
export class PaymentMethodsService {
  private readonly logger = new Logger(PaymentMethodsService.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly pmRepo: PaymentMethodRepository,
    private readonly usersRepo: UsersRepository,
  ) {}

  async create(
    userId: string,
    dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    const customerId = await this.ensureCustomer(userId);

    // Attach the method to the customer; the response carries the card details.
    const pm = await this.attach(dto.stripePaymentMethodId, customerId);

    const type = mapStripeType(pm.type);
    const card = pm.card;
    const last4 =
      card?.last4 ?? pm.acss_debit?.last4 ?? pm.us_bank_account?.last4 ?? null;
    if (!last4) {
      throw new UnsupportedPaymentMethodTypeException(
        `${pm.type} (no last4 available)`,
      );
    }

    // First saved method becomes the default automatically.
    const existingCount = await this.pmRepo.countByUserId(userId);
    const isDefault = dto.setDefault === true || existingCount === 0;

    try {
      const record = await this.pmRepo.createForUser({
        ownerUserId: userId,
        stripePaymentMethodId: pm.id,
        type,
        brand: card?.brand ?? null,
        last4,
        expMonth: card?.exp_month ?? null,
        expYear: card?.exp_year ?? null,
        isDefault,
      });
      this.logger.log(
        `Saved payment method ${pm.id} for user ${userId} (default=${isDefault})`,
      );
      return PaymentMethodResponseDto.from(record);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new PaymentMethodAlreadyExistsException();
      }
      throw err;
    }
  }

  async list(userId: string): Promise<PaymentMethodResponseDto[]> {
    const records = await this.pmRepo.listByUserId(userId);
    return records.map((r) => PaymentMethodResponseDto.from(r));
  }

  async setDefault(
    userId: string,
    pmId: string,
  ): Promise<PaymentMethodResponseDto> {
    await this.assertOwned(userId, pmId);
    const updated = await this.pmRepo.setDefaultForUser(userId, pmId);
    if (!updated) throw new PaymentMethodNotFoundException();
    this.logger.log(`User ${userId} set payment method ${pmId} as default`);
    return PaymentMethodResponseDto.from(updated);
  }

  async remove(
    userId: string,
    pmId: string,
  ): Promise<PaymentMethodResponseDto> {
    const pm = await this.assertOwned(userId, pmId);

    // Best-effort Stripe detach — local soft-delete is the source of truth.
    try {
      await this.stripe.client.paymentMethods.detach(pm.stripePaymentMethodId);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Stripe detach failed for ${pm.stripePaymentMethodId} (continuing): ${detail}`,
      );
    }

    await this.pmRepo.softDelete(pmId);
    this.logger.log(`User ${userId} removed payment method ${pmId}`);
    return PaymentMethodResponseDto.from({ ...pm, deletedAtUtc: new Date() });
  }

  // --- internals -------------------------------------------------------------

  private async assertOwned(userId: string, pmId: string) {
    const pm = await this.pmRepo.findLiveById(pmId);
    if (!pm) throw new PaymentMethodNotFoundException();
    if (pm.ownerUserId !== userId) throw new NotPaymentMethodOwnerException();
    return pm;
  }

  /** Return the user's Stripe Customer id, creating + persisting it on first use. */
  private async ensureCustomer(userId: string): Promise<string> {
    const user = await this.usersRepo.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    if (user.stripeCustomerId) return user.stripeCustomerId;

    try {
      const customer = await this.stripe.client.customers.create({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`.trim(),
        metadata: { user_id: userId },
      });
      await this.usersRepo.setStripeCustomerId(userId, customer.id);
      this.logger.log(`Created Stripe customer ${customer.id} for user ${userId}`);
      return customer.id;
    } catch (err) {
      this.wrapStripeError(err);
    }
  }

  private async attach(stripePaymentMethodId: string, customerId: string) {
    try {
      return await this.stripe.client.paymentMethods.attach(
        stripePaymentMethodId,
        { customer: customerId },
      );
    } catch (err) {
      this.wrapStripeError(err);
    }
  }

  private wrapStripeError(err: unknown): never {
    if (err instanceof Stripe.errors.StripeError) {
      this.logger.error(`Stripe API error (${err.type}): ${err.message}`);
      throw new StripePaymentMethodOperationFailedException(err.message);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}
