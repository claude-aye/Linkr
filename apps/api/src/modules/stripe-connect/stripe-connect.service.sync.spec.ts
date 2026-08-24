import Stripe from 'stripe';
import { ConfigService } from '@nestjs/config';

import { StripeConnectService } from './stripe-connect.service';
import { StripeAccount, StripeService } from './stripe.service';
import {
  StripeConnectAccountRecord,
  StripeConnectAccountRepository,
} from './repositories/stripe-connect-account.repository';
import { StripeConnectAccountType } from './enums/stripe-connect-account-type.enum';
import { StripeConnectOnboardingStatus } from './enums/stripe-connect-onboarding-status.enum';
import {
  ServiceProviderRecord,
  ServiceProviderRepository,
} from '../service-providers/repositories/service-provider.repository';
import { ProviderType } from '../service-providers/enums/provider-type.enum';
import { UsersRepository } from '../users/users.repository';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { TokenType } from '../auth/enums/token-type.enum';

/**
 * `sync` only. The rest of StripeConnectService predates this file and is left
 * uncovered on purpose — retro-covering it is out of this PR's scope.
 *
 * What is worth pinning here is the two failure shapes, because both are silent
 * when they go wrong: a Stripe error must surface as the SAME 502 the sibling
 * routes raise (not an unhandled 500), and a null write-back must never reach
 * `ConnectAccountResponseDto.from` — where it would crash on a property read
 * instead of saying the sync did not happen.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PROVIDER_ID = '22222222-2222-4222-8222-222222222222';
const STRIPE_ACCOUNT_ID = 'acct_test_sync';

const caller: JwtPayload = {
  sub: USER_ID,
  email: 'pro@linkr.test',
  type: TokenType.ACCESS,
};

const provider: ServiceProviderRecord = {
  id: PROVIDER_ID,
  providerType: ProviderType.INDIVIDUAL,
  userId: USER_ID,
  organizationId: null,
  businessName: 'Coiffure Test',
  headline: null,
  bio: null,
  serviceBaseLocation: { type: 'Point', coordinates: [-71.21, 46.81] },
  serviceRadiusKm: 25,
  isActive: true,
  activatedAtUtc: new Date(),
  createdAtUtc: new Date(),
  updatedAtUtc: new Date(),
};

/** The stale mirror as `sync` finds it: KYC done at Stripe, webhook never landed. */
const staleRow: StripeConnectAccountRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  serviceProviderId: PROVIDER_ID,
  stripeAccountId: STRIPE_ACCOUNT_ID,
  accountType: StripeConnectAccountType.EXPRESS,
  onboardingStatus: StripeConnectOnboardingStatus.PENDING_VERIFICATION,
  chargesEnabled: false,
  payoutsEnabled: false,
  requirementsCurrentlyDue: [],
  countryCode: 'CA',
  defaultCurrency: 'CAD',
  onboardedAtUtc: null,
  createdAtUtc: new Date(),
  updatedAtUtc: new Date(),
};

/** What Stripe actually holds — fully enabled, nothing outstanding. */
const liveAccount = {
  id: STRIPE_ACCOUNT_ID,
  details_submitted: true,
  charges_enabled: true,
  payouts_enabled: true,
  requirements: { currently_due: [], disabled_reason: null },
} as unknown as StripeAccount;

const syncedRow: StripeConnectAccountRecord = {
  ...staleRow,
  onboardingStatus: StripeConnectOnboardingStatus.VERIFIED,
  chargesEnabled: true,
  payoutsEnabled: true,
  onboardedAtUtc: new Date(),
};

interface Mocks {
  retrieve: jest.Mock;
  repoSync: jest.Mock;
  findByServiceProviderId: jest.Mock;
}

function build(overrides: Partial<Mocks> = {}): {
  service: StripeConnectService;
  mocks: Mocks;
} {
  const mocks: Mocks = {
    retrieve: overrides.retrieve ?? jest.fn().mockResolvedValue(liveAccount),
    repoSync: overrides.repoSync ?? jest.fn().mockResolvedValue(syncedRow),
    findByServiceProviderId:
      overrides.findByServiceProviderId ?? jest.fn().mockResolvedValue(staleRow),
  };

  const stripe = {
    client: { accounts: { retrieve: mocks.retrieve } },
  } as unknown as StripeService;

  const repo = {
    findByServiceProviderId: mocks.findByServiceProviderId,
    sync: mocks.repoSync,
  } as unknown as StripeConnectAccountRepository;

  const providerRepo = {
    findById: jest.fn().mockResolvedValue(provider),
  } as unknown as ServiceProviderRepository;

  const config = {
    getOrThrow: jest.fn().mockReturnValue('http://localhost:3001/x'),
  } as unknown as ConfigService;

  return {
    service: new StripeConnectService(
      stripe,
      repo,
      providerRepo,
      {} as unknown as UsersRepository,
      config,
    ),
    mocks,
  };
}

describe('StripeConnectService.sync', () => {
  it('re-reads the account from Stripe and returns the refreshed mirror', async () => {
    const { service, mocks } = build();

    const result = await service.sync(PROVIDER_ID, caller);

    expect(mocks.retrieve).toHaveBeenCalledWith(STRIPE_ACCOUNT_ID);
    expect(result.onboardingStatus).toBe(
      StripeConnectOnboardingStatus.VERIFIED,
    );
    expect(result.chargesEnabled).toBe(true);
    expect(result.payoutsEnabled).toBe(true);
    // The write-back must carry the status derived from the LIVE snapshot,
    // not the stale one it replaces.
    expect(mocks.repoSync).toHaveBeenCalledWith(
      STRIPE_ACCOUNT_ID,
      expect.objectContaining({
        chargesEnabled: true,
        payoutsEnabled: true,
        onboardingStatus: StripeConnectOnboardingStatus.VERIFIED,
      }),
    );
  });

  it('404s when the provider has no Connect mirror row — it never onboards', async () => {
    const { service, mocks } = build({
      findByServiceProviderId: jest.fn().mockResolvedValue(null),
    });

    await expect(service.sync(PROVIDER_ID, caller)).rejects.toMatchObject({
      status: 404,
    });
    // The point of the 404: no Stripe account is created as a side effect.
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it('surfaces a Stripe failure as the sibling routes 502, leaving the mirror untouched', async () => {
    const stripeError = new Stripe.errors.StripeInvalidRequestError({
      type: 'invalid_request_error',
      message: 'No such account: acct_test_sync',
    });
    const { service, mocks } = build({
      retrieve: jest.fn().mockRejectedValue(stripeError),
    });

    await expect(service.sync(PROVIDER_ID, caller)).rejects.toMatchObject({
      status: 502,
    });
    // This is the guard that keeps the seeded fixture account safe: its id is
    // deliberately malformed, so `retrieve` throws and the write never runs.
    expect(mocks.repoSync).not.toHaveBeenCalled();
  });

  it('502s rather than mapping a null write-back into the response DTO', async () => {
    const { service } = build({
      repoSync: jest.fn().mockResolvedValue(null),
    });

    await expect(service.sync(PROVIDER_ID, caller)).rejects.toMatchObject({
      status: 502,
    });
  });
});
