import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentRepository, PaymentRecord } from './repositories/payment.repository';
import { PaymentMethodRepository } from './repositories/payment-method.repository';
import { StripeConnectAccountRepository } from '../stripe-connect/repositories/stripe-connect-account.repository';
import { StripeService } from '../stripe-connect/stripe.service';
import { UsersRepository } from '../users/users.repository';
import { PaymentType } from './enums/payment-type.enum';
import { PaymentStatus } from './enums/payment-status.enum';
import { PaymentMethodType } from './enums/payment-method-type.enum';
import { DepositChargeFailedException } from './exceptions/payments.exceptions';

/**
 * Deposit retry (T3) — the branch that decides whether money moves.
 *
 * ONE invariant is asserted in every single case: **a second PaymentIntent is
 * never created while one already exists.** That is the whole double-charge
 * guarantee, and it is a property of the branching, not of Stripe.
 *
 * The branches themselves were derived from measurements against Stripe test
 * mode (see the docblock on `retryFailedDeposit`); what this spec pins is that
 * the code keeps taking the branch those measurements justify.
 */

const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const PAYMENT_ID = '77777777-7777-4777-8777-777777777777';
const PM_ROW_ID = '88888888-8888-4888-8888-888888888888';

function deposit(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: PAYMENT_ID,
    serviceRequestId: REQUEST_ID,
    paymentType: PaymentType.DEPOSIT,
    payerUserId: CLIENT_ID,
    payerOrganizationId: null,
    recipientServiceProviderId: PROVIDER_ID,
    paymentMethodId: PM_ROW_ID,
    stripePaymentIntentId: null,
    status: PaymentStatus.FAILED,
    grossAmount: '30.00',
    currency: 'CAD',
    commissionRatePercent: '10.00',
    platformFeeAmount: '3.00',
    taxAmount: '0.00',
    providerNetAmount: '27.00',
    capturedAtUtc: null,
    failedAtUtc: new Date(),
    failureReason: 'No such PaymentMethod',
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
    ...overrides,
  };
}

interface Harness {
  service: PaymentsService;
  paymentRepo: {
    findByServiceRequestAndType: jest.Mock;
    create: jest.Mock;
    prepareRetry: jest.Mock;
    attachIntent: jest.Mock;
    recordFailure: jest.Mock;
  };
  intents: {
    create: jest.Mock;
    retrieve: jest.Mock;
    confirm: jest.Mock;
  };
}

function buildHarness(opts: {
  existing: PaymentRecord | null;
  /** Result of `paymentIntents.retrieve`, or an Error to throw. */
  retrieved?: { id: string; status: string } | Error;
}): Harness {
  const intents = {
    create: jest.fn().mockResolvedValue({ id: 'pi_new', status: 'succeeded' }),
    retrieve: jest.fn(async () => {
      if (opts.retrieved instanceof Error) throw opts.retrieved;
      return opts.retrieved;
    }),
    confirm: jest.fn().mockResolvedValue({ id: 'pi_existing', status: 'succeeded' }),
  };

  const paymentRepo = {
    findByServiceRequestAndType: jest.fn().mockResolvedValue(opts.existing),
    create: jest.fn().mockResolvedValue(deposit({ status: PaymentStatus.PENDING })),
    prepareRetry: jest.fn().mockResolvedValue(undefined),
    attachIntent: jest.fn().mockResolvedValue(null),
    recordFailure: jest.fn().mockResolvedValue(undefined),
  };

  const pmRepo = {
    findDefaultByUserId: jest.fn().mockResolvedValue({
      id: PM_ROW_ID,
      ownerUserId: CLIENT_ID,
      ownerOrganizationId: null,
      stripePaymentMethodId: 'pm_current_default',
      type: PaymentMethodType.CARD,
      brand: 'VISA',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
      isDefault: true,
      createdAtUtc: new Date(),
      deletedAtUtc: null,
    }),
  } as unknown as PaymentMethodRepository;

  const connectRepo = {
    findByServiceProviderId: jest.fn().mockResolvedValue({
      stripeAccountId: 'acct_test',
      chargesEnabled: true,
    }),
  } as unknown as StripeConnectAccountRepository;

  const usersRepo = {
    findById: jest.fn().mockResolvedValue({ id: CLIENT_ID, stripeCustomerId: 'cus_test' }),
  } as unknown as UsersRepository;

  const stripe = { client: { paymentIntents: intents } } as unknown as StripeService;

  const config = {
    getOrThrow: jest.fn((key: string) =>
      key === 'PLATFORM_DEPOSIT_RATE_PERCENT' ? 20 : 10,
    ),
  } as unknown as ConfigService;

  const service = new PaymentsService(
    stripe,
    paymentRepo as unknown as PaymentRepository,
    pmRepo,
    connectRepo,
    usersRepo,
    config,
  );

  return { service, paymentRepo, intents };
}

const params = {
  serviceRequestId: REQUEST_ID,
  clientUserId: CLIENT_ID,
  serviceProviderId: PROVIDER_ID,
  agreedAmount: '150.00',
  agreedCurrency: 'CAD',
};

describe('PaymentsService.captureDeposit — short-circuit is status-aware', () => {
  it.each([
    PaymentStatus.SUCCEEDED,
    PaymentStatus.PROCESSING,
    PaymentStatus.REQUIRES_ACTION,
    PaymentStatus.PENDING,
    PaymentStatus.REFUNDED,
    PaymentStatus.CANCELLED,
    PaymentStatus.PARTIALLY_REFUNDED,
  ])('never re-charges a %s deposit', async (status) => {
    const h = buildHarness({ existing: deposit({ status }) });

    await h.service.captureDeposit(params);

    expect(h.intents.create).not.toHaveBeenCalled();
    expect(h.intents.confirm).not.toHaveBeenCalled();
    expect(h.paymentRepo.prepareRetry).not.toHaveBeenCalled();
    expect(h.paymentRepo.create).not.toHaveBeenCalled();
  });

  it('still creates the row and charges on a FIRST attempt (no existing row)', async () => {
    const h = buildHarness({ existing: null });

    await h.service.captureDeposit(params);

    expect(h.paymentRepo.create).toHaveBeenCalledTimes(1);
    expect(h.intents.create).toHaveBeenCalledTimes(1);
    // 20% of 150.00, and the platform fee is 10% of THAT — unchanged behaviour.
    expect(h.intents.create.mock.calls[0][0]).toMatchObject({
      amount: 3000,
      application_fee_amount: 300,
    });
    expect(h.intents.create.mock.calls[0][1]).toEqual({
      idempotencyKey: `dep_${REQUEST_ID}`,
    });
  });
});

describe('PaymentsService.captureDeposit — retry of a FAILED deposit', () => {
  it('re-issues under the SAME idempotency key when no PaymentIntent exists', async () => {
    // The key is reused on purpose: a first attempt that charged without us
    // seeing the answer replays instead of charging again.
    const h = buildHarness({ existing: deposit({ stripePaymentIntentId: null }) });

    await h.service.captureDeposit(params);

    expect(h.paymentRepo.create).not.toHaveBeenCalled(); // UPDATE, never a 2nd INSERT
    expect(h.paymentRepo.prepareRetry).toHaveBeenCalledTimes(1);
    expect(h.intents.create).toHaveBeenCalledTimes(1);
    expect(h.intents.create.mock.calls[0][1]).toEqual({
      idempotencyKey: `dep_${REQUEST_ID}`,
    });
  });

  it('re-points the row at the CURRENT default card', async () => {
    // The realistic retry is "the client fixed their card". If the row kept
    // pointing at the dead one, the ledger would name a card that never paid.
    const h = buildHarness({ existing: deposit({ stripePaymentIntentId: null }) });

    await h.service.captureDeposit(params);

    expect(h.paymentRepo.prepareRetry).toHaveBeenCalledWith(
      PAYMENT_ID,
      expect.objectContaining({ paymentMethodId: PM_ROW_ID, grossAmount: '30.00' }),
    );
  });

  it.each(['succeeded', 'processing', 'requires_action', 'requires_capture'])(
    'reconciles WITHOUT charging when the existing intent is %s',
    async (status) => {
      const h = buildHarness({
        existing: deposit({ stripePaymentIntentId: 'pi_existing' }),
        retrieved: { id: 'pi_existing', status },
      });

      await h.service.captureDeposit(params);

      expect(h.intents.retrieve).toHaveBeenCalledWith('pi_existing');
      expect(h.intents.create).not.toHaveBeenCalled();
      expect(h.intents.confirm).not.toHaveBeenCalled();
      expect(h.paymentRepo.attachIntent).toHaveBeenCalledTimes(1);
    },
  );

  it('marks the row SUCCEEDED when the lost intent had in fact succeeded', async () => {
    // The lost-response case, which is the one that would double-charge if the
    // retry blindly created a new intent.
    const h = buildHarness({
      existing: deposit({ stripePaymentIntentId: 'pi_existing' }),
      retrieved: { id: 'pi_existing', status: 'succeeded' },
    });

    await h.service.captureDeposit(params);

    expect(h.paymentRepo.attachIntent).toHaveBeenCalledWith(
      PAYMENT_ID,
      'pi_existing',
      PaymentStatus.SUCCEEDED,
      expect.any(Date),
    );
  });

  it('CONFIRMS the same intent after a decline, never creating a second one', async () => {
    const h = buildHarness({
      existing: deposit({ stripePaymentIntentId: 'pi_existing' }),
      retrieved: { id: 'pi_existing', status: 'requires_payment_method' },
    });

    await h.service.captureDeposit(params);

    expect(h.intents.create).not.toHaveBeenCalled();
    expect(h.intents.confirm).toHaveBeenCalledWith('pi_existing', {
      payment_method: 'pm_current_default',
      off_session: true,
    });
  });

  it('issues a fresh intent, under a DERIVED key, only when the old one is canceled', async () => {
    // A cancelled intent can never be confirmed and can never have charged, so
    // this is the one case where a new intent is safe. Its key must differ from
    // the first attempt's, or Stripe replays the dead result.
    const h = buildHarness({
      existing: deposit({ stripePaymentIntentId: 'pi_dead' }),
      retrieved: { id: 'pi_dead', status: 'canceled' },
    });

    await h.service.captureDeposit(params);

    expect(h.intents.confirm).not.toHaveBeenCalled();
    expect(h.intents.create).toHaveBeenCalledTimes(1);
    expect(h.intents.create.mock.calls[0][1]).toEqual({
      idempotencyKey: `dep_${REQUEST_ID}_after_pi_dead`,
    });
  });

  it('refuses to charge at all when the existing intent cannot be read', async () => {
    // Not knowing what that intent did is exactly the state in which creating a
    // second one is how someone gets debited twice. Fail loudly instead.
    const h = buildHarness({
      existing: deposit({ stripePaymentIntentId: 'pi_unknown' }),
      retrieved: new Error('network down'),
    });

    await expect(h.service.captureDeposit(params)).rejects.toBeInstanceOf(
      DepositChargeFailedException,
    );

    expect(h.intents.create).not.toHaveBeenCalled();
    expect(h.intents.confirm).not.toHaveBeenCalled();
  });
});
