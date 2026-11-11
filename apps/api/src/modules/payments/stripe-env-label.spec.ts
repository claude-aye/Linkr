import { ConfigService } from '@nestjs/config';
import { StripeService } from '../stripe-connect/stripe.service';
import { StripeConnectService } from '../stripe-connect/stripe-connect.service';
import { PaymentsService } from './payments.service';
import { PaymentMethodsService } from './payment-methods.service';
import { RefundsService } from './refunds.service';
import { PaymentType } from './enums/payment-type.enum';
import { PaymentStatus } from './enums/payment-status.enum';
import { PaymentMethodType } from './enums/payment-method-type.enum';
import { RefundStatus } from './enums/refund-status.enum';
import { ProviderType } from '../service-providers/enums/provider-type.enum';
import { TokenType } from '../auth/enums/token-type.enum';

/**
 * Every Stripe object we create carries `metadata.linkr_env` (mandat J): the
 * test sandbox is shared with development, so the label is the only way to tell
 * the trial's objects apart when the Stripe list is cleaned up. Internal ids
 * only: no personal data in metadata.
 */

const LABEL = 'trial';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';

describe('StripeService.envLabel', () => {
  const build = (value?: string) =>
    new StripeService({
      getOrThrow: (k: string) => (k === 'STRIPE_SECRET_KEY' ? 'sk_test_x' : 'whsec_x'),
      get: (k: string) => (k === 'STRIPE_ENV_LABEL' ? value : undefined),
    } as unknown as ConfigService);

  it('reads STRIPE_ENV_LABEL', () => {
    expect(build('trial').envLabel).toBe('trial');
  });

  it('falls back to "dev" when unset', () => {
    expect(build(undefined).envLabel).toBe('dev');
  });
});

describe('linkr_env on every Stripe create', () => {
  it('customers.create (keeps user_id) and setupIntents.create', async () => {
    const customersCreate = jest.fn().mockResolvedValue({ id: 'cus_1' });
    const setupCreate = jest.fn().mockResolvedValue({ id: 'seti_1', client_secret: 'secret' });
    const stripe = {
      envLabel: LABEL,
      client: { customers: { create: customersCreate }, setupIntents: { create: setupCreate } },
    } as unknown as StripeService;
    const usersRepo = {
      findById: jest.fn().mockResolvedValue({
        id: USER_ID,
        email: 'a@linkr.test',
        firstName: 'A',
        lastName: 'B',
        stripeCustomerId: null,
      }),
      setStripeCustomerId: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PaymentMethodsService(stripe, {} as never, usersRepo as never);

    await service.createSetupIntent(USER_ID);

    expect(customersCreate.mock.calls[0][0].metadata).toEqual({
      user_id: USER_ID,
      linkr_env: LABEL,
    });
    expect(setupCreate.mock.calls[0][0].metadata).toEqual({
      user_id: USER_ID,
      linkr_env: LABEL,
    });
  });

  it('accounts.create carries provider_id', async () => {
    const accountsCreate = jest
      .fn()
      .mockResolvedValue({ id: 'acct_1', country: 'CA', default_currency: 'cad' });
    const stripe = {
      envLabel: LABEL,
      client: {
        accounts: { create: accountsCreate },
        accountLinks: { create: jest.fn().mockResolvedValue({ url: 'https://x', expires_at: 1 }) },
      },
    } as unknown as StripeService;
    const repo = {
      findByServiceProviderId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ stripeAccountId: 'acct_1' }),
    };
    const providerRepo = {
      findById: jest.fn().mockResolvedValue({
        id: PROVIDER_ID,
        providerType: ProviderType.INDIVIDUAL,
        userId: USER_ID,
        organizationId: null,
        isActive: true,
      }),
    };
    const usersRepo = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: USER_ID, email: 'a@linkr.test', countryCode: 'CA' }),
    };
    const service = new StripeConnectService(
      stripe,
      repo as never,
      providerRepo as never,
      usersRepo as never,
      { getOrThrow: () => 'http://localhost:3001/x' } as unknown as ConfigService,
    );

    await service.onboard(PROVIDER_ID, {
      sub: USER_ID,
      email: 'a@linkr.test',
      type: TokenType.ACCESS,
    });

    expect(accountsCreate.mock.calls[0][0].metadata).toEqual({
      linkr_env: LABEL,
      provider_id: PROVIDER_ID,
    });
  });

  it('paymentIntents.create keeps its ids', async () => {
    const intentsCreate = jest.fn().mockResolvedValue({ id: 'pi_1', status: 'succeeded' });
    const stripe = {
      envLabel: LABEL,
      client: { paymentIntents: { create: intentsCreate } },
    } as unknown as StripeService;
    const paymentRepo = {
      findByServiceRequestAndType: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'pay-1',
        paymentType: PaymentType.DEPOSIT,
        status: PaymentStatus.PENDING,
      }),
      attachIntent: jest.fn().mockResolvedValue(null),
      recordFailure: jest.fn().mockResolvedValue(undefined),
    };
    const pmRepo = {
      findDefaultByUserId: jest.fn().mockResolvedValue({
        id: 'pm-row',
        stripePaymentMethodId: 'pm_1',
        type: PaymentMethodType.CARD,
      }),
    };
    const connectRepo = {
      findByServiceProviderId: jest
        .fn()
        .mockResolvedValue({ stripeAccountId: 'acct_1', chargesEnabled: true }),
    };
    const usersRepo = {
      findById: jest.fn().mockResolvedValue({ id: USER_ID, stripeCustomerId: 'cus_1' }),
    };
    const service = new PaymentsService(
      stripe,
      paymentRepo as never,
      pmRepo as never,
      connectRepo as never,
      usersRepo as never,
      {
        getOrThrow: (k: string) => (k === 'PLATFORM_DEPOSIT_RATE_PERCENT' ? 20 : 10),
      } as unknown as ConfigService,
    );

    await service.captureDeposit({
      serviceRequestId: REQUEST_ID,
      clientUserId: USER_ID,
      serviceProviderId: PROVIDER_ID,
      agreedAmount: '150.00',
      agreedCurrency: 'CAD',
    });

    expect(intentsCreate.mock.calls[0][0].metadata).toEqual({
      service_request_id: REQUEST_ID,
      payment_id: 'pay-1',
      payment_type: PaymentType.DEPOSIT,
      linkr_env: LABEL,
    });
  });

  it('refunds.create keeps refund_id and payment_id', async () => {
    const refundsCreate = jest.fn().mockResolvedValue({ id: 're_1', status: 'succeeded' });
    const stripe = { envLabel: LABEL, client: { refunds: { create: refundsCreate } } };
    const payment = {
      id: 'pay-1',
      serviceRequestId: REQUEST_ID,
      paymentType: PaymentType.BALANCE,
      status: PaymentStatus.SUCCEEDED,
      grossAmount: '80.00',
      currency: 'CAD',
      stripePaymentIntentId: 'pi_1',
    };
    const refund = {
      id: 'refund-1',
      paymentId: 'pay-1',
      amount: '80.00',
      currency: 'CAD',
      status: RefundStatus.PENDING,
    };
    const refundRepo = {
      create: jest.fn().mockResolvedValue(refund),
      findById: jest.fn().mockResolvedValue(refund),
      findByStripeRefundId: jest.fn().mockResolvedValue(null),
      sumInFlightByPaymentId: jest.fn().mockResolvedValue('0'),
      sumSucceededByPaymentId: jest.fn().mockResolvedValue('80.00'),
      attachStripe: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const paymentRepo = {
      findById: jest.fn().mockResolvedValue(payment),
      findByServiceRequestId: jest.fn().mockResolvedValue([payment]),
      applyRefundDerivedStatus: jest.fn().mockResolvedValue(null),
    };
    const service = new RefundsService(stripe as never, refundRepo as never, paymentRepo as never);

    await service.refundPayment('pay-1', { amount: 80, reason: 'test' }, 'admin-1');

    expect(refundsCreate.mock.calls[0][0].metadata).toEqual({
      refund_id: 'refund-1',
      payment_id: 'pay-1',
      linkr_env: LABEL,
    });
  });
});
